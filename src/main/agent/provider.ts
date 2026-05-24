import type { AgentConfigSnapshot, AgentToolCall, AgentUsage, ModelCacheMetrics, ModelStreamEvent, ProviderFallbackTrace } from '../../shared/agent/protocol'
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
  cacheMetrics?: ModelCacheMetrics
  fallbackTrace?: ProviderFallbackTrace[]
}

export interface ProviderRequestOptions {
  signal?: AbortSignal
  tools?: NativeToolDef[]
  maxTokens?: number
  stream?: boolean
  allowFallback?: boolean
  promptCacheKey?: string
  promptCacheRetention?: '24h'
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
  const data = payload as { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number }; prompt_tokens_details?: { cached_tokens?: number }; cache_creation_input_tokens?: number } }
  if (!data.usage) return undefined
  return {
    model: '',
    providerId: 'openai',
    inputTokens: data.usage.prompt_tokens ?? data.usage.input_tokens,
    outputTokens: data.usage.completion_tokens ?? data.usage.output_tokens,
    cachedInputTokens: data.usage.input_tokens_details?.cached_tokens ?? data.usage.prompt_tokens_details?.cached_tokens,
    cacheWriteInputTokens: data.usage.cache_creation_input_tokens,
  }
}

function cacheMetricsFromUsage(usage: AgentUsage | undefined, options: ProviderRequestOptions): ModelCacheMetrics | undefined {
  if (!usage && !options.promptCacheKey) return undefined
  return {
    promptCacheKey: options.promptCacheKey,
    promptCacheRetention: options.promptCacheRetention,
    cachedInputTokens: usage?.cachedInputTokens,
    cacheWriteInputTokens: usage?.cacheWriteInputTokens,
    cacheHit: usage?.cachedInputTokens !== undefined ? usage.cachedInputTokens > 0 : undefined,
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
  const cacheMetrics = cacheMetricsFromUsage(usage, options)
  if (usage) usage.cacheMetrics = cacheMetrics
  return { text, usage, toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined, cacheMetrics }
}

function buildResponsesInput(messages: AgentChatMessage[]): { instructions?: string; input: Array<{ role: 'user' | 'assistant'; content: string }> } {
  const system = messages.filter(message => message.role === 'system').map(message => message.content).join('\n\n') || undefined
  return {
    instructions: system,
    input: messages.filter(message => message.role !== 'system').map(message => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: message.content,
    })),
  }
}

function buildResponsesTools(tools: NativeToolDef[]): unknown[] {
  return tools.map(tool => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
  }))
}

function parseResponsesOutput(payload: unknown): { text: string; toolCalls: AgentToolCall[] } {
  const data = payload as {
    output_text?: string
    output?: Array<{
      id?: string
      type?: string
      name?: string
      call_id?: string
      arguments?: string
      content?: Array<{ type?: string; text?: string }>
    }>
  }
  const textParts: string[] = []
  const toolCalls: AgentToolCall[] = []
  for (const item of data.output || []) {
    if (Array.isArray(item.content)) {
      textParts.push(...item.content.map(part => part.text || '').filter(Boolean))
    }
    if (item.type === 'function_call' && item.name) {
      toolCalls.push({
        id: item.call_id || item.id || `call_${Math.random()}`,
        name: item.name,
        input: safeJsonParse(item.arguments || '{}'),
      })
    }
  }
  return { text: (data.output_text || textParts.join('')).trim(), toolCalls }
}

