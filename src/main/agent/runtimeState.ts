import { randomUUID } from 'crypto'
import type { AgentWorkspaceLocation, CheckpointRef, Evidence, RuntimeStateArtifact } from '../../shared/agent/protocol'
import { createArtifact } from './artifactStore'
import { workspaceGitStatus } from './workspace'
import { listRuntimeProcesses } from './processRegistry'

const checkpoints = new Map<string, CheckpointRef>()
const latestEvidence = new Map<string, Evidence[]>()

export function rememberCheckpoint(checkpoint: CheckpointRef): void {
  checkpoints.set(checkpoint.id, checkpoint)
}

export function listCheckpoints(sessionId: string): CheckpointRef[] {
  return [...checkpoints.values()].filter(item => item.sessionId === sessionId).sort((a, b) => b.createdAt - a.createdAt)
}

export function getCheckpoint(sessionId: string, checkpointId: string): CheckpointRef | null {
  const checkpoint = checkpoints.get(checkpointId)
  return checkpoint && checkpoint.sessionId === sessionId ? checkpoint : null
}

export function rememberEvidence(evidence: Evidence): void {
  const existing = latestEvidence.get(evidence.sessionId) || []
  latestEvidence.set(evidence.sessionId, [evidence, ...existing.filter(item => item.id !== evidence.id)].slice(0, 20))
}

export async function captureRuntimeState(input: {
  sessionId: string
  turnId?: string
  workspace?: AgentWorkspaceLocation | null
  sandboxes?: RuntimeStateArtifact['sandboxes']
}): Promise<{ state: RuntimeStateArtifact; artifact: ReturnType<typeof createArtifact> }> {
  let gitStatus: string | undefined
  if (input.workspace) {
    try {
      gitStatus = await workspaceGitStatus(input.workspace)
    } catch (error) {
      gitStatus = error instanceof Error ? error.message : String(error)
    }
  }
  const state: RuntimeStateArtifact = {
    id: `runtime_state_${randomUUID()}`,
    sessionId: input.sessionId,
    turnId: input.turnId,
    workspace: input.workspace ?? null,
    gitStatus,
    processes: listRuntimeProcesses(input.sessionId),
    checkpoints: listCheckpoints(input.sessionId),
    sandboxes: input.sandboxes || [],
    latestEvidence: latestEvidence.get(input.sessionId) || [],
    createdAt: Date.now(),
  }
  const artifact = createArtifact({
    sessionId: input.sessionId,
    turnId: input.turnId,
    kind: 'runtime_state',
    content: state,
    mimeType: 'application/json',
  })
  return { state, artifact }
}
