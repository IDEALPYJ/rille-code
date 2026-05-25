# 当前实现状态矩阵

## Capability: TaskContract

Target:
将用户请求转为 goal、scope、non-goals、acceptance criteria、verification plan、risk 和 assumptions。

Current status: 已实现

Evidence files:
`src/shared/agent/protocol.ts`, `src/main/agent/taskContract.ts`, `src/main/agent/thread.ts`, `src/main/agent/tools.ts`, `tests/agent/taskContract.test.ts`, `tests/agent/tools.test.ts`

Implemented details:
已有 TaskContract、AcceptanceCriterion、RiskPoint、TaskAssumption、初始合同生成、模型可见 `update_task_contract`、PlanConfirmation、confirmed plan 跨 turn 复用。

Missing pieces:
多用户协作确认和更细的 accepted-risk workflow。

Next phase:
Phase K, Phase N

Verification:
Vitest 覆盖合同生成、更新归一化、PlanConfirmation replay/resolve、Plan Mode 禁写、PlanItem evidence gate。

## Capability: AgentLoop tool loop

Target:
模型提出 tool calls，runtime 执行受控工具，结果回灌模型并继续 loop。

Current status: 已实现

Evidence files:
`src/main/agent/runtime.ts`, `src/main/agent/modelAdapter.ts`, `src/main/agent/tools.ts`, `tests/agent/runtime.test.ts`, `tests/agent/modelAdapter.test.ts`

Implemented details:
AgentLoop 支持 context -> model -> streaming delta/tool calls -> permission -> execution -> observation/evidence -> repair/final gate。

Missing pieces:
subagent delegation、explicit compaction turn。

Next phase:
Phase P

Verification:
Runtime tests 覆盖 tool loop、approval、final gate 和 evidence path。

## Capability: Model Gateway + Streaming Protocol

Target:
模型网关对 runtime 暴露 provider-neutral streaming contract，支持 Responses API、semantic SSE、fallback trace 和 cache metrics。

Current status: 已实现

Evidence files:
`src/shared/agent/protocol.ts`, `src/main/agent/provider.ts`, `src/main/agent/runtime.ts`, `src/main/agent/trace.ts`, `tests/agent/provider.test.ts`, `tests/agent/runtime.test.ts`

Implemented details:
协议新增 ModelStreamEvent、ModelDecision、ProviderFallbackTrace、ModelCacheMetrics；OpenAI Responses adapter 支持 instructions/input/function tools/output parse；Responses SSE 解析 output text delta、tool argument delta、completed/failed；AgentLoop 聚合 delta 并写入 MessagePart；fallback 仅覆盖网络、429、5xx、empty response 和 unsupported streaming；usage 统一提取 cached input/cache write tokens 并写入 trace。

Missing pieces:
Anthropic/Gemini streaming 仍走非流式 fallback trace；更细粒度 reasoning delta UI 可在 Phase N 扩展。

Next phase:
Phase N

Verification:
Provider tests 覆盖 Responses payload、tool call parse、usage/cache metrics、SSE parser、fallback reason；Runtime tests 覆盖 streaming 入口与 tool loop 兼容。

## Capability: ContextFragment pipeline

Target:
用 fragment pipeline 构造 stable/dynamic、可追踪、可裁剪、cache-aware context。

Current status: 已实现

Evidence files:
`src/shared/agent/protocol.ts`, `src/main/agent/contextBuilder.ts`, `tests/agent/contextBuilder.test.ts`

Implemented details:
已有 ContextFragment、ContextTrace、ContextBuildResult、project rules、stable/dynamic sort、deterministic trimming、context.built event、verification/review/handoff/memory fragments、cacheKey hints、stable prefix cache key、dynamic suffix hash、cache eligible token estimate、symbols/selections collector、untrusted boundary tags。

Missing pieces:
完整 MCP server lifecycle、cache-safe explicit compaction。

Next phase:
Phase L, Phase O

Verification:
Context builder tests 覆盖 collectors、排序、裁剪、cache key 稳定性、symbols/selections、untrusted prompt boundary。

## Capability: tool validation

Target:
所有工具都声明 schema、visibility、sideEffect 和 runtime validation。

Current status: 已实现

Evidence files:
`src/main/agent/tools.ts`, `tests/agent/tools.test.ts`

Implemented details:
RegisteredTool 具备 visibility、sideEffect、validate、deferred、category、keywords、activationHint；非法输入返回结构化 failure；`search_tools` 只返回 schema 摘要；`explore_codebase`、`verify_changes`、`inspect_runtime_state` 复用底层 runtime 能力并输出 Observation/Evidence/ArtifactRef。

