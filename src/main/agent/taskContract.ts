import { randomUUID } from 'crypto'
import type {
  AcceptanceEvidenceRequirement,
  AgentContextSnapshot,
  AgentPlanItem,
  AgentSession,
  AgentTurn,
  ContractScopeItem,
  RiskLevel,
  StructuredPlanStatus,
  TaskContract,
} from '../../shared/agent/protocol'

const WRITE_INTENT_RE = /\b(fix|implement|add|remove|delete|update|change|write|edit|refactor|build|create)\b|修复|实现|新增|添加|删除|修改|改造|重构|创建|补充/
const COMMAND_INTENT_RE = /\b(run|execute|install|test|build|deploy|publish|git|npm|pnpm|yarn|bun)\b|运行|执行|安装|发布|部署|命令|测试|构建/
const HIGH_RISK_RE = /\b(rm\s+-rf|delete|drop|reset|rebase|push|publish|deploy|sudo)\b|删除|重置|发布|部署|高风险|危险/
const MAX_GOAL_CHARS = 220

function compact(text: string, maxChars = MAX_GOAL_CHARS): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxChars) return normalized
  return `${normalized.slice(0, maxChars - 1)}…`
}

function isWriteTask(text: string): boolean {
  return WRITE_INTENT_RE.test(text)
}

function riskLevel(text: string): RiskLevel {
  if (HIGH_RISK_RE.test(text)) return 'high'
  if (COMMAND_INTENT_RE.test(text)) return 'medium'
  return 'low'
}

function createScope(context: AgentContextSnapshot, writeTask: boolean): ContractScopeItem[] {
  if (context.activeFile) {
    return [{
      kind: 'file',
      value: context.activeFile.path,
      source: writeTask ? 'agent_inferred' : 'tool_observed',
    }]
  }

  if (context.openFiles.length > 0) {
    return context.openFiles.slice(0, 3).map(file => ({
      kind: 'file',
      value: file.path,
      source: 'agent_inferred',
    }))
  }

  if (context.workspace) {
    return [{ kind: 'workspace', value: context.workspace.path, source: 'agent_inferred' }]
  }

  return [{ kind: 'unknown', value: '需要先通过只读探索确认任务范围。', source: 'agent_inferred' }]
}

function evidenceForTask(writeTask: boolean): AcceptanceEvidenceRequirement[] {
  return writeTask ? ['diff', 'diagnostics', 'command'] : ['user']
}

