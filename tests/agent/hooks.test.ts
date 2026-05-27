import { describe, expect, it, afterEach, vi } from 'vitest'
import { agentHooks, invokeAgentHook } from '../../src/main/agent/hooks'

afterEach(() => {
  agentHooks.clear()
  agentHooks.hookTimeoutMs = 30_000
  vi.restoreAllMocks()
})

describe('AgentHookRegistry', () => {
  it('invokes hooks in registration order', async () => {
    const order: string[] = []
    agentHooks.register('model.before', () => order.push('first'))
    agentHooks.register('model.before', () => order.push('second'))

    const invocations = await invokeAgentHook({ sessionId: 's1', turnId: 't1', name: 'model.before' })

    expect(order).toEqual(['first', 'second'])
    expect(invocations).toHaveLength(2)
    expect(invocations.every(item => item.status === 'completed')).toBe(true)
  })

  it('records failures without blocking later hooks', async () => {
    const order: string[] = []
    agentHooks.register('tool.after', () => {
      order.push('first')
      throw new Error('hook failed')
    })
    agentHooks.register('tool.after', () => order.push('second'))

    const invocations = await invokeAgentHook({ sessionId: 's1', turnId: 't1', name: 'tool.after' })

    expect(order).toEqual(['first', 'second'])
    expect(invocations.map(item => item.status)).toEqual(['failed', 'completed'])
    expect(invocations[0].error).toContain('hook failed')
  })

  it('emits a completed no-op invocation when no hooks are registered', async () => {
    const invocations = await invokeAgentHook({ sessionId: 's1', turnId: 't1', name: 'finalize' })

    expect(invocations).toHaveLength(1)
    expect(invocations[0]).toMatchObject({ name: 'finalize', status: 'completed' })
  })

  it('includes pluginId in invocation when context has it', async () => {
    agentHooks.register('turn.start', () => { /* noop */ })
    const invocations = await invokeAgentHook({ sessionId: 's1', turnId: 't1', name: 'turn.start', pluginId: 'test-plugin' })
    expect(invocations).toHaveLength(1)
    expect(invocations[0]).toMatchObject({ name: 'turn.start', status: 'completed', pluginId: 'test-plugin' })
  })

  it('kills hooks that exceed timeout', async () => {
    agentHooks.hookTimeoutMs = 100 // 100ms timeout for test
    agentHooks.register('model.before', () => new Promise(() => { /* never resolves */ }))
    const invocations = await invokeAgentHook({ sessionId: 's1', turnId: 't1', name: 'model.before' })
    expect(invocations).toHaveLength(1)
    expect(invocations[0].status).toBe('failed')
    expect(invocations[0].error).toContain('timeout')
  })

  it('clears all registered hooks', () => {
    agentHooks.register('finalize', () => {})
    agentHooks.register('turn.start', () => {})
    agentHooks.clear()
    // verify by invoking both — should get no-op for each
    const cleanup = async () => {
      const r1 = await invokeAgentHook({ sessionId: 's1', turnId: 't1', name: 'finalize' })
      const r2 = await invokeAgentHook({ sessionId: 's1', turnId: 't1', name: 'turn.start' })
      expect(r1).toHaveLength(1)
      expect(r1[0].status).toBe('completed')
      expect(r2).toHaveLength(1)
      expect(r2[0].status).toBe('completed')
      // Verify no actual hooks ran (the no-op path)
    }
    return cleanup()
  })

  it('unregister returns a working cleanup function', async () => {
    const calls: string[] = []
    const unregister = agentHooks.register('finalize', () => calls.push('hook'))
    unregister()
    const invocations = await invokeAgentHook({ sessionId: 's1', turnId: 't1', name: 'finalize' })
    expect(calls).toEqual([])
    expect(invocations).toHaveLength(1)
    expect(invocations[0].status).toBe('completed')
  })
})
