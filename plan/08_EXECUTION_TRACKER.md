# V2 执行总控与完成标记表

## 文档定位

本文件是 `plan` 的执行总控表。后续实现 V2 规划时，完成状态、验证结果、完成记录和下一步指针都在这里维护。

更新规则：

- 每完成一个 checklist item，先更新本文件对应勾选状态。
- 每完成一个 Phase，更新 Phase 总览表、追加完成记录、写明验证命令和剩余风险。
- 若实现后当前源码能力状态变化，同步更新 `06_IMPLEMENTED_STATUS_MATRIX.md`。
- 若 Phase 范围变化，同步更新 `04_PHASE_A_TO_Q_MASTER_PLAN.md`。

## Phase 总览

| Phase | 名称 | 当前完成状态 | 源码能力状态 | 当前完成范围 | 下一步入口 |
| --- | --- | --- | --- | --- | --- |
| A | Product Contract + System Boundaries | 已完成 | 已实现 | IDE-native runtime 边界、七层架构、用户控制点、完成定义已落地 | J7 |
| B | Durable Session + Event Log | 已完成 | 已实现 | JSONL session、turn、MessagePart、sequence、resume、archive/unarchive、artifact store 已落地 | J7 |
| C | Workspace + Execution Substrate | 已完成 | 已实现 | local/WSL/SSH/worktree、path guard、timeout/output cap、process registry、checkpoint、sandbox、runtime state artifact 已落地 | J7 |
| D | Model Gateway + Streaming Protocol | 已完成 | 已实现 | Responses adapter、SSE streaming、fallback trace、cache metrics 已落地 | J7 |
| E | Tool Runtime + Tool Design | 已完成 | 已实现 | artifactRef、deferred discovery、组合工具、tool trajectory eval 已落地 | J7 |
| F | Policy + Approval + Security | 已完成 | 已实现 | workspace grant、Guardian、BashArity subject、sandbox policy 已落地 | J7 |
| G | Task Contract + Plan Mode | 已完成 | 已实现 | explicit Plan Mode、PlanConfirmation、跨 turn plan continuity、PlanItem evidence gate 已落地 | J7 |
| H | Context Engine + Prompt Cache | 已完成 | 已实现 | cache trace metrics、symbols/selections collector、untrusted boundary 已落地 | J7 |
| I | Reviewable Editing + Rollback | 已完成 | 已实现 | 多文件 checkpoint restore、proposal set、sandbox diff proposals 已落地 | J7 |
| J | Verification + Evidence Gate | 已完成 | 已实现 | browser/user evidence、waiver UI、artifact-backed evidence、coverage recompute 已落地 | M7 |
| K | Review + Evaluator | 已完成 | 已实现 | accepted risk、EvaluatorRun 事件、并行 rule/evaluator review、reviewer subagent 占位协议已落地 | M7 |
| L | Long-running Memory + Compaction | 已完成 | 已实现 | `.rille/features.json`、explicit compaction、cache-safe compact fork、stale checks、local async compact task 已落地 | M7 |
| M | Observability + Hooks + Eval Harness | 已完成 | 已实现 | hook lifecycle、hook trace、deterministic eval、single-step/full-turn runner、CI eval 入口已落地 | P1 |
| N | Product UX Workbench | 已完成 | 已实现 | session risk card、streaming status、slash/@file/#selection composer、trace/debug view、subagent 占位树已落地 | P1 |
| O | Skills + Plugins + MCP | 已完成 | 已实现 | SkillContract、project/user/plugin discovery、activation trace、plugin manifest、真实 stdio MCP lifecycle、namespace/policy、Phase O eval 已落地 | P1 |
| P | Subagents + Advisor + Parallel Work | 未开始 | 未实现 | 无 runtime 能力 | P1 |
| Q | Release Governance + Entropy Cleanup | 未开始 | 未实现 | 无 runtime 能力 | Q1 |

## Phase A Checklist

