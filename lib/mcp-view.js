// 纯函数层：把工具注册表里的 mcp__* 条目整理成两个产物 —— 设置面板的只读快照，
// 以及注入到系统提示词里的 MCP 索引。
//
// 两条刻意维持的约束：
//
// 1. 关键词与描述默认全部**从 MCP 定义派生**（服务器名、routingHints、工具名、工具
//    描述），与 tool-router.js 的 searchableText 同源 —— 面板里看到的、注入提示词的，
//    就是路由器真正打分的东西。因此无需人工维护清单。
// 2. `serverProfiles` 只做可选覆盖，用于中文别名与手写用途；派生结果始终是兜底。
//
// 纯函数、无 IO、顺序确定：注册表不变时输出逐字节稳定（利于 prompt cache）。

const DEFAULT_DESCRIPTION_CHARS = 120
const DEFAULT_KEYWORDS_PER_SERVER = 8
const DEFAULT_MAX_SERVERS = 12
const DEFAULT_MAX_SNAPSHOT_TOOLS = 200
const TOOL_DESCRIPTION_CHARS = 300
const ROUTER_TOOL_NAME = 'mcp__router__search_and_activate'

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'your', 'you', 'are',
  'use', 'used', 'using', 'can', 'will', 'all', 'any', 'not', 'but', 'has', 'have',
  'its', 'it', 'of', 'to', 'in', 'on', 'an', 'or', 'is', 'be', 'as', 'by', 'at',
  'when', 'then', 'which', 'while', 'before', 'after', 'returns', 'return', 'tool',
  'tools', 'server', 'servers', 'mcp', 'value', 'values', 'string', 'number',
  'object', 'array', 'default', 'optional', 'required', 'description'
])

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback
}

function truncate(value, limit) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text.length <= limit) return text
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`
}

/** One display-ready server row: keywords and description resolved, tools truncated. */
function serverView(entry, config) {
  const serverName = String(entry.serverName ?? '')
  const catalog = typeof entry.getCatalog === 'function' ? entry.getCatalog() : []
  const profile = config.profiles?.[serverName] ?? {}
  const profileKeywords = Array.isArray(profile.keywords) ? profile.keywords.filter(word => typeof word === 'string') : []
  const derived = deriveKeywords(entry)
  const keywords = dedupe([...profileKeywords, ...derived], config.keywordsPerServer)
  const description = typeof profile.description === 'string' && profile.description.trim() !== ''
    ? truncate(profile.description, config.descriptionChars)
    : null
  return {
    serverName,
    toolCount: catalog.length,
    keywords,
    description,
    tools: catalog.map(tool => ({
      name: String(tool.name ?? ''),
      description: truncate(tool.description, TOOL_DESCRIPTION_CHARS)
    }))
  }
}

function dedupe(values, limit) {
  const seen = new Set()
  const result = []
  for (const value of values) {
    const text = typeof value === 'string' ? value.trim() : ''
    if (text === '') continue
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(text)
    if (result.length >= limit) break
  }
  return result
}

/**
 * Derive routing keywords from the MCP definition itself.
 *
 * Takes a router-shaped entry (`{ serverName, routingHints, getCatalog }`) —
 * the same object tool-router.js scores against, so the advertised keywords are
 * exactly the searchable ones. Tool-name tokens carry the real capability words
 * (`browser_navigate` → `browser`, `navigate`), so they weigh more than prose
 * words from the descriptions. Ties break alphabetically for byte stability.
 */
function deriveKeywords(entry) {
  const serverName = String(entry?.serverName ?? '')
  const catalog = typeof entry?.getCatalog === 'function' ? entry.getCatalog() : []
  const hints = Array.isArray(entry?.routingHints) ? entry.routingHints.filter(hint => typeof hint === 'string') : []
  const serverTokens = new Set(splitTokens(serverName))
  const scores = new Map()
  const bump = (token, weight) => {
    const key = token.toLowerCase()
    if (key.length < 3 || STOP_WORDS.has(key) || serverTokens.has(key) || /^\d+$/.test(key)) return
    scores.set(key, (scores.get(key) ?? 0) + weight)
  }
  for (const hint of hints) for (const token of splitTokens(hint)) bump(token, 4)
  for (const tool of catalog) {
    for (const token of splitTokens(tool.name)) bump(token, 3)
  }
  for (const tool of catalog) {
    for (const token of splitTokens(tool.description, { asciiOnly: true })) bump(token, 1)
  }
  return [...scores.entries()]
    .sort((left, right) => right[1] - left[1] || (left[0] < right[0] ? -1 : 1))
    .map(entry => entry[0])
}

/** Split text into lowercase tokens; CJK runs are skipped (aliases belong in serverProfiles). */
function splitTokens(value, { asciiOnly = false } = {}) {
  if (typeof value !== 'string' || value === '') return []
  const cleaned = value.replace(/^mcp__[A-Za-z0-9_-]{1,32}__/, '')
  return cleaned
    .split(asciiOnly ? /[^A-Za-z0-9_-]+/ : /[^A-Za-z0-9_\p{L}-]+/u)
    .flatMap(part => part.split(/[_-]+/))
    .flatMap(part => (asciiOnly || /^[A-Za-z0-9_-]+$/.test(part) ? [part] : []))
    .map(part => part.toLowerCase())
    .filter(part => part !== '')
}

function resolveViewConfig(config = {}) {
  return {
    descriptionChars: positiveInteger(config.descriptionChars, DEFAULT_DESCRIPTION_CHARS),
    keywordsPerServer: positiveInteger(config.keywordsPerServer, DEFAULT_KEYWORDS_PER_SERVER),
    profiles: config.serverProfiles !== null && typeof config.serverProfiles === 'object' ? config.serverProfiles : {}
  }
}

/** Build every server row (already capped per server, not yet capped by count). */
function buildServerViews(entries, config = {}) {
  const resolved = resolveViewConfig(config)
  return [...(entries ?? [])]
    .filter(entry => entry !== null && typeof entry === 'object' && typeof entry.serverName === 'string')
    .map(entry => serverView(entry, resolved))
    .sort((left, right) => (left.serverName < right.serverName ? -1 : left.serverName > right.serverName ? 1 : 0))
}

/** Read-only snapshot payload for `mcpLazy/snapshot`. */
function buildSnapshot({ entries, passthrough, signature }, config = {}, generatedAt = 0) {
  const views = buildServerViews(entries, config)
  const maxTools = positiveInteger(config.maxSnapshotTools, DEFAULT_MAX_SNAPSHOT_TOOLS)
  const servers = []
  let omittedTools = 0
  let budget = maxTools
  for (const view of views) {
    const tools = view.tools.slice(0, Math.max(0, budget))
    omittedTools += view.tools.length - tools.length
    budget -= tools.length
    servers.push({ ...view, toolCount: view.toolCount, tools })
  }
  const passthroughViews = [...(passthrough ?? [])]
    .filter(name => typeof name === 'string')
    .sort()
    .map(name => ({ name }))
  return {
    generatedAt,
    routerTool: ROUTER_TOOL_NAME,
    signature: String(signature ?? ''),
    serverCount: servers.length,
    toolCount: servers.reduce((total, server) => total + server.toolCount, 0),
    servers,
    omittedTools,
    passthrough: passthroughViews
  }
}

const INDEX_HEADERS = {
  zh: {
    title: '## MCP 服务器（按需加载）',
    intro: `以下 MCP 服务器的工具默认不在工具表里。需要时调用 \`${ROUTER_TOOL_NAME}\`：带 \`query\`（能力关键词）或 \`serverName\`（精确指定服务器名）；披露后当轮即可直接调用。`,
    tools: '个工具',
    keywords: '关键词',
    more: '另有 {count} 个服务器未列出：用 `query` 搜索，或直接指定 `serverName`。'
  },
  en: {
    title: '## MCP servers (loaded on demand)',
    intro: `The tools of these MCP servers are not in the tool table by default. Call \`${ROUTER_TOOL_NAME}\` with \`query\` (capability keywords) or \`serverName\` (exact name); a disclosed tool stays callable for the rest of the turn.`,
    tools: 'tools',
    keywords: 'keywords',
    more: '{count} more server(s) are not listed: search with `query` or name one with `serverName`.'
  }
}

