# Phase A 到 Phase Q 完整实现计划

## 总览

| Phase | 名称 | 当前状态 |
| --- | --- | --- |
| A | Product Contract + System Boundaries | 已实现 |
| B | Durable Session + Event Log | 已实现 |
| C | Workspace + Execution Substrate | 已实现 |
| D | Model Gateway + Streaming Protocol | 已实现 |
| E | Tool Runtime + Tool Design | 已实现 |
| F | Policy + Approval + Security | 已实现 |
| G | Task Contract + Plan Mode | 已实现 |
| H | Context Engine + Prompt Cache | 已实现 |
| I | Reviewable Editing + Rollback | 已实现 |
| J | Verification + Evidence Gate | 已实现 |
| K | Review + Evaluator | 已实现 |
| L | Long-running Memory + Compaction | 已实现 |
| M | Observability + Hooks + Eval Harness | 部分实现 |
| N | Product UX Workbench | 部分实现 |
| O | Skills + Plugins + MCP | 未实现 |
| P | Subagents + Advisor + Parallel Work | 未实现 |
| Q | Release Governance + Entropy Cleanup | 未实现 |

## Phase A: Product Contract + System Boundaries

目标：定义 RilleCode Agent 的产品合同、系统边界和安全姿态。

设计内容：

- 明确 IDE-native agent runtime，不是聊天补全。
- 定义 Session、Harness、Brain、Hands、Workspace、Policy、Evidence、UX 分层。
- 默认权限为 Ask，所有副作用动作需经过 policy。
- 明确不可绕过边界：模型不能直接写文件、运行命令、修改 memory 或判定完成。

Checklist：

- [x] A1. 写入产品边界和非目标。
- [x] A2. 定义七层架构和横切模块。
- [x] A3. 定义用户控制点：approval、diff review、waiver、rollback、stop、resume、archive。
- [x] A4. 建立状态标记和完成定义。

当前状态：已实现。Agent runtime 已按 IDE-native 产品合同运行，模型副作用通过 policy/tool/runtime 边界进入系统，用户具备 approval、diff review、reject reason、rollback、interrupt、resume、archive/unarchive 等控制点。

## Phase B: Durable Session + Event Log

目标：把 Agent 行为建立在可持久、可 replay、可恢复的事件流上。

设计内容：

- JSONL append-only event log。
- Session / Turn / MessagePart / AgentEvent。
- schemaVersion、sequence、summary、resume、archive。
- 大对象外置为 ArtifactRef。

Checklist：

- [x] B1. Session meta 和 JSONL event store。
- [x] B2. AgentThread 管理 turn lifecycle。
- [x] B3. MessagePart 支持 timeline replay。
- [x] B4. schemaVersion 和 sequence。
- [x] B5. list/resume/delete/rename session。
- [x] B6. archive session。
- [x] B7. artifactRef 外置存储。

当前状态：已实现。Session 支持 create/list/resume/resumeLast/rename/delete/archive/unarchive；JSONL replay 保持兼容；命令输出、verification output、runtime state、checkpoint metadata 可通过 ArtifactRef 外置存储和读取。

## Phase C: Workspace + Execution Substrate

目标：统一 local、WSL、SSH、worktree、sandbox 的执行和文件访问。

设计内容：

- WorkspaceHost 抽象 read/write/search/git/command。
- path guard、protected path、dirty state、canonical path。
- command timeout、output cap、needsShell。
- process registry、checkpoint、side-git、worktree sandbox。

Checklist：

- [x] C1. local/WSL/SSH workspace route。
- [x] C2. withinWorkspace 和 canonicalWorkspacePath。
- [x] C3. command timeout 和 output cap。
- [x] C4. protected path 基础过滤。
- [x] C5. process registry 和 dev server lifecycle。
- [x] C6. checkpoint / side-git snapshot。
- [x] C7. worktree sandbox。
- [x] C8. runtime state artifact。

当前状态：已实现。Workspace 支持 local/WSL/SSH/worktree 路由、路径边界和受保护路径；runtime process registry、checkpoint、worktree sandbox、runtime state artifact 已接入 main/IPC/test。Sandbox 合并和 checkpoint restore 保持 reviewable proposal 边界。

## Phase D: Model Gateway + Streaming Protocol

目标：建立 provider-neutral Brain Gateway。

设计内容：

- Text JSON fallback。
- OpenAI/Anthropic/Gemini native tool calling。
- OpenAI Responses API 完整路径。
- SSE streaming delta、tool call delta、reasoning delta。
- usage、cache metrics、latency、fallback reason。
- executor/evaluator/advisor/compaction purpose routing。

Checklist：

- [x] D1. provider config 和多 profile。
- [x] D2. TextJsonToolAdapter。
- [x] D3. native tool calling for OpenAI/Anthropic/Gemini。
- [x] D4. usage 和 latency 提取。
- [x] D5. evaluator maxTokens 和 purpose trace。
- [x] D6. Responses API 完整 adapter。
- [x] D7. SSE streaming。
- [x] D8. provider fallback matrix。
- [x] D9. cache read/write metrics。

