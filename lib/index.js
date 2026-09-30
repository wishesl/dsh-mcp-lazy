// 按需激活的 MCP 桥接插件（@yilinxiao/dsh-mcp-lazy）
//
// 与 @deepseek-ai/dsh-mcp-client 的差异：
//   1. 启动时不连接 MCP 服务器，只注册两个轻量控制工具：
//      mcp__<serverName>__activate   —— 连接服务器并注册其全部工具
//      mcp__<serverName>__deactivate —— 断开连接并卸载已注册工具
//   2. 每轮按需（默认 releaseOnTurnEnd: true）：某个会话在本轮激活服务器后，
//      本轮对话结束（agent/turn-stopping）且没有任何会话仍在当轮使用它时，
//      立即卸载全部工具；保温期内下一轮可复用连接，超时后自动断开。
//      releaseOnTurnEnd: false 时，会话跨轮次持有发布，直到真实的最后一个
//      持有会话收到 agent/disposed；无关会话销毁不会释放它。
//   3. 工具命名、调用、结果投影等协议与 mcp-client 完全一致（复用同一套
//      实现约定），保证模型看到的工具形态不变。
//   4. 工具目录变更采用先发现、后差量替换；失败时保留最后一次可用目录。
//   5. 连接意外断开时立即卸载工具；仍有当前轮使用者、跨轮次持有者或
//      autoActivate 所有权时仅做有限次数自动重连。
import z from '@deepseek-ai/schemastery'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { ListToolsResultSchema, ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import { assertSupportedJsonSchema } from '@deepseek-ai/dsh-tools'
import { createHash } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z as zod } from 'zod'
import {
  discoverTools,
  fingerprintTool
} from './lazy-core.js'
import { createDshAdapter, createUniversalDshAdapter } from './dsh-adapter.js'
import { stableSchemaFingerprint } from './mcp-catalog.js'
import {
  buildIndexText,
  buildServerViews,
  indexSignatureKey,
  withServerOverrides
} from './mcp-view.js'
import { createProfileStore } from './profile-store.js'
import { createServerRuntime } from './server-runtime.js'
import { registerRouterCompatibleTool, registerRouterServer } from './tool-router.js'
import { installUniversalManager } from './universal-manager.js'

const require = createRequire(import.meta.url)
const { version: pluginVersion } = require('../package.json')

const name = 'mcp-lazy'
const inject = ['tools']

const MAX_PUBLIC_NAME_LENGTH = 64
const INVALID_NAME_CHARS = /[^A-Za-z0-9_-]/g
const HASH_LENGTH = 12
const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/
const DEFAULT_TOOL_CALL_TIMEOUT_MS = 60000
const DEFAULT_CONNECT_TIMEOUT_MS = 30000
const DEFAULT_DISCOVERY_TIMEOUT_MS = 60000
const DEFAULT_MAX_TOOL_LIST_PAGES = 100
const DEFAULT_RECONNECT_ATTEMPTS = 1
const DEFAULT_WARM_IDLE_MS = 300000
const ACTIVATE_TOOL_TIMEOUT_MS = 180000
const DEACTIVATE_TOOL_TIMEOUT_MS = 60000

const RawCallToolResultSchema = zod.record(zod.string(), zod.unknown())

// 与 mcp-client 相同的公共名规范化：DeepSeek 函数名契约（64 字符、[A-Za-z0-9_-]），
// 规范化有损时追加 12 位十六进制哈希保证不冲突。
function publicToolName(serverName, rawName) {
  const joined = `mcp__${serverName}__${rawName}`
  const normalized = joined.replace(INVALID_NAME_CHARS, '_')
  if (normalized === joined && normalized.length <= MAX_PUBLIC_NAME_LENGTH) return normalized
  const hash = createHash('sha256').update(`${serverName}\0${rawName}`).digest('hex').slice(0, HASH_LENGTH)
  return `${normalized.slice(0, MAX_PUBLIC_NAME_LENGTH - HASH_LENGTH - 1)}_${hash}`
}

