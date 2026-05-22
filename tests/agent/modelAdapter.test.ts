import { describe, expect, it } from 'vitest'
import type { AgentPlanItem, AgentSession, TaskContract } from '../../src/shared/agent/protocol'
import { parseTextJsonModelAction, TextJsonToolAdapter } from '../../src/main/agent/modelAdapter'

describe('parseTextJsonModelAction', () => {
  it('parses fenced tool calls', () => {
    const action = parseTextJsonModelAction('```json\n{"tool_calls":[{"name":"read_file","input":{"filePath":"src/main/index.ts"}}],"text":"读取文件"}\n```')
    expect(action.type).toBe('tool_calls')
    if (action.type === 'tool_calls') {
      expect(action.toolCalls).toHaveLength(1)
      expect(action.toolCalls[0].name).toBe('read_file')
      expect(action.toolCalls[0].input.filePath).toBe('src/main/index.ts')
    }
  })

  it('falls back to answer when JSON cannot be parsed', () => {
    const action = parseTextJsonModelAction('普通回答')
    expect(action).toEqual({ type: 'answer', text: '普通回答' })
  })

  it('parses answer JSON', () => {
    expect(parseTextJsonModelAction('{"answer":"完成"}')).toEqual({ type: 'answer', text: '完成' })
  })

  it('injects task contract and structured plan into model messages', () => {
    const session: AgentSession = {
      id: 'session_1',
      workspace: null,
      title: 'test',
      createdAt: 1,
      updatedAt: 1,
      status: 'idle',
      permissionMode: 'ask',
    }
    const contract: TaskContract = {
      id: 'contract_1',
      sessionId: 'session_1',
      turnId: 'turn_1',
      goal: '修复当前类型错误',
      scope: [{ kind: 'file', value: 'src/main.ts', source: 'agent_inferred' }],
      nonGoals: ['不修改无关文件'],
      constraints: ['必须使用 diff proposal'],
      acceptanceCriteria: [{ id: 'ac_goal', text: '类型检查通过', evidenceRequired: ['command'], status: 'unverified' }],
      verificationPlan: [{ id: 'verify_typecheck', verifier: 'typecheck', command: 'npm run typecheck', reason: '验证类型错误' }],
      riskPoints: [{ id: 'risk_scope', risk: 'medium', text: '可能写文件', approvalRequired: true }],
      assumptions: [{ id: 'assumption_scope', text: '活动文件相关', status: 'open' }],
      status: 'active',
      createdAt: 1,
      updatedAt: 1,
    }
    const planItems: AgentPlanItem[] = [
      { id: 'plan_explore', title: '探索上下文', status: 'in_progress', source: 'runtime', updatedAt: 1 },
    ]

    const messages = new TextJsonToolAdapter().buildMessages({
      session,
      contextPrompt: 'Workspace: repo',
      userTask: '修复当前类型错误',
      taskContract: contract,
      planItems,
    })

    expect(messages[0].content).toContain('update_plan')
    expect(messages[0].content).toContain('acceptanceCriteria')
    expect(messages[1].content).toContain('Task Contract JSON')
    expect(messages[1].content).toContain('"goal": "修复当前类型错误"')
    expect(messages[1].content).toContain('"title": "探索上下文"')
  })
})
