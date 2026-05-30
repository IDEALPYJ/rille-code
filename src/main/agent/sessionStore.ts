import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { appendFile, readFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import type { AgentEvent, AgentSession, AgentSessionSummary, MessagePart } from '../../shared/agent/protocol'
import { hydrateEditProposal } from './editStore'

interface StoredLine {
  schemaVersion?: number
  sequence?: number
  timestamp: number
  event: AgentEvent
}

const SESSION_EVENT_SCHEMA_VERSION = 1
const sessionSequences = new Map<string, number>()

function rootDir(): string {
  const userData = typeof app?.getPath === 'function' ? app.getPath('userData') : join(tmpdir(), 'rillecode-test-user-data')
  return join(userData, 'agent', 'sessions')
}

function sessionDir(sessionId: string): string {
  return join(rootDir(), sessionId)
}

function metaPath(sessionId: string): string {
  return join(sessionDir(sessionId), 'meta.json')
}

function eventsPath(sessionId: string): string {
  return join(sessionDir(sessionId), 'events.jsonl')
}

function ensureSessionDir(sessionId: string): void {
  mkdirSync(dirname(metaPath(sessionId)), { recursive: true })
  mkdirSync(sessionDir(sessionId), { recursive: true })
}

export function saveSessionMeta(session: AgentSession): void {
  ensureSessionDir(session.id)
  writeFileSync(metaPath(session.id), JSON.stringify(session, null, 2), 'utf8')
}

export function readSessionMeta(sessionId: string): AgentSession | null {
  const path = metaPath(sessionId)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as AgentSession
  } catch {
    return null
  }
}

export function renameSessionMeta(sessionId: string, title: string): AgentSession | null {
  const meta = readSessionMeta(sessionId)
  if (!meta) return null
  const next: AgentSession = { ...meta, title: title.trim() || '新对话', updatedAt: Date.now() }
  saveSessionMeta(next)
  return next
}

export function archiveSessionMeta(sessionId: string, archived: boolean): AgentSession | null {
  const meta = readSessionMeta(sessionId)
  if (!meta) return null
  const next: AgentSession = { ...meta, status: archived ? 'archived' : 'idle', updatedAt: Date.now() }
  saveSessionMeta(next)
  return next
}

export function deleteSessionStore(sessionId: string): boolean {
  const dir = sessionDir(sessionId)
  if (!existsSync(dir)) return false
  rmSync(dir, { recursive: true, force: true })
  sessionSequences.delete(sessionId)
  return true
}

export function deleteSessionCascade(sessionId: string): number {
  let deleted = 0
  const root = rootDir()
  if (!existsSync(root)) return deleted

  const toDelete: string[] = []
  for (const id of readdirSync(root)) {
    if (id === sessionId) continue
    const meta = readSessionMeta(id)
    if (meta?.parentSessionId === sessionId) {
      toDelete.push(id)
    }
  }

  for (const childId of toDelete) {
    deleted += deleteSessionCascade(childId)
  }

  deleteSessionStore(sessionId)
  return deleted + 1
}

export async function appendSessionEvent(event: AgentEvent): Promise<void> {
  const raw = event as unknown as { sessionId?: string; session?: { id: string } }
  const sessionId = raw.sessionId ?? raw.session?.id
  if (!sessionId) return
  ensureSessionDir(sessionId)
  const sequence = (sessionSequences.get(sessionId) || 0) + 1
  sessionSequences.set(sessionId, sequence)
  await appendFile(eventsPath(sessionId), `${JSON.stringify({ schemaVersion: SESSION_EVENT_SCHEMA_VERSION, sequence, timestamp: Date.now(), event } satisfies StoredLine)}\n`, 'utf8')
  if (event.type === 'session.created' || event.type === 'session.updated' || event.type === 'session.archived' || event.type === 'session.unarchived') saveSessionMeta(event.session)
}

export async function readSessionEvents(sessionId: string): Promise<AgentEvent[]> {
  const path = eventsPath(sessionId)
  if (!existsSync(path)) return []
  const content = await readFile(path, 'utf8')
  const events: AgentEvent[] = []
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const stored = JSON.parse(line) as StoredLine
      if (typeof stored.sequence === 'number') {
        sessionSequences.set(sessionId, Math.max(sessionSequences.get(sessionId) || 0, stored.sequence))
      }
      events.push(stored.event)
      if (stored.event.type === 'edit.proposed') hydrateEditProposal(stored.event.proposal)
    } catch {
      // Ignore corrupt JSONL lines so one bad write does not hide a session.
    }
  }
  return events
}

function latestVerificationFromEvents(events: AgentEvent[]) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event.type === 'verification.completed') return event.result.status
  }
  return undefined
}

function lastMessageFromEvents(events: AgentEvent[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event.type !== 'message.part.created') continue
    const part = event.part as MessagePart
    if (part.type === 'text') return part.text.slice(0, 160)
  }
  return undefined
}

export function listSessionSummaries(): AgentSessionSummary[] {
  const root = rootDir()
  if (!existsSync(root)) return []
  const summaries: AgentSessionSummary[] = []
  for (const id of readdirSync(root)) {
    const meta = readSessionMeta(id)
    if (!meta) continue
    if (meta.parentSessionId) continue
    let lastMessage: string | undefined
    const events: AgentEvent[] = []
    const eventsFile = eventsPath(id)
    if (existsSync(eventsFile)) {
      const lines = readFileSync(eventsFile, 'utf8').split(/\r?\n/).filter(Boolean).slice(-80)
      for (const line of lines) {
        try {
          events.push((JSON.parse(line) as StoredLine).event)
        } catch {
          // Ignore malformed line.
        }
      }
      lastMessage = lastMessageFromEvents(events)
    }
    summaries.push({
      ...meta,
      lastMessage,
      latestVerificationStatus: latestVerificationFromEvents(events),
      parentSessionId: meta.parentSessionId,
      rootSessionId: meta.rootSessionId,
      subagent: meta.subagent,
    })
  }
  return summaries.sort((a, b) => b.updatedAt - a.updatedAt)
}

export function findLastSession(workspacePath?: string | null): AgentSession | null {
  const summaries = listSessionSummaries()
  const active = summaries.filter(item => item.status !== 'archived')
  const selected = workspacePath ? active.find(item => item.workspace?.path === workspacePath) : active[0]
  return selected ? readSessionMeta(selected.id) : null
}
