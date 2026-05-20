import { describe, expect, it } from 'vitest'
import { parseTextJsonModelAction } from '../../src/main/agent/modelAdapter'

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
})

