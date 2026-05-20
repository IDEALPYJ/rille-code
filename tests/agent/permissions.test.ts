import { describe, expect, it } from 'vitest'
import { classifyCommandRisk, decidePermission } from '../../src/main/agent/permissions'

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
  it('allows read-only tools', () => {
    const decision = decidePermission({
      call: { id: 'tool_1', name: 'read_file', input: { filePath: 'x.ts' } },
      mode: 'ask',
      sessionId: 'session_1',
      turnId: 'turn_1',
    })
    expect(decision.action).toBe('allow')
  })

  it('denies runtime-only apply_file_edit from model calls', () => {
    const decision = decidePermission({
      call: { id: 'tool_1', name: 'apply_file_edit', input: { proposalId: 'proposal_1' } },
      mode: 'ask',
      sessionId: 'session_1',
      turnId: 'turn_1',
    })
    expect(decision.action).toBe('deny')
  })

  it('asks for test commands and includes command details', () => {
    const decision = decidePermission({
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
})