const StdioServerConfig = z.object({
    transport: z.const('stdio'),
    serverName: z.string().required().pattern(SERVER_NAME_PATTERN),
    command: z.string().required(),
    args: z.array(String).default([]),
    env: z.dict(String).default({}),
    cwd: z.string().default(''),
    toolCallTimeoutMs: z.number().default(DEFAULT_TOOL_CALL_TIMEOUT_MS),
    connectTimeoutMs: z.number().default(DEFAULT_CONNECT_TIMEOUT_MS),
    discoveryTimeoutMs: z.number().default(DEFAULT_DISCOVERY_TIMEOUT_MS),
    maxToolListPages: z.number().default(DEFAULT_MAX_TOOL_LIST_PAGES),
    reconnectAttempts: z.number().default(DEFAULT_RECONNECT_ATTEMPTS),
    autoActivate: z.boolean().default(false),
    releaseOnTurnEnd: z.boolean().default(true),
    warmIdleMs: z.number().default(DEFAULT_WARM_IDLE_MS),
    routingHints: z.array(String).default([]),
    promptIndex: z.boolean().default(true)
  })

const StreamableHttpServerConfig = z.object({
    transport: z.const('streamable-http'),
    serverName: z.string().required().pattern(SERVER_NAME_PATTERN),
    url: z.string().required(),
    headers: z.dict(String).default({}),
    toolCallTimeoutMs: z.number().default(DEFAULT_TOOL_CALL_TIMEOUT_MS),
    connectTimeoutMs: z.number().default(DEFAULT_CONNECT_TIMEOUT_MS),
    discoveryTimeoutMs: z.number().default(DEFAULT_DISCOVERY_TIMEOUT_MS),
    maxToolListPages: z.number().default(DEFAULT_MAX_TOOL_LIST_PAGES),
    reconnectAttempts: z.number().default(DEFAULT_RECONNECT_ATTEMPTS),
    autoActivate: z.boolean().default(false),
    releaseOnTurnEnd: z.boolean().default(true),
    warmIdleMs: z.number().default(DEFAULT_WARM_IDLE_MS),
    routingHints: z.array(String).default([]),
    promptIndex: z.boolean().default(true)
  })

const ManagerConfig = z.object({
  mode: z.const('manager').required(),
  // 提示词索引：新会话装配时注入「有哪些 MCP + 关键词」，取代人工维护的清单。
  promptIndex: z.boolean().default(true),
  promptIndexLocale: z.union([z.const('zh'), z.const('en')]).default('zh'),
  descriptionChars: z.number().default(120),
  keywordsPerServer: z.number().default(8),
  maxServers: z.number().default(12),
  maxSnapshotTools: z.number().default(200),
  // 可选覆盖：从 MCP 定义派生的关键词/描述不够用时才需要它（例如中文别名）。
  serverProfiles: z.dict(z.object({
    description: z.string(),
    keywords: z.array(String)
  })).default({})
})

// Schemastery does not propagate defaults through a nested union, so keep the
// three concrete variants flat to retain the established server defaults.
const Config = z.union([ManagerConfig, StdioServerConfig, StreamableHttpServerConfig])

function buildTransport(config) {
  switch (config.transport) {
    case 'stdio':
      return new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: { ...scrubbedParentEnv(), ...config.env },
        cwd: config.cwd || undefined
      })
    case 'streamable-http':
      return new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.headers } })
  }
}

function supportedOutputSchema(candidate) {
  if (candidate === undefined) return undefined
  try {
    assertSupportedJsonSchema(candidate)
    return candidate
  } catch {
    return undefined
  }
}

function createOutput(rawName, structuredSchema) {
  return {
    schema: {
      type: 'object',
      properties: {
        content: { type: 'array', items: {} },
        structuredContent: structuredSchema ?? {}
      },
      required: structuredSchema === undefined ? ['content'] : ['content', 'structuredContent'],
      additionalProperties: false
    },
    render(_args, value) {
      return [{ type: 'text', text: extractText(value.content, rawName) }]
    }
  }
}

function extractText(mcpContent, toolName) {
  const parts = []
  for (const value of mcpContent) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      parts.push('[unsupported content type: unknown]')
      continue
    }
    const block = value
    switch (block.type) {
      case 'text':
        if (block.text !== undefined) parts.push(block.text)
        break
      case 'image':
        parts.push(`[image: ${block.mimeType ?? 'unknown'}, content discarded]`)
        break
      case 'audio':
        parts.push(`[audio: ${block.mimeType ?? 'unknown'}, content discarded]`)
        break
      case 'resource':
      case 'resource_link':
        parts.push('[resource: content discarded]')
        break
      default:
        parts.push(`[unsupported content type: ${block.type}]`)
    }
  }
  return parts.join('\n') || `(${toolName} returned no text content)`
}

