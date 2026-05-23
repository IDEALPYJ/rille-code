import { readFile, writeFile } from 'fs/promises'
import { resolve } from 'path'
import { randomUUID } from 'crypto'
import type { AgentContextSnapshot, AgentSession, AgentTurn, AgentWorkspaceLocation, EditProposal } from '../../shared/agent/protocol'
import { canonicalWorkspacePath, isRemoteWorkspace, withinWorkspace, workspaceReadFile, workspaceWriteFile } from './workspace'

const proposals = new Map<string, EditProposal>()

export function createEditProposal(input: {
  session: AgentSession
  turn: AgentTurn
  title: string
  filePath: string
  originalContent: string
  modifiedContent: string
  rationale?: string
  rollbackOf?: string
}): EditProposal {
  const proposal: EditProposal = {
    id: `proposal_${randomUUID()}`,
    sessionId: input.session.id,
    turnId: input.turn.id,
    title: input.title,
    filePath: input.filePath,
    originalContent: input.originalContent,
    modifiedContent: input.modifiedContent,
    rationale: input.rationale,
    rollbackOf: input.rollbackOf,
    state: 'pending',
    createdAt: Date.now(),
  }
  proposals.set(proposal.id, proposal)
  return proposal
}

export function getEditProposal(proposalId: string): EditProposal | null {
  return proposals.get(proposalId) ?? null
}

export function hydrateEditProposal(proposal: EditProposal): void {
  proposals.set(proposal.id, proposal)
}

export function rejectEditProposal(proposalId: string, reason?: string): EditProposal {
  const proposal = proposals.get(proposalId)
  if (!proposal) throw new Error('Edit proposal does not exist.')
  const next: EditProposal = { ...proposal, state: 'rejected', rejectedReason: reason }
  proposals.set(proposalId, next)
  return next
}

export function createRollbackProposal(proposalId: string, session: AgentSession, turn: AgentTurn): EditProposal {
  const proposal = proposals.get(proposalId)
  if (!proposal) throw new Error('Edit proposal does not exist.')
  if (proposal.state !== 'applied') throw new Error('Only applied proposals can be rolled back.')
  return createEditProposal({
    session,
    turn,
    title: `回滚 ${proposal.title}`,
    filePath: proposal.filePath,
    originalContent: proposal.modifiedContent,
    modifiedContent: proposal.originalContent,
    rationale: `回滚已应用的编辑提案 ${proposal.id}。`,
    rollbackOf: proposal.id,
  })
}

function hasDirtySnapshotConflict(proposal: EditProposal, workspace?: AgentWorkspaceLocation | null, context?: AgentContextSnapshot): boolean {
  if (!workspace || !context) return false
  const files = [
    ...(context.activeFile ? [context.activeFile] : []),
    ...context.openFiles,
  ]
  return files.some(file => {
    if (!file.isDirty) return false
    try {
      return canonicalWorkspacePath(workspace, file.path) === canonicalWorkspacePath(workspace, proposal.filePath)
    } catch {
      return file.path === proposal.filePath
    }
  })
}

export async function applyEditProposal(proposalId: string, workspace?: AgentWorkspaceLocation | null, context?: AgentContextSnapshot): Promise<EditProposal> {
  const proposal = proposals.get(proposalId)
  if (!proposal) throw new Error('Edit proposal does not exist.')
  if (proposal.state !== 'pending') return proposal
  if (hasDirtySnapshotConflict(proposal, workspace, context)) {
    const conflicted: EditProposal = { ...proposal, state: 'conflicted' }
    proposals.set(proposalId, conflicted)
    return conflicted
  }
  const filePath = workspace ? withinWorkspace(workspace, proposal.filePath) : resolve(proposal.filePath)
  const current = await (workspace && isRemoteWorkspace(workspace) ? workspaceReadFile(workspace, filePath) : readFile(filePath, 'utf8')).catch(error => {
    const message = error instanceof Error ? error.message : String(error)
    if (proposal.originalContent === '' && /enoent|no such file|cannot find/i.test(message)) return ''
    throw error
  })
  if (current !== proposal.originalContent) {
    const conflicted: EditProposal = { ...proposal, state: 'conflicted' }
    proposals.set(proposalId, conflicted)
    return conflicted
  }
  if (workspace && isRemoteWorkspace(workspace)) await workspaceWriteFile(workspace, filePath, proposal.modifiedContent)
  else await writeFile(filePath, proposal.modifiedContent, 'utf8')
  const applied: EditProposal = { ...proposal, state: 'applied' }
  proposals.set(proposalId, applied)
  return applied
}
