import type { AgentConfigSnapshot, AgentUsage } from '../../shared/agent/protocol'
import { getAgentConfigForProvider, type ProviderConfigWithSecret } from './config'
import {
  buildAnthropicTools,
  buildGeminiToolDeclarations,
  buildOpenAITools,
  parseAnthropicToolUses,
  parseGeminiFunctionCalls,
  parseOpenAIToolCalls,
  type NativeToolDef,
} from './modelAdapter'

export interface AgentChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ModelCallResult {
  text: string
  usage?: AgentUsage
  toolCalls?: Array<{ id: string; name: string; input: Record<string, unknown> }>
}

interface ProviderRequestOptions {
  signal?: AbortSignal
  tools?: NativeToolDef[]
  maxTokens?: number
}

function joinUrl(baseURL: string, path: string): string {
  return `${baseURL.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!response.ok) {
    const detail = text.slice(0, 800) || response.statusText
    throw new Error(`模型请求失败 (${response.status}): ${detail}`)
  }
  return text ? JSON.parse(text) : {}
}

function requireApiKey(config: ProviderConfigWithSecret): string {
  const apiKey = config.apiKey?.trim()
  if (!apiKey && config.providerId !== 'ollama') throw new Error('请先配置 Agent API Key。')
  return apiKey || 'ollama'
}

function extractOpenAIText(payload: unknown): string {
  const data = payload as {
    choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>
    output_text?: string
  }
  const content = data.choices?.[0]?.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map(item => item.text || '').join('')
  if (typeof data.output_text === 'string') return data.output_text
  return ''
}

function extractAnthropicText(payload: unknown): string {
  const data = payload as { content?: Array<{ type?: string; text?: string }> }
  return data.content?.map(item => item.text || '').join('') || ''
}

function extractGeminiText(payload: unknown): string {
  const data = payload as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
  return data.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('') || ''
}

function splitSystem(messages: AgentChatMessage[]): { system: string; messages: AgentChatMessage[] } {
  const system = messages.filter(message => message.role === 'system').map(message => message.content).join('\n\n')
  return { system, messages: messages.filter(message => message.role !== 'system') }
}

function extractOpenAIUsage(payload: unknown): AgentUsage | undefined {
  const data = payload as { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } }
  if (!data.usage) return undefined
  return {
    model: '',
    providerId: 'openai',
    inputTokens: data.usage.prompt_tokens,
    outputTokens: data.usage.completion_tokens,
  }
}

function extractAnthropicUsage(payload: unknown): AgentUsage | undefined {
  const data = payload as { usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } }
  if (!data.usage) return undefined
  return {
    model: '',
    providerId: 'anthropic',
    inputTokens: data.usage.input_tokens,
    outputTokens: data.usage.output_tokens,
    cachedInputTokens: data.usage.cache_read_input_tokens,
  }
}

function extractGeminiUsage(payload: unknown): AgentUsage | undefined {
  const data = payload as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number } }
  if (!data.usageMetadata) return undefined
  return {
    model: '',
    providerId: 'google',
    inputTokens: data.usageMetadata.promptTokenCount,
    outputTokens: data.usageMetadata.candidatesTokenCount,
  }
}

async function callOpenAIChat(config: ProviderConfigWithSecret, messages: AgentChatMessage[], options: ProviderRequestOptions): Promise<ModelCallResult> {
  const apiKey = requireApiKey(config)
  const startedAt = Date.now()
  const payload: Record<string, unknown> = {
    model: config.model,
    messages,
    temperature: 0.2,
  }
  if (options.maxTokens) payload.max_tokens = Math.floor(options.maxTokens)
  if (options.tools && options.tools.length > 0) {
    payload.tools = buildOpenAITools(options.tools)
    payload.tool_choice = 'auto'
  }
  const response = await fetch(joinUrl(config.baseURL, '/chat/completions'), {
    method: 'POST',
    signal: options.signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  })
  const json = await parseJsonResponse(response)
  const text = extractOpenAIText(json).trim()
  const toolCalls = options.tools && options.tools.length > 0 ? parseOpenAIToolCalls(json) : undefined
  if (!text && (!toolCalls || toolCalls.length === 0)) throw new Error('模型返回为空。')
  const usage = extractOpenAIUsage(json)
  if (usage) {
    usage.model = config.model
    usage.providerId = config.providerId
    usage.latencyMs = Date.now() - startedAt
  }
  return { text, usage, toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined }
}

async function callAnthropic(config: ProviderConfigWithSecret, messages: AgentChatMessage[], options: ProviderRequestOptions): Promise<ModelCallResult> {
  const apiKey = requireApiKey(config)
  const startedAt = Date.now()
  const { system, messages: conversation } = splitSystem(messages)
  const response = await fetch(joinUrl(config.baseURL, '/v1/messages'), {
    method: 'POST',
    signal: options.signal,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.model,
      system: system ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }] : undefined,
      messages: conversation.map(message => ({ role: message.role === 'assistant' ? 'assistant' : 'user', content: message.content })),
      max_tokens: options.maxTokens ? Math.floor(options.maxTokens) : 16_384,
      temperature: 0.2,
      ...(options.tools && options.tools.length > 0 ? { tools: buildAnthropicTools(options.tools) } : {}),
    }),
  })
  const json = await parseJsonResponse(response)
  const text = extractAnthropicText(json).trim()
  const toolCalls = options.tools && options.tools.length > 0 ? parseAnthropicToolUses(json) : undefined
  if (!text && (!toolCalls || toolCalls.length === 0)) throw new Error('模型返回为空。')
  const usage = extractAnthropicUsage(json)
  if (usage) {
    usage.model = config.model
    usage.providerId = config.providerId
    usage.latencyMs = Date.now() - startedAt
  }
  return { text, usage, toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined }
}

async function callGemini(config: ProviderConfigWithSecret, messages: AgentChatMessage[], options: ProviderRequestOptions): Promise<ModelCallResult> {
  const apiKey = requireApiKey(config)
  const startedAt = Date.now()
  const { system, messages: conversation } = splitSystem(messages)
  const url = `${joinUrl(config.baseURL, `/v1beta/models/${encodeURIComponent(config.model)}:generateContent`)}?key=${encodeURIComponent(apiKey)}`
  const response = await fetch(url, {
    method: 'POST',
    signal: options.signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      contents: conversation.map(message => ({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: message.content }],
      })),
      generationConfig: {
        temperature: 0.2,
        ...(options.maxTokens ? { maxOutputTokens: Math.floor(options.maxTokens) } : {}),
      },
      ...(options.tools && options.tools.length > 0 ? { tools: [{ functionDeclarations: buildGeminiToolDeclarations(options.tools) }] } : {}),
    }),
  })
  const json = await parseJsonResponse(response)
  const text = extractGeminiText(json).trim()
  const toolCalls = options.tools && options.tools.length > 0 ? parseGeminiFunctionCalls(json) : undefined
  if (!text && (!toolCalls || toolCalls.length === 0)) throw new Error('模型返回为空。')
  const usage = extractGeminiUsage(json)
  if (usage) {
    usage.model = config.model
    usage.providerId = config.providerId
    usage.latencyMs = Date.now() - startedAt
  }
  return { text, usage, toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined }
}

export async function callAgentModel(messages: AgentChatMessage[], options: ProviderRequestOptions = {}): Promise<ModelCallResult> {
  const config = getAgentConfigForProvider()
  if (config.protocol === 'anthropic') return callAnthropic(config, messages, options)
  if (config.protocol === 'gemini') return callGemini(config, messages, options)
  return callOpenAIChat(config, messages, options)
}

export async function callAgentModelWithConfig(config: ProviderConfigWithSecret, messages: AgentChatMessage[], options: ProviderRequestOptions = {}): Promise<ModelCallResult> {
  if (config.protocol === 'anthropic') return callAnthropic(config, messages, options)
  if (config.protocol === 'gemini') return callGemini(config, messages, options)
  return callOpenAIChat(config, messages, options)
}

export async function callAgentModelWithTools(messages: AgentChatMessage[], tools: NativeToolDef[], options: ProviderRequestOptions = {}): Promise<ModelCallResult> {
  const config = getAgentConfigForProvider()
  const opts = { ...options, tools }
  if (config.protocol === 'anthropic') return callAnthropic(config, messages, opts)
  if (config.protocol === 'gemini') return callGemini(config, messages, opts)
  return callOpenAIChat(config, messages, opts)
}

export async function testAgentProvider(profileId?: string): Promise<{ success: boolean; message: string }> {
  try {
    const result = await callAgentModelWithConfig(getAgentConfigForProvider(profileId), [
      { role: 'system', content: 'You are a connectivity test. Reply with exactly OK.' },
      { role: 'user', content: 'OK' },
    ])
    return { success: true, message: result.text.slice(0, 120) || 'OK' }
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : String(error) }
  }
}