- [x] A1. 写入产品边界和非目标。
- [x] A2. 定义七层架构和横切模块。
- [x] A3. 定义用户控制点：approval、diff review、waiver、rollback、stop、resume、archive。
- [x] A4. 建立状态标记和完成定义。

## Phase B Checklist

- [x] B1. Session meta 和 JSONL event store。
- [x] B2. AgentThread 管理 turn lifecycle。
- [x] B3. MessagePart 支持 timeline replay。
- [x] B4. schemaVersion 和 sequence。
- [x] B5. list/resume/delete/rename session。
- [x] B6. archive session。
- [x] B7. artifactRef 外置存储。

## Phase C Checklist

- [x] C1. local/WSL/SSH workspace route。
- [x] C2. withinWorkspace 和 canonicalWorkspacePath。
- [x] C3. command timeout 和 output cap。
- [x] C4. protected path 基础过滤。
- [x] C5. process registry 和 dev server lifecycle。
- [x] C6. checkpoint / side-git snapshot。
- [x] C7. worktree sandbox。
- [x] C8. runtime state artifact。

## Phase D Checklist

- [x] D1. provider config 和多 profile。
- [x] D2. TextJsonToolAdapter。
- [x] D3. native tool calling for OpenAI/Anthropic/Gemini。
- [x] D4. usage 和 latency 提取。
- [x] D5. evaluator maxTokens 和 purpose trace。
- [x] D6. Responses API 完整 adapter。
- [x] D7. SSE streaming。
- [x] D8. provider fallback matrix。
- [x] D9. cache read/write metrics。

## Phase E Checklist

- [x] E1. RegisteredTool metadata。
- [x] E2. runtime input validation。
- [x] E3. model-visible/runtime-only 边界。
- [x] E4. Observation event。
- [x] E5. read-only tool parallel execution。
- [x] E6. artifactRef store。
- [x] E7. deferred tool discovery。
- [x] E8. high-level composed tools。
- [x] E9. tool effectiveness eval cases。

## Phase F Checklist

- [x] F1. permission mode。
- [x] F2. command risk classifier。
- [x] F3. policy loader。
- [x] F4. session PermissionGrant。
- [x] F5. denial tracker。
- [x] F6. secret redaction 基础能力。
- [x] F7. protected paths 基础能力。
- [x] F8. persistent workspace grant。
- [x] F9. Guardian/classifier。
- [x] F10. BashArity-aware policy subject。
- [x] F11. sandbox policy。

## Phase G Checklist

- [x] G1. TaskContract protocol。
- [x] G2. initial contract and plan。
- [x] G3. update_plan tool。
- [x] G4. update_task_contract tool。
- [x] G5. Task/Plan UI。
- [x] G6. explicit Plan Mode。
- [x] G7. user confirmation gate。
- [x] G8. plan continuity across turns。
- [x] G9. PlanItem evidence binding gate。

## Phase H Checklist

- [x] H1. ContextFragment protocol。
- [x] H2. buildAgentContext and trace。
- [x] H3. project rules collector。
- [x] H4. deterministic trimming。
- [x] H5. context.built event。
- [x] H6. evidence/review/handoff/memory fragments。
- [x] H7. cacheKey hints。
- [x] H8. cache hit/miss metrics。
- [x] H9. LSP/MCP context。
- [x] H10. untrusted content isolation tags。

## Phase I Checklist

- [x] I1. EditProposal。
- [x] I2. runtime-only apply。
- [x] I3. conflict check。
- [x] I4. dirty snapshot guard。
- [x] I5. reject and rollback proposal。
- [x] I6. side-git snapshot。
- [x] I7. checkpoint restore。
- [x] I8. worktree patch merge UI。

## Phase J Checklist

- [x] J1. Evidence protocol。
- [x] J2. VerificationCoverage。
- [x] J3. VerifierRunner。
- [x] J4. final before-stop gate。
- [x] J5. repair context from failed evidence。
- [x] J6. evidence coverage UI。
- [x] J7. browser evidence。
- [x] J8. explicit user evidence。
- [x] J9. waiver UI。
- [x] J10. artifact-backed evidence output。

