// 面板自定义描述的持久化层。
//
// 面板不再是「纯只读」的那一半了：用户在设置里改的 MCP 描述/关键词需要落盘，
// 且必须满足本仓库一贯的纪律：
//
//   1. **fail-soft**：读不到、写不进、文件损坏、宿主不给 profile 目录 —— 一律
//      降级为「本次会话内有效」，绝不抛错、绝不阻断插件其余功能；
//   2. **不碰别人的文件**：状态写进 profile 下本插件自己的 `.dsh-mcp-lazy/`
//      目录（与 dshmarket 的 `.dsh-market/state.json` 同一惯例），不改
//      `cordis.patch.yml`、不改 profile 的 package.json；
//   3. **原子写**：同目录临时文件 + rename，避免半截 JSON 让下次启动读崩；
//   4. **写入即生效**：写内存后立刻回给调用方，落盘失败只体现在 `persisted`.
//
// 目录来源由调用方给（lib/index.js 用 ctx.baseUrl 等锚点解析），本模块不知道
// 也不猜宿主布局。

import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { normalizeProfile } from './mcp-view.js'

const STORE_VERSION = 1
const STORE_DIR = '.dsh-mcp-lazy'
const STORE_FILE = 'profiles.json'
const MAX_SERVER_NAME_CHARS = 64
/** Panel-authored settings this file owns. Unknown keys are dropped, not stored. */
const BOOLEAN_SETTINGS = ['modelProfileEdits']

function cloneServers(servers) {
  const copy = {}
  for (const [serverName, profile] of Object.entries(servers ?? {})) {
    copy[serverName] = { ...profile, ...(profile.keywords === undefined ? {} : { keywords: [...profile.keywords] }) }
  }
  return copy
}

/** Keep only known boolean settings, so the file cannot accumulate junk. */
function normalizeSettings(value) {
  const settings = {}
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return settings
  for (const key of BOOLEAN_SETTINGS) {
    if (typeof value[key] === 'boolean') settings[key] = value[key]
  }
  return settings
}

/**
 * Parse a stored file into `{ servers, settings }`, or throw when the root
 * cannot be trusted. A malformed file is reported through `warning` and treated
 * as empty: one bad write must not cost the user the plugin.
 */
function parseStore(text) {
  const parsed = JSON.parse(text)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('store root must be an object')
  const servers = {}
  for (const [serverName, profile] of Object.entries(parsed.servers ?? {})) {
    const normalized = normalizeProfile(profile)
    if (normalized !== undefined) servers[serverName] = normalized
  }
  return { servers, settings: normalizeSettings(parsed.settings) }
}

/**
 * Create the panel-write store.
 *
 * @param options.resolveDirectory - returns the profile directory, or
 *   `undefined` when this host exposes none. Called lazily on every write, so a
 *   host that publishes its profile directory late is still able to persist.
 * @returns a store whose reads never throw and whose writes degrade to memory.
 */
