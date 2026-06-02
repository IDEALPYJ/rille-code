import { mkdtempSync, writeFileSync } from 'fs'
import { mkdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { discoverVerificationCommands, VerifierRunner } from '../../src/main/agent/verifier'
import type { AgentSession, AgentTurn, AgentWorkspaceLocation } from '../../src/shared/agent/protocol'

let root = ''

function workspace(): AgentWorkspaceLocation {
  root = mkdtempSync(join(tmpdir(), 'rille-verifier-'))
  return { kind: 'local', path: root, label: 'tmp' }
}

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true }).catch(() => {})
})

describe('discoverVerificationCommands', () => {
  it('prefers policy commands', async () => {
    const ws = workspace()
    await mkdir(join(root, '.rille'))
    writeFileSync(join(root, '.rille/policy.json'), JSON.stringify({ agent: { verification: { commands: ['npm run build'] } } }), 'utf8')
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { typecheck: 'tsc' } }), 'utf8')
    await expect(discoverVerificationCommands(ws)).resolves.toEqual([{ verifier: 'command', command: 'npm run build' }])
  })

  it('discovers package typecheck script', async () => {
    const ws = workspace()
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { typecheck: 'tsc -p tsconfig.json' } }), 'utf8')
    await expect(discoverVerificationCommands(ws)).resolves.toEqual([{ verifier: 'command', command: 'npm run typecheck' }])
  })

  it('keeps verification result and creates command evidence', async () => {
    const ws = workspace()
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { typecheck: 'node -e "process.exit(0)"' } }), 'utf8')
    const session: AgentSession = {
      id: 'session_verify',
      workspace: ws,
      title: 'verify',
      createdAt: 1,
      updatedAt: 1,
      status: 'idle',
      permissionMode: 'default',
    }
    const turn: AgentTurn = { id: 'turn_verify', sessionId: session.id, text: 'verify', createdAt: 1, status: 'running' }
    const { result, evidence } = await new VerifierRunner(session, turn).runFirstAvailableWithEvidence()

    expect(result.status).toBe('passed')
    expect(evidence).toMatchObject({ source: 'command', status: 'passed', sessionId: session.id, turnId: turn.id })
  })
})
