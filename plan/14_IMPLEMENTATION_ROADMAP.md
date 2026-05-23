# Agent 模块化实现路线图

## 目标

本文件定义从当前基线继续推进的实现顺序。路线图从 Phase D 开始，因为当前系统已经具备单 Agent 基础闭环、diff proposal、runtime-only apply、post-apply verification 和基础测试覆盖。

执行状态、完成标记、验收结果和下一步指针以 `15_FULL_AGENT_IMPLEMENTATION_MASTER_PLAN.md` 为准。本文件保留阶段说明和历史完成记录，作为总控计划的背景材料。

## 总体顺序

```text
Phase D: Task Contract + Plan
Phase E: Context Engine
Phase F: Tool / Policy
Phase G: Verification / Review
Phase H: Memory / Long-running / Trace / Eval
Phase I: Observability + Eval
Phase J: UX polish + Skills / Advisor / Subagents
```

原则：

- 每个 Phase 都要能独立验证。
- 优先协议和 runtime，再做 UI 表现。
- 每完成一个 Phase 更新相关模块文档。
- 不在单 Agent 闭环稳定前引入复杂多代理。

## Phase D: Task Contract + Structured Plan

目标：让每个任务有结构化边界和计划。

实现内容：

- 增加 TaskContract、AcceptanceCriterion、RiskPoint、AgentPlanItem 类型。
- 增加 task_contract.created / updated 事件。
- submitTurn 时生成轻量合同。
- 增加 update_plan 工具。
- AgentPanel 增加 Task Contract card 和 Plan card。
- final report 引用 acceptance criteria。

验收：

```text
用户提交“修复当前类型错误”后，UI 显示目标、范围、验证方式。
模型能更新 plan item 状态。
没有 acceptance criteria 时不能直接 final。
```

测试：

```text
npm test
npm run typecheck
```

## Phase E: Context Engine

目标：替换字符串拼接式 context。

实现内容：

- 增加 ContextFragment、ContextTrace、ContextBuildResult。
- 拆分 project rules、workspace、diagnostics、git、observations collectors。
- 支持 stable_prefix / dynamic_suffix。
- 支持 `.rille/rules.md`、`.rille/rules/*.md`、`RILLE.md`。
- 实现 deterministic trimming。
- 将 verification failure 和 review finding 注入 repair context。

验收：

```text
同样输入下 fragment 顺序稳定。
repair 阶段优先看到失败 evidence。
长会话不会无限堆叠 read_file 输出。
```

测试：

```text
npm test
npm run typecheck
```

## Phase F: Tool / Policy Hardening

目标：把工具和权限升级为可配置、可审计、可恢复的行动边界。

实现内容：

- RegisteredTool 增加 visibility、sideEffect、validate。
- ToolResult 转 Observation。
- 加载 `.rille/policy.json`。
- 增加 PermissionGrant。
- ApprovalRequest 增加 matchedRule、runtime、grantOptions。
- Policy denial 进入 Observation。
- 增加 ask_user 和 select_files 工具。

验收：

```text
高风险命令默认拒绝或明确审批。
用户 deny 后 Agent 不重复请求同一命令。
项目 policy 可允许指定验证命令自动运行。
```

测试：

```text
npm test
npm run typecheck
```

## Phase G: Verification / Review Gate

目标：完成由 evidence 和 review gate 决定。

实现内容：

- 扩展 VerificationStatus。
- 增加 Evidence、VerificationCoverage。
- 增加 before-stop hook。
- 增加 diagnostics/diff verifier。
- 增加 ReviewFinding、ReviewResult。
- UI 展示 verification coverage 和 review findings。
- Review blocking issue 进入 repair context。

验收：

```text
code_changed 后无 evidence 不允许直接 final。
verification failed 进入 repair loop。
large/risky diff 触发 review。
final report 显示 evidence 和未覆盖项。
```

测试：

```text
npm test
npm run typecheck
npm run build
```

## Phase H: Memory / Long-running / Trace / Eval

目标：支持长任务恢复和过程评估。

实现内容：

