# RilleCode Coding Agent 新设计规划

本文档基于 `Design.md` 的 agentic coding runtime 方法论，以及当前仓库已经实现的 Agent 代码，重新定义 RilleCode Coding Agent 的后续设计规划。

目标不是重做一份从零开始的方案，而是把现有实现校准成一套可继续演进的工程计划：保留已经跑通的 IDE-native Agent 基础，补齐上下文、权限、验证、diff review、会话恢复和后续多 agent/治理能力。

---

## 1. 总体定位

RilleCode 的 Coding Agent 不应是“聊天框 + 代码回答”，而应是 IDE 内部的 agentic coding runtime。

核心工作流：

```text
用户定义目标
  -> Agent 获取 IDE 上下文
  -> Agent 制定/更新计划
  -> Agent 通过工具探索代码库
  -> Agent 生成 diff proposal
  -> 用户审查并批准
  -> Runtime 应用修改
  -> Agent 运行验证命令/读取 diagnostics
  -> Agent 根据反馈继续修复或明确阻塞
```

产品里的核心对象不是 message，而是：

```text
Session
Turn
Task/Plan
Context snapshot
Tool call/result
Approval request
Diff proposal
Diagnostic snapshot
Verification result
Stop reason
```

用户角色是 orchestrator：设定目标、补充上下文、审查风险、批准 diff、判断是否继续。

---

## 2. 现有实现基线

当前仓库已经具备一个可运行的单 agent 原型，不需要推倒重来。

### 2.1 已落地能力

| 层 | 当前实现 | 主要文件 |
| --- | --- | --- |
| Shared protocol | `AgentOp` / `AgentEvent` / `MessagePart` / `EditProposal` / model profile 类型 | `src/shared/agent/protocol.ts` |
| IPC | renderer 通过 preload 调用 agent API，main 推送 `agent:event` | `src/preload/index.ts`, `src/main/index.ts` |
| Session runtime | `AgentThread` 管理 session、turn、interrupt、approval、history replay | `src/main/agent/thread.ts` |
| Agent loop | 最小多轮 loop：构建 prompt、调用模型、解析 JSON tool calls、执行工具、回灌结果 | `src/main/agent/runtime.ts` |
| Tool registry | read/list/search/git/diff/diagnostics/propose edit/apply edit/run command | `src/main/agent/tools.ts` |
| Permission | plan/ask/accept_edits/auto/bypass 基础模式，危险命令阻断，拒绝循环检测 | `src/main/agent/permissions.ts` |
| Workspace | local/ssh/wsl 工作区抽象，远程读写/搜索/git/命令桥接 | `src/main/agent/workspace.ts`, `src/main/index.ts` |
| Edit store | full-file proposal、conflict check、apply/reject、remote write | `src/main/agent/editStore.ts` |
| Persistence | userData 下 JSONL session events、meta、summary、resume last | `src/main/agent/sessionStore.ts` |
| Provider | OpenAI chat、Anthropic、Gemini、Ollama/custom compatible 基础调用和连通性测试 | `src/main/agent/provider.ts`, `src/main/agent/config.ts` |
| UI | AgentPanel、session list、timeline、tool cards、approval card、Monaco diff modal、model select | `src/renderer/components/agent/AgentPanel.tsx`, `src/renderer/App.tsx` |

### 2.2 当前关键限制

1. 模型工具调用仍是“JSON 文本协议”，还没有接入各 provider 的原生 tool calling/streaming。
2. `ContextBuilder` 仍输出大字符串，还不是可排序、可裁剪、可缓存的 fragment 系统。
3. `apply_file_edit` 既是模型可见工具，也是 UI 可调用操作，职责需要收敛。
4. 命令权限只有基础正则，缺少可配置 allow/ask/deny policy、命令语义分类和测试命令白名单。
5. 验证还依赖模型自觉调用 `run_command`，没有 before-stop hook 或 verifier 强约束。
6. 诊断来源是 renderer 快照，尚未形成编辑后自动刷新/注入下一轮的闭环。
7. session replay 已有，但缺少快照回滚、usage/cost、compact boundary 和版本化 schema。
8. UI 能展示 timeline/diff/approval，但还没有完整的 plan、verification evidence、risk summary 和 task 状态。

