import assert from 'node:assert/strict'
import test from 'node:test'

import { MCP_LAZY_PACKAGE } from '../lib/wire.js'

// The settings shell has no icon slot for third-party sections (`settings.section`
// projects only `id` / `order` / `label`, and the nav glyph is hardcoded per
// section id with a generic gear as the fallback), so the browser half claims its
// own nav row and draws its own mark. This file locks that behaviour with a fake
// DOM + fake MutationObserver, the same way the launcher plugin's own harness does.
const BUNDLE_URL = new URL('../lib/client.js', import.meta.url).href
const MARKER = 'data-dsh-mcp-lazy-nav-icon'
const ROW_SELECTOR = '[role="dialog"] nav button'
const NAV_CSS_TAG_ID = `${MCP_LAZY_PACKAGE}/nav-icon.css`

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

let cachedBundle
async function loadBundle() {
  if (cachedBundle !== undefined) return cachedBundle
  let definition
  globalThis.window = { __ModuleLoader__: { load: (value) => { definition = value } } }
  await import(BUNDLE_URL)
  assert.ok(definition, 'the bundle must register one __ModuleLoader__ definition')
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

/** A nav row: only the surface the feature is allowed to touch. */
function fakeRow(text) {
  const attributes = new Map()
  return {
    textContent: text,
    setAttribute: (name, value) => attributes.set(name, String(value)),
    removeAttribute: (name) => attributes.delete(name),
    hasAttribute: (name) => attributes.has(name),
    getAttribute: (name) => (attributes.has(name) ? attributes.get(name) : null)
  }
}

/**
 * Fake document: a settings dialog `<nav>` with the given rows, plus the style
 * tags the bundle injects. `createElement` only ever receives `style` here.
 */
function fakeDom(rowTexts) {
  const rows = rowTexts.map(fakeRow)
  const styleTags = []
  const doc = {
    head: {
      appendChild(tag) {
        tag.parentNode = doc.head
        styleTags.push(tag)
      },
      removeChild(tag) {
        const index = styleTags.indexOf(tag)
        if (index >= 0) styleTags.splice(index, 1)
      }
    },
    body: {},
    getElementById: () => null,
    createElement: () => {
      const tag = {
        className: '',
        dataset: {},
        textContent: '',
        parentNode: null,
        remove() {
          if (tag.parentNode !== null) tag.parentNode.removeChild(tag)
        }
      }
      return tag
    },
    querySelectorAll(selector) {
      if (selector === ROW_SELECTOR) return rows
      if (selector === `[${MARKER}]`) return rows.filter((row) => row.hasAttribute(MARKER))
      return []
    }
  }
  return { doc, rows, styleTags }
}

/** Fake MutationObserver: records the callback and the observe target. */
function fakeObserver() {
  const instances = []
  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback
      this.disconnected = false
      this.target = undefined
      this.options = undefined
      instances.push(this)
    }

    observe(target, options) {
      this.target = target
      this.options = options
    }

    disconnect() {
      this.disconnected = true
    }
  }
  return { FakeMutationObserver, instances }
}

/**
 * Client context double. `state.navLabel` is read through the bound `t()` on
 * every sync, exactly like the locale service does, so a locale switch can be
 * simulated by mutating it.
 */
function clientContext({ navLabel = 'MCP 管理' } = {}) {
  const state = { navLabel }
  const record = { dictionaries: [], mounted: undefined, injected: undefined, registration: undefined, effectLabels: [], disposers: [] }
  const ctx = {
    effect: (factory, label) => {
      record.effectLabels.push(label)
      const dispose = factory()
      const disposer = typeof dispose === 'function' ? dispose : () => {}
      record.disposers.push(disposer)
      return disposer
    },
    locale: {
      register: (ns, dictionaries) => {
        record.dictionaries.push([ns, dictionaries])
        return () => {}
      },
      bind: (ns) => (key) => (key === 'nav' ? state.navLabel : `${ns}:${key}`)
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
        remote: { mcpLazy: { snapshot: async () => undefined } },
        slots: {
          inject: (slot, available) => available(),
          register: (options, component) => {
            record.registration = options
            record.panel = component
            return () => {}
          }
        }
      })
    }
  }
  return { ctx, record, state }
}

/** Let the coalescing queueMicrotask land. */
const tick = () => new Promise((resolve) => setImmediate(resolve))

/** Run `body` with `document` / `MutationObserver` installed, then restore. */
async function withDom({ document, MutationObserver }, body) {
  const hadDocument = 'document' in globalThis
  const hadObserver = 'MutationObserver' in globalThis
  const previousDocument = globalThis.document
  const previousObserver = globalThis.MutationObserver
  if (document !== undefined) globalThis.document = document
  if (MutationObserver !== undefined) globalThis.MutationObserver = MutationObserver
  try {
    return await body()
  } finally {
    if (hadDocument) globalThis.document = previousDocument
    else delete globalThis.document
    if (hadObserver) globalThis.MutationObserver = previousObserver
    else delete globalThis.MutationObserver
  }
}

const marked = (rows) => rows.filter((row) => row.hasAttribute(MARKER))