Missing pieces:
插件化工具包、外部 MCP lifecycle、技能治理。

Next phase:
Phase O

Verification:
Tool tests 覆盖 validation、runtime-only deny、update tools、deferred discovery、组合工具和 artifact-backed 输出。

## Capability: policy loader

Target:
项目级 policy 控制 command/file/git/network/memory 权限。

Current status: 已实现

Evidence files:
`src/main/agent/permissions.ts`, `tests/agent/permissions.test.ts`, `src/main/agent/runtime.ts`

Implemented details:
已有 permission mode、`.rille/policy.json` loader、denial tracker、policy denial Observation、BashArity-aware command subject、Guardian/classifier、sandboxRequired policy。

Missing pieces:
Guardian LLM 第二意见、完整安全审计 UI。

Next phase:
Phase N, Phase Q

Verification:
Permission tests 覆盖 risk 分类、policy allow/ask/deny、workspace grant、Guardian、BashArity subject、sandboxRequired。

## Capability: PermissionGrant scopes

Target:
用户可在 once/session/workspace 范围内授权重复动作，授权可审计、可过期、可隔离 workspace。

Current status: 已实现

Evidence files:
`src/shared/agent/protocol.ts`, `src/main/agent/permissions.ts`, `src/main/agent/thread.ts`, `src/main/agent/runtime.ts`, `src/renderer/components/agent/AgentPanel.tsx`, `tests/agent/permissions.test.ts`

Implemented details:
PermissionGrantStore 支持 once/session grant；workspace grant store 按 workspace path/connection + permission + pattern 持久化，支持 expiresAt、revoked、audit；ApprovalRequest 携带 once/session/workspace grantOptions，UI 可选择 workspace 授权。

Missing pieces:
grant export/audit UI 和批量撤销入口。

Next phase:
Phase N, Phase Q

Verification:
Permission tests 覆盖 session grant matching、workspace grant 持久化、过期、撤销和跨 workspace 隔离。

## Capability: diff proposal/apply guard

Target:
所有写入先生成 diff proposal，用户审查后 runtime-only apply，写入前检查冲突和 dirty state。

Current status: 已实现

Evidence files:
`src/main/agent/editStore.ts`, `src/main/agent/thread.ts`, `src/main/agent/tools.ts`, `tests/agent/editStore.test.ts`, `tests/agent/thread.test.ts`

Implemented details:
已有 EditProposal、EditProposalSet、conflict check、dirty snapshot guard、apply/reject、rollback proposal、checkpoint 多文件 restore proposal、sandbox diff proposal。

Missing pieces:
更完整的 sandbox 专属工作台和 proposal set 批量管理体验。

Next phase:
Phase N

Verification:
Edit/thread/runtime substrate tests 覆盖冲突、防覆盖、rollback proposal、multi-file checkpoint restore 和 sandbox diff proposal。

## Capability: Evidence/Coverage gate

Target:
完成必须由 evidence 覆盖 acceptance criteria，失败/缺失 evidence 进入 repair。

Current status: 已实现

Evidence files:
`src/shared/agent/protocol.ts`, `src/main/agent/verificationGate.ts`, `src/main/agent/verifier.ts`, `src/main/agent/runtime.ts`, `src/main/agent/thread.ts`, `src/renderer/components/agent/AgentPanel.tsx`, `tests/agent/verificationGate.test.ts`, `tests/agent/verifier.test.ts`

Implemented details:
已有 Evidence、VerificationCoverage、before-stop gate、command/diagnostics/diff evidence、VerifierRunner；browser/user evidence op、waiver op/UI、coverage recompute 和 artifact-backed evidence 引用已落地。

Missing pieces:
自动浏览器采集依赖外部浏览器/Playwright，当前 Phase J 范围只支持用户或 runtime 提交 browser observation/screenshot artifact。

Next phase:
Phase M/N

Verification:
Verification tests 覆盖 coverage、failed evidence、review gate 交互、user/browser evidence 和 waiver gate。

## Capability: session archive/unarchive

Target:
Session 可以归档、取消归档、保留 JSONL replay，并避免 resumeLast 自动恢复归档会话。

Current status: 已实现

Evidence files:
`src/shared/agent/protocol.ts`, `src/main/agent/sessionStore.ts`, `src/main/agent/index.ts`, `src/main/agent/thread.ts`, `src/preload/index.ts`, `src/renderer/App.tsx`, `tests/agent/sessionStore.test.ts`, `tests/agent/thread.test.ts`

