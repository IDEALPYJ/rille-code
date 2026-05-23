# 当前实现基线

## 目标

本文件记录 RilleCode Agent 当前已经实现的能力、还缺什么、哪些文件是后续实现的事实源。

它解决：

- 防止把已有原型误判为空白系统。
- 防止把设计中尚未实现的能力误写成已完成。
- 给后续每个模块提供准确基线。

它不解决：

- 不定义新的协议。
- 不修改路线图。
- 不替代源码审查。

## 当前基线

当前 Agent 已经具备一个可运行的单 Agent 基础闭环。

| 能力 | 当前状态 | 主要文件 |
| --- | --- | --- |
| Shared protocol | 有 AgentOp、AgentEvent、MessagePart、AgentRunStage、VerificationResult、EditProposal、TaskContract、AgentPlanItem、ContextFragment、ContextTrace、ContextBuildResult | `src/shared/agent/protocol.ts` |
| Session runtime | 有 AgentThread，管理 session、turn、Task Contract 初始化、Plan 初始化、interrupt、approval、edit apply/reject/rollback | `src/main/agent/thread.ts`, `src/main/agent/taskContract.ts` |
| Agent loop | 有 AgentLoop，支持 ContextBuildResult -> contract/plan -> model -> JSON tool calls -> permission -> tool execution -> result feedback -> plan update，并持久化 redacted context trace | `src/main/agent/runtime.ts`, `src/main/agent/contextBuilder.ts` |
| Model adapter | 有 TextJsonToolAdapter 和 JSON action parser，system prompt 会注入 Task Contract / Plan 边界 | `src/main/agent/modelAdapter.ts` |
| Provider | 支持 OpenAI-compatible、Anthropic、Gemini、Ollama/custom 基础调用 | `src/main/agent/provider.ts`, `src/main/agent/config.ts` |
| Tool registry | 有 active editor、open files、diagnostics、update_plan、list/read/search、git、propose edit、runtime-only apply、run command | `src/main/agent/tools.ts` |
| Permission | 有 plan/ask/accept_edits/auto/bypass、command risk classifier、拒绝循环检测 | `src/main/agent/permissions.ts` |
| Workspace | 有 local / ssh / wsl 路由和 workspace path guard | `src/main/agent/workspace.ts` |
| Edit store | 有 full-file proposal、conflict check、apply/reject、rollback proposal | `src/main/agent/editStore.ts` |
| Verification | 有 VerifierRunner，发现验证命令并在 apply 后运行首个可用命令 | `src/main/agent/verifier.ts` |
| Persistence | 有 userData JSONL events、meta、summary、schemaVersion、sequence | `src/main/agent/sessionStore.ts` |
| Agent UI | 有 timeline、Task Contract card、Plan card、tool group、stage、approval、diff、edit result、verification 展示 | `src/renderer/components/agent/AgentPanel.tsx` |
| Tests | 有 Vitest 覆盖 task contract、tools、edit、model adapter、permission、session store、runtime、context builder、verifier、workspace | `tests/agent/*` |

## 当前基础闭环

```text
用户提交任务
  -> AgentThread 创建 turn
  -> 创建轻量 TaskContract 和初始 AgentPlanItem
  -> 持久化 task_contract.created / plan.updated 和对应 MessagePart
  -> AgentLoop 构造 ContextBuildResult
  -> 持久化 redacted context.built trace
  -> TextJsonToolAdapter 注入合同、计划和 IDE 上下文
  -> TextJsonToolAdapter 构造 messages
  -> provider 调用模型
  -> adapter 解析 JSON tool_calls
  -> PermissionEngine 判断 allow / ask / deny
  -> ToolRuntime 执行工具
  -> propose_file_edit 生成 EditProposal
  -> UI 展示 diff
  -> 用户 apply / reject / rollback
  -> EditStore 做冲突检查和写入
  -> VerifierRunner 运行验证命令
  -> SessionStore 持久化事件
  -> AgentPanel 展示状态
```

## 当前已验证事实

当前验证命令可作为后续 baseline：

```text
npm test
  10 files passed
  35 tests passed

npm run typecheck
  passed

npm run build
  passed
```

## 当前关键缺口

1. Task Contract 已有 Phase D 初版，但还没有模型或用户驱动的 contract update gate，也没有和 evidence coverage 深度绑定。
2. Plan card 已有 Phase D 初版，但还没有 blocking gate、repair context 和跨 turn plan continuity。
3. Context Engine Foundation 已完成 Phase E：有 `ContextFragment` / `ContextTrace` / `ContextBuildResult` 协议、collectors、完整 project rules 读取顺序、stable/dynamic 确定性排序、budget-aware trimming、AgentLoop `context.built` trace event 和 replay 测试；cache key、tool observation fragment、verification/review fragment、compact boundary 留给 Phase F/G/H。
4. Model Gateway 仍以文本 JSON protocol 为主，没有原生 tool calling、streaming、usage、fallback trace。
5. Tool result 已结构化，但还没有统一 Observation 类型和 repair context。
6. Policy 以内置规则为主，没有项目级规则、grant scope、有效期和完整 approval audit。
7. Verification 只有 passed/failed/skipped，缺少 evidence coverage 和 partial/blocked/stale/waived。
8. Review 还不是独立质量门。
9. Memory、Long-running、Trace、Eval 还主要是设计预留。
10. UI 已可展示 Task Contract 和 Plan，但还缺 Evidence coverage、Review finding、Handoff。

## 与其他模块关系

- `02_TASK_CONTRACT.md` 以本文件的缺口 1 为起点。
- `03_ORCHESTRATOR_AGENT_LOOP.md` 以 AgentThread / AgentLoop 为基线。
- `04_MODEL_GATEWAY.md` 以 TextJsonToolAdapter 和 provider 为基线。
- `05_CONTEXT_ENGINE.md` 以 buildAgentContextPrompt 为基线。
- `06_TOOL_RUNTIME.md` 以 toolRegistry 为基线。
- `07_POLICY_SAFETY.md` 以 decidePermission 和 classifyCommandRisk 为基线。
- `08_EXECUTION_RUNTIME.md` 以 workspace helpers 为基线。
- `09_VERIFICATION.md` 以 VerifierRunner 为基线。
- `13_PRODUCT_UX.md` 以 AgentPanel 为基线。

## 实现步骤

1. 每个后续模块实现前先重新读取本文件涉及的源码。
2. 若源码已变化，先更新本文件，再更新相关模块文档。
3. 每次完成 Phase 后，在路线图文档中记录验证结果和剩余风险。

## 测试与验收

- 单元测试：保持现有 `tests/agent/*` 全绿。
- 集成测试：新增协议或事件时补 session replay 和 UI event handling 场景。
- 手工验收：至少验证一次 read -> propose diff -> approve -> apply -> verify。

## 反模式

- 看到文件存在就宣称能力完整。
- 只写未来设计，不承认当前缺口。
- 在未重新读取源码时更新基线。
- 把模型自述当作实现事实。
