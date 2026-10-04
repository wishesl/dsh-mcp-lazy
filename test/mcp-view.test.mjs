import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MAX_OVERRIDE_DESCRIPTION_CHARS,
  MAX_OVERRIDE_KEYWORDS,
  buildIndexText,
  buildPanelSnapshot,
  buildServerViews,
  buildSnapshot,
  deriveKeywords,
  indexSignatureKey,
  mergeServerProfiles,
  normalizeProfile,
  resolveModelProfileEdits,
  routingHintsOf,
  splitTokens,
  withServerOverrides
} from '../lib/mcp-view.js'

const PLAYWRIGHT = {
  serverName: 'playwright',
  routingHints: [],
  getCatalog: () => [
    { name: 'mcp__playwright__browser_navigate', description: 'Navigate to a URL in the browser' },
    { name: 'mcp__playwright__browser_click', description: 'Perform click on a web page' },
    { name: 'mcp__playwright__browser_take_screenshot', description: 'Take a screenshot of the current page' }
  ]
}

const CHINESE_ONLY = {
  serverName: 'doc',
  routingHints: [],
  getCatalog: () => [
    { name: 'mcp__doc__read', description: '读取本地文档并返回纯文本' },
    { name: 'mcp__doc__search', description: '在文档库里按关键词检索' }
  ]
}

test('derives routing keywords from the MCP definition itself', () => {
  const keywords = deriveKeywords(PLAYWRIGHT)
  for (const expected of ['browser', 'navigate', 'click', 'screenshot', 'page']) {
    assert.ok(keywords.includes(expected), `missing keyword ${expected}: ${keywords.join(',')}`)
  }
  // The server name is the routing key already; it must not pollute the list.
  assert.ok(!keywords.includes('playwright'))
  assert.ok(!keywords.includes('mcp'))
})

test('CJK descriptions produce no keyword noise (aliases belong in serverProfiles)', () => {
  const keywords = deriveKeywords(CHINESE_ONLY)
  assert.deepEqual(keywords.filter(word => /[\u4e00-\u9fff]/.test(word)), [])
  assert.ok(keywords.includes('read'))
  assert.ok(keywords.includes('search'))
})

test('splitTokens strips the public MCP prefix and splits identifiers', () => {
  assert.deepEqual(splitTokens('mcp__chrome-devtools__take_snapshot'), ['take', 'snapshot'])
  assert.deepEqual(splitTokens(''), [])
})

test('serverProfiles override derived keywords and description', () => {
  const views = buildServerViews([PLAYWRIGHT], {
    serverProfiles: { playwright: { description: '浏览器操作：导航/点击/截图', keywords: ['浏览器', '网页'] } }
  })
  assert.equal(views.length, 1)
  assert.equal(views[0].description, '浏览器操作：导航/点击/截图')
  assert.deepEqual(views[0].keywords.slice(0, 2), ['浏览器', '网页'])
  assert.ok(views[0].keywords.includes('browser'))
})

test('caps keywords and truncates descriptions deterministically', () => {
  const views = buildServerViews([PLAYWRIGHT], { keywordsPerServer: 3, descriptionChars: 60 })
  assert.equal(views[0].keywords.length, 3)
  const longName = { serverName: 'x', routingHints: [], getCatalog: () => [{ name: 'mcp__x__t', description: 'y'.repeat(400) }] }
  const truncated = buildServerViews([longName])[0].tools[0].description
  assert.ok(truncated.length <= 300)
  assert.ok(truncated.endsWith('…'))
})

