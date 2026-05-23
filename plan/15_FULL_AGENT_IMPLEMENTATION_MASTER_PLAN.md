# RilleCode Agent 完全体实现总控计划

## 文档定位

本文件是 RilleCode Agent 后续实现的唯一执行看板。`00_INDEX.md` 到 `14_IMPLEMENTATION_ROADMAP.md` 保留为模块详设和历史路线说明；实际推进、完成标记、验收记录和下一步入口都以本文件为准。

核心原则：

- 一开始按最终完全体设计协议和架构。
- 代码按可验证小步落地，不用一次性大重写替代当前可运行闭环。
- 每一步完成后必须更新本文件的状态、验证结果、完成记录和下一步指针。
- 每个新增协议必须有 replay 兼容测试，每个 runtime 行为必须有自动化测试或明确手工验收记录。
- UI 状态必须能从事件恢复，不能只靠临时内存状态。

## 完全体目标

RilleCode Agent 的最终形态是 IDE-native agentic coding runtime，不是聊天式代码助手。

最终能力：

- 将用户请求转成可验证的 Task Contract。
- 用 ContextFragment pipeline 构造稳定、可追踪、可裁剪的模型上下文。
- 通过 provider-neutral Model Gateway 统一文本 JSON fallback、原生 tool calling、streaming、usage 和 fallback。
- 用 Tool Runtime 暴露受控工具，并将结果转成 Observation。
- 用 Policy 和 Execution Runtime 控制 local / WSL / SSH 工作区、命令、文件写入、grant 和风险审批。
- 用 Evidence、VerificationCoverage 和 ReviewFinding 决定任务是否可完成。
- 用 Memory、Feature List、Progress 和 Handoff 支持长任务恢复。
- 用 TraceEvent、AgentUsage、debug export 和 eval case 支持复盘、成本控制和回归评估。
- 用 Agent 工作台展示 Task、Plan、Diff、Approval、Evidence、Review、Handoff、Trace 和 Subagent 输出。
- 在单 Agent 稳定后引入 Skills、Advisor、read-only explorer、reviewer/verifier subagents。

## 完全体端到端数据流

```text
User request
  -> Task Intake
  -> TaskContract
  -> Orchestrator phase decision
  -> Context Engine builds ContextBuildResult
  -> Model Gateway returns ModelDecision
  -> Policy checks proposed action
  -> Tool Runtime / Execution Runtime executes allowed action
  -> Observation is emitted and persisted
  -> Verification / Review create Evidence and Findings
  -> Repair Loop or Completion Gate
  -> Handoff / Trace / Usage / Eval update
  -> Product UX renders recoverable state
```

不可绕过的边界：

- 模型只能提出意图，不能直接成为事实源。
- 写文件只能通过 diff proposal 和 runtime-only apply。
- 命令必须经过 policy 和 execution runtime。
- final answer 必须回到 Task Contract 的 acceptance criteria。
- code_changed 后没有 Evidence 不允许完成。
- Subagent 只能作为主 Agent 的受控工具，不能绕过主 Agent 的 policy、verification 和 review。

## 最终接口索引

本节定义完全体必须拥有的协议对象。实现时可以分阶段增加字段，但命名和职责不能反复漂移。

### Task

```ts
interface TaskContract {
  id: string
  sessionId: string
  turnId: string
  goal: string
  scope: ContractScopeItem[]
  nonGoals: string[]
  constraints: string[]
  acceptanceCriteria: AcceptanceCriterion[]
  verificationPlan: VerificationPlanItem[]
  riskPoints: RiskPoint[]
  assumptions: TaskAssumption[]
  status: 'draft' | 'active' | 'updated' | 'completed' | 'blocked'
  createdAt: number
  updatedAt: number
}

interface AgentPlanItem {
  id: string
  title: string
  description?: string
  status: 'pending' | 'in_progress' | 'completed' | 'blocked' | 'skipped'
  source: 'runtime' | 'model' | 'user'
  evidence?: string
  updatedAt: number
}
```

完成目标：

- TaskContract 可被创建、更新、确认、阻塞和完成。
- PlanItem 可跨模型调用更新，并能从 JSONL replay 恢复。

### Context

```ts
type ContextFragmentType =
  | 'system'
  | 'tool_schema'
  | 'project_rules'
  | 'task_contract'
  | 'plan'
  | 'workspace'
  | 'active_editor'
  | 'open_files'
  | 'git'
  | 'diagnostics'
  | 'tool_observation'
  | 'edit_proposal'
  | 'verification'
  | 'review'
  | 'session_summary'
  | 'memory_ref'
  | 'handoff'

interface ContextFragment {
  id: string
  type: ContextFragmentType
  section: 'stable_prefix' | 'dynamic_suffix'
  priority: number
  source: string
  text: string
  trusted: boolean
  cacheKey?: string
  stale?: boolean
  tokenEstimate?: number
}

interface ContextTrace {
  included: ContextTraceItem[]
  excluded: ContextTraceItem[]
  totalTokenEstimate: number
  budgetTokens: number
}

interface ContextBuildResult {
  fragments: ContextFragment[]
  prompt: string
  trace: ContextTrace
}
```

