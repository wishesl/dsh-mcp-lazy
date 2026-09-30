import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { TYPERT } from '../lib/typert.host.js'

// Normalize line endings: a Windows checkout (core.autocrlf=true) delivers CRLF,
// which would break the multi-line bundle-patch assertion below.
const read = async (path) =>
  (await readFile(new URL(path, import.meta.url), 'utf8')).replace(/\r\n/g, '\n')

const pkg = JSON.parse(await read('../package.json'))
const lock = JSON.parse(await read('../package-lock.json'))
const bundlePatch = await read('../cordis.patch.yml')

test('package metadata publishes the installable bundle from the npm owner scope', () => {
  assert.equal(pkg.name, '@yilinxiao/dsh-mcp-lazy')
  assert.equal(pkg.version, '0.10.0')
  assert.equal(lock.version, '0.10.0')
  assert.equal(lock.packages[''].version, '0.10.0')
  assert.equal(pkg.repository.url, 'git+https://github.com/wishesl/dsh-mcp-lazy.git')
  assert.equal(pkg.homepage, 'https://github.com/wishesl/dsh-mcp-lazy#readme')
  assert.equal(pkg.bugs.url, 'https://github.com/wishesl/dsh-mcp-lazy/issues')
  assert.deepEqual(pkg.publishConfig, { access: 'public' })
  assert.deepEqual(pkg.dsh.bundle, { patch: './cordis.patch.yml' })
  // The browser half: a hand-written __ModuleLoader__ bundle served under
  // /plugins, plus the client packages that must be loaded before it.
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-api-remotes'), 'locate the Remote gateway owner')
  // The host half plus the two extra entry points the harness reads by export
  // name: the Typert manifest and the browser bundle.
  assert.equal(pkg.exports['.'], './lib/index.js')
  assert.equal(pkg.exports['./typert'], './lib/typert.host.js')
  assert.equal(pkg.exports['./client'], './lib/client.js')
  assert.ok(pkg.files.includes('cordis.patch.yml'))
  assert.match(bundlePatch, /name: '@yilinxiao\/dsh-mcp-lazy'/)
})

test('package metadata declares the whole supported DSH release corridor', () => {
  // The plugin runs against the 0.1.x line it was built on and the 0.2.x line
  // the current harness ships; a caret range on a 0.1 prerelease would exclude
  // 0.2.x entirely and misreport the supported corridor.
  //
  // `@deepseek-ai/dsh-typert-protocol` is deliberately NOT a peer: the settings
  // panel loads it with a dynamic import + feature detection, and declaring it
  // (even as an optional peer) makes npm fight dsh-agent's exact pin during the
  // compat job's plain `npm install`, which has no --legacy-peer-deps.
  for (const peer of ['@deepseek-ai/dsh-subprocess', '@deepseek-ai/dsh-tools']) {
    assert.equal(pkg.peerDependencies[peer], '>=0.1.0-rc.6 <0.3.0', peer)
    assert.equal(lock.packages[''].peerDependencies[peer], '>=0.1.0-rc.6 <0.3.0', peer)
    // The host owns these packages, so npm must not resolve or install them:
    // an optional peer keeps them out of the profile and out of this lock.
    assert.equal(pkg.peerDependenciesMeta[peer].optional, true, peer)
    assert.equal(lock.packages[''].peerDependenciesMeta[peer].optional, true, peer)
  }
  assert.equal(pkg.peerDependencies['@deepseek-ai/dsh-typert-protocol'], undefined)
})

