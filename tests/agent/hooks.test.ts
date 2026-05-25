import { describe, expect, it, afterEach } from 'vitest'
import { agentHooks, invokeAgentHook } from '../../src/main/agent/hooks'

afterEach(() => {
  agentHooks.clear()
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
})
