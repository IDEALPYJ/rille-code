import type { AgentPlanItem, AgentSession, TaskContract } from '../../shared/agent/protocol'
import type { AgentChatMessage } from './provider'
import { createRuntimeToolCall, getModelVisibleToolDefinitions, type RuntimeToolCall } from './tools'

export type ModelAction =
  | { type: 'answer'; text: string }
  | { type: 'tool_calls'; toolCalls: RuntimeToolCall[]; text?: string; step?: string }

export interface ModelAdapter {
  buildMessages(input: { session: AgentSession; contextPrompt: string; userTask: string; taskContract?: TaskContract; planItems?: AgentPlanItem[] }): AgentChatMessage[]
  parseAction(text: string): ModelAction
}

export function systemPrompt(session: AgentSession): string {
  const tools = getModelVisibleToolDefinitions().map(tool => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    isReadOnly: tool.isReadOnly,
  }))
  return [
    '你是 RilleCode IDE 内置的 coding agent。回答默认使用中文。',
    '你必须通过工具探索代码；不要声称已经读取、修改或运行命令，除非工具结果显示已完成。',
    '写文件必须先调用 propose_file_edit 生成 diff proposal；用户或 runtime 批准后才会应用。',
    '命令只能通过 run_command 运行，并会经过权限策略或用户审批。',
    '当前任务合同是行动边界：不得扩大 scope，不得执行 nonGoals，最终 answer 必须逐条回到 acceptanceCriteria。',
    '你必须通过 update_plan 工具维护结构化计划；不要只在自然语言里声称计划状态已变化。',
    '工具结果会包含 status、exitCode、timedOut、truncated、durationMs 等验证字段；命令失败、超时或诊断仍有错误时，必须继续修复或明确说明阻塞原因。',
    `当前权限模式: ${session.permissionMode}。`,
    '',
    '可用工具 JSON:',
    JSON.stringify(tools),
    '',
    '输出协议：',
    '1. 如果需要调用工具，只返回 JSON：{"step":"本轮动作简述","tool_calls":[{"name":"read_file","input":{"filePath":"..."}},{"name":"run_command","input":{"commandLine":"npm test"}}],"text":"可选的用户可见说明"}',
    '   - step 必须简短描述这一批工具调用要完成什么，例如“检查项目结构和关键文件”。',
    '   - 同一轮里应尽量把相关的只读探索合并成多个 tool_calls；不要为了读取多个文件拆成多轮模型调用。',
    '   - 写入、命令和需要审批的操作仍会由 runtime 按安全顺序执行，不要绕过权限策略。',
    '2. 如果已完成或需要直接回答，只返回 JSON：{"answer":"..."}',
    '3. 不要把 JSON 包在 Markdown 代码块里。',
  ].join('\n')
}

function taskContractPrompt(contract?: TaskContract): string {
  if (!contract) return 'Task Contract: none'
  return [
    'Task Contract JSON:',
    JSON.stringify({
      id: contract.id,
      goal: contract.goal,
      scope: contract.scope,
      nonGoals: contract.nonGoals,
      constraints: contract.constraints,
      acceptanceCriteria: contract.acceptanceCriteria,
      verificationPlan: contract.verificationPlan,
      riskPoints: contract.riskPoints,
      assumptions: contract.assumptions,
      status: contract.status,
    }, null, 2),
  ].join('\n')
}

function planPrompt(items?: AgentPlanItem[]): string {
  if (!items || items.length === 0) return 'Structured Plan: none'
  return [
    'Structured Plan JSON:',
    JSON.stringify(items.map(item => ({
      id: item.id,
      title: item.title,
      description: item.description,
      status: item.status,
      evidence: item.evidence,
    })), null, 2),
  ].join('\n')
}

export function extractJsonObject(text: string): unknown | null {
  const trimmed = text.trim()
  const unfenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i)?.[1]?.trim() || trimmed
  try {
    return JSON.parse(unfenced)
  } catch {
    const start = unfenced.indexOf('{')
    const end = unfenced.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(unfenced.slice(start, end + 1))
      } catch {
        return null
      }
    }
    return null
  }
}