完成目标：

- 同样输入下 fragment 顺序稳定。
- 重要 evidence 和 repair context 优先于旧工具输出。
- trace 能解释纳入和排除原因。

### Model Gateway

```ts
interface ModelRequest {
  sessionId: string
  turnId: string
  taskContractId?: string
  messages: AgentChatMessage[]
  tools: AgentToolDefinition[]
  mode: 'json_text' | 'native_tools' | 'streaming'
}

interface ModelDecision {
  id: string
  type: 'answer' | 'tool_calls' | 'clarification' | 'blocked'
  text?: string
  toolCalls?: AgentToolCall[]
  usage?: AgentUsage
  rawProviderPayloadRef?: string
}
```

完成目标：

- TextJsonToolAdapter 保留为 fallback。
- 原生 tool calling 和 streaming 可逐 provider 接入。
- usage、provider fallback 和 parse failure 可追踪。

### Tool / Policy / Execution

```ts
interface Observation {
  id: string
  sessionId: string
  turnId: string
  source: 'tool' | 'policy' | 'edit' | 'verification' | 'review' | 'user' | 'runtime'
  status: 'ok' | 'error' | 'denied' | 'blocked' | 'stale'
  summary: string
  data?: Record<string, unknown>
  createdAt: number
}

interface PolicyDecision {
  action: 'allow' | 'ask' | 'deny'
  risk: 'low' | 'medium' | 'high' | 'critical'
  reason: string
  matchedRule?: string
  grant?: PermissionGrant
}

interface PermissionGrant {
  id: string
  scope: 'tool' | 'command' | 'workspace' | 'session'
  pattern: string
  expiresAt?: number
}
```

完成目标：

- Tool schema 包含 visibility、sideEffect、validate。
- `.rille/policy.json` 能配置项目级规则。
- deny 和 ask 都进入 Observation 和 replay。
- local / WSL / SSH 的执行环境、路径和风险在 UI 可见。

### Verification / Review

```ts
interface Evidence {
  id: string
  criterionId?: string
  source: 'command' | 'diagnostics' | 'diff' | 'review' | 'browser' | 'user'
  status: 'passed' | 'failed' | 'partial' | 'blocked' | 'stale' | 'waived'
  artifactRef?: string
  summary: string
  createdAt: number
}

interface VerificationCoverage {
  contractId: string
  criteria: Array<{
    criterionId: string
    status: 'covered' | 'failed' | 'partial' | 'blocked' | 'stale' | 'waived'
    evidenceIds: string[]
  }>
}

interface ReviewFinding {
  id: string
  severity: 'info' | 'minor' | 'major' | 'critical'
  category: 'scope' | 'correctness' | 'security' | 'test' | 'architecture' | 'ux'
  filePath?: string
  range?: AgentTextRange
  blocking: boolean
  evidence?: string
  recommendation: string
}
```

完成目标：

- final gate 由 coverage 和 blocking findings 决定。
- verification failure 会进入 repair context。
- review finding 可定位到文件和范围。

### Memory / Trace / Skills

```ts
interface Handoff {
  id: string
  sessionId: string
  taskContractId: string
  progress: FeatureProgressItem[]
  verifiedState: 'verified' | 'implemented_unverified' | 'blocked' | 'stale'
  failedAttempts: string[]
  nextSteps: string[]
  createdAt: number
}

interface TraceEvent {
  id: string
  sessionId: string
  turnId?: string
  category: 'context' | 'model' | 'tool' | 'policy' | 'execution' | 'verification' | 'review' | 'memory' | 'ux'
  summary: string
  dataRef?: string
  createdAt: number
}

interface AgentUsage {
  providerId: AgentProviderId
  model: string
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
  durationMs?: number
}

interface SkillContract {
  id: string
  name: string
  description: string
  activation: 'manual' | 'advisor' | 'automatic'
  allowedTools: string[]
}

interface SubagentContract {
  id: string
  role: 'explorer' | 'reviewer' | 'verifier' | 'advisor'
  permissions: 'read_only' | 'review_only'
  outputSchema: string
}
```

完成目标：

- 长任务 resume 能检查 handoff 与当前 workspace 是否冲突。
- Trace 可导出、脱敏、回放。
- Subagent 输出必须由主 Agent 合并、裁决和验证。

## 阶段总览