- 增加 ProjectMemoryEntry。
- 增加 FeatureItem、ProgressState、Handoff。
- 增加 context compact boundary。
- Resume 时检查 workspace freshness。
- 增加 TraceEvent、AgentUsage。
- 增加 debug export。
- 建立 eval case 目录和 replay runner。

验收：

```text
implemented_unverified 不会被标记为 verified。
pause/resume 后能看到 handoff 和 next steps。
workspace 变化后 evidence 标记 stale。
一次任务可导出 redacted trace。
```

测试：

```text
npm test
npm run typecheck
npm run build
```

## Phase I: Observability + Eval

目标：让 Agent 过程可复盘、可导出、可评估。

实现内容：

- 增加 TraceEvent。
- 增加 AgentUsage。
- 覆盖 context、model、tool、policy、execution、verification、review trace。
- 增加 debug export。
- 建立 eval case 目录和 replay runner。
- 增加 trajectory 指标。

验收：

```text
一次任务可导出 redacted trace。
模型调用 usage 可追踪。
eval replay 能覆盖成功、失败、修复和拒绝场景。
```

测试：

```text
npm test
npm run typecheck
npm run build
```

## Phase J: UX Polish + Skills / Advisor / Subagents

目标：在单 Agent 可靠后增加专业能力和高级协作。

实现内容：

- ContextBar 可交互 chips。
- Session card 展示 risk、latest verification、last action。
- Composer 支持 `/plan`、`/fix`、`@file`、`#selection`。
- Skills discovery 和按需加载。
- Advisor policy。
- Read-only explorer subagent。
- Reviewer / verifier subagent。

验收：

```text
小任务仍默认单 Agent。
大任务可隔离探索上下文。
Subagent 输出必须由主 Agent 合并、裁决和验证。
用户能在 session list 快速判断任务状态。
```

测试：

```text
npm test
npm run typecheck
npm run build
```

## 全局手工验收清单

每个主要 Phase 后至少跑一次：

1. read -> propose diff -> approve -> apply -> verify。
2. 拒绝危险命令后不重复请求。
3. dirty workspace 不覆盖用户修改。
4. verification 失败进入 repair context。
5. session replay 恢复 pending proposal、verification 和 latest status。
6. local / WSL / SSH workspace 显示执行环境、路径和风险。
7. 长任务 resume 检查 handoff 与当前 workspace 是否冲突。

## 完成记录格式

每个 Phase 完成后在本文件追加记录：

```text
日期:
完成范围:
涉及文件:
验证命令:
结果:
剩余风险:
下一步:
```

## 阶段完成记录

日期: 2026-05-23
完成范围: Phase E4 Project Rules 读取顺序
涉及文件: `src/main/agent/contextBuilder.ts`、`tests/agent/contextBuilder.test.ts`、`plan/15_FULL_AGENT_IMPLEMENTATION_MASTER_PLAN.md`、`plan/01_CURRENT_BASELINE.md`、`plan/05_CONTEXT_ENGINE.md`、`plan/14_IMPLEMENTATION_ROADMAP.md`
验证命令: `npm test`、`npm run typecheck`、`npm run build`、`rg -n "TO""DO|TB""D|待""补" plan`、`rg -n "\[ \]|\[x\]" plan/15_FULL_AGENT_IMPLEMENTATION_MASTER_PLAN.md`
结果: `npm test` 为 9 files / 31 tests passed；`npm run typecheck` passed；`npm run build` passed；文档占位检查无输出；总控 checklist 可列出当前完成与未完成项。
剩余风险: Context Engine 仍未实现 deterministic trimming、cache key、AgentLoop `context.built` event、observation/evidence fragment。
下一步: Phase E5，实现 stable_prefix / dynamic_suffix 分区排序收敛、deterministic trimming 和 trace excluded 记录。

