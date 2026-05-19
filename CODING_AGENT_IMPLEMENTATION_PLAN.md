# RilleCode Coding Agent 完整实现方案

本文档是 RilleCode 后续实现 Coding Agent 的施工蓝图。目标不是先做一个聊天面板，而是把 Agent 做成 IDE 内部的一套可审计、可回滚、可扩展的运行时系统：前端负责上下文呈现、审批、diff review 和用户控制；后端负责 Agent loop、工具执行、权限、安全、持久化和模型适配。

## 1. 产品目标

### 1.1 核心定位

RilleCode 的 Coding Agent 应该是一个 IDE-native agent：

- 能理解当前工作区、打开文件、选区、Git 状态、终端输出、诊断信息。
- 能通过工具逐步读代码、搜索、修改、运行命令、查看结果并继续修复。
- 所有写入和高风险命令都可审批、可预览、可撤销。
- 支持本地、WSL、SSH 工作区，复用现有文件、Git、终端和远程能力。
- 后续可扩展到 MCP、后台任务、子 Agent、多模型和第三方 CLI harness。

### 1.2 第一性原则

1. Agent loop 要薄，系统边界要厚：模型负责推理，RilleCode runtime 负责执行、安全和状态。
2. 所有能力都通过结构化 tool 暴露，不让模型直接碰文件系统或 shell。
3. 默认安全姿态是 ask/deny-first，高风险操作必须有人或独立审查器放行。
4. IDE 上下文是优势：编辑器、LSP、Git diff、终端、远程会话都应进入 Agent 的观察闭环。
5. 每次变更必须可以解释、预览、应用、回滚。
6. 前端不是日志窗口，而是 Agent 的控制台：用户能看见它在做什么、为什么做、卡在哪里。

## 2. 总体架构

### 2.1 分层结构

```text
Renderer UI
  AgentPanel / Timeline / ApprovalCard / DiffReview / ContextBar
        |
        | Electron IPC: Submission Queue + Event Queue
        v
Main Process Agent Runtime
  AgentThread / AgentLoop / ContextBuilder / PermissionEngine
        |
        +-- ToolRegistry
        |     read_file / search / git / propose_edit / apply_edit / run_command / diagnostics
        |
        +-- LLMProvider
        |     OpenAI-compatible / Anthropic / DeepSeek / local future
        |
        +-- Persistence
        |     sessions / turns / message parts / snapshots / jobs
        |
        +-- Execution Backends
              local fs / WSL / SSH remote / terminal / git / LSP future
```

### 2.2 推荐文件结构

先在当前单包项目内落地，不急着拆 monorepo：

```text
src/shared/agent/
  protocol.ts              # IPC Op/Event、message part、tool schema、session 类型
  permissions.ts           # 共享权限类型
  context.ts               # 共享 context fragment 类型

src/main/agent/
  index.ts                 # agent IPC handler 注册入口
  thread.ts                # AgentThread: SQ/EQ、turn 生命周期、中断
  runtime.ts               # Agent 主循环
  state.ts                 # 不可变 loop state、turn transition、终止原因
  contextBuilder.ts        # 上下文组装
  llm/
    provider.ts            # LLMProvider 接口
    openaiCompatible.ts    # OpenAI/DeepSeek 兼容协议
    anthropic.ts           # Anthropic future
  tools/
    registry.ts            # ToolRegistry
    fileTools.ts
    searchTools.ts
    gitTools.ts
    editTools.ts
    commandTools.ts
    diagnosticTools.ts
    ideTools.ts
  permissions/
    engine.ts              # allow/ask/deny 决策
    commandPolicy.ts       # 命令风险与 BashArity 简化版
    denialTracker.ts
    guardian.ts            # 第二意见审查 future
  exec/
    commandRunner.ts       # 统一命令执行
    outputCapture.ts
  persistence/
    sessionStore.ts        # JSONL 或 SQLite
    snapshotStore.ts       # side-git/file snapshot
    jobStore.ts

src/renderer/agent/
  store.ts                 # Agent UI 状态
  client.ts                # IPC client
  types.ts

src/renderer/components/agent/
  AgentPanel.tsx
  AgentTimeline.tsx
  AgentComposer.tsx
  ContextBar.tsx
  ApprovalCard.tsx
  AgentDiffReview.tsx
  ToolCallCard.tsx
  AgentSessionList.tsx
```

