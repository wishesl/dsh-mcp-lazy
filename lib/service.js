// `mcpLazy` Remote 服务（Host 面）：把管理器的目录快照、**实际注入的提示词**
// 与面板自定义覆盖一起交给设置面板，并接受面板的保存/删除。
//
// 写入的边界（保持本仓库纪律）：
//   * 只写本插件自己的状态文件（lib/profile-store.js），不碰 profile 配置、
//     不碰 cordis.patch.yml、不改任何 MCP 连接与工具注册；
//   * 写入只影响「面板展示 + 提示词索引 + 路由器打分用的提示词」，
//     不影响接管/披露/工具可见性这些安全相关行为；
//   * 任何 IO 失败都降级为「会话内有效」，并通过 store.persisted 如实上报。
//
// 依赖 `@deepseek-ai/dsh-typert-protocol`，因此本模块**只能被动态导入**：
// lib/index.js 先确认该包可解析，再 import 本文件；老宿主（0.1.x）缺包时整个
// 面板能力静默缺席，插件其余功能不受影响。

import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

import { buildPanelSnapshot, normalizeProfile } from './mcp-view.js'
import { createProfileStore } from './profile-store.js'
import { MCP_LAZY_NAMESPACE } from './wire.js'

const EMPTY_CATALOG = { entries: [], passthrough: [], signature: 'empty' }
const MAX_SERVER_NAME_CHARS = 64

const NO_PROMPT_INDEX = {
  enabled: false,
  channel: 'none',
  name: 'mcp-lazy:index',
  order: null,
  locale: 'zh',
  reason: 'unavailable',
  text: ''
}

const NO_STORE = { persisted: false, file: null, warning: null }

function requireServerName(value) {
  const serverName = typeof value?.serverName === 'string' ? value.serverName.trim() : ''
  if (serverName === '') throw new Error('serverName is required')
  if (serverName.length > MAX_SERVER_NAME_CHARS) throw new Error('serverName is too long')
  return serverName
}

/**
 * McpLazy settings service: read the catalog, show exactly what the prompt
 * section carries, and persist panel-authored server profiles.
 *
 * @param ctx - host context.
 * @param options - `readCatalog` returns the manager's read-only catalog view;
 *   `readView` returns the **effective** panel view config (derived config plus
 *   the store's overrides); `readPromptIndex` reports the live prompt section;
 *   `store` is the override store (a memory-only one is created when omitted).
 */
class McpLazyService extends TypertRemoteService {
  constructor(ctx, options = {}) {
    super(ctx, MCP_LAZY_NAMESPACE)
    const view = options.view ?? {}
    this.readCatalog = typeof options.readCatalog === 'function' ? options.readCatalog : () => EMPTY_CATALOG
    this.readView = typeof options.readView === 'function' ? options.readView : () => view
    this.readPromptIndex = typeof options.readPromptIndex === 'function' ? options.readPromptIndex : () => NO_PROMPT_INDEX
    this.store = options.store ?? createProfileStore({ logger: ctx?.logger })
  }

  /** The full snapshot: catalog + injected prompt + store state. */
  payload() {
    const catalog = this.readCatalog() ?? EMPTY_CATALOG
    const index = this.readPromptIndex() ?? NO_PROMPT_INDEX
    const store = this.store.snapshot() ?? NO_STORE
    return buildPanelSnapshot(catalog, this.readView() ?? {}, Date.now(), {
      promptIndex: {
        enabled: index.enabled === true,
        // Which systemPrompt surface carries the index: `context` (a named entry
        // in the conversation's runtime context) or `section` (injection only).
        channel: typeof index.channel === 'string' ? index.channel : 'none',
        name: typeof index.name === 'string' ? index.name : 'mcp-lazy:index',
        order: typeof index.order === 'number' ? index.order : null,
        locale: index.locale === 'en' ? 'en' : 'zh',
        reason: typeof index.reason === 'string' ? index.reason : '',
        text: typeof index.text === 'string' ? index.text : ''
      },
      store
    })
  }

  /**
   * Current managed-MCP snapshot for the settings panel.
   *
   * @returns the snapshot payload; `available: false` means the universal
   *   manager is not installed on this host, not that the call failed.
   */
  async snapshot() {
    return this.payload()
  }

  /**
   * Save one server's panel-authored description/keywords and report the fresh
   * snapshot, so the panel never has to guess what the new prompt index says.
   *
   * Omitting a field clears it (the panel sends what the user submitted); the
   * derived keywords take over wherever no override is left.
   *
   * @param input - `{ serverName, description?, keywords? }`.
   * @returns the snapshot after the write.
   */
  async saveProfile(input) {
    const serverName = requireServerName(input)
    const profile = normalizeProfile({ description: input?.description, keywords: input?.keywords })
    this.store.save(serverName, profile ?? {})
    return this.payload()
  }

  /**
   * Drop one server's panel-authored override.
   *
   * @param input - `{ serverName }`.
   * @returns the snapshot after the removal.
   */
  async resetProfile(input) {
    this.store.clear(requireServerName(input))
    return this.payload()
  }
}

export { McpLazyService }