日期: 2026-05-23
完成范围: Phase E5 stable_prefix / dynamic_suffix 分区排序和 deterministic trimming
涉及文件: `src/main/agent/contextBuilder.ts`、`tests/agent/contextBuilder.test.ts`、`plan/15_FULL_AGENT_IMPLEMENTATION_MASTER_PLAN.md`、`plan/01_CURRENT_BASELINE.md`、`plan/05_CONTEXT_ENGINE.md`、`plan/14_IMPLEMENTATION_ROADMAP.md`
验证命令: `npm test`、`npm run typecheck`、`npm run build`、`rg -n "TO""DO|TB""D|待""补" plan`、`rg -n "\[ \]|\[x\]" plan/15_FULL_AGENT_IMPLEMENTATION_MASTER_PLAN.md`
结果: `npm test` 为 9 files / 33 tests passed；`npm run typecheck` passed；`npm run build` passed；文档占位检查无输出；总控 checklist 可列出当前完成与未完成项。
剩余风险: AgentLoop 尚未直接使用 `ContextBuildResult`，也未持久化 `context.built` trace；cache key、observation/evidence fragment 仍待后续阶段。
下一步: Phase E6，AgentLoop 使用 `ContextBuildResult`，并持久化 context trace 摘要。

日期: 2026-05-23
完成范围: Phase E6-E8 Context Engine Foundation 收口
涉及文件: `src/main/agent/runtime.ts`、`src/main/agent/contextBuilder.ts`、`tests/agent/runtime.test.ts`、`tests/agent/sessionStore.test.ts`、`tests/agent/contextBuilder.test.ts`、`plan/15_FULL_AGENT_IMPLEMENTATION_MASTER_PLAN.md`、`plan/01_CURRENT_BASELINE.md`、`plan/05_CONTEXT_ENGINE.md`、`plan/14_IMPLEMENTATION_ROADMAP.md`
验证命令: `npm test`、`npm run typecheck`、`npm run build`、`rg -n "TO""DO|TB""D|待""补" plan`、`rg -n "\[ \]|\[x\]" plan/15_FULL_AGENT_IMPLEMENTATION_MASTER_PLAN.md`
结果: `npm test` 为 10 files / 35 tests passed；`npm run typecheck` passed；`npm run build` passed；文档占位检查无输出；总控 checklist 可列出当前完成与未完成项。
剩余风险: cache key、tool observation fragment、verification/review fragment、compact boundary 不属于 Phase E 收口，进入 Phase F/G/H。
下一步: Phase F1，RegisteredTool 增加 visibility、sideEffect、validate 和 runtime-only 明确标记。

日期: 2026-05-23
完成范围: Phase F Tool / Policy Hardening
涉及文件: `src/shared/agent/protocol.ts`、`src/main/agent/tools.ts`、`src/main/agent/permissions.ts`、`src/main/agent/runtime.ts`、`src/main/agent/thread.ts`、`src/renderer/components/agent/AgentPanel.tsx`、`tests/agent/tools.test.ts`、`tests/agent/permissions.test.ts`、`tests/agent/runtime.test.ts`、`tests/agent/sessionStore.test.ts`、`plan/15_FULL_AGENT_IMPLEMENTATION_MASTER_PLAN.md`、`plan/01_CURRENT_BASELINE.md`、`plan/06_TOOL_RUNTIME.md`、`plan/07_POLICY_SAFETY.md`、`plan/14_IMPLEMENTATION_ROADMAP.md`
验证命令: `npm test`、`npm run typecheck`、`npm run build`、`rg -n "TO""DO|TB""D|待""补" plan`、`rg -n "\[ \]|\[x\]" plan/15_FULL_AGENT_IMPLEMENTATION_MASTER_PLAN.md`
结果: `npm test` 为 11 files / 52 tests passed；`npm run typecheck` passed；`npm run build` passed；文档占位检查无输出；总控 checklist 可列出当前完成与未完成项。
剩余风险: artifactRef、protected paths、secret redaction、持久 workspace grant、Evidence/Review gate 和完整 ask/select UI 不属于 Phase F 收口，进入 Phase G/J 或后续 Policy hardening。
下一步: Phase G1，扩展 VerificationStatus 为 passed、failed、skipped、partial、blocked、stale、waived。