结论：下一阶段重点是“硬化现有 runtime”，而不是先做 subagent、MCP 或大型重构。

---

## 3. 目标架构

### 3.1 当前单包内分层

继续保持当前单包结构，避免过早拆 monorepo。

```text
Renderer
  App / Agent session sidebar
  AgentPanel
    ContextBar
    Timeline
    Plan/Tool/Approval/Diff/Verification cards
    Composer
    DiffReview

Preload
  window.rille.agent*
  typed IPC wrapper

Main
  AgentSessionManager
  AgentThread
  AgentLoop
  ContextBuilder
  ModelProvider/ModelAdapter
  ToolRegistry
  PermissionEngine
  VerifierRunner
  SessionStore
  EditStore
  WorkspaceHost

Workspace backends
  local fs/git/spawn
  WSL/SSH remote RPC
  future: terminal/LSP/MCP
```

### 3.2 Runtime 设计原则

1. Agent loop 要薄，runtime 边界要厚：模型只推理和选择工具，文件、命令、权限、持久化和验证由 RilleCode 控制。
2. 工具集合必须稳定：为了 prompt caching 和模型行为稳定，不在 Plan/Ask/Edit 模式之间动态增删工具，而是由权限模式决定是否执行。
3. 写入默认走 diff proposal：模型生成改动意图，用户或 policy 决定是否应用。
4. 验证是 runtime 规则，不是 prompt 建议：改动后必须能触发测试/类型检查/诊断读取，失败时不允许伪完成。
5. 上下文分层：项目规则、IDE 状态、文件内容、Git 状态、诊断、工具结果、历史摘要分别管理。
6. UI 是控制台：用户必须看见 agent 正在做什么、为什么等待、改了哪里、验证证据是什么。

---

## 4. 协议与事件规划

当前 `AgentOp` / `AgentEvent` 方向正确，继续采用 SQ/EQ 双通道：

```text
Submission Queue:
  session.create
  session.resume
  turn.submit
  turn.interrupt
  approval.respond
  edit.apply
  edit.reject
  permission.update

Event Queue:
  session.created/updated
  turn.started/completed/failed
  message.part.created/updated
  tool.started/completed
  approval.requested/resolved
  edit.proposed
  diagnostics.updated
```

### 4.1 下一版新增事件

为了让 UI 不再像“等待黑盒”，需要补充阶段性事件：

```ts
type AgentRunStage =
  | 'building_context'
  | 'calling_model'
  | 'executing_tools'
  | 'waiting_approval'
  | 'applying_edit'
  | 'running_verification'
  | 'compacting_context'

type AgentEventDelta =
  | { type: 'turn.stage'; sessionId: string; turnId: string; stage: AgentRunStage; detail?: string }
  | { type: 'plan.updated'; sessionId: string; turnId: string; items: AgentPlanItem[] }
  | { type: 'verification.started'; sessionId: string; turnId: string; verifier: string; command?: string }
  | { type: 'verification.completed'; sessionId: string; turnId: string; result: VerificationResult }
  | { type: 'usage.updated'; sessionId: string; turnId: string; usage: AgentUsage }
```

### 4.2 MessagePart 调整

保留 part-based timeline，新增更适合 agent 工作台的 part：

```ts
type MessagePartDelta =
  | { type: 'plan'; items: AgentPlanItem[] }
  | { type: 'verification'; result: VerificationResult }
  | { type: 'approval'; requestId: string; state: 'pending' | 'allowed' | 'denied' }
  | { type: 'stage'; stage: AgentRunStage; detail?: string }
```

不要让模型用 Markdown 伪造 plan/diff/test 结果。结构化对象必须来自 runtime。

---

## 5. 模型 Provider 与 Tool Calling

### 5.1 短期：保留 JSON 文本协议，但封装成 adapter

当前 `runtime.ts` 直接要求模型返回 JSON：

```json
{"tool_calls":[{"name":"read_file","input":{"filePath":"..."}}]}
```

这能快速兼容多 provider，但缺点是解析脆弱、无法充分利用原生 tool calling、streaming 也不自然。

下一步不立刻删除它，而是抽出统一 adapter：

