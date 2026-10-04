import { buildMcpCatalog } from './mcp-catalog.js'
import { DESCRIBE_TOOL_NAME } from './profile-tool.js'
import {
  ROUTER_TOOL_NAME,
  getRouterEntryStatus,
  registerRouterVisibility
} from './tool-router.js'

/** The plugin's own `mcp__router__*` tools: never mistaken for a managed server. */
const OWNED_TOOL_NAMES = [ROUTER_TOOL_NAME, DESCRIBE_TOOL_NAME]

const managers = new WeakMap()

function emptyCatalog() {
  return { signature: 'empty', servers: new Map(), passthrough: new Set() }
}

function aggregate(errors, message) {
  return new AggregateError(errors, message)
}

function safeMessage(error) {
  if (error instanceof AggregateError) return 'AggregateError'
  if (error instanceof Error) return error.name || 'Error'
  return 'unknown error'
}

function installUniversalManager(adapter, options = {}) {
  if (!adapter?.supported || (typeof adapter.identity !== 'object' && typeof adapter.identity !== 'function')) {
    adapter?.log?.('error', 'mcp-lazy manager: universal DSH capabilities are unavailable; leaving tools unchanged')
    return () => {}
  }

  const existing = managers.get(adapter.identity)
  if (existing !== undefined) {
    const owner = {}
    existing.owners.set(owner, adapter)
    options.onReady?.(existing.controller)
    return createOwnerDisposer(existing, owner)
  }

  const record = createManagerRecord(adapter, options)
  const owner = {}
  record.owners.set(owner, adapter)
  record.resourceOwner = owner
  managers.set(adapter.identity, record)
  try {
    record.routerDisposer = registerRouterVisibility(adapter, record.controller)
    record.listenerDisposers = installListeners(adapter, record)
    record.controller.reconcile()
    options.onReady?.(record.controller)
  } catch (error) {
    managers.delete(adapter.identity)
    const cleanupErrors = cleanupManager(record)
    adapter.log('error', `mcp-lazy manager: setup failed; leaving tools unchanged (${safeMessage(error)})`)
    for (const cleanupError of cleanupErrors) {
      adapter.log('error', `mcp-lazy manager: setup cleanup failed (${safeMessage(cleanupError)})`)
    }
    return () => {}
  }
  return createOwnerDisposer(record, owner)
}

function createManagerRecord(adapter, options = {}) {
  const record = {
    adapter,
    // Optional live source of extra routing hints (panel-authored aliases and
    // descriptions). Optional on purpose: a host without the store simply keeps
    // routing on server names and tool definitions.
    hintsOf: typeof options.hintsOf === 'function' ? options.hintsOf : undefined,
    // 常驻（pinned）的服务器不参与接管：它们的工具常显，也不进路由与提示词索引。
    // 面板把它做成每台服务器的开关，所以这里在读的时候问一次，随时可变。
    isPinnedOf: typeof options.isPinnedOf === 'function' ? options.isPinnedOf : undefined,
    owners: new Map(),
    resourceOwner: undefined,
    agents: new Map(),
    retiredAgents: new Set(),
    retiredCleanupInProgress: false,
    catalog: emptyCatalog(),
    reconciling: false,
    reconcilePending: false,
    catalogFailureLogged: false,
    disposed: false,
    listenerDisposers: new Set(),
    orphanDisposers: new Set(),
    routerDisposer: undefined,
    controller: undefined
  }

  record.controller = {
    getEntries() {
      // Only the servers we actually hide are routable; a 常驻 server's tools are
      // never denied, so offering it to the router would be a lie.
      return [...routableServers(record).values()].map(server => routerEntryForServer(server, record))
    },
    // Read-only catalog view for the settings panel and the prompt index. It
    // returns router-shaped entries (same factory the router scores against),
    // so what the panel shows and what the prompt advertises are exactly what
    // routing searches. Every admitted server is listed — including 常驻 ones,
    // which carry `pinned: true` so the view layer skips them in the index and
    // the panel can render their switch. Never hands out the live Maps.
    currentCatalog() {
      return {
        signature: record.catalog.signature,
        entries: [...admittedServers(record).values()].map(server => routerEntryForServer(server, record)),
        passthrough: [...record.catalog.passthrough]
      }
    },
    reconcile() {
      reconcile(record)
    },
    // A 常驻/收起 flip changes the deny mask but not the catalog signature, so
    // the panel needs this door (reconcile() would short-circuit).
    reconcilePins() {
      reconcilePinned(record)
    },
    onAgentCreated(event) {
      onAgentCreated(record, event?.agent)
    },
    onTurnStopping(event) {
      onTurnStopping(record, event?.agent)
    },
    onAgentDisposed(event) {
      onAgentDisposed(record, event?.agent)
    },
    reveal(agent, serverName) {
      return reveal(record, agent, serverName)
    },
    onRouterStateChange() {
      refreshRestrictions(record)
    }
  }
  return record
}

