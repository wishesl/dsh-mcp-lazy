import assert from 'node:assert/strict'
import test from 'node:test'

import { MCP_LAZY_INVOCATIONS, MCP_LAZY_PACKAGE } from '../lib/wire.js'

const BUNDLE_URL = new URL('../lib/client.js', import.meta.url).href

/** Minimal React stand-in: enough for the class component and element trees. */
function fakeReact() {
  class Component {
    constructor(props) {
      this.props = props ?? {}
      this.state = {}
    }

    setState(next) {
      this.state = { ...this.state, ...next }
    }
  }
  return {
    Component,
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children: children.flat() }
    }
  }
}

/**
 * Load the bundle the way the browser module table does: capture the lazy
 * factory from `window.__ModuleLoader__.load`, then run it with a `require`
 * that resolves `react`. The bundle is a singleton (as in the browser), so the
 * module cache is the fixture: load it once and reuse the factory.
 */
let cachedBundle
let definition
async function loadBundle() {
  if (cachedBundle !== undefined) return cachedBundle
  globalThis.window = { __ModuleLoader__: { load: (value) => { definition = value } } }
  await import(BUNDLE_URL)
  assert.ok(definition, 'the bundle must register one __ModuleLoader__ definition')
  assert.equal(definition.id, '@yilinxiao/dsh-mcp-lazy')
  const react = fakeReact()
  cachedBundle = {
    plugin: definition.factory((specifier) => {
      assert.equal(specifier, 'react')
      return react
    }),
    react
  }
  return cachedBundle
}

