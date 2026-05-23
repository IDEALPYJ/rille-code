import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { applyEditProposal, createEditProposal, createRollbackProposal, rejectEditProposal } from '../../src/main/agent/editStore'
import type { AgentContextSnapshot, AgentSession, AgentTurn } from '../../src/shared/agent/protocol'

let root = ''

function fixtures() {
  root = mkdtempSync(join(tmpdir(), 'rille-edit-'))
  mkdirSync(join(root, 'src'))
  const session: AgentSession = {
    id: 'session_test',
    workspace: { kind: 'local', path: root, label: 'tmp' },
    title: 'tmp',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'idle',
    permissionMode: 'ask',
  }
  const turn: AgentTurn = { id: 'turn_test', sessionId: session.id, text: 'test', createdAt: Date.now(), status: 'completed' }
  return { session, turn, filePath: join(root, 'src/file.ts') }
}

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true })
})

describe('editStore', () => {
  it('detects conflicts before applying', async () => {
    const { session, turn, filePath } = fixtures()
    writeFileSync(filePath, 'one', 'utf8')
    const proposal = createEditProposal({ session, turn, title: 'edit', filePath, originalContent: 'one', modifiedContent: 'two' })
    await writeFile(filePath, 'changed', 'utf8')
    const applied = await applyEditProposal(proposal.id, session.workspace)
    expect(applied.state).toBe('conflicted')
    expect(await readFile(filePath, 'utf8')).toBe('changed')
  })

  it('does not apply when the current IDE snapshot still has the same file dirty', async () => {
    const { session, turn, filePath } = fixtures()
    writeFileSync(filePath, 'one', 'utf8')
    const proposal = createEditProposal({ session, turn, title: 'edit', filePath, originalContent: 'one', modifiedContent: 'two' })
    const context: AgentContextSnapshot = {
      workspace: session.workspace,
      activeFile: null,
      openFiles: [{ path: filePath, name: 'file.ts', isDirty: true }],
      diagnostics: [],
    }

    const applied = await applyEditProposal(proposal.id, session.workspace, context)

    expect(applied.state).toBe('conflicted')
    expect(await readFile(filePath, 'utf8')).toBe('one')
  })

  it('also guards against a dirty active file when openFiles is stale', async () => {
    const { session, turn, filePath } = fixtures()
    writeFileSync(filePath, 'one', 'utf8')
    const proposal = createEditProposal({ session, turn, title: 'edit', filePath, originalContent: 'one', modifiedContent: 'two' })
    const context: AgentContextSnapshot = {
      workspace: session.workspace,
      activeFile: { path: filePath, name: 'file.ts', isDirty: true, content: 'dirty buffer' },
      openFiles: [],
      diagnostics: [],
    }

    const applied = await applyEditProposal(proposal.id, session.workspace, context)

    expect(applied.state).toBe('conflicted')
    expect(await readFile(filePath, 'utf8')).toBe('one')
  })

  it('stores reject reasons and creates rollback proposals', async () => {
    const { session, turn, filePath } = fixtures()
    writeFileSync(filePath, 'one', 'utf8')
    const proposal = createEditProposal({ session, turn, title: 'edit', filePath, originalContent: 'one', modifiedContent: 'two' })
    const rejected = rejectEditProposal(proposal.id, 'not now')
    expect(rejected.rejectedReason).toBe('not now')

    const appliedProposal = createEditProposal({ session, turn, title: 'edit2', filePath, originalContent: 'one', modifiedContent: 'two' })
    const applied = await applyEditProposal(appliedProposal.id, session.workspace)
    const rollback = createRollbackProposal(applied.id, session, turn)
    expect(rollback.rollbackOf).toBe(applied.id)
    expect(rollback.originalContent).toBe('two')
    expect(rollback.modifiedContent).toBe('one')
  })
})