## 3. IPC 协议设计

### 3.1 SQ/EQ 双通道

借鉴 Codex 的 Submission Queue/Event Queue。Renderer 只提交操作，Main 通过事件流推送状态。

Submission Queue:

```ts
type AgentOp =
  | { type: 'session.create'; workspace: WorkspaceLocation | null }
  | { type: 'session.resume'; sessionId: string }
  | { type: 'turn.submit'; sessionId: string; text: string; contextHints?: ContextHint[] }
  | { type: 'turn.interrupt'; sessionId: string; turnId: string }
  | { type: 'approval.respond'; requestId: string; decision: ApprovalDecision }
  | { type: 'edit.apply'; proposalId: string }
  | { type: 'edit.reject'; proposalId: string }
  | { type: 'permission.update'; update: PermissionUpdate }
```

Event Queue:

```ts
type AgentEvent =
  | { type: 'session.created'; session: AgentSession }
  | { type: 'turn.started'; sessionId: string; turn: AgentTurn }
  | { type: 'message.part.created'; part: MessagePart }
  | { type: 'message.part.updated'; part: MessagePart }
  | { type: 'tool.started'; call: ToolCallView }
  | { type: 'tool.completed'; callId: string; result: ToolResultView }
  | { type: 'approval.requested'; request: ApprovalRequest }
  | { type: 'edit.proposed'; proposal: EditProposal }
  | { type: 'diagnostics.updated'; diagnostics: AgentDiagnostic[] }
  | { type: 'turn.completed'; turnId: string; reason: TurnStopReason; usage?: TokenUsage }
  | { type: 'turn.failed'; turnId: string; reason: TurnStopReason; error: string }
```

### 3.2 Part-based 消息

不要只存一条 markdown 字符串。采用 OpenCode 风格的 message part，便于工具状态异步更新。

```ts
type MessagePart =
  | { id: string; messageId: string; type: 'text'; role: 'user' | 'assistant' | 'system'; text: string }
  | { id: string; messageId: string; type: 'reasoning'; text: string; redacted?: boolean }
  | { id: string; messageId: string; type: 'tool'; call: ToolCallView; state: ToolState; output?: ToolResultView }
  | { id: string; messageId: string; type: 'file'; filePath: string; range?: TextRange; label: string }
  | { id: string; messageId: string; type: 'diff'; proposalId: string; title: string; state: EditProposalState }
  | { id: string; messageId: string; type: 'diagnostic'; diagnostics: AgentDiagnostic[] }
```

前端 timeline 渲染这些 part，而不是解析 assistant 文本里的伪标签。

## 4. 后端 Agent Runtime

### 4.1 AgentThread

`AgentThread` 是每个会话的运行容器：

- 持有配置快照、workspace、session id。
- 接收 `AgentOp`，发送 `AgentEvent`。
- 同一 session 同一时间只运行一个 mutating turn。
- 支持 interrupt：中断模型流、正在执行的工具、命令子进程。
- 支持 resume：从 session store 恢复 transcript 和摘要。

核心状态：

```ts
interface AgentThreadState {
  sessionId: string
  workspace: WorkspaceLocation | null
  status: 'idle' | 'running' | 'waiting_approval' | 'interrupted' | 'error'
  activeTurnId?: string
  config: AgentConfigSnapshot
  permissionMode: PermissionMode
  abortController?: AbortController
}
```

### 4.2 AgentLoop

每个用户请求进入一个逐步循环：

```text
while turn not done:
  1. build context
  2. compact or trim if needed
  3. call model streaming
  4. collect text parts and tool calls
  5. permission check each tool call
  6. execute approved tools
  7. append tool results
  8. stop if no follow-up tool call
```

