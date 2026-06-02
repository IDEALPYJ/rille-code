import type { WebContents } from 'electron'
import type { AgentConfigSnapshot, AgentConfigUpdate, AgentEvent, AgentIpcResult, AgentModelProfile, AgentModelProfileUpdate, AgentModelStoreSnapshot, AgentOp, AgentSession, AgentSessionSummary, AgentTurn, ArtifactPayload, ArtifactRef, AutomationRun, AutomationSpec, CheckpointRef, CompactionResult, ContextSourceSnapshot, EditProposal, ExecutionSandbox, ExtensionDiscoverySnapshot, GovernanceAuditReport, McpServerState, ModelUpgradeReview, PlanConfirmation, PlanDraft, PluginManifest, ReviewQueueItem, RuntimeProcessSummary, RuntimeStateArtifact, SkillContract, SubagentRun } from '../../shared/agent/protocol'
import { normalizeAgentPermissionMode } from '../../shared/agent/permissionModes'
import { deleteAgentModelProfile, listAgentModelProfiles, readAgentConfigSnapshot, saveAgentConfig, saveAgentModelProfile, selectAgentModelProfile } from './config'
import { testAgentProvider } from './provider'
import { AgentThread } from './thread'
import { exportSessionTrace } from './trace'
import { appendSessionEvent, archiveSessionMeta, deleteSessionCascade, findLastSession, listSessionSummaries, readSessionMeta, renameSessionMeta, saveSessionMeta } from './sessionStore'
import { listArtifacts, readArtifact } from './artifactStore'
import { cleanupRuntimeProcesses, listRuntimeProcesses, stopRuntimeProcess } from './processRegistry'
import { createCheckpoint, restoreCheckpointAsProposals } from './checkpointStore'
import { captureRuntimeState } from './runtimeState'
import { createWorktreeSandbox, disposeSandbox, sandboxDiffAsProposals } from './worktreeSandbox'
import { discoverExtensions } from './skillStore'
import { listMcpServerStates, startMcpServer, stopMcpServer } from './mcpManager'
import { cancelSubagentRun, listSubagentRuns, readSubagentRun, subagentRunsFromEvents, SubagentRunner } from './subagentRunner'
import { runGovernanceAudit } from './governance'
import { getToolDefinitions } from './tools'
import { loadAutomationSpecs, saveAutomationSpec as saveAutoSpec, deleteAutomationSpec as deleteAutoSpec, findAutomationSpec, loadAutomationRuns, saveAutomationRun, findLatestRun } from './automationStore'
import { pushReviewQueueItem, resolveReviewQueueItem, listReviewQueue } from './reviewQueue'
import { runAutomation } from './automationRunner'
import { getAutomationScheduler } from './automationScheduler'

const threads = new Map<string, AgentThread>()
const governanceReports = new Map<string, GovernanceAuditReport>()

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
    const thread = new AgentThread(sender, op.workspace, normalizeAgentPermissionMode(op.permissionMode))
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
      if (meta.status === 'archived') throw new Error('归档会话不能恢复，请先取消归档。')
      const restored: AgentSession = {
        ...meta,
        status: meta.status === 'running' || meta.status === 'waiting_approval' ? 'idle' : meta.status,
        permissionMode: normalizeAgentPermissionMode(meta.permissionMode),
      }
      if (restored.status !== meta.status || restored.permissionMode !== meta.permissionMode) saveSessionMeta(restored)
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
    const deleted = deleteSessionCascade(op.sessionId)
    return ok(deleted > 0)
  } catch (error) {
    return fail(error)
  }
}

export function archiveAgentSession(op: Extract<AgentOp, { type: 'session.archive' }>): AgentIpcResult<AgentSession | null> {
  try {
    const thread = threads.get(op.sessionId)
    cleanupRuntimeProcesses(op.sessionId)
    if (thread) return ok(thread.archive())
    const session = archiveSessionMeta(op.sessionId, true)
    if (session) void appendSessionEvent({ type: 'session.archived', session })
    return ok(session)
  } catch (error) {
    return fail(error)
  }
}

export function unarchiveAgentSession(op: Extract<AgentOp, { type: 'session.unarchive' }>): AgentIpcResult<AgentSession | null> {
  try {
    const thread = threads.get(op.sessionId)
    if (thread) return ok(thread.unarchive())
    const session = archiveSessionMeta(op.sessionId, false)
    if (session) void appendSessionEvent({ type: 'session.unarchived', session })
    return ok(session)
  } catch (error) {
    return fail(error)
  }
}

