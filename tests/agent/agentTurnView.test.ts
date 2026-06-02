import { describe, expect, it } from 'vitest'
import type { MessagePart, TraceEvent } from '../../src/shared/agent/protocol'
import {
  aggregateUsage,
  buildProcessGroups,
  buildRunSteps,
  elapsedMsForRun,
  formatUsageSummary,
  latestRunningOperation,
  summarizeOperations,
  toolIconKind,
} from '../../src/renderer/components/agent/AgentTurnView'
import { editProposalTitle } from '../../src/renderer/components/agent/AgentPanel'

type ToolPart = Extract<MessagePart, { type: 'tool' }>

function toolPart(input: {
  id: string
  name: string
  state?: ToolPart['state']
  callInput?: Record<string, unknown>
  createdAt?: number
}): ToolPart {
  return {
    id: `part_${input.id}`,
    messageId: 'message_1',
    type: 'tool',
    state: input.state || 'completed',
    createdAt: input.createdAt || 1,
    call: {
      id: input.id,
      name: input.name,
      title: input.name,
      input: input.callInput || {},
      summary: input.name,
      state: input.state || 'completed',
      startedAt: input.createdAt || 1,
      completedAt: input.state === 'running' ? undefined : (input.createdAt || 1) + 10,
    },
    output: input.state === 'running' ? undefined : { output: 'ok', status: 'ok' },
  }
}

