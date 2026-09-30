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
  const capturedSections = []
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
      }
    } catch {
      sectionOrderOf = undefined
      capturedSections.length = 0
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

  // Prompt index against the REAL band lookup: it must land just after the
  // official MCP_SERVERS sections and stay byte-stable for an unchanged registry.
  if (sectionOrderOf !== undefined) {
    assert.equal(sectionOrderOf('MCP_SERVERS'), 3100, 'the canonical MCP_SERVERS band must be stable')
    const index = capturedSections.find(section => section.name === 'mcp-lazy:index')
    assert.ok(index !== undefined, 'the plugin must register the MCP prompt index')
    assert.equal(index.order, 3100 + 50)
    assert.equal(index.interpolate, false)
    const first = index.text()
    assert.match(first, /## MCP 服务器/)
    assert.match(first, new RegExp(PASSIVE_TOOL_NAMES[0].split('__')[1]))
    assert.equal(index.text(), first, 'an unchanged registry must produce identical bytes')
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