function installListeners(adapter, record) {
  const disposers = new Set()
  try {
    for (const [event, handler] of [
      ['tools/change', () => record.controller.reconcile()],
      ['agent/created', event => record.controller.onAgentCreated(event)],
      ['agent/turn-stopping', event => record.controller.onTurnStopping(event)],
      ['agent/disposed', event => record.controller.onAgentDisposed(event)]
    ]) {
      const dispose = adapter.on(event, handler)
      if (typeof dispose !== 'function') throw new Error(`event listener ${event} did not return a disposer`)
      disposers.add(dispose)
    }
  } catch (error) {
    const errors = [error, ...disposeHandles(disposers)]
    throw aggregate(errors, 'manager listener installation failed')
  }
  return disposers
}

function createOwnerDisposer(record, owner) {
  let released = false
  return () => {
    if (released) {
      if (!record.disposed) return
      const retryErrors = cleanupManager(record)
      if (retryErrors.length > 0) throw aggregate(retryErrors, 'universal MCP manager cleanup retry failed')
      return
    }
    released = true
    const wasResourceOwner = record.resourceOwner === owner
    record.owners.delete(owner)
    if (record.owners.size > 0) {
      if (wasResourceOwner) {
        try {
          transferManagerResources(record, record.owners.entries().next().value)
        } catch (error) {
          record.disposed = true
          managers.delete(record.adapter.identity)
          const cleanupErrors = cleanupManager(record)
          throw aggregate([error, ...cleanupErrors], 'manager transfer failed; universal filtering was removed')
        }
      }
      return
    }
    if (record.disposed) {
      const retryErrors = cleanupManager(record)
      if (retryErrors.length > 0) throw aggregate(retryErrors, 'universal MCP manager cleanup retry failed')
      return
    }
    record.disposed = true
    managers.delete(record.adapter.identity)
    const errors = cleanupManager(record)
    if (errors.length > 0) throw aggregate(errors, 'universal MCP manager cleanup failed')
  }
}

function transferManagerResources(record, [nextOwner, nextAdapter]) {
  const nextListeners = installListeners(nextAdapter, record)
  let transferError
  try {
    record.routerDisposer.transferTo(nextAdapter)
  } catch (error) {
    transferError = error
  }

  const previousListeners = record.listenerDisposers
  record.listenerDisposers = nextListeners
  record.resourceOwner = nextOwner
  record.adapter = nextAdapter
  const cleanupErrors = disposeHandles(previousListeners)
  for (const dispose of previousListeners) record.orphanDisposers.add(dispose)
  if (transferError !== undefined) {
    refreshRestrictions(record)
    throw aggregate([transferError, ...cleanupErrors], 'manager resource ownership transfer failed')
  }
  if (cleanupErrors.length > 0) {
    throw aggregate(cleanupErrors, 'previous manager resource cleanup failed after transfer')
  }
}

function cleanupManager(record) {
  const errors = []

  for (const agentRecord of record.agents.values()) record.retiredAgents.add(agentRecord)
  record.agents.clear()
  for (const agentRecord of [...record.retiredAgents]) {
    const cleanupErrors = disposeRestrictionHandles(agentRecord)
    errors.push(...cleanupErrors)
    if (agentRecord.restrictions.size === 0) record.retiredAgents.delete(agentRecord)
  }

  errors.push(...disposeHandles(record.listenerDisposers))
  errors.push(...disposeHandles(record.orphanDisposers))
  record.catalog = emptyCatalog()

  if (record.routerDisposer !== undefined) {
    try {
      record.routerDisposer()
      record.routerDisposer = undefined
    } catch (error) { errors.push(error) }
  }
  return errors
}