async function callOpenAIResponses(config: ProviderConfigWithSecret, messages: AgentChatMessage[], options: ProviderRequestOptions): Promise<ModelCallResult> {
  const apiKey = requireApiKey(config)
  const startedAt = Date.now()
  const { instructions, input } = buildResponsesInput(messages)
  const payload: Record<string, unknown> = {
    model: config.model,
    input,
    instructions,
    temperature: 0.2,
    parallel_tool_calls: true,
  }
  if (options.maxTokens) payload.max_output_tokens = Math.floor(options.maxTokens)
  if (options.promptCacheKey) payload.prompt_cache_key = options.promptCacheKey
  if (options.promptCacheRetention) payload.prompt_cache_retention = options.promptCacheRetention
  if (options.tools && options.tools.length > 0) payload.tools = buildResponsesTools(options.tools)
  const response = await fetch(joinUrl(config.baseURL, '/responses'), {
    method: 'POST',
    signal: options.signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  })
  const json = await parseJsonResponse(response)
  const parsed = parseResponsesOutput(json)
  if (!parsed.text && parsed.toolCalls.length === 0) throw new Error('模型返回为空。')
  const usage = extractOpenAIUsage(json)
  if (usage) {
    usage.model = config.model
    usage.providerId = config.providerId
    usage.latencyMs = Date.now() - startedAt
  }
  const cacheMetrics = cacheMetricsFromUsage(usage, options)
  if (usage) usage.cacheMetrics = cacheMetrics
  return { text: parsed.text, usage, toolCalls: parsed.toolCalls.length > 0 ? parsed.toolCalls : undefined, cacheMetrics }
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
  const cacheMetrics = cacheMetricsFromUsage(usage, options)
  if (usage) usage.cacheMetrics = cacheMetrics
  return { text, usage, toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined, cacheMetrics }
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
  const cacheMetrics = cacheMetricsFromUsage(usage, options)
  if (usage) usage.cacheMetrics = cacheMetrics
  return { text, usage, toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined, cacheMetrics }
}

export async function callAgentModel(messages: AgentChatMessage[], options: ProviderRequestOptions = {}): Promise<ModelCallResult> {
  const config = getAgentConfigForProvider()
  if (config.protocol === 'openai-responses') return callOpenAIResponses(config, messages, options)
  if (config.protocol === 'anthropic') return callAnthropic(config, messages, options)
  if (config.protocol === 'gemini') return callGemini(config, messages, options)
  return callOpenAIChat(config, messages, options)
}

export async function callAgentModelWithConfig(config: ProviderConfigWithSecret, messages: AgentChatMessage[], options: ProviderRequestOptions = {}): Promise<ModelCallResult> {
  if (config.protocol === 'openai-responses') return callOpenAIResponses(config, messages, options)
  if (config.protocol === 'anthropic') return callAnthropic(config, messages, options)
  if (config.protocol === 'gemini') return callGemini(config, messages, options)
  return callOpenAIChat(config, messages, options)
}

export async function callAgentModelWithTools(messages: AgentChatMessage[], tools: NativeToolDef[], options: ProviderRequestOptions = {}): Promise<ModelCallResult> {
  const config = getAgentConfigForProvider()
  const opts = { ...options, tools }
  const fallbackTrace: ProviderFallbackTrace[] = []
  const fallbackIds = options.allowFallback === false ? [] : (config.fallbackProfileIds || [])
  const attempts = [config, ...fallbackIds.map(id => getAgentConfigForProvider(id))]
  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index]
    const startedAt = Date.now()
    try {
      const result = await callAgentModelWithConfig(attempt, messages, opts)
      return { ...result, fallbackTrace: fallbackTrace.length > 0 ? fallbackTrace : result.fallbackTrace }
    } catch (error) {
      if (index >= attempts.length - 1 || !isFallbackableError(error)) throw error
      const next = attempts[index + 1]
      fallbackTrace.push({
        fromProviderId: attempt.providerId,
        fromProtocol: attempt.protocol,
        toProviderId: next.providerId,
        toProtocol: next.protocol,
        reason: fallbackReason(error),
        attempt: index + 1,
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
        createdAt: Date.now(),
      })
    }
  }
  throw new Error('模型 fallback 失败。')
}

function fallbackReason(error: unknown): ProviderFallbackTrace['reason'] {
  const message = error instanceof Error ? error.message : String(error)
  if (/\b429\b|rate/i.test(message)) return 'rate_limit'
  if (/\b5\d\d\b|server/i.test(message)) return 'server_error'
  if (/empty|模型返回为空/.test(message)) return 'empty_response'
  if (/stream|unsupported/i.test(message)) return 'unsupported_streaming'
  if (/fetch|network|ECONN|timeout/i.test(message)) return 'network'
  return 'provider_error'
}

function isFallbackableError(error: unknown): boolean {
  return ['network', 'rate_limit', 'server_error', 'empty_response', 'unsupported_streaming'].includes(fallbackReason(error))
}

