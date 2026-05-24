import { describe, expect, it } from 'vitest'
import type { TaskContract, Evidence, ReviewResult } from '../../src/shared/agent/protocol'
import { buildEvaluatorSystemPrompt, buildEvaluatorUserPrompt, parseEvaluatorResponse } from '../../src/main/agent/evaluatorPrompts'
import { shouldRunEvaluator, type EvaluatorConfig } from '../../src/main/agent/evaluatorConfig'
import { EvaluatorRunner } from '../../src/main/agent/evaluatorRunner'
import { mergeReviews } from '../../src/main/agent/verificationGate'

function contract(): TaskContract {
  return {
    id: 'contract_test',
    sessionId: 'session_test',
    turnId: 'turn_test',
    goal: '修复类型错误',
    scope: [{ kind: 'file', value: 'src/main.ts', source: 'user' }],
    nonGoals: ['不修改测试文件'],
    constraints: ['遵守权限模式'],
    acceptanceCriteria: [
      { id: 'ac_diff', text: '有 diff', evidenceRequired: ['diff'], status: 'unverified' },
      { id: 'ac_verify', text: '验证通过', evidenceRequired: ['diagnostics', 'command'], status: 'unverified' },
    ],
    verificationPlan: [],
    riskPoints: [{ id: 'risk_1', risk: 'high', text: '高风险修改', approvalRequired: true }],
    assumptions: [],
    status: 'active',
    createdAt: 1,
    updatedAt: 1,
  }
}

function evidence(source: Evidence['source'], status: Evidence['status'] = 'passed'): Evidence {
  return { id: `ev_${source}_${status}`, sessionId: 's1', turnId: 't1', source, status, summary: `${source} ${status}`, createdAt: 1 }
}

function review(status: ReviewResult['status'], findingsCount = 0, source?: 'rule' | 'llm'): ReviewResult {
  return {
    id: `review_${status}`,
    sessionId: 's1',
    turnId: 't1',
    status,
    findingIds: [],
    findings: Array.from({ length: findingsCount }, (_, i) => ({
      id: `f_${status}_${i}`,
      sessionId: 's1',
      turnId: 't1',
      category: 'correctness' as const,
      severity: 'medium' as const,
      blocking: status !== 'approved',
      title: `Test finding ${i}`,
      body: `Body for finding ${i}`,
      evidenceRefs: [],
      status: 'open' as const,
      source,
      createdAt: 1,
    })),
    summary: `${status} summary`,
    createdAt: 1,
  }
}

describe('shouldRunEvaluator', () => {
  const defaults: EvaluatorConfig = { enabled: true, triggerWhen: 'codeChanged', maxTokens: 4096, skepticism: 'high', timeoutMs: 30000, blocking: false }

  it('runs when codeChanged=true and triggerWhen=codeChanged', () => {
    expect(shouldRunEvaluator(defaults, true)).toBe(true)
  })

  it('skips when codeChanged=false and triggerWhen=codeChanged', () => {
    expect(shouldRunEvaluator(defaults, false)).toBe(false)
  })

  it('runs when codeChanged=false and triggerWhen=always', () => {
    expect(shouldRunEvaluator({ ...defaults, triggerWhen: 'always' }, false)).toBe(true)
  })

  it('never runs when triggerWhen=never', () => {
    expect(shouldRunEvaluator({ ...defaults, triggerWhen: 'never' }, true)).toBe(false)
  })

  it('never runs when enabled=false', () => {
    expect(shouldRunEvaluator({ ...defaults, enabled: false }, true)).toBe(false)
  })
})

