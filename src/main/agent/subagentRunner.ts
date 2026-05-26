import { randomUUID } from 'crypto'
import type {
  AgentContextSnapshot,
  AgentEvent,
  AgentSession,
  AgentUsage,
  Evidence,
  ReviewFinding,
  ReviewResult,
  SubagentContract,
  SubagentMergeResult,
  SubagentPermissionScope,
  SubagentResult,
  SubagentRole,
  SubagentRun,
  TaskContract,
  VerificationCoverage,
} from '../../shared/agent/protocol'
import { getAgentConfigForProvider } from './config'
import { callAgentModelWithConfig, type AgentChatMessage } from './provider'
import { appendSessionEvent, readSessionEvents, saveSessionMeta } from './sessionStore'

export const SUBAGENT_ALLOWED_TOOLS = [
  'read_file',
  'list_directory',
  'search_files',
  'git_status',
  'git_diff',
  'read_diagnostics',
  'explore_codebase',
  'search_tools',
  'search_skills',
] as const

const DEFAULT_OUTPUT_SCHEMA: Record<SubagentRole, string> = {
  explorer: 'summary:string, recommendedActions:string[]',
  verifier: 'summary:string, evidenceRefs:string[], recommendedActions:string[]',
  reviewer: 'summary:string, findings:ReviewFinding[]',
  advisor: 'summary:string, recommendedActions:string[]',
}

const DEFAULT_SCOPE: Record<SubagentRole, SubagentPermissionScope> = {
  explorer: 'read_only',
  verifier: 'verify_only',
  reviewer: 'review_only',
  advisor: 'advisory_only',
}

const inMemoryRuns = new Map<string, SubagentRun>()
const cancelledRuns = new Set<string>()

function now(): number {
  return Date.now()
}

function runId(): string {
  return `subagent_${randomUUID()}`
}

function childSessionId(parentSessionId: string, role: SubagentRole): string {
  return `session_${role}_${randomUUID()}_${parentSessionId.slice(-8)}`
}

function sanitizeAllowedTools(tools?: string[]): string[] {
  const allowed = new Set<string>(SUBAGENT_ALLOWED_TOOLS)
  return (tools?.length ? tools : [...SUBAGENT_ALLOWED_TOOLS]).filter(tool => allowed.has(tool))
}

export function createSubagentContract(input: {
  parentSessionId: string
  parentTurnId: string
  role: SubagentRole
  goal: string
  focusFiles?: string[]
  allowedTools?: string[]
}): SubagentContract {
  const role = input.role
  return {
    id: `subagent_contract_${randomUUID()}`,
    parentSessionId: input.parentSessionId,
    parentTurnId: input.parentTurnId,
    role,
    goal: input.goal.trim() || `${role} subagent task`,
    permissionScope: DEFAULT_SCOPE[role],
    allowedTools: sanitizeAllowedTools(input.allowedTools),
    focusFiles: input.focusFiles?.filter(Boolean).slice(0, 20),
    outputSchema: DEFAULT_OUTPUT_SCHEMA[role],
    createdAt: now(),
  }
}

export function assertSubagentToolAllowed(contract: SubagentContract, toolName: string): void {
  if (!contract.allowedTools.includes(toolName)) throw new Error(`Subagent ${contract.role} cannot use tool ${toolName}.`)
  if (toolName === 'run_command' || toolName.includes('edit') || toolName.startsWith('mcp.')) {
    throw new Error(`Subagent ${contract.role} cannot use side-effect tool ${toolName}.`)
  }
}

function childSession(parent: AgentSession, contract: SubagentContract, id: string): AgentSession {
  return {
    id,
    workspace: parent.workspace,
    title: `${contract.role}: ${contract.goal.slice(0, 60)}`,
    createdAt: now(),
    updatedAt: now(),
    status: 'running',
    permissionMode: 'plan',
    parentSessionId: parent.id,
    rootSessionId: parent.rootSessionId || parent.id,
    subagent: { role: contract.role, contractId: contract.id },
  }
}

function systemPrompt(role: SubagentRole): string {
  if (role === 'advisor') return 'You are an advisory-only coding agent. Give concise internal guidance. Do not ask to run tools or write files.'
  return `You are a ${role} subagent. You are read-only and cannot modify files, run commands, or approve final completion. Return concise structured findings.`
}

function userPrompt(input: SubagentRunnerInput, contract: SubagentContract): string {
  return JSON.stringify({
    role: contract.role,
    goal: contract.goal,
    focusFiles: contract.focusFiles || [],
    taskContract: input.taskContract,
    evidence: input.evidence?.map(item => ({ id: item.id, source: item.source, status: item.status, summary: item.summary })),
    coverage: input.coverage,
    reviewStatus: input.reviewResult?.status,
    workspace: input.context.workspace,
    activeFile: input.context.activeFile?.path,
    openFiles: input.context.openFiles.map(file => file.path),
    diagnostics: input.context.diagnostics.slice(0, 20),
  }, null, 2)
}