export function parseOpenAIResponsesSseEvent(event: unknown): ModelStreamEvent | null {
  const data = event as { type?: string; delta?: string; text?: string; sequence_number?: number; item_id?: string; name?: string; arguments?: string; response?: unknown; error?: { message?: string } }
  const createdAt = Date.now()
  if (data.type === 'response.created') return { type: 'model.started', providerId: 'openai', protocol: 'openai-responses', createdAt }
  if (data.type === 'response.output_text.delta') return { type: 'model.text.delta', text: data.delta || '', sequence: data.sequence_number, createdAt }
  if (data.type === 'response.reasoning_summary_text.delta') return { type: 'model.reasoning.delta', text: data.delta || '', sequence: data.sequence_number, createdAt }
  if (data.type === 'response.function_call_arguments.delta') return { type: 'model.tool_call.delta', callId: data.item_id || `call_${Math.random()}`, name: data.name, argumentsDelta: data.delta || '', sequence: data.sequence_number, createdAt }
  if (data.type === 'response.function_call_arguments.done') return { type: 'model.tool_call.done', callId: data.item_id || `call_${Math.random()}`, name: data.name || '', arguments: data.arguments || '{}', sequence: data.sequence_number, createdAt }
  if (data.type === 'response.completed') {
    const parsed = parseResponsesOutput(data.response)
    const usage = extractOpenAIUsage(data.response)
    return { type: 'model.completed', text: parsed.text, usage, toolCalls: parsed.toolCalls, cacheMetrics: cacheMetricsFromUsage(usage, {}), createdAt }
  }
  if (data.type === 'response.failed' || data.type === 'error') return { type: 'model.failed', error: data.error?.message || '模型流式响应失败。', createdAt }
  return null
}

async function* parseSseResponse(response: Response): AsyncGenerator<unknown> {
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`模型请求失败 (${response.status}): ${detail.slice(0, 800) || response.statusText}`)
  }
  const reader = response.body?.getReader()
  if (!reader) return
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const chunks = buffer.split(/\r?\n\r?\n/)
    buffer = chunks.pop() || ''
    for (const chunk of chunks) {
      const dataLines = chunk.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim())
      const data = dataLines.join('\n')
      if (!data || data === '[DONE]') continue
      yield JSON.parse(data)
    }
  }
}

async function* streamOpenAIResponses(config: ProviderConfigWithSecret, messages: AgentChatMessage[], options: ProviderRequestOptions): AsyncGenerator<ModelStreamEvent> {
  const apiKey = requireApiKey(config)
  const { instructions, input } = buildResponsesInput(messages)
  const payload: Record<string, unknown> = {
    model: config.model,
    input,
    instructions,
    temperature: 0.2,
    stream: true,
    parallel_tool_calls: true,
  }
  if (options.maxTokens) payload.max_output_tokens = Math.floor(options.maxTokens)
  if (options.promptCacheKey) payload.prompt_cache_key = options.promptCacheKey
  if (options.promptCacheRetention) payload.prompt_cache_retention = options.promptCacheRetention
  if (options.tools && options.tools.length > 0) payload.tools = buildResponsesTools(options.tools)
  const response = await fetch(joinUrl(config.baseURL, '/responses'), {
    method: 'POST',
    signal: options.signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  })
  for await (const raw of parseSseResponse(response)) {
    const event = parseOpenAIResponsesSseEvent(raw)
    if (event) yield event
  }
}

export async function* streamAgentModelWithTools(messages: AgentChatMessage[], tools: NativeToolDef[], options: ProviderRequestOptions = {}): AsyncGenerator<ModelStreamEvent> {
  const config = getAgentConfigForProvider()
  const opts = { ...options, tools }
  if (config.protocol !== 'openai-responses') {
    const fallback: ProviderFallbackTrace = {
      fromProviderId: config.providerId,
      fromProtocol: config.protocol,
      reason: 'unsupported_streaming',
      attempt: 1,
      createdAt: Date.now(),
      error: 'Provider protocol does not support semantic streaming.',
    }
    yield { type: 'model.failed', error: fallback.error || 'unsupported streaming', fallback, createdAt: Date.now() }
    const result = await callAgentModelWithConfig(config, messages, opts)
    yield { type: 'model.completed', text: result.text, usage: result.usage, toolCalls: result.toolCalls, cacheMetrics: result.cacheMetrics, createdAt: Date.now() }
    return
  }
  yield* streamOpenAIResponses(config, messages, opts)
}

export async function* streamAgentModel(messages: AgentChatMessage[], options: ProviderRequestOptions = {}): AsyncGenerator<ModelStreamEvent> {
  yield* streamAgentModelWithTools(messages, [], options)
}

function safeJsonParse(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return {}
  }
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
