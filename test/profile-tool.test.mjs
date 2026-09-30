import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { STORE_DIR, STORE_FILE, createProfileStore } from '../lib/profile-store.js'
import { DESCRIBE_TOOL_NAME, createDescribeTool } from '../lib/profile-tool.js'

/** A throwaway profile directory: what `resolveDirectory` hands the store. */
async function tempProfile() {
  const dir = await mkdtemp(join(tmpdir(), 'mcp-lazy-tool-'))
  await writeFile(join(dir, 'package.json'), '{}\n')
  return dir
}

const CATALOG = {
  entries: [{ serverName: 'playwright' }, { serverName: 'tavily' }],
  passthrough: [],
  signature: 'fixture'
}

function build({ dir, catalog = CATALOG, view = {}, logger } = {}) {
  const store = createProfileStore({ resolveDirectory: () => dir, logger })
  let requeues = 0
  const tool = createDescribeTool({
    store,
    readCatalog: () => catalog,
    readView: () => view,
    requeue: () => { requeues += 1; return requeues },
    logger
  })
  return { store, tool, requeues: () => requeues }
}

const textOf = async (instance, args) => (await instance.tool.execute(args)).content[0].text

test('the describe tool exposes only the text fields — never the visibility switch', () => {
  const tool = createDescribeTool({ store: { merge: () => {} } })
  assert.equal(tool.name, DESCRIBE_TOOL_NAME)
  assert.deepEqual(Object.keys(tool.parameters.properties).sort(), ['description', 'keywords', 'serverName'])
  assert.deepEqual(tool.parameters.required, ['serverName', 'description'])
  assert.equal(tool.parameters.additionalProperties, false)
  // A model that never learns about 常驻 cannot move a server in or out of management.
  assert.equal(Object.hasOwn(tool.parameters.properties, 'pinned'), false)
})

test('the describe tool is not offered without a writable store', () => {
  assert.equal(createDescribeTool({}), undefined)
  assert.equal(createDescribeTool({ store: { overrides: () => ({}) } }), undefined)
})

test('a describe write lands in the state file, keeps the existing pin, and re-queues the index', async () => {
  const dir = await tempProfile()
  try {
    const instance = build({ dir })
    instance.store.save('tavily', { pinned: true })

    const text = await textOf(instance, {
      serverName: 'tavily',
      description: '联网检索与研究：搜索、抽取、爬站、站点地图',
      keywords: ['塔维利', '联网搜索']
    })
    assert.match(text, /已写入描述/)
    assert.match(text, /已写入 2 个关键词/)
    assert.match(text, /已落盘/)
    assert.equal(instance.requeues(), 1, 'the injected index must follow the write')

    // The crux: a whole-object save would have dropped `pinned` and hidden the
    // server's tools; the merge path must not.
    const raw = JSON.parse(await readFile(join(dir, STORE_DIR, STORE_FILE), 'utf8'))
    assert.deepEqual(raw.servers, {
      tavily: {
        pinned: true,
        description: '联网检索与研究：搜索、抽取、爬站、站点地图',
        keywords: ['塔维利', '联网搜索']
      }
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('an unknown server is refused with the managed names as candidates, writing nothing', async () => {
  const dir = await tempProfile()
  try {
    const instance = build({ dir })
    const text = await textOf(instance, { serverName: 'playwrite', description: '浏览器' })
    assert.match(text, /未写入：没有名为 "playwrite" 的受管服务器/)
    assert.match(text, /playwright/)
    assert.match(text, /tavily/)
    assert.deepEqual(instance.store.overrides(), {})
    assert.equal(instance.requeues(), 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('an empty managed catalog is reported instead of inventing an entry', async () => {
  const dir = await tempProfile()
  try {
    const instance = build({ dir, catalog: { entries: [], passthrough: [], signature: 'empty' } })
    const text = await textOf(instance, { serverName: 'tavily', description: '联网检索' })
    assert.match(text, /当前没有受管的 MCP 服务器/)
    assert.deepEqual(instance.store.overrides(), {})
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a field pinned by serverProfiles is reported as ineffective', async () => {
  const dir = await tempProfile()
  try {
    const instance = build({
      dir,
      view: {
        serverProfiles: { tavily: { description: '配置文件里的说明' } },
        overlayOrigins: { tavily: { description: 'config' } }
      }
    })
    const text = await textOf(instance, { serverName: 'tavily', description: '模型写的说明' })
    assert.match(text, /description 由 cordis\.patch\.yml 的 serverProfiles 固定，本次写入不会生效/)
    // Keywords are not pinned, so no note should claim they were ignored.
    assert.doesNotMatch(text, /keywords 由 cordis/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a resident server is flagged: the text is saved but stays out of the index', async () => {
  const dir = await tempProfile()
  try {
    const instance = build({ dir, view: { serverProfiles: { tavily: { pinned: true } } } })
    const text = await textOf(instance, { serverName: 'tavily', description: '联网检索' })
    assert.match(text, /该服务器当前是常驻/)
    assert.equal(instance.store.overrides().tavily.pinned, undefined, 'the tool never writes a pin')
    assert.equal(instance.store.overrides().tavily.description, '联网检索')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a host without a profile directory reports session-only instead of pretending', async () => {
  const instance = build({})
  const text = await textOf(instance, { serverName: 'tavily', description: '联网检索' })
  assert.match(text, /未能写入磁盘，仅本会话内存有效/)
  assert.equal(instance.store.overrides().tavily.description, '联网检索')
})

test('keywords beyond the cap are reported as truncated, not silently dropped', async () => {
  const dir = await tempProfile()
  try {
    const instance = build({ dir })
    const keywords = Array.from({ length: 30 }, (_, index) => `关键词${index + 1}`)
    const text = await textOf(instance, { serverName: 'tavily', description: '联网检索', keywords })
    assert.match(text, /实际保留 24 个/)
    assert.equal(instance.store.overrides().tavily.keywords.length, 24)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('clearing both text fields removes the override and says so', async () => {
  const dir = await tempProfile()
  try {
    const instance = build({ dir })
    instance.store.save('tavily', { description: '旧的说明', keywords: ['旧词'] })

    const text = await textOf(instance, { serverName: 'tavily', description: '', keywords: [] })
    assert.match(text, /已清除 "tavily" 的自定义描述与关键词/)
    assert.deepEqual(instance.store.overrides(), {})
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a wrong-typed field reads as a refusal, not as a silent no-op', async () => {
  const dir = await tempProfile()
  try {
    const instance = build({ dir })
    assert.match(await textOf(instance, { serverName: 'tavily', description: 42 }), /未写入：description 需要字符串/)
    assert.match(await textOf(instance, { serverName: 'tavily', description: 'ok', keywords: '回声' }), /未写入：keywords 需要字符串数组/)
    assert.deepEqual(instance.store.overrides(), {})
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('an unexpected write failure is returned as text instead of breaking the turn', async () => {
  const warnings = []
  const tool = createDescribeTool({
    store: {
      merge() { throw new Error('disk on fire') }
    },
    readCatalog: () => CATALOG,
    readView: () => ({}),
    logger: { warn: (message) => warnings.push(message) }
  })
  const text = (await tool.execute({ serverName: 'tavily', description: '联网检索' })).content[0].text
  assert.match(text, /未写入：disk on fire/)
  assert.equal(warnings.length, 1)
})
