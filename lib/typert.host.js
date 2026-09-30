// 手写的 Typert HOST 清单，作为 `./typert` 导出，供 harness 的 typert-loader 在插件
// 挂载时登记 `mcpLazy/snapshot`。形状与生成器产物一致（loader 会校验）：package 面、
// 空 model/schemas，以及和浏览器半共用的调用描述符（lib/wire.js）。

import { MCP_LAZY_INVOCATIONS, MCP_LAZY_PACKAGE } from './wire.js'

/**
 * Host Typert manifest validated by `@deepseek-ai/dsh-typert-loader`.
 *
 * `package` must equal the real npm package name (scope included) — the loader
 * rejects a manifest owned by any other name, and that rejection is silent from
 * the panel's point of view: its Remote calls then 404.
 */
export const TYPERT = Object.freeze({
  package: MCP_LAZY_PACKAGE,
  face: 'host',
  schemas: Object.freeze([]),
  invocations: MCP_LAZY_INVOCATIONS,
  model: Object.freeze({
    services: Object.freeze([]),
    events: Object.freeze([]),
    objects: Object.freeze([])
  })
})