## Phase K Checklist

- [x] K1. ReviewFinding and ReviewResult。
- [x] K2. rule-based review gate。
- [x] K3. blocking finding blocks final。
- [x] K4. LLM evaluator MVP。
- [x] K5. source badge for rule/LLM。
- [x] K6. accepted risk UI。
- [x] K7. evaluator as public protocol。
- [x] K8. reviewer subagent placeholder。
- [x] K9. parallel rule/evaluator execution。

## Phase L Checklist

- [x] L1. FeatureItem / ProgressState / Handoff protocol。
- [x] L2. turn-end progress and handoff。
- [x] L3. resume handoff injection。
- [x] L4. ProjectMemoryEntry and MemoryStore MVP。
- [x] L5. memory_ref context fragment。
- [x] L6. `.rille/features.json` persistent feature list。
- [x] L7. explicit context.compacted event。
- [x] L8. cache-safe compact fork。
- [x] L9. stale/superseded automatic checks。
- [x] L10. remote compact task。

## Phase M Checklist

- [x] M1. TraceEvent protocol。
- [x] M2. AgentUsage extraction。
- [x] M3. TraceCollector。
- [x] M4. redacted trace export。
- [x] M5. trajectory metrics。
- [x] M6. eval skeleton。
- [x] M7. hooks lifecycle。
- [x] M8. eval fixture setup/teardown。
- [x] M9. single-step eval runner。
- [x] M10. full-turn eval runner。
- [x] M11. CI eval suite。

## Phase N Checklist

- [x] N1. session list and timeline。
- [x] N2. Task/Plan cards。
- [x] N3. approval and diff review。
- [x] N4. verification/evidence/review cards。
- [x] N5. handoff display。
- [x] N6. rule/LLM review source badge。
- [x] N7. session risk card。
- [x] N8. streaming UI。
- [x] N9. slash/@file/#selection composer。
- [x] N10. trace/debug view。
- [x] N11. subagent tree。

## Phase O Checklist

- [x] O1. SkillContract protocol。
- [x] O2. skill discovery。
- [x] O3. skill activation trace。
- [x] O4. plugin manifest。
- [x] O5. MCP server registry。
- [x] O6. MCP tool namespace and policy。
- [x] O7. skill/plugin eval cases。

## Phase P Checklist

- [ ] P1. SubagentContract protocol。
- [ ] P2. parent-child session relation。
- [ ] P3. SubagentRunner。
- [ ] P4. explorer subagent。
- [ ] P5. verifier subagent。
- [ ] P6. reviewer subagent。
- [ ] P7. advisor agent。
- [ ] P8. parallel scheduling。
- [ ] P9. main-agent merge and verification gate。

## Phase Q Checklist

- [ ] Q1. feature lifecycle registry。
- [ ] Q2. model upgrade checklist。
- [ ] Q3. prompt/tool/policy audit command。
- [ ] Q4. eval regression report。
- [ ] Q5. stale config detection。
- [ ] Q6. scaffold removal process。
- [ ] Q7. migration compatibility tests。

## 每步固定完成记录模板

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

## 当前基线记录