```ts
interface ModelAdapter {
  buildRequest(input: AgentModelInput): ProviderRequest
  stream(input: AgentModelInput, signal: AbortSignal): AsyncIterable<ModelStreamEvent>
  parseAction(events: ModelStreamEvent[]): ModelAction
}
```

JSON 文本协议作为 `TextJsonToolAdapter` 保留，用于不支持原生工具的 provider。

### 5.2 中期：Provider 原生 tool calling

按 provider 增加 adapter：

```text
OpenAI Responses / Chat Completions tool_calls
Anthropic Messages tool_use
Gemini function calling
Ollama/OpenAI-compatible fallback
```

runtime 内部仍只处理统一结构：

```ts
type ModelAction =
  | { type: 'assistant_text'; text: string }
  | { type: 'tool_calls'; toolCalls: RuntimeToolCall[]; text?: string }
```

### 5.3 Prompt caching 约束

根据 `Design.md`，prompt caching 是架构约束：

1. system prompt 尽量稳定。
2. tool definitions 顺序 deterministic。
3. 不因 mode 切换增删工具。
4. 项目规则放在稳定前缀区域。
5. 动态 IDE 状态和用户任务靠后。
6. compaction 使用同一套 system prompt/tool schemas。

---

## 6. 工具系统规划

### 6.1 工具分层

现有工具集可以继续使用，但要区分三类：

| 类别 | 是否给模型可见 | 说明 |
| --- | --- | --- |
| Model tools | 是 | 模型可主动调用，如 read/search/propose/run |
| Runtime tools | 否 | runtime/UI 调用，如 edit.apply、refresh diagnostics |
| UI tools | 否 | 打开文件、reveal range、展示 diff 等 IDE 操作 |

### 6.2 第一版稳定 model tools

保持少而强：

```text
get_active_editor
get_open_files
read_diagnostics
list_directory
read_file
search_files
git_status
git_diff
propose_file_edit
run_command
ask_user          # 下一阶段新增
update_plan       # 下一阶段新增，产出结构化 plan part
```

### 6.3 从模型工具中收敛 `apply_file_edit`

当前 `apply_file_edit` 已实现，但它同时出现在模型工具和 UI apply 流程里。

新设计建议：

1. `propose_file_edit` 继续是模型可见工具。
2. `edit.apply` IPC / `EditStore.applyEditProposal` 成为写盘主路径。
3. `apply_file_edit` 从模型可见工具迁移为 runtime-only，或只在 `accept_edits`/`auto` 明确开启时由 PermissionEngine 允许。
4. Ask 模式下，模型只能生成 proposal，用户通过 DiffReview 点击 Apply。

这样可以强化“模型不能直接写文件”的产品承诺，同时保留自动化编辑的未来空间。

### 6.4 命令工具

`run_command` 继续只运行非交互命令，并统一限制：

```text
timeout: 默认 120s，最大 600s
output cap: 默认 50KB，最大 512KB
cwd: 必须在 workspace 内
shell write: 默认 deny
destructive/deploy/publish: deny 或 ask with high risk
```

下一步把命令策略从正则提升为结构化分类：

```ts
type CommandRisk =
  | 'read_only'
  | 'test'
  | 'install'
  | 'write_workspace'
  | 'git_write'
  | 'network'
  | 'destructive'
  | 'deploy'
```

---

## 7. 权限与安全规划

当前权限模式可保留：

```ts
type AgentPermissionMode =
  | 'plan'
  | 'ask'
  | 'accept_edits'
  | 'auto'
  | 'bypass'
```

### 7.1 模式语义

| 模式 | 语义 |
| --- | --- |
| plan | 只读探索、生成计划，不写盘、不运行命令 |
| ask | 默认模式；编辑 proposal 自动允许，apply/command 询问 |
| accept_edits | 用户信任文件编辑；apply 可自动，命令仍询问 |
| auto | 低风险 edit/test 自动，高风险询问 |
| bypass | 显式危险模式，后续必须加二次确认和醒目标识 |

### 7.2 Policy 文件

新增可版本控制的项目级策略：

```text
.rille/policy.json
.rille/rules.md
.rille/rules/*.md
.rille/local.md   # 本地私有，默认 gitignore
```

权限规则示例：

