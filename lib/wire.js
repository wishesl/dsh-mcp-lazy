// Remote 调用的 wire 词汇与 Typert 调用描述符。
//
// 描述符必须被两面同时携带：host 的 ./typert 清单（lib/typert.host.js）与浏览器半
// （lib/client.js）。浏览器半是手写的 __ModuleLoader__ bundle，只能 require 宿主模块
// 表里的包、不能 import 本文件，因此 client.js 内联了一份等价内容；
// test/client-bundle.test.mjs 断言两面不漂移，test/dsh-version-compat.test.mjs 用
// **真实的 typert-loader** 校验清单。
//
// 三条由 `@deepseek-ai/dsh-typert-loader` 强制、踩过或读源码确认的规则：
//   1. `TYPERT.package` 必须等于真实包名（含 npm scope）；
//   2. 描述符的 result / **参数** codec 都必须是 `mode: 'strict'`，`src-json` 会被拒；
//   3. 每个参数的 wire 字段名在同一调用内唯一，`source` 只能是 `json` 或 `lookup`
//      （0.2.0-rc.2 的 `requireInvocation` 逐条校验）。
// 因此这里用手写的结构化 schema 充当 strict codec：既满足 loader，又不需要
// schema 库，浏览器半才能继续手写、免构建。

/** Remote namespace 与包名。 */
const MCP_LAZY_NAMESPACE = 'mcpLazy'
const MCP_LAZY_PACKAGE = '@yilinxiao/dsh-mcp-lazy'

const failWith = (subject) => (detail) => {
  throw new Error(`${subject}: ${detail}`)
}

/**
 * Structural validator for one `mcpLazy/snapshot` result.
 *
 * Hand-written on purpose: a zod schema would have to be bundled into the
 * browser half, which is exactly what the build-free bundle avoids. It checks
 * every field the panel reads and returns the value unchanged.
 */
const SNAPSHOT_SCHEMA = Object.freeze({
  parse(value) {
    const fail = failWith('mcpLazy/snapshot')
    if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('result must be an object')
    if (typeof value.routerTool !== 'string') fail('routerTool must be a string')
    if (typeof value.generatedAt !== 'number' || !Number.isFinite(value.generatedAt)) fail('generatedAt must be a finite number')
    if (typeof value.signature !== 'string') fail('signature must be a string')
    if (!Array.isArray(value.servers)) fail('servers must be an array')
    for (const server of value.servers) {
      if (server === null || typeof server !== 'object' || Array.isArray(server)) fail('every server must be an object')
      if (typeof server.serverName !== 'string') fail('serverName must be a string')
      if (typeof server.toolCount !== 'number') fail('toolCount must be a number')
      if (!Array.isArray(server.keywords)) fail('keywords must be an array')
      if (!Array.isArray(server.tools)) fail('tools must be an array')
      // The editor prefills from `override`, badges from `overrideSource`; both
      // are always present on the host side, so a missing one is a real defect.
      if (server.override === null || typeof server.override !== 'object' || Array.isArray(server.override)) {
        fail('every server must carry an override object')
      }
      if (server.override.description !== null && typeof server.override.description !== 'string') {
        fail('override.description must be a string or null')
      }
      if (server.override.keywords !== null && !Array.isArray(server.override.keywords)) {
        fail('override.keywords must be an array or null')
      }
      if (server.overrideSource === null || typeof server.overrideSource !== 'object' || Array.isArray(server.overrideSource)) {
        fail('every server must carry an overrideSource object')
      }
    }
    if (!Array.isArray(value.passthrough)) fail('passthrough must be an array')
    const index = value.promptIndex
    if (index === null || typeof index !== 'object' || Array.isArray(index)) fail('promptIndex must be an object')
    if (typeof index.enabled !== 'boolean') fail('promptIndex.enabled must be a boolean')
    if (typeof index.text !== 'string') fail('promptIndex.text must be a string')
    if (typeof index.sectionName !== 'string') fail('promptIndex.sectionName must be a string')
    if (index.order !== null && typeof index.order !== 'number') fail('promptIndex.order must be a number or null')
    const store = value.store
    if (store === null || typeof store !== 'object' || Array.isArray(store)) fail('store must be an object')
    if (typeof store.persisted !== 'boolean') fail('store.persisted must be a boolean')
    return value
  }
})

