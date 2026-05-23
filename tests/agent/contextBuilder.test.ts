import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentContextSnapshot, AgentPlanItem, AgentSession, AgentTurn, ContextBuildInput, TaskContract } from '../../src/shared/agent/protocol'
import { buildAgentContext, buildAgentContextPrompt } from '../../src/main/agent/contextBuilder'

const tempDirs: string[] = []

function session(): AgentSession {
  return {
    id: 'session_context',
    workspace: null,
    title: 'context test',
    createdAt: 1,
    updatedAt: 1,
    status: 'running',
    permissionMode: 'ask',
  }
}

function turn(): AgentTurn {
  return {
    id: 'turn_context',
    sessionId: 'session_context',
    text: '修复当前类型错误',
    createdAt: 1,
    status: 'running',
  }
}

function snapshot(): AgentContextSnapshot {
  return {
    workspace: null,
    activeFile: {
      path: '/repo/src/main.ts',
      name: 'main.ts',
      isDirty: true,
      content: 'const value: string = 1',
    },
    openFiles: [
      { path: '/repo/src/main.ts', name: 'main.ts', isDirty: true },
      { path: '/repo/src/runtime.ts', name: 'runtime.ts', isDirty: false },
    ],
    diagnostics: [
      { id: 'diag_1', filePath: '/repo/src/main.ts', line: 1, column: 7, severity: 'error', message: 'Type number is not assignable to string.' },
    ],
    cursor: { line: 1, column: 7 },
  }
}

function contract(): TaskContract {
  return {
    id: 'contract_context',
    sessionId: 'session_context',
    turnId: 'turn_context',
    goal: '修复当前类型错误',
    scope: [{ kind: 'file', value: '/repo/src/main.ts', source: 'agent_inferred' }],
    nonGoals: ['不修改无关文件'],
    constraints: ['必须先生成 diff proposal'],
    acceptanceCriteria: [{ id: 'ac_typecheck', text: '类型错误被修复', evidenceRequired: ['diagnostics'], status: 'unverified' }],
    verificationPlan: [{ id: 'verify_diagnostics', verifier: 'diagnostics', reason: '检查可见诊断' }],
    riskPoints: [{ id: 'risk_write', risk: 'medium', text: '可能修改文件', approvalRequired: true }],
    assumptions: [{ id: 'assumption_file', text: '活动文件与任务相关', status: 'open' }],
    status: 'active',
    createdAt: 1,
    updatedAt: 1,
  }
}

function planItems(): AgentPlanItem[] {
  return [
    { id: 'plan_explore', title: '确认上下文', status: 'completed', source: 'runtime', updatedAt: 1 },
    { id: 'plan_fix', title: '生成修改提案', status: 'pending', source: 'runtime', updatedAt: 1 },
  ]
}

function input(overrides: Partial<ContextBuildInput> = {}): ContextBuildInput {
  return {
    phase: 'planning',
    session: session(),
    turn: turn(),
    contextSnapshot: snapshot(),
    taskContract: contract(),
    planItems: planItems(),
    budgetTokens: 4096,
    ...overrides,
  }
}

function createRulesWorkspace(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'rille-context-rules-'))
  tempDirs.push(root)
  for (const [filePath, content] of Object.entries(files)) {
    const targetPath = join(root, filePath)
    mkdirSync(dirname(targetPath), { recursive: true })
    writeFileSync(targetPath, content)
  }
  return root
}