```json
{
  "agent": {
    "permissions": [
      { "permission": "file.read", "pattern": "**", "action": "allow" },
      { "permission": "file.write", "pattern": "src/**", "action": "ask" },
      { "permission": "command.run", "pattern": "npm run typecheck", "action": "allow" },
      { "permission": "command.run", "pattern": "git push **", "action": "ask" },
      { "permission": "command.run", "pattern": "rm **", "action": "deny" }
    ]
  }
}
```

### 7.3 审批 UX

ApprovalCard 要展示：

```text
工具名称
目标文件/命令
cwd / workspace kind / remote host
risk
命中的规则
Agent 理由
timeout/output cap
是否 shell
是否包含重定向/管道
```

按钮：

```text
Allow once
Always allow pattern
Deny
Deny with reason
Open details
```

高风险命令不提供 `Always allow pattern`，或者需要二次确认。

---

## 8. 上下文系统规划

当前 `buildAgentContextPrompt()` 已注入 workspace、active file、open files、diagnostics、Git status、CLAUDE/AGENTS/README。

下一步改成 fragment 系统，而不是直接拼字符串。

### 8.1 ContextFragment

```ts
type ContextFragment =
  | { type: 'system'; priority: number; cacheKey?: string; text: string }
  | { type: 'project_rules'; priority: number; source: string; cacheKey?: string; text: string }
  | { type: 'workspace'; priority: number; text: string }
  | { type: 'active_editor'; priority: number; filePath: string; text: string }
  | { type: 'open_files'; priority: number; files: AgentContextFile[] }
  | { type: 'git'; priority: number; text: string }
  | { type: 'diagnostics'; priority: number; diagnostics: AgentDiagnostic[] }
  | { type: 'tool_result'; priority: number; callId: string; text: string }
  | { type: 'session_summary'; priority: number; text: string }
```

### 8.2 注入顺序

稳定前缀：

```text
1. System prompt
2. Stable tool schemas
3. Project rules: CLAUDE.md / AGENTS.md / .rille/rules.md
```

动态上下文：

```text
4. 当前用户任务
5. 活动文件和选区
6. 打开文件摘要
7. Git status/diff summary
8. Diagnostics
9. 最近工具结果
10. Session summary
```

### 8.3 Project rules

读取顺序调整为：

```text
AGENTS.md
CLAUDE.md
RILLE.md
.rille/rules.md
.rille/rules/*.md
README.md
.rille/local.md
```

规则文件要短、可读、可版本控制；不要把动态代码事实写进 memory/rules。

### 8.4 Compaction

第一阶段先做确定性裁剪：

```text
工具输出头尾保留
搜索结果限制数量
旧 read_file 结果替换为摘要
保留 tool call/result 配对
```

第二阶段增加模型摘要：

```text
达到 token 阈值
  -> 使用同一 system prompt/tool schemas 生成 session summary
  -> 插入 compact boundary
  -> 重新注入当前文件、rules、diagnostics、git
```

---

## 9. 编辑与 Diff Review

### 9.1 Canonical edit flow

```text
propose_file_edit
  -> create EditProposal
  -> emit edit.proposed + diff part
  -> UI 显示 DiffReview
  -> 用户 Apply/Reject
  -> edit.apply IPC
  -> EditStore conflict check
  -> write file
  -> refresh editor/file tree/diagnostics
  -> Agent 收到结果并继续
```

### 9.2 Proposal 粒度

当前是 full-file replacement，优点是简单、diff 清晰、conflict check 可靠。

后续再加入 patch/hunk 模式：

```text
V1: full-file proposal
V2: unified diff patch proposal
V3: hunk-level apply/reject
```

不要过早让模型直接生成复杂 patch；先保证 full-file 路径稳定。

### 9.3 Diff Review UI

当前 modal 可用，下一步增强：

```text
文件级 summary
增删行统计
Apply all pending edits
Reject with reason
冲突时显示 current/proposed/base 三方信息
应用后自动打开文件并刷新 diagnostics
验证结果挂在 diff 旁边
```

---

## 10. 验证闭环

`Design.md` 的关键判断是：验证必须做进 runtime，不能只靠 prompt。

### 10.1 Verifier 类型

