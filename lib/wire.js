// 只读快照的 wire 词汇与 Typert 调用描述符。
//
// 描述符必须被两面同时携带：host 的 ./typert 清单（lib/typert.host.js）与浏览器半
// （lib/client.js）。浏览器半是手写的 __ModuleLoader__ bundle，只能 require 宿主模块
// 表里的包、不能 import 本文件，因此 client.js 内联了一份等价内容；
// test/client-bundle.test.mjs 断言两面不漂移，test/dsh-version-compat.test.mjs 用
// **真实的 typert-loader** 校验清单。
//
// 两条由 `@deepseek-ai/dsh-typert-loader` 强制、踩过一次的规则：
//   1. `TYPERT.package` 必须等于真实包名（含 npm scope）；
//   2. 描述符的 result / 参数 codec 必须是 `mode: 'strict'` —— `src-json` 会被拒绝。
// 因此这里用一个手写的结构化 schema 充当 strict codec：既满足 loader，又不需要
// schema 库，浏览器半才能继续手写、免构建。

/** Remote namespace 与包名。 */
const MCP_LAZY_NAMESPACE = 'mcpLazy'
const MCP_LAZY_PACKAGE = '@yilinxiao/dsh-mcp-lazy'

/**
 * Structural validator for one `mcpLazy/snapshot` result.
 *
 * Hand-written on purpose: a zod schema would have to be bundled into the
 * browser half, which is exactly what the build-free bundle avoids. It checks
 * every field the panel reads and returns the value unchanged.
 */
const SNAPSHOT_SCHEMA = Object.freeze({
  parse(value) {
    const fail = (detail) => {
      throw new Error(`mcpLazy/snapshot: ${detail}`)
    }
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
    }
    if (!Array.isArray(value.passthrough)) fail('passthrough must be an array')
    return value
  }
})

/** `mcpLazy/snapshot` 调用描述符（Typert 生成器同形，strict codec）。 */
const SNAPSHOT_DESCRIPTOR = Object.freeze({
  id: `${MCP_LAZY_PACKAGE}#${MCP_LAZY_NAMESPACE}/snapshot`,
  service: MCP_LAZY_NAMESPACE,
  namespace: MCP_LAZY_NAMESPACE,
  method: 'snapshot',
  invocation: Object.freeze({ kind: 'direct' }),
  parameters: Object.freeze([]),
  result: Object.freeze({
    mode: 'strict',
    typeSymbol: `${MCP_LAZY_PACKAGE}/types#McpLazySnapshot`,
    create: () => SNAPSHOT_SCHEMA
  }),
  sourceLocation: Object.freeze({ file: 'lib/wire.js', line: 1, column: 1 })
})

/** 本插件对外暴露的全部 Remote 调用。 */
const MCP_LAZY_INVOCATIONS = Object.freeze([SNAPSHOT_DESCRIPTOR])

export {
  MCP_LAZY_INVOCATIONS,
  MCP_LAZY_NAMESPACE,
  MCP_LAZY_PACKAGE,
  SNAPSHOT_DESCRIPTOR,
  SNAPSHOT_SCHEMA
}
