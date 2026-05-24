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
| A | Product Contract + System Boundaries | 已完成 | 已实现 | IDE-native runtime 边界、七层架构、用户控制点、完成定义已落地 | D6 |
| B | Durable Session + Event Log | 已完成 | 已实现 | JSONL session、turn、MessagePart、sequence、resume、archive/unarchive、artifact store 已落地 | D6 |
| C | Workspace + Execution Substrate | 已完成 | 已实现 | local/WSL/SSH/worktree、path guard、timeout/output cap、process registry、checkpoint、sandbox、runtime state artifact 已落地 | D6 |
| D | Model Gateway + Streaming Protocol | 部分完成 | 部分实现 | 多 provider、JSON fallback、native tools、usage、evaluator purpose 已落地 | D6 |
| E | Tool Runtime + Tool Design | 部分完成 | 部分实现 | tool metadata、validation、Observation、runtime-only apply、并行只读工具已落地 | E6 |
| F | Policy + Approval + Security | 部分完成 | 部分实现 | permission mode、policy loader、session grant、denial、secret/protected path 基础已落地 | F8 |
| G | Task Contract + Plan Mode | 部分完成 | 部分实现 | TaskContract、Plan、update tools、Task/Plan UI 已落地 | G6 |
| H | Context Engine + Prompt Cache | 部分完成 | 部分实现 | ContextFragment pipeline、project rules、deterministic trimming、cacheKey hints 已落地 | H8 |
| I | Reviewable Editing + Rollback | 部分完成 | 部分实现 | diff proposal、runtime-only apply、dirty guard、rollback proposal 已落地 | I6 |
| J | Verification + Evidence Gate | 部分完成 | 部分实现 | Evidence、Coverage、VerifierRunner、before-stop gate、coverage UI 已落地 | J7 |
| K | Review + Evaluator | 部分完成 | 部分实现 | rule review、LLM evaluator MVP、source badge、blocking gate 已落地 | K6 |
| L | Long-running Memory + Compaction | 部分完成 | 部分实现 | Progress/Handoff、resume injection、ProjectMemory MVP、memory_ref 已落地 | L6 |
| M | Observability + Hooks + Eval Harness | 部分完成 | 部分实现 | TraceEvent、usage、redacted export、metrics、eval skeleton 已落地 | M7 |
| N | Product UX Workbench | 部分完成 | 部分实现 | timeline、Task/Plan、approval、diff、evidence、review、handoff 已落地 | N7 |
| O | Skills + Plugins + MCP | 未开始 | 未实现 | 无 runtime 能力 | O1 |
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
- [ ] D6. Responses API 完整 adapter。
- [ ] D7. SSE streaming。
- [ ] D8. provider fallback matrix。
- [ ] D9. cache read/write metrics。

## Phase E Checklist

- [x] E1. RegisteredTool metadata。
- [x] E2. runtime input validation。
- [x] E3. model-visible/runtime-only 边界。
- [x] E4. Observation event。
- [x] E5. read-only tool parallel execution。
- [ ] E6. artifactRef store。
- [ ] E7. deferred tool discovery。
- [ ] E8. high-level composed tools。
- [ ] E9. tool effectiveness eval cases。

## Phase F Checklist

- [x] F1. permission mode。
- [x] F2. command risk classifier。
- [x] F3. policy loader。
- [x] F4. session PermissionGrant。
- [x] F5. denial tracker。
- [x] F6. secret redaction 基础能力。
- [x] F7. protected paths 基础能力。
- [ ] F8. persistent workspace grant。
- [ ] F9. Guardian/classifier。
- [ ] F10. BashArity-aware policy subject。
- [ ] F11. sandbox policy。

## Phase G Checklist

- [x] G1. TaskContract protocol。
- [x] G2. initial contract and plan。
- [x] G3. update_plan tool。
- [x] G4. update_task_contract tool。
- [x] G5. Task/Plan UI。
- [ ] G6. explicit Plan Mode。
- [ ] G7. user confirmation gate。
- [ ] G8. plan continuity across turns。
- [ ] G9. PlanItem evidence binding gate。

## Phase H Checklist

- [x] H1. ContextFragment protocol。
- [x] H2. buildAgentContext and trace。
- [x] H3. project rules collector。
- [x] H4. deterministic trimming。
- [x] H5. context.built event。
- [x] H6. evidence/review/handoff/memory fragments。
- [x] H7. cacheKey hints。
- [ ] H8. cache hit/miss metrics。
- [ ] H9. LSP/MCP context。
- [ ] H10. untrusted content isolation tags。

## Phase I Checklist

- [x] I1. EditProposal。
- [x] I2. runtime-only apply。
- [x] I3. conflict check。
- [x] I4. dirty snapshot guard。
- [x] I5. reject and rollback proposal。
- [ ] I6. side-git snapshot。
- [ ] I7. checkpoint restore。
- [ ] I8. worktree patch merge UI。

## Phase J Checklist

- [x] J1. Evidence protocol。
- [x] J2. VerificationCoverage。
- [x] J3. VerifierRunner。
- [x] J4. final before-stop gate。
- [x] J5. repair context from failed evidence。
- [x] J6. evidence coverage UI。
- [ ] J7. browser evidence。
- [ ] J8. explicit user evidence。
- [ ] J9. waiver UI。
- [ ] J10. artifact-backed evidence output。