```text
diagnostics_verifier
  读取当前 editor diagnostics

typecheck_verifier
  运行 npm run typecheck / tsc / pyright 等

test_verifier
  运行项目测试或相关测试

lint_verifier
  运行 lint/format check

diff_verifier
  检查是否改了无关文件、generated files、敏感文件

security_verifier
  auth/payment/secret/permission 相关变更触发
```

### 10.2 Before-stop hook

新增 turn 完成前检查：

```text
if code_changed:
  if diagnostics available:
    read diagnostics
  if project verification command exists:
    request/auto run verifier command according to permission policy
  if verifier failed:
    inject result into loop and continue
  else:
    allow final answer
```

### 10.3 项目验证命令来源

按优先级发现：

```text
.rille/policy.json
package.json scripts: typecheck/test/lint
README/AGENTS/CLAUDE rules
语言默认命令 future
用户最近手动运行的命令 future
```

初版在 RilleCode 本仓库中可默认识别：

```text
npm run typecheck
npm run build
```

---

## 11. UI 工作台规划

### 11.1 当前 UI 保留

当前 Agent UI 已有：

```text
左侧 session list
右侧 AgentPanel
context line
timeline
tool group
approval card
diff proposal part
Monaco DiffEditor modal
composer
permission mode select
model select
```

继续在此基础上演进。

### 11.2 下一版 UI 对象

ContextBar：

```text
workspace chip
active file chip
selection chip
dirty count
diagnostics count
permission mode
model profile
remote/local label
```

Timeline：

```text
stage row
plan card
assistant text
tool group card
approval card
diff card
verification card
diagnostics card
final summary
```

Session sidebar：

```text
task title
workspace
status
last action
risk marker
verification status
updated time
```

### 11.3 Composer

保留自然语言输入，逐步加入：

```text
/plan
/fix
/test
@file
#selection
context attachment preview
stop button
```

这些命令不应只是文本 prompt，而应转换成结构化 `AgentOp` 或 context hint。

---

## 12. 持久化与恢复

当前 session 存在 Electron `userData/agent/sessions/<session-id>` 下，适合避免污染用户项目。

继续采用：

```text
userData/agent/
  config.json
  sessions/
    <session-id>/
      meta.json
      events.jsonl
```

### 12.1 下一步增强

```text
schemaVersion
event sequence number
usage/cost records
proposal snapshot records
compact boundary records
verification records
session title auto-summary
corrupt JSONL repair/report
```

### 12.2 回滚设计

第一阶段：

```text
EditProposal 保存 originalContent/modifiedContent
Applied proposal 可生成反向 proposal
用户手动确认 rollback
```

第二阶段：

```text
turn-level file snapshot
按 turn 回滚所有 proposal
```

第三阶段：

```text
side-git snapshot
不污染用户项目 .git
支持跨文件、跨 turn 对比
```

---

## 13. 远程工作区

当前 `WorkspaceHost` 已经让 Agent 支持 local/ssh/wsl。

后续要求：

```text
所有 tool result 标记 workspace kind 和 label
命令审批显示 remote host/path
远程命令同样执行 timeout/output cap
远程文件写入仍必须走 EditStore conflict check
API key 留在本地 main process，不默认传到远程
远程 provider 只有用户显式配置时才允许
```

远程能力的设计重点不是更多功能，而是保证安全边界和 UI 透明。

---

## 14. Skills、MCP、Subagents 与 Advisor

这些不是 MVP 阻塞项，但架构要预留。

### 14.1 Skills

Skills 用来承载任务型专业流程：

```text
frontend-design
security-review
test-writing
migration
release-checklist
api-design
performance-debugging
```

Skill 不应常驻 system prompt，而应按任务发现后注入为 context fragment。

### 14.2 MCP

后续支持：

```text
.rille/mcp.json
MCP tool discovery
tool permission through same PermissionEngine
workspace variable interpolation
hot reload
```

### 14.3 Subagents

默认不滥用 subagents。推荐路径：

```text
Single Agent
  -> Generator-Verifier
  -> Read-only research subagent
  -> Reviewer subagent
  -> Parallel subagents
```

Subagent 的主要价值是 context isolation，而不是“看起来更高级”。

### 14.4 Advisor

Advisor 是比多 agent 更轻的智能升级：

```text
默认 executor 模型完成任务
遇到复杂决策/重复失败/安全风险/大 diff 时咨询 stronger advisor
advisor 不直接调用工具、不直接输出给用户
```