步骤: Phase M/N closure
状态: 已完成
完成日期: 2026-05-25
涉及模块: `src/shared/agent/protocol.ts`, `src/main/agent/hooks.ts`, `src/main/agent/runtime.ts`, `src/main/agent/thread.ts`, `src/main/agent/trace.ts`, `eval/runner.ts`, `eval/cases/*.json`, `src/preload/index.ts`, `src/renderer/env.d.ts`, `src/renderer/components/agent/AgentPanel.tsx`, `src/renderer/components/agent/workbenchState.ts`, `src/renderer/App.css`
实现摘要: Phase M 完成 hook lifecycle、hook.invoked trace/event、deterministic eval fixture schema、single-step/full-turn runner 和 `npm run eval:agent`；Phase N 完成 session risk/latest verification/latest review/last action/handoff 摘要、streaming status、slash/@file/#selection composer、redacted trace/debug view 和 reviewer subagent 协议占位树。
测试文件: `tests/agent/hooks.test.ts`, `tests/agent/evalRunner.test.ts`, `tests/agent/workbenchState.test.ts`, `tests/agent/trace.test.ts`
验证命令: `npm test`; `npm run typecheck`; `npm run build`; `npm run eval:agent`; M/N checklist 状态检索。
验证结果: `npm test` 22 files / 173 tests passed；`npm run typecheck` passed；`npm run build` passed（保留既有 memory dynamic/static import warning）；`npm run eval:agent` 3/3 cases passed；M/N 未完成 checklist 检索无输出。
剩余风险: subagent tree 仍是 Phase N 的协议/UX 占位，真实 SubagentRunner、parallel scheduling 和 parent-child execution 仍归 Phase P；hooks 本阶段为内部 extension point，不加载用户脚本或插件。
下一步: Phase P1

步骤: Phase O closure
状态: 已完成
完成日期: 2026-05-26
涉及模块: `src/shared/agent/protocol.ts`, `src/main/agent/skillStore.ts`, `src/main/agent/mcpManager.ts`, `src/main/agent/contextBuilder.ts`, `src/main/agent/tools.ts`, `src/main/agent/permissions.ts`, `src/main/agent/index.ts`, `src/main/agent/trace.ts`, `src/preload/index.ts`, `src/renderer/env.d.ts`, `eval/cases/*.json`
实现摘要: Phase O 完成 SkillContract/PluginManifest/MCP protocol、项目与 userData skill/plugin discovery、keyword/manual skill activation trace、plugin manifest 扫描、真实 stdio MCP process lifecycle、最小 MCP JSON-RPC initialize/tools/list/tools/call、`mcp.<pluginId>.<serverId>.<toolName>` namespace、MCP sideEffect policy、Plan Mode read-only 限制、`search_skills`/`activate_skill` deferred tools 和 extension IPC。
测试文件: `tests/agent/skillStore.test.ts`, `tests/agent/mcpManager.test.ts`, `tests/agent/contextBuilder.test.ts`, `tests/agent/tools.test.ts`, `eval/cases/skill_activation_happy.json`, `eval/cases/plugin_mcp_discovery.json`, `eval/cases/mcp_plan_mode_denied.json`, `eval/cases/mcp_startup_failure_recorded.json`
验证命令: `npm test`; `npm run typecheck`; `npm run build`; `npm run eval:agent`; Phase O checklist 状态检索。
验证结果: `npm test` 24 files / 180 tests passed；`npm run typecheck` passed；`npm run build` passed（保留既有 memory dynamic/static import warning）；`npm run eval:agent` 7/7 cases passed；Phase O checklist/status 检索无输出。
剩余风险: Phase O 不加载任意插件 JS，不实现 HTTP/SSE MCP transport、online marketplace、签名/沙箱插件 runtime，也不提前实现 Phase P SubagentRunner、parallel scheduling 或 parent-child session execution。
下一步: Phase P1

步骤: Phase A-L plan consistency audit
状态: 已完成
完成日期: 2026-05-25
涉及模块: `plan/02_TARGET_ARCHITECTURE.md`, `plan/03_PROTOCOL_AND_EVENTS.md`, `plan/05_IMPLEMENTATION_ROADMAP.md`
实现摘要: 已按当前源码能力重新核对 Phase A-L。主计划、状态矩阵和执行总控已显示 A-L 完成；本次同步修正目标架构、协议事件和路线图中的旧状态，移除早期 “部分实现/未实现” 表述，明确剩余工作从 Phase M/N/P/O/Q 继续。
测试文件: 无新增测试；本次为 plan consistency 修正。
验证命令: 文档漂移关键词检索；A-L checklist 未完成项检索；`npm test`
验证结果: 无输出，旧状态描述已清理。
剩余风险: reviewer subagent 仍仅为 Phase K read-only 占位协议，完整 SubagentRunner 仍归 Phase P；Phase M/N 仍有 hooks/eval/UX backlog。
下一步: Phase M7