当前状态：已实现。Provider gateway 支持 OpenAI Responses 完整 adapter、semantic SSE streaming、tool call delta 聚合、Responses usage/cache metrics、provider fallback matrix 和 fallback trace；Chat Completions、Anthropic、Gemini 保持兼容路径，非流式 provider 会显式记录 streaming fallback。

## Phase E: Tool Runtime + Tool Design

目标：让工具成为受控、可评估、面向 agent 的能力接口。

设计内容：

- schema-driven tool definition。
- visibility、sideEffect、validate。
- ToolResult -> Observation。
- artifactRef for large output。
- 组合工具：explore_codebase、verify_changes。
- deferred tool/tool search。
- tool eval based optimization。

Checklist：

- [x] E1. RegisteredTool metadata。
- [x] E2. runtime input validation。
- [x] E3. model-visible/runtime-only 边界。
- [x] E4. Observation event。
- [x] E5. read-only tool parallel execution。
- [x] E6. artifactRef store。
- [x] E7. deferred tool discovery。
- [x] E8. high-level composed tools。
- [x] E9. tool effectiveness eval cases。

当前状态：已实现。工具定义具备 deferred/category/keywords/activationHint；稳定 prompt 只注入核心工具，`search_tools` 负责披露长尾工具摘要；`explore_codebase`、`verify_changes`、`inspect_runtime_state` 作为组合工具复用底层 runtime 能力并保持原有 policy/approval 边界；测试覆盖 discovery、组合工具轨迹和 artifact-backed 输出。

## Phase F: Policy + Approval + Security

目标：建立可配置、可审计、fail-closed 的安全层。

设计内容：

- Ask 默认。
- classify command subject，支持 BashArity。
- `.rille/policy.json` project rules。
- deny-and-continue 和 alternatives。
- PermissionGrant once/session/workspace。
- secret redaction、protected paths。
- Guardian/classifier for high-risk actions。
- sandbox policy。

Checklist：

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

当前状态：已实现。Policy 层支持 once/session/workspace grant，workspace grant 按 workspace key 持久化并带 expiresAt/revoked/audit；deterministic Guardian 识别 secret exposure、network exfiltration、destructive shell、credential path、publish/deploy；BashArity-aware subject 识别 chain、pipe、redirect、subshell、env assignment、primary command 和 arity；高风险可隔离命令通过 `sandboxRequired` 进入 ask/fail-closed 路径。

## Phase G: Task Contract + Plan Mode

目标：把用户请求转成可验证任务合同和可更新执行计划。

设计内容：

- goal、scope、non-goals、constraints、acceptance criteria、risk、assumption。
- structured plan item。
- Plan Mode：只探索、只读、输出计划，退出后才能执行。
- user confirmation gate for ambiguous/high-risk tasks。
- PlanItem 与 Evidence 绑定。

Checklist：

- [x] G1. TaskContract protocol。
- [x] G2. initial contract and plan。
- [x] G3. update_plan tool。
- [x] G4. update_task_contract tool。
- [x] G5. Task/Plan UI。
- [x] G6. explicit Plan Mode。
- [x] G7. user confirmation gate。
- [x] G8. plan continuity across turns。
- [x] G9. PlanItem evidence binding gate。

当前状态：已实现。`permissionMode: plan` 成为显式 Plan Mode；runtime 只允许只读探索、tool discovery 和计划更新，禁止写入、命令、apply edit 和 sandbox 操作；PlanConfirmation 事件和 UI 确认卡已落地；replay 会重建最近 TaskContract、PlanItems、PlanConfirmation、Evidence/Coverage；已确认计划可跨 turn 复用；completed PlanItem 必须绑定 evidence，否则 rule review 阻塞最终完成。

## Phase H: Context Engine + Prompt Cache

目标：以可追踪、可裁剪、cache-aware 的方式构造模型上下文。

设计内容：

- ContextFragment pipeline。
- stable_prefix / dynamic_suffix。
- deterministic priority and trimming。
- project rules order。
- cacheKey and cache trace。
- tool observation、evidence、review、handoff、memory fragments。
- LSP and MCP context fragments。
- untrusted data boundary。

Checklist：

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

当前状态：已实现。ContextTrace 输出 stable prefix cache key、dynamic suffix hash、cache eligible token estimate 和 provider cache metrics 投影；AgentContextSnapshot 支持 symbols/selections，context provider 以可插拔 collector 方式接入 IDE/LSP-style 信息；diagnostics、tool output、selection、memory 等非系统指令被明确包裹在 untrusted context boundary 中。

## Phase I: Reviewable Editing + Rollback

目标：所有写入都可审查、可拒绝、可回滚。

设计内容：

- propose_file_edit 生成 diff。
- apply_file_edit runtime-only。
- dirty buffer and current snapshot guard。
- reject with reason。
- rollback proposal。
- checkpoint and side-git snapshot。
- sandbox/worktree patch export。

Checklist：

- [x] I1. EditProposal。
- [x] I2. runtime-only apply。
- [x] I3. conflict check。
- [x] I4. dirty snapshot guard。
- [x] I5. reject and rollback proposal。
- [x] I6. side-git snapshot。
- [x] I7. checkpoint restore。
- [x] I8. worktree patch merge UI。