function disposeHandles(handles) {
  const errors = []
  for (const dispose of [...handles].reverse()) {
    try {
      dispose()
      handles.delete(dispose)
    } catch (error) {
      if (error instanceof AggregateError) errors.push(...error.errors)
      else errors.push(error)
    }
  }
  return errors
}

function reconcile(record) {
  if (record.disposed) return
  if (record.reconciling) {
    record.reconcilePending = true
    return
  }

  record.reconciling = true
  try {
    retryRetiredAgents(record)
    do {
      record.reconcilePending = false
      let next
      try {
        next = buildMcpCatalog({
          schemas: record.adapter.listToolSchemas(),
          getDefinition: name => record.adapter.getTool(name),
          ownedNames: OWNED_TOOL_NAMES
        })
      } catch (error) {
        record.catalog = emptyCatalog()
        if (!record.catalogFailureLogged) {
          record.catalogFailureLogged = true
          record.adapter.log('error', `mcp-lazy manager: catalog unavailable; leaving tools unchanged (${safeMessage(error)})`)
        }
        for (const agentRecord of record.agents.values()) {
          failOpen(record, agentRecord, error)
        }
        continue
      }

      record.catalogFailureLogged = false
      if (next.signature === record.catalog.signature) continue
      record.catalog = next
      refreshRestrictions(record, { retryRetired: false })
    } while (record.reconcilePending && !record.disposed)
  } finally {
    record.reconciling = false
  }
}

function onAgentCreated(record, agent) {
  if (record.disposed || agent === undefined || agent === null || record.agents.has(agent)) return
  const agentRecord = {
    agent,
    // 本会话已披露的服务器。累积语义：披露只增不减，会话销毁才释放 ——
    // 按轮收回会让宿主重建工具表（并丢掉 prompt cache）。
    revealedServers: new Set(),
    // 当前已装掩码的 name 列表（升序），未装或已放行为 undefined。用途只有一个：
    // 目标掩码与它相同时跳过拆装，避免无谓的工具表抖动。
    appliedDeny: undefined,
    restrictions: new Set(),
    bypassUntilTurnEnd: false,
    failureLogged: false
  }
  record.agents.set(agent, agentRecord)
  try {
    replaceRestriction(record, agentRecord)
  } catch (error) {
    failOpen(record, agentRecord, error)
  }
}

function onTurnStopping(record, agent) {
  const agentRecord = record.agents.get(agent)
  if (agentRecord === undefined || record.disposed) return
  // 轮次边界绝不收回本会话已披露的工具：收回是每轮一次的工具表变化，
  // 代价是 prompt cache。它只做两件事：
  //   1) 清掉 fail-open 的当轮放行；
  //   2) 在当前**没有任何掩码**时重试一次 —— 上一次目录读取不确定、管理器当
  //      时没敢接管（工具全可见，fail-open 方向）时补上控制权。
  // 已经装好的掩码一律不动，所以正常轮次对工具表零影响。
  const recovering = agentRecord.bypassUntilTurnEnd
  agentRecord.bypassUntilTurnEnd = false
  agentRecord.failureLogged = false
  if (!recovering && agentRecord.restrictions.size > 0) return
  try {
    replaceRestriction(record, agentRecord)
  } catch (error) {
    failOpen(record, agentRecord, error)
  }
}

function onAgentDisposed(record, agent) {
  const agentRecord = record.agents.get(agent)
  if (agentRecord === undefined) {
    retryRetiredAgent(record, agent)
    return
  }
  record.agents.delete(agent)
  const errors = disposeRestrictionHandles(agentRecord)
  if (agentRecord.restrictions.size > 0) record.retiredAgents.add(agentRecord)
  if (errors.length > 0) {
    record.adapter.log('error', `mcp-lazy manager: agent cleanup failed (${safeMessage(aggregate(errors, 'agent restriction cleanup failed'))})`)
  }
}

function retryRetiredAgent(record, agent) {
  retryRetiredAgents(record, agentRecord => agentRecord.agent === agent)
}