test('index text lists servers with counts and keywords, and is byte-stable', () => {
  const config = { promptIndexLocale: 'zh', keywordsPerServer: 4 }
  const first = buildIndexText(buildServerViews([PLAYWRIGHT], config), config)
  const second = buildIndexText(buildServerViews([PLAYWRIGHT], config), config)
  assert.equal(first, second)
  assert.match(first, /## MCP 服务器（按需加载）/)
  assert.match(first, /mcp__router__search_and_activate/)
  assert.match(first, /披露后本次会话内一直可直接调用/)
  assert.match(first, /- playwright（3 个工具）: /)
  assert.equal(indexSignatureKey('sig-a', config), indexSignatureKey('sig-a', config))
  assert.notEqual(indexSignatureKey('sig-a', config), indexSignatureKey('sig-b', config))
})

test('index text is empty for an empty catalog and reports omitted servers', () => {
  assert.equal(buildIndexText([], {}), '')
  const config = { maxServers: 1 }
  const text = buildIndexText(buildServerViews([PLAYWRIGHT, CHINESE_ONLY], config), config)
  assert.match(text, /另有 1 个服务器未列出/)
  const english = buildIndexText(buildServerViews([PLAYWRIGHT], { promptIndexLocale: 'en' }), { promptIndexLocale: 'en' })
  assert.match(english, /## MCP servers \(loaded on demand\)/)
  assert.match(english, /stays callable for the rest of the session/)
})

test('snapshot caps tool payload and keeps passthrough names sorted', () => {
  const catalog = {
    signature: 'sig-1',
    entries: [PLAYWRIGHT, CHINESE_ONLY],
    passthrough: ['mcp__zeta__x', 'mcp__alpha__y']
  }
  const snapshot = buildSnapshot(catalog, { maxSnapshotTools: 3 }, 1700000000000)
  assert.equal(snapshot.serverCount, 2)
  assert.equal(snapshot.toolCount, 5)
  assert.equal(snapshot.servers.reduce((total, server) => total + server.tools.length, 0), 3)
  assert.equal(snapshot.omittedTools, 2)
  assert.deepEqual(snapshot.passthrough.map(entry => entry.name), ['mcp__alpha__y', 'mcp__zeta__x'])
  assert.equal(snapshot.generatedAt, 1700000000000)
  assert.equal(snapshot.routerTool, 'mcp__router__search_and_activate')
})

test('normalizeProfile keeps only what the injected index can render', () => {
  // One line per server: a multi-line description would break the list.
  assert.deepEqual(normalizeProfile({ description: '  第一行\n第二行\t  ' }), { description: '第一行 第二行' })
  assert.deepEqual(normalizeProfile({ keywords: [' 浏览器 ', '浏览器', '', '  ', '截图'] }), { keywords: ['浏览器', '截图'] })
  // Non-strings, empty boxes and wrong shapes mean "no override", not an error.
  assert.equal(normalizeProfile({ description: '   ', keywords: [] }), undefined)
  assert.equal(normalizeProfile({ keywords: [7, null] }), undefined)
  assert.equal(normalizeProfile(null), undefined)
  assert.equal(normalizeProfile('nope'), undefined)
  assert.equal(normalizeProfile([]), undefined)
  // Bounds are enforced here, so the store and the config cannot inject junk.
  const long = normalizeProfile({ description: 'x'.repeat(MAX_OVERRIDE_DESCRIPTION_CHARS + 50) })
  assert.equal(long.description.length, MAX_OVERRIDE_DESCRIPTION_CHARS)
  const many = normalizeProfile({ keywords: Array.from({ length: MAX_OVERRIDE_KEYWORDS + 10 }, (_, index) => `k${index}`) })
  assert.equal(many.keywords.length, MAX_OVERRIDE_KEYWORDS)
})

test('mergeServerProfiles prefers the config per field and names the winner', () => {
  const config = { playwright: { description: '来自 YAML' } }
  const store = { playwright: { description: '来自面板', keywords: ['浏览器'] }, tavily: { keywords: ['搜索'] } }
  const merged = mergeServerProfiles(config, store)

  // The hand-written YAML wins the field it sets; the panel keeps the one it owns.
  assert.deepEqual(merged.profiles.playwright, { description: '来自 YAML', keywords: ['浏览器'] })
  assert.deepEqual(merged.origins.playwright, { description: 'config', keywords: 'custom', pinned: null })
  // A server only the panel knows about is still an override, and vice versa.
  assert.deepEqual(merged.profiles.tavily, { keywords: ['搜索'] })
  assert.deepEqual(merged.origins.tavily, { description: null, keywords: 'custom', pinned: null })
  // Normalization runs on both writers: a blank config entry never wins.
  assert.deepEqual(mergeServerProfiles({ x: { description: '  ' } }, { x: { description: '面板' } }).origins.x, {
    description: 'custom',
    keywords: null,
    pinned: null
  })
})

test('withServerOverrides feeds the panel view and the injected index', () => {
  const config = { keywordsPerServer: 8 }
  const store = { playwright: { description: '浏览器自动化：导航/点击', keywords: ['浏览器', '网页自动化'] } }
  const effective = withServerOverrides(config, store)
  const server = buildServerViews([PLAYWRIGHT], effective)[0]

  assert.equal(server.description, '浏览器自动化：导航/点击')
  assert.deepEqual(server.keywords.slice(0, 2), ['浏览器', '网页自动化'])
  assert.ok(server.keywords.includes('browser'), 'derived keywords stay as the fallback tail')
  // The editor is fed the effective override, never the capped/derived list.
  assert.deepEqual(server.override, { description: '浏览器自动化：导航/点击', keywords: ['浏览器', '网页自动化'], pinned: false })
  assert.deepEqual(server.overrideSource, { description: 'custom', keywords: 'custom', pinned: null })

  const text = buildIndexText([server], effective)
  assert.match(text, /浏览器自动化：导航\/点击/)
  assert.match(text, /关键词：浏览器, 网页自动化/)
  // A save changes the memo key, so the next assembly cannot reuse stale bytes.
  const savedKey = indexSignatureKey('sig-1', withServerOverrides(config, store))
  const otherKey = indexSignatureKey('sig-1', withServerOverrides(config, { playwright: { description: '改了' } }))
  assert.notEqual(savedKey, otherKey)
})

test('routingHintsOf accepts a live source, plain arrays, and filters junk', () => {
  assert.deepEqual(routingHintsOf({ routingHints: ['a', 7, 'b'] }), ['a', 'b'])
  let hints = ['第一次']
  const live = { routingHints: () => hints }
  assert.deepEqual(routingHintsOf(live), ['第一次'])
  // The point of the function shape: a later edit is visible without a restart.
  hints = ['改了']
  assert.deepEqual(routingHintsOf(live), ['改了'])
  assert.deepEqual(routingHintsOf({ routingHints: () => 'nope' }), [])
  assert.deepEqual(routingHintsOf({}), [])
  // Keyword *derivation* stays ASCII-only by design (aliases belong in the panel
  // or in serverProfiles — see the CJK test above), while an ASCII hint does
  // contribute. The router scores the raw hint text either way, which is what
  // makes an authored Chinese alias route on the real host (compat lane).
  const derived = deriveKeywords({ ...PLAYWRIGHT, routingHints: () => ['浏览器', 'websocket'] })
  assert.deepEqual(derived.filter(word => /[\u4e00-\u9fff]/.test(word)), [])
  assert.ok(derived.includes('websocket'))
})

test('the snapshot carries the injected prompt verbatim and the store state', () => {
  const surfaces = {
    promptIndex: {
      enabled: true,
      channel: 'context',
      name: 'mcp-lazy:index',
      order: 130,
      locale: 'zh',
      reason: '',
      text: '## MCP 服务器（按需加载）\n\n- playwright（3 个工具）: browser'
    },
    store: { persisted: true, file: 'C:\\p\\.dsh-mcp-lazy\\profiles.json', warning: null }
  }
  const catalog = { signature: 'sig-1', entries: [PLAYWRIGHT], passthrough: [] }
  const snapshot = buildSnapshot(catalog, {}, 1700000000000, surfaces)
  // Byte-for-byte: the panel shows the artifact, not a re-derivation of it.
  assert.equal(snapshot.promptIndex.text, surfaces.promptIndex.text)
  assert.equal(snapshot.promptIndex.order, 130)
  assert.equal(snapshot.promptIndex.channel, 'context')
  assert.deepEqual(snapshot.store, surfaces.store)
  assert.deepEqual(snapshot.servers[0].override, { description: null, keywords: null, pinned: false })
  assert.deepEqual(snapshot.servers[0].overrideSource, { description: null, keywords: null, pinned: null })

  // Without a live surface the snapshot still answers the panel's questions.
  const bare = buildSnapshot(catalog)
  assert.equal(bare.promptIndex.enabled, false)
  assert.equal(bare.promptIndex.channel, 'none')
  assert.equal(bare.promptIndex.reason, 'unavailable')
  assert.equal(bare.promptIndex.text, '')
  assert.equal(bare.store.persisted, false)
})

test('the panel payload reports availability instead of an empty list', () => {
  const catalog = { signature: 'sig-1', entries: [PLAYWRIGHT], passthrough: [] }
  assert.equal(buildPanelSnapshot(catalog, {}, 1700000000000).available, true)
  // A host whose universal manager never installed: an explanation, not "no MCP".
  assert.equal(buildPanelSnapshot({ signature: 'empty', entries: [], passthrough: [] }, {}).available, false)
  // An installed manager that admitted nothing is still a working service: the
  // panel then says "no takeover-eligible MCP server found", not "unavailable".
  assert.equal(buildPanelSnapshot({ signature: 'manager:0', entries: [], passthrough: [] }, {}).available, true)
})

test('the model-edit switch resolves config over panel over the built-in default', () => {
  // Nothing set: on, and the panel says the default decided.
  assert.deepEqual(resolveModelProfileEdits({}, {}), { enabled: true, source: 'default' })
  // The panel switch alone.
  assert.deepEqual(resolveModelProfileEdits({}, { modelProfileEdits: false }), { enabled: false, source: 'panel' })
  assert.deepEqual(resolveModelProfileEdits({}, { modelProfileEdits: true }), { enabled: true, source: 'panel' })
  // A hand-written config key is an operator statement and wins both ways.
  assert.deepEqual(
    resolveModelProfileEdits({ modelProfileEdits: true }, { modelProfileEdits: false }),
    { enabled: true, source: 'config' }
  )
  assert.deepEqual(
    resolveModelProfileEdits({ modelProfileEdits: false }, { modelProfileEdits: true }),
    { enabled: false, source: 'config' }
  )
  // Junk in either source never turns the switch off by accident.
  assert.deepEqual(resolveModelProfileEdits({ modelProfileEdits: 'no' }, { modelProfileEdits: 1 }), { enabled: true, source: 'default' })
})

test('the snapshot carries the effective model-edit switch for the panel', () => {
  const catalog = { signature: 'sig-1', entries: [PLAYWRIGHT], passthrough: [] }
  assert.deepEqual(buildSnapshot(catalog).modelProfileEdits, { enabled: true, source: 'default' })
  assert.deepEqual(
    buildSnapshot(catalog, {}, 0, { modelProfileEdits: { enabled: false, source: 'config' } }).modelProfileEdits,
    { enabled: false, source: 'config' }
  )
})
