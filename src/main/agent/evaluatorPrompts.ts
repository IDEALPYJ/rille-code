import { randomUUID } from 'crypto'
import type { Evidence, ReviewFinding, ReviewResult, TaskContract } from '../../shared/agent/protocol'

function now(): number {
  return Date.now()
}

interface EvaluatorUserPromptInput {
  contract?: TaskContract
  evidence: Evidence[]
  changedFiles: string[]
  proposedFiles: string[]
  diffSummaries?: string[]
  riskPoints?: TaskContract['riskPoints']
}

interface ParsedEvaluatorFinding {
  category?: string
  severity?: string
  blocking?: boolean
  title?: string
  body?: string
  filePath?: string
  recommendation?: string
}

interface ParsedEvaluatorResponse {
  status?: string
  summary?: string
  findings?: ParsedEvaluatorFinding[]
}

const VALID_CATEGORIES = new Set(['scope', 'correctness', 'security', 'test', 'architecture', 'ux', 'evidence'])
const VALID_SEVERITIES = new Set(['info', 'low', 'medium', 'high', 'critical'])
const VALID_STATUSES = new Set(['approved', 'request_changes', 'needs_more_verification'])
const MAX_DIFF_SUMMARIES = 4
const MAX_DIFF_CHARS = 4_000

function truncateDiff(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length <= MAX_DIFF_CHARS) return trimmed
  return `${trimmed.slice(0, MAX_DIFF_CHARS)}\n...[diff truncated: ${trimmed.length - MAX_DIFF_CHARS} chars omitted]`
}

export function buildEvaluatorSystemPrompt(skepticism: 'low' | 'medium' | 'high'): string {
  const tone = {
    low: 'You are a quality reviewer. Check the agent\'s work for obvious issues.',
    medium: 'You are a thorough reviewer. Look carefully for problems in the agent\'s work that might have been missed.',
    high: [
      'You are a SKEPTICAL code reviewer. Your job is to find problems the agent missed. Assume the agent may have:',
      '- Skipped edge cases',
      '- Made incorrect assumptions',
      '- Left unfinished work',
      '- Broken existing functionality',
      '- Introduced security issues',
      '- Not verified changes properly',
      'Be critical. It is worse to approve bad work than to flag a minor issue.',
    ].join('\n'),
  }[skepticism]

  return [
    tone,
    '',
    'Output ONLY a JSON object matching this schema, with no other text:',
    '{',
    '  "status": "approved" | "request_changes" | "needs_more_verification",',
    '  "summary": "One-line summary of the review",',
    '  "findings": [',
    '    {',
    '      "category": "scope" | "correctness" | "security" | "test" | "architecture" | "ux" | "evidence",',
    '      "severity": "info" | "low" | "medium" | "high" | "critical",',
    '      "blocking": true | false,',
    '      "title": "Short finding title",',
    '      "body": "Detailed explanation",',
    '      "filePath": "optional file path",',
    '      "recommendation": "optional fix suggestion"',
    '    }',
    '  ]',
    '}',
    '',
    'If you find no issues, return status "approved" with an empty findings array.',
  ].join('\n')
}

export function buildEvaluatorUserPrompt(input: EvaluatorUserPromptInput): string {
  const parts: string[] = []

  if (input.contract) {
    parts.push(`## Task Goal\n${input.contract.goal}`)
    if (input.contract.acceptanceCriteria.length > 0) {
      parts.push([
        '## Acceptance Criteria',
        ...input.contract.acceptanceCriteria.map(c =>
          `- [${c.status}] ${c.text} (requires: ${c.evidenceRequired.join(', ')})`
        ),
      ].join('\n'))
    }
    if (input.contract.nonGoals.length > 0) {
      parts.push(`## Non-Goals\n${input.contract.nonGoals.map(g => `- ${g}`).join('\n')}`)
    }
    if (input.contract.constraints.length > 0) {
      parts.push(`## Constraints\n${input.contract.constraints.map(c => `- ${c}`).join('\n')}`)
    }
  }

  if (input.evidence.length > 0) {
    const evidenceLines = input.evidence.slice(-12).map(e =>
      `- [${e.source}] **${e.status}**: ${e.summary.slice(0, 300)}${e.output ? `\n  output: ${e.output.slice(0, 600)}` : ''}`
    )
    parts.push(`## Verification Evidence (${input.evidence.length} items, showing last ${Math.min(12, input.evidence.length)})\n${evidenceLines.join('\n')}`)
  }

  const allFiles = [...new Set([...input.changedFiles, ...input.proposedFiles])]
  if (allFiles.length > 0) {
    parts.push(`## Changed Files\n${allFiles.map(f => `- ${f}`).join('\n')}`)
  }

  const diffSummaries = (input.diffSummaries ?? []).map(truncateDiff).filter(Boolean).slice(0, MAX_DIFF_SUMMARIES)
  if (diffSummaries.length > 0) {
    parts.push(`## Diff Summary\n${diffSummaries.map((diff, index) => `### Diff ${index + 1}\n${diff}`).join('\n\n')}`)
  }

  const highRisks = (input.riskPoints ?? []).filter(r => r.risk === 'high' || r.risk === 'critical')
  if (highRisks.length > 0) {
    parts.push(`## Risk Points\n${highRisks.map(r => `- [${r.risk}] ${r.text}`).join('\n')}`)
  }

  return parts.join('\n\n')
}

function extractJson(raw: string): string | null {
  const trimmed = raw.trim()
  // Try markdown code fence extraction
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/)
  if (fenceMatch) return fenceMatch[1].trim()
  // Try to find first { and last }
  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1)
  }
  return null
}