function retryRetiredAgents(record, predicate = () => true) {
  if (record.retiredCleanupInProgress) return
  record.retiredCleanupInProgress = true
  try {
    for (const agentRecord of [...record.retiredAgents]) {
      if (!predicate(agentRecord)) continue
      const errors = disposeRestrictionHandles(agentRecord)
      if (agentRecord.restrictions.size === 0) record.retiredAgents.delete(agentRecord)
      if (errors.length > 0) {
        record.adapter.log('error', `mcp-lazy manager: retired agent cleanup still incomplete (${safeMessage(aggregate(errors, 'retired restriction cleanup failed'))})`)
      }
    }
  } finally {
    record.retiredCleanupInProgress = false
  }
}

/** Live hints for one server; a throwing or non-array source degrades to none. */
function hintsOf(record, serverName) {
  try {
    const hints = record.hintsOf?.(serverName)
    return Array.isArray(hints) ? hints.filter(hint => typeof hint === 'string') : []
  } catch {
    return []
  }
}

/** 常驻开关；抛错或缺省都当作「收起」，也就是照旧接管。 */
function isPinned(record, serverName) {
  try {
    return record.isPinnedOf?.(serverName) === true
  } catch {
    return false
  }
}

function routerEntryForServer(server, record) {
  return {
    serverName: server.serverName,
    // A function, not a snapshot: a panel save must reach the next query
    // without a restart. tool-router and mcp-view both read this shape.
    routingHints: () => hintsOf(record, server.serverName),
    // 常驻的服务器只出现在面板快照里（pinned: true），索引会跳过它。
    pinned: isPinned(record, server.serverName),
    toolNames: server.toolNames,
    getDefinition: name => record.adapter.getTool(name),
    getCatalog: server.getCatalog
  }
}

/** Every admitted server, 常驻 or not: what the panel lists. */
function admittedServers(record) {
  const servers = new Map()
  for (const [serverName, server] of record.catalog.servers) {
    const status = getRouterEntryStatus(record.adapter, routerEntryForServer(server, record))
    if (status.available && (status.kind === 'passive' || status.kind === 'managed')) {
      servers.set(serverName, server)
    }
  }
  return servers
}

/**
 * The servers this plugin actually takes over — admitted minus 常驻.
 *
 * `replaceRestriction` denies exactly these servers' tools, so leaving a server
 * out is what "常驻" means: its tools stay in every session and the model reads
 * their schemas directly, so the index must not advertise it as well.
 */
function routableServers(record) {
  const servers = new Map()
  for (const [serverName, server] of admittedServers(record)) {
    if (isPinned(record, serverName)) continue
    servers.set(serverName, server)
  }
  return servers
}

/**
 * Re-evaluate every live agent after the pin set changed.
 *
 * A switch flip has to take effect at once: 常驻 means the deny mask must drop
 * that server (tools reappear), 收起 means it must come back under management.
 */
function reconcilePinned(record) {
  if (record.disposed) return
  try {
    refreshRestrictions(record)
  } catch (error) {
    record.adapter.log('error', `mcp-lazy manager: pin change could not be applied (${safeMessage(error)})`)
  }
}

function refreshRestrictions(record, { retryRetired = true } = {}) {
  if (record.disposed) return
  if (retryRetired) retryRetiredAgents(record)
  const routable = routableServers(record)
  for (const agentRecord of record.agents.values()) {
    if (agentRecord.bypassUntilTurnEnd) continue
    try {
      replaceRestriction(record, agentRecord, routable)
    } catch (error) {
      failOpen(record, agentRecord, error)
    }
  }
}

/**
 * Install the deny mask for one agent: everything routable except the servers this
 * session has already disclosed.
 *
 * Two properties matter beyond correctness:
 *  - A disclosed server that left the catalog (or became 常驻) is pruned here
 *    instead of throwing: the session keeps working, it just loses that entry.
 *  - A mask that already denies exactly this set is left in place. Replacing it
 *    would make the host rebuild the tool table for nothing, which is precisely
 *    the churn that breaks prompt caching.
 */
