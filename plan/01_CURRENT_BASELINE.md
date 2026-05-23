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
| Shared protocol | 有 AgentOp、AgentEvent、MessagePart、AgentRunStage、VerificationResult、Evidence、VerificationCoverage、ReviewFinding、ReviewResult、EditProposal、TaskContract、AgentPlanItem、ContextFragment、ContextTrace、ContextBuildResult、Observation、PolicyDecision、PermissionGrant；`edit.apply` 可携带当前 IDE context snapshot 用于写盘前 dirty guard | `src/shared/agent/protocol.ts` |
| Session runtime | 有 AgentThread，管理 session、turn、Task Contract 初始化与更新、Plan 初始化、interrupt、approval、edit apply/reject/rollback；resume `waiting_approval` 会恢复为 idle 并让旧 approval 失效 | `src/main/agent/thread.ts`, `src/main/agent/taskContract.ts` |
| Agent loop | 有 AgentLoop，支持 ContextBuildResult -> contract/plan -> model -> JSON tool calls -> permission/policy/grant -> tool execution -> Evidence/Observation/result feedback -> verification/review before-stop gate -> plan/contract update -> progress/handoff finalize -> trace batch persist，并持久化 redacted context trace | `src/main/agent/runtime.ts`, `src/main/agent/contextBuilder.ts`, `src/main/agent/verificationGate.ts`, `src/main/agent/trace.ts` |
| Model adapter | 有 TextJsonToolAdapter 和 JSON action parser，system prompt 会注入 Task Contract / Plan 边界 | `src/main/agent/modelAdapter.ts` |
| Provider | 支持 OpenAI-compatible、Anthropic、Gemini、Ollama/custom 基础调用；返回 ModelCallResult（text + usage：tokens、latencyMs） | `src/main/agent/provider.ts`, `src/main/agent/config.ts` |
| Tool registry | 有 active editor、open files、diagnostics、update_plan、update_task_contract、ask_user、select_files、list/read/search、git、propose edit、runtime-only apply、run command；每个 RegisteredTool 都有 visibility、sideEffect、validate；read/propose 会优先使用 canonical path 匹配到的 dirty active buffer | `src/main/agent/tools.ts` |
| Permission | 有 plan/ask/accept_edits/auto/bypass、command risk classifier、`.rille/policy.json` loader、session PermissionGrant、拒绝循环检测和 policy denial Observation | `src/main/agent/permissions.ts` |
| Workspace | 有 local / ssh / wsl 路由、workspace path guard 和 canonical workspace path helper | `src/main/agent/workspace.ts` |
| Edit store | 有 full-file proposal、conflict check、dirty snapshot guard、apply/reject、rollback proposal | `src/main/agent/editStore.ts` |
| Verification | 有 VerifierRunner、Evidence、VerificationCoverage、before-stop gate、diagnostics/command/diff evidence 和 failed verification repair context | `src/main/agent/verifier.ts`, `src/main/agent/verificationGate.ts` |
| Review | 有基础 rule-based review gate，能对 missing verification、failed evidence、疑似越界文件和高风险覆盖缺口生成 blocking finding | `src/main/agent/verificationGate.ts` |
| Persistence | 有 userData JSONL events、meta、summary、schemaVersion、sequence | `src/main/agent/sessionStore.ts` |
| Memory / Long-running | 有 FeatureItem、ProgressState、Handoff 协议；turn 结束自动生成 progress/handoff 事件；resume 时注入 handoff 到 context；workspace freshness 检查；session_summary fragment | `src/main/agent/runtime.ts`, `src/main/agent/thread.ts`, `src/main/agent/contextBuilder.ts` |
| Observability / Eval | 有 AgentUsage、TraceEvent（9 种子类型）、EvalCase 协议；provider 返回 usage（tokens + latency）；TraceCollector 在关键决策点收集 trace；finalize 时持久化 trace.batch；redactTraceEvent 脱敏；computeTrajectoryMetrics 聚合指标；exportSessionTrace 导出；eval/ 目录含 runner.ts | `src/main/agent/trace.ts`, `src/main/agent/provider.ts`, `src/main/agent/runtime.ts`, `eval/` |
| Agent UI | 有 timeline、Task Contract card、Plan card、tool group、stage、approval、diff、edit result、verification、evidence coverage、review findings、handoff 展示；会记录 latest context summary 供后续 Trace UI 使用 | `src/renderer/components/agent/AgentPanel.tsx` |
| Tests | 有 Vitest 覆盖 task contract、tools、edit、model adapter、permission、session store、runtime、context builder、verifier、workspace、progress/handoff、trace/metrics | `tests/agent/*` |

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
  -> PermissionEngine 结合 hard deny / validation / grant / policy / mode 判断 allow / ask / deny
  -> ToolRuntime 执行工具
  -> 生成 diagnostics / command / diff Evidence
  -> 持久化 tool / policy / edit Observation
  -> propose_file_edit 生成 EditProposal
  -> UI 展示 diff
  -> 用户 apply / reject / rollback
  -> EditStore 做冲突检查和写入
  -> VerifierRunner 运行验证命令并生成 Evidence
  -> Before-stop gate 计算 VerificationCoverage 和 ReviewResult
  -> Gate 通过才允许 completed，否则进入 repair context
  -> finalize 生成 ProgressState 和 Handoff 并持久化
  -> SessionStore 持久化事件
  -> AgentPanel 展示状态