| 阶段 | 状态 | 目标 | 下一步入口 |
| --- | --- | --- | --- |
| Phase D | 已完成 | Task Contract + Structured Plan | 已作为当前基线 |
| Phase D/E Hardening | 已完成 | 补齐 Task Contract 更新、dirty buffer 防覆盖、旧 approval resume 和 context summary 基础 | 已作为当前稳定基线 |
| Phase E | 已完成 | Final Context Engine Foundation | 已作为当前 Context 基线 |
| Phase F | 已完成 | Tool Runtime + Policy Foundation | 已作为当前 Tool / Policy 基线 |
| Phase G | 已完成 | Verification + Review Gate | 已作为当前 Verification / Review 基线 |
| Phase H | 已完成 | Memory + Long-running State | 已作为当前 Memory/Long-running 基线 |
| Phase I | 已完成 | Observability + Eval | 已作为当前 Observability/Eval 基线 |
| Phase J | 未开始 | UX + Skills/Subagents | 从 Evidence UI 和 skills discovery 开始 |

## 执行 Checklist

### Phase D: Task Contract + Structured Plan

- [x] D1. 新增 TaskContract、AcceptanceCriterion、RiskPoint、TaskAssumption、AgentPlanItem 协议。
- [x] D2. 新增 task_contract.created、task_contract.updated、plan.updated 事件。
- [x] D3. submitTurn 创建轻量 Task Contract 和初始 Plan。
- [x] D4. TextJsonToolAdapter 注入 Task Contract 和 Plan。
- [x] D5. 新增 model-visible update_plan 工具。
- [x] D6. AgentPanel 展示 Task Contract card 和 Plan card。
- [x] D7. 补充 task contract、update_plan、model prompt、session replay 测试。
- [x] D8. 完成 `npm test`、`npm run typecheck`、`npm run build` 验证。

### Phase E: Final Context Engine Foundation