function replaceRestriction(record, agentRecord, routable = routableServers(record)) {
  if (agentRecord.bypassUntilTurnEnd) return
  for (const serverName of agentRecord.revealedServers) {
    if (!routable.has(serverName)) agentRecord.revealedServers.delete(serverName)
  }

  const deny = []
  for (const [serverName, server] of routable) {
    if (!agentRecord.revealedServers.has(serverName)) deny.push(...server.toolNames)
  }
  deny.sort()
  const previous = new Set(agentRecord.restrictions)
  if (deny.length === 0) {
    agentRecord.appliedDeny = undefined
    if (previous.size === 0) return
    const cleanupErrors = disposeRestrictionHandles(agentRecord, previous)
    if (cleanupErrors.length > 0) throw aggregate(cleanupErrors, 'restriction removal failed')
    return
  }
  if (previous.size > 0 && sameDeny(agentRecord.appliedDeny, deny)) return

  // Record the target mask *before* installing it: a re-entrant reconcile (the
  // host may emit tools/change from inside restrict) must see the target, not the
  // mask it is replacing.
  agentRecord.appliedDeny = deny
  let next
  try {
    next = record.adapter.restrictAgentTools(agentRecord.agent, deny)
    if (typeof next !== 'function') throw new Error('scoped tools.restrict did not return a disposer')
  } catch (error) {
    agentRecord.appliedDeny = undefined
    const cleanupErrors = disposeRestrictionHandles(agentRecord, previous)
    if (cleanupErrors.length === 0) throw error
    throw aggregate([error, ...cleanupErrors], 'restriction replacement and fail-open cleanup failed')
  }

  agentRecord.restrictions.add(next)
  const cleanupErrors = disposeRestrictionHandles(agentRecord, previous)
  if (cleanupErrors.length > 0) throw aggregate(cleanupErrors, 'old restriction cleanup failed')
}

/** Deny lists are sorted name arrays, so a positional compare is enough. */
function sameDeny(applied, deny) {
  if (!Array.isArray(applied) || applied.length !== deny.length) return false
  for (let index = 0; index < deny.length; index += 1) {
    if (applied[index] !== deny[index]) return false
  }
  return true
}

function disposeRestrictionHandles(agentRecord, handles = new Set(agentRecord.restrictions)) {
  const errors = []
  for (const restriction of handles) {
    if (!agentRecord.restrictions.has(restriction)) continue
    try {
      restriction()
      // A throwing disposer may still represent an active deny mask, so only a
      // successful call permits forgetting the handle.
      agentRecord.restrictions.delete(restriction)
    } catch (error) {
      if (error instanceof AggregateError) errors.push(...error.errors)
      else errors.push(error)
    }
  }
  return errors
}

function failOpen(record, agentRecord, error) {
  // Fail-open is a safety valve, not a retraction: the session keeps the servers
  // it already disclosed, and the next reconcile (or turn boundary) rebuilds the
  // mask from the catalog as it is then.
  agentRecord.appliedDeny = undefined
  agentRecord.bypassUntilTurnEnd = true
  let failure = error
  const cleanupErrors = disposeRestrictionHandles(agentRecord)
  if (cleanupErrors.length > 0) failure = aggregate([error, ...cleanupErrors], 'manager failure and restriction cleanup failed')
  if (!agentRecord.failureLogged) {
    agentRecord.failureLogged = true
    const message = agentRecord.restrictions.size === 0
      ? 'mcp-lazy manager: scoped disclosure unavailable; agent left unrestricted'
      : 'mcp-lazy manager: scoped disclosure unavailable; restriction cleanup incomplete and retained for retry'
    record.adapter.log('error', `${message} (${safeMessage(failure)})`)
  }
  return failure
}

function reveal(record, agent, serverName) {
  const agentRecord = record.agents.get(agent)
  if (agentRecord === undefined) throw new Error('requesting agent is not managed')
  if (agentRecord.bypassUntilTurnEnd) throw new Error('agent disclosure is bypassed until the next turn boundary')
  const routable = routableServers(record)
  const server = routable.get(serverName)
  if (server === undefined) {
    throw failOpen(record, agentRecord, new Error(`MCP server "${serverName}" is not admitted and routable`))
  }

  // Accumulate: a session that already disclosed another server keeps it. The
  // repeat case is idempotent — replaceRestriction leaves an identical mask alone.
  agentRecord.revealedServers.add(serverName)
  try {
    replaceRestriction(record, agentRecord, routable)
  } catch (error) {
    throw failOpen(record, agentRecord, error)
  }
  return `${server.toolNames.length} 个工具已披露（本会话内保持可见）`
}

export { installUniversalManager }