function validateCategory(value: unknown): ReviewFinding['category'] | null {
  if (typeof value === 'string' && VALID_CATEGORIES.has(value)) return value as ReviewFinding['category']
  return null
}

function validateSeverity(value: unknown): ReviewFinding['severity'] | null {
  if (typeof value === 'string' && VALID_SEVERITIES.has(value)) return value as ReviewFinding['severity']
  return null
}

function validateStatus(value: unknown): ReviewResult['status'] | null {
  if (typeof value === 'string' && VALID_STATUSES.has(value)) return value as ReviewResult['status']
  return null
}

export function parseEvaluatorResponse(raw: string, sessionId: string, turnId: string): ReviewResult {
  const jsonStr = extractJson(raw)
  if (!jsonStr) {
    return buildParseFailureReview(sessionId, turnId, 'Evaluator response contained no valid JSON.')
  }

  let parsed: ParsedEvaluatorResponse
  try {
    parsed = JSON.parse(jsonStr)
  } catch {
    return buildParseFailureReview(sessionId, turnId, 'Evaluator response was not valid JSON.')
  }

  if (!parsed || typeof parsed !== 'object') {
    return buildParseFailureReview(sessionId, turnId, 'Evaluator response was not a JSON object.')
  }

  const status = validateStatus(parsed.status) ?? 'needs_more_verification'
  const summary = typeof parsed.summary === 'string' && parsed.summary.trim()
    ? parsed.summary.trim().slice(0, 480)
    : status === 'approved'
      ? 'LLM review approved.'
      : 'LLM review found issues.'

  const findings: ReviewFinding[] = []
  if (Array.isArray(parsed.findings)) {
    for (const f of parsed.findings) {
      if (!f || typeof f !== 'object') continue
      const title = typeof f.title === 'string' && f.title.trim() ? f.title.trim().slice(0, 240) : null
      if (!title) continue
      findings.push({
        id: `finding_${randomUUID()}`,
        sessionId,
        turnId,
        category: validateCategory(f.category) ?? 'correctness',
        severity: validateSeverity(f.severity) ?? 'medium',
        blocking: typeof f.blocking === 'boolean' ? f.blocking : false,
        title,
        body: typeof f.body === 'string' && f.body.trim() ? f.body.trim().slice(0, 2000) : title,
        filePath: typeof f.filePath === 'string' && f.filePath.trim() ? f.filePath.trim() : undefined,
        recommendation: typeof f.recommendation === 'string' && f.recommendation.trim() ? f.recommendation.trim().slice(0, 480) : undefined,
        evidenceRefs: [],
        status: 'open',
        source: 'llm',
        createdAt: now(),
      })
    }
  }

  return {
    id: `review_${randomUUID()}`,
    sessionId,
    turnId,
    status,
    findingIds: findings.map(f => f.id),
    findings,
    summary,
    createdAt: now(),
  }
}

function buildParseFailureReview(sessionId: string, turnId: string, reason: string): ReviewResult {
  const finding: ReviewFinding = {
    id: `finding_${randomUUID()}`,
    sessionId,
    turnId,
    category: 'evidence',
    severity: 'low',
    blocking: false,
    title: 'Evaluator response parse failure',
    body: reason,
    evidenceRefs: [],
    recommendation: 'Check evaluator model configuration. The model may have returned an unexpected format.',
    status: 'open',
    source: 'llm',
    createdAt: now(),
  }
  return {
    id: `review_${randomUUID()}`,
    sessionId,
    turnId,
    status: 'needs_more_verification',
    findingIds: [finding.id],
    findings: [finding],
    summary: `LLM evaluator failed: ${reason}`,
    createdAt: now(),
  }
}
