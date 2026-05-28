import type { WebContents } from 'electron'
import { existsSync, readFileSync } from 'fs'
import { basename } from 'path'
import type { AgentContextFile, AgentContextSnapshot, AgentEvent, AutomationRun, AutomationSpec } from '../../shared/agent/protocol'
import { AgentThread } from './thread'
import { saveAutomationRun } from './automationStore'
import { createReviewQueueItem, pushReviewQueueItem } from './reviewQueue'

function buildContextSnapshot(spec: AutomationSpec): AgentContextSnapshot {
  const files: AgentContextFile[] = (spec.contextFiles ?? [])
    .filter(f => existsSync(f))
    .map(f => {
      let content = ''
      try { content = readFileSync(f, 'utf8') } catch { /* ignore */ }
      return {
        path: f,
        name: basename(f),
        isDirty: false,
        content,
      }
    })
  return {
    workspace: spec.workspace,
    activeFile: files.length > 0 ? files[0] : null,
    openFiles: files,
    diagnostics: [],
  }
}

function makeRunId(): string {
  return `automation_run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export async function runAutomation(
  sender: WebContents,
  spec: AutomationSpec,
  _reason: 'scheduled' | 'manual',
  emit: (event: AgentEvent) => void,
): Promise<AutomationRun> {
  const context = buildContextSnapshot(spec)

  // Create thread directly (not through index.ts to avoid circular dependency)
  const thread = new AgentThread(sender, spec.workspace, spec.permissionMode)
  thread.emitCreated()

  const run: AutomationRun = {
    id: makeRunId(),
    automationId: spec.id,
    sessionId: thread.id,
    turnId: '',
    status: 'running',
    evidenceCount: 0,
    findingCount: 0,
    startedAt: Date.now(),
  }
  saveAutomationRun(run)
  emit({ type: 'automation.run.started', run })

  try {
    const turn = await thread.submitTurn(spec.goal, context)
    run.turnId = turn.id

    // Gather results from thread state
    const contract = thread.activeTaskContract
    if (contract) run.taskContract = contract
    run.evidenceCount = thread.activeEvidence.length
    const review = thread.activeReviewResult
    if (review) run.findingCount = review.findings?.length ?? 0

    // Determine final status
    if (turn.status === 'completed') {
      run.status = 'completed'
    } else if (turn.status === 'failed' || turn.status === 'interrupted') {
      run.status = 'failed'
      run.error = `Turn ended with status: ${turn.status}`
    } else {
      run.status = 'completed'
    }
    run.completedAt = Date.now()
    saveAutomationRun(run)

    // Push review queue summary item
    pushReviewQueueItem(createReviewQueueItem({
      source: 'plan_confirmation',
      sessionId: thread.id,
      turnId: run.turnId,
      automationId: spec.id,
      title: `Automation "${spec.name}" completed`,
      description: `Automation run completed. Evidence: ${run.evidenceCount}, Findings: ${run.findingCount}`,
      severity: run.status === 'failed' ? 'warning' : 'info',
    }))

    if (run.status === 'failed') {
      emit({ type: 'automation.run.failed', run, error: run.error ?? 'Unknown error' })
    } else {
      emit({ type: 'automation.run.completed', run })
    }
    return run
  } catch (err) {
    run.status = 'failed'
    run.error = err instanceof Error ? err.message : String(err)
    run.completedAt = Date.now()
    saveAutomationRun(run)
    emit({ type: 'automation.run.failed', run, error: run.error })
    return run
  }
}

export async function cancelAutomationRun(runId: string): Promise<boolean> {
  const run = (await import('./automationStore')).findAutomationRun(runId)
  if (!run || run.status !== 'running') return false
  run.status = 'cancelled'
  run.completedAt = Date.now()
  saveAutomationRun(run)
  return true
}