不要做“一次性完整计划然后批量执行”。工具结果、命令输出、诊断和 diff 都是下一步推理的新信息。

### 4.3 Loop State

Loop state 使用不可变更新，并记录继续原因：

```ts
interface AgentLoopState {
  turnId: string
  iteration: number
  messages: AgentMessage[]
  compactBoundaries: CompactBoundary[]
  pendingApprovals: ApprovalRequest[]
  denialTracker: DenialTrackerState
  tokenBudget: TokenBudgetState
  transition?: TurnTransition
}

type TurnTransition =
  | { type: 'user_turn_started' }
  | { type: 'tool_results_observed' }
  | { type: 'approval_denied_retry' }
  | { type: 'diagnostics_injected' }
  | { type: 'context_compacted' }
  | { type: 'model_retry' }
```

### 4.4 终止原因

终止原因必须类型化，方便 UI 和调试：

```ts
type TurnStopReason =
  | 'completed'
  | 'interrupted'
  | 'max_turns'
  | 'permission_denied'
  | 'permission_denied_loop'
  | 'tool_failed'
  | 'tool_timeout'
  | 'command_timeout'
  | 'model_error'
  | 'model_context_overflow'
  | 'approval_timeout'
```

## 5. Tool Registry

### 5.1 Tool 接口

```ts
interface AgentTool<TInput = unknown, TOutput = unknown> {
  name: string
  title: string
  description: string
  inputSchema: JsonSchema
  isReadOnly: boolean
  isMutating: boolean
  supportsParallel: boolean
  defaultTimeoutMs: number
  outputLimitBytes: number
  risk: 'low' | 'medium' | 'high' | 'critical'
  permission: (input: TInput, context: ToolPermissionContext) => PermissionPattern
  execute: (input: TInput, context: ToolExecutionContext) => Promise<TOutput>
  renderSummary?: (input: TInput) => string
}
```

Tool registry 每轮动态组装：

- Core tools 永远可用：读文件、列目录、搜索、查看 Git、提出编辑。
- Deferred tools 按任务注入：终端、远程、Git 写操作、LSP、MCP。
- Plan Mode 只暴露只读工具和 `exit_plan_mode`。

### 5.2 第一批工具

只读工具：

- `list_directory`
- `read_file`
- `search_files`
- `git_status`
- `git_diff`
- `read_diagnostics`
- `get_open_files`
- `get_active_editor`

变更工具：

- `propose_file_edit`：生成编辑提案，不写盘。
- `apply_file_edit`：应用已批准的编辑提案。
- `create_file`
- `delete_file`：高风险，默认 ask。
- `rename_file`

命令工具：

- `run_command`：非交互命令，统一 timeout/output cap。
- `run_terminal_command`：未来接入 PTY/长期运行任务。

IDE 工具：

- `open_file`
- `reveal_range`
- `show_diff`
- `show_diagnostics`

### 5.3 工具并行控制

- 只读工具可并行执行。
- 写文件、Git 写操作、命令执行默认串行。
- 同一文件的 edit proposal 必须串行，避免 patch 交错。
- `run_command` 和 `apply_file_edit` 不能并行，除非命令明确只读。

## 6. 权限与安全

### 6.1 权限模式

```ts
type PermissionMode =
  | 'plan'          // 只读探索
  | 'ask'           // 默认，写操作和未知命令询问
  | 'accept_edits'  // 工作区文件编辑可快速批准，命令仍询问
  | 'auto'          // 低风险自动，高风险询问或 Guardian
  | 'bypass'        // 显式危险模式，后续再做
```

### 6.2 权限决策

```ts
type PermissionDecision =
  | { action: 'allow'; reason: string }
  | { action: 'ask'; reason: string; request: ApprovalRequest }
  | { action: 'deny'; reason: string }
```

决策顺序：

1. 内置 critical deny：工作区外写文件、删除根目录、危险 shell。
2. Project/user/session rules。
3. Tool 自身权限逻辑。
4. Permission mode 默认行为。
5. Guardian future：高风险操作第二意见。
6. DenialTracker：连续被拒后中断 turn。

