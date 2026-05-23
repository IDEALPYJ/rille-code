import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach } from 'vitest'
import { classifyCommandRisk, decidePermission, PermissionGrantStore } from '../../src/main/agent/permissions'

let root = ''

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true })
  root = ''
})

describe('command risk classifier', () => {
  it('classifies common command shapes', () => {
    expect(classifyCommandRisk('git status --short')).toBe('read_only')
    expect(classifyCommandRisk('npm run typecheck')).toBe('test')
    expect(classifyCommandRisk('npm install')).toBe('install')
    expect(classifyCommandRisk('git push origin main')).toBe('deploy')
    expect(classifyCommandRisk('rm -rf /')).toBe('destructive')
  })
})

describe('permission decisions', () => {
  it('allows read-only tools', async () => {
    const decision = await decidePermission({
      call: { id: 'tool_1', name: 'read_file', input: { filePath: 'x.ts' } },
      mode: 'ask',
      sessionId: 'session_1',
      turnId: 'turn_1',
    })
    expect(decision.action).toBe('allow')
  })

  it('denies runtime-only apply_file_edit from model calls', async () => {
    const decision = await decidePermission({
      call: { id: 'tool_1', name: 'apply_file_edit', input: { proposalId: 'proposal_1' } },
      mode: 'ask',
      sessionId: 'session_1',
      turnId: 'turn_1',
    })
    expect(decision.action).toBe('deny')
  })

  it('asks for test commands and includes command details', async () => {
    const decision = await decidePermission({
      call: { id: 'tool_1', name: 'run_command', input: { commandLine: 'npm run typecheck', cwd: '.', timeoutMs: 1000 } },
      mode: 'ask',
      sessionId: 'session_1',
      turnId: 'turn_1',
    })
    expect(decision.action).toBe('ask')
    if (decision.action === 'ask') {
      expect(decision.request.risk).toBe('medium')
      expect(decision.request.details?.commandRisk).toBe('test')
      expect(decision.request.details?.cwd).toBe('.')
    }
  })

  it('does not let project policy override destructive commands', async () => {
    root = mkdtempSync(join(tmpdir(), 'rille-policy-'))
    mkdirSync(join(root, '.rille'))
    writeFileSync(join(root, '.rille/policy.json'), JSON.stringify({
      agent: {
        permissions: [{ id: 'allow_rm', permission: 'command.run', pattern: 'rm -rf /', action: 'allow' }],
      },
    }), 'utf8')

    const decision = await decidePermission({
      call: { id: 'tool_1', name: 'run_command', input: { commandLine: 'rm -rf /' } },
      mode: 'ask',
      sessionId: 'session_1',
      turnId: 'turn_1',
      context: { workspace: { kind: 'local', path: root, label: 'tmp' }, activeFile: null, openFiles: [], diagnostics: [] },
    })

    expect(decision.action).toBe('deny')
    expect(decision.policyDecision.risk).toBe('critical')
  })

  it('allows project policy verification commands in ask mode', async () => {
    root = mkdtempSync(join(tmpdir(), 'rille-policy-'))
    mkdirSync(join(root, '.rille'))
    writeFileSync(join(root, '.rille/policy.json'), JSON.stringify({
      agent: { verification: { commands: ['npm run typecheck'] } },
    }), 'utf8')

    const decision = await decidePermission({
      call: { id: 'tool_1', name: 'run_command', input: { commandLine: 'npm run typecheck' } },
      mode: 'ask',
      sessionId: 'session_1',
      turnId: 'turn_1',
      context: { workspace: { kind: 'local', path: root, label: 'tmp' }, activeFile: null, openFiles: [], diagnostics: [] },
    })

    expect(decision.action).toBe('allow')
    expect(decision.policyDecision.matchedRule).toBe('verification:npm run typecheck')
  })

  it('consumes once grants and keeps session grants', () => {
    const grants = new PermissionGrantStore()
    grants.add({ permission: 'command.run', pattern: 'run_command:npm run', scope: 'once' })
    expect(grants.match('command.run', 'run_command:npm run')?.scope).toBe('once')
    expect(grants.match('command.run', 'run_command:npm run')).toBeNull()

    grants.add({ permission: 'command.run', pattern: 'run_command:npm run', scope: 'session' })
    expect(grants.match('command.run', 'run_command:npm run')?.scope).toBe('session')
    expect(grants.match('command.run', 'run_command:npm run')?.scope).toBe('session')
  })
})