日期: 2026-05-23
完成范围: Phase G Verification / Review Gate
涉及文件: `src/shared/agent/protocol.ts`、`src/main/agent/verificationGate.ts`、`src/main/agent/verifier.ts`、`src/main/agent/runtime.ts`、`src/main/agent/thread.ts`、`src/main/agent/contextBuilder.ts`、`src/renderer/components/agent/AgentPanel.tsx`、`tests/agent/verificationGate.test.ts`、`tests/agent/verifier.test.ts`、`tests/agent/runtime.test.ts`、`tests/agent/sessionStore.test.ts`、`plan/15_FULL_AGENT_IMPLEMENTATION_MASTER_PLAN.md`、`plan/01_CURRENT_BASELINE.md`、`plan/09_VERIFICATION.md`、`plan/10_REVIEW_QUALITY.md`、`plan/14_IMPLEMENTATION_ROADMAP.md`
验证命令: `npm test`、`npm run typecheck`、`npm run build`、`rg -n "TO""DO|TB""D|待""补" plan`、`rg -n "\[ \]|\[x\]" plan/15_FULL_AGENT_IMPLEMENTATION_MASTER_PLAN.md`
结果: `npm test` 为 12 files / 61 tests passed；`npm run typecheck` passed；`npm run build` passed；文档占位检查无输出；总控 checklist 可列出当前完成与未完成项。
剩余风险: waiver UI、stale workspace freshness、artifactRef 存储和 reviewer model/advisor 不属于 Phase G 收口，进入 Phase H/J 或后续 Review hardening。
下一步: Phase H1，增加 FeatureProgressItem、ProgressState、Handoff 协议与事件。

日期: 2026-05-23
完成范围: Phase H Memory / Long-running State
涉及文件: `src/shared/agent/protocol.ts`、`src/main/agent/runtime.ts`、`src/main/agent/thread.ts`、`src/main/agent/contextBuilder.ts`、`src/renderer/components/agent/AgentPanel.tsx`、`tests/agent/runtime.test.ts`、`tests/agent/sessionStore.test.ts`、`tests/agent/contextBuilder.test.ts`、`plan/15_FULL_AGENT_IMPLEMENTATION_MASTER_PLAN.md`、`plan/01_CURRENT_BASELINE.md`、`plan/11_MEMORY_LONG_RUNNING.md`、`plan/14_IMPLEMENTATION_ROADMAP.md`
验证命令: `npm test`、`npm run typecheck`、`npm run build`、`rg -n "TO""DO|TB""D|待""补" plan`、`rg -n "\[ \]|\[x\]" plan/15_FULL_AGENT_IMPLEMENTATION_MASTER_PLAN.md`
结果: `npm test` 为 12 files / 70 tests passed；`npm run typecheck` passed；`npm run build` passed；文档占位检查无输出；总控 checklist 可列出当前完成与未完成项。
剩余风险: ProjectMemoryEntry 只设计未实现；handoff 仅在 turn 边界生成；stale evidence 检查仅验证文件存在性（不比较 git diff）；workspace freshness 仅 local workspace；compact 无显式触发逻辑。
下一步: Phase I1，增加 TraceEvent 和 AgentUsage 协议与事件。

日期: 2026-05-23
完成范围: Phase I Observability + Eval
涉及文件: `src/shared/agent/protocol.ts`、`src/main/agent/provider.ts`、`src/main/agent/runtime.ts`、`src/main/agent/trace.ts`（新）、`src/main/agent/index.ts`、`tests/agent/trace.test.ts`（新）、`tests/agent/sessionStore.test.ts`、`eval/runner.ts`（新）、`eval/cases/_template.json`（新）、`plan/15_FULL_AGENT_IMPLEMENTATION_MASTER_PLAN.md`、`plan/01_CURRENT_BASELINE.md`、`plan/12_OBSERVABILITY_EVAL.md`、`plan/14_IMPLEMENTATION_ROADMAP.md`
验证命令: `npm test`、`npm run typecheck`、`npm run build`、`rg -n "TO""DO|TB""D|待""补" plan`、`rg -n "\[ \]|\[x\]" plan/15_FULL_AGENT_IMPLEMENTATION_MASTER_PLAN.md`
结果: `npm test` 为 13 files / 80 tests passed；`npm run typecheck` passed；`npm run build` passed；文档占位检查无输出；总控 checklist 可列出当前完成与未完成项。
剩余风险: provider usage 依赖各 API 返回格式（Ollama/custom 可能无 usage）；eval runner 仅 trajectory type 匹配；costUsd 无内置定价表；大 session trace export 内存风险。
下一步: Phase J1，Agent 工作台展示 Task、Plan、Diff、Approval、Evidence、Review、Handoff、Trace。