function snapshotWithWorkspace(root: string): AgentContextSnapshot {
  return {
    ...snapshot(),
    workspace: { kind: 'local', path: root, label: 'rules-workspace' },
  }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('buildAgentContext', () => {
  it('returns structured collector fragments and a wrapper-compatible prompt', async () => {
    const contextInput = input()
    const result = await buildAgentContext(contextInput)
    const types = result.fragments.map(item => item.type)

    expect(types).toEqual([
      'task_contract',
      'plan',
      'session_summary',
      'workspace',
      'active_editor',
      'diagnostics',
      'open_files',
    ])
    expect(result.fragments.find(item => item.type === 'workspace')).toMatchObject({
      type: 'workspace',
      section: 'stable_prefix',
      trusted: true,
    })
    expect(result.prompt).toContain('Task Contract:')
    expect(result.prompt).toContain('Structured Plan:')
    expect(result.prompt).toContain('Active file: main.ts (/repo/src/main.ts) dirty=true')
    expect(result.prompt).toContain('Visible diagnostics:')
    expect(result.prompt).not.toContain('const value: string = 1')
  })

  it('keeps buildAgentContextPrompt as a wrapper over minimal buildAgentContext input', async () => {
    const contextInput = input({ taskContract: undefined, planItems: undefined })
    const result = await buildAgentContext(contextInput)
    const legacyPrompt = await buildAgentContextPrompt(contextInput.contextSnapshot)

    expect(legacyPrompt).toBe(result.prompt)
  })

  it('places stable prefix fragments before dynamic suffix fragments', async () => {
    const result = await buildAgentContext(input())
    const firstDynamicIndex = result.fragments.findIndex(item => item.section === 'dynamic_suffix')
    const lastStableIndex = result.fragments.map(item => item.section).lastIndexOf('stable_prefix')

    expect(firstDynamicIndex).toBeGreaterThan(0)
    expect(lastStableIndex).toBeLessThan(firstDynamicIndex)
  })

  it('sorts fragments deterministically by section, priority, source, and id', async () => {
    const root = createRulesWorkspace({ 'README.md': 'project rules' })
    const result = await buildAgentContext(input({ contextSnapshot: snapshotWithWorkspace(root) }))

    expect(result.fragments.map(item => item.type)).toEqual([
      'task_contract',
      'plan',
      'session_summary',
      'project_rules',
      'workspace',
      'active_editor',
      'diagnostics',
      'open_files',
      'git',
    ])
  })

  it('creates trace metadata without storing diagnostic details in trace reasons', async () => {
    const result = await buildAgentContext(input())

    expect(result.trace.included).toHaveLength(result.fragments.length)
    expect(result.trace.excluded).toEqual([])
    expect(result.trace.budgetTokens).toBe(4096)
    expect(result.trace.totalTokenEstimate).toBeGreaterThan(0)
    expect(JSON.stringify(result.trace)).not.toContain('Type number is not assignable to string.')
  })

  it('trims lower-priority fragments deterministically when budget is exhausted', async () => {
    const result = await buildAgentContext(input({ budgetTokens: 5 }))
    const includedTypes = result.fragments.map(item => item.type)
    const excludedTypes = result.trace.excluded.map(item => item.type)

    expect(includedTypes).toEqual(['task_contract'])
    expect(excludedTypes).toEqual(['plan', 'session_summary', 'workspace', 'active_editor', 'diagnostics', 'open_files'])
    expect(result.prompt).toContain('Task Contract:')
    expect(result.prompt).not.toContain('Structured Plan:')
    expect(result.prompt).not.toContain('Open files:')
    expect(result.trace.included).toHaveLength(result.fragments.length)
    expect(result.trace.totalTokenEstimate).toBeGreaterThan(result.trace.included[0].tokenEstimate ?? 0)
  })

  it('limits diagnostics fragments to twenty visible diagnostics', async () => {
    const diagnostics = Array.from({ length: 25 }, (_, index) => ({
      id: `diag_${index}`,
      filePath: `/repo/src/file${index}.ts`,
      line: index + 1,
      column: 1,
      severity: 'error' as const,
      message: `Diagnostic ${index}`,
    }))
    const result = await buildAgentContext(input({ contextSnapshot: { ...snapshot(), diagnostics } }))
    const diagnosticsFragment = result.fragments.find(item => item.type === 'diagnostics')

    expect(diagnosticsFragment?.text).toContain('Diagnostics: 25')
    expect(diagnosticsFragment?.text).toContain('Diagnostic 19')
    expect(diagnosticsFragment?.text).not.toContain('Diagnostic 20')
  })

  it('omits git fragments without a workspace and provides git fallback when status is unavailable', async () => {
    const noWorkspace = await buildAgentContext(input())
    expect(noWorkspace.fragments.some(item => item.type === 'git')).toBe(false)

    const remoteSnapshot: AgentContextSnapshot = {
      ...snapshot(),
      workspace: { kind: 'ssh', path: '/repo', label: 'remote-repo', connectionId: 'missing-host' },
    }
    const remoteResult = await buildAgentContext(input({ contextSnapshot: remoteSnapshot }))
    const gitFragment = remoteResult.fragments.find(item => item.type === 'git')

    expect(gitFragment?.text).toContain('Git status unavailable:')
  })

  it('reads project rules in the final configured order', async () => {
    const root = createRulesWorkspace({
      'AGENTS.md': 'agents rules',
      'CLAUDE.md': 'claude rules',
      'RILLE.md': 'rille rules',
      '.rille/rules.md': 'root rille rules',
      '.rille/rules/b.md': 'b nested rules',
      '.rille/rules/a.md': 'a nested rules',
      '.rille/rules/ignore.txt': 'ignored rules',
      'README.md': 'readme rules',
      '.rille/local.md': 'local rules',
    })
    const result = await buildAgentContext(input({ contextSnapshot: snapshotWithWorkspace(root) }))
    const fragment = result.fragments.find(item => item.type === 'project_rules')

    expect(fragment).toMatchObject({
      id: 'context_project_rules',
      section: 'stable_prefix',
      source: 'AGENTS.md,CLAUDE.md,RILLE.md,.rille/rules.md,.rille/rules/a.md,.rille/rules/b.md,README.md,.rille/local.md',
    })
    const text = fragment?.text ?? ''
    const orderedHeaders = [
      '# AGENTS.md',
      '# CLAUDE.md',
      '# RILLE.md',
      '# .rille/rules.md',
      '# .rille/rules/a.md',
      '# .rille/rules/b.md',
      '# README.md',
      '# .rille/local.md',
    ]
    const indexes = orderedHeaders.map(header => text.indexOf(header))

    expect(indexes.every(index => index >= 0)).toBe(true)
    expect(indexes).toEqual([...indexes].sort((a, b) => a - b))
    expect(text).not.toContain('ignore.txt')
  })

  it('skips missing project rules without blocking other collectors', async () => {
    const root = createRulesWorkspace({ 'README.md': 'only readme rules' })
    const result = await buildAgentContext(input({ contextSnapshot: snapshotWithWorkspace(root) }))
    const fragment = result.fragments.find(item => item.type === 'project_rules')

    expect(fragment?.source).toBe('README.md')
    expect(fragment?.text).toContain('# README.md')
    expect(result.fragments.some(item => item.type === 'workspace')).toBe(true)
    expect(result.fragments.some(item => item.type === 'diagnostics')).toBe(true)
  })

  it('injects handoff fragment in stable_prefix when handoff is provided', async () => {
    const handoff = {
      id: 'handoff_test',
      sessionId: 'session_context',
      turnId: 'turn_context',
      taskContractId: 'contract_context',
      summary: 'Previous task progress summary.',
      completed: ['探索代码'],
      implementedUnverified: ['修复类型错误'],
      failedAttempts: [],
      changedFiles: ['/repo/src/main.ts'],
      evidenceRefs: [],
      unresolvedRisks: [],
      nextSteps: ['运行 typecheck'],
      createdAt: 1,
    }
    const result = await buildAgentContext(input({ handoff }))

    const handoffFragment = result.fragments.find(item => item.type === 'handoff')
    expect(handoffFragment).toBeDefined()
    expect(handoffFragment?.section).toBe('stable_prefix')
    expect(handoffFragment?.text).toContain('Previous session handoff:')
    expect(handoffFragment?.text).toContain('探索代码')
    expect(handoffFragment?.text).toContain('修复类型错误')
    expect(handoffFragment?.text).toContain('/repo/src/main.ts')
    expect(handoffFragment?.text).toContain('运行 typecheck')
  })

  it('omits handoff fragment when no handoff is provided', async () => {
    const result = await buildAgentContext(input())
    expect(result.fragments.some(item => item.type === 'handoff')).toBe(false)
  })

  it('includes session_summary fragment with task progress', async () => {
    const result = await buildAgentContext(input())
    const summaryFragment = result.fragments.find(item => item.type === 'session_summary')
    expect(summaryFragment).toBeDefined()
    expect(summaryFragment?.text).toContain('Session summary:')
    expect(summaryFragment?.text).toContain('修复当前类型错误')
    expect(summaryFragment?.text).toContain('Progress:')
  })
})