describe('AgentTurnView process helpers', () => {
  it('calculates elapsed time from submitted turn metadata and stops after completion', () => {
    expect(elapsedMsForRun({ turnId: 'turn_1', startedAt: 1000, status: 'running' }, 3600)).toBe(2600)
    expect(elapsedMsForRun({ turnId: 'turn_1', startedAt: 1000, completedAt: 4200, status: 'completed' }, 9000)).toBe(3200)
    expect(elapsedMsForRun(null, 9000)).toBe(0)
  })

  it('summarizes completed operations by kind', () => {
    const parts = [
      toolPart({ id: 'read_1', name: 'read_file' }),
      toolPart({ id: 'read_2', name: 'read_file' }),
      toolPart({ id: 'read_3', name: 'read_file' }),
      toolPart({ id: 'search_1', name: 'search_files' }),
      toolPart({ id: 'cmd_1', name: 'run_command' }),
    ]

    expect(summarizeOperations(parts)).toBe('已读取 3 个文件 · 已搜索 1 次 · 已执行 1 条命令')
  })

  it('shows the latest running operation instead of a batch summary', () => {
    const parts = [
      toolPart({ id: 'old', name: 'read_file', state: 'running', callInput: { path: '/tmp/old.ts' }, createdAt: 10 }),
      toolPart({ id: 'new', name: 'read_file', state: 'running', callInput: { path: '/repo/src/main.py' }, createdAt: 20 }),
    ]

    expect(latestRunningOperation(parts)).toBe('正在读取 main.py')
  })

  it('builds one tool batch row for multiple tool calls in one executing stage', () => {
    const parts: MessagePart[] = [
      { id: 'stage_1', messageId: 'message_1', type: 'stage', stage: 'executing_tools', detail: '执行 4 个工具调用', createdAt: 1 },
      toolPart({ id: 'read_1', name: 'read_file', callInput: { path: 'main.py' }, createdAt: 2 }),
      toolPart({ id: 'read_2', name: 'read_file', callInput: { path: 'utils.py' }, createdAt: 3 }),
      toolPart({ id: 'read_3', name: 'read_file', callInput: { path: 'tools.py' }, createdAt: 4 }),
      toolPart({ id: 'cmd_1', name: 'run_command', callInput: { commandLine: 'ls' }, createdAt: 5 }),
    ]

    const groups = buildProcessGroups(parts)
    expect(groups).toHaveLength(1)
    expect(groups[0].parts).toHaveLength(4)
    expect(groups[0].running).toBe(false)
    expect(summarizeOperations(groups[0].parts)).toBe('已读取 3 个文件 · 已执行 1 条命令')
  })

  it('turns model thinking and tool batches into single-line run steps', () => {
    const parts: MessagePart[] = [
      { id: 'stage_model_1', messageId: 'message_1', type: 'stage', stage: 'calling_model', detail: '第 1 轮模型调用', createdAt: 1 },
      { id: 'text_1', messageId: 'message_1', type: 'text', role: 'assistant', text: '让我检查一下当前目录的结构和主要文件。', createdAt: 2 },
      { id: 'stage_tools_1', messageId: 'message_1', type: 'stage', stage: 'executing_tools', detail: '检查项目结构', createdAt: 3 },
      toolPart({ id: 'read_1', name: 'read_file', callInput: { path: 'main.py' }, createdAt: 4 }),
      toolPart({ id: 'cmd_1', name: 'run_command', state: 'running', callInput: { commandLine: 'ls' }, createdAt: 5 }),
    ]

    const steps = buildRunSteps(parts, { id: 'turn_1', sessionId: 'session_1', text: 'task', createdAt: 1, status: 'running' })
    expect(steps).toHaveLength(2)
    expect(steps[0]).toMatchObject({ type: 'model', text: '让我检查一下当前目录的结构和主要文件。', running: false })
    expect(steps[1].type).toBe('tool_batch')
    if (steps[1].type === 'tool_batch') {
      expect(steps[1].summary).toBe('检查项目结构')
      expect(steps[1].parts).toHaveLength(2)
      expect(steps[1].running).toBe(true)
      expect(latestRunningOperation(steps[1].parts)).toBe('正在执行 ls')
    }
  })

  it('keeps completed tool steps available while leaving final summary outside process steps', () => {
    const parts: MessagePart[] = [
      { id: 'stage_model_1', messageId: 'message_1', type: 'stage', stage: 'calling_model', createdAt: 1 },
      { id: 'text_1', messageId: 'message_1', type: 'text', role: 'assistant', text: '先检查文件。', createdAt: 2 },
      { id: 'stage_tools_1', messageId: 'message_1', type: 'stage', stage: 'executing_tools', detail: '执行 1 个工具调用', createdAt: 3 },
      toolPart({ id: 'read_1', name: 'read_file', callInput: { path: 'main.py' }, createdAt: 4 }),
      { id: 'stage_model_2', messageId: 'message_1', type: 'stage', stage: 'calling_model', createdAt: 5 },
      { id: 'summary_1', messageId: 'message_1', type: 'text', role: 'assistant', text: '总结完成。', createdAt: 6 },
      { id: 'stage_done', messageId: 'message_1', type: 'stage', stage: 'completed', detail: '模型给出最终答复', createdAt: 7 },
    ]

    const steps = buildRunSteps(parts)
    expect(steps.map(step => step.type)).toEqual(['model', 'tool_batch'])
    expect(steps.some(step => step.type === 'tool_batch' && step.parts.length === 1)).toBe(true)
  })

  it('does not keep stale thinking rows when a model round only leads into tools', () => {
    const parts: MessagePart[] = [
      { id: 'stage_model_1', messageId: 'message_1', type: 'stage', stage: 'calling_model', createdAt: 1 },
      { id: 'stage_tools_1', messageId: 'message_1', type: 'stage', stage: 'executing_tools', detail: '读取主要文件', createdAt: 2 },
      toolPart({ id: 'read_1', name: 'read_file', callInput: { path: 'main.py' }, createdAt: 3 }),
      { id: 'stage_model_2', messageId: 'message_1', type: 'stage', stage: 'calling_model', createdAt: 4 },
    ]

    const steps = buildRunSteps(parts, { id: 'turn_1', sessionId: 'session_1', text: 'task', createdAt: 1, status: 'running' })
    expect(steps.map(step => step.type)).toEqual(['tool_batch', 'model'])
    expect(steps[1]).toMatchObject({ type: 'model', running: true })
  })

  it('aggregates token usage with missing fields treated as zero', () => {
    const traceEvents: TraceEvent[] = [
      {
        type: 'cost.updated',
        sessionId: 'session_1',
        turnId: 'turn_1',
        usage: {
          model: 'model',
          providerId: 'provider',
          inputTokens: 1000,
          cachedInputTokens: 250,
        },
        createdAt: 1,
      },
      {
        type: 'cost.updated',
        sessionId: 'session_1',
        turnId: 'turn_1',
        usage: {
          model: 'model',
          providerId: 'provider',
          outputTokens: 500,
          costUsd: 0.0123,
        },
        createdAt: 2,
      },
    ]

    const usage = aggregateUsage(traceEvents, 'turn_1')
    expect(usage.inputTokens).toBe(1000)
    expect(usage.outputTokens).toBe(500)
    expect(usage.cachedInputTokens).toBe(250)
    expect(formatUsageSummary(usage)).toBe('Input 1.0k · Output 500 · Cache 250 · $0.0123')
  })

  it('maps operation names to icon kinds', () => {
    expect(toolIconKind('run_command')).toBe('command')
    expect(toolIconKind('write_file')).toBe('edit')
    expect(toolIconKind('read_file')).toBe('read')
    expect(toolIconKind('search_files')).toBe('search')
  })

  it('formats edit proposal popover titles', () => {
    const proposal = {
      id: 'proposal_1',
      sessionId: 'session_1',
      turnId: 'turn_1',
      title: '修改 README.md',
      filePath: '/repo/README.md',
      originalContent: '',
      modifiedContent: '# README',
      state: 'pending' as const,
      createdAt: 1,
    }

    expect(editProposalTitle([proposal])).toBe('模型请求编辑 README.md')
    expect(editProposalTitle([proposal, { ...proposal, id: 'proposal_2', filePath: '/repo/main.py' }])).toBe('模型请求编辑 2 个文件')
  })
})