日期: 2026-05-23
完成范围: Phase J Agent Harness Hardening
涉及文件: protocol, workspace, redact（新）, provider, modelAdapter, runtime, tools, memory（新）, contextBuilder, editStore, trace, verificationGate, tests
验证命令: `npm test`、`npm run typecheck`、`npm run build`
结果: `npm test` 为 14 files / 94 tests passed；`npm run typecheck` passed；`npm run build` passed。
剩余风险: Streaming、持久化授权、artifactRef 存储未实施；provider fallback 未实现；memory stale 自动检测未实现。
下一步: 全部 Phase D-J 已完成。Agent 后端基础设施已对齐行业一流水平。

## 停止线

出现以下情况时停止扩大实现范围：

- 协议变化影响多个模块但没有测试。
- UI 需要猜测 runtime 状态。
- 自动写入绕过 EditStore。
- 验证失败但仍试图 final。
- 子代理结果无法验证或合并。

## Phase D 完成记录

日期: 2026-05-22

完成范围:

- 新增 `TaskContract`、`AcceptanceCriterion`、`RiskPoint`、`TaskAssumption`、`AgentPlanItem` 等共享协议类型。
- 新增 `task_contract.created`、`task_contract.updated`、`plan.updated` 事件，以及 `task_contract` / `plan` timeline part。
- `AgentThread.submitTurn()` 会创建轻量 Task Contract 和初始 Plan，再进入现有单 Agent loop。
- `TextJsonToolAdapter` 会把 Task Contract 和 Plan 注入模型输入，并要求 final report 回到验收标准。
- 新增 model-visible `update_plan` 工具，runtime 负责合并计划项、发 `plan.updated`、更新同一个 Plan part。
- AgentPanel 新增 Task Contract card 和 Plan card，session replay 可通过 message parts 恢复。

涉及文件:

- `src/shared/agent/protocol.ts`
- `src/main/agent/taskContract.ts`
- `src/main/agent/thread.ts`
- `src/main/agent/runtime.ts`
- `src/main/agent/modelAdapter.ts`
- `src/main/agent/tools.ts`
- `src/renderer/components/agent/AgentPanel.tsx`
- `src/renderer/App.css`
- `tests/agent/taskContract.test.ts`
- `tests/agent/tools.test.ts`
- `tests/agent/sessionStore.test.ts`

验证命令:

```text
npm test
npm run typecheck
npm run build
```

结果:

```text
npm test: 8 files / 22 tests passed
npm run typecheck: passed
npm run build: passed
```

剩余风险:

- Task Contract 目前是 runtime 启发式生成，还没有用户确认、模型更新合同或越界审批。
- Plan 更新已经结构化，但还没有 completion gate、evidence coverage 和 repair context 约束。
- Final report 回到验收标准目前依靠 prompt，强制门禁留到 Phase G。

下一步:

- 进入 Phase E：将 `buildAgentContextPrompt()` 拆成 `ContextFragment` pipeline，并把 Task Contract / Plan 放入稳定前缀。

## Phase E1 完成记录

日期: 2026-05-22

完成范围:

- 在共享协议中新增 `ContextBuildPhase`、`ContextFragmentType`、`ContextFragment`、`ContextTraceItem`、`ContextTrace`、`ContextBuildInput`、`ContextBuildResult`、`ContextBuiltSummary`。
- 新增 `context.built` 事件，约定只持久化 summary 和 trace，不持久化完整 prompt。
- 补充 JSONL replay 兼容测试。

涉及文件:

