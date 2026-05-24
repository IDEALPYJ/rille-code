import { randomUUID } from 'crypto'
import type { AgentSession, AgentTurn, AgentWorkspaceLocation, CheckpointRef, EditProposal } from '../../shared/agent/protocol'
import { createArtifact, readArtifact } from './artifactStore'
import { createEditProposal } from './editStore'
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

export async function restoreCheckpointAsProposal(checkpointId: string, session: AgentSession, turn: AgentTurn, filePath?: string): Promise<EditProposal> {
  const checkpoint = getCheckpoint(session.id, checkpointId)
  if (!checkpoint) throw new Error('Checkpoint does not exist.')
  const targetFile = filePath || checkpoint.files[0]
  if (!targetFile) throw new Error('Checkpoint has no file snapshots to restore.')
  const payload = readArtifact(session.id, checkpoint.artifactRef)
  let parsed: { files?: Array<{ path: string; content: string | null }> } | null = null
  try {
    parsed = payload?.encoding === 'utf8' ? JSON.parse(payload.content) as { files?: Array<{ path: string; content: string | null }> } : null
  } catch {
    parsed = null
  }
  const snapshot = parsed?.files?.find(file => file.path === targetFile)
  const currentContent = await workspaceReadFile(checkpoint.workspace, targetFile).catch(() => '')
  return createEditProposal({
    session,
    turn,
    title: `恢复 checkpoint ${checkpoint.id}`,
    filePath: targetFile,
    originalContent: currentContent,
    modifiedContent: snapshot?.content ?? '',
    rationale: `从 checkpoint ${checkpoint.id} 生成可审查恢复提案。`,
    rollbackOf: checkpoint.id,
  })
}
