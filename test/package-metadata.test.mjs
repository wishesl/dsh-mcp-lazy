import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// Normalize line endings: a Windows checkout (core.autocrlf=true) delivers CRLF,
// which would break the multi-line bundle-patch assertion below.
const read = async (path) =>
  (await readFile(new URL(path, import.meta.url), 'utf8')).replace(/\r\n/g, '\n')

const pkg = JSON.parse(await read('../package.json'))
const lock = JSON.parse(await read('../package-lock.json'))
const bundlePatch = await read('../cordis.patch.yml')

test('package metadata publishes the installable bundle from the npm owner scope', () => {
  assert.equal(pkg.name, '@yilinxiao/dsh-mcp-lazy')
  assert.equal(pkg.version, '0.6.0')
  assert.equal(lock.version, '0.6.0')
  assert.equal(lock.packages[''].version, '0.6.0')
  assert.equal(pkg.repository.url, 'git+https://github.com/wishesl/dsh-mcp-lazy.git')
  assert.equal(pkg.homepage, 'https://github.com/wishesl/dsh-mcp-lazy#readme')
  assert.equal(pkg.bugs.url, 'https://github.com/wishesl/dsh-mcp-lazy/issues')
  assert.deepEqual(pkg.publishConfig, { access: 'public' })
  assert.deepEqual(pkg.dsh, { bundle: { patch: './cordis.patch.yml' } })
  assert.ok(pkg.files.includes('cordis.patch.yml'))
  assert.match(bundlePatch, /name: '@yilinxiao\/dsh-mcp-lazy'/)
})

test('package metadata declares the whole supported DSH release corridor', () => {
  // The plugin runs against the 0.1.x line it was built on and the 0.2.x line
  // the current harness ships; a caret range on a 0.1 prerelease would exclude
  // 0.2.x entirely and misreport the supported corridor.
  for (const peer of ['@deepseek-ai/dsh-subprocess', '@deepseek-ai/dsh-tools']) {
    assert.equal(pkg.peerDependencies[peer], '>=0.1.0-rc.6 <0.3.0', peer)
    assert.equal(lock.packages[''].peerDependencies[peer], '>=0.1.0-rc.6 <0.3.0', peer)
    // The host owns these packages, so npm must not resolve or install them:
    // an optional peer keeps them out of the profile and out of this lock.
    assert.equal(pkg.peerDependenciesMeta[peer].optional, true, peer)
    assert.equal(lock.packages[''].peerDependenciesMeta[peer].optional, true, peer)
  }
})

test('package discovery metadata exposes the MCP token-saving use case', () => {
  assert.match(pkg.description, /MCP lazy-loading/i)
  assert.match(pkg.description, /context bloat/i)
  assert.match(pkg.description, /save tokens/i)
  assert.match(pkg.description, /progressive disclosure/i)
  for (const keyword of [
    'token-saving',
    'token-savings',
    'context-optimization',
    'tool-schema',
    'tool-router',
    'mcp-router',
    'on-demand-tools',
    'progressive-disclosure',
  ]) {
    assert.ok(pkg.keywords.includes(keyword), `missing npm discovery keyword: ${keyword}`)
  }
})