/** Structural validator for the `saveProfile` argument. */
const PROFILE_INPUT_SCHEMA = Object.freeze({
  parse(value) {
    const fail = failWith('mcpLazy/saveProfile')
    if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('input must be an object')
    if (typeof value.serverName !== 'string' || value.serverName === '') fail('serverName must be a non-empty string')
    if (value.description !== undefined && typeof value.description !== 'string') fail('description must be a string')
    if (value.keywords !== undefined) {
      if (!Array.isArray(value.keywords)) fail('keywords must be an array')
      for (const keyword of value.keywords) {
        if (typeof keyword !== 'string') fail('every keyword must be a string')
      }
    }
    return { serverName: value.serverName, description: value.description, keywords: value.keywords }
  }
})

/** Structural validator for the `resetProfile` argument. */
const RESET_INPUT_SCHEMA = Object.freeze({
  parse(value) {
    const fail = failWith('mcpLazy/resetProfile')
    if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('input must be an object')
    if (typeof value.serverName !== 'string' || value.serverName === '') fail('serverName must be a non-empty string')
    return { serverName: value.serverName }
  }
})

const RESULT_TYPE_SYMBOL = `${MCP_LAZY_PACKAGE}/types#McpLazySnapshot`
const SNAPSHOT_RESULT = Object.freeze({
  mode: 'strict',
  typeSymbol: RESULT_TYPE_SYMBOL,
  create: () => SNAPSHOT_SCHEMA
})

const SOURCE_LOCATION = Object.freeze({ file: 'lib/wire.js', line: 1, column: 1 })

function jsonInput(name, typeSymbol, create) {
  return Object.freeze({
    name,
    wire: name,
    source: 'json',
    codec: Object.freeze({ mode: 'strict', typeSymbol, create })
  })
}

/** `mcpLazy/snapshot`：当前目录 + 实际注入的提示词 + 存储状态（只读）。 */
const SNAPSHOT_DESCRIPTOR = Object.freeze({
  id: `${MCP_LAZY_PACKAGE}#${MCP_LAZY_NAMESPACE}/snapshot`,
  service: MCP_LAZY_NAMESPACE,
  namespace: MCP_LAZY_NAMESPACE,
  method: 'snapshot',
  invocation: Object.freeze({ kind: 'direct' }),
  parameters: Object.freeze([]),
  result: SNAPSHOT_RESULT,
  sourceLocation: SOURCE_LOCATION
})

/** `mcpLazy/saveProfile`：保存某个服务器的自定义描述/关键词，返回新快照。 */
const SAVE_PROFILE_DESCRIPTOR = Object.freeze({
  id: `${MCP_LAZY_PACKAGE}#${MCP_LAZY_NAMESPACE}/saveProfile`,
  service: MCP_LAZY_NAMESPACE,
  namespace: MCP_LAZY_NAMESPACE,
  method: 'saveProfile',
  invocation: Object.freeze({ kind: 'direct' }),
  parameters: Object.freeze([
    jsonInput('input', `${MCP_LAZY_PACKAGE}/types#McpLazyProfileInput`, () => PROFILE_INPUT_SCHEMA)
  ]),
  result: SNAPSHOT_RESULT,
  sourceLocation: SOURCE_LOCATION
})

/** `mcpLazy/resetProfile`：删除某个服务器的自定义描述/关键词，返回新快照。 */
const RESET_PROFILE_DESCRIPTOR = Object.freeze({
  id: `${MCP_LAZY_PACKAGE}#${MCP_LAZY_NAMESPACE}/resetProfile`,
  service: MCP_LAZY_NAMESPACE,
  namespace: MCP_LAZY_NAMESPACE,
  method: 'resetProfile',
  invocation: Object.freeze({ kind: 'direct' }),
  parameters: Object.freeze([
    jsonInput('input', `${MCP_LAZY_PACKAGE}/types#McpLazyResetInput`, () => RESET_INPUT_SCHEMA)
  ]),
  result: SNAPSHOT_RESULT,
  sourceLocation: SOURCE_LOCATION
})

/** 本插件对外暴露的全部 Remote 调用。 */
const MCP_LAZY_INVOCATIONS = Object.freeze([
  SNAPSHOT_DESCRIPTOR,
  SAVE_PROFILE_DESCRIPTOR,
  RESET_PROFILE_DESCRIPTOR
])

export {
  MCP_LAZY_INVOCATIONS,
  MCP_LAZY_NAMESPACE,
  MCP_LAZY_PACKAGE,
  PROFILE_INPUT_SCHEMA,
  RESET_INPUT_SCHEMA,
  RESET_PROFILE_DESCRIPTOR,
  SAVE_PROFILE_DESCRIPTOR,
  SNAPSHOT_DESCRIPTOR,
  SNAPSHOT_SCHEMA
}
