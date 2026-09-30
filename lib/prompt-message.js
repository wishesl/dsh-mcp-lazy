// 把 MCP 索引作为「一条真实会话消息」注入 —— 与根目录 AGENTS.md 完全同一机制。
//
// 为什么不继续用 systemPrompt.context()：宿主把**所有**运行时上下文拼成一条快照
// 消息（`renderContextSections()` 的注释说它保留名字「供展示层归因」，但 0.2.0-rc.2
// 的 Chat 只把它整体渲染成一条 `Current runtime context` 条目），所以索引会和
// sandbox / approval 等条目挤在同一条里，用户看不到「MCP 注入」这条独立记录。
//
// 客户端的 `conversation-nodes/message.js` 才是 AGENTS.md 那条记录的来源：
//   * `messageDefinition` 把 `user/message` 分成「用户提交 / steering / 注入上下文」；
//   * `contextMessage()` 给**每一条**非用户提交的 user 角色消息生成独立的
//     `kind: 'context'` 节点，标签由 `contextProducer(source)`（默认取
//     `source.kind`）与 `contextForm(source)`（`KNOWN_FORMS` 之一）决定。
// 所以：只要把索引作为一条带自有 source 的 user 消息注入，用户就会在自己会话里看到
// 一条独立条目，`form: 'catalog'` 还是宿主支持的结构化展示形式。
//
// 注入 API 用 `agent.inject(message)`（`dsh-user-approval` 同款）：
// 「把面向模型的上下文排到下一次 pre-step，**不唤醒驱动器**」——不会打断或凭空启动
// 一轮对话；空闲会话把它挂起到下一次唤醒。AGENTS.md 用 `agent.inbox.prepend`，
// 我们走同一底层、语义更贴合「排入上下文」。
//
// fail-soft：
//   * 消息工厂优先用宿主的 `createUserMessage`（带 branded id）；解析不到就本地造
//     同形状的冻结消息 —— 形状只是 `{ id, role:'user', content, source }`；
//   * `agents` 服务缺失（老宿主/测试替身）时整条通道不可用，调用方回退
//     `systemPrompt.context()` → `section()`；
//   * 任何一次注入失败只记日志，绝不影响接管与工具可见性。

import { randomUUID } from 'node:crypto'

/** 自有 source：客户端据此把这条消息标成独立条目（label 默认取 kind）。 */
const PROMPT_MESSAGE_KIND = 'mcp-lazy'
/** 宿主支持的结构化展示形式之一（`KNOWN_FORMS`）。 */
const PROMPT_MESSAGE_FORM = 'catalog'

/**
 * Resolve the host message factory, or a locally equivalent one.
 *
 * The local shape is exactly what `createUserMessage` produces
 * (`{ id: uuid, role: 'user', content, source }`, frozen), so a host that cannot
 * resolve `@deepseek-ai/dsh-llm` still gets a valid message instead of losing the
 * feature entirely.
 */
async function loadMessageFactory(logger) {
  try {
    const llm = await import('@deepseek-ai/dsh-llm')
    if (typeof llm?.createUserMessage === 'function') return llm.createUserMessage
  } catch (error) {
    logger?.info?.(`mcp-lazy: @deepseek-ai/dsh-llm is unavailable (${String(error?.message ?? error)}); using the equivalent local message shape`)
  }
  return (input) => Object.freeze({
    id: randomUUID(),
    role: 'user',
    content: input.content,
    source: input.source
  })
}

/**
 * Per-agent queue of the MCP index message.
 *
 * @param options.createUserMessage - message factory (host or local equivalent).
 * @param options.readText - returns the current index text (memoized upstream).
 * @param options.logger - optional host logger.
 */