Implemented details:
AgentSession status 支持 archived；AgentOp/AgentEvent 支持 session.archive/session.unarchive；归档不删除 events.jsonl；UI session 列表支持归档分组和取消归档打开。

Missing pieces:
批量归档和归档搜索筛选。

Next phase:
Phase N

Verification:
SessionStore 和 thread tests 覆盖 archive/unarchive、resumeLast 跳过归档、归档会话恢复保护。

## Capability: ArtifactRef store

Target:
大输出、runtime state、checkpoint、trace/evidence 引用外置 artifact，避免 JSONL 膨胀。

Current status: 已实现

Evidence files:
`src/shared/agent/protocol.ts`, `src/main/agent/artifactStore.ts`, `src/main/agent/tools.ts`, `src/main/agent/verifier.ts`, `src/main/agent/verificationGate.ts`, `src/renderer/components/agent/AgentPanel.tsx`, `tests/agent/artifactStore.test.ts`, `tests/agent/verifier.test.ts`

Implemented details:
ArtifactRef 包含 kind、uri、mimeType、sizeBytes、sha256、redacted；支持 create/list/read；run_command 和 verification output 写入 artifact；Evidence/ToolResult/VerificationResult 可引用 artifact。

Missing pieces:
artifact 清理策略和 UI 侧更完整的二进制预览。

Next phase:
Phase J, Phase M, Phase N

Verification:
Artifact tests 覆盖 metadata、hash、redaction、session namespace；verifier tests 覆盖 artifact-backed command evidence。

## Capability: Workspace execution substrate

Target:
统一 local/WSL/SSH/worktree 执行底座，支持进程生命周期、checkpoint、worktree sandbox、runtime state artifact。

Current status: 已实现

Evidence files:
`src/shared/agent/protocol.ts`, `src/main/agent/workspace.ts`, `src/main/agent/processRegistry.ts`, `src/main/agent/checkpointStore.ts`, `src/main/agent/worktreeSandbox.ts`, `src/main/agent/runtimeState.ts`, `src/main/agent/thread.ts`, `tests/agent/workspace.test.ts`, `tests/agent/runtimeSubstrate.test.ts`

Implemented details:
AgentWorkspaceLocation 支持 worktree；runtime process registry 支持 register/list/stop/output artifact；checkpoint 记录 git status、文件快照和 runtime state；worktree sandbox 支持 create/dispose/failure reason；turn start、edit apply、verification 后捕获 runtime state artifact。

Missing pieces:
远程环境的 worktree 能力依赖目标主机可用 git/worktree；sandbox patch merge UI 留到 Phase I/N。

Next phase:
Phase I, Phase N

Verification:
Runtime substrate tests 覆盖 checkpoint/runtime state、sandbox failure diagnostics、runtime process artifact；workspace tests 覆盖路径边界和 protected path。

## Capability: rule review

Target:
规则审查阻止 missing verification、failed evidence、pending proposal、疑似越界修改等风险。

Current status: 已实现

Evidence files:
`src/main/agent/verificationGate.ts`, `src/main/agent/thread.ts`, `tests/agent/verificationGate.test.ts`, `src/renderer/components/agent/AgentPanel.tsx`

Implemented details:
runRuleBasedReview 生成 ReviewFinding，blocking finding 阻止 final 并显示在 UI；accepted risk / dismiss finding 通过显式用户操作更新 finding lifecycle，accepted risk 不再阻塞 final。

Missing pieces:
完整 reviewer subagent runner 留到 Phase P。

Next phase:
Phase P

Verification:
Verification gate tests 覆盖 request_changes、blocking finding、accepted risk 和 dismiss finding。

## Capability: LLM evaluator MVP

Target:
独立 LLM evaluator 以 skeptical reviewer 角色审查 diff/evidence/contract。

Current status: 已实现

Evidence files:
`src/shared/agent/protocol.ts`, `src/main/agent/evaluatorConfig.ts`, `src/main/agent/evaluatorPrompts.ts`, `src/main/agent/evaluatorRunner.ts`, `src/main/agent/runtime.ts`, `tests/agent/evaluator.test.ts`, `tests/agent/provider.test.ts`

Implemented details:
已有可选 evaluator、独立 model profile、maxTokens、timeout、usage purpose、rule/LLM merge、source badge；EvaluatorRun public protocol 和 evaluator started/completed/failed events 已落地；rule review 与 evaluator review 并行执行；reviewerSubagent read_only 占位协议已落地。

Missing pieces:
完整 reviewer subagent runner、parent-child session tree 和 permission-scoped subagent tool runtime 留到 Phase P。

Next phase:
Phase P

Verification:
Evaluator tests 覆盖 prompt、parse、merge 和 provider maxTokens。