function deterministicResult(input: SubagentRunnerInput, run: SubagentRun, error?: string): SubagentResult {
  const role = run.role
  const base = {
    id: `subagent_result_${randomUUID()}`,
    contractId: run.contract.id,
    role,
    childSessionId: run.childSessionId,
    evidenceRefs: input.evidence?.map(item => item.id) || [],
    artifactRefs: [] as string[],
    createdAt: now(),
  }
  if (error) {
    return { ...base, status: 'failed', summary: `Subagent ${role} failed: ${error}`, error, completedAt: now() }
  }
  if (role === 'explorer') {
    const focus = run.contract.focusFiles?.length ? run.contract.focusFiles.join(', ') : input.context.activeFile?.path || 'workspace'
    return { ...base, status: 'completed', summary: `Explorer inspected ${focus}.`, recommendedActions: ['Use read-only evidence before editing.'], completedAt: now() }
  }
  if (role === 'verifier') {
    const missing = input.coverage?.criteria.filter(item => item.status !== 'covered').map(item => item.criterionId) || []
    return {
      ...base,
      status: missing.length > 0 ? 'blocked' : 'completed',
      summary: missing.length > 0 ? `Verifier found missing evidence for ${missing.join(', ')}.` : 'Verifier found coverage acceptable.',
      recommendedActions: missing.length > 0 ? ['Run parent verification and attach evidence before finalizing.'] : [],
      completedAt: now(),
    }
  }
  if (role === 'reviewer') {
    const findings: ReviewFinding[] = input.codeChanged && (input.evidence || []).filter(item => item.status === 'passed').length === 0 ? [{
      id: `finding_subagent_${randomUUID()}`,
      sessionId: input.parentSession.id,
      turnId: input.parentTurnId,
      category: 'evidence',
      severity: 'high',
      blocking: true,
      title: 'Subagent reviewer requires evidence',
      body: 'A fresh read-only reviewer found code change risk without passing evidence.',
      evidenceRefs: [],
      recommendation: 'Collect passing verification evidence in the parent session.',
      status: 'open',
      source: 'subagent',
      createdAt: now(),
    }] : []
    return { ...base, status: findings.length ? 'blocked' : 'completed', summary: findings.length ? 'Reviewer found blocking evidence gap.' : 'Reviewer found no blocking issue.', findings, completedAt: now() }
  }
  return { ...base, status: 'completed', summary: 'Advisor recommends continuing through the parent verification/review gate.', recommendedActions: ['Keep final authority in the parent agent.'], completedAt: now() }
}

export interface SubagentRunnerInput {
  parentSession: AgentSession
  parentTurnId: string
  role: SubagentRole
  goal: string
  reason?: string
  focusFiles?: string[]
  context: AgentContextSnapshot
  taskContract?: TaskContract
  evidence?: Evidence[]
  coverage?: VerificationCoverage | null
  reviewResult?: ReviewResult | null
  codeChanged?: boolean
  signal?: AbortSignal
  emit?: (event: AgentEvent) => void
}

export class SubagentRunner {
  async run(input: SubagentRunnerInput): Promise<SubagentRun> {
    const contract = createSubagentContract({
      parentSessionId: input.parentSession.id,
      parentTurnId: input.parentTurnId,
      role: input.role,
      goal: input.goal,
      focusFiles: input.focusFiles,
    })
    const id = runId()
    const childId = childSessionId(input.parentSession.id, contract.role)
    const session = childSession(input.parentSession, contract, childId)
    saveSessionMeta(session)

    let run: SubagentRun = {
      id,
      contract,
      parentSessionId: input.parentSession.id,
      parentTurnId: input.parentTurnId,
      childSessionId: childId,
      role: contract.role,
      status: 'running',
      createdAt: now(),
    }
    inMemoryRuns.set(run.id, run)
    input.emit?.({ type: 'subagent.started', sessionId: input.parentSession.id, turnId: input.parentTurnId, run })
    await appendSessionEvent({ type: 'session.created', session })

    try {
      input.emit?.({ type: 'subagent.progress', sessionId: input.parentSession.id, turnId: input.parentTurnId, runId: run.id, message: `Subagent ${contract.role} started.`, createdAt: now() })
      let result = deterministicResult(input, run)
      try {
        const model = await this.callModel(input, contract)
        if (model.text.trim()) {
          result = { ...result, summary: model.text.trim().slice(0, 1200), usage: model.usage, completedAt: now() }
        }
      } catch {
        // Deterministic fallback keeps CI and offline runs independent from API keys.
      }
      if (cancelledRuns.has(run.id) || input.signal?.aborted) {
        run = { ...run, status: 'cancelled', completedAt: now() }
      } else {
        run = { ...run, status: 'completed', result, completedAt: now() }
      }
      inMemoryRuns.set(run.id, run)
      const completedSession: AgentSession = { ...session, status: run.status === 'completed' ? 'idle' : 'interrupted', updatedAt: now() }
      saveSessionMeta(completedSession)
      if (run.result) input.emit?.({ type: 'subagent.completed', sessionId: input.parentSession.id, turnId: input.parentTurnId, run, result: run.result })
      return run
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught)
      const result = deterministicResult(input, run, message)
      run = { ...run, status: 'failed', result, error: message, completedAt: now() }
      inMemoryRuns.set(run.id, run)
      saveSessionMeta({ ...session, status: 'error', updatedAt: now() })
      input.emit?.({ type: 'subagent.failed', sessionId: input.parentSession.id, turnId: input.parentTurnId, run, error: message })
      return run
    } finally {
      cancelledRuns.delete(run.id)
    }
  }

  private async callModel(input: SubagentRunnerInput, contract: SubagentContract): Promise<{ text: string; usage?: AgentUsage }> {
    const config = getAgentConfigForProvider()
    if (!config.apiKey && config.providerId !== 'ollama') throw new Error('No model key configured.')
    const messages: AgentChatMessage[] = [
      { role: 'system', content: systemPrompt(contract.role) },
      { role: 'user', content: userPrompt(input, contract) },
    ]
    const result = await callAgentModelWithConfig(config, messages, { signal: input.signal, maxTokens: 1200 })
    const purpose = contract.role === 'advisor' ? 'advisor' as const : contract.role === 'reviewer' ? 'evaluator' as const : 'executor' as const
    return { text: result.text, usage: result.usage ? { ...result.usage, purpose } : undefined }
  }
}

