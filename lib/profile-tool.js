// 模型面的写入通道：让 agent 自己补上「这台 MCP 是干什么的」。
//
// 为什么是一个工具而不是别的东西：描述与关键词只对人类可见（设置面板），
// 模型面此前只有路由工具 —— 于是「知道索引里的名字不透明时该去补描述」这件事
// 对 agent 既不可发现、也无从下手。这个工具把「发现」和「动手」合成一步。
//
// 边界（与面板同一条纪律）：
//   * 只写本插件自己的状态文件，且必须走 `store.merge()`（逐字段合并），
//     不碰 cordis.patch.yml、不碰 profile 的 package.json；
//   * **不接受 `pinned`**：常驻/收起是工具可见性开关，只留在人类面板上。
//     合并语义顺带保证它不会被抹掉 —— 这也是不能走 `store.save()` 的原因，
//     save 是整体替换，会把既有的 `pinned: true` 一起删掉；
//   * 只影响「面板展示 + 提示词索引 + 路由打分用的提示词」，不影响接管、披露
//     与工具可见性；
//   * 名字必须命中当前受管目录，否则拒绝并给出候选（省模型一次路由搜索）；
//   * 任何失败都如实回报，不抛：写盘失败降级为「仅本会话有效」。

/** Model-facing control tool that writes a managed server's description. */
const DESCRIBE_TOOL_NAME = 'mcp__router__describe_server'
/** Candidate names reported back when the requested server is unknown. */
const MAX_CANDIDATES = 12

/** Text-block output projection, the same shape the other control tools use. */
function textOutput() {
  return {
    schema: {
      type: 'object',
      properties: { content: { type: 'array', items: {} } },
      required: ['content'],
      additionalProperties: false
    },
    render(_args, value) {
      const text = (value.content ?? [])
        .filter((block) => block && typeof block === 'object' && block.type === 'text')
        .map((block) => block.text)
        .join('\n')
      return [{ type: 'text', text }]
    }
  }
}

/** Server names the manager currently holds; [] when the catalog is not readable. */
function managedServers(readCatalog) {
  let catalog
  try {
    catalog = readCatalog?.() ?? {}
  } catch {
    return []
  }
  const names = []
  for (const entry of catalog?.entries ?? []) {
    if (typeof entry?.serverName === 'string' && entry.serverName !== '') names.push(entry.serverName)
  }
  return names
}

/** Bounded candidate list: a model that guessed a name should not need a second call. */
function candidateList(names) {
  const shown = names.slice(0, MAX_CANDIDATES)
  const rest = names.length - shown.length
  return `${shown.join('、')}${rest > 0 ? `（另有 ${rest} 台未列出）` : ''}`
}

/**
 * Build the describe tool.
 *
 * The tool is a thin adapter over the panel's own write path: it validates the
 * name against the live catalog, merges the text fields, and re-queues the
 * prompt index. Every outcome that changes what the model should do next
 * (unknown name, config-pinned field, resident server, failed write) is stated
 * in the result rather than silently no-opping.
 *
 * @param options.store - the profile store; the tool is not offered without it.
 * @param options.readCatalog - live managed catalog (same reader as the panel).
 * @param options.readView - effective view config, carrying `overlayOrigins`
 *   (which field a hand-written `serverProfiles` entry pins) and `pinned`.
 * @param options.requeue - re-queue the prompt index for live sessions.
 * @param options.logger - optional host logger.
 * @returns the Tool definition, or `undefined` when this host cannot write.
 */
