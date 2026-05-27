// Hook Worker — runs in a child_process fork for plugin hook sandbox.
// Receives context via IPC, loads user script, calls hook, returns result.

import { randomUUID } from 'crypto'

interface WorkerInput {
  entrypoint: string
  pluginDir: string
  hookName: string
  sessionId: string
  turnId: string
  redactedPayload: Record<string, unknown>
  envAllowlist: Record<string, string>
  timeoutMs: number
}

interface WorkerOutput {
  id: string
  status: 'completed' | 'failed'
  stdout: string
  stderr: string
  error?: string
  exitCode: number
}

if (process.send) {
  process.on('message', async (input: WorkerInput) => {
    const runId = `hook_run_${randomUUID()}`
    const stdout: string[] = []
    const stderr: string[] = []

    // Apply env allowlist
    const cleanEnv: Record<string, string> = {}
    for (const key of Object.keys(input.envAllowlist)) {
      cleanEnv[key] = input.envAllowlist[key]
    }
    process.env = { ...cleanEnv, PATH: process.env.PATH || '' }

    // Redirect console to capture output
    const origLog = console.log
    const origError = console.error
    console.log = (...args: unknown[]) => { stdout.push(args.map(String).join(' ')) }
    console.error = (...args: unknown[]) => { stderr.push(args.map(String).join(' ')) }

    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      const output: WorkerOutput = {
        id: runId,
        status: 'failed',
        stdout: stdout.join('\n'),
        stderr: stderr.join('\n'),
        error: `Hook timed out after ${input.timeoutMs}ms`,
        exitCode: -1,
      }
      process.send!(output)
      process.exit(1)
    }, input.timeoutMs)

    try {
      const resolved = input.entrypoint.startsWith('/') || /^[A-Za-z]:/.test(input.entrypoint)
        ? input.entrypoint
        : `${input.pluginDir}/${input.entrypoint}`

      // Dynamically require the user's hook script
      let hookModule: unknown
      try {
        hookModule = require(resolved)
      } catch {
        // Retry without cache
        delete require.cache[require.resolve(resolved)]
        hookModule = require(resolved)
      }

      const hookFn = typeof hookModule === 'function'
        ? hookModule
        : (hookModule as Record<string, unknown>)?.default ?? (hookModule as Record<string, unknown>)?.hook ?? hookModule

      if (typeof hookFn === 'function') {
        await hookFn({
          hookName: input.hookName,
          sessionId: input.sessionId,
          turnId: input.turnId,
          payload: input.redactedPayload,
        })
      }

      clearTimeout(timer)
      const output: WorkerOutput = {
        id: runId,
        status: 'completed',
        stdout: stdout.join('\n'),
        stderr: stderr.join('\n'),
        exitCode: 0,
      }
      process.send!(output)
      process.exit(0)
    } catch (err) {
      clearTimeout(timer)
      if (timedOut) return // already handled
      const output: WorkerOutput = {
        id: runId,
        status: 'failed',
        stdout: stdout.join('\n'),
        stderr: stderr.join('\n'),
        error: err instanceof Error ? err.message : String(err),
        exitCode: 1,
      }
      process.send!(output)
      process.exit(1)
    } finally {
      console.log = origLog
      console.error = origError
    }
  })
}