```

## 当前已验证事实

当前验证命令可作为后续 baseline：

```text
npm test
  13 files passed
  80 tests passed

npm run typecheck
  passed

npm run build
  passed
```

## 当前关键缺口

1. Task Contract 已有 Phase D 初版和模型驱动的 `update_task_contract` 更新能力，但还没有用户确认 gate，也没有和 evidence coverage 深度绑定。
2. Plan card 已有 Phase D 初版，但还没有 blocking gate、repair context 和跨 turn plan continuity。
3. Context Engine Foundation 已完成 Phase E/G/H：有 `ContextFragment` / `ContextTrace` / `ContextBuildResult` 协议、collectors、完整 project rules 读取顺序、stable/dynamic 确定性排序、budget-aware trimming、AgentLoop `context.built` trace event、verification/review/handoff/session_summary fragment、compact boundary via session_summary + trimming、replay 测试和 UI latest context summary；cache key 留给后续阶段。
4. Model Gateway 仍以文本 JSON protocol 为主，没有原生 tool calling、streaming、usage、fallback trace。
5. Tool result 已结构化并会转为 Observation；final gate 已能把缺失/失败 coverage 注入 repair context，但还没有 artifactRef 存储和完整 artifact 输出治理。
6. Policy 已有项目级 `.rille/policy.json`、session grant、approval runtime/matchedRule/grantOptions 和 denial Observation；仍没有持久 workspace grant、protected paths 过滤和 secret redaction 全链路治理。
7. Verification 已扩展为 evidence/coverage gate，并按最终 Agent 标准阻止 failed/blocked/partial coverage 直接完成；final gate 会在缺少检查时自动触发项目 verifier；stale evidence 的 workspace freshness 检查已通过 Phase H handoff.changedFiles 存在性验证和 stale observation 实现（仅 local workspace）。
8. Review 已有基础 rule-based gate，会阻止 pending edit proposal、失败 evidence 和疑似越界修改完成；还没有 reviewer model/advisor，也没有 accepted risk/waiver UI。
9. Memory / Long-running 已完成 Phase H 基础：有 FeatureItem、ProgressState、Handoff 协议，turn 结束自动生成 progress 和 handoff，resume 时注入 handoff 到 context，workspace freshness 检查（local），session_summary collector；ProjectMemoryEntry 和持久 memory store 留待后续。
10. UI 已可展示 Task Contract、Plan、Evidence coverage 和 Review finding，但还缺 Handoff。

## 与其他模块关系

- `02_TASK_CONTRACT.md` 以本文件的缺口 1 为起点。
- `03_ORCHESTRATOR_AGENT_LOOP.md` 以 AgentThread / AgentLoop 为基线。
- `04_MODEL_GATEWAY.md` 以 TextJsonToolAdapter 和 provider 为基线。
- `05_CONTEXT_ENGINE.md` 以 buildAgentContextPrompt 为基线。
- `06_TOOL_RUNTIME.md` 以 toolRegistry、ToolValidationResult 和 Observation 为基线。
- `07_POLICY_SAFETY.md` 以 decidePermission、classifyCommandRisk、policy loader 和 PermissionGrantStore 为基线。
- `08_EXECUTION_RUNTIME.md` 以 workspace helpers 为基线。
- `09_VERIFICATION.md` 以 VerifierRunner 和 verificationGate 为基线。
- `10_REVIEW_QUALITY.md` 以 rule-based review gate 为基线。
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
