import { randomUUID } from 'crypto'
import type { AgentHookInvocation, AgentHookName } from '../../shared/agent/protocol'

export interface AgentHookContext {
  sessionId: string
  turnId: string
  name: AgentHookName
  payload?: Record<string, unknown>
}

export type AgentHook = (context: AgentHookContext) => void | Promise<void>

export class AgentHookRegistry {
  private hooks = new Map<AgentHookName, AgentHook[]>()

  register(name: AgentHookName, hook: AgentHook): () => void {
    const next = [...(this.hooks.get(name) || []), hook]
    this.hooks.set(name, next)
    return () => {
      const current = this.hooks.get(name) || []
      this.hooks.set(name, current.filter(item => item !== hook))
    }
  }

  clear(): void {
    this.hooks.clear()
  }

  async invoke(context: AgentHookContext): Promise<AgentHookInvocation[]> {
    const started = Date.now()
    const registered = this.hooks.get(context.name) || []
    if (registered.length === 0) {
      return [this.invocation(context, 'completed', started)]
    }

    const invocations: AgentHookInvocation[] = []
    for (const hook of registered) {
      const hookStarted = Date.now()
      try {
        await hook(context)
        invocations.push(this.invocation(context, 'completed', hookStarted))
      } catch (error) {
        invocations.push(this.invocation(context, 'failed', hookStarted, error instanceof Error ? error.message : String(error)))
      }
    }
    return invocations
  }

  private invocation(context: AgentHookContext, status: AgentHookInvocation['status'], startedAt: number, error?: string): AgentHookInvocation {
    return {
      id: `hook_${randomUUID()}`,
      sessionId: context.sessionId,
      turnId: context.turnId,
      name: context.name,
      status,
      durationMs: Math.max(0, Date.now() - startedAt),
      error,
      createdAt: Date.now(),
    }
  }
}

export const agentHooks = new AgentHookRegistry()

export async function invokeAgentHook(context: AgentHookContext): Promise<AgentHookInvocation[]> {
  return agentHooks.invoke(context)
}