当前状态：已实现。Checkpoint snapshot artifact 支持多文件 restore-as-proposals，不直接覆盖 workspace；proposal 记录 checkpointId/proposalSetId；sandbox diff 可生成主 workspace reviewable proposals，记录 sandboxId/proposalSetId；UI 支持 proposal set 元数据、checkpoint/sandbox 来源和 PlanConfirmation 确认流程；apply 后继续走 conflict guard 与 verification。

## Phase J: Verification + Evidence Gate

目标：完成由 evidence 证明，而不是由模型自述决定。

设计内容：

- Evidence and VerificationCoverage。
- before-stop hook。
- verifier discovery from project config and package scripts。
- diagnostics、command、diff、review、browser、user evidence。
- stale evidence and waiver UI。

Checklist：

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

当前状态：已实现。

## Phase K: Review + Evaluator

目标：把质量判断从生成器中分离出来。

设计内容：

- rule-based review。
- independent LLM evaluator。
- skeptical evaluator prompt。
- blocking finding。
- accepted risk flow。
- reviewer subagent。

Checklist：

- [x] K1. ReviewFinding and ReviewResult。
- [x] K2. rule-based review gate。
- [x] K3. blocking finding blocks final。
- [x] K4. LLM evaluator MVP。
- [x] K5. source badge for rule/LLM。
- [x] K6. accepted risk UI。
- [x] K7. evaluator as public protocol。
- [x] K8. reviewer subagent placeholder。
- [x] K9. parallel rule/evaluator execution。

当前状态：已实现。

## Phase L: Long-running Memory + Compaction

目标：支持长任务、跨会话恢复和上下文压缩。

设计内容：

- FeatureList。
- ProgressState。
- Handoff。
- ProjectMemory with sourceRefs and stale/superseded/conflict。
- cache-safe compact fork。
- remote compact task。
- compact boundary metadata。

Checklist：

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

当前状态：已实现。

## Phase M: Observability + Hooks + Eval Harness

目标：让 Agent 行为可观察、可导出、可评估、可回归。

设计内容：

- TraceEvent and AgentUsage。
- redacted debug export。
- lifecycle hooks。
- single-step eval。
- full-turn/multi-turn eval。
- fixture setup/teardown。
- expected trajectory/state/evidence/forbidden actions。
- CI eval command。

Checklist：

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

当前状态：部分实现。

## Phase N: Product UX Workbench

目标：把复杂 agent state 转成可理解、可干预、可恢复的 IDE 工作台。

设计内容：

- timeline。
- Task/Plan/Evidence/Review/Handoff cards。
- approval and diff modal。
- session risk/latest verification/last action。
- streaming UI。
- slash commands、@file、#selection。
- trace/debug view。
- subagent tree。

Checklist：

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

当前状态：部分实现。

## Phase O: Skills + Plugins + MCP

目标：让专业能力按需加载、可分发、可治理。

设计内容：

- SkillContract。
- skill discovery from project/user/plugin。
- progressive disclosure。
- plugin packaging for skills/hooks/MCP。
- MCP server lifecycle。
- tool namespace governance。

Checklist：

- [ ] O1. SkillContract protocol。
- [ ] O2. skill discovery。
- [ ] O3. skill activation trace。
- [ ] O4. plugin manifest。
- [ ] O5. MCP server registry。
- [ ] O6. MCP tool namespace and policy。
- [ ] O7. skill/plugin eval cases。

当前状态：未实现。

## Phase P: Subagents + Advisor + Parallel Work

目标：在单 Agent 稳定后引入隔离上下文和并行工作。

设计内容：

- Explorer subagent：read-only codebase exploration。
- Verifier subagent：verification command and evidence。
- Reviewer subagent：fresh review。
- Advisor：advisory-only high intelligence guidance。
- parent-child session tree。
- permission-scoped tools。
- parallel execution and merge gate。

Checklist：

- [ ] P1. SubagentContract protocol。
- [ ] P2. parent-child session relation。
- [ ] P3. SubagentRunner。
- [ ] P4. explorer subagent。
- [ ] P5. verifier subagent。
- [ ] P6. reviewer subagent。
- [ ] P7. advisor agent。
- [ ] P8. parallel scheduling。
- [ ] P9. main-agent merge and verification gate。

当前状态：未实现。

## Phase Q: Release Governance + Entropy Cleanup

目标：让 Agent harness 随模型和项目演进而保持健康。

设计内容：

- feature lifecycle。
- model upgrade review。
- config audit。
- dead scaffold removal。
- eval-based regression tracking。
- migration compatibility。
- prompt/tool/policy entropy cleanup。

Checklist：

- [ ] Q1. feature lifecycle registry。
- [ ] Q2. model upgrade checklist。
- [ ] Q3. prompt/tool/policy audit command。
- [ ] Q4. eval regression report。
- [ ] Q5. stale config detection。
- [ ] Q6. scaffold removal process。
- [ ] Q7. migration compatibility tests。

当前状态：未实现。
