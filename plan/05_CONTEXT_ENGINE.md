# Context Engine 模块设计

## 目标

Context Engine 负责为每一次模型调用构造最合适的工作集。

它解决：

- 把聊天历史、工具输出、文件内容和项目规则无差别塞进 prompt。
- 长会话中旧信息挤掉最新失败 evidence。
- 项目规则、动态状态、工具结果顺序不稳定，破坏缓存和模型行为。
- Memory 或外部内容污染当前判断。

它不解决：

- 不执行工具。
- 不决定模型意图是否合法。
- 不把自己当事实源。
- 不负责长期记忆写入。

## 当前基线

当前 `buildAgentContextPrompt(context)` 会拼接：

- workspace label、kind、path。
- active file、open files、dirty state。
- diagnostics 数量和最多 20 条诊断。
- cursor。
- git status。
- 项目文档片段。

当前缺口：

- 共享协议已经有 `ContextFragment`、`ContextTrace`、`ContextBuildInput`、`ContextBuildResult` 和 `context.built` 事件骨架。
- `buildAgentContext(input)` 已经返回 `ContextBuildResult`，`buildAgentContextPrompt(context)` 作为兼容 wrapper 保留。
- 当前 `buildAgentContext()` 已有 task_contract、plan、workspace、active_editor、open_files、diagnostics、git collectors。
- project rules collector 已按完整读取顺序支持 `AGENTS.md`、`CLAUDE.md`、`RILLE.md`、`.rille/rules.md`、`.rille/rules/*.md`、`README.md`、`.rille/local.md`；`.rille/rules/*.md` 只读取 markdown 并按文件名稳定升序。
- 已实现 stable/dynamic 确定性排序和 budget-aware deterministic trimming，trace 会记录 included 与 excluded。
- 尚未实现 cache key。
- AgentLoop 已直接使用 `ContextBuildResult`，并会在模型调用前持久化 redacted `context.built` summary 和 trace。
- 没有按 phase 组织 context。
- 工具结果不经过 context selection。

## 设计原则

1. Context 是工作集，不是事实源。
2. 不同阶段使用不同上下文策略。
3. stable prefix 和 dynamic suffix 明确分区。
4. token budget 参与选择，而不是最后粗暴截断。
5. Memory 是候选上下文，不默认注入。
6. 外部不可信内容必须标注为 data。

## 核心数据结构

```ts
export type ContextFragmentType =
  | 'system'
  | 'tool_schema'
  | 'project_rules'
  | 'task_contract'
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

export interface ContextFragment {
  id: string
  type: ContextFragmentType
  priority: number
  section: 'stable_prefix' | 'dynamic_suffix'
  source: string
  text: string
  cacheKey?: string
  stale?: boolean
  trusted: boolean
  tokenEstimate?: number
}

export interface ContextBuildInput {
  phase: LoopPhase
  session: AgentSession
  turn: AgentTurn
  taskContract?: TaskContract
  contextSnapshot: AgentContextSnapshot
  observations: Observation[]
  budgetTokens: number
}

export interface ContextBuildResult {
  fragments: ContextFragment[]
  prompt: string
  trace: ContextTrace
}
```

```ts
export interface ContextTrace {
  included: Array<{ id: string; type: ContextFragmentType; source: string; reason: string }>
  excluded: Array<{ id: string; type: ContextFragmentType; source: string; reason: string }>
  totalTokenEstimate: number
  budgetTokens: number
}
```

## 运行流程

```text
Orchestrator requests context for phase
  -> collect candidate fragments
  -> classify stable_prefix / dynamic_suffix
  -> filter by policy and relevance
  -> sort by section, priority, source
  -> trim deterministically
  -> render provider-neutral prompt
  -> emit context trace
```

### 阶段策略

| 阶段 | 优先 fragment |
| --- | --- |
| planning | task_contract、project_rules、workspace、git |
| exploration | search observation、read file refs、hypotheses |
| coding | active_editor、relevant file content、constraints、latest observations |
| repair | failed evidence、related diff、failed attempts、do-not-repeat |
| verification | acceptance criteria、changed files、commands、evidence |
| review | task contract、diff、evidence、risk notes |
| resume | handoff、progress、feature list、workspace freshness |

### 项目规则读取顺序

```text
AGENTS.md
CLAUDE.md
RILLE.md
.rille/rules.md
.rille/rules/*.md
README.md
.rille/local.md
```

`.rille/local.md` 只用于本地上下文，不进入共享 memory。

## 与其他模块关系

- 输入 Task Contract 和当前 phase。
- 读取 Workspace 当前事实。
- 消费 Observation、Evidence、ReviewFinding、Handoff。
- 接受 Policy 对可见内容的过滤。
- 输出 Model Gateway 使用的 prompt 和 fragment trace。
- Product UX 可展示 context chips 和 trace 摘要。

## 实现步骤

1. 新增 `ContextFragment` 和 `ContextBuildResult` 类型。
2. 将现有 `buildAgentContextPrompt` 拆为 `buildAgentContext()` 和兼容 wrapper。
3. 实现 task contract、plan、workspace、active editor、open files、diagnostics、git collectors。
4. 实现 stable prefix / dynamic suffix 初始排序。
5. 增加项目规则读取顺序。
6. 实现 deterministic trimming。
7. 增加 context trace event。
8. 将 tool result 和 verification result 变成 observation fragment。
9. 增加 compact boundary 和 session summary。

## 测试与验收

单元测试：

- fragment 排序稳定。
- 超预算时优先保留 Task Contract 和最新失败 evidence。
- 项目规则读取顺序正确。
- stale memory 不默认注入。
- external/untrusted fragment 被标注。

集成测试：

- repair 阶段 prompt 包含失败命令和相关 diff。
- plan 阶段不注入大量旧 read_file 输出。
- context trace 能说明包含和排除原因。

手工验收：

- 长会话多次读文件后，prompt 不无限膨胀。
- 修改后验证失败，下一轮优先看到失败 evidence。

当前完成记录：

- 2026-05-23：E4 已完成 project rules 完整读取顺序。普通规则文件缺失或读取失败会跳过；`.rille/rules` 缺失或不可读会跳过；目录内只读取 `.md` 文件并排序；fragment source 保留实际命中文件路径。剩余 E5-E8：deterministic trimming、AgentLoop context trace event、observation/evidence fragments、compact boundary。
- 2026-05-23：E5 已完成 stable_prefix / dynamic_suffix 确定性排序与 budget-aware trimming。排序规则为 section、priority、source、id；预算耗尽时低优先级 fragment 进入 trace excluded；极小预算保留最高优先级 fragment，避免空 prompt。剩余 E6-E8：AgentLoop context trace event、observation/evidence fragments、compact boundary。
- 2026-05-23：E6-E8 已完成 Phase E 收口。AgentLoop 使用 `ContextBuildResult.prompt` 调用模型，并在模型调用前持久化 `context.built`；trace 只保存 fragment 元数据，不保存完整 prompt 或 fragment text。剩余 observation/evidence/review fragments 和 compact boundary 分别进入 Phase F/G/H。

## 反模式

- 直接拼接完整历史。
- 把 RAG 当 Context Engine。
- 把所有 memory 默认塞进 prompt。
- 频繁改变工具 schema 控制模型。
- 最后一步才截断字符串。