触发条件：

```text
repeated_verification_failure >= 2
large_diff
security_sensitive_files_changed
architecture_change
permission_denied_loop
low_confidence_stop
```

---

## 15. 实施路线图

### Phase A: 硬化当前单 Agent 原型

目标：让现有 Agent loop 可观察、可测试、可稳定恢复。

任务：

- [x] 给 `runtime.ts` 增加 `turn.stage` 事件。
- [x] 抽出 `ModelAdapter`，保留当前 JSON fallback。
- [x] 将 tool definitions 排序固定，并区分 model-visible/runtime-only tools。
- [x] 将 `apply_file_edit` 收敛为 runtime-only 或受 `accept_edits` 明确控制。
- [x] 给 `permissions.ts` 增加结构化 command risk classifier。
- [x] 给 `sessionStore.ts` 增加 `schemaVersion` 和 event sequence。
- [x] 补基础单元测试：权限、命令分类、路径越界、proposal conflict、JSON action parser。

验收：

```text
用户能解释当前文件、搜索代码、生成 diff proposal。
所有阶段 UI 可见。
拒绝权限后不会反复请求同一操作。
重启后 session timeline 和 pending proposals 可恢复。
```

### Phase B: Diff-only 编辑闭环

目标：把编辑路径打磨成可靠产品功能。

任务：

- [x] DiffReview 展示增删行统计和 proposal rationale。
- [x] Apply/Reject 后把结果作为结构化 tool/user feedback 注入 Agent。
- [x] Apply 后刷新打开文件、文件树 dirty state、diagnostics。
- [x] 支持 Reject with reason。
- [x] 支持 Apply all pending edits。
- [x] 支持 proposal rollback。

验收：

```text
Agent 不能绕过 proposal 直接写文件。
用户批准前磁盘不改变。
文件变更冲突时不覆盖用户修改。
应用后 Agent 能看到应用结果并继续验证。
```

### Phase C: 验证闭环

目标：Agent 不再在未验证或验证失败时声称完成。

任务：

- [x] 实现 `VerifierRunner`。
- [x] 从 `package.json` 和 rules 中发现 typecheck/test/lint 命令。
- [x] 增加应用后验证 hook。
- [x] 增加 verification part/event。
- [x] 失败结果注入 timeline/session 作为下一轮上下文证据。
- [x] UI 展示 verification evidence。

验收：

```text
修改 TypeScript 后会触发 diagnostics/typecheck。
typecheck 失败时 Agent 继续修复或报告阻塞。
最终回答包含实际验证命令和结果。
```

### 阶段完成记录

#### 2026-05-20 22:21 CST - Phase A-C 首轮落地

完成步骤：

- Phase A：新增 `turn.stage` / stage part，抽出 `TextJsonToolAdapter`，将 `apply_file_edit` 改为 runtime-only，补充 command risk classifier，session JSONL 写入 `schemaVersion` 和 `sequence`。
- Phase B：DiffReview 增加增删统计、Reject reason、Apply all、Rollback；Apply/Reject 结果写入结构化 `edit_result` part。
- Phase C：新增 `VerifierRunner`，从 `.rille/policy.json` 或 `package.json` scripts 发现验证命令；编辑应用成功后自动运行验证并写入 `verification` event/part。

涉及模块：

- `src/shared/agent/protocol.ts`
- `src/main/agent/runtime.ts`
- `src/main/agent/modelAdapter.ts`
- `src/main/agent/tools.ts`
- `src/main/agent/permissions.ts`
- `src/main/agent/thread.ts`
- `src/main/agent/editStore.ts`
- `src/main/agent/sessionStore.ts`
- `src/main/agent/verifier.ts`
- `src/renderer/components/agent/AgentPanel.tsx`
- `src/renderer/App.tsx`
- `src/renderer/App.css`
- `tests/agent/*.test.ts`

验证命令：

```text
npm test
npm run typecheck
npm run build
```

结果：

```text
npm test: 6 files, 15 tests passed
npm run typecheck: passed
npm run build: passed
```

下一步：

- 将验证失败结果更深地注入下一次模型 prompt 的 session context。
- 为自动 apply policy 补权限 UI 和项目级配置。
- 进入 Phase D：ContextBuilder fragment pipeline 与项目规则读取。

