// `mcpLazy` Remote 服务（Host 面）：把管理器的只读目录快照交给设置面板。
//
// 一律只读：没有写入、没有审批、没有 profile 修改——面板只展示既成事实。
// 依赖 `@deepseek-ai/dsh-typert-protocol`，因此本模块**只能被动态导入**：
// lib/index.js 先确认该包可解析，再 import 本文件；老宿主（0.1.x）缺包时整个
// 面板能力静默缺席，插件其余功能不受影响。

import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { buildSnapshot } from './mcp-view.js'
import { MCP_LAZY_NAMESPACE } from './wire.js'

const EMPTY_CATALOG = { entries: [], passthrough: [], signature: 'empty' }

/** Read-only catalog view exposed over `mcpLazy/snapshot`. */
class McpLazyService extends TypertRemoteService {
  /**
   * @param ctx - host context.
   * @param options - `readCatalog` returns the manager's read-only catalog view;
   *   `view` carries the panel-side view config (truncation, keyword caps,
   *   serverProfiles overrides).
   */
  constructor(ctx, options = {}) {
    super(ctx, MCP_LAZY_NAMESPACE)
    this.readCatalog = typeof options.readCatalog === 'function' ? options.readCatalog : () => EMPTY_CATALOG
    this.view = options.view ?? {}
  }

  /**
   * Current managed-MCP snapshot for the settings panel.
   *
   * @returns the snapshot payload; `available: false` means the universal
   *   manager is not installed on this host, not that the call failed.
   */
  async snapshot() {
    const catalog = this.readCatalog() ?? EMPTY_CATALOG
    const payload = buildSnapshot(catalog, this.view, Date.now())
    return { ...payload, available: catalog.signature !== 'empty' || payload.serverCount > 0 }
  }
}

export { McpLazyService }