/**
 * The injected index: one line per server (name, tool count, description or
 * keywords). Returns '' when nothing is managed, so an MCP-less deployment
 * pays nothing.
 */
function buildIndexText(views, config = {}) {
  const list = [...(views ?? [])].sort((left, right) =>
    left.serverName < right.serverName ? -1 : left.serverName > right.serverName ? 1 : 0)
  if (list.length === 0) return ''
  const locale = config.promptIndexLocale === 'en' ? 'en' : 'zh'
  const copy = INDEX_HEADERS[locale]
  const maxServers = positiveInteger(config.maxServers, DEFAULT_MAX_SERVERS)
  const shown = list.slice(0, maxServers)
  const lines = [copy.title, '', copy.intro, '']
  for (const view of shown) {
    const head = `- ${view.serverName}（${view.toolCount} ${copy.tools}）`
    if (view.description !== null) {
      const tail = view.keywords.length > 0 ? `（${copy.keywords}：${view.keywords.join(', ')}）` : ''
      lines.push(`${head}: ${view.description}${tail}`)
    } else {
      const tail = view.keywords.length > 0 ? view.keywords.join(', ') : '—'
      lines.push(`${head}: ${tail}`)
    }
  }
  const hidden = list.length - shown.length
  if (hidden > 0) lines.push(`- ${copy.more.replace('{count}', String(hidden))}`)
  return lines.join('\n')
}

/** Cache key: identical registries and config produce identical bytes. */
function indexSignatureKey(signature, config = {}) {
  return [
    String(signature ?? ''),
    config.promptIndexLocale === 'en' ? 'en' : 'zh',
    String(positiveInteger(config.maxServers, DEFAULT_MAX_SERVERS)),
    String(positiveInteger(config.keywordsPerServer, DEFAULT_KEYWORDS_PER_SERVER)),
    String(positiveInteger(config.descriptionChars, DEFAULT_DESCRIPTION_CHARS)),
    JSON.stringify(config.serverProfiles ?? {})
  ].join('\u0000')
}

export {
  DEFAULT_KEYWORDS_PER_SERVER,
  DEFAULT_MAX_SERVERS,
  DEFAULT_MAX_SNAPSHOT_TOOLS,
  ROUTER_TOOL_NAME,
  buildIndexText,
  buildServerViews,
  buildSnapshot,
  deriveKeywords,
  indexSignatureKey,
  splitTokens,
  truncate
}
