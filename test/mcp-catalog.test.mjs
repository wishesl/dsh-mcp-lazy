import assert from 'node:assert/strict'
import test from 'node:test'

import { buildMcpCatalog, parseMcpPublicName } from '../lib/mcp-catalog.js'

test('parses only exact DSH MCP public names', () => {
  assert.deepEqual(parseMcpPublicName('mcp__context7__query_docs'), {
    serverName: 'context7',
    toolName: 'query_docs'
  })
  for (const name of ['read_file', 'mcp_context7_query', 'mcp____query', 'mcp__bad name__query']) {
    assert.equal(parseMcpPublicName(name), undefined)
  }
})

test('admits resolved namespaces and leaves unresolved names passthrough, skipping owned tools', () => {
  const definitions = new Map([
    ['mcp__alpha__one', { name: 'mcp__alpha__one' }],
    ['mcp__router__search_and_activate', { name: 'mcp__router__search_and_activate' }]
  ])
  const catalog = buildMcpCatalog({
    schemas: [
      { name: 'mcp__alpha__one', description: 'alpha one' },
      { name: 'mcp__broken__ghost', description: 'missing definition' },
      { name: 'mcp__router__search_and_activate', description: 'router' },
      { name: 'mcp__router__describe_server', description: 'write tool' },
      { name: 'ordinary', description: 'ordinary tool' }
    ],
    getDefinition: name => definitions.get(name),
    ownedNames: ['mcp__router__search_and_activate', 'mcp__router__describe_server']
  })
  assert.deepEqual([...catalog.servers.keys()], ['alpha'])
  assert.deepEqual([...catalog.passthrough], ['mcp__broken__ghost'])
  assert.deepEqual(catalog.servers.get('alpha').toolNames, ['mcp__alpha__one'])
})

test('a real MCP server named router is still managed when only the owned names are skipped', () => {
  const catalog = buildMcpCatalog({
    schemas: [
      { name: 'mcp__router__search_and_activate', description: 'owned router' },
      { name: 'mcp__router__lookup', description: 'a real server tool' }
    ],
    getDefinition: name => ({ name }),
    ownedNames: ['mcp__router__search_and_activate']
  })
  assert.deepEqual([...catalog.servers.keys()], ['router'])
  assert.deepEqual(catalog.servers.get('router').toolNames, ['mcp__router__lookup'])
})

test('keeps case-distinct servers and produces an immutable catalog snapshot', () => {
  const schemas = [
    { name: 'mcp__Foo__one', description: 'before', parameters: { type: 'object' } },
    { name: 'mcp__foo__two', description: 'lower' }
  ]
  const catalog = buildMcpCatalog({ schemas, getDefinition: name => ({ name }), ownedNames: ['router'] })
  assert.notEqual(catalog.servers.get('Foo'), catalog.servers.get('foo'))
  const before = catalog.signature
  schemas[0].description = 'after'
  schemas[0].parameters.type = 'string'
  assert.equal(catalog.signature, before)
  assert.deepEqual(catalog.servers.get('Foo').getCatalog(), [
    { name: 'mcp__Foo__one', description: 'before' }
  ])
})

function buildFrom(names) {
  return buildMcpCatalog({
    schemas: names.map(name => ({ name: `mcp__alpha__${name}`, description: name })),
    getDefinition: name => ({ name }),
    ownedNames: ['router']
  })
}

test('catalog signature is stable across input order and reflects schema changes', () => {
  assert.equal(buildFrom(['b', 'a']).signature, buildFrom(['a', 'b']).signature)
  const descriptionBefore = buildMcpCatalog({ schemas: [{ name: 'mcp__alpha__one', description: 'before' }], getDefinition: name => ({ name }), ownedNames: ['router'] })
  const descriptionAfter = buildMcpCatalog({ schemas: [{ name: 'mcp__alpha__one', description: 'after' }], getDefinition: name => ({ name }), ownedNames: ['router'] })
  assert.notEqual(descriptionBefore.signature, descriptionAfter.signature)
  const parametersObject = buildMcpCatalog({ schemas: [{ name: 'mcp__alpha__one', parameters: { type: 'object' } }], getDefinition: name => ({ name }), ownedNames: ['router'] })
  const parametersString = buildMcpCatalog({ schemas: [{ name: 'mcp__alpha__one', parameters: { type: 'string' } }], getDefinition: name => ({ name }), ownedNames: ['router'] })
  assert.notEqual(parametersObject.signature, parametersString.signature)
})

test('rejects a namespace atomically when any schema definition is unresolved', () => {
  const catalog = buildMcpCatalog({
    schemas: [
      { name: 'mcp__alpha__one', description: 'one' },
      { name: 'mcp__alpha__two', description: 'two' }
    ],
    getDefinition: name => name.endsWith('__one') ? { name } : undefined,
    ownedNames: ['router']
  })
  assert.equal(catalog.servers.has('alpha'), false)
  assert.deepEqual([...catalog.passthrough], ['mcp__alpha__one', 'mcp__alpha__two'])
})

test('fails open when resolving one namespace throws and preserves unrelated servers', () => {
  const catalog = buildMcpCatalog({
    schemas: [
      { name: 'mcp__alpha__one', description: 'runtime failure' },
      { name: 'mcp__beta__one', description: 'healthy' }
    ],
    getDefinition: name => {
      if (name === 'mcp__alpha__one') throw new Error('runtime failure')
      return { name }
    },
    ownedNames: ['router']
  })
  assert.equal(catalog.servers.has('alpha'), false)
  assert.deepEqual([...catalog.passthrough], ['mcp__alpha__one'])
  assert.deepEqual([...catalog.servers.keys()], ['beta'])
})

test('rejects duplicate public schemas as an atomic namespace conflict', () => {
  const catalog = buildMcpCatalog({
    schemas: [
      { name: 'mcp__alpha__one', description: 'first', parameters: { type: 'object' } },
      { name: 'mcp__alpha__one', description: 'conflicting', parameters: { type: 'string' } }
    ],
    getDefinition: name => ({ name }),
    ownedNames: ['router']
  })
  assert.equal(catalog.servers.has('alpha'), false)
  assert.deepEqual([...catalog.passthrough], ['mcp__alpha__one'])
})