export function createInitialTaskContract(input: {
  session: AgentSession
  turn: AgentTurn
  text: string
  context: AgentContextSnapshot
  timestamp?: number
}): TaskContract {
  const timestamp = input.timestamp ?? Date.now()
  const writeTask = isWriteTask(input.text)
  const risk = riskLevel(input.text)
  const dirtyFiles = input.context.openFiles.filter(file => file.isDirty)
  const acceptanceEvidence = evidenceForTask(writeTask)

  const riskPoints = [
    {
      id: 'risk_scope',
      risk: risk === 'low' && writeTask ? 'medium' as const : risk,
      text: writeTask
        ? '任务可能修改工作区文件，必须先生成可审查 diff proposal。'
        : '任务默认以只读分析和回答为主，避免扩大到未请求的修改。',
      approvalRequired: writeTask,
    },
    ...dirtyFiles.slice(0, 1).map(file => ({
      id: 'risk_dirty_workspace',
      risk: 'medium' as const,
      text: `当前存在未保存或 dirty 文件：${file.path}，修改前需要避免覆盖用户变更。`,
      approvalRequired: true,
    })),
    ...(risk === 'high' ? [{
      id: 'risk_high_intent',
      risk: 'high' as const,
      text: '用户请求或关键词涉及高风险操作，执行前必须保持显式审批。',
      approvalRequired: true,
    }] : []),
  ]

  return {
    id: `contract_${randomUUID()}`,
    sessionId: input.session.id,
    turnId: input.turn.id,
    goal: compact(input.text) || '处理当前用户任务。',
    scope: createScope(input.context, writeTask),
    nonGoals: [
      '不修改与当前目标无关的文件或配置。',
      '不绕过 RilleCode 的 diff review、权限审批和验证流程。',
    ],
    constraints: [
      `遵守当前权限模式：${input.session.permissionMode}。`,
      '写文件必须先生成 diff proposal，apply_file_edit 只能由 runtime 或用户界面触发。',
      '无法验证时必须说明阻塞原因，不能假装已经通过验证。',
    ],
    acceptanceCriteria: [
      {
        id: 'ac_goal',
        text: '最终结果直接回应用户目标，并说明已完成、未完成或阻塞的部分。',
        evidenceRequired: ['user'],
        status: 'unverified',
      },
      {
        id: writeTask ? 'ac_diff' : 'ac_answer',
        text: writeTask
          ? '如需代码修改，必须先提供可审查的 diff proposal，且不自动写盘。'
          : '如任务是问答或分析，回答必须基于已知上下文，不声称执行过未发生的工具操作。',
        evidenceRequired: acceptanceEvidence,
        status: 'unverified',
      },
      {
        id: 'ac_verify',
        text: writeTask
          ? '修改被应用后应运行可用验证或解释无法验证的原因。'
          : '回答应指出仍需用户确认或后续实现的部分。',
        evidenceRequired: writeTask ? ['diagnostics', 'command'] : ['user'],
        status: 'unverified',
      },
    ],
    verificationPlan: [
      {
        id: 'verify_diagnostics',
        verifier: 'diagnostics',
        reason: '先检查 IDE 可见诊断，判断任务是否与当前错误相关。',
      },
      ...(writeTask ? [{
        id: 'verify_project_command',
        verifier: 'typecheck' as const,
        reason: '代码变更应用后优先使用项目可用的类型检查、测试或构建命令作为证据。',
      }] : []),
    ],
    riskPoints,
    assumptions: [
      {
        id: 'assumption_scope',
        text: input.context.activeFile
          ? `当前活动文件 ${input.context.activeFile.path} 与任务相关。`
          : '任务范围需要通过只读工具进一步确认。',
        status: 'open',
      },
    ],
    status: 'active',
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

export function createInitialPlanItems(contract: TaskContract, timestamp = Date.now()): AgentPlanItem[] {
  const writeTask = contract.acceptanceCriteria.some(item => item.id === 'ac_diff')
  return [
    {
      id: 'plan_contract',
      title: '确认任务合同与验收标准',
      status: 'completed',
      source: 'runtime',
      evidence: contract.id,
      updatedAt: timestamp,
    },
    {
      id: 'plan_explore',
      title: '读取相关上下文并确认修改范围',
      status: 'in_progress',
      source: 'runtime',
      updatedAt: timestamp,
    },
    {
      id: 'plan_execute',
      title: writeTask ? '生成必要的 diff proposal' : '形成基于上下文的回答',
      status: 'pending',
      source: 'runtime',
      updatedAt: timestamp,
    },
    {
      id: 'plan_verify',
      title: '按验收标准验证并汇报结果',
      status: 'pending',
      source: 'runtime',
      updatedAt: timestamp,
    },
  ]
}

function normalizeStatus(value: unknown, fallback: StructuredPlanStatus): StructuredPlanStatus {
  if (value === 'pending' || value === 'in_progress' || value === 'completed' || value === 'blocked' || value === 'skipped') {
    return value
  }
  return fallback
}

function createPlanId(title: string, index: number): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24)
  return `plan_${slug || index + 1}`
}

export function normalizePlanUpdate(input: {
  currentItems: AgentPlanItem[]
  rawItems: unknown
  reason?: unknown
  timestamp?: number
}): { items: AgentPlanItem[]; reason?: string } {
  if (!Array.isArray(input.rawItems)) {
    throw new Error('update_plan 需要 items 数组。')
  }

  const timestamp = input.timestamp ?? Date.now()
  const currentById = new Map(input.currentItems.map(item => [item.id, item]))
  const updatedById = new Map<string, AgentPlanItem>()

  for (let index = 0; index < input.rawItems.length; index += 1) {
    const raw = input.rawItems[index]
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const item = raw as Record<string, unknown>
    const rawId = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : ''
    const current = rawId ? currentById.get(rawId) : undefined
    const title = typeof item.title === 'string' && item.title.trim()
      ? compact(item.title, 120)
      : current?.title
    if (!title) continue
    const id = rawId || createPlanId(title, input.currentItems.length + index)
    const status = normalizeStatus(item.status, current?.status ?? 'pending')
    updatedById.set(id, {
      id,
      title,
      description: typeof item.description === 'string' && item.description.trim() ? compact(item.description, 240) : current?.description,
      status,
      source: 'model',
      evidence: typeof item.evidence === 'string' && item.evidence.trim() ? compact(item.evidence, 240) : current?.evidence,
      updatedAt: timestamp,
    })
  }

  if (updatedById.size === 0) {
    throw new Error('update_plan 至少需要一个有效计划项。')
  }

  const merged = input.currentItems.map(item => updatedById.get(item.id) ?? item)
  for (const item of updatedById.values()) {
    if (!currentById.has(item.id)) merged.push(item)
  }

  return {
    items: merged,
    reason: typeof input.reason === 'string' && input.reason.trim() ? compact(input.reason, 240) : undefined,
  }
}