步骤: Phase J/K/L closure
状态: 已完成
完成日期: 2026-05-25
涉及模块: `src/shared/agent/protocol.ts`, `src/main/agent/thread.ts`, `src/main/agent/runtime.ts`, `src/main/agent/verificationGate.ts`, `src/main/agent/featureStore.ts`, `src/main/agent/compaction.ts`, `src/main/agent/contextBuilder.ts`, `src/main/agent/trace.ts`, `src/preload/index.ts`, `src/renderer/components/agent/AgentPanel.tsx`, `src/renderer/App.css`
实现摘要: Phase J 完成 browser/user evidence、waiver、artifact-backed evidence display/read path；Phase K 完成 accepted risk/dismiss、EvaluatorRun public events、并行 rule/evaluator review、reviewer subagent placeholder；Phase L 完成 `.rille/features.json`、feature context、explicit compaction task/event/result、cache-safe compact artifact、stale evidence/memory checks。
测试文件: `tests/agent/verificationGate.test.ts`, `tests/agent/memory.test.ts`, `tests/agent/compaction.test.ts`
验证命令: `npm test`; `npm run typecheck`; `npm run build`; `rg -n "TO""DO|TB""D|待""补" plan`; `rg -n "Phase J|Phase K|Phase L|已实现|部分实现|未实现" plan/08_EXECUTION_TRACKER.md`
验证结果: `npm test` 19 files / 164 tests passed；`npm run typecheck` passed；`npm run build` passed；文档占位检查和过期 Phase K 指针检查无输出；Phase J/K/L 状态检查可列出已完成记录。
剩余风险: reviewer subagent 是 Phase K 的只读协议占位，完整 SubagentRunner 仍归 Phase P；remote compact task 为当前进程内 job registry，不引入外部调度服务。
下一步: Phase M

## 历史记录

步骤: V2 initial baseline sync
状态: 已记录
完成日期: 2026-05-24
涉及模块: protocol、thread、runtime、contextBuilder、tools、permissions、editStore、verifier、verificationGate、evaluator、memory、trace、AgentPanel、tests
实现摘要: 已根据当前源码把 Phase A-Q 的完成状态初始化到本执行总控。当前 B 核心完成；A/C/D/E/F/G/H/I/J/K/L/M/N 为部分完成；O/P/Q 未开始。
测试文件: `tests/agent/*`
验证命令: `rg -n "TO""DO|TB""D|待""补" plan`、`rg -n "下一步.*Phase ""K|Phase ""K.*下一步" plan`、`rg -n "已实现|部分实现|未实现" plan/06_IMPLEMENTED_STATUS_MATRIX.md`
验证结果: 文档占位检查无输出；过期入口检查无输出；状态矩阵可列出当前状态。

步骤: Phase D/E/F acceptance closure
状态: 已完成
完成日期: 2026-05-24
涉及模块: `src/shared/agent/protocol.ts`, `src/main/agent/provider.ts`, `src/main/agent/runtime.ts`, `src/main/agent/trace.ts`, `src/main/agent/tools.ts`, `src/main/agent/permissions.ts`, `src/renderer/components/agent/AgentPanel.tsx`
实现摘要: Phase D 完成 provider-neutral streaming contract、OpenAI Responses adapter、SSE semantic event parse、fallback trace、cache metrics；Phase E 完成 artifactRef 状态同步、deferred tool discovery、`search_tools`、`explore_codebase`、`verify_changes`、`inspect_runtime_state` 和 tool trajectory eval 覆盖；Phase F 完成 persistent workspace grant、deterministic Guardian/classifier、BashArity-aware command subject、sandboxRequired policy 和 workspace 授权 UI。
测试文件: `tests/agent/provider.test.ts`, `tests/agent/runtime.test.ts`, `tests/agent/tools.test.ts`, `tests/agent/permissions.test.ts`
验证命令: `npm test`, `npm run typecheck`, `npm run build`
验证结果: `npm test` 18 个 test files、151 个 tests 通过；`npm run typecheck` 通过；`npm run build` 通过。
剩余风险: OpenAI Responses streaming 是完整路径；Anthropic/Gemini 当前保持非流式 fallback trace。Workspace grant 的审计列表已持久化，完整管理 UI 可在 Phase N 扩展。
下一步: J7 browser evidence / J8 explicit user evidence / J9 waiver UI。