### Phase D: 上下文分层与大型代码库能力

目标：减少 prompt 噪音，提高代码库探索能力。

任务：

- [ ] `ContextBuilder` 改为 fragment pipeline。
- [ ] 支持 `.rille/rules.md` 和 `.rille/rules/*.md`。
- [ ] 支持 context budget 和 deterministic trimming。
- [ ] 增加 codebase map：目录摘要、忽略规则、常用命令。
- [ ] 增加 LSP/Monaco diagnostics bridge。
- [ ] 增加 symbol search / go-to-definition / references tools。
- [ ] 增加 compact boundary 和 session summary。

验收：

```text
Agent 能在中型项目中先定位相关文件再读取。
长会话不会无限堆叠 read_file 输出。
项目规则可被稳定注入，且动态 IDE 状态不会破坏稳定前缀。
```

### Phase E: UI 工作台与任务管理

目标：从对话面板升级为 agent 工作台。

任务：

- [ ] ContextBar 改为可交互 chips。
- [ ] 增加结构化 plan card。
- [ ] session list 展示 risk/verification/last action。
- [ ] 支持 `/plan`、`/fix`、`@file`、`#selection`。
- [ ] 支持后台 job state：queued/running/paused/completed/failed。
- [ ] 支持 session title 自动总结。

验收：

```text
用户无需读完整日志，也能知道 Agent 当前在做什么、卡在哪里、下一步是什么。
多 session 切换时能快速判断每个任务状态。
```

### Phase F: 高级能力

目标：在单 agent 闭环稳定后扩展。

任务：

- [ ] Advisor policy。
- [ ] Read-only research subagent。
- [ ] Reviewer/verifier subagent。
- [ ] MCP registry。
- [ ] Skills discovery。
- [ ] Cost/usage dashboard。
- [ ] Audit log 和 org policy。
- [ ] 第三方 harness 适配：Claude Code / Codex / OpenCode。

验收：

```text
复杂任务可拆解，关键决策可升级，成本和安全事件可追踪。
```

---

## 16. 测试策略

### 16.1 单元测试

优先补这些低成本高收益测试：

```text
parseModelAction
permission mode decision
dangerous command classification
needsShell/shellTokens
withinWorkspace path guard
EditProposal conflict detection
session JSONL append/read/replay
context trimming
```

### 16.2 集成测试

```text
mock model returns read_file tool call
mock model returns propose_file_edit
approval allow/deny
command timeout
edit conflict
session resume
remote workspace host mock
```

### 16.3 手工验收场景

```text
1. 解释当前打开文件。
2. 搜索某个函数并总结引用。
3. 修改一个小函数，只生成 diff，不立即写盘。
4. 用户 Apply 后文件更新，打开文件同步。
5. 运行 npm run typecheck，失败后继续修。
6. 拒绝危险命令，Agent 停止重复请求。
7. 重启后恢复 session 和 diff proposal。
8. SSH/WSL 工作区读取文件和运行只读命令。
```

---

## 17. 初版成功标准

MVP 成功不是“能聊天”，而是完成真实小任务：

```text
用户：修复当前 TypeScript 文件里的类型错误

Agent:
  1. 读取当前文件和 diagnostics
  2. 搜索相关类型定义
  3. 生成 diff proposal
  4. 用户审查并 Apply
  5. 写入文件并刷新 editor
  6. 运行 typecheck 或读取 diagnostics
  7. 如果失败继续修复
  8. 最终总结改动和验证证据
```

必须满足：

```text
无批准不写盘
危险命令不可绕过
失败验证不伪完成
所有关键动作有事件和持久化记录
用户可以中断、拒绝、恢复、回看 diff
```

---

## 18. 明确不做的事

当前阶段不要做：

```text
不要先拆 monorepo。
不要先做大型 RAG 索引。
不要先做多 agent team。
不要把所有项目知识塞进 system prompt。
不要让模型直接写文件。
不要把测试要求只写在 prompt 里。
不要为了 UI 好看隐藏 tool/approval/verification 证据。
```

先把单 agent 的 read -> propose diff -> approve -> apply -> verify 闭环做硬，再扩展其他能力。
