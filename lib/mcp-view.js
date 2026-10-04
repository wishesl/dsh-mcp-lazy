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

/** Bounds for a user-authored server profile (panel editor and config alike). */
const MAX_OVERRIDE_DESCRIPTION_CHARS = 400
const MAX_OVERRIDE_KEYWORD_CHARS = 24
const MAX_OVERRIDE_KEYWORDS = 24

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
  const override = normalizeProfile(config.profiles?.[serverName]) ?? {}
  const origin = config.origins?.[serverName] ?? {}
  const profileKeywords = Array.isArray(override.keywords) ? override.keywords : []
  const derived = deriveKeywords(entry)
  const keywords = dedupe([...profileKeywords, ...derived], config.keywordsPerServer)
  const description = typeof override.description === 'string' && override.description !== ''
    ? truncate(override.description, config.descriptionChars)
    : null
  return {
    serverName,
    toolCount: catalog.length,
    keywords,
    description,
    tools: catalog.map(tool => ({
      name: String(tool.name ?? ''),
      description: truncate(tool.description, TOOL_DESCRIPTION_CHARS)
    })),
    // What the editor prefills: the effective override, never the capped or
    // derived list, so saving without touching a field cannot lose data.
    override: {
      description: override.description ?? null,
      keywords: override.keywords ?? null,
      pinned: override.pinned === true
    },
    // Which writer set each field, so the panel can badge a config-pinned value.
    overrideSource: {
      description: origin.description ?? null,
      keywords: origin.keywords ?? null,
      pinned: origin.pinned ?? null
    },
    // 常驻：工具常显、不进索引。收起（默认）才由本插件接管并写进索引。
    pinned: override.pinned === true
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
 * Normalize one user-authored server profile.
 *
 * Both writers go through here — the `serverProfiles` config key and the panel
 * editor — so an override can never carry a shape the injected index cannot
 * render. A description is folded onto one line on purpose: the index is a
 * one-line-per-server list. Returns `undefined` when nothing survives, which is
 * what "no override for this field" means everywhere else.
 */
function normalizeProfile(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const result = {}
  if (typeof value.description === 'string') {
    const text = value.description.replace(/\s+/g, ' ').trim().slice(0, MAX_OVERRIDE_DESCRIPTION_CHARS)
    if (text !== '') result.description = text
  }
  if (Array.isArray(value.keywords)) {
    const cleaned = []
    for (const keyword of value.keywords) {
      if (typeof keyword !== 'string') continue
      const text = keyword.replace(/\s+/g, ' ').trim().slice(0, MAX_OVERRIDE_KEYWORD_CHARS)
      if (text === '') continue
      cleaned.push(text)
      if (cleaned.length >= MAX_OVERRIDE_KEYWORDS) break
    }
    const keywords = dedupe(cleaned, MAX_OVERRIDE_KEYWORDS)
    if (keywords.length > 0) result.keywords = keywords
  }
  // 收起（默认）＝被接管、进索引；常驻＝工具常显、不进索引。只存 true，
  // 让「收起」始终表现为「没有这个字段」，读取侧只需 `=== true`。
  if (value.pinned === true) result.pinned = true
  return Object.keys(result).length > 0 ? result : undefined
}

/** Field-level origin of one override: `config` (hand-written YAML) or `custom` (panel). */
function profileOrigins(fromConfig, fromStore) {
  return {
    description: fromConfig?.description !== undefined
      ? 'config'
      : fromStore?.description !== undefined ? 'custom' : null,
    keywords: fromConfig?.keywords !== undefined
      ? 'config'
      : fromStore?.keywords !== undefined ? 'custom' : null,
    pinned: fromConfig?.pinned !== undefined
      ? 'config'
      : fromStore?.pinned !== undefined ? 'custom' : null
  }
}

/**
 * Field-level merge of the config key over the panel store.
 *
 * Returns both the merged profiles and, per field, which writer won — the
 * panel badges a `config` value so a user cannot wonder why their edit "did not
 * take".
 */
function mergeServerProfiles(configProfiles = {}, storeProfiles = {}) {
  const fromConfig = configProfiles !== null && typeof configProfiles === 'object' ? configProfiles : {}
  const fromStore = storeProfiles !== null && typeof storeProfiles === 'object' ? storeProfiles : {}
  const profiles = {}
  const origins = {}
  const names = new Set([...Object.keys(fromConfig), ...Object.keys(fromStore)])
  for (const serverName of names) {
    const configured = normalizeProfile(fromConfig[serverName])
    const authored = normalizeProfile(fromStore[serverName])
    const merged = { ...(authored ?? {}), ...(configured ?? {}) }
    if (Object.keys(merged).length === 0) continue
    profiles[serverName] = merged
    origins[serverName] = profileOrigins(configured, authored)
  }
  return { profiles, origins }
}

/**
 * Effective view config: the store's panel-authored overrides merged with the
 * hand-written `serverProfiles` config key.
 *
 * Precedence is **per field**, and the config wins: YAML in `cordis.patch.yml`
 * is an operator statement, and a panel that silently outvoted it would make the
 * file lie. A field the config does not set still takes the panel's value, and
 * the snapshot carries `overrideSource` so the panel can say which writer won.
 */
function withServerOverrides(config = {}, storeProfiles = {}) {
  const { profiles, origins } = mergeServerProfiles(config?.serverProfiles ?? {}, storeProfiles)
  return { ...config, serverProfiles: profiles, overlayOrigins: origins }
}

/**
 * Read one router entry's hints.
 *
 * Hints may be a function: the manager hands the router a live source so a
 * panel-authored alias takes effect on the next query instead of on the next
 * restart, while explicit lazy servers and the unit fixtures keep passing plain
 * arrays. Both shapes are accepted everywhere hints are read.
 */
function routingHintsOf(entry) {
  const value = typeof entry?.routingHints === 'function' ? entry.routingHints() : entry?.routingHints
  return Array.isArray(value) ? value.filter(hint => typeof hint === 'string') : []
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
  const hints = routingHintsOf(entry)
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
    profiles: config.serverProfiles !== null && typeof config.serverProfiles === 'object' ? config.serverProfiles : {},
    origins: config.overlayOrigins !== null && typeof config.overlayOrigins === 'object' ? config.overlayOrigins : {}
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
function buildSnapshot({ entries, passthrough, signature }, config = {}, generatedAt = 0, surfaces = {}) {
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
    // 常驻的服务器不进索引：面板据此提示「索引里只有收起的那几台」。
    pinnedCount: servers.filter(server => server.pinned === true).length,
    toolCount: servers.reduce((total, server) => total + server.toolCount, 0),
    servers,
    omittedTools,
    passthrough: passthroughViews,
    // What is actually injected into the model's prompt, verbatim, so the panel
    // can show the real artifact instead of a re-derivation. `reason` explains an
    // empty text (fail-soft host, `promptIndex: false`, no servers) and `channel`
    // names the surface that carries it.
    promptIndex: surfaces.promptIndex ?? {
      enabled: false,
      channel: 'none',
      name: 'mcp-lazy:index',
      order: null,
      locale: 'zh',
      reason: 'unavailable',
      text: ''
    },
    // Where panel-authored overrides live. `persisted: false` means this host
    // gave us no profile directory and edits only last for the session.
    store: surfaces.store ?? { persisted: false, file: null, warning: null },
    // Whether the model-facing describe tool is registered, and who decided it:
    // the hand-written `modelProfileEdits` config wins over the panel switch,
    // which wins over the built-in default.
    modelProfileEdits: surfaces.modelProfileEdits ?? { enabled: true, source: 'default' }
  }
}

/**
 * Resolve whether the model may write server profiles, and who decided.
 *
 * Precedence mirrors `serverProfiles`: a hand-written config key is an operator
 * statement and wins; the panel switch is the user's runtime choice; absent
 * both, the feature is on. The config key is declared without a default so
 * "explicitly set" stays distinguishable from "unset".
 *
 * @param config - effective manager config (`modelProfileEdits?: boolean`).
 * @param settings - panel-authored settings from the state file.
 * @returns `{ enabled, source }` with `source` = `config` | `panel` | `default`.
 */
function resolveModelProfileEdits(config = {}, settings = {}) {
  if (typeof config?.modelProfileEdits === 'boolean') {
    return { enabled: config.modelProfileEdits, source: 'config' }
  }
  if (typeof settings?.modelProfileEdits === 'boolean') {
    return { enabled: settings.modelProfileEdits, source: 'panel' }
  }
  return { enabled: true, source: 'default' }
}

const INDEX_HEADERS = {
  zh: {
    title: '## MCP 服务器（按需加载）',
    intro: `以下 MCP 服务器的工具默认不在工具表里。需要时调用 \`${ROUTER_TOOL_NAME}\`：带 \`query\`（能力关键词）或 \`serverName\`（精确指定服务器名）；披露后本次会话内一直可直接调用。`,
    tools: '个工具',
    keywords: '关键词',
    more: '另有 {count} 个服务器未列出：用 `query` 搜索，或直接指定 `serverName`。'
  },
  en: {
    title: '## MCP servers (loaded on demand)',
    intro: `The tools of these MCP servers are not in the tool table by default. Call \`${ROUTER_TOOL_NAME}\` with \`query\` (capability keywords) or \`serverName\` (exact name); a disclosed tool stays callable for the rest of the session.`,
    tools: 'tools',
    keywords: 'keywords',
    more: '{count} more server(s) are not listed: search with `query` or name one with `serverName`.'
  }
}

/**
 * The injected index: one line per **collapsed** server (name, tool count,
 * description or keywords). Servers switched to 常驻 keep their tools visible in
 * every session, so advertising them here would only spend tokens twice — they
 * are skipped. Returns '' when nothing is collapsed, so such a deployment pays
 * nothing at all.
 */
function buildIndexText(views, config = {}) {
  const list = [...(views ?? [])]
    .filter(view => view?.pinned !== true)
    .sort((left, right) =>
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

/**
 * Panel payload: the catalog snapshot plus the two live surfaces.
 *
 * The `available: false` answer means "this host has no universal manager", not
 * "the call failed" — the panel shows an explanation instead of an empty list.
 */
function buildPanelSnapshot(catalog, config = {}, generatedAt = 0, surfaces = {}) {
  const snapshot = buildSnapshot(catalog, config, generatedAt, surfaces)
  return { ...snapshot, available: catalog.signature !== 'empty' || snapshot.serverCount > 0 }
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
  MAX_OVERRIDE_DESCRIPTION_CHARS,
  MAX_OVERRIDE_KEYWORDS,
  MAX_OVERRIDE_KEYWORD_CHARS,
  ROUTER_TOOL_NAME,
  buildIndexText,
  buildPanelSnapshot,
  buildServerViews,
  buildSnapshot,
  deriveKeywords,
  indexSignatureKey,
  mergeServerProfiles,
  normalizeProfile,
  resolveModelProfileEdits,
  routingHintsOf,
  splitTokens,
  truncate,
  withServerOverrides
}
