import { describe, expect, it } from 'vitest'
import type { MessagePart, TraceEvent } from '../../src/shared/agent/protocol'
import {
  aggregateUsage,
  buildProcessGroups,
  formatUsageSummary,
  latestRunningOperation,
  summarizeOperations,
} from '../../src/renderer/components/agent/AgentTurnView'

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
  it('summarizes completed operations by kind', () => {
    const parts = [
      toolPart({ id: 'read_1', name: 'read_file' }),
      toolPart({ id: 'read_2', name: 'read_file' }),
      toolPart({ id: 'read_3', name: 'read_file' }),
      toolPart({ id: 'search_1', name: 'search_files' }),
      toolPart({ id: 'cmd_1', name: 'run_command' }),
    ]

    expect(summarizeOperations(parts)).toBe('已读取 3 个文件 · 已搜索 1 次 · 已运行 1 条命令')
  })

  it('shows the latest running operation instead of a batch summary', () => {
    const parts = [
      toolPart({ id: 'old', name: 'read_file', state: 'running', callInput: { path: '/tmp/old.ts' }, createdAt: 10 }),
      toolPart({ id: 'new', name: 'read_file', state: 'running', callInput: { path: '/repo/src/main.py' }, createdAt: 20 }),
    ]

    expect(latestRunningOperation(parts)).toBe('正在读取 main.py')
  })

  it('builds process groups from stages and following tool calls', () => {
    const parts: MessagePart[] = [
      { id: 'stage_1', messageId: 'message_1', type: 'stage', stage: 'executing_tools', detail: '先读取关键文件。', createdAt: 1 },
      toolPart({ id: 'read_1', name: 'read_file', callInput: { path: 'main.py' }, createdAt: 2 }),
      { id: 'stage_2', messageId: 'message_1', type: 'stage', stage: 'running_verification', createdAt: 3 },
      toolPart({ id: 'cmd_1', name: 'run_command', state: 'running', callInput: { commandLine: 'npm test' }, createdAt: 4 }),
    ]

    const groups = buildProcessGroups(parts)
    expect(groups).toHaveLength(2)
    expect(groups[0].description).toBe('先读取关键文件。')
    expect(groups[0].running).toBe(false)
    expect(groups[1].description).toBe('我会验证刚才的变更。')
    expect(groups[1].running).toBe(true)
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
    expect(formatUsageSummary(usage)).toBe('Token 1.5k · 缓存 250 · $0.0123')
  })
})