function createDescribeTool(options = {}) {
  const store = options.store
  if (typeof store?.merge !== 'function') return undefined
  const readCatalog = options.readCatalog
  const readView = typeof options.readView === 'function' ? options.readView : () => ({})
  const requeue = typeof options.requeue === 'function' ? options.requeue : () => 0
  const logger = options.logger

  function reply(text) {
    return { content: [{ type: 'text', text }] }
  }

  function write(args) {
    const serverName = typeof args?.serverName === 'string' ? args.serverName.trim() : ''
    if (serverName === '') return `未写入：需要 serverName。当前受管：${candidateList(managedServers(readCatalog))}`

    const known = managedServers(readCatalog)
    if (known.length === 0) {
      return '未写入：当前没有受管的 MCP 服务器（管理器目录未就绪，或没有兼容的 MCP 被接管）。'
    }
    if (!known.includes(serverName)) {
      return `未写入：没有名为 "${serverName}" 的受管服务器。当前受管：${candidateList(known)}`
    }

    // Type rules stay here, not in the schema error: the host validates the
    // shape, but a wrong-typed value must also read as a refusal, not as a
    // silent no-op that the model would report as success.
    if (args.description !== undefined && typeof args.description !== 'string') {
      return '未写入：description 需要字符串。'
    }
    if (args.keywords !== undefined && !Array.isArray(args.keywords)) {
      return '未写入：keywords 需要字符串数组。'
    }

    const fields = {}
    if (args.description !== undefined) fields.description = args.description
    if (args.keywords !== undefined) fields.keywords = args.keywords
    if (Object.keys(fields).length === 0) return '未写入：至少给出 description 或 keywords。'

    const asked = Array.isArray(args.keywords)
      ? args.keywords.filter((keyword) => typeof keyword === 'string' && keyword.trim() !== '').length
      : 0
    const result = store.merge(serverName, fields)
    requeue()

    const notes = []
    if (args.keywords !== undefined && result.profile !== null) {
      const kept = result.profile.keywords?.length ?? 0
      if (asked > kept) notes.push(`给出的关键词有重复或超限，实际保留 ${kept} 个（上限 24 个、每个 24 字符）`)
    }
    const view = readView() ?? {}
    const origins = view.overlayOrigins?.[serverName] ?? {}
    for (const field of ['description', 'keywords']) {
      if (fields[field] !== undefined && origins[field] === 'config') {
        notes.push(`${field} 由 cordis.patch.yml 的 serverProfiles 固定，本次写入不会生效`)
      }
    }
    if (view.serverProfiles?.[serverName]?.pinned === true) {
      notes.push('该服务器当前是常驻：工具常显、不进提示词索引，描述已保存，收起后生效')
    }
    if (result.persisted !== true) {
      notes.push(`未能写入磁盘，仅本会话内存有效${result.warning === null || result.warning === undefined ? '' : `：${result.warning}`}`)
    }

    const written = []
    if (fields.description !== undefined) {
      written.push(String(fields.description).trim() === '' ? '已清除描述' : '已写入描述')
    }
    if (fields.keywords !== undefined) {
      written.push(result.profile === null ? '已清除关键词' : `已写入 ${result.profile.keywords?.length ?? 0} 个关键词`)
    }
    const head = result.profile === null
      ? `已清除 "${serverName}" 的自定义描述与关键词`
      : `${written.join('、')}（"${serverName}"${result.persisted === true ? '，已落盘' : ''}）`
    const next = '下一轮装配起，提示词索引与路由匹配会使用新内容。'
    return `${head}。\n${next}${notes.map((note) => `\n注意：${note}`).join('')}`
  }

  return {
    name: DESCRIBE_TOOL_NAME,
    description: '给一台受管的 MCP 服务器补充用途描述与路由关键词，让按需加载的路由更准：描述会出现在索引该行并参与匹配，两者下一轮装配起生效。只改描述与关键词，不影响工具可见性。',
    parameters: {
      type: 'object',
      properties: {
        serverName: { type: 'string', description: '受管服务器的精确名，即索引里列出的那一个' },
        description: { type: 'string', description: '一句话说明这台服务器是干什么的；单行，超长会截断，传空串表示清除' },
        keywords: { type: 'array', items: { type: 'string' }, description: '可选的路由关键词或中文别名（例如业务名），最多 24 个、每个最多 24 字符' }
      },
      required: ['serverName', 'description'],
      additionalProperties: false
    },
    output: textOutput(),
    execute(args) {
      try {
        return reply(write(args ?? {}))
      } catch (error) {
        // A control tool must never break the turn it is called from.
        logger?.warn?.(`mcp-lazy: describe_server failed (${String(error?.message ?? error)})`)
        return reply(`未写入：${String(error?.message ?? error)}`)
      }
    }
  }
}

export { DESCRIBE_TOOL_NAME, createDescribeTool }
