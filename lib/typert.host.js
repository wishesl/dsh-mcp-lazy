// 手写的 Typert HOST 清单，作为 `./typert` 导出，供 harness 的 typert-loader 在插件
// 挂载时登记 `mcpLazy/snapshot`。形状与生成器产物一致（loader 会校验）：package 面、
// 空 model/schemas，以及和浏览器半共用的调用描述符（lib/wire.js）。

import { MCP_LAZY_INVOCATIONS } from './wire.js'

/** Host Typert manifest validated by `@deepseek-ai/dsh-typert-loader`. */
export const TYPERT = Object.freeze({
  package: 'dsh-mcp-lazy',
  face: 'host',
  schemas: Object.freeze([]),
  invocations: MCP_LAZY_INVOCATIONS,
  model: Object.freeze({
    services: Object.freeze([]),
    events: Object.freeze([]),
    objects: Object.freeze([])
  })
})