export async function submitAgentTurn(op: Extract<AgentOp, { type: 'turn.submit' }>): Promise<AgentIpcResult<AgentTurn>> {
  try {
    return ok(await requireThread(op.sessionId).submitTurn(op.text, op.context, { mode: op.mode, transientSessionId: op.transientSessionId }))
  } catch (error) {
    return fail(error)
  }
}

type AgentDispatchValue =
  | AgentSession
  | AgentTurn
  | EditProposal
  | EditProposal[]
  | PlanConfirmation
  | PlanDraft
  | boolean
  | null
  | ArtifactPayload
  | ArtifactRef[]
  | RuntimeProcessSummary[]
  | RuntimeProcessSummary
  | CheckpointRef
  | ExecutionSandbox
  | RuntimeStateArtifact
  | CompactionResult
  | ExtensionDiscoverySnapshot
  | SkillContract[]
  | PluginManifest[]
  | McpServerState[]
  | McpServerState
  | SubagentRun[]
  | SubagentRun
  | GovernanceAuditReport
  | ModelUpgradeReview
  | ContextSourceSnapshot
  | AutomationSpec
  | AutomationSpec[]
  | AutomationRun
  | AutomationRun[]
  | ReviewQueueItem
  | ReviewQueueItem[]
  | { traceEvents: unknown[] }

let lastSender: WebContents | null = null