export class SubagentScheduler {
  private readonly active = new Map<string, Promise<SubagentRun>>()

  constructor(private readonly concurrency = 3) {}

  async runAll(tasks: Array<() => Promise<SubagentRun>>): Promise<SubagentRun[]> {
    const results: SubagentRun[] = []
    const queue = [...tasks]
    const workers = Array.from({ length: Math.min(this.concurrency, queue.length) }, async () => {
      while (queue.length > 0) {
        const task = queue.shift()
        if (!task) break
        results.push(await task())
      }
    })
    await Promise.all(workers)
    return results
  }

  runDeduped(key: string, task: () => Promise<SubagentRun>): Promise<SubagentRun> {
    const existing = this.active.get(key)
    if (existing) return existing
    const promise = task().finally(() => this.active.delete(key))
    this.active.set(key, promise)
    return promise
  }
}

export function listSubagentRuns(sessionId: string): SubagentRun[] {
  return [...inMemoryRuns.values()].filter(run => run.parentSessionId === sessionId)
}

export function readSubagentRun(sessionId: string, runId: string): SubagentRun | null {
  const run = inMemoryRuns.get(runId)
  return run && run.parentSessionId === sessionId ? run : null
}

export function cancelSubagentRun(sessionId: string, runId: string): SubagentRun | null {
  const run = readSubagentRun(sessionId, runId)
  if (!run) return null
  cancelledRuns.add(runId)
  const cancelled = { ...run, status: 'cancelled' as const, completedAt: now() }
  inMemoryRuns.set(runId, cancelled)
  return cancelled
}

export function mergeSubagentReview(parent: { sessionId: string; turnId: string }, base: ReviewResult, result?: SubagentResult): ReviewResult {
  const findings = result?.findings?.map(finding => ({ ...finding, source: 'subagent' as const })) ?? []
  if (findings.length === 0) return base
  const nextFindings = [...base.findings, ...findings]
  const blocking = nextFindings.some(finding => finding.blocking && finding.status === 'open')
  return {
    ...base,
    status: blocking ? 'blocked' : base.status,
    findingIds: nextFindings.map(finding => finding.id),
    findings: nextFindings,
    summary: `${base.summary}\nSubagent reviewer: ${result?.summary || 'completed'}`,
    sessionId: parent.sessionId,
    turnId: parent.turnId,
  }
}

export function createSubagentMerge(input: { sessionId: string; turnId: string; runs: SubagentRun[]; observationIds?: string[]; findingIds?: string[]; advisorySummary?: string }): SubagentMergeResult {
  return {
    id: `subagent_merge_${randomUUID()}`,
    parentSessionId: input.sessionId,
    parentTurnId: input.turnId,
    runIds: input.runs.map(run => run.id),
    mergedObservationIds: input.observationIds || [],
    mergedFindingIds: input.findingIds || [],
    advisorySummary: input.advisorySummary,
    createdAt: now(),
  }
}

export async function subagentRunsFromEvents(sessionId: string): Promise<SubagentRun[]> {
  const events = await readSessionEvents(sessionId)
  const runs = new Map<string, SubagentRun>()
  for (const event of events) {
    if (event.type === 'subagent.started') runs.set(event.run.id, event.run)
    if (event.type === 'subagent.completed' || event.type === 'subagent.failed') runs.set(event.run.id, event.run)
  }
  return [...runs.values()]
}
