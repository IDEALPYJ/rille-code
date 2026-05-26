# RilleCode Agent V2 目标架构

## 总体目标

RilleCode Agent V2 是 IDE-native coding agent runtime。它的目标不是把聊天窗口接上模型，而是让模型在受控、可审计、可恢复的 harness 中完成真实工程任务。

完整系统由七层组成：

```text
Product UX Workbench
  -> Session and Event Log
  -> Harness Orchestrator
  -> Brain Gateway
  -> Context Engine
  -> Hands Runtime
  -> Workspace and Execution Substrate
```

横切层：

```text
Policy / Security
Verification / Review / Evidence
Memory / Compaction / Handoff
Observability / Hooks / Eval
Skills / Plugins / MCP
Subagents / Advisor
```

## 核心组件

### Product UX Workbench

职责：

- 展示 Task、Plan、Stage、Tool、Approval、Diff、Evidence、Review、Handoff、Trace、Subagent。
- 接收用户输入、approval、reject reason、waiver、rollback、resume、archive/unarchive。
- 只消费 event/state，不实现 Agent Loop。

从零设计要求：

- 所有 UI 状态都可从 event log replay 恢复。
- low-level tool events 聚合展示，高风险信息展开展示。
- streaming delta、command output delta、subagent tree 都有稳定 UI 模型。

当前状态：A-N 工作台范围已实现。Task/Plan、approval、diff review、Evidence、Review、Handoff、archive/unarchive、waiver、accepted risk、session risk、streaming status、trace/debug 和 subagent 协议占位树已落地；真实 SubagentRunner 仍归 Phase P。

### Session and Event Log

职责：

- 保存 session、turn、message part、approval、edit、evidence、trace、memory、handoff。
- 提供 append-only JSONL、schemaVersion、sequence、resume、archive。
- 为 context、eval、debug export 提供可追溯事实源。

从零设计要求：

- Event log 是事实源，context 是可重建视图。
- 每个事件必须可 replay，新增事件必须保持兼容。
- 大 artifact 不直接塞入 JSONL，使用 artifactRef。

当前状态：已实现。JSONL、schemaVersion、sequence、resume、archive/unarchive 和 artifactRef store 已落地。

### Harness Orchestrator

职责：

- 将用户请求转为 TaskContract。
- 决定 phase、调用 context、调用 model、执行 tools、处理 approval、进入 verification/review/repair/final。
- 管理 subagent、advisor、compaction、handoff。

从零设计要求：

- 模型输出是 candidate decision，不是系统事实。
- final 前必须通过 evidence/review gate。
- 所有失败都转成 Observation 或 Finding，再进入 repair context。

当前状态：A-L 范围已实现。主 loop 已支持 TaskContract、Context、streaming model gateway、tool execution、approval、verification/review/evaluator、repair/final gate、progress/handoff 和 explicit context compaction；subagent/advisor 完整 runner 仍归 Phase P。

### Brain Gateway

职责：

- 封装 OpenAI-compatible、OpenAI Responses、Anthropic、Gemini、Ollama/custom 等 provider。
- 统一 text JSON fallback、native tool calling、streaming delta、usage、cache metrics、fallback reason。
- 支持 executor、evaluator、advisor、compaction 不同 purpose。

从零设计要求：

- Provider 格式不得泄漏到 Orchestrator。
- Tool schema 稳定排序，支持 deferred tool loading。
- 流式事件和最终结果必须能合并为同一个 ModelDecision。

当前状态：已实现。已有 Text JSON fallback、OpenAI/Anthropic/Gemini native tools、OpenAI Responses adapter、Responses SSE streaming、usage/cache metrics、fallback trace、evaluator maxTokens 和 purpose trace；Anthropic/Gemini streaming UI 深化仍归 Phase N。

### Context Engine

职责：

- 收集、排序、裁剪、渲染 ContextFragment。
- 维护 stable prefix、dynamic suffix、cacheKey、trusted/untrusted、included/excluded trace。
- 注入 project rules、TaskContract、Plan、workspace、diagnostics、git、evidence、review、handoff、memory、skills、LSP/MCP context。

从零设计要求：

- Context 是工作集，不是事实源。
- 外部内容默认是 data，不是 instruction。
- Compaction 后必须重新注入关键上下文，而不是只保留摘要。

当前状态：A-L 范围已实现。Fragment pipeline、stable/dynamic trace、cache key/hash、project rules、evidence/review/handoff/memory fragments、symbols/selections collector、untrusted boundary 和 cache-safe compaction 已落地；完整 MCP lifecycle 和 deferred skills 仍归 Phase O。

### Hands Runtime

职责：

- 执行 file、search、git、command、edit、browser、MCP、memory、subagent 等动作。
- 把结果转成 ToolResult、Observation、Evidence、ArtifactRef。
- 区分 model-visible、runtime-only、ui-only tools。

从零设计要求：

- 工具输入 schema 驱动，输出高信号、可截断、可引用完整 artifact。
- 副作用动作串行，安全只读动作可并行。
- Runtime-only apply 不对模型暴露。

当前状态：已实现。工具 metadata、schema validation、visibility/sideEffect、parallel read、runtime-only apply、artifact-backed output、deferred `search_tools`、`explore_codebase`、`verify_changes` 和 `inspect_runtime_state` 已落地；插件化工具包和 MCP namespace 仍归 Phase O。

### Workspace and Execution Substrate

职责：

- 抽象 local、WSL、SSH、worktree、sandbox、future remote runtime。
- 提供 path guard、protected path、command timeout、output cap、process registry、checkpoint、side-git。
- 记录 runtime state，供 policy、verification、evidence、trace 使用。

从零设计要求：

- 用户未保存和未提交改动优先保护。
- 高风险执行可进入隔离 worktree/sandbox。
- rollback 不污染项目主 git。

当前状态：已实现。local/WSL/SSH/worktree 路由、path guard、protected paths、process registry、checkpoint、worktree sandbox、runtime state artifact、sandbox policy 和 sandbox diff proposal 路径已落地；更完整的 sandbox 专属工作台仍归 Phase N。

## 端到端数据流

```text
User input
  -> Session creates turn
  -> Harness creates or updates TaskContract and Plan
  -> Context Engine builds fragments and trace
  -> Brain Gateway streams ModelDecision
  -> Policy evaluates each proposed action
  -> Hands Runtime executes allowed action or requests approval
  -> ToolResult becomes Observation/Evidence/Artifact
  -> Harness updates Plan, Progress and repair context
  -> Verification computes Coverage
  -> Review/Evaluator creates Findings
  -> Completion Gate allows final or routes repair
  -> Handoff/Trace/Usage/Eval state persists
  -> UX replays and renders recoverable workbench
```

## 关键边界

- Brain 不能直接写文件、运行命令或修改 memory。
- Tool call 不是执行结果，Observation 才是系统事实。
- Review finding 不是自动事实，但 blocking finding 必须阻止 final，直到修复、waive 或 accepted risk。
- Subagent 输出必须被主 Agent 合并和验证，不能直接改变 workspace。
- Memory 写入必须有 sourceRefs、policy check 和 stale/conflict 策略。
- Compaction 不能切断 tool_use/tool_result 对，也不能丢 TaskContract、Plan、Evidence、Handoff。