test('claims exactly its own nav row and injects the mask stylesheet', async () => {
  const { plugin } = await loadBundle()
  const dom = fakeDom(['账号', 'MCP 管理', '插件'])
  const { FakeMutationObserver, instances } = fakeObserver()
  await withDom({ document: dom.doc, MutationObserver: FakeMutationObserver }, async () => {
    const { ctx, record } = clientContext()
    await plugin.apply(ctx)

    // ① 只认领文本等于自己 label 的那一行，别的行一根手指都不碰。
    assert.equal(marked(dom.rows).length, 1)
    assert.equal(dom.rows[1].getAttribute(MARKER), '')
    assert.equal(dom.rows[0].hasAttribute(MARKER), false)
    assert.equal(dom.rows[2].hasAttribute(MARKER), false)

    // ② 认领 CSS 是一个独立、可辨认的 <style>（随 effect 装卸）。
    const navTag = dom.styleTags.find((tag) => tag.dataset.pluginCss === NAV_CSS_TAG_ID)
    assert.ok(navTag, `a <style data-plugin-css="${NAV_CSS_TAG_ID}"> must be injected`)
    assert.equal(navTag.dataset.plugin, MCP_LAZY_PACKAGE)
    const css = navTag.textContent
    assert.ok(css.includes(`[${MARKER}] > svg{display:none}`), 'the shell gear must be hidden')
    assert.ok(css.includes('background-color:currentColor'), 'the mark must follow the theme colour')
    assert.ok(css.includes(`mask-image:url("data:image/svg+xml,`), 'the mark must be an inline mask, not a bitmap')
    assert.ok(css.includes(`-webkit-mask-size:16px 16px`), 'the mark must be 16px, like the shell icons')

    // ③ 一个观察者，盯 body（覆盖重渲染与切语言）。
    assert.equal(instances.length, 1)
    assert.equal(instances[0].target, dom.doc.body)
    assert.deepEqual(instances[0].options, { childList: true, subtree: true, characterData: true })

    // effect 标签只多这一条，别的东西没被顺带改掉。
    assert.ok(record.effectLabels.includes('dsh-mcp-lazy: settings nav icon'))
    assert.equal(record.registration.id, 'mcp-lazy')
  })
})

test('re-claims the row after a locale switch, through the coalescing observer', async () => {
  const { plugin } = await loadBundle()
  const dom = fakeDom(['账号', 'MCP 管理', '插件'])
  const { FakeMutationObserver, instances } = fakeObserver()
  await withDom({ document: dom.doc, MutationObserver: FakeMutationObserver }, async () => {
    const { ctx, state } = clientContext({ navLabel: 'MCP 管理' })
    await plugin.apply(ctx)
    assert.equal(marked(dom.rows)[0], dom.rows[1])

    // 语言切成英文：我们那一行的文本跟着 label 变，而另一行恰好戴着旧文案 ——
    // 标记必须跟着**当前** label 走，旧的那一行要被摘掉。
    state.navLabel = 'MCP servers'
    dom.rows[0].textContent = 'MCP 管理'
    dom.rows[1].textContent = 'MCP servers'
    instances[0].callback()
    await tick()

    assert.equal(marked(dom.rows).length, 1)
    assert.equal(dom.rows[1].getAttribute(MARKER), '')
    assert.equal(dom.rows[0].hasAttribute(MARKER), false, 'a stale label must never keep the claim')
  })
})

test('a locale that has not resolved yet claims nothing, even after a previous claim', async () => {
  const { plugin } = await loadBundle()
  const dom = fakeDom(['账号', 'MCP 管理', '插件'])
  const { FakeMutationObserver, instances } = fakeObserver()
  await withDom({ document: dom.doc, MutationObserver: FakeMutationObserver }, async () => {
    const { ctx, state } = clientContext({ navLabel: 'MCP 管理' })
    await plugin.apply(ctx)
    assert.equal(marked(dom.rows).length, 1)

    state.navLabel = ''
    instances[0].callback()
    await tick()

    assert.equal(marked(dom.rows).length, 0, 'an empty label must never mark a row')
  })
})

test('the disposer strips the marker, the stylesheet and the observer', async () => {
  const { plugin } = await loadBundle()
  const dom = fakeDom(['账号', 'MCP 管理', '插件'])
  const { FakeMutationObserver, instances } = fakeObserver()
  await withDom({ document: dom.doc, MutationObserver: FakeMutationObserver }, async () => {
    const { ctx, record } = clientContext()
    await plugin.apply(ctx)
    const navTag = dom.styleTags.find((tag) => tag.dataset.pluginCss === NAV_CSS_TAG_ID)
    assert.ok(navTag)

    for (const dispose of record.disposers) dispose()

    assert.equal(marked(dom.rows).length, 0, 'markers must be removed with the fiber')
    assert.equal(dom.styleTags.includes(navTag), false, 'the nav stylesheet must be removed with the fiber')
    assert.equal(instances[0].disconnected, true, 'the observer must be disconnected')
  })
})

test('without a document the bundle stays inert, and without MutationObserver it still claims once', async () => {
  const { plugin } = await loadBundle()

  // ① 没有 document（Node 侧 harness）：apply 正常，一个导航 effect 都不注册。
  const inert = clientContext()
  await plugin.apply(inert.ctx)
  assert.equal(inert.record.effectLabels.includes('dsh-mcp-lazy: settings nav icon'), false)
  assert.equal(inert.record.registration.id, 'mcp-lazy')

  // ② 有 document 但没有 MutationObserver / body：认领一次，不抛错。
  const dom = fakeDom(['账号', 'MCP 管理'])
  dom.doc.body = null
  await withDom({ document: dom.doc, MutationObserver: undefined }, async () => {
    const { ctx, record } = clientContext()
    await plugin.apply(ctx)
    assert.equal(marked(dom.rows).length, 1)
    // effect 里没有可观察的 body：仍然要有可清理的 disposer，且不得抛错。
    for (const dispose of record.disposers) assert.doesNotThrow(dispose)
  })
})
