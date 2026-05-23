import type { WebContents } from 'electron'
import type { AgentConfigSnapshot, AgentConfigUpdate, AgentIpcResult, AgentModelProfile, AgentModelProfileUpdate, AgentModelStoreSnapshot, AgentOp, AgentSession, AgentSessionSummary, AgentTurn, EditProposal } from '../../shared/agent/protocol'
import { deleteAgentModelProfile, listAgentModelProfiles, readAgentConfigSnapshot, saveAgentConfig, saveAgentModelProfile, selectAgentModelProfile } from './config'
import { testAgentProvider } from './provider'
import { AgentThread } from './thread'
import { exportSessionTrace } from './trace'
import { deleteSessionStore, findLastSession, listSessionSummaries, readSessionMeta, renameSessionMeta, saveSessionMeta } from './sessionStore'

const threads = new Map<string, AgentThread>()

function ok<T>(value: T): AgentIpcResult<T> {
  return { ok: true, value }
}

function fail(error: unknown): AgentIpcResult<never> {
  return { ok: false, error: error instanceof Error ? error.message : String(error) }
}

function requireThread(sessionId: string): AgentThread {
  const thread = threads.get(sessionId)
  if (!thread) throw new Error('Agent session does not exist.')
  return thread
}

export function createAgentSession(sender: WebContents, op: Extract<AgentOp, { type: 'session.create' }>): AgentIpcResult<AgentSession> {
  try {
    const thread = new AgentThread(sender, op.workspace, op.permissionMode)
    threads.set(thread.id, thread)
    thread.emitCreated()
    return ok(thread.view)
  } catch (error) {
    return fail(error)
  }
}

export async function resumeAgentSession(sender: WebContents, op: Extract<AgentOp, { type: 'session.resume' }>): Promise<AgentIpcResult<AgentSession>> {
  try {
    let thread = threads.get(op.sessionId)
    if (!thread) {
      const meta = readSessionMeta(op.sessionId)
      if (!meta) throw new Error('Agent session does not exist.')
      const restored: AgentSession = { ...meta, status: meta.status === 'running' || meta.status === 'waiting_approval' ? 'idle' : meta.status }
      if (restored.status !== meta.status) saveSessionMeta(restored)
      thread = new AgentThread(sender, restored.workspace, restored.permissionMode, restored)
      threads.set(thread.id, thread)
    }
    await thread.replayHistory()
    return ok(thread.view)
  } catch (error) {
    return fail(error)
  }
}

export async function resumeLastAgentSession(sender: WebContents, op: Extract<AgentOp, { type: 'session.resumeLast' }>): Promise<AgentIpcResult<AgentSession | null>> {
  try {
    const meta = findLastSession(op.workspace?.path)
    if (!meta) return ok(null)
    const resumed = await resumeAgentSession(sender, { type: 'session.resume', sessionId: meta.id })
    return resumed.ok ? ok(resumed.value) : resumed
  } catch (error) {
    return fail(error)
  }
}

export function listAgentSessions(): AgentIpcResult<AgentSessionSummary[]> {
  try {
    return ok(listSessionSummaries())
  } catch (error) {
    return fail(error)
  }
}

export function renameAgentSession(op: Extract<AgentOp, { type: 'session.rename' }>): AgentIpcResult<AgentSession | null> {
  try {
    const thread = threads.get(op.sessionId)
    if (thread) return ok(thread.rename(op.title))
    return ok(renameSessionMeta(op.sessionId, op.title))
  } catch (error) {
    return fail(error)
  }
}

export function deleteAgentSession(op: Extract<AgentOp, { type: 'session.delete' }>): AgentIpcResult<boolean> {
  try {
    threads.delete(op.sessionId)
    return ok(deleteSessionStore(op.sessionId))
  } catch (error) {
    return fail(error)
  }
}

export async function submitAgentTurn(op: Extract<AgentOp, { type: 'turn.submit' }>): Promise<AgentIpcResult<AgentTurn>> {
  try {
    return ok(await requireThread(op.sessionId).submitTurn(op.text, op.context))
  } catch (error) {
    return fail(error)
  }
}

export async function dispatchAgentOp(op: AgentOp): Promise<AgentIpcResult<AgentSession | EditProposal | boolean | null>> {
  try {
    if (op.type === 'session.rename') return renameAgentSession(op)
    if (op.type === 'session.delete') return deleteAgentSession(op)
    if (op.type === 'edit.apply') {
      return ok(await requireThread(op.sessionId).applyEdit(op.proposalId, op.context))
    }
    if (op.type === 'edit.reject') {
      return ok(requireThread(op.sessionId).rejectEdit(op.proposalId, op.reason))
    }
    if (op.type === 'edit.rollback') {
      return ok(requireThread(op.sessionId).rollbackEdit(op.proposalId))
    }
    if (op.type === 'approval.respond') {
      for (const thread of threads.values()) thread.handle(op)
      return ok(true)
    }
    if (op.type === 'trace.export') {
      return ok({ traceEvents: await exportSessionTrace(op.sessionId, op.redacted !== false) } as unknown as AgentSession)
    }
    if ('sessionId' in op) {
      return ok(requireThread(op.sessionId).handle(op))
    }
    return ok(null)
  } catch (error) {
    return fail(error)
  }
}

export function getAgentConfig(): AgentIpcResult<AgentConfigSnapshot> {
  try {
    return ok(readAgentConfigSnapshot())
  } catch (error) {
    return fail(error)
  }
}

export function updateAgentConfig(update: AgentConfigUpdate): AgentIpcResult<AgentConfigSnapshot> {
  try {
    return ok(saveAgentConfig(update))
  } catch (error) {
    return fail(error)
  }
}

export function getAgentModelProfiles(): AgentIpcResult<AgentModelStoreSnapshot> {
  try {
    return ok(listAgentModelProfiles())
  } catch (error) {
    return fail(error)
  }
}

export function updateAgentModelProfile(update: AgentModelProfileUpdate): AgentIpcResult<AgentModelProfile> {
  try {
    return ok(saveAgentModelProfile(update))
  } catch (error) {
    return fail(error)
  }
}

export function setActiveAgentModelProfile(profileId: string): AgentIpcResult<AgentConfigSnapshot> {
  try {
    return ok(selectAgentModelProfile(profileId))
  } catch (error) {
    return fail(error)
  }
}

export function removeAgentModelProfile(profileId: string): AgentIpcResult<AgentModelStoreSnapshot> {
  try {
    return ok(deleteAgentModelProfile(profileId))
  } catch (error) {
    return fail(error)
  }
}

export async function checkAgentProvider(profileId?: string): Promise<AgentIpcResult<{ success: boolean; message: string }>> {
  try {
    return ok(await testAgentProvider(profileId))
  } catch (error) {
    return fail(error)
  }
}

export async function exportAgentTrace(sessionId: string, redacted = true): Promise<AgentIpcResult<{ traceEvents: unknown[] }>> {
  try {
    const traceEvents = await exportSessionTrace(sessionId, redacted)
    return ok({ traceEvents })
  } catch (error) {
    return fail(error)
  }
}