步骤: Phase G/H/I acceptance closure
状态: 已完成
完成日期: 2026-05-24
涉及模块: `src/shared/agent/protocol.ts`, `src/main/agent/thread.ts`, `src/main/agent/runtime.ts`, `src/main/agent/permissions.ts`, `src/main/agent/contextBuilder.ts`, `src/main/agent/editStore.ts`, `src/main/agent/checkpointStore.ts`, `src/main/agent/worktreeSandbox.ts`, `src/main/agent/verificationGate.ts`, `src/preload/index.ts`, `src/renderer/components/agent/AgentPanel.tsx`
实现摘要: Phase G 完成 PlanConfirmation、显式 Plan Mode 禁写边界、跨 turn confirmed plan 复用、PlanItem evidence gate；Phase H 完成 context cache key/hash/eligible token trace、symbols/selections collector、untrusted context boundary；Phase I 完成 checkpoint 多文件 restore-as-proposals、proposalSet metadata、sandbox diff proposals 和 UI 确认入口。
测试文件: `tests/agent/contextBuilder.test.ts`, `tests/agent/runtime.test.ts`, `tests/agent/thread.test.ts`, `tests/agent/runtimeSubstrate.test.ts`
验证命令: `npm test -- tests/agent/contextBuilder.test.ts tests/agent/runtime.test.ts tests/agent/thread.test.ts tests/agent/runtimeSubstrate.test.ts --reporter verbose`
验证结果: 4 个 test files、36 个 tests 通过。
剩余风险: Phase H 的 MCP lifecycle 仍按规划保留到 Phase O；Phase I 的 proposal set UI 复用现有 diff modal 与 proposal metadata，完整 sandbox 专属工作台可在 Phase N 扩展。
下一步: J7 browser evidence / J8 explicit user evidence / J9 waiver UI。

步骤: Phase A/B/C final usable implementation
状态: 已完成
完成日期: 2026-05-24
涉及模块: `src/shared/agent/protocol.ts`, `src/main/agent/sessionStore.ts`, `src/main/agent/index.ts`, `src/main/agent/thread.ts`, `src/main/agent/artifactStore.ts`, `src/main/agent/processRegistry.ts`, `src/main/agent/checkpointStore.ts`, `src/main/agent/worktreeSandbox.ts`, `src/main/agent/runtimeState.ts`, `src/main/agent/workspace.ts`, `src/preload/index.ts`, `src/renderer/env.d.ts`, `src/renderer/App.tsx`, `src/renderer/components/agent/AgentPanel.tsx`
实现摘要: Phase A 产品边界和完成定义已收口；Phase B 增加 archive/unarchive、artifact read/list、ArtifactRef 和 artifact-backed evidence/tool/verification output；Phase C 增加 worktree workspace、runtime process registry、checkpoint、worktree sandbox、runtime state artifact，并在 edit apply、turn start、verification 后接入运行状态捕获。
测试文件: `tests/agent/sessionStore.test.ts`, `tests/agent/thread.test.ts`, `tests/agent/artifactStore.test.ts`, `tests/agent/runtimeSubstrate.test.ts`, `tests/agent/verifier.test.ts`, `tests/agent/runtime.test.ts`
验证命令: `npm test`, `npm run typecheck`
验证结果: `npm test` 18 个测试文件、145 个测试全部通过；`npm run typecheck` 通过。
剩余风险: remote/WSL worktree sandbox 依赖目标环境可执行 `git worktree`；失败时返回可操作 reason，不静默降级。
下一步: J7 browser evidence / J8 explicit user evidence / J9 waiver UI。