export function parseTextJsonModelAction(text: string): ModelAction {
  const parsed = extractJsonObject(text) as {
    answer?: unknown
    text?: unknown
    step?: unknown
    summary?: unknown
    action_summary?: unknown
    tool_calls?: unknown
    toolCalls?: unknown
  } | null
  if (!parsed) return { type: 'answer', text }
  const rawCalls = Array.isArray(parsed.tool_calls) ? parsed.tool_calls : Array.isArray(parsed.toolCalls) ? parsed.toolCalls : null
  if (rawCalls) {
    const toolCalls = rawCalls
      .map((item): RuntimeToolCall | null => {
        const call = item as { id?: unknown; name?: unknown; input?: unknown }
        if (typeof call.name !== 'string') return null
        const input = call.input && typeof call.input === 'object' && !Array.isArray(call.input) ? call.input as Record<string, unknown> : {}
        return createRuntimeToolCall(call.name, input, typeof call.id === 'string' ? call.id : undefined)
      })
      .filter((item): item is RuntimeToolCall => Boolean(item))
    if (toolCalls.length > 0) {
      const step = typeof parsed.step === 'string'
        ? parsed.step
        : typeof parsed.summary === 'string'
          ? parsed.summary
          : typeof parsed.action_summary === 'string'
            ? parsed.action_summary
            : undefined
      return { type: 'tool_calls', toolCalls, text: typeof parsed.text === 'string' ? parsed.text : undefined, step }
    }
  }
  if (typeof parsed.answer === 'string') return { type: 'answer', text: parsed.answer }
  if (typeof parsed.text === 'string') return { type: 'answer', text: parsed.text }
  return { type: 'answer', text }
}

// === Native Tool Calling Helpers ===

export interface NativeToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export function buildOpenAITools(tools: NativeToolDef[]): unknown[] {
  return tools.map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }))
}

export function buildAnthropicTools(tools: NativeToolDef[]): unknown[] {
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }))
}

export function buildGeminiToolDeclarations(tools: NativeToolDef[]): unknown[] {
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
  }))
}

export function parseOpenAIToolCalls(json: unknown): Array<{ id: string; name: string; input: Record<string, unknown> }> {
  const data = json as { choices?: Array<{ message?: { tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> } }> }
  const toolCalls = data.choices?.[0]?.message?.tool_calls
  if (!toolCalls) return []
  return toolCalls.map(tc => ({
    id: tc.id || `call_${Math.random()}`,
    name: tc.function?.name || '',
    input: safeJsonParse(tc.function?.arguments || '{}'),
  }))
}

export function parseAnthropicToolUses(json: unknown): Array<{ id: string; name: string; input: Record<string, unknown> }> {
  const data = json as { content?: Array<{ type?: string; id?: string; name?: string; input?: Record<string, unknown> }> }
  if (!data.content) return []
  return data.content
    .filter(block => block.type === 'tool_use')
    .map(block => ({
      id: block.id || `call_${Math.random()}`,
      name: block.name || '',
      input: block.input || {},
    }))
}

export function parseGeminiFunctionCalls(json: unknown): Array<{ id: string; name: string; input: Record<string, unknown> }> {
  const data = json as { candidates?: Array<{ content?: { parts?: Array<{ functionCall?: { name?: string; args?: Record<string, unknown> } }> } }> }
  const parts = data.candidates?.[0]?.content?.parts
  if (!parts) return []
  return parts
    .filter(p => p.functionCall)
    .map(p => ({
      id: `call_${Math.random()}`,
      name: p.functionCall!.name || '',
      input: p.functionCall!.args || {},
    }))
}

function safeJsonParse(text: string): Record<string, unknown> {
  try { return JSON.parse(text) as Record<string, unknown> }
  catch { return {} }
}

export class TextJsonToolAdapter implements ModelAdapter {
  buildMessages(input: { session: AgentSession; contextPrompt: string; userTask: string; taskContract?: TaskContract; planItems?: AgentPlanItem[] }): AgentChatMessage[] {
    return [
      { role: 'system', content: systemPrompt(input.session) },
      {
        role: 'user',
        content: [
          taskContractPrompt(input.taskContract),
          '',
          planPrompt(input.planItems),
          '',
          'IDE context:',
          input.contextPrompt,
          '',
          'User task:',
          input.userTask,
        ].join('\n'),
      },
    ]
  }

  parseAction(text: string): ModelAction {
    return parseTextJsonModelAction(text)
  }
}
