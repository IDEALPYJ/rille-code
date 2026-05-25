import { randomUUID } from 'crypto'
import type { AgentSession, AgentTurn, AgentWorkspaceLocation, CheckpointRef, EditProposal } from '../../shared/agent/protocol'
import { createArtifact, readArtifact } from './artifactStore'
import { createEditProposal, createEditProposalSet, getEditProposal } from './editStore'
import { captureRuntimeState, getCheckpoint, rememberCheckpoint } from './runtimeState'
import { workspaceGitStatus, workspaceReadFile } from './workspace'

function parseChangedFiles(status: string): string[] {
  return status
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.replace(/^##.*$/, '').trim())
    .filter(Boolean)
    .map(line => line.slice(2).trim())
    .map(line => line.includes(' -> ') ? line.split(' -> ').at(-1) || line : line)
    .filter(Boolean)
}

export async function createCheckpoint(input: {
  sessionId: string
  turnId?: string
  workspace: AgentWorkspaceLocation
  reason: string
}): Promise<CheckpointRef> {
  const gitStatus = await workspaceGitStatus(input.workspace)
  const files = parseChangedFiles(gitStatus)
  const snapshots: Array<{ path: string; content: string | null }> = []
  for (const file of files) {
    try {
      snapshots.push({ path: file, content: await workspaceReadFile(input.workspace, file) })
    } catch {
      snapshots.push({ path: file, content: null })
    }
  }
  const artifact = createArtifact({
    sessionId: input.sessionId,
    turnId: input.turnId,
    kind: 'checkpoint',
    content: {
      reason: input.reason,
      workspace: input.workspace,
      gitStatus,
      files: snapshots,
      createdAt: Date.now(),
    },
    mimeType: 'application/json',
  })
  const runtimeState = await captureRuntimeState({ sessionId: input.sessionId, turnId: input.turnId, workspace: input.workspace })
  const checkpoint: CheckpointRef = {
    id: `checkpoint_${randomUUID()}`,
    sessionId: input.sessionId,
    turnId: input.turnId,
    workspace: input.workspace,
    reason: input.reason,
    files,
    gitStatus,
    artifact,
    artifactRef: artifact.id,
    runtimeStateArtifact: runtimeState.artifact,
    createdAt: Date.now(),
  }
  rememberCheckpoint(checkpoint)
  return checkpoint
}

function parseCheckpointPayload(sessionId: string, checkpoint: CheckpointRef): Array<{ path: string; content: string | null }> {
  const payload = readArtifact(sessionId, checkpoint.artifactRef)
  try {
    const parsed = payload?.encoding === 'utf8'
      ? JSON.parse(payload.content) as { files?: Array<{ path: string; content: string | null }> }
      : null
    return parsed?.files || []
  } catch {
    return []
  }
}

export async function restoreCheckpointAsProposals(checkpointId: string, session: AgentSession, turn: AgentTurn, filePath?: string): Promise<EditProposal[]> {
  const checkpoint = getCheckpoint(session.id, checkpointId)
  if (!checkpoint) throw new Error('Checkpoint does not exist.')
  const snapshots = parseCheckpointPayload(session.id, checkpoint)
  const targets = filePath ? snapshots.filter(file => file.path === filePath) : snapshots
  if (targets.length === 0) throw new Error('Checkpoint has no file snapshots to restore.')
  const proposals: EditProposal[] = []
  for (const snapshot of targets) {
    const currentContent = await workspaceReadFile(checkpoint.workspace, snapshot.path).catch(() => '')
    proposals.push(createEditProposal({
      session,
      turn,
      title: `恢复 checkpoint ${checkpoint.id}: ${snapshot.path}`,
      filePath: snapshot.path,
      originalContent: currentContent,
      modifiedContent: snapshot.content ?? '',
      rationale: `从 checkpoint ${checkpoint.id} 生成可审查恢复提案。`,
      rollbackOf: checkpoint.id,
      checkpointId: checkpoint.id,
    }))
  }
  if (proposals.length > 1) {
    const set = createEditProposalSet({
      session,
      turn,
      title: `恢复 checkpoint ${checkpoint.id}`,
      source: 'checkpoint',
      checkpointId: checkpoint.id,
      proposals,
    })
    return set.proposalIds.map(id => getEditProposal(id)).filter((item): item is EditProposal => Boolean(item))
  }
  return proposals
}

export async function restoreCheckpointAsProposal(checkpointId: string, session: AgentSession, turn: AgentTurn, filePath?: string): Promise<EditProposal> {
  const proposals = await restoreCheckpointAsProposals(checkpointId, session, turn, filePath)
  return proposals[0]
}