describe('EvaluatorRunner', () => {
  const enabledConfig: EvaluatorConfig = { enabled: true, triggerWhen: 'codeChanged', maxTokens: 1234, skepticism: 'high', timeoutMs: 30000, blocking: false }
  const modelConfig = {
    providerId: 'openai' as const,
    protocol: 'openai-chat' as const,
    baseURL: 'https://example.test/v1',
    model: 'reviewer-model',
    apiKeyConfigured: true,
    apiKey: 'test-key',
    modalities: ['text' as const],
  }

  function runner(overrides: Partial<ConstructorParameters<typeof EvaluatorRunner>[0]> = {}) {
    return new EvaluatorRunner({
      readConfig: async () => enabledConfig,
      getModelConfig: () => modelConfig,
      ...overrides,
    })
  }

  it('skips when config says not to run', async () => {
    const result = await runner({ shouldRun: () => false }).run({
      sessionId: 's1',
      turnId: 't1',
      codeChanged: true,
      contract: contract(),
      evidence: [],
      changedFiles: [],
      proposedFiles: [],
    })

    expect(result.review).toBeNull()
  })

  it('passes maxTokens, diff summary, and returns evaluator usage', async () => {
    const calls: any[] = []
    const result = await runner({
      callModel: async (...args) => {
        calls.push(args)
        return {
          text: '{"status":"approved","summary":"ok","findings":[]}',
          usage: { model: 'reviewer-model', providerId: 'openai', inputTokens: 10, outputTokens: 5 },
        }
      },
    }).run({
      sessionId: 's1',
      turnId: 't1',
      codeChanged: true,
      contract: contract(),
      evidence: [{ ...evidence('diff'), output: 'diff --git a/src/main.ts b/src/main.ts' }],
      changedFiles: ['src/main.ts'],
      proposedFiles: [],
    })

    expect(calls[0][2].maxTokens).toBe(1234)
    expect(calls[0][1][1].content).toContain('## Diff Summary')
    expect(result.review?.status).toBe('approved')
    expect(result.usage?.purpose).toBe('evaluator')
  })

  it('returns parse failure review for malformed evaluator output', async () => {
    const result = await runner({
      callModel: async () => ({ text: 'not json' }),
    }).run({
      sessionId: 's1',
      turnId: 't1',
      codeChanged: true,
      contract: contract(),
      evidence: [],
      changedFiles: [],
      proposedFiles: [],
    })

    expect(result.review?.status).toBe('needs_more_verification')
    expect(result.review?.findings[0].title).toBe('Evaluator response parse failure')
  })

  it('swallows model errors when evaluator is non-blocking', async () => {
    const result = await runner({
      callModel: async () => {
        throw new Error('model down')
      },
    }).run({
      sessionId: 's1',
      turnId: 't1',
      codeChanged: true,
      contract: contract(),
      evidence: [],
      changedFiles: [],
      proposedFiles: [],
    })

    expect(result.review).toBeNull()
  })

  it('throws model errors when evaluator is blocking', async () => {
    await expect(runner({
      readConfig: async () => ({ ...enabledConfig, blocking: true }),
      callModel: async () => {
        throw new Error('model down')
      },
    }).run({
      sessionId: 's1',
      turnId: 't1',
      codeChanged: true,
      contract: contract(),
      evidence: [],
      changedFiles: [],
      proposedFiles: [],
    })).rejects.toThrow('model down')
  })
})

describe('buildEvaluatorSystemPrompt', () => {
  it('low skepticism includes "quality reviewer"', () => {
    const p = buildEvaluatorSystemPrompt('low')
    expect(p).toContain('quality reviewer')
  })

  it('medium skepticism includes "thorough reviewer"', () => {
    const p = buildEvaluatorSystemPrompt('medium')
    expect(p).toContain('thorough reviewer')
  })

  it('high skepticism includes "SKEPTICAL"', () => {
    const p = buildEvaluatorSystemPrompt('high')
    expect(p).toContain('SKEPTICAL')
  })

  it('all levels include JSON schema', () => {
    for (const level of ['low', 'medium', 'high'] as const) {
      expect(buildEvaluatorSystemPrompt(level)).toContain('"status"')
    }
  })
})

describe('buildEvaluatorUserPrompt', () => {
  it('includes task goal', () => {
    const p = buildEvaluatorUserPrompt({ contract: contract(), evidence: [], changedFiles: [], proposedFiles: [] })
    expect(p).toContain('修复类型错误')
  })

  it('includes acceptance criteria', () => {
    const p = buildEvaluatorUserPrompt({ contract: contract(), evidence: [], changedFiles: [], proposedFiles: [] })
    expect(p).toContain('有 diff')
    expect(p).toContain('验证通过')
  })

  it('includes evidence summaries', () => {
    const p = buildEvaluatorUserPrompt({
      contract: contract(),
      evidence: [evidence('diff', 'passed'), evidence('command', 'failed')],
      changedFiles: [],
      proposedFiles: [],
    })
    expect(p).toContain('diff passed')
    expect(p).toContain('command failed')
  })

  it('includes changed files', () => {
    const p = buildEvaluatorUserPrompt({ contract: contract(), evidence: [], changedFiles: ['src/main.ts'], proposedFiles: [] })
    expect(p).toContain('src/main.ts')
  })

  it('includes bounded diff summaries', () => {
    const longDiff = `diff --git a/src/main.ts b/src/main.ts\n${'+'.repeat(4_200)}`
    const p = buildEvaluatorUserPrompt({
      contract: contract(),
      evidence: [],
      changedFiles: ['src/main.ts'],
      proposedFiles: [],
      diffSummaries: [longDiff],
    })
    expect(p).toContain('## Diff Summary')
    expect(p).toContain('diff --git')
    expect(p).toContain('[diff truncated:')
    expect(p.length).toBeLessThan(longDiff.length + 1_000)
  })

  it('includes high risk points', () => {
    const c = contract()
    const p = buildEvaluatorUserPrompt({ contract: c, evidence: [], changedFiles: [], proposedFiles: [], riskPoints: c.riskPoints })
    expect(p).toContain('高风险修改')
  })

  it('omits risk section when no high/critical risks', () => {
    const lowRiskPoints = [{ id: 'r1', risk: 'low' as const, text: '低风险', approvalRequired: false }]
    const p = buildEvaluatorUserPrompt({ contract: contract(), evidence: [], changedFiles: [], proposedFiles: [], riskPoints: lowRiskPoints })
    expect(p).not.toContain('Risk Points')
  })
})