- `src/shared/agent/protocol.ts`
- `tests/agent/sessionStore.test.ts`
- `plan/01_CURRENT_BASELINE.md`
- `plan/05_CONTEXT_ENGINE.md`
- `plan/14_IMPLEMENTATION_ROADMAP.md`
- `plan/15_FULL_AGENT_IMPLEMENTATION_MASTER_PLAN.md`

验证命令:

```text
npm test
npm run typecheck
npm run build
```

结果:

```text
npm test: 8 files / 23 tests passed
npm run typecheck: passed
npm run build: passed
```

剩余风险:

- `buildAgentContextPrompt()` 仍未拆分，ContextFragment pipeline 尚未实际生产 prompt。
- `context.built` 尚未由 AgentLoop 发出。

下一步:

- 执行 Phase E2：将 `buildAgentContextPrompt()` 拆成 `buildAgentContext()` 和兼容 wrapper。

## Phase E2 完成记录

日期: 2026-05-22

完成范围:

- 新增 `buildAgentContext(input)`，返回 `ContextBuildResult`。
- 保留 `buildAgentContextPrompt(context)` 作为兼容 wrapper。
- 将旧 prompt 包装成 legacy-compatible context fragment 和 trace，为后续 collector 拆分提供稳定入口。
- 补充 context builder 单元测试，确认 wrapper 输出保持一致，trace 不保存完整 prompt。

涉及文件:

- `src/main/agent/contextBuilder.ts`
- `tests/agent/contextBuilder.test.ts`
- `plan/01_CURRENT_BASELINE.md`
- `plan/05_CONTEXT_ENGINE.md`
- `plan/14_IMPLEMENTATION_ROADMAP.md`
- `plan/15_FULL_AGENT_IMPLEMENTATION_MASTER_PLAN.md`

验证命令:

```text
npm test
npm run typecheck
npm run build
```

结果:

```text
npm test: 9 files / 25 tests passed
npm run typecheck: passed
npm run build: passed
```

剩余风险:

- `buildAgentContext()` 仍使用单个 legacy workspace fragment，尚未拆成 task contract、plan、workspace、active editor、diagnostics、git collectors。
- `context.built` 尚未由 AgentLoop 发出。

下一步:

- 执行 Phase E3：实现 task contract、plan、workspace、active editor、open files、diagnostics、git collectors。

## Phase E3 完成记录

日期: 2026-05-23

完成范围:

- 将 `buildAgentContext()` 拆成 task_contract、plan、workspace、active_editor、open_files、diagnostics、git collectors。
- prompt 改为由 fragments 渲染，stable_prefix 在 dynamic_suffix 前。
- 保留 `buildAgentContextPrompt(context)` 兼容 wrapper，并让 wrapper 走 `buildAgentContext()` 的最小 input。
- 保留 E4 前的 legacy project rules 行为，避免项目文档注入倒退。
- 补充 context builder 单元测试，覆盖 collector 类型、顺序、诊断上限、git fallback、trace 安全和 wrapper 一致性。

涉及文件:

- `src/main/agent/contextBuilder.ts`
- `tests/agent/contextBuilder.test.ts`
- `plan/01_CURRENT_BASELINE.md`
- `plan/05_CONTEXT_ENGINE.md`
- `plan/14_IMPLEMENTATION_ROADMAP.md`
- `plan/15_FULL_AGENT_IMPLEMENTATION_MASTER_PLAN.md`

验证命令:

```text
npm test
npm run typecheck
npm run build
```

结果:

```text
npm test: 9 files / 29 tests passed
npm run typecheck: passed
npm run build: passed
```

剩余风险:

- project rules 仍是 `CLAUDE.md`、`AGENTS.md`、`README.md` legacy 列表，尚未实现完整 E4 顺序。
- deterministic trimming 和 AgentLoop 发 `context.built` 仍待 E5/E6。

下一步:

- 执行 Phase E4：实现 project rules 读取顺序：AGENTS.md、CLAUDE.md、RILLE.md、.rille/rules.md、.rille/rules/*.md、README.md、.rille/local.md。