function createExecutor(client, rawName, taskRequired, timeoutMs, onUse, onSuccess) {
  return async (args, exec) => {
    onUse?.(exec.agent)
    if (taskRequired) throw new Error(`Tool "${rawName}" requires task-based execution, which this bridge does not support`)
    const result = await client.request({
      method: 'tools/call',
      params: { name: rawName, arguments: typeof args === 'object' && args !== null ? args : {} }
    }, RawCallToolResultSchema, {
      signal: exec.signal,
      timeout: timeoutMs
    })
    if (!Array.isArray(result.content)) {
      const rendered = 'toolResult' in result ? JSON.stringify(result.toolResult) : '(no output)'
      const text = typeof rendered === 'string' ? rendered : '(no output)'
      if (result.isError === true) throw new Error(text)
      onSuccess?.(exec.agent)
      return {
        content: [{ type: 'text', text }],
        ...(result.structuredContent !== undefined ? { structuredContent: result.structuredContent } : {})
      }
    }
    const content = result.content
    const text = extractText(content, rawName)
    if (result.isError === true) throw new Error(text)
    onSuccess?.(exec.agent)
    return {
      content,
      ...(result.structuredContent !== undefined ? { structuredContent: result.structuredContent } : {})
    }
  }
}

// 控制工具的结果输出：文本块投影。
function textOutput() {
  return {
    schema: {
      type: 'object',
      properties: { content: { type: 'array', items: {} } },
      required: ['content'],
      additionalProperties: false
    },
    render(_args, value) {
      const text = (value.content ?? [])
        .filter((block) => block && typeof block === 'object' && block.type === 'text')
        .map((block) => block.text)
        .join('\n')
      return [{ type: 'text', text }]
    }
  }
}

const EMPTY_CATALOG = { entries: [], passthrough: [], signature: 'empty' }
const PROMPT_SECTION_NAME = 'mcp-lazy:index'
const INDEX_ORDER_OFFSET = 50

/**
 * Memoized index text: an unchanged registry plus unchanged view config produce
 * identical bytes, so the prompt section never churns between turns. The view is
 * read through a function because panel-authored overrides can change while the
 * session lives — the memo key covers them, so a save lands on the next assembly.
 */
function createIndexProvider(readCatalog, readView) {
  let cachedKey
  let cachedText = ''
  return () => {
    const catalog = readCatalog() ?? EMPTY_CATALOG
    const view = readView() ?? {}
    const key = indexSignatureKey(catalog.signature, view)
    if (key === cachedKey) return cachedText
    cachedText = buildIndexText(buildServerViews(catalog.entries ?? [], view), view)
    cachedKey = key
    return cachedText
  }
}

/**
 * Resolve the profile directory that owns this plugin instance.
 *
 * `ctx.baseUrl` is the Cordis config-tree anchor and the strongest source: the
 * typert-loader resolves plugin packages from it with `createRequire`, so it is
 * the directory holding `node_modules/`. The Desktop host's own services come
 * next. Nothing here guesses: an anchor that does not resolve to a directory
 * carrying a profile manifest is rejected, and no anchor at all leaves the store
 * in memory-only mode (the panel says so instead of silently losing edits).
 */