export async function dispatchAgentOp(op: AgentOp, sender?: WebContents | null): Promise<AgentIpcResult<AgentDispatchValue>> {
  if (sender) lastSender = sender
  try {
    if (op.type === 'session.rename') return renameAgentSession(op)
    if (op.type === 'session.archive') return archiveAgentSession(op)
    if (op.type === 'session.unarchive') return unarchiveAgentSession(op)
    if (op.type === 'session.delete') return deleteAgentSession(op)
    if (op.type === 'artifact.read') {
      const artifact = readArtifact(op.sessionId, op.artifactId)
      if (!artifact) throw new Error('Artifact does not exist.')
      return ok(artifact)
    }
    if (op.type === 'artifact.list') return ok(listArtifacts(op.sessionId))
    if (op.type === 'runtime.process.list') return ok(listRuntimeProcesses(op.sessionId))
    if (op.type === 'runtime.process.stop') {
      const process = stopRuntimeProcess(op.processId)
      if (!process) throw new Error('Runtime process does not exist.')
      return ok(process)
    }
    if (op.type === 'checkpoint.create') return ok(await createCheckpoint(op))
    if (op.type === 'checkpoint.restoreAsProposal') {
      const session = readSessionMeta(op.sessionId)
      if (!session) throw new Error('Agent session does not exist.')
      const turn: AgentTurn = { id: `turn_checkpoint_${Date.now()}`, sessionId: op.sessionId, text: 'Restore checkpoint as proposal', createdAt: Date.now(), status: 'completed' }
      const proposals = await restoreCheckpointAsProposals(op.checkpointId, session, turn, op.filePath)
      for (const proposal of proposals) {
        void appendSessionEvent({ type: 'edit.proposed', sessionId: op.sessionId, turnId: proposal.turnId, proposal })
      }
      return ok(proposals.length === 1 ? proposals[0] : proposals)
    }
    if (op.type === 'sandbox.create') return ok(await createWorktreeSandbox(op))
    if (op.type === 'sandbox.dispose') return ok(await disposeSandbox(op.sessionId, op.sandboxId))
    if (op.type === 'sandbox.diffAsProposals') {
      const session = readSessionMeta(op.sessionId)
      if (!session) throw new Error('Agent session does not exist.')
      const turn: AgentTurn = { id: op.turnId || `turn_sandbox_${Date.now()}`, sessionId: op.sessionId, text: 'Create sandbox diff proposals', createdAt: Date.now(), status: 'completed' }
      const proposals = await sandboxDiffAsProposals(session, turn, op.sandboxId)
      for (const proposal of proposals) {
        void appendSessionEvent({ type: 'edit.proposed', sessionId: op.sessionId, turnId: proposal.turnId, proposal })
      }
      return ok(proposals)
    }
    if (op.type === 'runtime.state.capture') {
      const { state } = await captureRuntimeState({ sessionId: op.sessionId, turnId: op.turnId, workspace: op.workspace })
      return ok(state)
    }
    if (op.type === 'context.compact') {
      return ok(await requireThread(op.sessionId).compactContext(op.turnId, op.reason))
    }
    if (op.type === 'plan.answerQuestion') {
      return ok(await requireThread(op.sessionId).answerPlanQuestion(op.questionId, op.answer))
    }
    if (op.type === 'plan.resolveDraft') {
      return ok(await requireThread(op.sessionId).resolvePlanDraft(op.draftId, op.action, op.feedback, op.context))
    }
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
      return ok({ traceEvents: await exportSessionTrace(op.sessionId, op.redacted !== false) })
    }
    if (op.type === 'extension.refresh') {
      const snapshot = discoverExtensions(op.workspace)
      for (const plugin of snapshot.plugins) {
        void appendSessionEvent({ type: 'plugin.loaded', sessionId: op.sessionId, activation: { id: `plugin_activation_${plugin.id}_${Date.now()}`, pluginId: plugin.id, status: 'loaded', createdAt: Date.now() } })
      }
      return ok(snapshot)
    }
    if (op.type === 'skill.list') return ok(discoverExtensions(op.workspace).skills)
    if (op.type === 'plugin.list') return ok(discoverExtensions(op.workspace).plugins)
    if (op.type === 'mcp.server.list') return ok(listMcpServerStates())
    if (op.type === 'mcp.server.start') {
      const state = await startMcpServer(op)
      void appendSessionEvent({ type: state.status === 'failed' ? 'mcp.server.failed' : 'mcp.server.started', sessionId: op.sessionId, state })
      if (state.status === 'running') {
        void appendSessionEvent({ type: 'mcp.server.completed', sessionId: op.sessionId, state })
        for (const tool of state.tools) void appendSessionEvent({ type: 'mcp.tool.discovered', sessionId: op.sessionId, tool })
      }
      return ok(state)
    }
    if (op.type === 'mcp.server.stop') {
      const state = stopMcpServer(op.pluginId, op.serverId)
      if (!state) throw new Error('MCP server does not exist.')
      void appendSessionEvent({ type: 'mcp.server.stopped', sessionId: op.sessionId, state })
      return ok(state)
    }
    if (op.type === 'subagent.list') {
      const live = listSubagentRuns(op.sessionId)
      const replayed = await subagentRunsFromEvents(op.sessionId)
      const merged = [...live, ...replayed].filter((run, index, all) => all.findIndex(item => item.id === run.id) === index)
      return ok(merged)
    }
    if (op.type === 'subagent.read') {
      const run = readSubagentRun(op.sessionId, op.runId) ?? (await subagentRunsFromEvents(op.sessionId)).find(item => item.id === op.runId) ?? null
      if (!run) throw new Error('Subagent run does not exist.')
      return ok(run)
    }
    if (op.type === 'subagent.cancel') {
      const run = cancelSubagentRun(op.sessionId, op.runId)
      if (!run) throw new Error('Subagent run does not exist.')
      return ok(run)
    }
    if (op.type === 'subagent.launch') {
      const session = readSessionMeta(op.sessionId)
      if (!session) throw new Error('Agent session does not exist.')
      const run = await new SubagentRunner().run({
        parentSession: session,
        parentTurnId: op.turnId || `turn_subagent_${Date.now()}`,
        role: op.role,
        goal: op.goal,
        reason: op.reason,
        focusFiles: op.focusFiles,
        permissionScope: op.permissionScope,
        commands: op.commands,
        context: op.context || { workspace: session.workspace, activeFile: null, openFiles: [], diagnostics: [] },
        emit: event => void appendSessionEvent(event),
      })
      return ok(run)
    }
    if (op.type === 'governance.audit') {
      const report = runGovernanceAudit({
        workspacePath: op.workspace?.path ?? readSessionMeta(op.sessionId)?.workspace?.path ?? undefined,
        tools: getToolDefinitions(),
        modelProfiles: listAgentModelProfiles(),
      })
      governanceReports.set(op.sessionId, report)
      void appendSessionEvent({ type: 'governance.audit.started', sessionId: op.sessionId, turnId: op.turnId, reportId: report.id, createdAt: Date.now() })
      void appendSessionEvent({ type: 'eval.regression.reported', sessionId: op.sessionId, turnId: op.turnId, report: report.evalRegression, createdAt: Date.now() })
      void appendSessionEvent({ type: 'config.audit.completed', sessionId: op.sessionId, turnId: op.turnId, findings: report.configFindings, createdAt: Date.now() })
      void appendSessionEvent({ type: 'scaffold.cleanup.reported', sessionId: op.sessionId, turnId: op.turnId, candidates: report.scaffoldCandidates, createdAt: Date.now() })
      void appendSessionEvent({ type: 'governance.audit.completed', sessionId: op.sessionId, turnId: op.turnId, report, createdAt: Date.now() })
      return ok(report)
    }
    if (op.type === 'governance.report.read') {
      return ok(governanceReports.get(op.sessionId) ?? runGovernanceAudit({
        workspacePath: readSessionMeta(op.sessionId)?.workspace?.path ?? undefined,
        tools: getToolDefinitions(),
        modelProfiles: listAgentModelProfiles(),
      }))
    }
    if (op.type === 'model.upgrade.review') {
      const report = runGovernanceAudit({
        workspacePath: op.workspace?.path ?? readSessionMeta(op.sessionId)?.workspace?.path ?? undefined,
        tools: getToolDefinitions(),
        modelProfiles: listAgentModelProfiles(),
      })
      governanceReports.set(op.sessionId, report)
      return ok(report.modelUpgrade)
    }
    if (op.type === 'context_source.list') {
      const { getContextSourceRegistry } = await import('./contextBuilder')
      return ok(getContextSourceRegistry().toSnapshot())
    }
    if (op.type === 'context_source.toggle') {
      const { getContextSourceRegistry } = await import('./contextBuilder')
      const registry = getContextSourceRegistry()
      const ok_ = registry.setEnabled(op.entryId, op.enabled)
      if (!ok_) return fail(`Entry not found: ${op.entryId}`)
      if (!op.enabled) registry.recordIgnore(op.entryId, 'disabled_by_user')
      return ok(registry.toSnapshot())
    }
    if (op.type === 'automation.create') {
      const now = Date.now()
      const spec: AutomationSpec = { ...op.spec, id: `automation_${now}_${Math.random().toString(36).slice(2, 6)}`, createdAt: now, updatedAt: now }
      saveAutoSpec(spec)
      void appendSessionEvent({ type: 'automation.created', sessionId: '', automation: spec } as AgentEvent)
      return ok(spec)
    }
    if (op.type === 'automation.update') {
      const existing = findAutomationSpec(op.automationId)
      if (!existing) throw new Error('Automation does not exist.')
      const updated: AutomationSpec = { ...existing, ...op.changes, id: existing.id, createdAt: existing.createdAt, updatedAt: Date.now() }
      saveAutoSpec(updated)
      void appendSessionEvent({ type: 'automation.updated', sessionId: '', automation: updated } as AgentEvent)
      return ok(updated)
    }
    if (op.type === 'automation.delete') {
      const scheduler = getAutomationScheduler(null as unknown as WebContents, () => {})
      scheduler.unscheduleAutomation(op.automationId)
      deleteAutoSpec(op.automationId)
      void appendSessionEvent({ type: 'automation.deleted', sessionId: '', automationId: op.automationId } as AgentEvent)
      return ok(true)
    }
    if (op.type === 'automation.list') return ok(loadAutomationSpecs())
    if (op.type === 'automation.read') {
      const s = findAutomationSpec(op.automationId)
      if (!s) throw new Error('Automation does not exist.')
      return ok(s)
    }
    if (op.type === 'automation.listRuns') return ok(loadAutomationRuns(op.automationId))
    if (op.type === 'automation.trigger') {
      if (!lastSender) return fail('No sender available for automation trigger')
      const scheduler = getAutomationScheduler(lastSender, event => void appendSessionEvent(event))
      const run = await scheduler.triggerAutomation(op.automationId)
      return ok(run)
    }
    if (op.type === 'automation.pause') {
      const scheduler = getAutomationScheduler(null as unknown as WebContents, () => {})
      scheduler.pauseAutomation(op.automationId)
      void appendSessionEvent({ type: 'automation.paused', sessionId: '', automationId: op.automationId } as AgentEvent)
      const s = findAutomationSpec(op.automationId)
      return ok(s ?? ({} as AutomationSpec))
    }
    if (op.type === 'automation.resume') {
      const scheduler = getAutomationScheduler(null as unknown as WebContents, () => {})
      scheduler.resumeAutomation(op.automationId)
      void appendSessionEvent({ type: 'automation.resumed', sessionId: '', automationId: op.automationId } as AgentEvent)
      const s = findAutomationSpec(op.automationId)
      return ok(s ?? ({} as AutomationSpec))
    }
    if (op.type === 'automation.cancel') {
      const scheduler = getAutomationScheduler(null as unknown as WebContents, () => {})
      const ok_ = scheduler.cancelRun(op.runId)
      return ok(ok_)
    }
    if (op.type === 'review.queue.list') return ok(listReviewQueue({ sessionId: op.sessionId, automationId: op.automationId }))
    if (op.type === 'review.queue.resolve') {
      const item = resolveReviewQueueItem(op.itemId, op.action, op.reason)
      if (!item) throw new Error('Review queue item does not exist.')
      void appendSessionEvent({ type: 'review.queue.resolved', sessionId: item.sessionId, item } as AgentEvent)
      return ok(item)
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