### 6.3 规则格式

建议先使用 JSON，后续可支持 `.rille/config.json`：

```json
{
  "agent": {
    "permissions": [
      { "permission": "file.read", "pattern": "**", "action": "allow" },
      { "permission": "file.write", "pattern": "src/**", "action": "ask" },
      { "permission": "command.run", "pattern": "git status *", "action": "allow" },
      { "permission": "command.run", "pattern": "git push *", "action": "ask" },
      { "permission": "command.run", "pattern": "rm *", "action": "deny" }
    ]
  }
}
```

### 6.4 命令安全

`run_command` 必须经过统一执行层：

- 默认超时：120 秒。
- 默认输出上限：50 KB。
- 超时后 terminate，等待 5 秒再 kill。
- 输出必须标记 `truncated`。
- 禁止隐式 shell expansion，优先 `command + args`。
- 如果必须用 shell，记录原始命令并做风险分析。
- 命令权限不能只看第一个 token，要识别 `git status`、`npm test` 这种子命令。

第一版 BashArity 可做简化：

- 解析 shell words，识别第一个命令和常见二级子命令。
- `git status` 不匹配 `git push`。
- `npm test` 不匹配 `npm publish`。
- 含 `>`, `>>`, `|`, `&&`, `;`, backtick, `$()` 的命令提高风险级别。

### 6.5 Denial Tracking

防止模型被拒后反复请求同一操作：

```ts
const DENIAL_LIMITS = {
  maxConsecutiveSamePattern: 3,
  maxTotalPerTurn: 20
}
```

达到阈值后中断 turn，并向 UI 展示“Agent 重复请求被拒操作，已停止”。

## 7. 上下文构建

### 7.1 Context Fragment

上下文不要拼一大坨字符串，使用 fragment：

```ts
type ContextFragment =
  | { type: 'system'; priority: number; text: string; cacheKey?: string }
  | { type: 'project_rules'; priority: number; source: string; text: string }
  | { type: 'workspace'; priority: number; tree: string; gitSummary?: string }
  | { type: 'active_editor'; priority: number; filePath: string; content: string; selection?: string }
  | { type: 'open_files'; priority: number; files: ContextFile[] }
  | { type: 'diagnostics'; priority: number; diagnostics: AgentDiagnostic[] }
  | { type: 'tool_result'; priority: number; callId: string; text: string }
  | { type: 'session_summary'; priority: number; text: string }
```

### 7.2 注入优先级

1. System/developer instruction。
2. 用户当前请求。
3. 当前活动文件和选区。
4. 已打开文件。
5. Git status/diff summary。
6. LSP/TypeScript diagnostics。
7. 项目规则：`AGENTS.md`、`RILLE.md`、`.rille/rules.md`。
8. 最近工具结果。
9. 工作区文件树摘要。
10. 历史摘要。

### 7.3 项目规则

按顺序读取：

- 工作区根目录 `AGENTS.md`
- 工作区根目录 `RILLE.md`
- `.rille/rules.md`
- `.rille/rules/*.md`
- 本地私有 `.rille/local.md`，默认加入 `.gitignore`

规则文件是透明、可版本控制的，比隐藏数据库更适合项目约定。

### 7.4 压缩策略

第一版先做低成本压缩：

- 单个工具输出超过限制，保留头尾并标记截断。
- 搜索结果只保留前 N 个和统计信息。
- 旧的 read_file 结果替换为占位符。
- 保留 tool call/result 配对，不破坏消息结构。

第二版再做 session summary：

- 当估算 token 超过阈值，调用模型总结旧历史。
- 插入 compact boundary。
- 压缩后重新注入当前打开文件、规则、诊断和 Git 状态。

## 8. 编辑与 Diff 应用

### 8.1 只通过提案改文件

模型不能直接写文件。流程：

```text
propose_file_edit
  -> 生成 EditProposal
  -> Renderer 显示 Monaco Diff
  -> 用户 Apply/Reject
  -> apply_file_edit 写盘
  -> 刷新文件树/open file
  -> 读取 diagnostics
  -> Agent 继续
```

