import type { AgentUsage, AgentWorkspaceLocation, Evidence, ReviewResult, TaskContract } from '../../shared/agent/protocol'
import type { ProviderConfigWithSecret } from './config'
import { callAgentModelWithConfig, type AgentChatMessage, type ModelCallResult } from './provider'
import { getEvaluatorModelConfig, readEvaluatorConfig, shouldRunEvaluator, type EvaluatorConfig } from './evaluatorConfig'
import { buildEvaluatorSystemPrompt, buildEvaluatorUserPrompt, parseEvaluatorResponse } from './evaluatorPrompts'

export interface EvaluatorRunnerInput {
  sessionId: string
  turnId: string
  workspace?: AgentWorkspaceLocation | null
  codeChanged: boolean
  contract?: TaskContract
  evidence: Evidence[]
  changedFiles: string[]
  proposedFiles: string[]
}

export interface EvaluatorRunnerResult {
  review: ReviewResult | null
  usage?: AgentUsage
}

interface EvaluatorRunnerDeps {
  readConfig?: (workspace?: AgentWorkspaceLocation | null) => Promise<EvaluatorConfig>
  shouldRun?: (config: EvaluatorConfig, codeChanged: boolean) => boolean
  getModelConfig?: (preferredProfileId?: string) => ProviderConfigWithSecret
  callModel?: (config: ProviderConfigWithSecret, messages: AgentChatMessage[], options: { signal?: AbortSignal; maxTokens?: number }) => Promise<ModelCallResult>
}

export class EvaluatorRunner {
  private readonly readConfig: NonNullable<EvaluatorRunnerDeps['readConfig']>
  private readonly shouldRun: NonNullable<EvaluatorRunnerDeps['shouldRun']>
  private readonly getModelConfig: NonNullable<EvaluatorRunnerDeps['getModelConfig']>
  private readonly callModel: NonNullable<EvaluatorRunnerDeps['callModel']>

  constructor(deps: EvaluatorRunnerDeps = {}) {
    this.readConfig = deps.readConfig ?? readEvaluatorConfig
    this.shouldRun = deps.shouldRun ?? shouldRunEvaluator
    this.getModelConfig = deps.getModelConfig ?? getEvaluatorModelConfig
    this.callModel = deps.callModel ?? callAgentModelWithConfig
  }

  async run(input: EvaluatorRunnerInput): Promise<EvaluatorRunnerResult> {
    const config = await this.readConfig(input.workspace)
    if (!this.shouldRun(config, input.codeChanged)) return { review: null }

    let providerConfig: ProviderConfigWithSecret
    try {
      providerConfig = this.getModelConfig(config.modelProfileId)
    } catch {
      return { review: null }
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs)

    try {
      const result = await this.callModel(providerConfig, this.buildMessages(input, config), {
        signal: controller.signal,
        maxTokens: config.maxTokens,
      })
      clearTimeout(timeout)
      const usage = result.usage ? { ...result.usage, purpose: 'evaluator' as const } : undefined
      return {
        review: parseEvaluatorResponse(result.text, input.sessionId, input.turnId),
        usage,
      }
    } catch (error) {
      clearTimeout(timeout)
      if (config.blocking) throw error
      return { review: null }
    }
  }

  private buildMessages(input: EvaluatorRunnerInput, config: EvaluatorConfig): AgentChatMessage[] {
    return [
      { role: 'system', content: buildEvaluatorSystemPrompt(config.skepticism) },
      {
        role: 'user',
        content: buildEvaluatorUserPrompt({
          contract: input.contract,
          evidence: input.evidence,
          changedFiles: input.changedFiles,
          proposedFiles: input.proposedFiles,
          diffSummaries: input.evidence.filter(item => item.source === 'diff' && item.output).map(item => item.output || ''),
          riskPoints: input.contract?.riskPoints,
        }),
      },
    ]
  }
}
