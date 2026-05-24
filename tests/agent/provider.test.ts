import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProviderConfigWithSecret } from '../../src/main/agent/config'
import { callAgentModelWithConfig } from '../../src/main/agent/provider'

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
})
