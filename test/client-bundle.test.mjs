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
async function loadBundle() {
  if (cachedBundle !== undefined) return cachedBundle
  let definition
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
function clientContext({ snapshotResult } = {}) {
  const record = { dictionaries: [], mounted: undefined, injected: undefined, registration: undefined, panel: undefined }
  const load = async () => {
    if (snapshotResult !== undefined) return snapshotResult
    throw new Error('load() must not be called by this test')
  }
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
        remote: { mcpLazy: { snapshot: async () => snapshotResult } },
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
  return { ctx, record, load }
}

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
    tools: [
      { name: 'mcp__playwright__browser_navigate', description: 'Navigate to a URL' },
      { name: 'mcp__playwright__browser_click', description: 'Click on a web page' }
    ]
  }],
  omittedTools: 0,
  passthrough: []
}

/** Descriptor data, function members excluded (each face owns its own closure). */
const project = (descriptor) => ({
  id: descriptor.id,
  service: descriptor.service,
  namespace: descriptor.namespace,
  method: descriptor.method,
  invocation: descriptor.invocation,
  parameters: descriptor.parameters,
  result: { mode: descriptor.result.mode, typeSymbol: descriptor.result.typeSymbol },
  sourceLocation: descriptor.sourceLocation
})

test('the browser bundle registers one read-only settings.section entry', async () => {
  const { plugin } = await loadBundle()
  assert.equal(plugin.name, 'dsh-mcp-lazy')
  assert.deepEqual(plugin.inject, ['slots', 'locale', 'remote'])

  const { ctx, record } = clientContext()
  await plugin.apply(ctx)

  assert.equal(record.dictionaries.length, 1)
  assert.equal(record.dictionaries[0][0], 'settings.mcpLazy')
  assert.ok(record.dictionaries[0][1].zh.nav, 'zh dictionary must carry the nav label')
  assert.ok(record.dictionaries[0][1].en.nav, 'en dictionary must carry the nav label')

  // The descriptor the bundle mounts must match the host manifest's, or the two
  // Typert faces would drift and the Remote call would 404. `package` must be
  // the real npm name: the host loader rejects any other owner.
  assert.equal(record.mounted.package, MCP_LAZY_PACKAGE)
  assert.equal(record.mounted.package, '@yilinxiao/dsh-mcp-lazy')
  assert.equal(record.mounted.descriptors.length, MCP_LAZY_INVOCATIONS.length)
  assert.deepEqual(project(record.mounted.descriptors[0]), project(MCP_LAZY_INVOCATIONS[0]))
  // Both faces must carry a strict codec whose parse accepts a real snapshot and
  // rejects a malformed one — the loader requires `mode: 'strict'` outright.
  assert.equal(record.mounted.descriptors[0].result.mode, 'strict')
  assert.equal(record.mounted.descriptors[0].result.mode, MCP_LAZY_INVOCATIONS[0].result.mode)
  const clientParse = record.mounted.descriptors[0].result.create().parse
  const hostParse = MCP_LAZY_INVOCATIONS[0].result.create().parse
  for (const parse of [clientParse, hostParse]) {
    assert.equal(parse(SNAPSHOT), SNAPSHOT)
    assert.throws(() => parse({ ...SNAPSHOT, servers: 'nope' }), /servers must be an array/)
    assert.throws(() => parse(null), /result must be an object/)
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
  assert.equal(typeof injected.t, 'function')
})

test('the panel renders servers, tools and the read-only footer', async () => {
  const { plugin } = await loadBundle()
  const { ctx, record } = clientContext()
  await plugin.apply(ctx)

  const Panel = record.panel
  const instance = new Panel({ t: (key) => key, load: async () => SNAPSHOT })
  instance.state = { status: 'ready', snapshot: SNAPSHOT }
  const tree = instance.render()

  assert.equal(tree.type, 'section')
  const text = JSON.stringify(tree)
  assert.match(text, /playwright/)
  assert.match(text, /browser/)
  assert.match(text, /mcp__playwright__browser_navigate/)
  assert.match(text, /signature/)
  assert.match(text, /generatedAt/)
})

test('the panel shows an empty state, an unavailable state and a recoverable error', async () => {
  const { plugin } = await loadBundle()
  const { ctx, record } = clientContext()
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
