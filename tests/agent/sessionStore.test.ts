import { mkdtempSync } from 'fs'
import { rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, AgentSession } from '../../src/shared/agent/protocol'

let userData = ''

vi.mock('electron', () => ({
  app: {
    getPath: () => userData,
  },
}))

function session(): AgentSession {
  return {
    id: `session_${Date.now()}`,
    workspace: null,
    title: 'test',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'idle',
    permissionMode: 'ask',
  }
}

afterEach(async () => {
  if (userData) await rm(userData, { recursive: true, force: true })
  vi.resetModules()
})

describe('sessionStore', () => {
  it('appends and replays schema-versioned events', async () => {
    userData = mkdtempSync(join(tmpdir(), 'rille-session-'))
    const store = await import('../../src/main/agent/sessionStore')
    const meta = session()
    const event: AgentEvent = { type: 'session.created', session: meta }
    await store.appendSessionEvent(event)
    await expect(store.readSessionEvents(meta.id)).resolves.toEqual([event])
  })

  it('ignores corrupt jsonl lines during replay', async () => {
    userData = mkdtempSync(join(tmpdir(), 'rille-session-'))
    const store = await import('../../src/main/agent/sessionStore')
    const meta = session()
    await store.appendSessionEvent({ type: 'session.created', session: meta })
    const events = await store.readSessionEvents(meta.id)
    expect(events).toHaveLength(1)
  })
})

