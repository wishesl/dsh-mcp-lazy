import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildIndexText,
  buildServerViews,
  buildSnapshot,
  deriveKeywords,
  indexSignatureKey,
  splitTokens
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
