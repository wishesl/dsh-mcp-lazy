import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PROMPT_MESSAGE_FORM,
  PROMPT_MESSAGE_KIND,
  createPromptMessenger,
  installPromptMessages,
  loadMessageFactory
} from '../lib/prompt-message.js'

const TEXT = '## MCP 服务器（按需加载）\n\n- playwright（25 个工具）: browser'

/** A stand-in agent: a real one offers inject() plus the pending inbox lists. */
function fakeAgent(id = 'agent-1') {
  // `injected` is the durable log (what the model will see, forever); `pending`
  // is what the loop has not drained yet — only the pending copy is droppable.
  const injected = []
  const pending = []
  const removed = []
  const inbox = {
    get nextStep() {
      return pending
    },
    nextTurn: [],
    remove(messageId) {
      removed.push(messageId)
      const at = pending.findIndex(message => message.id === messageId)
      if (at >= 0) {
        pending.splice(at, 1)
        return true
      }
      return false
    }
  }
  return {
    id,
    injected,
    pending,
    removed,
    inbox,
    inject(message) {
      injected.push(message)
      pending.push(message)
    }
  }
}

const factory = (input) => Object.freeze({ id: `msg-${Math.random()}`, role: 'user', content: input.content, source: input.source })

test('queues one user-role message carrying our own source', () => {
  const agent = fakeAgent()
  const messenger = createPromptMessenger({ createUserMessage: factory, readText: () => TEXT })

  assert.equal(messenger.injectFor(agent), true)
  assert.equal(agent.injected.length, 1)
  const message = agent.injected[0]
  assert.equal(message.role, 'user')
  assert.deepEqual(message.content, [{ type: 'text', text: TEXT }])
  // The client labels the row from `kind` (contextProducer default) and picks a
  // structured presentation from `form` (KNOWN_FORMS) — both are load-bearing.
  assert.deepEqual(message.source, { kind: PROMPT_MESSAGE_KIND, form: PROMPT_MESSAGE_FORM })
  assert.equal(messenger.size(), 1)
})

test('does not queue twice for the same text and re-queues after a change', () => {
  const agent = fakeAgent()
  let text = TEXT
  const messenger = createPromptMessenger({ createUserMessage: factory, readText: () => text })

  messenger.injectFor(agent)
  assert.equal(messenger.injectFor(agent), false, 'an unchanged index must not be queued again')
  assert.equal(agent.injected.length, 1)

  text = `${TEXT}\n- tavily（5 个工具）: search`
  assert.equal(messenger.injectFor(agent), true)
  // The stale *pending* copy is dropped first, so the loop never drains both;
  // the already-claimed one stays in the log (it is history).
  assert.equal(agent.removed.length, 1)
  assert.equal(agent.injected.length, 2)
  assert.equal(agent.pending.length, 1)
  assert.match(agent.injected[1].content[0].text, /tavily/)
})

test('an empty index queues nothing and a mutation-free agent is skipped', () => {
  const messenger = createPromptMessenger({ createUserMessage: factory, readText: () => '' })
  const agent = fakeAgent()
  assert.equal(messenger.injectFor(agent), false)
  assert.equal(agent.injected.length, 0)

  const text = createPromptMessenger({ createUserMessage: factory, readText: () => TEXT })
  assert.equal(text.injectFor({ id: 'bare' }), false, 'an agent without inject() is left alone')
  assert.equal(text.injectFor(undefined), false)
})

test('a throwing inject() is reported and never propagates', () => {
  const warnings = []
  const messenger = createPromptMessenger({
    createUserMessage: factory,
    readText: () => TEXT,
    logger: { warn: (message) => warnings.push(message) }
  })
  const agent = fakeAgent()
  agent.inject = () => { throw new Error('inbox exploded') }

  assert.equal(messenger.injectFor(agent), false)
  assert.equal(messenger.state.failed, 1)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /inbox exploded/)
  // A failed agent is not recorded, so a later attempt can still succeed.
  agent.inject = fakeAgent().inject
  assert.equal(messenger.injectFor(agent), true)
})

test('refresh re-queues only the agents whose copy went stale', () => {
  const first = fakeAgent('a')
  const second = fakeAgent('b')
  let text = TEXT
  const messenger = createPromptMessenger({ createUserMessage: factory, readText: () => text })
  messenger.injectFor(first)

  text = `${TEXT}\n- chrome-devtools（30 个工具）: page`
  messenger.injectFor(second)
  assert.equal(first.injected.length, 1)
  assert.equal(second.injected.length, 1)
  // first is stale, second is current → exactly one re-queue.
  assert.equal(messenger.refresh(), 1)
  assert.equal(first.injected.length, 2)
  assert.equal(second.injected.length, 1)

  messenger.forget(first)
  assert.equal(messenger.size(), 1)
  assert.equal(messenger.refresh(), 0)
})

test('installPromptMessages backfills live agents and follows the lifecycle', async () => {
  const live = fakeAgent('live')
  const handlers = new Map()
  const ctx = { get: (name) => (name === 'agents' ? { list: () => [live] } : undefined) }
  const adapter = {
    on(event, handler) {
      handlers.set(event, handler)
      return () => handlers.delete(event)
    }
  }

  const channel = await installPromptMessages(ctx, adapter, { readText: () => TEXT })
  assert.equal(channel.available, true)
  assert.equal(live.injected.length, 1, 'a session that already exists still gets the index')

  const created = fakeAgent('created')
  handlers.get('agent/created')({ agent: created })
  assert.equal(created.injected.length, 1)
  assert.equal(channel.messenger.size(), 2)

  const disposed = fakeAgent('gone')
  handlers.get('agent/created')({ agent: disposed })
  handlers.get('agent/disposed')({ agent: disposed })
  assert.equal(channel.messenger.size(), 2, 'a disposed agent leaves the registry behind')

  channel.dispose()
  assert.equal(channel.messenger.size(), 0)
  assert.equal(handlers.size, 0)
})

test('installPromptMessages stays out of the way when the host cannot carry a message', async () => {
  // No agents service and no event surface: the caller must fall back to the
  // systemPrompt channels instead of silently dropping the index.
  const channel = await installPromptMessages({ get: () => undefined }, undefined, { readText: () => TEXT })
  assert.equal(channel.available, false)
  assert.equal(channel.refresh(), 0)
  channel.dispose()

  // A throwing agents service is a failed install, not a thrown plugin.
  const warnings = []
  const boom = {
    get: () => ({ list: () => { throw new Error('registry down') } })
  }
  const failed = await installPromptMessages(boom, undefined, { readText: () => TEXT, logger: { warn: (m) => warnings.push(m) } })
  assert.equal(failed.available, false)
  assert.match(warnings[0], /registry down/)
})

test('the local message shape is the host shape when dsh-llm is unavailable', async () => {
  const createUserMessage = await loadMessageFactory()
  const message = createUserMessage({ content: [{ type: 'text', text: 'x' }], source: { kind: PROMPT_MESSAGE_KIND } })
  // Both the host factory and the local equivalent produce this shape; the base
  // lane runs without @deepseek-ai/dsh-llm, so this is the local one.
  assert.equal(message.role, 'user')
  assert.equal(typeof message.id, 'string')
  assert.ok(message.id.length > 0)
  assert.deepEqual(message.content, [{ type: 'text', text: 'x' }])
  assert.deepEqual(message.source, { kind: PROMPT_MESSAGE_KIND })
  assert.equal(Object.isFrozen(message), true)
})