### 8.2 EditProposal

```ts
interface EditProposal {
  id: string
  sessionId: string
  turnId: string
  title: string
  filePath: string
  originalContent: string
  modifiedContent: string
  rationale?: string
  state: 'pending' | 'applied' | 'rejected' | 'conflicted'
  createdAt: number
}
```

### 8.3 冲突处理

应用前检查：

- 文件当前内容是否等于 proposal 的 originalContent。
- 如果不等，进入 `conflicted`。
- UI 提供三种操作：打开当前 diff、重新生成、强制覆盖。

## 9. 持久化与回滚

### 9.1 存储选择

第一版建议 JSONL，简单透明：

```text
.rille/agent/
  sessions/
    <session-id>.jsonl
    <session-id>.meta.json
  snapshots/
    <snapshot-id>/
```

后续当 session、job、part 查询复杂后迁移 SQLite。

### 9.2 Session 内容

每个事件 append-only 写入：

- session metadata
- user message
- assistant text part
- tool call
- tool result
- approval request/decision
- edit proposal
- diagnostics snapshot
- turn completed

### 9.3 Snapshot

第一版文件快照：

- turn 开始前记录将要修改文件的原文。
- apply edit 后记录 modifiedContent。
- 支持按 proposal 回滚。

第二版 side-git：

- 在 `.rille/agent/snapshots.git` 或 app data 中维护独立 git。
- 每个 turn 前后 commit。
- 不污染用户项目 `.git`。

## 10. LLM Provider

### 10.1 Provider 接口

```ts
interface LLMProvider {
  id: string
  displayName: string
  supportsTools: boolean
  supportsReasoning: boolean
  countTokens?(input: ModelInput): Promise<number>
  streamChat(input: ModelInput, signal: AbortSignal): AsyncIterable<ModelStreamEvent>
}
```

第一版优先 OpenAI-compatible：

- OpenAI
- DeepSeek
- 其他兼容 `/chat/completions` 或 Responses-style 的服务

### 10.2 配置

```json
{
  "agent": {
    "provider": "openai-compatible",
    "model": "gpt-5.4",
    "baseUrl": "https://api.openai.com/v1",
    "apiKeyEnv": "OPENAI_API_KEY",
    "maxTurns": 30,
    "maxOutputTokens": 8192
  }
}
```

API key 不写项目配置。只允许：

- 环境变量。
- 用户本机 app config。
- 系统 keychain future。

## 11. 前端交互设计

### 11.1 Agent Panel 布局

右侧 Agent 面板分四块：

```text
┌────────────────────────────┐
│ Context Bar                │ 当前文件/选区/Git/模式
├────────────────────────────┤
│ Timeline                   │ 消息、工具、审批、diff、诊断
│                            │
├────────────────────────────┤
│ Composer                   │ 输入框 + 附件 + 模式选择
└────────────────────────────┘
```

当前 `App.tsx` 已有 `agent-panel` 占位，可以替换为真实组件。

### 11.2 Context Bar

显示 Agent 当前能看到什么：

- Workspace 名称。
- 活动文件。
- 是否包含选区。
- Git dirty count。
- Diagnostics count。
- Permission mode。
- Model。

交互：

- 点击活动文件 chip 可切换是否附加当前文件。
- 点击 Git chip 打开 Git 面板。
- 点击 Diagnostics chip 打开 Problems。
- 模式选择：Plan / Ask / Accept Edits / Auto。

### 11.3 Timeline

Timeline 使用 message parts 渲染：

- User message：普通气泡。
- Assistant text：markdown。
- Tool call：紧凑卡片，显示工具名、目标、耗时、状态。
- Approval request：醒目的审批卡。
- Diff proposal：文件名、增删行、Review 按钮。
- Diagnostics：错误/警告摘要，可点击跳转。

工具卡片状态：

```text
pending -> running -> completed
                  -> failed
                  -> cancelled
                  -> waiting_approval
```

### 11.4 Composer

