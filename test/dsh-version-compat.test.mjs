import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const ROUTER_TOOL_NAME = 'mcp__router__search_and_activate'
const PASSIVE_TOOL_NAMES = ['mcp__alpha__echo', 'mcp__beta__search']

/** One registry-ready passive MCP tool: the same shape mcp-client and this plugin register. */
function registration(name) {
  return {
    name,
    description: `passive fixture ${name}`,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: {
      schema: {
        type: 'object',
        properties: { content: { type: 'array', items: {} } },
        required: ['content'],
        additionalProperties: false
      },
      render: () => [{ type: 'text', text: 'ok' }]
    },
    execute: async () => ({ content: [{ type: 'text', text: 'ok' }] })
  }
}

/** Import a host package, or undefined when the matrix row does not ship it. */
async function optionalImport(specifier) {
  try {
    return await import(specifier)
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') return undefined
    throw error
  }
}

test('plugin imports host-owned peers for the requested DSH version', async (t) => {
  const expected = process.env.DSH_COMPAT_VERSION
  if (!expected) return t.skip('DSH_COMPAT_VERSION is only set by compatibility CI')
  const { apply } = await import('../lib/index.js')
  for (const packageName of [
    '@deepseek-ai/dsh',
    '@deepseek-ai/dsh-tools',
    '@deepseek-ai/dsh-subprocess'
  ]) {
    assert.equal(require(`${packageName}/package.json`).version, expected, packageName)
  }
  await assert.doesNotReject(() => apply({}, undefined))

  const definitions = new Map()
  const cleanups = []
  const listeners = new Map()
  const sections = []
  const emit = (event, payload) => {
    for (const handler of [...(listeners.get(event) ?? [])]) handler(payload)
  }
  const context = {
    tools: {
      register(definition) {
        definitions.set(definition.name, definition)
        emit('tools/change')
        return () => {
          definitions.delete(definition.name)
          emit('tools/change')
        }
      },
      schemas() {
        return [...definitions.values()].map(({ name, description, parameters }) => ({ name, description, parameters }))
      },
      get(name) {
        return definitions.get(name)
      }
    },
    logger: { info() {}, warn() {}, error() {} },
    on(event, handler) {
      let handlers = listeners.get(event)
      if (handlers === undefined) listeners.set(event, handlers = new Set())
      handlers.add(handler)
      return () => handlers.delete(handler)
    },
    effect(factory) {
      const cleanup = factory()
      cleanups.push(async () => {
        await new Promise((resolve) => setImmediate(resolve))
        return cleanup?.()
      })
    },
    // The prompt index is an optional surface: the plugin reaches it through
    // ctx.inject(['systemPrompt']), so the stub host must serve that too.
    inject(deps, callback) {
      assert.deepEqual(deps, ['systemPrompt'])
      callback({
        systemPrompt: {
          getSectionOrder(name) {
            assert.equal(name, 'MCP_SERVERS')
            return 3100
          },
          section(value) {
            sections.push(value)
            return () => {}
          }
        },
        effect(factory) {
          const cleanup = factory()
          cleanups.push(async () => cleanup?.())
        }
      })
    }
  }
  const restrictions = new Set()
  const agent = {
    ctx: {
      tools: {
        restrict({ deny }) {
          const restriction = new Set(deny)
          restrictions.add(restriction)
          return () => restrictions.delete(restriction)
        }
      }
    }
  }
  const visibleNames = () => {
    const denied = new Set([...restrictions].flatMap(restriction => [...restriction]))
    return [...definitions.keys()].filter(name => !denied.has(name)).sort()
  }

  await assert.doesNotReject(() => apply(context, { mode: 'manager' }))
  const disposePassive = context.tools.register({
    name: 'mcp__passive__echo',
    description: 'compatibility passive tool',
    parameters: { type: 'object' },
    execute: async () => ({ content: [{ type: 'text', text: 'passive' }] })
  })
  emit('agent/created', { agent })
  assert.deepEqual(visibleNames(), ['mcp__router__search_and_activate'])

  // The prompt index: empty while nothing is managed (zero cost), then one line
  // per managed server with its derived keywords, byte-stable across calls.
  const index = sections.find(section => section.name === 'mcp-lazy:index')
  assert.ok(index !== undefined, 'the prompt index section must be registered')
  assert.equal(index.order, 3100 + 50)
  assert.equal(index.interpolate, false)
  const indexText = index.text()
  assert.match(indexText, /## MCP 服务器（按需加载）/)
  assert.match(indexText, /passive/)
  assert.match(indexText, /mcp__router__search_and_activate/)
  assert.equal(index.text(), indexText, 'an unchanged registry must produce identical bytes')
  assert.equal(index.text({ scope: undefined }), indexText, 'the provider ignores the assembly context')

  await assert.doesNotReject(() => apply(context, {
    transport: 'stdio',
    serverName: 'compat',
    command: process.execPath,
    args: [],
    env: {},
    cwd: '',
    toolCallTimeoutMs: 1000,
    connectTimeoutMs: 1000,
    discoveryTimeoutMs: 1000,
    maxToolListPages: 2,
    reconnectAttempts: 0,
    autoActivate: false,
    releaseOnTurnEnd: true,
    warmIdleMs: 0,
    routingHints: []
  }))
  assert.ok(definitions.has('mcp__compat__activate'))
  assert.ok(definitions.has('mcp__compat__deactivate'))
  assert.ok(definitions.has('mcp__router__search_and_activate'))
  for (const cleanup of cleanups.reverse()) await cleanup?.()
  assert.ok(visibleNames().includes('mcp__passive__echo'))
  disposePassive()
  assert.equal(definitions.size, 0)
})

test('real host: manager mode hides compatible MCP tools through the real registry', async (t) => {
  const expected = process.env.DSH_COMPAT_VERSION
  if (!expected) return t.skip('DSH_COMPAT_VERSION is only set by compatibility CI')

  // The stub-host test above proves the plugin's own logic; this one proves the
  // host contract it depends on: a REAL cordis Context, the REAL ToolService,
  // and the REAL agent-scope restrict() the universal manager calls.
  const [cordis, dshTools, dshScope, pluginModule] = await Promise.all([
    optionalImport('@deepseek-ai/cordis'),
    optionalImport('@deepseek-ai/dsh-tools'),
    optionalImport('@deepseek-ai/dsh-scope'),
    // The plugin itself imports its host peers, so it stays a lazy import:
    // without them this module must still load and skip.
    optionalImport('../lib/index.js')
  ])
  if (cordis === undefined || dshTools === undefined || dshScope === undefined || pluginModule === undefined) {
    return t.skip(`real host packages for ${expected} do not ship the registry/scope surface`)
  }

  // The settings panel only works if this package's `./typert` manifest passes
  // the REAL loader: it must be owned by the package name and carry strict
  // codecs. Run the loader's own validator when the row ships it.
  const typertLoader = await optionalImport('@deepseek-ai/dsh-typert-loader')
  if (typertLoader !== undefined && typeof typertLoader.validateTypertManifest === 'function') {
    const { TYPERT } = await import('../lib/typert.host.js')
    assert.doesNotThrow(
      () => typertLoader.validateTypertManifest(require('../package.json').name, TYPERT),
      'the real typert-loader must accept this package manifest'
    )
  }
  const Context = cordis.Context
  const ToolRuntime = dshTools.default
  const { createScope, scopeOf } = dshScope
  if (typeof Context !== 'function' || typeof ToolRuntime !== 'function' || typeof createScope !== 'function') {
    return t.skip(`real host packages for ${expected} do not expose the registry/scope constructors`)
  }

  const tick = () => new Promise((resolve) => setImmediate(resolve))
  const visibleFor = (tools, scopeKey) => tools.schemas(scopeKey).map(schema => schema.name).sort()

  const ctx = new Context()
  // Mount the REAL system-prompt service when the matrix row ships it, so the
  // prompt-index assertions below run against the real canonical band lookup
  // instead of a hand-rolled constant. A row without it falls back to the
  // ToolRuntime-only stub and skips those assertions.
  let sectionOrderOf
  let contextOrderOf
  const capturedSections = []
  const capturedContexts = []
  let systemPromptModule
  try {
    systemPromptModule = await import('@deepseek-ai/dsh-system-prompt')
  } catch {
    systemPromptModule = undefined
  }
  if (systemPromptModule !== undefined && typeof systemPromptModule.default === 'function') {
    try {
      await ctx.plugin(systemPromptModule.default)
      const service = ctx.get('systemPrompt')
      if (service !== undefined && typeof service.getSectionOrder === 'function') {
        sectionOrderOf = (name) => service.getSectionOrder(name)
        const realSection = service.section.bind(service)
        service.section = (value) => {
          capturedSections.push(value)
          return realSection(value)
        }
        if (typeof service.getContextOrder === 'function') {
          contextOrderOf = (name) => service.getContextOrder(name)
          const realContext = service.context.bind(service)
          service.context = (value) => {
            capturedContexts.push(value)
            return realContext(value)
          }
        }
      }
    } catch {
      sectionOrderOf = undefined
      contextOrderOf = undefined
      capturedSections.length = 0
      capturedContexts.length = 0
    }
  }
  // The real ToolRuntime injects `systemPrompt`; without the real service a
  // stub keeps the test on the registry surface.
  if (sectionOrderOf === undefined) {
    ctx.provide('systemPrompt', { tools: () => () => undefined, section: () => () => undefined })
  }
  await ctx.plugin(ToolRuntime)

  const tools = ctx.get('tools')
  assert.equal(typeof tools?.register, 'function', 'the real registry must expose register()')
  assert.equal(typeof tools?.restrict, 'function', 'the real registry must expose restrict()')

  // The plugin's own registration shape (raw parameters + output.schema) must be
  // accepted by the real register(), which validates output.schema.
  for (const name of PASSIVE_TOOL_NAMES) tools.register(registration(name))
  assert.deepEqual(visibleFor(tools, undefined), [...PASSIVE_TOOL_NAMES].sort())

  const fiber = await ctx.plugin(
    {
      name: pluginModule.name,
      inject: pluginModule.inject,
      Config: pluginModule.Config,
      apply: pluginModule.apply
    },
    { mode: 'manager' }
  )
  await tick()
  assert.deepEqual(visibleFor(tools, undefined), [...PASSIVE_TOOL_NAMES, ROUTER_TOOL_NAME].sort())

  // Prompt index against the REAL system-prompt service: it must register as a
  // named runtime context (the surface the conversation itemizes in the message
  // flow, same channel as the workspace AGENTS.md chain), and stay byte-stable.
  if (sectionOrderOf !== undefined) {
    assert.equal(sectionOrderOf('MCP_SERVERS'), 3100, 'the canonical MCP_SERVERS band must be stable')
    if (contextOrderOf !== undefined) {
      assert.equal(contextOrderOf('SUBAGENT_DELEGATION'), 120, 'the canonical context band must be stable')
      const index = capturedContexts.find(context => context.name === 'mcp-lazy:index')
      assert.ok(index !== undefined, 'the plugin must register the MCP index as a runtime context')
      assert.equal(index.order, 120 + 10)
      assert.equal(capturedSections.length, 0, 'a context-capable host must not also register a section (that would inject the index twice)')
      const first = index.text({})
      assert.match(first, /## MCP 服务器/)
      assert.match(first, new RegExp(PASSIVE_TOOL_NAMES[0].split('__')[1]))
      assert.equal(index.text({}), first, 'an unchanged registry must produce identical bytes')

      // This is what the model receives and what the chat entry attributes: the
      // snapshot keeps each contributor's name.
      const service = ctx.get('systemPrompt')
      const assembly = await service.assemble({})
      const contribution = assembly.contexts.find(context => context.name === 'mcp-lazy:index')
      assert.ok(contribution !== undefined, 'the index must reach the assembled prompt')
      assert.equal(contribution.text, first)
      const snapshot = systemPromptModule.renderContextSnapshot(assembly)
      assert.match(snapshot, /Current runtime context/)
      assert.ok(snapshot.includes(first), 'the injected snapshot must carry the index verbatim')
    } else {
      // A host with only the section band still injects, just without the entry.
      const index = capturedSections.find(section => section.name === 'mcp-lazy:index')
      assert.ok(index !== undefined, 'the plugin must fall back to a prompt section')
      assert.equal(index.order, 3100 + 50)
      assert.equal(index.interpolate, false)
      assert.match(index.text(), /## MCP 服务器/)
    }
  }

  // Mint the agent scope the way the host does, then let the manager reconcile it.
  let scope
  ctx.inject(['tools'], (scopedCtx) => {
    scope = createScope(scopedCtx, { compatAgent: expected })
  })
  await tick()
  assert.ok(scope !== undefined, 'an agent scope must be mintable under a tools-injected context')
  const scopeKey = scopeOf(scope.ctx)
  assert.ok(scopeKey !== undefined, 'the minted context must carry a scope key')

  ctx.emit('agent/created', { agent: { id: 'compat-agent', ctx: scope.ctx } })
  await tick()
  assert.deepEqual(
    visibleFor(tools, scopeKey),
    [ROUTER_TOOL_NAME],
    'the agent must see only the router while compatible MCP tools stay hidden'
  )
  assert.deepEqual(
    visibleFor(tools, undefined),
    [...PASSIVE_TOOL_NAMES, ROUTER_TOOL_NAME].sort(),
    'the global catalog must stay untouched'
  )

  await fiber.dispose?.()
  await scope.dispose?.()
  await tick()
  assert.deepEqual(visibleFor(tools, undefined), [...PASSIVE_TOOL_NAMES].sort())
})

/** A throwaway profile directory: the anchor the panel store resolves. */
async function tempProfileDirectory() {
  const { mkdtemp, writeFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = await mkdtemp(join(tmpdir(), 'mcp-lazy-compat-'))
  await writeFile(join(dir, 'package.json'), '{}\n')
  return dir
}

test('real host: the panel service shows the injected prompt and persists overrides', async (t) => {
  const expected = process.env.DSH_COMPAT_VERSION
  if (!expected) return t.skip('DSH_COMPAT_VERSION is only set by compatibility CI')

  const [cordis, dshTools, protocol, systemPromptModule, pluginModule] = await Promise.all([
    optionalImport('@deepseek-ai/cordis'),
    optionalImport('@deepseek-ai/dsh-tools'),
    optionalImport('@deepseek-ai/dsh-typert-protocol'),
    optionalImport('@deepseek-ai/dsh-system-prompt'),
    optionalImport('../lib/index.js')
  ])
  // The panel needs all four: the real Context, the real registry, the REAL
  // TypertRemoteService base the service extends, and the real prompt service
  // whose band lookup decides the section order.
  if (
    cordis?.Context === undefined ||
    dshTools?.default === undefined ||
    typeof protocol?.TypertRemoteService !== 'function' ||
    typeof systemPromptModule?.default !== 'function' ||
    pluginModule === undefined
  ) {
    return t.skip(`the settings panel surface for ${expected} needs cordis, dsh-tools, dsh-system-prompt and dsh-typert-protocol`)
  }

  const { readFile, rm } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const tick = () => new Promise((resolve) => setImmediate(resolve))
  const profileDir = await tempProfileDirectory()

  const ctx = new cordis.Context()
  // The Cordis config-tree anchor: in a real profile it is the directory whose
  // node_modules holds this plugin, which is exactly where panel state belongs.
  ctx.baseUrl = profileDir

  try {
    await ctx.plugin(systemPromptModule.default)
    const systemPrompt = ctx.get('systemPrompt')
    const capturedContexts = []
    const realContext = systemPrompt.context.bind(systemPrompt)
    systemPrompt.context = (value) => {
      capturedContexts.push(value)
      return realContext(value)
    }

    await ctx.plugin(dshTools.default)
    const tools = ctx.get('tools')
    for (const name of PASSIVE_TOOL_NAMES) tools.register(registration(name))

    const fiber = await ctx.plugin(
      {
        name: pluginModule.name,
        inject: pluginModule.inject,
        Config: pluginModule.Config,
        apply: pluginModule.apply
      },
      { mode: 'manager' }
    )
    await tick()

    const service = ctx.get('mcpLazy')
    assert.ok(service !== undefined, 'the Typert service must be reachable by its namespace')
    for (const method of ['snapshot', 'saveProfile', 'resetProfile']) {
      assert.equal(typeof service?.[method], 'function', `the panel needs ${method}()`)
    }

    const before = await service.snapshot()
    assert.equal(before.available, true)
    assert.equal(before.serverCount, PASSIVE_TOOL_NAMES.length)
    assert.equal(before.promptIndex.enabled, true)
    assert.equal(before.promptIndex.channel, 'context')
    assert.equal(before.promptIndex.name, 'mcp-lazy:index')
    assert.equal(before.promptIndex.order, systemPrompt.getContextOrder('SUBAGENT_DELEGATION') + 10)
    assert.match(before.promptIndex.text, /## MCP 服务器/)

    // The panel's text is byte-identical to the context the model and the
    // conversation's runtime-context entry see.
    const index = capturedContexts.find(context => context.name === 'mcp-lazy:index')
    assert.ok(index !== undefined, 'the plugin must register the MCP index as a runtime context')
    assert.equal(before.promptIndex.text, index.text({}))
    const assembly = await systemPrompt.assemble({})
    assert.equal(
      assembly.contexts.find(context => context.name === 'mcp-lazy:index')?.text,
      before.promptIndex.text,
      'the assembled prompt must carry the index verbatim'
    )

    // The panel store writes into the profile directory it resolved.
    assert.equal(before.store.persisted, true)
    assert.equal(before.store.file, join(profileDir, '.dsh-mcp-lazy', 'profiles.json'))
    assert.equal(before.servers[0].override.description, null)

    // Mint the agent scope so the router can disclose, like the host does.
    const { createScope, scopeOf } = await import('@deepseek-ai/dsh-scope')
    let scope
    ctx.inject(['tools'], (scopedCtx) => {
      scope = createScope(scopedCtx, { compatAgent: `panel-${expected}` })
    })
    await tick()
    // The manager keys its agents by identity, so the router must be handed the
    // same object the host announced.
    const agent = { id: 'compat-panel-agent', ctx: scope.ctx }
    ctx.emit('agent/created', { agent })
    await tick()
    const callRouter = (query) => tools
      .get(ROUTER_TOOL_NAME, scopeOf(scope.ctx))
      .execute({ query }, { agent, signal: new AbortController().signal })

    // A Chinese alias matches nothing before the user authors one...
    assert.match((await callRouter('阿尔法')).content[0].text, /未找到匹配/)

    const saved = await service.saveProfile({
      serverName: 'alpha',
      description: '阿尔法回显服务',
      keywords: ['阿尔法', 'echo']
    })
    const savedAlpha = saved.servers.find(server => server.serverName === 'alpha')
    assert.equal(savedAlpha.override.description, '阿尔法回显服务')
    assert.deepEqual(savedAlpha.override.keywords, ['阿尔法', 'echo'])
    assert.deepEqual(savedAlpha.overrideSource, { description: 'custom', keywords: 'custom' })
    assert.equal(saved.store.persisted, true)
    // The injection and the section both moved to the new text.
    assert.match(saved.promptIndex.text, /阿尔法回显服务/)
    assert.equal(saved.promptIndex.text, index.text({}))
    assert.notEqual(saved.promptIndex.text, before.promptIndex.text)
    // ...and it is on disk, so a restart keeps it.
    assert.deepEqual(
      JSON.parse(await readFile(saved.store.file, 'utf8')).servers,
      { alpha: { description: '阿尔法回显服务', keywords: ['阿尔法', 'echo'] } }
    )
    // ...and it routes: the alias the model read in the prompt now discloses alpha.
    const routed = await callRouter('阿尔法')
    assert.match(routed.content[0].text, /alpha/)
    assert.match(routed.content[0].text, /已披露/)

    // Resetting drops the override, the file entry and the routing alias.
    const reset = await service.resetProfile({ serverName: 'alpha' })
    assert.equal(reset.servers.find(server => server.serverName === 'alpha').override.description, null)
    assert.deepEqual(JSON.parse(await readFile(reset.store.file, 'utf8')).servers, {})
    assert.equal(reset.promptIndex.text, before.promptIndex.text)

    // A bad argument is refused with a message the panel can show.
    await assert.rejects(() => service.saveProfile({ serverName: '  ' }), /serverName is required/)

    await fiber.dispose?.()
    await scope?.dispose?.()
    await tick()
  } finally {
    await rm(profileDir, { recursive: true, force: true })
  }
})

test('real host: the index reaches a live agent as its own injected message', async (t) => {
  const expected = process.env.DSH_COMPAT_VERSION
  if (!expected) return t.skip('DSH_COMPAT_VERSION is only set by compatibility CI')

  const [cordis, dshTools, pluginModule, llm] = await Promise.all([
    optionalImport('@deepseek-ai/cordis'),
    optionalImport('@deepseek-ai/dsh-tools'),
    optionalImport('../lib/index.js'),
    optionalImport('@deepseek-ai/dsh-llm')
  ])
  if (cordis?.Context === undefined || dshTools?.default === undefined || pluginModule === undefined) {
    return t.skip(`the message channel for ${expected} needs cordis and dsh-tools`)
  }

  const tick = () => new Promise((resolve) => setImmediate(resolve))
  const ctx = new cordis.Context()
  // The host's own live-agent registry is what selects this channel; the fake
  // agent records what the plugin queues, exactly like agent.inject() would.
  const injected = []
  const pending = []
  const agent = {
    id: 'compat-message-agent',
    inject(message) {
      injected.push(message)
      pending.push(message)
    },
    inbox: {
      get nextStep() { return pending },
      nextTurn: [],
      remove() { return false }
    }
  }
  ctx.provide('agents', { list: () => [agent] })
  // The real ToolRuntime injects `systemPrompt`; without it the registry never
  // activates (and `tools` stays undefined).
  ctx.provide('systemPrompt', { tools: () => () => undefined, section: () => () => undefined })
  await ctx.plugin(dshTools.default)
  const tools = ctx.get('tools')
  assert.equal(typeof tools?.register, 'function', 'the real registry must expose register()')
  for (const name of PASSIVE_TOOL_NAMES) tools.register(registration(name))

  const fiber = await ctx.plugin(
    {
      name: pluginModule.name,
      inject: pluginModule.inject,
      Config: pluginModule.Config,
      apply: pluginModule.apply
    },
    { mode: 'manager' }
  )
  await tick()

  assert.equal(injected.length, 1, 'a session that already exists must be backfilled')
  const message = injected[0]
  // The message shape is the host's (`createUserMessage`), so this also proves
  // the plugin does not have to hand-roll one.
  assert.equal(message.role, 'user')
  assert.equal(typeof message.id, 'string')
  if (llm?.createUserMessage !== undefined) {
    assert.equal(Object.isFrozen(message), true, 'the host factory freezes its messages')
  }
  // `kind` labels the row (contextProducer default) and `form` picks a supported
  // presentation — this pair is what makes the injection its own chat entry,
  // the way the workspace AGENTS.md chain appears.
  assert.deepEqual(message.source, { kind: 'mcp-lazy', form: 'catalog' })
  assert.equal(message.content.length, 1)
  assert.equal(message.content[0].type, 'text')
  assert.match(message.content[0].text, /## MCP 服务器/)

  const service = ctx.get('mcpLazy')
  if (service !== undefined) {
    const snapshot = await service.snapshot()
    assert.equal(snapshot.promptIndex.channel, 'message')
    assert.equal(snapshot.promptIndex.name, 'mcp-lazy')
    // The panel shows exactly what was queued for the agent.
    assert.equal(snapshot.promptIndex.text, message.content[0].text)
  }

  await fiber.dispose?.()
  await tick()
})