## Phase K Checklist

- [x] K1. ReviewFinding and ReviewResult。
- [x] K2. rule-based review gate。
- [x] K3. blocking finding blocks final。
- [x] K4. LLM evaluator MVP。
- [x] K5. source badge for rule/LLM。
- [ ] K6. accepted risk UI。
- [ ] K7. evaluator as public protocol。
- [ ] K8. reviewer subagent。
- [ ] K9. parallel rule/evaluator execution。

## Phase L Checklist

- [x] L1. FeatureItem / ProgressState / Handoff protocol。
- [x] L2. turn-end progress and handoff。
- [x] L3. resume handoff injection。
- [x] L4. ProjectMemoryEntry and MemoryStore MVP。
- [x] L5. memory_ref context fragment。
- [ ] L6. `.rille/features.json` persistent feature list。
- [ ] L7. explicit context.compacted event。
- [ ] L8. cache-safe compact fork。
- [ ] L9. stale/superseded automatic checks。
- [ ] L10. remote compact task。

## Phase M Checklist

- [x] M1. TraceEvent protocol。
- [x] M2. AgentUsage extraction。
- [x] M3. TraceCollector。
- [x] M4. redacted trace export。
- [x] M5. trajectory metrics。
- [x] M6. eval skeleton。
- [ ] M7. hooks lifecycle。
- [ ] M8. eval fixture setup/teardown。
- [ ] M9. single-step eval runner。
- [ ] M10. full-turn eval runner。
- [ ] M11. CI eval suite。

## Phase N Checklist

- [x] N1. session list and timeline。
- [x] N2. Task/Plan cards。
- [x] N3. approval and diff review。
- [x] N4. verification/evidence/review cards。
- [x] N5. handoff display。
- [x] N6. rule/LLM review source badge。
- [ ] N7. session risk card。
- [ ] N8. streaming UI。
- [ ] N9. slash/@file/#selection composer。
- [ ] N10. trace/debug view。
- [ ] N11. subagent tree。

## Phase O Checklist

- [ ] O1. SkillContract protocol。
- [ ] O2. skill discovery。
- [ ] O3. skill activation trace。
- [ ] O4. plugin manifest。
- [ ] O5. MCP server registry。
- [ ] O6. MCP tool namespace and policy。
- [ ] O7. skill/plugin eval cases。

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

步骤: V2 initial baseline sync
状态: 已记录
完成日期: 2026-05-24
涉及模块: protocol、thread、runtime、contextBuilder、tools、permissions、editStore、verifier、verificationGate、evaluator、memory、trace、AgentPanel、tests
实现摘要: 已根据当前源码把 Phase A-Q 的完成状态初始化到本执行总控。当前 B 核心完成；A/C/D/E/F/G/H/I/J/K/L/M/N 为部分完成；O/P/Q 未开始。
测试文件: `tests/agent/*`
验证命令: `rg -n "TO""DO|TB""D|待""补" plan`、`rg -n "下一步.*Phase ""K|Phase ""K.*下一步" plan`、`rg -n "已实现|部分实现|未实现" plan/06_IMPLEMENTED_STATUS_MATRIX.md`
验证结果: 文档占位检查无输出；过期入口检查无输出；状态矩阵可列出当前状态。
剩余风险: 本轮仅创建和整理规划文档，没有执行代码测试；源码事实后续变化时需要同步更新状态矩阵。
下一步: B6 archive session 或 E6 artifactRef store，二者都是后续能力的基础入口。

步骤: Phase A/B/C final usable implementation
状态: 已完成
完成日期: 2026-05-24
涉及模块: `src/shared/agent/protocol.ts`, `src/main/agent/sessionStore.ts`, `src/main/agent/index.ts`, `src/main/agent/thread.ts`, `src/main/agent/artifactStore.ts`, `src/main/agent/processRegistry.ts`, `src/main/agent/checkpointStore.ts`, `src/main/agent/worktreeSandbox.ts`, `src/main/agent/runtimeState.ts`, `src/main/agent/workspace.ts`, `src/preload/index.ts`, `src/renderer/env.d.ts`, `src/renderer/App.tsx`, `src/renderer/components/agent/AgentPanel.tsx`
实现摘要: Phase A 产品边界和完成定义已收口；Phase B 增加 archive/unarchive、artifact read/list、ArtifactRef 和 artifact-backed evidence/tool/verification output；Phase C 增加 worktree workspace、runtime process registry、checkpoint、worktree sandbox、runtime state artifact，并在 edit apply、turn start、verification 后接入运行状态捕获。
测试文件: `tests/agent/sessionStore.test.ts`, `tests/agent/thread.test.ts`, `tests/agent/artifactStore.test.ts`, `tests/agent/runtimeSubstrate.test.ts`, `tests/agent/verifier.test.ts`, `tests/agent/runtime.test.ts`
验证命令: `npm test`, `npm run typecheck`
验证结果: `npm test` 18 个测试文件、145 个测试全部通过；`npm run typecheck` 通过。
剩余风险: remote/WSL worktree sandbox 依赖目标环境可执行 `git worktree`；失败时返回可操作 reason，不静默降级。
下一步: Phase D6 Responses API adapter、D7 SSE streaming、D8 provider fallback matrix。
