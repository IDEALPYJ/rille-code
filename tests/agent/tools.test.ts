import { describe, expect, it, vi } from 'vitest'
import type { AgentContextSnapshot, AgentPlanItem, AgentSession, AgentTurn } from '../../src/shared/agent/protocol'
import { executeToolCall, getModelVisibleToolDefinitions } from '../../src/main/agent/tools'

function session(): AgentSession {
  return {
    id: 'session_test',
    workspace: { kind: 'local', path: '/repo', label: 'repo' },
    title: 'test',
    createdAt: 1,
    updatedAt: 1,
    status: 'idle',
    permissionMode: 'ask',
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
    activeFile: null,
    openFiles: [],
    diagnostics: [],
  }
}

describe('update_plan tool', () => {
  it('is model-visible and updates runtime plan state', async () => {
    expect(getModelVisibleToolDefinitions().some(tool => tool.name === 'update_plan')).toBe(true)
    const currentItems: AgentPlanItem[] = [
      { id: 'plan_explore', title: '探索上下文', status: 'in_progress', source: 'runtime', updatedAt: 1 },
      { id: 'plan_verify', title: '验证结果', status: 'pending', source: 'runtime', updatedAt: 1 },
    ]
    const updatePlan = vi.fn((items: AgentPlanItem[]) => items)

    const result = await executeToolCall(
      {
        id: 'tool_plan',
        name: 'update_plan',
        input: {
          reason: '完成探索',
          items: [{ id: 'plan_explore', title: '探索上下文', status: 'completed', evidence: 'read_file' }],
        },
      },
      {
        session: session(),
        turn: turn(),
        context: context(),
        planItems: currentItems,
        emitProposal: vi.fn(),
        updatePlan,
      },
    )

    expect(result.status).toBe('ok')
    expect(updatePlan).toHaveBeenCalledOnce()
    const nextItems = updatePlan.mock.calls[0][0]
    expect(nextItems).toHaveLength(2)
    expect(nextItems[0]).toMatchObject({ id: 'plan_explore', status: 'completed', evidence: 'read_file' })
  })

  it('returns an error when runtime does not expose plan updates', async () => {
    const result = await executeToolCall(
      {
        id: 'tool_plan',
        name: 'update_plan',
        input: { items: [{ title: '探索上下文', status: 'completed' }] },
      },
      {
        session: session(),
        turn: turn(),
        context: context(),
        emitProposal: vi.fn(),
      },
    )

    expect(result.status).toBe('error')
    expect(result.error).toBe('plan_update_unavailable')
  })
})