test('the Typert manifest is owned by this package and carries strict codecs', () => {
  // Mirrors @deepseek-ai/dsh-typert-loader's validateTypertManifest /
  // requireInvocation rules; the dsh-compat job runs the real validator.
  //
  // `package` MUST be the real npm name (scope included): a manifest owned by
  // any other name is rejected, and the panel then 404s on every call — the bug
  // this assertion exists for.
  assert.equal(TYPERT.package, pkg.name)
  assert.equal(TYPERT.face, 'host')
  assert.ok(Array.isArray(TYPERT.schemas) && TYPERT.schemas.length === 0)
  assert.ok(Array.isArray(TYPERT.invocations) && TYPERT.invocations.length > 0)
  assert.deepEqual(Object.keys(TYPERT.model).sort(), ['events', 'objects', 'services'])
  const methods = []
  for (const invocation of TYPERT.invocations) {
    methods.push(invocation.method)
    for (const key of ['id', 'service', 'namespace', 'method']) {
      assert.equal(typeof invocation[key], 'string', `invocation.${key} must be a string`)
      assert.ok(invocation[key].length > 0, `invocation.${key} must not be empty`)
    }
    assert.equal(invocation.invocation.kind, 'direct')
    // Parameters mirror the loader's requireInvocation: unique wire names, an
    // explicit `json` source, and a strict codec of their own — the panel's two
    // write methods carry an argument, which the manifest must describe.
    const wires = new Set()
    for (const parameter of invocation.parameters) {
      assert.equal(typeof parameter.name, 'string', `invocation "${invocation.method}" parameter name must be a string`)
      assert.equal(typeof parameter.wire, 'string', `invocation "${invocation.method}" parameter wire must be a string`)
      assert.ok(!wires.has(parameter.wire), `invocation "${invocation.method}" repeats wire field "${parameter.wire}"`)
      wires.add(parameter.wire)
      assert.equal(parameter.source, 'json', `invocation "${invocation.method}" parameter source must be json`)
      assert.equal(parameter.lookup, undefined, `invocation "${invocation.method}" JSON parameter must not declare a lookup`)
      assert.equal(parameter.codec.mode, 'strict', `invocation "${invocation.method}" parameter codec must be strict`)
      assert.equal(typeof parameter.codec.typeSymbol, 'string')
      assert.equal(typeof parameter.codec.create().parse, 'function')
    }
    // The loader rejects anything but a strict codec; `src-json` is refused.
    assert.equal(invocation.result.mode, 'strict')
    assert.equal(typeof invocation.result.typeSymbol, 'string')
    assert.equal(typeof invocation.result.create, 'function')
    assert.equal(typeof invocation.result.create().parse, 'function')
    assert.equal(typeof invocation.sourceLocation.file, 'string')
    assert.ok(Number.isInteger(invocation.sourceLocation.line) && invocation.sourceLocation.line >= 1)
    assert.ok(Number.isInteger(invocation.sourceLocation.column) && invocation.sourceLocation.column >= 1)
  }
  // The panel reads the catalog, shows the injected prompt, and writes overrides.
  assert.deepEqual([...methods].sort(), ['resetProfile', 'saveProfile', 'snapshot'])
})

test('the write invocations accept a well-formed profile and reject a malformed one', () => {
  const save = TYPERT.invocations.find(invocation => invocation.method === 'saveProfile')
  const reset = TYPERT.invocations.find(invocation => invocation.method === 'resetProfile')
  const saveParse = save.parameters[0].codec.create().parse
  const resetParse = reset.parameters[0].codec.create().parse

  assert.deepEqual(saveParse({ serverName: 'playwright', description: '浏览器', keywords: ['浏览器'] }), {
    serverName: 'playwright',
    description: '浏览器',
    keywords: ['浏览器']
  })
  assert.deepEqual(saveParse({ serverName: 'playwright' }), { serverName: 'playwright', description: undefined, keywords: undefined })
  assert.throws(() => saveParse({ serverName: '' }), /serverName must be a non-empty string/)
  assert.throws(() => saveParse({ serverName: 'x', keywords: ['ok', 7] }), /every keyword must be a string/)
  assert.throws(() => saveParse(null), /input must be an object/)

  assert.deepEqual(resetParse({ serverName: 'tavily' }), { serverName: 'tavily' })
  assert.throws(() => resetParse({}), /serverName must be a non-empty string/)
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

