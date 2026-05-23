import { randomUUID } from 'crypto'
import type { AgentSession, AgentTurn, AgentWorkspaceLocation, Evidence, VerificationResult } from '../../shared/agent/protocol'
import { workspaceReadFile, workspaceRunCommand } from './workspace'
import { evidenceFromVerificationResult } from './verificationGate'

export interface VerificationCommand {
  verifier: 'command'
  command: string
}

function now(): number {
  return Date.now()
}

function fallbackTurn(session: AgentSession, turnId?: string): AgentTurn {
  return {
    id: turnId || `turn_verify_${randomUUID()}`,
    sessionId: session.id,
    text: 'Run verification',
    createdAt: now(),
    status: 'completed',
  }
}

async function readJsonFile<T>(workspace: AgentWorkspaceLocation, filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await workspaceReadFile(workspace, filePath)) as T
  } catch {
    return null
  }
}

export async function discoverVerificationCommands(workspace?: AgentWorkspaceLocation | null): Promise<VerificationCommand[]> {
  if (!workspace) return []
  const policy = await readJsonFile<{ agent?: { verification?: { commands?: string[] } } }>(workspace, '.rille/policy.json')
  const policyCommands = policy?.agent?.verification?.commands
  if (Array.isArray(policyCommands) && policyCommands.length > 0) {
    return policyCommands.filter(command => typeof command === 'string' && command.trim()).map(command => ({ verifier: 'command', command }))
  }

  const pkg = await readJsonFile<{ scripts?: Record<string, string> }>(workspace, 'package.json')
  const scripts = pkg?.scripts || {}
  if (scripts.typecheck) return [{ verifier: 'command', command: 'npm run typecheck' }]
  if (scripts.test) return [{ verifier: 'command', command: 'npm test' }]
  if (scripts.build) return [{ verifier: 'command', command: 'npm run build' }]
  return []
}

export class VerifierRunner {
  constructor(private readonly session: AgentSession, private readonly turn?: AgentTurn) {}

  async runFirstAvailableWithEvidence(): Promise<{ result: VerificationResult; evidence: Evidence }> {
    const result = await this.runFirstAvailable()
    return { result, evidence: evidenceFromVerificationResult(result) }
  }

  async runFirstAvailable(): Promise<VerificationResult> {
    const turn = this.turn || fallbackTurn(this.session)
    const command = (await discoverVerificationCommands(this.session.workspace))[0]
    if (!this.session.workspace || !command) {
      return {
        id: `verification_${randomUUID()}`,
        sessionId: this.session.id,
        turnId: turn.id,
        verifier: 'command',
        status: 'skipped',
        output: '未发现项目验证命令。',
        createdAt: now(),
      }
    }

    const result = await workspaceRunCommand(this.session.workspace, {
      commandLine: command.command,
      timeoutMs: 120_000,
      outputLimitBytes: 50 * 1024,
    })
    return {
      id: `verification_${randomUUID()}`,
      sessionId: this.session.id,
      turnId: turn.id,
      verifier: command.verifier,
      command: command.command,
      status: result.status === 'ok' ? 'passed' : 'failed',
      output: result.output,
      truncated: result.truncated,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      createdAt: now(),
    }
  }
}
