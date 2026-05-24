import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProviderConfigWithSecret } from '../../src/main/agent/config'
import { callAgentModelWithConfig, parseOpenAIResponsesSseEvent } from '../../src/main/agent/provider'

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/rille-provider-test',
  },
}))

function config(protocol: ProviderConfigWithSecret['protocol']): ProviderConfigWithSecret {
  return {
    providerId: protocol === 'anthropic' ? 'anthropic' : protocol === 'gemini' ? 'google' : 'openai',
    protocol,
    baseURL: 'https://provider.test',
    model: 'test-model',
    apiKeyConfigured: true,
    apiKey: 'test-key',
    modalities: ['text'],
  }
}

function mockFetch(payload: unknown): void {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    text: async () => JSON.stringify(payload),
  })))
}

function requestBody(): any {
  const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
  return JSON.parse(String(fetchMock.mock.calls[0][1].body))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('provider maxTokens', () => {
  it('sends max_tokens for OpenAI-compatible chat', async () => {
    mockFetch({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 2 } })

    await callAgentModelWithConfig(config('openai-chat'), [{ role: 'user', content: 'hi' }], { maxTokens: 1234 })

    expect(requestBody().max_tokens).toBe(1234)
  })

  it('sends max_tokens for Anthropic messages', async () => {
    mockFetch({ content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1, output_tokens: 2 } })

    await callAgentModelWithConfig(config('anthropic'), [{ role: 'user', content: 'hi' }], { maxTokens: 2345 })

    expect(requestBody().max_tokens).toBe(2345)
  })

  it('sends maxOutputTokens for Gemini', async () => {
    mockFetch({ candidates: [{ content: { parts: [{ text: 'ok' }] } }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2 } })

    await callAgentModelWithConfig(config('gemini'), [{ role: 'user', content: 'hi' }], { maxTokens: 3456 })

    expect(requestBody().generationConfig.maxOutputTokens).toBe(3456)
  })

  it('uses OpenAI Responses payload and parses function calls/cache metrics', async () => {
    mockFetch({
      output_text: 'ready',
      output: [{ type: 'function_call', call_id: 'call_1', name: 'read_file', arguments: '{"filePath":"a.ts"}' }],
      usage: { input_tokens: 10, output_tokens: 2, input_tokens_details: { cached_tokens: 6 } },
    })

    const result = await callAgentModelWithConfig(config('openai-responses'), [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }], {
      maxTokens: 123,
      promptCacheKey: 'cache-key',
      promptCacheRetention: '24h',
      tools: [{ name: 'read_file', description: 'read', inputSchema: { type: 'object' } }],
    })

    const body = requestBody()
    expect(body.max_output_tokens).toBe(123)
    expect(body.instructions).toBe('sys')
    expect(body.prompt_cache_key).toBe('cache-key')
    expect(body.prompt_cache_retention).toBe('24h')
    expect(body.tools[0]).toMatchObject({ type: 'function', name: 'read_file' })
    expect(result.text).toBe('ready')
    expect(result.toolCalls?.[0]).toMatchObject({ id: 'call_1', name: 'read_file', input: { filePath: 'a.ts' } })
    expect(result.usage?.cachedInputTokens).toBe(6)
    expect(result.cacheMetrics?.cacheHit).toBe(true)
  })

  it('parses OpenAI Responses semantic stream events', () => {
    expect(parseOpenAIResponsesSseEvent({ type: 'response.output_text.delta', delta: 'hello', sequence_number: 1 })).toMatchObject({
      type: 'model.text.delta',
      text: 'hello',
      sequence: 1,
    })
    expect(parseOpenAIResponsesSseEvent({ type: 'response.function_call_arguments.done', item_id: 'call_1', name: 'read_file', arguments: '{"filePath":"a.ts"}' })).toMatchObject({
      type: 'model.tool_call.done',
      callId: 'call_1',
      name: 'read_file',
      arguments: '{"filePath":"a.ts"}',
    })
    expect(parseOpenAIResponsesSseEvent({ type: 'response.completed', response: { output_text: 'done', usage: { input_tokens: 1, output_tokens: 2 } } })).toMatchObject({
      type: 'model.completed',
      text: 'done',
    })
  })
})