/** Client context double: records dictionary, mount, slot registration. */
function clientContext({ snapshotResult, saveResult, resetResult } = {}) {
  const record = { dictionaries: [], mounted: undefined, injected: undefined, registration: undefined, panel: undefined, calls: [] }
  const ctx = {
    effect: (factory) => {
      const dispose = factory()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    locale: {
      register: (ns, dictionaries) => {
        record.dictionaries.push([ns, dictionaries])
        return () => {}
      },
      bind: (ns) => (key) => `${ns}:${key}`
    },
    remote: {
      $mount: async (contribution) => {
        record.mounted = contribution
        return () => {}
      }
    },
    inject: (deps, callback) => {
      record.injected = deps
      callback({
        remote: {
          mcpLazy: {
            snapshot: async () => {
              record.calls.push(['snapshot'])
              return snapshotResult
            },
            saveProfile: async (input) => {
              record.calls.push(['saveProfile', input])
              return saveResult
            },
            resetProfile: async (input) => {
              record.calls.push(['resetProfile', input])
              return resetResult
            }
          }
        },
        slots: {
          inject: (slot, available) => {
            record.slot = slot
            available()
          },
          register: (options, component) => {
            record.registration = options
            record.panel = component
            return () => {}
          }
        }
      })
    }
  }
  return { ctx, record }
}

const PROMPT_TEXT = [
  '## MCP 服务器（按需加载）',
  '',
  '以下 MCP 服务器的工具默认不在工具表里。需要时调用 `mcp__router__search_and_activate`：带 `query`（能力关键词）或 `serverName`（精确指定服务器名）；披露后当轮即可直接调用。',
  '',
  '- playwright（2 个工具）: browser, navigate'
].join('\n')

const SNAPSHOT = {
  available: true,
  generatedAt: 1700000000000,
  routerTool: 'mcp__router__search_and_activate',
  signature: 'sig-1',
  serverCount: 1,
  toolCount: 2,
  servers: [{
    serverName: 'playwright',
    toolCount: 2,
    keywords: ['browser', 'navigate'],
    description: '浏览器操作',
    override: { description: '浏览器操作', keywords: ['浏览器'], pinned: false },
    pinned: false,
    overrideSource: { description: 'custom', keywords: 'custom' },
    tools: [
      { name: 'mcp__playwright__browser_navigate', description: 'Navigate to a URL' },
      { name: 'mcp__playwright__browser_click', description: 'Click on a web page' }
    ]
  }],
  omittedTools: 0,
  passthrough: [],
  promptIndex: {
    enabled: true,
    channel: 'message',
    name: 'mcp-lazy',
    order: null,
    locale: 'zh',
    reason: '',
    text: PROMPT_TEXT
  },
  store: { persisted: true, file: 'C:\\Users\\Tony\\.dsh\\profiles\\desktop\\.dsh-mcp-lazy\\profiles.json', warning: null }
}

/** A write answer: the fresh snapshot, with the panel's own save reflected. */
const SAVED_SNAPSHOT = {
  ...SNAPSHOT,
  servers: [{ ...SNAPSHOT.servers[0], override: { description: '浏览器自动化', keywords: ['浏览器', '截图'], pinned: true }, pinned: true }]
}

/** Descriptor data, function members excluded (each face owns its own closure). */
const projectParameter = (parameter) => ({
  name: parameter.name,
  wire: parameter.wire,
  source: parameter.source,
  lookup: parameter.lookup,
  codec: { mode: parameter.codec.mode, typeSymbol: parameter.codec.typeSymbol }
})

const project = (descriptor) => ({
  id: descriptor.id,
  service: descriptor.service,
  namespace: descriptor.namespace,
  method: descriptor.method,
  invocation: descriptor.invocation,
  parameters: descriptor.parameters.map(projectParameter),
  result: { mode: descriptor.result.mode, typeSymbol: descriptor.result.typeSymbol },
  sourceLocation: descriptor.sourceLocation
})

/** Drain the panel's Promise chain (setState happens after a few microtasks). */
async function settle(rounds = 6) {
  for (let index = 0; index < rounds; index += 1) await new Promise((resolve) => setImmediate(resolve))
}

test('the browser bundle registers one settings.section entry and mounts every descriptor', async () => {
  const { plugin } = await loadBundle()
  assert.equal(plugin.name, 'dsh-mcp-lazy')
  assert.deepEqual(plugin.inject, ['slots', 'locale', 'remote'])

  const { ctx, record } = clientContext({ snapshotResult: ok(SNAPSHOT) })
  await plugin.apply(ctx)

  assert.equal(record.dictionaries.length, 1)
  assert.equal(record.dictionaries[0][0], 'settings.mcpLazy')
  assert.ok(record.dictionaries[0][1].zh.nav, 'zh dictionary must carry the nav label')
  assert.ok(record.dictionaries[0][1].en.nav, 'en dictionary must carry the nav label')
  // The editor and the injected-prompt block are user-visible text: both
  // dictionaries must carry them or the panel renders blank labels.
  assert.ok(record.dictionaries[0][1].zh.promptTitle)
  assert.ok(record.dictionaries[0][1].zh.edit)
  assert.ok(record.dictionaries[0][1].en.promptTitle)
  assert.ok(record.dictionaries[0][1].en.edit)

  // The descriptors the bundle mounts must match the host manifest's, or the two
  // Typert faces would drift and the Remote call would 404. `package` must be
  // the real npm name: the host loader rejects any other owner.
  assert.equal(record.mounted.package, MCP_LAZY_PACKAGE)
  assert.equal(record.mounted.package, '@yilinxiao/dsh-mcp-lazy')
  assert.equal(record.mounted.descriptors.length, MCP_LAZY_INVOCATIONS.length)
  for (const [index, descriptor] of record.mounted.descriptors.entries()) {
    assert.deepEqual(project(descriptor), project(MCP_LAZY_INVOCATIONS[index]))
    // Both faces must carry a strict codec whose parse accepts a real snapshot
    // and rejects a malformed one — the loader requires `mode: 'strict'` outright.
    assert.equal(descriptor.result.mode, 'strict')
    const parse = descriptor.result.create().parse
    assert.equal(parse(SNAPSHOT), SNAPSHOT)
    assert.throws(() => parse({ ...SNAPSHOT, servers: 'nope' }), /servers must be an array/)
    assert.throws(() => parse(null), /result must be an object/)
    assert.throws(
      () => parse({ ...SNAPSHOT, servers: [{ serverName: 'x', toolCount: 0, keywords: [], tools: [] }] }),
      /override object/
    )
  }
  // Parameter codecs are validated by the loader too, so both faces must agree on
  // what a write argument looks like.
  for (const descriptor of record.mounted.descriptors) {
    for (const parameter of descriptor.parameters) {
      const parse = parameter.codec.create().parse
      assert.equal(parse({ serverName: 'playwright' }).serverName, 'playwright')
      assert.throws(() => parse({ serverName: '' }), /serverName/)
      assert.throws(() => parse(null), /input must be an object/)
    }
  }

  assert.equal(record.slot, 'settings.section')
  assert.deepEqual(record.injected, ['remote.mcpLazy', 'slots'])
  assert.equal(record.registration.name, 'settings.section')
  assert.equal(record.registration.id, 'mcp-lazy')
  assert.equal(record.registration.order, 45)
  assert.equal(record.registration.label(), 'settings.mcpLazy:nav')
  assert.equal(record.registration.locale, 'settings.mcpLazy')

  const injected = record.registration.inject()
  assert.equal(typeof injected.load, 'function')
  assert.equal(typeof injected.save, 'function')
  assert.equal(typeof injected.reset, 'function')
  assert.equal(typeof injected.t, 'function')
  assert.deepEqual(await injected.load(), SNAPSHOT)
  assert.deepEqual(record.calls, [['snapshot']])
})

test('the panel renders servers, tools, the injected prompt and the footer', async () => {
  const { plugin } = await loadBundle()
  const { ctx, record } = clientContext({ snapshotResult: ok(SNAPSHOT) })
  await plugin.apply(ctx)

  const Panel = record.panel
  // Render with the real zh dictionary, so these assertions cover the text a
  // user actually reads (including the interpolated section name and order).
  const zh = record.dictionaries[0][1].zh
  const instance = new Panel({ t: (key) => zh[key] ?? key, load: async () => SNAPSHOT })
  instance.state = { status: 'ready', snapshot: SNAPSHOT }
  const tree = instance.render()

  assert.equal(tree.type, 'section')
  const text = JSON.stringify(tree)
  assert.match(text, /playwright/)
  assert.match(text, /browser/)
  assert.match(text, /mcp__playwright__browser_navigate/)
  assert.match(text, /目录签名/)
  assert.match(text, /快照时间/)
  // Requirement: the exact text that enters the model context is visible.
  assert.match(text, /data-mcp-lazy-prompt-index/)
  assert.match(text, /## MCP 服务器（按需加载）/)
  // The channel decides the promise the panel makes: a message channel means a
  // real row of its own in the conversation (the AGENTS.md shape).
  assert.match(text, /独立会话条目/)
  assert.match(text, /mcp-lazy/)
  assert.match(text, /会话里看/)
  // The editor is behind a per-server toggle, so it is absent until opened.
  assert.doesNotMatch(text, /data-mcp-lazy-editor/)
  assert.match(text, /复制/)
  // The override's origin is badged, so nobody wonders why an edit "did nothing".
  assert.match(text, /面板自定义/)
})

test('the editor renders the effective override and saves what the user typed', async () => {
  const { plugin } = await loadBundle()
  const { ctx, record } = clientContext({ snapshotResult: ok(SNAPSHOT) })
  await plugin.apply(ctx)
  const Panel = record.panel

  const saved = []
  const instance = new Panel({
    t: (key) => key,
    load: async () => SNAPSHOT,
    save: async (input) => { saved.push(input); return SAVED_SNAPSHOT },
    reset: async () => SNAPSHOT
  })
  instance.state = { status: 'ready', snapshot: SNAPSHOT }

  instance.startEdit(SNAPSHOT.servers[0])
  assert.equal(instance.state.editing, 'playwright')
  assert.deepEqual(instance.state.draft, { description: '浏览器操作', keywords: '浏览器' })
  assert.match(JSON.stringify(instance.render()), /data-mcp-lazy-editor/)

  instance.setState({ draft: { description: '  浏览器自动化  ', keywords: '浏览器, 截图, ,' } })
  instance.submitEdit('playwright')
  await settle()

  assert.deepEqual(saved, [{
    serverName: 'playwright',
    description: '浏览器自动化',
    keywords: ['浏览器', '截图']
  }])
  // The write answer is the new snapshot: the panel never re-derives the index.
  assert.equal(instance.state.snapshot, SAVED_SNAPSHOT)
  assert.equal(instance.state.editing, null)
  assert.equal(instance.state.notice.kind, 'ok')
  assert.equal(instance.state.notice.text, 'saved')
})

test('the editor resets an override and reports a memory-only host', async () => {
  const { plugin } = await loadBundle()
  const { ctx, record } = clientContext({ snapshotResult: ok(SNAPSHOT) })
  await plugin.apply(ctx)
  const Panel = record.panel

  const memoryOnly = { ...SNAPSHOT, store: { persisted: false, file: null, warning: 'no profile directory' } }
  const resets = []
  const instance = new Panel({
    t: (key) => key,
    load: async () => SNAPSHOT,
    save: async () => memoryOnly,
    reset: async (input) => { resets.push(input); return SNAPSHOT }
  })
  instance.state = { status: 'ready', snapshot: SNAPSHOT }

  instance.resetEdit('playwright')
  await settle()
  assert.deepEqual(resets, [{ serverName: 'playwright' }])
  assert.equal(instance.state.notice.text, 'saved')

  instance.startEdit(SNAPSHOT.servers[0])
  instance.submitEdit('playwright')
  await settle()
  // A host with no profile directory says so instead of pretending to persist.
  assert.equal(instance.state.notice.text, 'savedMemoryOnly')
  // The warning also reaches the footer, where the state file would be shown.
  assert.match(JSON.stringify(instance.render()), /storeWarning/)
})

test('a failed write keeps the draft and shows a recoverable error', async () => {
  const { plugin } = await loadBundle()
  const { ctx, record } = clientContext({ snapshotResult: ok(SNAPSHOT) })
  await plugin.apply(ctx)
  const Panel = record.panel

  const instance = new Panel({
    t: (key) => key,
    load: async () => SNAPSHOT,
    save: async () => { throw new Error('remote/internal: boom') },
    reset: async () => SNAPSHOT
  })
  instance.state = { status: 'ready', snapshot: SNAPSHOT, editing: 'playwright', draft: { description: 'x', keywords: '' } }
  instance.submitEdit('playwright')
  await settle()

  assert.equal(instance.state.notice.kind, 'error')
  assert.match(instance.state.notice.text, /saveFailed: remote\/internal: boom/)
  // Nothing is lost: the editor stays open with the user's text.
  assert.equal(instance.state.editing, 'playwright')
  assert.deepEqual(instance.state.draft, { description: 'x', keywords: '' })
  assert.match(JSON.stringify(instance.render()), /data-mcp-lazy-notice/)
})

test('the panel explains a prompt section that is disabled, unsupported or empty', async () => {
  const { plugin } = await loadBundle()
  const { ctx, record } = clientContext({ snapshotResult: ok(SNAPSHOT) })
  await plugin.apply(ctx)
  const Panel = record.panel

  const cases = [
    [{ enabled: false, reason: 'disabled', text: '' }, /promptDisabled/],
    [{ enabled: false, reason: 'unsupported', text: '' }, /promptUnsupported/],
    [{ enabled: true, reason: 'empty', text: '' }, /promptEmpty/]
  ]
  for (const [promptIndex, pattern] of cases) {
    const instance = new Panel({ t: (key) => key, load: async () => SNAPSHOT })
    instance.state = { status: 'ready', snapshot: { ...SNAPSHOT, promptIndex: { ...SNAPSHOT.promptIndex, ...promptIndex } } }
    assert.match(JSON.stringify(instance.render()), pattern)
  }
})

test('the panel shows an empty state, an unavailable state and a recoverable error', async () => {
  const { plugin } = await loadBundle()
  const { ctx, record } = clientContext({ snapshotResult: ok(SNAPSHOT) })
  await plugin.apply(ctx)
  const Panel = record.panel

  const empty = new Panel({ t: (key) => key, load: async () => SNAPSHOT })
  empty.state = { status: 'ready', snapshot: { ...SNAPSHOT, servers: [], serverCount: 0 } }
  assert.match(JSON.stringify(empty.render()), /empty/)

  const unavailable = new Panel({ t: (key) => key, load: async () => SNAPSHOT })
  unavailable.state = { status: 'ready', snapshot: { ...SNAPSHOT, available: false, servers: [] } }
  assert.match(JSON.stringify(unavailable.render()), /unavailable/)

  const failed = new Panel({ t: (key) => key, load: async () => SNAPSHOT })
  failed.state = { status: 'error', message: 'remote/unavailable: boom' }
  const failedText = JSON.stringify(failed.render())
  assert.match(failedText, /remote\/unavailable: boom/)
  assert.match(failedText, /retry/)
})

/** Wrap a payload the way the Remote gateway answers a successful call. */
function ok(value) {
  return { ok: true, value }
}