function createPromptMessenger(options = {}) {
  const createUserMessage = options.createUserMessage
  const readText = typeof options.readText === 'function' ? options.readText : () => ''
  const logger = options.logger

  /** agent -> the text we last queued for it (also our live-agent registry). */
  const sent = new Map()
  const state = { injected: 0, failed: 0 }

  function messageFor(text) {
    return createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: PROMPT_MESSAGE_KIND, form: PROMPT_MESSAGE_FORM }
    })
  }

  /** Drop our own still-pending messages, so a refresh cannot queue two. */
  function dropPending(agent) {
    const inbox = agent?.inbox
    if (inbox === undefined || typeof inbox.remove !== 'function') return
    for (const list of [inbox.nextStep, inbox.nextTurn]) {
      for (const message of [...(list ?? [])]) {
        if (message?.source?.kind === PROMPT_MESSAGE_KIND) inbox.remove(message.id)
      }
    }
  }

  return {
    state,

    /**
     * Queue the current index for one agent.
     *
     * @returns whether a message was queued (false when the text is empty, the
     *   agent already carries it, or the agent cannot accept injections).
     */
    injectFor(agent) {
      if (typeof agent?.inject !== 'function') return false
      const text = readText() ?? ''
      if (text === '') return false
      if (sent.get(agent) === text) return false
      try {
        dropPending(agent)
        agent.inject(messageFor(text))
        sent.set(agent, text)
        state.injected += 1
        return true
      } catch (error) {
        state.failed += 1
        logger?.warn?.(`mcp-lazy: could not queue the MCP index message (${String(error?.message ?? error)})`)
        return false
      }
    },

    /** Re-queue the (possibly changed) index for every agent we know. */
    refresh() {
      let queued = 0
      for (const agent of [...sent.keys()]) if (this.injectFor(agent)) queued += 1
      return queued
    },

    /** Forget one agent (its messages stay in the session log — they are durable). */
    forget(agent) {
      sent.delete(agent)
    },

    /** Tracked live agents; the panel reports this as "已注入会话数". */
    size() {
      return sent.size
    },

    clear() {
      sent.clear()
    }
  }
}

/**
 * Install the message channel for one plugin instance.
 *
 * Availability is decided by the **`agents` service**: it is the host's own live
 * registry, it is what lets a fresh mount reach sessions that already exist, and
 * it keeps hosts without it (and test doubles) on the systemPrompt fallbacks —
 * an event surface alone is not enough, because an injectable agent is what the
 * channel actually needs.
 *
 * @returns `{ available, messenger, dispose, refresh }`.
 */
async function installPromptMessages(ctx, adapter, { readText, logger } = {}) {
  const agents = ctx?.get?.('agents')
  const canList = typeof agents?.list === 'function'
  if (!canList) return { available: false, messenger: undefined, dispose: () => {}, refresh: () => 0 }

  const messenger = createPromptMessenger({
    createUserMessage: await loadMessageFactory(logger),
    readText,
    logger
  })

  const disposers = []
  try {
    if (typeof adapter?.on === 'function') {
      disposers.push(adapter.on('agent/created', (event) => { messenger.injectFor(event?.agent) }))
      disposers.push(adapter.on('agent/disposed', (event) => { messenger.forget(event?.agent) }))
      // The catalog changed (a server connected, its tools moved, a panel save
      // re-keyed the index): what the live agents carry is now stale.
      disposers.push(adapter.on('tools/change', () => { messenger.refresh() }))
    }
    // Backfill: sessions that existed before this mount (the manager cannot take
    // them over, but their next request can still carry the index).
    for (const agent of agents.list() ?? []) messenger.injectFor(agent)
  } catch (error) {
    logger?.warn?.(`mcp-lazy: the MCP index message channel failed to install (${String(error?.message ?? error)})`)
    for (const dispose of disposers.reverse()) {
      try { dispose?.() } catch { /* nothing left to do */ }
    }
    return { available: false, messenger: undefined, dispose: () => {}, refresh: () => 0 }
  }

  return {
    available: true,
    messenger,
    refresh: () => messenger.refresh(),
    dispose() {
      for (const dispose of disposers.reverse()) {
        try { dispose?.() } catch { /* disposal is best-effort */ }
      }
      messenger.clear()
    }
  }
}

export {
  PROMPT_MESSAGE_FORM,
  PROMPT_MESSAGE_KIND,
  createPromptMessenger,
  installPromptMessages,
  loadMessageFactory
}