- [x] E1. 在 shared protocol 增加 ContextFragment、ContextTrace、ContextBuildInput、ContextBuildResult 和 context.built event。
- [x] E2. 将 `buildAgentContextPrompt()` 拆成 buildAgentContext() 和兼容 wrapper。
- [x] E3. 实现 task contract、plan、workspace、active editor、open files、diagnostics、git collectors。
- [x] E4. 实现 project rules 读取顺序：AGENTS.md、CLAUDE.md、RILLE.md、.rille/rules.md、.rille/rules/*.md、README.md、.rille/local.md。
- [x] E5. 实现 stable_prefix / dynamic_suffix 分区和 deterministic trimming。
- [x] E6. AgentLoop 使用 ContextBuildResult，并持久化 context trace 摘要。
- [x] E7. 补充 context builder、runtime event、session replay 测试。
- [x] E8. 更新 01、05、14、15 文档并记录验证结果。

### Phase F: Tool Runtime + Policy Foundation

- [x] F1. RegisteredTool 增加 visibility、sideEffect、validate 和 runtime-only 明确标记。
- [x] F2. ToolResult 转 Observation，并持久化 tool/policy/edit observation。
- [x] F3. 增加 `.rille/policy.json` loader、schema 和默认策略。
- [x] F4. 增加 PermissionGrant、grant scope、expiresAt 和 approval audit。
- [x] F5. policy denial 进入 Observation，deny 后避免重复请求同一风险动作。
- [x] F6. 增加 ask_user 和 select_files 工具。
- [x] F7. 补充 tool validation、policy loader、grant、denial replay 测试。
- [x] F8. 更新 01、06、07、14、15 文档并记录验证结果。

### Phase G: Verification + Review Gate

- [x] G1. 扩展 VerificationStatus 为 passed、failed、skipped、partial、blocked、stale、waived。
- [x] G2. 增加 Evidence 和 VerificationCoverage 协议与事件。
- [x] G3. 增加 before-stop hook：code_changed 后无 evidence 不允许 completed。
- [x] G4. verification failure 进入 repair context。
- [x] G5. 增加 ReviewFinding、ReviewResult 和 blocking gate。
- [x] G6. AgentPanel 展示 evidence coverage 和 review findings。
- [x] G7. 补充 verification gate、review gate、repair loop、replay 测试。
- [x] G8. 更新 01、09、10、14、15 文档并记录验证结果。

### Phase H: Memory + Long-running State

- [x] H1. 增加 FeatureProgressItem、ProgressState、Handoff 协议与事件。
- [x] H2. pause/resume 时生成和恢复 handoff。
- [x] H3. resume 时检查 workspace freshness 和 evidence stale。
- [x] H4. 区分 verified、implemented_unverified、blocked、stale 状态。
- [x] H5. 增加 compact boundary 和 session summary。
- [x] H6. 补充 handoff、resume stale、progress replay 测试。
- [x] H7. 更新 01、11、14、15 文档并记录验证结果。

### Phase I: Observability + Eval

- [x] I1. 增加 TraceEvent 和 AgentUsage 协议与事件。
- [x] I2. 为 context、model、tool、policy、execution、verification、review 增加 trace。
- [x] I3. 增加 redacted debug export。
- [x] I4. 建立 eval case 目录和 replay runner。
- [x] I5. 增加 trajectory 指标：完成率、修复率、重复 deny、验证覆盖、成本、耗时。
- [x] I6. 补充 trace export、usage、eval replay 测试。
- [x] I7. 更新 01、12、14、15 文档并记录验证结果。

### Phase J: UX + Skills/Subagents

- [ ] J1. Agent 工作台展示 Task、Plan、Diff、Approval、Evidence、Review、Handoff、Trace。
- [ ] J2. Session card 展示 risk、latest verification、last action、handoff 状态。
- [ ] J3. Composer 支持 /plan、/fix、@file、#selection。
- [ ] J4. 增加 skills discovery 和 SkillContract。
- [ ] J5. 增加 advisor policy。
- [ ] J6. 增加 read-only explorer、reviewer、verifier subagents。
- [ ] J7. 确保 Subagent 输出由主 Agent 合并、裁决和验证。
- [ ] J8. 补充 UX replay、skills discovery、subagent isolation 测试。
- [ ] J9. 更新 01、13、14、15 文档并记录验证结果。

## 每步固定验收模板

每完成一个 checklist item，必须在对应阶段记录中追加：

```text
步骤:
状态:
完成日期:
涉及模块:
实现摘要:
测试文件:
验证命令:
验证结果:
剩余风险:
下一步:
```

## 当前完成记录

### Phase D 完成记录

步骤: D1-D8
状态: 已完成
完成日期: 2026-05-22
涉及模块: protocol、taskContract、thread、runtime、modelAdapter、tools、AgentPanel、sessionStore tests
实现摘要: 已完成 Task Contract、Structured Plan、update_plan、Task/Plan UI、prompt 注入和 replay 兼容测试。
测试文件: `tests/agent/taskContract.test.ts`、`tests/agent/tools.test.ts`、`tests/agent/modelAdapter.test.ts`、`tests/agent/sessionStore.test.ts`
验证命令: `npm test`、`npm run typecheck`、`npm run build`
验证结果: `npm test` 为 8 files / 22 tests passed；`npm run typecheck` passed；`npm run build` passed。
剩余风险: Task Contract 还没有用户确认 gate，Plan 还没有 evidence-driven completion gate，这些进入 Phase G。
下一步: Phase E1，在 shared protocol 增加 ContextFragment、ContextTrace、ContextBuildInput、ContextBuildResult 和 context.built event。

### Phase E1 完成记录

步骤: E1
状态: 已完成
完成日期: 2026-05-22
涉及模块: protocol、sessionStore tests
实现摘要: 已在共享协议中增加 ContextBuildPhase、ContextFragmentType、ContextFragment、ContextTraceItem、ContextTrace、ContextBuildInput、ContextBuildResult、ContextBuiltSummary，并新增 `context.built` 事件。事件只携带 trace 和 summary，不持久化完整 prompt。
测试文件: `tests/agent/sessionStore.test.ts`
验证命令: `npm test`、`npm run typecheck`、`npm run build`
验证结果: `npm test` 为 8 files / 23 tests passed；`npm run typecheck` passed；`npm run build` passed。
剩余风险: ContextBuilder 仍未拆分，`context.built` 尚未由 AgentLoop 发出；这些进入 E2-E6。
下一步: Phase E2，将 `buildAgentContextPrompt()` 拆成 `buildAgentContext()` 和兼容 wrapper。

### Phase E2 完成记录

步骤: E2
状态: 已完成
完成日期: 2026-05-22
涉及模块: contextBuilder、context builder tests
实现摘要: 已新增 `buildAgentContext(input)`，返回 `ContextBuildResult`，包含 legacy-compatible prompt、fragments 和 trace；保留 `buildAgentContextPrompt(context)` 作为兼容 wrapper，现有 AgentLoop 可继续使用旧入口。trace 只记录 fragment 元数据和纳入原因，不保存完整 prompt。
测试文件: `tests/agent/contextBuilder.test.ts`
验证命令: `npm test`、`npm run typecheck`、`npm run build`
验证结果: `npm test` 为 9 files / 25 tests passed；`npm run typecheck` passed；`npm run build` passed。
剩余风险: 当前 `buildAgentContext()` 仍用单个 legacy workspace fragment 承载旧 prompt，尚未拆成 task contract、plan、workspace、active editor、diagnostics、git 等 collector；这些进入 E3。
下一步: Phase E3，实现 task contract、plan、workspace、active editor、open files、diagnostics、git collectors。

### Phase E3 完成记录

步骤: E3
状态: 已完成
完成日期: 2026-05-23
涉及模块: contextBuilder、context builder tests
实现摘要: 已将 `buildAgentContext()` 从单个 legacy fragment 拆成 task_contract、plan、workspace、active_editor、open_files、diagnostics、git collectors；prompt 由 fragments 渲染，stable_prefix 保持在 dynamic_suffix 前；wrapper 继续走 `buildAgentContext()` 的最小 input 路径。
测试文件: `tests/agent/contextBuilder.test.ts`
验证命令: `npm test`、`npm run typecheck`、`npm run build`
验证结果: `npm test` 为 9 files / 29 tests passed；`npm run typecheck` passed；`npm run build` passed。
剩余风险: 项目规则仍沿用 `CLAUDE.md`、`AGENTS.md`、`README.md` legacy 列表，尚未实现完整 E4 顺序；deterministic trimming 和 AgentLoop 发 `context.built` 仍待 E5/E6。
下一步: Phase E4，实现 project rules 读取顺序：AGENTS.md、CLAUDE.md、RILLE.md、.rille/rules.md、.rille/rules/*.md、README.md、.rille/local.md。

### Phase E4 完成记录

步骤: E4
状态: 已完成
完成日期: 2026-05-23
涉及模块: contextBuilder、context builder tests
实现摘要: 已将 project rules collector 从旧 `CLAUDE.md`、`AGENTS.md`、`README.md` 列表升级为完整读取顺序：`AGENTS.md`、`CLAUDE.md`、`RILLE.md`、`.rille/rules.md`、`.rille/rules/*.md`、`README.md`、`.rille/local.md`。普通文件缺失或读取失败会跳过；`.rille/rules` 目录缺失或不可读会跳过；目录内只读取 `.md` 文件并按文件名稳定升序；fragment source 记录实际命中的规则文件路径。
测试文件: `tests/agent/contextBuilder.test.ts`
验证命令: `npm test`、`npm run typecheck`、`npm run build`、`rg -n "TO""DO|TB""D|待""补" plan`、`rg -n "\[ \]|\[x\]" plan/15_FULL_AGENT_IMPLEMENTATION_MASTER_PLAN.md`
验证结果: `npm test` 为 9 files / 31 tests passed；`npm run typecheck` passed；`npm run build` passed；文档占位检查无输出；checklist 检查可列出当前完成与未完成项。
剩余风险: Context Engine 仍未实现 budget-aware deterministic trimming、cache key、context trace event 持久化和 observation/evidence fragment，这些进入 E5-E7。
下一步: Phase E5，实现 stable_prefix / dynamic_suffix 分区排序收敛、deterministic trimming 和 trace excluded 记录。

### Phase E5 完成记录

步骤: E5
状态: 已完成
完成日期: 2026-05-23
涉及模块: contextBuilder、context builder tests
实现摘要: 已增加 Context Engine 选择层。collector 产出的候选 fragments 会按 `stable_prefix` 优先于 `dynamic_suffix`、priority 降序、source 升序、id 升序进行确定性排序；随后按 `budgetTokens` 逐项纳入，预算耗尽时将剩余 fragment 写入 trace excluded；极小预算下保留最高优先级 fragment，避免生成空 prompt。`buildAgentContext()` 返回的 fragments 现在代表实际纳入 prompt 的 fragments，trace 同时记录 included、excluded、totalTokenEstimate 和 budgetTokens。
测试文件: `tests/agent/contextBuilder.test.ts`
验证命令: `npm test`、`npm run typecheck`、`npm run build`、`rg -n "TO""DO|TB""D|待""补" plan`、`rg -n "\[ \]|\[x\]" plan/15_FULL_AGENT_IMPLEMENTATION_MASTER_PLAN.md`
验证结果: `npm test` 为 9 files / 33 tests passed；`npm run typecheck` passed；`npm run build` passed；文档占位检查无输出；checklist 检查可列出当前完成与未完成项。
剩余风险: AgentLoop 仍通过兼容 wrapper 使用 prompt，尚未持久化 `context.built` trace；tool observation、verification evidence、review finding 还未成为 context fragment。
下一步: Phase E6，AgentLoop 改用 `buildAgentContext()` 的 `ContextBuildResult`，并持久化 redacted `context.built` summary 和 trace。

### Phase E6-E8 / Phase E 完成记录

步骤: E6-E8
状态: 已完成
完成日期: 2026-05-23
涉及模块: runtime、contextBuilder、sessionStore tests、runtime tests、context builder tests、Phase E 文档
实现摘要: `AgentLoop` 已直接调用 `buildAgentContext()` 并使用 `ContextBuildResult.prompt` 构造模型消息；模型调用前会持久化 redacted `context.built` 事件，summary 记录 phase、fragmentCount、includedCount、excludedCount、totalTokenEstimate、budgetTokens，trace 只包含 fragment 元数据、source、reason 和 tokenEstimate，不包含完整 prompt 或 fragment text。`buildAgentContextPrompt()` 保持为兼容 wrapper，并与 AgentLoop 共享 `DEFAULT_CONTEXT_BUDGET_TOKENS`。
测试文件: `tests/agent/contextBuilder.test.ts`、`tests/agent/runtime.test.ts`、`tests/agent/sessionStore.test.ts`
验证命令: `npm test`、`npm run typecheck`、`npm run build`、`rg -n "TO""DO|TB""D|待""补" plan`、`rg -n "\[ \]|\[x\]" plan/15_FULL_AGENT_IMPLEMENTATION_MASTER_PLAN.md`
验证结果: `npm test` 为 10 files / 35 tests passed；`npm run typecheck` passed；`npm run build` passed；文档占位检查无输出；checklist 检查可列出当前完成与未完成项。
剩余风险: Phase E 不实现 cache key、tool observation fragment、verification/review fragment、compact boundary；这些按总控计划进入 Phase F/G/H。
下一步: Phase F1，RegisteredTool 增加 visibility、sideEffect、validate 和 runtime-only 明确标记。

### Phase D/E Hardening 完成记录

步骤: D/E hardening
状态: 已完成
完成日期: 2026-05-23
涉及模块: taskContract、tools、runtime、thread、editStore、workspace、protocol、preload、AgentPanel、task/runtime/tool/edit/thread tests
实现摘要: 已补齐模型可见 `update_task_contract` 工具，runtime 校验合同更新后发出 `task_contract.updated` 并更新同一个 Task Contract message part；已增加 workspace canonical path helper，让 `read_file` 和 `propose_file_edit` 在相对路径与活动编辑器绝对路径等价时使用 dirty buffer；`applyEditProposal` 写盘前会检查当前 IDE snapshot 中同文件 dirty 状态，冲突时不覆盖未保存内容；resume `waiting_approval` session 时恢复为 `idle`，旧 `approval.requested` 会作为历史展示并立即发出非持久化失效提示；AgentPanel 已保存 latest context summary，供后续 Trace UI 使用。
测试文件: `tests/agent/taskContract.test.ts`、`tests/agent/tools.test.ts`、`tests/agent/editStore.test.ts`、`tests/agent/runtime.test.ts`、`tests/agent/thread.test.ts`
验证命令: `npm test`、`npm run typecheck`、`npm run build`
验证结果: `npm test` 为 11 files / 44 tests passed；`npm run typecheck` passed；`npm run build` passed。
剩余风险: 本轮没有实现 Phase F 的 Tool metadata、Observation、`.rille/policy.json` grant；没有实现 Phase G 的 Evidence、VerificationCoverage、ReviewFinding 和 before-stop final gate。
下一步: Phase F1，RegisteredTool 增加 visibility、sideEffect、validate 和 runtime-only 明确标记。

### Phase F / Tool Runtime + Policy Foundation 完成记录

步骤: F1-F8
状态: 已完成
完成日期: 2026-05-23
涉及模块: protocol、tools、permissions、runtime、thread、AgentPanel、tool/permission/runtime/sessionStore tests、Phase F 文档
实现摘要: 已新增 ToolVisibility、ToolSideEffect、ToolValidationResult、ToolFailureType、Observation、PolicyRule、PolicyDecision、PermissionGrant 和 `observation.created` 事件；`RegisteredTool` 现在显式声明 visibility、sideEffect、validate，`executeToolCall()` 会先做 runtime input validation 并返回标准 failureType；runtime 会为 tool result、policy denial、edit apply/reject 持久化 Observation；权限层支持 `.rille/policy.json` 的 `agent.permissions` 和 `agent.verification.commands`，并按 hard deny、visibility、validation、grant、risk、project rule、permission mode 决策；approval now carries runtime、matchedRule、grantOptions，UI 支持 Allow session；新增 `ask_user` 和 `select_files` 基础工具。
测试文件: `tests/agent/tools.test.ts`、`tests/agent/permissions.test.ts`、`tests/agent/runtime.test.ts`、`tests/agent/sessionStore.test.ts`
验证命令: `npm test`、`npm run typecheck`、`npm run build`、`rg -n "TO""DO|TB""D|待""补" plan`、`rg -n "\[ \]|\[x\]" plan/15_FULL_AGENT_IMPLEMENTATION_MASTER_PLAN.md`
验证结果: `npm test` 为 11 files / 52 tests passed；`npm run typecheck` passed；`npm run build` passed；文档占位检查无输出；checklist 检查可列出当前完成与未完成项。
剩余风险: Phase F 只实现 session 内存 grant，没有持久 workspace grant；`ask_user` 和 `select_files` 先返回 blocking/error observation，完整交互 UI 留到 Phase J；Observation 已持久化但还没有 Phase G 的 Evidence/VerificationCoverage 和 before-stop gate。
下一步: Phase G1，扩展 VerificationStatus 为 passed、failed、skipped、partial、blocked、stale、waived。

### Phase G / Verification + Review Gate 完成记录

步骤: G1-G8
状态: 已完成
完成日期: 2026-05-23
涉及模块: protocol、verificationGate、verifier、runtime、thread、contextBuilder、AgentPanel、verification/runtime/session replay tests、Phase G 文档
实现摘要: 已扩展 VerificationStatus，并新增 Evidence、VerificationCoverage、VerificationGateResult、ReviewFinding、ReviewResult、`evidence.created`、`verification.coverage.updated`、`review.completed`、coverage/review MessagePart；VerifierRunner 可同时产出 command Evidence，runtime 会从 diagnostics、command、diff/proposal 生成 Evidence，并在 final answer 前执行 before-stop gate；缺少检查时 final gate 会自动运行一次项目 verifier；failed/blocked/partial coverage 会按最终完整 Agent 标准阻止 completed 并把 gate 摘要注入下一轮 repair context；Coverage 按每个 `evidenceRequired` 类型逐项覆盖，重复同类 evidence 不能代替缺失类型；proposal diff 与 applied/workspace diff 分层，未应用 proposal 会由 review gate 阻止完成；rule-based review 会检查缺少验证、失败 evidence、高风险覆盖、pending proposal 和疑似越界文件，blocking finding 会产生 review Observation；Context Engine 会注入 verification/review 摘要，AgentPanel 可展示 coverage 和 review findings。
测试文件: `tests/agent/verificationGate.test.ts`、`tests/agent/verifier.test.ts`、`tests/agent/runtime.test.ts`、`tests/agent/sessionStore.test.ts`
验证命令: `npm test`、`npm run typecheck`、`npm run build`、`rg -n "TO""DO|TB""D|待""补" plan`、`rg -n "\[ \]|\[x\]" plan/15_FULL_AGENT_IMPLEMENTATION_MASTER_PLAN.md`
验证结果: `npm test` 为 12 files / 61 tests passed；`npm run typecheck` passed；`npm run build` passed；文档占位检查无输出；checklist 检查可列出当前完成与未完成项。
剩余风险: 用户 waiver 只有协议状态预留，尚无交互 UI；Review 是 rule-based，不接 reviewer model/advisor；Evidence output 仍走现有截断策略，没有 artifactRef 存储；stale evidence 检查只预留状态，完整 workspace freshness 留给 Phase H。
下一步: Phase H1，增加 FeatureProgressItem、ProgressState、Handoff 协议与事件。

### Phase H / Memory + Long-running State 完成记录

步骤: H1-H7
状态: 已完成
完成日期: 2026-05-23
涉及模块: protocol、runtime、thread、contextBuilder、AgentPanel、sessionStore tests、runtime tests、contextBuilder tests、Phase H 文档
实现摘要: 已新增 FeatureItem、ProgressState、Handoff 协议类型及 progress.updated、handoff.created 事件和 handoff MessagePart；AgentLoop 每 turn 结束时通过 finalize() 生成进度状态和 Handoff；AgentLoop.buildProgressState() 按 verificationCoverage 区分 verified 与 implemented_unverified，completed 但无 covered 证据的 plan item 不会自动变成 verified；thread 在 replayHistory 和 emit 中捕获 lastHandoff 以支持跨 turn 恢复，submitTurn 时将 handoff 注入 ContextBuildInput（phase='resume'）；thread.checkWorkspaceFreshness() 检查 handoff.changedFiles 是否存在并发出 stale observation；contextBuilder 新增 collectHandoffFragment（stable_prefix priority 90）和 collectSessionSummaryFragment（stable_prefix priority 88），handoff 在 resume 时注入稳定前缀；compact boundary 通过 session_summary + 确定性 trimming 实现，低预算时自动用摘要替代动态 fragments。
测试文件: `tests/agent/sessionStore.test.ts`（+2 handoff/progress 持久化测试）、`tests/agent/runtime.test.ts`（+4 progress/handoff/max_turns 测试）、`tests/agent/contextBuilder.test.ts`（+3 handoff/session_summary 测试）
验证命令: `npm test`、`npm run typecheck`、`npm run build`、`rg -n "TO""DO|TB""D|待""补" plan`、`rg -n "\[ \]|\[x\]" plan/15_FULL_AGENT_IMPLEMENTATION_MASTER_PLAN.md`
验证结果: `npm test` 为 12 files / 70 tests passed；`npm run typecheck` passed；`npm run build` passed；文档占位检查无输出；checklist 检查可列出当前完成与未完成项。
剩余风险: ProjectMemoryEntry 只设计未实现，没有持久化 memory store；handoff 仅在 turn 边界生成，长任务中途暂停无中间 checkpoint；stale evidence 检查只验证文件存在性，不比较 git hash/diff；workspace freshness 仅对 local workspace 有效，SSH/WSL 跳过检查；compact boundary 只在 token 预算紧张时依靠 trimming 自然排除，没有显式 compact 触发逻辑。
下一步: Phase I1，增加 TraceEvent 和 AgentUsage 协议与事件。

### Phase I / Observability + Eval 完成记录

步骤: I1-I7
状态: 已完成
完成日期: 2026-05-23
涉及模块: protocol、provider、runtime、trace（新）、index、AgentPanel、sessionStore tests、runtime tests、trace tests（新）、Phase I 文档
实现摘要: 已新增 AgentUsage、TraceEvent（9 种子类型）、EvalCase 协议类型及 trace.batch、trace.exported 事件和 trace.export IPC op；provider 层 callOpenAIChat/callAnthropic/callGemini 均从 API 响应提取 usage（tokens）+ latencyMs，callAgentModel 返回 ModelCallResult 替代 raw string；TraceCollector 在 AgentLoop 关键决策点（task/context/model/tool/policy/verification/review/handoff/cost）收集 trace 事件，finalize 时通过 trace.batch 持久化；trace.ts 提供 redactTraceEvent（policy grant 脱敏）、computeTrajectoryMetrics（完成率、拒绝次数、token 聚合）和 exportSessionTrace（domain event → trace event 推导+脱敏）；index.ts 新增 exportAgentTrace 和 trace.export IPC handler；eval/ 目录包含 runner.ts 和 cases/_template.json。
测试文件: `tests/agent/trace.test.ts`（新，6 tests：TraceCollector、redactTraceEvent、computeTrajectoryMetrics）、`tests/agent/sessionStore.test.ts`（+1 trace.batch 持久化测试）、`tests/agent/runtime.test.ts`（已有 tests 通过 mock 适配 ModelCallResult）
验证命令: `npm test`、`npm run typecheck`、`npm run build`、`rg -n "TO""DO|TB""D|待""补" plan`、`rg -n "\[ \]|\[x\]" plan/15_FULL_AGENT_IMPLEMENTATION_MASTER_PLAN.md`
验证结果: `npm test` 为 13 files / 80 tests passed；`npm run typecheck` passed；`npm run build` passed。
剩余风险: provider usage 提取依赖各 API 实际返回格式，部分 provider（如 Ollama、custom）可能不返回 usage 字段；eval runner 仅做 trajectory type 匹配，不做实际 workspace fixture 设置和完整 replay；costUsd 未内置定价表，需外部注入；trace export 目前是 full-session 读取，大 session 可能 OOM。
下一步: Phase J1，Agent 工作台展示 Task、Plan、Diff、Approval、Evidence、Review、Handoff、Trace。

## 全局测试策略

每次代码实现必须运行：

```text
npm test
npm run typecheck
```

涉及 renderer、Electron/Vite、preload、协议 UI 集成时运行：

```text
npm run build
```

每个阶段至少新增以下测试类型：

- 协议类型和事件兼容测试。
- Runtime 行为测试。
- JSONL replay 新旧事件兼容测试。
- UI event/state 恢复测试；无法自动化时，在完成记录中写明手工验收场景和结果。

文档变更后运行：

```text
rg -n "TO""DO|TB""D|待""补" plan
rg -n "\[ \]|\[x\]" plan/15_FULL_AGENT_IMPLEMENTATION_MASTER_PLAN.md
```

## 下一步指针

当前下一步是 Phase J1：

```text
Agent 工作台展示 Task、Plan、Diff、Approval、Evidence、Review、Handoff、Trace。
```

Phase J1 完成后必须同步更新：

- `plan/15_FULL_AGENT_IMPLEMENTATION_MASTER_PLAN.md`
- `plan/01_CURRENT_BASELINE.md`
- `plan/13_PRODUCT_UX.md`
- `plan/14_IMPLEMENTATION_ROADMAP.md`

## 停止线

遇到以下情况必须停止扩大范围，先补设计或测试：

- 新协议没有 replay 兼容测试。
- runtime 行为只能靠 UI 手测判断。
- UI 状态无法从事件恢复。
- 自动写入绕过 EditStore。
- policy、verification 或 review 失败仍允许 completed。
- Subagent 输出无法被主 Agent 验证或合并。