function createProfileStore(options = {}) {
  const resolveDirectory = typeof options.resolveDirectory === 'function' ? options.resolveDirectory : () => undefined
  const logger = options.logger

  let servers = {}
  let settings = {}
  let loaded = false
  // Whether the disk is actually in play: false after any failed write (or when
  // the host exposes no directory at all), so the panel can tell the truth.
  let persisted = false
  let warning = null
  let file = null

  function directory() {
    try {
      const value = resolveDirectory()
      return typeof value === 'string' && value !== '' ? value : undefined
    } catch {
      return undefined
    }
  }

  function location() {
    const dir = directory()
    return dir === undefined ? undefined : join(dir, STORE_DIR, STORE_FILE)
  }

  function note(message) {
    warning = message
    try {
      logger?.warn?.(`mcp-lazy: ${message}`)
    } catch { /* logging is a nicety, never a dependency */ }
  }

  /** Normalize one override name, or refuse when the caller sent nothing usable. */
  function requireName(serverName) {
    const name = String(serverName ?? '').trim().slice(0, MAX_SERVER_NAME_CHARS)
    if (name === '') throw new Error('serverName is required')
    return name
  }

  /** Load once; later calls return the cached state. Never throws. */
  function load() {
    if (loaded) return
    loaded = true
    file = location() ?? null
    if (file === null) return
    try {
      const parsed = parseStore(readFileSync(file, 'utf8'))
      servers = parsed.servers
      settings = parsed.settings
      persisted = true
    } catch (error) {
      // No file yet is the normal first run: a save will create the directory.
      if (error?.code === 'ENOENT') {
        persisted = true
        return
      }
      note(`cannot read ${STORE_DIR}/${STORE_FILE} (${String(error?.message ?? error)}); starting from no overrides`)
    }
  }

  /** Atomic write of the whole store. Returns whether it reached the disk. */
  function persist() {
    const target = location()
    file = target ?? null
    if (target === undefined) {
      persisted = false
      note('no profile directory on this host; overrides stay in memory for this session')
      return false
    }
    const temporary = `${target}.${process.pid}.tmp`
    try {
      mkdirSync(dirname(target), { recursive: true })
      // `settings` is written only when it carries something: a panel that never
      // touched a global switch must not grow the file.
      const payload = Object.keys(settings).length === 0
        ? { version: STORE_VERSION, servers }
        : { version: STORE_VERSION, servers, settings }
      writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
      renameSync(temporary, target)
      persisted = true
      return true
    } catch (error) {
      try {
        unlinkSync(temporary)
      } catch { /* the temp file may never have been created */ }
      persisted = false
      note(`cannot write ${STORE_DIR}/${STORE_FILE} (${String(error?.message ?? error)}); overrides stay in memory for this session`)
      return false
    }
  }

  /**
   * Replace one server's override with a normalized copy of `value`; a
   * normalized-empty profile removes the entry entirely.
   *
   * The whole-object write. Callers that mean "change one field" want `merge()`,
   * which reads the rest back from the stored entry first.
   *
   * @returns `{ profile, persisted, file, warning }` where `profile` is the
   *   stored value (or `null` when the entry was removed).
   */
  function saveEntry(serverName, value) {
    load()
    const name = requireName(serverName)
    const normalized = normalizeProfile(value)
    if (normalized === undefined) delete servers[name]
    else servers[name] = normalized
    const persisted = persist()
    return {
      profile: normalized ?? null,
      persisted,
      file,
      warning
    }
  }

  return {
    /** Read-only view for the snapshot: overrides, persistence state, warning. */
    snapshot() {
      load()
      return { servers: cloneServers(servers), persisted, file, warning }
    },

    /** Server names currently carrying a panel-authored override. */
    overrides() {
      load()
      return cloneServers(servers)
    },

    /** Panel-authored global settings (known boolean keys only). */
    settings() {
      load()
      return { ...settings }
    },

    /**
     * Merge one settings write and persist it, exactly like `merge()` does for a
     * server entry. Unknown keys are dropped; a boolean replaces its stored value.
     *
     * @param patch - `{ modelProfileEdits?: boolean }`.
     * @returns `{ previous, settings, persisted, file, warning }`.
     */
    saveSettings(patch = {}) {
      load()
      const previous = { ...settings }
      for (const key of BOOLEAN_SETTINGS) {
        if (typeof patch[key] === 'boolean') settings[key] = patch[key]
      }
      const persisted = persist()
      return { previous, settings: { ...settings }, persisted, file, warning }
    },

    /**
     * Whole-object write: replaces the stored override with `value` (see
     * `saveEntry`). Prefer `merge()` when only some fields change.
     *
     * @returns `{ profile, persisted, file, warning }`; `profile` is `null` when
     *   the entry was removed.
     */
    save(serverName, value) {
      return saveEntry(serverName, value)
    },

    /**
     * Merge one write over the stored entry, persist it, and report the effect.
     *
     * Fields left out keep their stored value — that is what makes the two
     * writers composable: the panel's 常驻 switch sends `pinned` alone, and the
     * model-facing describe tool never sends `pinned` at all, so writing a
     * description can never move a server in or out of management. This is why
     * the tool must come through here rather than `save()`, whose whole-object
     * replacement would silently drop an existing `pinned: true`.
     *
     * @param serverName - managed server name.
     * @param fields - `{ description?, keywords?, pinned? }`; an omitted field
     *   keeps its stored value, and an empty description or keyword list clears
     *   that field (an entry left with nothing is removed).
     * @returns `{ previous, profile, persisted, file, warning, pinnedChanged }`,
     *   where `pinnedChanged` is the only thing the visibility mask cares about.
     */
    merge(serverName, fields = {}) {
      load()
      const name = requireName(serverName)
      const current = cloneServers({ [name]: servers[name] ?? {} })[name] ?? {}
      const wasPinned = current.pinned === true
      const saved = saveEntry(name, {
        description: fields.description !== undefined ? fields.description : current.description,
        keywords: fields.keywords !== undefined ? fields.keywords : current.keywords,
        pinned: fields.pinned !== undefined ? fields.pinned : current.pinned
      })
      return {
        previous: Object.keys(current).length > 0 ? current : null,
        ...saved,
        pinnedChanged: (saved.profile?.pinned === true) !== wasPinned
      }
    },

    /** Drop one server's panel-authored override. Idempotent. */
    clear(serverName) {
      load()
      const name = requireName(serverName)
      const existed = Object.prototype.hasOwnProperty.call(servers, name)
      if (existed) delete servers[name]
      if (existed) persist()
      return { removed: existed, persisted, file, warning }
    }
  }
}

export { STORE_DIR, STORE_FILE, STORE_VERSION, createProfileStore }