功能：

- 多行输入。
- `@file` 引用打开文件或搜索文件。
- `#selection` 自动引用当前选区。
- `/plan` 进入 Plan Mode。
- `/agent` 普通执行。
- `/fix` 针对当前 diagnostics。
- 停止按钮：turn running 时替代发送按钮。

提交前展示简短上下文提示：

```text
Using: current file, 3 open files, git status, 5 diagnostics
```

### 11.5 审批卡

审批卡必须让用户快速判断风险：

内容：

- 工具名称。
- 操作目标：文件路径或命令。
- 风险等级。
- Agent 理由。
- 权限命中原因。
- 对文件写入显示 diff 摘要。
- 对命令显示 cwd、timeout、是否 shell、是否有重定向/管道。

按钮：

- Allow once
- Always allow pattern
- Deny
- Deny and tell agent why
- Open details

高风险命令不提供 Always allow，或需要二次确认。

### 11.6 Diff Review

复用已有 Monaco diff 经验，提供：

- Side-by-side / inline 切换 future。
- Apply file。
- Reject。
- Apply all pending edits。
- 逐文件 review。
- 冲突状态提示。
- 应用后自动打开修改文件。

### 11.7 运行中反馈

用户不应该看到“卡住的转圈”。每个阶段都要有事件：

- 正在构建上下文。
- 正在调用模型。
- 正在读取文件。
- 正在搜索。
- 等待权限。
- 正在运行命令，显示已用时间。
- 正在检查诊断。
- 已完成，显示验证结果。

## 12. 后台任务与 JobManager

第一版 turn 是前台任务。第二版加入 JobManager：

```ts
interface AgentJob {
  id: string
  sessionId: string
  title: string
  status: 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'
  progress: number
  attempts: number
  maxAttempts: number
  createdAt: number
  updatedAt: number
}
```

适用场景：

- 长时间测试。
- 大规模重构。
- 后台扫描 diagnostics。
- 定时检查 PR/issue future。

重启恢复策略：

- Running/Queued 任务恢复为 Queued。
- 最多重试 3 次。
- 指数退避：500ms、1000ms、2000ms。

## 13. 远程工作区支持

RilleCode 已有 SSH/WSL remote abstraction，Agent tool 必须接受 `WorkspaceLocation`：

- local：直接 fs/git/spawn。
- wsl：通过 WSL profile 或现有 remote runtime 执行。
- ssh：通过 remote RPC 读写/执行。

要求：

- UI 明确显示 Agent 当前操作的是 local/wsL/ssh。
- 远程命令审批显示 host label。
- API key 只在本地 main process 使用，除非用户显式配置 remote provider。

## 14. MCP 与第三方 Harness 预留

### 14.1 MCP

后续加入：

- `.rille/mcp.json`
- 模板变量：`${workspaceRoot}`、`${env:KEY}`
- 文件监听热加载。
- MCP tools 进入 ToolRegistry，但必须经过同一 PermissionEngine。

### 14.2 Harness

学习 Warp，为第三方 CLI 预留统一接口：

```ts
interface AgentHarness {
  id: 'rille-native' | 'claude-code' | 'codex' | 'opencode'
  validate(): Promise<HarnessValidation>
  start(input: HarnessStartInput): AsyncIterable<AgentEvent>
  resume?(payload: unknown): AsyncIterable<AgentEvent>
  interrupt?(): Promise<void>
}
```

Rille native 是主线；第三方 harness 作为高级功能，不阻塞 MVP。

## 15. 实施路线图

### Phase 0: 设计落地

- [ ] 新增 shared agent protocol 类型。
- [ ] 注册 agent IPC channel。
- [ ] 替换右侧占位 Agent UI 为基础面板。

验收：

- 前端能创建 session。
- Main 能推送 mock timeline events。

### Phase 1: 只读 Agent

- [ ] AgentThread + SQ/EQ。
- [ ] AgentLoop 最小循环。
- [ ] OpenAI-compatible provider。
- [ ] `read_file`、`list_directory`、`search_files`、`git_status`、`git_diff`。
- [ ] ContextBuilder 注入活动文件、打开文件、Git 状态。

