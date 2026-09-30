// 只读快照的 wire 词汇与 Typert 调用描述符。
//
// 描述符必须被两面同时携带：host 的 ./typert 清单（lib/typert.host.js）与浏览器半
// （lib/client.js）。浏览器半是手写的 __ModuleLoader__ bundle，只能 require 宿主模块
// 表里的包、不能 import 本文件，因此 client.js 内联了一份等价字面量，
// 由 test/client-bundle.test.mjs 断言两者深度相等（防漂移）。
//
// result 用 `src-json`：快照是纯 JSON（字符串/数字/数组），两面都不需要 schema 库，
// 也就让浏览器半彻底不需要打包器。

/** Remote namespace：`ctx.remote.mcpLazy`。 */
const MCP_LAZY_NAMESPACE = 'mcpLazy'

/** `mcpLazy/snapshot` 调用描述符（Typert 生成器同形）。 */
const SNAPSHOT_DESCRIPTOR = Object.freeze({
  id: 'dsh-mcp-lazy#mcpLazy/snapshot',
  service: MCP_LAZY_NAMESPACE,
  namespace: MCP_LAZY_NAMESPACE,
  method: 'snapshot',
  invocation: Object.freeze({ kind: 'direct' }),
  parameters: Object.freeze([]),
  result: Object.freeze({ mode: 'src-json' }),
  sourceLocation: Object.freeze({ file: 'lib/wire.js', line: 1, column: 1 })
})

/** 本插件对外暴露的全部 Remote 调用。 */
const MCP_LAZY_INVOCATIONS = Object.freeze([SNAPSHOT_DESCRIPTOR])

export { MCP_LAZY_INVOCATIONS, MCP_LAZY_NAMESPACE, SNAPSHOT_DESCRIPTOR }