function resolveProfileDirectory(ctx) {
  const anchors = []
  if (typeof ctx?.baseUrl === 'string' && ctx.baseUrl !== '') anchors.push(ctx.baseUrl)
  const desktop = ctx?.get?.('desktopProfiles')?.current?.dir
  if (typeof desktop === 'string' && desktop !== '') anchors.push(desktop)
  const profileContext = ctx?.get?.('profileContext')
  for (const value of [profileContext?.dir, profileContext?.profileDirectory]) {
    if (typeof value === 'string' && value !== '') anchors.push(value)
  }

  for (const anchor of anchors) {
    let path = anchor
    if (path.startsWith('file:')) {
      try {
        path = fileURLToPath(path)
      } catch {
        path = path.replace(/^file:\/\//u, '')
      }
    }
    try {
      if (!/[\\/]$/u.test(path) && !(existsSync(path) && statSync(path).isDirectory())) path = dirname(path)
      if (existsSync(path) && statSync(path).isDirectory()) {
        if (existsSync(`${path}/package.json`) || existsSync(`${path}/cordis.yml`)) return path
      }
    } catch { /* an unreadable anchor is simply not this one */ }
  }
  return undefined
}

/** Live state of the injected prompt section, shared with the settings panel. */
function createPromptState(config) {
  return {
    status: config.promptIndex === false ? 'disabled' : 'unsupported',
    sectionName: PROMPT_SECTION_NAME,
    order: null,
    locale: config.promptIndexLocale === 'en' ? 'en' : 'zh',
    text: () => ''
  }
}

/** What the panel shows about the injected prompt: verbatim text plus why. */
function promptIndexReport(state) {
  const text = state.status === 'registered' ? state.text() : ''
  const reason = state.status === 'disabled'
    ? 'disabled'
    : state.status === 'unsupported'
      ? 'unsupported'
      : text === '' ? 'empty' : ''
  return {
    enabled: state.status === 'registered',
    sectionName: state.sectionName,
    order: state.order,
    locale: state.locale,
    reason,
    text
  }
}

/**
 * Mount the `mcpLazy` Remote service behind the settings panel.
 *
 * `@deepseek-ai/dsh-typert-protocol` is imported lazily and by feature
 * detection: a host that does not ship it (the 0.1.x line) simply has no
 * panel, and the bridge/router behaviour is untouched. The mount is awaited by
 * `apply` so the service exists before the plugin reports ready — a panel whose
 * Remote route is not registered yet would answer 404 on first paint.
 */
async function mountPanelService(ctx, options) {
  let protocol
  try {
    protocol = await import('@deepseek-ai/dsh-typert-protocol')
  } catch {
    ctx.logger?.info?.('mcp-lazy: settings panel unavailable (no @deepseek-ai/dsh-typert-protocol on this host)')
    return
  }
  if (typeof protocol?.TypertRemoteService !== 'function') return
  try {
    const { McpLazyService } = await import('./service.js')
    await ctx.plugin(McpLazyService, options)
  } catch (error) {
    ctx.logger?.warn?.(`mcp-lazy: settings panel service failed to mount (${String(error?.message ?? error)})`)
  }
}

/**
 * The prompt index plus the settings panel, shared by both modes.
 *
 * The section is registered through `ctx.inject(['systemPrompt'])`, so a host
 * without that service (or without the canonical band lookup) keeps working;
 * the section sits just after the official `MCP_SERVERS` band, where
 * mcp-client already publishes each server's own instructions.
 *
 * The panel gets the same effective view the index uses (`readView`), so what a
 * user edits, what the index injects and what the panel previews cannot drift.
 */
async function installSurfaces(ctx, { readCatalog, config, store }) {
  const promptState = createPromptState(config)
  const readView = () => withServerOverrides(config, store?.overrides?.() ?? {})
  if (config.promptIndex !== false) {
    // `inject` is core Cordis, but a partial host (or a test double) may not
    // carry it; the prompt index is an addition, never a load requirement.
    ctx.inject?.(['systemPrompt'], (scope) => {
      if (typeof scope.systemPrompt?.getSectionOrder !== 'function') return
      const provideText = createIndexProvider(readCatalog, readView)
      promptState.text = provideText
      promptState.order = scope.systemPrompt.getSectionOrder('MCP_SERVERS') + INDEX_ORDER_OFFSET
      promptState.status = 'registered'
      scope.effect(() => scope.systemPrompt.section({
        name: PROMPT_SECTION_NAME,
        order: promptState.order,
        interpolate: false,
        text: provideText
      }), 'mcp-lazy: prompt index')
    })
  }
  await mountPanelService(ctx, {
    readCatalog,
    readView,
    store,
    readPromptIndex: () => promptIndexReport(promptState)
  })
}

/** Catalog view for one explicitly configured lazy server. */
function explicitCatalog(config, runtime) {
  const getCatalog = () => (typeof runtime.getCatalog === 'function' ? runtime.getCatalog() : [])
  return {
    signature: `explicit:${config.serverName}:${stableSchemaFingerprint(getCatalog())}`,
    entries: [{
      serverName: config.serverName,
      routingHints: config.routingHints ?? [],
      getCatalog
    }],
    passthrough: []
  }
}

/**
 * Custom descriptions and keywords double as routing hints.
 *
 * Without this the aliases the prompt advertises would be unsearchable: the
 * router scores server names, hints and tool definitions only, so a Chinese
 * business name would show up in the index and then match nothing. Reading the
 * *effective* profile keeps the panel, the injected index and the router on one
 * source.
 */
function customHintsOf(config, store) {
  return (serverName) => {
    const profiles = withServerOverrides(config, store?.overrides?.() ?? {}).serverProfiles ?? {}
    const profile = profiles[serverName]
    if (profile === undefined) return []
    const hints = []
    if (typeof profile.description === 'string') hints.push(profile.description)
    if (Array.isArray(profile.keywords)) hints.push(...profile.keywords)
    return hints
  }
}

async function apply(ctx, config) {
  // DSH may auto-insert an installed plugin once without instance config.
  // Explicit entries from cordis.patch.yml are applied separately with config.
  if (config === undefined) return

  // Panel-authored overrides live in the profile directory, so they survive
  // restarts and plugin updates. A host that exposes no anchor leaves this
  // memory-only, which the panel reports instead of pretending to save.
  const store = createProfileStore({
    resolveDirectory: () => resolveProfileDirectory(ctx),
    logger: ctx.logger
  })

  if (config.mode === 'manager') {
    const managerAdapter = createUniversalDshAdapter(ctx)
    if (!managerAdapter.supported) {
      // The base adapter already reports a missing core host capability. The
      // universal-only capability check deliberately does not, so emit exactly
      // one actionable compatibility error in either case.
      if (managerAdapter.reason?.startsWith('unsupported universal manager;')) {
        ctx?.logger?.error?.(`mcp-lazy manager: ${managerAdapter.reason}; leaving tools unchanged`)
      }
      return
    }
    let controller
    managerAdapter.effect(() => installUniversalManager(managerAdapter, {
      hintsOf: customHintsOf(config, store),
      onReady: (ready) => { controller = ready }
    }), 'mcp-lazy.manager')
    await installSurfaces(ctx, {
      readCatalog: () => controller?.currentCatalog() ?? EMPTY_CATALOG,
      config,
      store
    })
    return
  }

  const adapter = createDshAdapter(ctx)
  if (!adapter.supported) return

  const label = `mcp-lazy(${config.serverName})`
  const connectTimeoutMs = positiveInteger(config.connectTimeoutMs, DEFAULT_CONNECT_TIMEOUT_MS)
  const discoveryTimeoutMs = positiveInteger(config.discoveryTimeoutMs, DEFAULT_DISCOVERY_TIMEOUT_MS)
  const maxToolListPages = positiveInteger(config.maxToolListPages, DEFAULT_MAX_TOOL_LIST_PAGES)
  const reconnectAttempts = nonNegativeInteger(config.reconnectAttempts, DEFAULT_RECONNECT_ATTEMPTS)
  const warmIdleMs = nonNegativeInteger(config.warmIdleMs, DEFAULT_WARM_IDLE_MS)

  let runtime

  async function discoverDefinitions(client, signal) {
    const tools = await discoverTools({
      request: client.request.bind(client),
      resultSchema: ListToolsResultSchema,
      timeoutMs: discoveryTimeoutMs,
      maxPages: maxToolListPages,
      signal
    })
    const definitions = new Map()
    for (const tool of tools) {
      const publicName = publicToolName(config.serverName, tool.name)
      if (definitions.has(publicName)) {
        throw new Error(`${label}: multiple MCP tool names map to public name "${publicName}"`)
      }
      definitions.set(publicName, {
        fingerprint: fingerprintTool(tool),
        summary: { name: publicName, description: tool.description ?? '' },
        definition: {
          name: publicName,
          description: tool.description ?? '',
          parameters: tool.inputSchema,
          output: createOutput(tool.name, supportedOutputSchema(tool.outputSchema)),
          execute: createExecutor(
            client,
            tool.name,
            tool.execution?.taskSupport === 'required',
            config.toolCallTimeoutMs,
            runtime.addUser,
            runtime.markSuccessfulUse
          )
        }
      })
    }
    return definitions
  }

  async function createConnectedClient(signal, callbacks) {
    const client = new Client({ name: 'dsh-mcp-lazy', version: pluginVersion }, { capabilities: {} })
    client.onclose = () => callbacks.onClose(client)
    client.setNotificationHandler(ToolListChangedNotificationSchema, async () => callbacks.onToolsChanged(client))
    try {
      await client.connect(buildTransport(config), { timeout: connectTimeoutMs, signal })
      return client
    } catch (error) {
      void client.close().catch(() => {})
      throw error
    }
  }

  const runtimeAdapter = {
    ...adapter,
    registerTool: (definition) => registerRouterCompatibleTool(adapter, definition)
  }

  runtime = createServerRuntime({
    adapter: runtimeAdapter,
    config: { ...config, warmIdleMs },
    label,
    reconnectAttempts,
    createConnectedClient,
    discoverDefinitions
  })

  const setupDisposers = []
  let activationPromise
  let cleanupPromise

  function retainDisposer(dispose) {
    if (typeof dispose === 'function') setupDisposers.push(dispose)
  }

  function cleanup() {
    if (cleanupPromise !== undefined) return cleanupPromise
    for (const dispose of setupDisposers.splice(0).reverse()) {
      try { dispose() } catch (error) { adapter.log('warn', `${label}: setup disposal failed: ${String(error)}`) }
    }
    cleanupPromise = Promise.resolve(runtime.dispose())
      .catch((error) => adapter.log('error', `${label}: plugin disposal failed: ${String(error)}`))
    return cleanupPromise
  }

  try {
    // Hints are a live source: `routingHints` from the config first, then the
    // panel-authored aliases for this server, read at scoring time.
    const authoredHints = customHintsOf(config, store)
    retainDisposer(registerRouterServer(adapter, {
      serverName: config.serverName,
      routingHints: () => [...(config.routingHints ?? []), ...authoredHints(config.serverName)],
      getCatalog: runtime.getCatalog,
      activate: (agent, signal) => runtime.activate(agent, false, signal)
    }))

    retainDisposer(adapter.on('agent/turn-stopping', runtime.onTurnStopping))
    retainDisposer(adapter.on('agent/disposed', runtime.onAgentDisposed))

    retainDisposer(adapter.registerTool({
      name: `mcp__${config.serverName}__activate`,
      description: `按需激活 MCP 服务器 "${config.serverName}"：连接该服务器并把它提供的全部工具注册进工具目录，立即可用${config.releaseOnTurnEnd ? '（本轮结束后自动卸载）' : ''}。调用任何 mcp__${config.serverName}__* 工具之前必须先调用本工具；重复调用是安全的。`,
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      timeoutMs: ACTIVATE_TOOL_TIMEOUT_MS,
      output: textOutput(),
      execute: async (_args, exec) => ({ content: [{ type: 'text', text: await runtime.activate(exec.agent, false, exec.signal) }] })
    }))

    retainDisposer(adapter.registerTool({
      name: `mcp__${config.serverName}__deactivate`,
      description: `立即停用 MCP 服务器 "${config.serverName}"：断开连接并把它的全部工具从工具目录中卸载，以节省上下文 token。`,
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      timeoutMs: DEACTIVATE_TOOL_TIMEOUT_MS,
      output: textOutput(),
      execute: async () => ({ content: [{ type: 'text', text: await runtime.deactivate() }] })
    }))

    adapter.effect(() => {
      activationPromise = config.autoActivate ? runtime.activate(undefined, true) : null
      return cleanup
    }, 'mcp-lazy.state')

    await installSurfaces(ctx, {
      readCatalog: () => explicitCatalog(config, runtime),
      config,
      store
    })
  } catch (error) {
    await cleanup()
    void activationPromise
    throw error
  }
}

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback
}

function nonNegativeInteger(value, fallback) {
  return Number.isInteger(value) && value >= 0 ? value : fallback
}

export { Config, apply, inject, name }