验收：

- 用户问“解释当前文件”，Agent 能读上下文并回答。
- 用户问“搜索某函数”，Agent 调 search tool 并总结结果。
- 无任何写文件能力。

### Phase 2: Diff-only 编辑

- [ ] `propose_file_edit`。
- [ ] EditProposal store。
- [ ] AgentDiffReview UI。
- [ ] `apply_file_edit` 只应用已批准 proposal。
- [ ] 文件内容刷新和 dirty state 同步。

验收：

- 用户要求修改文件，Agent 只能生成 diff。
- 用户批准后才写盘。
- 拒绝后 Agent 能收到拒绝反馈并换策略。

### Phase 3: 命令执行

- [ ] CommandRunner。
- [ ] timeout/output cap/truncated 标记。
- [ ] PermissionEngine command rules。
- [ ] ApprovalCard for command。
- [ ] 命令结果注入下一轮。

验收：

- Agent 可运行 `npm test` 或 `npm run typecheck`。
- 未信任命令弹审批。
- 超时能停止，UI 显示部分输出。

### Phase 4: 诊断闭环

- [ ] `read_diagnostics` 从 renderer/editor state 或 main LSP future 读取。
- [ ] 编辑应用后自动请求 diagnostics。
- [ ] diagnostics part 注入下一轮。
- [ ] Problems 面板和 Agent timeline 可互相跳转。

验收：

- Agent 改坏 TypeScript 后能看到诊断并继续修复。

### Phase 5: 持久化和恢复

- [ ] JSONL session store。
- [ ] Session list UI。
- [ ] Resume last session。
- [ ] Snapshot/rollback。
- [ ] Compact boundary 基础实现。

验收：

- 重启 RilleCode 后能恢复 Agent 对话和 edit proposals。
- 能回滚某次 Agent 修改。

### Phase 6: 高级能力

- [ ] JobManager。
- [ ] Guardian 审查。
- [ ] MCP tools。
- [ ] Sub-agent。
- [ ] Side-git。
- [ ] 第三方 harness。
- [ ] 多 provider 路由和成本统计。

## 16. 验证策略

### 16.1 单元测试

- Tool input schema validation。
- Permission rule matching。
- Command policy matching。
- Output truncation。
- Edit proposal conflict detection。
- Session JSONL append/read。

### 16.2 集成测试

- Mock LLM 返回 tool call，验证 runtime 执行链路。
- Mock approval allow/deny。
- Mock command timeout。
- Mock file conflict。

### 16.3 手工验收场景

1. 解释当前打开文件。
2. 搜索函数并打开引用位置。
3. 修改一个小函数，diff review 后 apply。
4. 运行 typecheck，读取错误，再修复。
5. 拒绝危险命令，确认 Agent 不重复请求。
6. 重启后恢复 session。
7. SSH/WSL 工作区中读取文件和运行只读命令。

## 17. UI 文案原则

- 不使用大段说明文字，尽量让状态和操作自解释。
- 审批文案必须具体：执行什么、在哪里、为什么、风险是什么。
- Agent 失败时给可行动原因，不只显示 error。
- 对用户使用中文界面时，工具名可以保留英文，但解释用中文。

示例：

```text
等待批准
运行命令 npm test
工作目录 D:/Codefield/Python/RilleCode
原因：验证刚才的编辑是否破坏测试。
风险：中等，可能执行项目脚本。
```

## 18. 初版成功标准

MVP 不以“能聊天”为成功，而以完成一个真实小任务为成功：

```text
用户：修复当前 TypeScript 文件里的类型错误
Agent:
  1. 读取当前文件和 diagnostics
  2. 搜索相关类型定义
  3. 提出 diff
  4. 用户批准
  5. 写入文件
  6. 运行 typecheck
  7. 如果失败继续修
  8. 最终总结改了什么、验证结果是什么
```

达到这个闭环后，再扩展模型、MCP、后台任务和多 Agent 才有意义。
