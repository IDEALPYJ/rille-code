import { fork } from 'child_process'
import { randomUUID } from 'crypto'
import { resolve } from 'path'
import type { AgentHookContext } from './hooks'
import type { AgentHookInvocation, PluginHookManifest } from '../../shared/agent/protocol'
import type { CreateArtifactInput } from './artifactStore'
import { createArtifact } from './artifactStore'

const DEFAULT_TIMEOUT_MS = 30_000
const REDACTED_KEY_PATTERN = /secret|token|key|password|api_key|auth/i
const PAYLOAD_ALLOWLIST = [
  'sessionId', 'turnId', 'name', 'iteration', 'toolCount',
  'callId', 'verifier', 'status', 'findingCount', 'reason',
]

function redactPayload(payload?: Record<string, unknown>): Record<string, unknown> {
  if (!payload) return {}
  const result: Record<string, unknown> = {}
  for (const key of PAYLOAD_ALLOWLIST) {
    if (key in payload) result[key] = payload[key]
  }
  return result
}

function resolveWorkerPath(): string {
  // At runtime, the compiled hookWorker.js is in the same directory
  return resolve(__dirname, 'hookWorker.js')
}

export class PluginHookRunner {
  constructor(
    readonly pluginId: string,
    readonly manifest: PluginHookManifest,
    readonly pluginDir: string,
  ) {}

  async execute(context: AgentHookContext): Promise<AgentHookInvocation> {
    const started = Date.now()
    const timeoutMs = this.manifest.timeoutMs || DEFAULT_TIMEOUT_MS

    const redactedPayload = redactPayload(context.payload)
    const envAllowlist = this.buildEnvAllowlist()

    try {
      const result = await this.forkWorker({
        entrypoint: this.manifest.entrypoint,
        pluginDir: this.pluginDir,
        hookName: this.manifest.name,
        sessionId: context.sessionId,
        turnId: context.turnId,
        redactedPayload,
        envAllowlist,
        timeoutMs,
      })

      const durationMs = Math.max(0, Date.now() - started)

      if (result.status === 'completed') {
        // Store output as artifact
        const artifactRefs: string[] = []
        if (result.stdout || result.stderr) {
          const outputText = [
            result.stdout ? `stdout:\n${result.stdout}` : '',
            result.stderr ? `stderr:\n${result.stderr}` : '',
          ].filter(Boolean).join('\n\n')

          const artifactInput: CreateArtifactInput = {
            sessionId: context.sessionId,
            turnId: context.turnId,
            kind: 'text',
            content: outputText,
            mimeType: 'text/plain',
          }
          const artifact = createArtifact(artifactInput)
          artifactRefs.push(artifact.id)
        }

        return {
          id: `hook_inv_${randomUUID()}`,
          sessionId: context.sessionId,
          turnId: context.turnId,
          name: this.manifest.name,
          status: 'completed',
          durationMs,
          pluginId: this.pluginId,
          artifactRefs,
          redactedInput: redactedPayload,
          createdAt: Date.now(),
        }
      } else {
        return {
          id: `hook_inv_${randomUUID()}`,
          sessionId: context.sessionId,
          turnId: context.turnId,
          name: this.manifest.name,
          status: 'failed',
          durationMs: Math.max(0, Date.now() - started),
          error: result.error ?? 'Hook execution failed',
          pluginId: this.pluginId,
          redactedInput: redactedPayload,
          createdAt: Date.now(),
        }
      }
    } catch (err) {
      const durationMs = Math.max(0, Date.now() - started)
      return {
        id: `hook_inv_${randomUUID()}`,
        sessionId: context.sessionId,
        turnId: context.turnId,
        name: this.manifest.name,
        status: 'failed',
        durationMs,
        error: err instanceof Error ? err.message : String(err),
        pluginId: this.pluginId,
        redactedInput: redactedPayload,
        createdAt: Date.now(),
      }
    }
  }

  private buildEnvAllowlist(): Record<string, string> {
    const result: Record<string, string> = {}
    for (const key of this.manifest.envAllowlist) {
      if (key in process.env) {
        // Only expose keys whose names don't match secret patterns
        if (!REDACTED_KEY_PATTERN.test(key)) {
          result[key] = process.env[key]!
        }
      }
    }
    return result
  }

  private forkWorker(input: {
    entrypoint: string; pluginDir: string; hookName: string
    sessionId: string; turnId: string
    redactedPayload: Record<string, unknown>
    envAllowlist: Record<string, string>
    timeoutMs: number
  }): Promise<{ status: 'completed' | 'failed'; stdout: string; stderr: string; error?: string }> {
    return new Promise((resolve, reject) => {
      let settled = false
      const workerPath = resolveWorkerPath()
      const child = fork(workerPath, [], {
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        env: input.envAllowlist,
      })

      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        child.kill('SIGTERM')
        setTimeout(() => {
          if (!child.killed) child.kill('SIGKILL')
        }, 2000)
        resolve({ status: 'failed', stdout: '', stderr: '', error: `Hook timed out after ${input.timeoutMs}ms` })
      }, input.timeoutMs)

      child.on('message', (msg: { status: string; stdout?: string; stderr?: string; error?: string }) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        child.kill()
        resolve({
          status: msg.status === 'completed' ? 'completed' : 'failed',
          stdout: msg.stdout ?? '',
          stderr: msg.stderr ?? '',
          error: msg.error,
        })
      })

      child.on('error', (err) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve({ status: 'failed', stdout: '', stderr: '', error: err.message })
      })

      child.on('exit', (code) => {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          resolve({ status: 'failed', stdout: '', stderr: '', error: `Worker exited with code ${code} without sending result` })
        }
      })

      child.send(input)
    })
  }
}