## Capability: handoff/progress

Target:
长任务在 pause/resume/turn boundary 生成可靠进度和交接状态。

Current status: 已实现

Evidence files:
`src/shared/agent/protocol.ts`, `src/main/agent/runtime.ts`, `src/main/agent/thread.ts`, `src/main/agent/contextBuilder.ts`, `src/main/agent/featureStore.ts`, `src/main/agent/compaction.ts`, `tests/agent/runtime.test.ts`, `tests/agent/sessionStore.test.ts`, `tests/agent/memory.test.ts`, `tests/agent/compaction.test.ts`

Implemented details:
已有 FeatureItem、ProgressState、Handoff、turn-end finalize、resume handoff injection、workspace freshness 基础检查；turn end 写入 `.rille/features.json`，resume/context build 注入 feature list；context.compact 生成 compact artifact 和 context.compacted event，不重写 JSONL。

Missing pieces:
更强的 git hash/diff freshness 和后台自动调度留到 Phase M/Q。

Next phase:
Phase M

Verification:
Runtime/session tests 覆盖 progress/handoff 持久化和恢复；FeatureStore/compaction tests 覆盖 feature persistence、stale evidence downgrade 和 compact artifact。

## Capability: ProjectMemory MVP

Target:
项目级长期记忆可追溯、可更新、可标记 stale/superseded/conflict。

Current status: 已实现

Evidence files:
`src/shared/agent/protocol.ts`, `src/main/agent/memory.ts`, `src/main/agent/contextBuilder.ts`, `src/main/agent/tools.ts`, `src/main/agent/thread.ts`, `tests/agent/memory.test.ts`

Implemented details:
已有 ProjectMemoryEntry、MemoryStore、create_memory tool、memory_ref fragment、基础 CRUD；turn start 对缺失 evidence sourceRefs 进行 stale 标记并注入 stale observation。

Missing pieces:
更细粒度 conflict/superseded 推断和 memory policy review 留到 Phase M/Q。

Next phase:
Phase M

Verification:
Memory tests 覆盖 add/list/update/delete/filter/persist；thread freshness 路径由 runtime flow 覆盖。

## Capability: TraceEvent/usage/eval skeleton

Target:
Agent 过程可导出、可脱敏、可聚合、可用于 eval。

Current status: 部分实现

Evidence files:
`src/shared/agent/protocol.ts`, `src/main/agent/trace.ts`, `src/main/agent/provider.ts`, `eval/runner.ts`, `tests/agent/trace.test.ts`

Implemented details:
已有 TraceEvent、AgentUsage、TraceCollector、redacted export、trajectory metrics、eval case skeleton。

Missing pieces:
hooks lifecycle、fixture setup/teardown、single-step eval、full-turn eval、CI eval suite。

Next phase:
Phase M

Verification:
Trace tests 覆盖 redaction、metrics 和 collector。

## Capability: AgentPanel 基础工作台

Target:
用户能看到目标、计划、工具、审批、diff、证据、review、handoff 和状态。

Current status: 部分实现

Evidence files:
`src/renderer/components/agent/AgentPanel.tsx`, `src/shared/agent/protocol.ts`

Implemented details:
已有 timeline、Task/Plan cards、tool group、approval、diff modal、verification/evidence/review cards、handoff、rule/LLM badge。

Missing pieces:
session risk/latest verification card、streaming UI、slash/@file/#selection composer、trace/debug view、subagent tree。

Next phase:
Phase N

Verification:
当前主要依赖 runtime event replay 和手工 UI 验收；后续需要 reducer/UI 测试。

## Capability: Skills / Plugins / MCP

Target:
专业知识和外部工具按需加载、可分发、可治理。

Current status: 未实现

Evidence files:
无当前 runtime 证据。

Implemented details:
无。

Missing pieces:
SkillContract、skill discovery、plugin manifest、MCP registry、namespace policy、activation trace。

Next phase:
Phase O

Verification:
后续以 skill loading tests、MCP lifecycle tests、policy namespace tests 验收。

## Capability: Subagents / Advisor / Parallel Work

Target:
通过 explorer/reviewer/verifier/advisor 实现上下文隔离、独立审查、并行探索和高智指导。

Current status: 未实现

Evidence files:
无当前 runtime 证据。

Implemented details:
无。

Missing pieces:
SubagentContract、SubagentRunner、parent-child session tree、permission-scoped tools、advisor purpose、merge gate。

Next phase:
Phase P

Verification:
后续以 isolation tests、permission tests、parallel merge tests、reviewer/verifier eval cases 验收。
