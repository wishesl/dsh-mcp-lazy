import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { STORE_DIR, STORE_FILE, STORE_VERSION, createProfileStore } from '../lib/profile-store.js'

/** A throwaway profile directory: what `resolveDirectory` hands the store. */
async function tempProfile() {
  const dir = await mkdtemp(join(tmpdir(), 'mcp-lazy-store-'))
  await writeFile(join(dir, 'package.json'), '{}\n')
  return dir
}

test('panel overrides are written atomically and reload from disk', async () => {
  const dir = await tempProfile()
  try {
    const store = createProfileStore({ resolveDirectory: () => dir })
    assert.equal(store.snapshot().persisted, true, 'an existing profile directory is writable')
    assert.equal(store.snapshot().file, join(dir, STORE_DIR, STORE_FILE))

    const saved = store.save('playwright', { description: '浏览器自动化', keywords: ['浏览器', '截图'] })
    assert.equal(saved.persisted, true)
    assert.deepEqual(saved.profile, { description: '浏览器自动化', keywords: ['浏览器', '截图'] })

    // Atomic write: the temp file must not survive next to the real one.
    const entries = await readdir(join(dir, STORE_DIR))
    assert.deepEqual(entries, [STORE_FILE])

    const raw = JSON.parse(await readFile(join(dir, STORE_DIR, STORE_FILE), 'utf8'))
    assert.equal(raw.version, STORE_VERSION)
    assert.deepEqual(raw.servers, { playwright: { description: '浏览器自动化', keywords: ['浏览器', '截图'] } })

    // A fresh store (the next DSH start) reads the same overrides back.
    const reopened = createProfileStore({ resolveDirectory: () => dir })
    assert.deepEqual(reopened.overrides(), { playwright: { description: '浏览器自动化', keywords: ['浏览器', '截图'] } })
    assert.equal(reopened.snapshot().persisted, true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('overrides are normalized and an empty profile drops the entry', async () => {
  const dir = await tempProfile()
  try {
    const store = createProfileStore({ resolveDirectory: () => dir })
    // Descriptions are folded onto one line (the index is a one-line list),
    // keywords are trimmed, deduped case-insensitively and capped.
    store.save('playwright', { description: '  浏览器\n自动化  ', keywords: [' 浏览器 ', '浏览器', '', '截图'] })
    assert.deepEqual(store.overrides().playwright, {
      description: '浏览器 自动化',
      keywords: ['浏览器', '截图']
    })

    // Clearing both fields removes the entry instead of storing an empty one.
    store.save('playwright', {})
    assert.deepEqual(store.overrides(), {})
    const raw = JSON.parse(await readFile(join(dir, STORE_DIR, STORE_FILE), 'utf8'))
    assert.deepEqual(raw.servers, {})
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('clear removes one server, is idempotent, and reports whether it wrote', async () => {
  const dir = await tempProfile()
  try {
    const store = createProfileStore({ resolveDirectory: () => dir })
    store.save('alpha', { description: 'a' })
    store.save('beta', { keywords: ['b'] })

    assert.deepEqual(store.clear('alpha'), {
      removed: true,
      persisted: true,
      file: join(dir, STORE_DIR, STORE_FILE),
      warning: null
    })
    assert.deepEqual(store.overrides(), { beta: { keywords: ['b'] } })

    const again = store.clear('alpha')
    assert.equal(again.removed, false)
    assert.equal(again.persisted, true)
    assert.deepEqual(store.overrides(), { beta: { keywords: ['b'] } })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a malformed store is reported and treated as empty instead of breaking the panel', async () => {
  const dir = await tempProfile()
  try {
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(join(dir, STORE_DIR), { recursive: true })
    writeFileSync(join(dir, STORE_DIR, STORE_FILE), '{"servers": not json', 'utf8')

    const warnings = []
    const store = createProfileStore({ resolveDirectory: () => dir, logger: { warn: (message) => warnings.push(message) } })
    assert.deepEqual(store.overrides(), {}, 'one bad write must not cost the user the plugin')
    assert.match(store.snapshot().warning, /cannot read/)
    assert.equal(warnings.length, 1)

    // The store keeps working: a save replaces the unusable file.
    store.save('alpha', { description: 'recovered' })
    assert.deepEqual(store.overrides(), { alpha: { description: 'recovered' } })
    const raw = JSON.parse(await readFile(join(dir, STORE_DIR, STORE_FILE), 'utf8'))
    assert.deepEqual(raw.servers, { alpha: { description: 'recovered' } })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a store with no profile directory stays in memory and says so', () => {
  const warnings = []
  const store = createProfileStore({ resolveDirectory: () => undefined, logger: { warn: (message) => warnings.push(message) } })

  const saved = store.save('playwright', { description: '会话内' })
  assert.equal(saved.persisted, false)
  assert.equal(saved.file, null)
  assert.match(saved.warning, /no profile directory/)
  // In-memory still works for this session, which is what the panel reports.
  assert.deepEqual(store.overrides(), { playwright: { description: '会话内' } })
  assert.equal(store.snapshot().persisted, false)
  assert.equal(store.snapshot().warning, saved.warning)
  assert.equal(warnings.length, 1, 'the same explanation is not repeated on every write')

  // A host that later publishes its directory starts persisting, without a restart.
  const late = createProfileStore({ resolveDirectory: () => undefined })
  assert.equal(late.snapshot().persisted, false)
})

test('a throwing or unusable anchor degrades instead of throwing', async () => {
  const throwing = createProfileStore({ resolveDirectory: () => { throw new Error('no anchor') } })
  assert.equal(throwing.snapshot().persisted, false)
  assert.deepEqual(throwing.overrides(), {})
  assert.equal(throwing.save('alpha', { description: 'x' }).persisted, false)

  // An anchor that resolves to a file cannot host the store: it never throws,
  // stays in memory, and reports why (Windows reports ENOENT here where POSIX
  // reports ENOTDIR — either way the panel must say "session only").
  const dir = await tempProfile()
  try {
    const fileAnchor = join(dir, 'package.json')
    const store = createProfileStore({ resolveDirectory: () => fileAnchor })
    assert.deepEqual(store.overrides(), {})
    const saved = store.save('alpha', { description: 'x' })
    assert.equal(saved.persisted, false)
    assert.match(String(saved.warning ?? ''), /cannot (read|write)/)
    assert.deepEqual(store.overrides(), { alpha: { description: 'x' } })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('an empty server name is refused', () => {
  const store = createProfileStore({ resolveDirectory: () => undefined })
  assert.throws(() => store.save('  ', { description: 'x' }), /serverName is required/)
  assert.throws(() => store.clear(''), /serverName is required/)
})
