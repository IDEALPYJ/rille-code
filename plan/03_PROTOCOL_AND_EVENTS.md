# V2 协议与事件规划

## 设计原则

1. 协议先描述目标完全体，代码可分阶段落地。
2. Event log 是可恢复事实源，MessagePart 是用户可见投影。
3. TraceEvent 是 debug/eval 投影，不替代 domain event。
4. 大文本、大 diff、大命令输出、大截图走 ArtifactRef。
5. 新事件必须可 replay，旧事件必须可兼容。

## 核心对象

### Session / Turn

```ts
interface AgentSession {
  id: string
  title: string
  workspace: AgentWorkspaceLocation
  status: 'idle' | 'running' | 'waiting_approval' | 'blocked' | 'completed' | 'archived'
  createdAt: number
  updatedAt: number
}

interface AgentTurn {
  id: string
  sessionId: string
  text: string
  status: 'active' | 'completed' | 'blocked' | 'cancelled'
  stopReason?: TurnStopReason
  createdAt: number
}
```

当前状态：已实现核心形态。

### Task / Plan

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
}

interface AgentPlanItem {
  id: string
  title: string
  status: 'pending' | 'in_progress' | 'completed' | 'blocked' | 'skipped'
  evidence?: string
}
```

当前状态：部分实现；缺用户确认 gate 和 plan-only mode 完整 UX。

### Model Stream

```ts
type ModelStreamDelta =
  | { type: 'model.text.delta'; sessionId: string; turnId: string; text: string; createdAt: number }
  | { type: 'model.reasoning.delta'; sessionId: string; turnId: string; text: string; createdAt: number }
  | { type: 'model.tool_call.started'; sessionId: string; turnId: string; callId: string; name: string; createdAt: number }
  | { type: 'model.tool_call.delta'; sessionId: string; turnId: string; callId: string; partialInput: string; createdAt: number }
  | { type: 'model.completed'; sessionId: string; turnId: string; usage?: AgentUsage; createdAt: number }
```

当前状态：已实现。Runtime 内部消费 `model.text.delta`、`model.reasoning.delta`、`model.tool_call.delta`、`model.completed`、`model.failed`；OpenAI Responses SSE 已映射到统一事件，renderer 仍只消费 AgentEvent/MessagePart 投影。

### Tool / Observation / Artifact

```ts
interface AgentToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  visibility: 'model' | 'runtime' | 'ui'
  sideEffect: 'none' | 'workspace_read' | 'workspace_write' | 'process' | 'network' | 'external'
  deferred?: boolean
  category?: string
  keywords?: string[]
  activationHint?: string
}

interface Observation {
  id: string
  source: 'tool' | 'policy' | 'edit' | 'verification' | 'review' | 'user' | 'runtime'
  status: 'ok' | 'error' | 'denied' | 'blocked' | 'stale'
  summary: string
  data?: Record<string, unknown>
  artifactRef?: string
}

interface ArtifactRef {
  id: string
  kind: 'command_output' | 'diff' | 'snapshot' | 'trace' | 'screenshot' | 'file_excerpt'
  uri: string
  sizeBytes: number
  redacted: boolean
  createdAt: number
}
```

当前状态：已实现。Tool/Observation/ArtifactRef、deferred tool search、组合工具和 artifact-backed 输出均已落地。

### Policy / Grant / Sandbox

```ts
interface PolicyDecision {
  action: 'allow' | 'ask' | 'deny'
  risk: 'low' | 'medium' | 'high' | 'critical'
  reason: string
  matchedRule?: string
  grant?: PermissionGrant
  guardian?: GuardianDecision
  commandSubject?: CommandSubject
  sandboxRequired?: boolean
}

interface PermissionGrant {
  id: string
  scope: 'once' | 'session' | 'workspace'
  permission: PolicyPermission
  pattern: string
  expiresAt?: number
}

interface ExecutionSandbox {
  id: string
  kind: 'none' | 'worktree' | 'os_sandbox' | 'remote'
  workspacePath: string
  isolation: 'advisory' | 'filesystem' | 'process' | 'network'
}
```

当前状态：已实现。once/session/workspace grant、persistent workspace grant、Guardian/classifier、BashArity-aware subject、sandboxRequired policy 和 worktree sandbox 均已落地。

### Evidence / Review

```ts
interface Evidence {
  id: string
  source: 'command' | 'diagnostics' | 'diff' | 'review' | 'browser' | 'user'
  status: 'passed' | 'failed' | 'partial' | 'blocked' | 'stale' | 'waived'
  summary: string
  artifactRef?: string
}

interface ReviewFinding {
  id: string
  source?: 'rule' | 'llm' | 'subagent'
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical'
  category: 'scope' | 'architecture' | 'behavior' | 'security' | 'testing' | 'maintainability' | 'evidence'
  blocking: boolean
  title: string
  body: string
}
```

当前状态：部分实现；browser/manual evidence、waiver UI、reviewer subagent 未实现。

### Memory / Compaction / Handoff

```ts
interface ProjectMemoryEntry {
  id: string
  kind: 'command' | 'convention' | 'decision' | 'known_issue' | 'workflow' | 'handoff'
  text: string
  sourceRefs: string[]
  status: 'active' | 'stale' | 'superseded' | 'conflict'
}

interface ContextCompactionResult {
  id: string
  kind: 'micro' | 'session_summary' | 'remote_compact'
  preservedRefs: string[]
  summary: string
  boundaryEventId: string
  tokenBefore: number
  tokenAfter: number
}
```

当前状态：ProjectMemory MVP 部分实现，explicit compaction event 未实现。

### Subagent / Advisor

```ts
interface SubagentContract {
  id: string
  role: 'explorer' | 'reviewer' | 'verifier' | 'advisor'
  goal: string
  permissions: 'read_only' | 'verify_only' | 'review_only' | 'advisory_only'
  allowedTools: string[]
  outputSchema: string
}

interface SubagentResult {
  id: string
  contractId: string
  status: 'completed' | 'failed' | 'blocked'
  summary: string
  findings?: ReviewFinding[]
  evidence?: Evidence[]
  artifactRefs?: string[]
}
```

当前状态：未实现。

## 事件族

V2 事件应覆盖：

- `session.created/updated/archived`
- `turn.submitted/completed/blocked/cancelled`
- `message.part.created/updated`
- `task_contract.created/updated/confirmed`
- `plan.updated`
- `context.built/compacted`
- `model.delta/model.completed/model.failed`
- `tool.started/completed/failed`
- `policy.decided/approval.requested/approval.resolved`
- `artifact.created`
- `checkpoint.created/restored`
- `evidence.created`
- `verification.coverage.updated`
- `review.completed`
- `handoff.created`
- `memory.created/updated`
- `trace.batch/exported`
- `eval.started/completed`
- `subagent.started/completed/failed`

## MessagePart 投影

MessagePart 用于 UI 展示：

- `text`
- `stage`
- `task_contract`
- `plan`
- `tool_group`
- `approval`
- `edit_proposal`
- `edit_result`
- `evidence_coverage`
- `review`
- `handoff`
- `trace_summary`
- `subagent`
- `streaming_text`
- `artifact`

当前状态：已有大部分基础 part，缺 streaming、artifact、subagent、rich trace summary。