describe('parseEvaluatorResponse', () => {
  it('parses approved response', () => {
    const result = parseEvaluatorResponse('{"status":"approved","summary":"Looks good.","findings":[]}', 's1', 't1')
    expect(result.status).toBe('approved')
    expect(result.findings).toHaveLength(0)
  })

  it('parses response with findings', () => {
    const json = JSON.stringify({
      status: 'request_changes',
      summary: 'Found issues.',
      findings: [{ category: 'correctness', severity: 'high', blocking: true, title: 'Bad bug', body: 'This is broken.' }],
    })
    const result = parseEvaluatorResponse(json, 's1', 't1')
    expect(result.status).toBe('request_changes')
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].title).toBe('Bad bug')
    expect(result.findings[0].source).toBe('llm')
    expect(result.findings[0].blocking).toBe(true)
  })

  it('extracts JSON from markdown code fences', () => {
    const md = '```json\n{"status":"approved","summary":"OK","findings":[]}\n```'
    const result = parseEvaluatorResponse(md, 's1', 't1')
    expect(result.status).toBe('approved')
  })

  it('extracts JSON when wrapped in extra text', () => {
    const text = 'Here is my review:\n{"status":"approved","summary":"OK","findings":[]}'
    const result = parseEvaluatorResponse(text, 's1', 't1')
    expect(result.status).toBe('approved')
  })

  it('returns needs_more_verification for invalid JSON', () => {
    const result = parseEvaluatorResponse('not json at all', 's1', 't1')
    expect(result.status).toBe('needs_more_verification')
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].blocking).toBe(false)
    expect(result.findings[0].source).toBe('llm')
  })

  it('returns needs_more_verification for empty string', () => {
    const result = parseEvaluatorResponse('', 's1', 't1')
    expect(result.status).toBe('needs_more_verification')
  })

  it('filters out findings with invalid titles', () => {
    const json = JSON.stringify({
      status: 'approved',
      summary: 'OK',
      findings: [{ category: 'bad', title: '', body: '' }],
    })
    const result = parseEvaluatorResponse(json, 's1', 't1')
    expect(result.findings).toHaveLength(0)
  })

  it('uses defaults for invalid category and severity', () => {
    const json = JSON.stringify({
      status: 'approved',
      summary: 'OK',
      findings: [{ category: 'bad_cat', severity: 'bad_sev', title: 'Valid title', body: 'Body', blocking: false }],
    })
    const result = parseEvaluatorResponse(json, 's1', 't1')
    expect(result.findings[0].category).toBe('correctness')
    expect(result.findings[0].severity).toBe('medium')
  })
})

describe('mergeReviews', () => {
  it('returns rule review when llmReview is null', () => {
    const rule = review('approved', 1, 'rule')
    const merged = mergeReviews(rule, null)
    expect(merged).toBe(rule)
  })

  it('merges rule and llm findings', () => {
    const rule = review('approved', 1, 'rule')
    const llm = review('approved', 1, 'llm')
    const merged = mergeReviews(rule, llm)
    expect(merged.findings).toHaveLength(2)
    expect(merged.findings[0].source).toBe('rule')
    expect(merged.findings[1].source).toBe('llm')
  })

  it('upgrades status when llm blocks', () => {
    const rule = review('approved', 0)
    const llm = review('request_changes', 1, 'llm')
    const merged = mergeReviews(rule, llm)
    expect(merged.status).toBe('request_changes')
  })

  it('keeps approved when both approve', () => {
    const rule = review('approved', 0)
    const llm = review('approved', 0)
    const merged = mergeReviews(rule, llm)
    expect(merged.status).toBe('approved')
  })

  it('combines summaries', () => {
    const rule = review('approved', 0)
    const llm = review('approved', 0)
    const merged = mergeReviews(rule, llm)
    expect(merged.summary).toContain('Rule:')
    expect(merged.summary).toContain('LLM:')
  })

  it('ensures rule findings have source:rule even if not set', () => {
    const rule: ReviewResult = {
      id: 'r_nosource', sessionId: 's1', turnId: 't1', status: 'approved', findingIds: [], findings: [],
      summary: 'ok', createdAt: 1,
    }
    // Manually add finding without source field
    ;(rule as any).findings = [{
      id: 'f1', sessionId: 's1', turnId: 't1', category: 'scope', severity: 'info', blocking: false,
      title: 'No source', body: 'x', evidenceRefs: [], status: 'open', createdAt: 1,
    }]
    const llm = review('approved', 0)
    const merged = mergeReviews(rule, llm)
    expect(merged.findings[0].source).toBe('rule')
  })
})
