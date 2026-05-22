# Agent 模块化实现路线图

## 目标

本文件定义从当前基线继续推进的实现顺序。路线图从 Phase D 开始，因为当前系统已经具备单 Agent 基础闭环、diff proposal、runtime-only apply、post-apply verification 和基础测试覆盖。

## 总体顺序

```text
Phase D: Task Contract + Plan
Phase E: Context Engine
Phase F: Tool / Policy
Phase G: Verification / Review
Phase H: Memory / Long-running / Trace / Eval
Phase I: UX polish + Skills / Advisor / Subagents
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

## Phase I: UX Polish + Skills / Advisor / Subagents

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
