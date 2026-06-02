import { describe, expect, it } from 'vitest'
import type { AgentContextSnapshot, AgentSession, AgentTurn } from '../../src/shared/agent/protocol'
import { createInitialPlanItems, createInitialTaskContract, normalizePlanUpdate, normalizeTaskContractUpdate } from '../../src/main/agent/taskContract'

function session(): AgentSession {
  return {
    id: 'session_test',
    workspace: { kind: 'local', path: '/repo', label: 'repo' },
    title: 'test',
    createdAt: 1,
    updatedAt: 1,
    status: 'idle',
    permissionMode: 'default',
  }
}

function turn(): AgentTurn {
  return {
    id: 'turn_test',
    sessionId: 'session_test',
    text: '修复当前类型错误',
    createdAt: 1,
    status: 'running',
  }
}

function context(): AgentContextSnapshot {
  return {
    workspace: { kind: 'local', path: '/repo', label: 'repo' },
    activeFile: {
      path: '/repo/src/main.ts',
      name: 'main.ts',
      isDirty: false,
      content: 'export const value = 1',
    },
    openFiles: [],
    diagnostics: [{ id: 'd1', filePath: '/repo/src/main.ts', line: 1, column: 1, severity: 'error', message: 'Type mismatch' }],
    cursor: { line: 1, column: 1 },
  }
}

describe('Task Contract creation', () => {
  it('creates a write-task contract with scope, risks, and acceptance criteria', () => {
    const contract = createInitialTaskContract({
      session: session(),
      turn: turn(),
      text: '修复当前类型错误',
      context: context(),
      timestamp: 100,
    })

    expect(contract.goal).toBe('修复当前类型错误')
    expect(contract.scope[0]).toMatchObject({ kind: 'file', value: '/repo/src/main.ts' })
    expect(contract.acceptanceCriteria.some(item => item.id === 'ac_diff')).toBe(true)
    expect(contract.riskPoints.some(item => item.approvalRequired)).toBe(true)
    expect(contract.constraints.join('\n')).toContain('apply_file_edit')
  })

  it('creates initial plan items tied to the contract', () => {
    const contract = createInitialTaskContract({
      session: session(),
      turn: turn(),
      text: '修复当前类型错误',
      context: context(),
      timestamp: 100,
    })
    const items = createInitialPlanItems(contract, 101)

    expect(items[0]).toMatchObject({ id: 'plan_contract', status: 'completed', evidence: contract.id })
    expect(items.map(item => item.id)).toEqual(['plan_contract', 'plan_explore', 'plan_execute', 'plan_verify'])
    expect(items[1].status).toBe('in_progress')
  })

  it('merges update_plan input without dropping existing items', () => {
    const contract = createInitialTaskContract({
      session: session(),
      turn: turn(),
      text: '修复当前类型错误',
      context: context(),
      timestamp: 100,
    })
    const currentItems = createInitialPlanItems(contract, 101)
    const result = normalizePlanUpdate({
      currentItems,
      rawItems: [
        { id: 'plan_explore', title: '读取相关上下文并确认修改范围', status: 'completed', evidence: 'read_file' },
        { title: '补充回归测试', status: 'pending' },
      ],
      reason: '探索完成',
      timestamp: 102,
    })

    expect(result.reason).toBe('探索完成')
    expect(result.items).toHaveLength(5)
    expect(result.items.find(item => item.id === 'plan_explore')?.status).toBe('completed')
    expect(result.items[4]).toMatchObject({ title: '补充回归测试', status: 'pending', source: 'model' })
  })

  it('normalizes task contract updates and rejects empty patches', () => {
    const contract = createInitialTaskContract({
      session: session(),
      turn: turn(),
      text: '修复当前类型错误',
      context: context(),
      timestamp: 100,
    })
    const result = normalizeTaskContractUpdate({
      currentContract: contract,
      patch: {
        goal: '修复 main.ts 的类型错误',
        acceptanceCriteria: [{ id: 'ac_goal', text: '类型错误消失', evidenceRequired: ['diagnostics'], status: 'unverified' }],
        extraField: 'ignored',
      },
      reason: '收窄目标',
      timestamp: 120,
    })

    expect(result.reason).toBe('收窄目标')
    expect(result.contract.goal).toBe('修复 main.ts 的类型错误')
    expect(result.contract.acceptanceCriteria[0]).toMatchObject({ id: 'ac_goal', text: '类型错误消失', status: 'unverified' })
    expect(result.contract.status).toBe('updated')
    expect(result.contract.updatedAt).toBe(120)
    expect(() => normalizeTaskContractUpdate({ currentContract: contract, patch: { extraField: 'ignored' } })).toThrow(/至少需要一个有效字段/)
    expect(() => normalizeTaskContractUpdate({ currentContract: contract, patch: { goal: '   ', acceptanceCriteria: [] } })).toThrow(/至少需要一个有效字段/)
  })
})
