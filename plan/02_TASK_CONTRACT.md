# Task Contract 模块设计

## 目标

Task Contract 把用户自然语言请求转成可执行、可验证、可恢复的任务合同。

它解决：

- 用户目标含糊导致 Agent 直接误改代码。
- 模型扩大范围、顺手重构或修改无关文件。
- Verification 不知道要证明什么。
- Review 无法判断 diff 是否越界。
- 长任务恢复时忘记原始目标。

它不解决：

- 不负责执行工具。
- 不负责拼接上下文。
- 不负责判断权限。
- 不替代用户最终决策。

## 当前基线

当前代码已经具备 Phase D 初版 Task Contract。`turn.submit` 会基于用户文本和 `AgentContextSnapshot` 生成轻量合同，并把合同和初始 Plan 作为 session event 与 timeline part 持久化。

相关现状：

- `AgentTurn.text` 保存用户原文。
- `src/main/agent/taskContract.ts` 负责 `createInitialTaskContract()`、`createInitialPlanItems()` 和 `normalizePlanUpdate()`。
- `MessagePart` 已有 `task_contract` 和 `plan` part。
- `AgentEvent` 已有 `task_contract.created`、`task_contract.updated` 和 `plan.updated`。
- model-visible `update_task_contract` 已允许模型更新 `goal/scope/nonGoals/constraints/acceptanceCriteria/verificationPlan/riskPoints/assumptions/status` 等合同字段；runtime 会归一化输入、忽略非法字段、拒绝空更新，并更新同一个 Task Contract message part。
- `AgentPanel` 已有 Task Contract card 和 Plan card。
- 仍未实现 contract approval gate 和 evidence coverage 绑定。

## 设计原则

1. 用户请求不能直接作为执行目标。
2. Task Contract 要轻量可读，不做冗长 PRD。
3. 简单低风险任务可以生成轻量合同。
4. 高风险、跨模块、长任务必须有完整合同。
5. 合同可以更新，但必须记录原因和来源。
6. 任何 final report 都必须回到合同。

## 核心数据结构

```ts
export interface TaskContract {
  id: string
  sessionId: string
  turnId: string
  goal: string
  scope: ContractScopeItem[]
  nonGoals: string[]
  constraints: string[]
  acceptanceCriteria: AcceptanceCriterion[]
  verificationPlan: VerificationPlanItem[]
  riskPoints: RiskPoint[]
  assumptions: TaskAssumption[]
  status: 'draft' | 'active' | 'updated' | 'completed' | 'blocked'
  createdAt: number
  updatedAt: number
}

export interface ContractScopeItem {
  kind: 'file' | 'module' | 'behavior' | 'ui' | 'test' | 'doc' | 'workspace' | 'unknown'
  value: string
  source: 'user' | 'agent_inferred' | 'tool_observed'
}

export interface AcceptanceCriterion {
  id: string
  text: string
  evidenceRequired: Array<'diagnostics' | 'command' | 'diff' | 'review' | 'browser' | 'user'>
  status: 'unverified' | 'covered' | 'failed' | 'waived'
}

export interface VerificationPlanItem {
  id: string
  command?: string
  verifier: 'diagnostics' | 'typecheck' | 'test' | 'lint' | 'build' | 'review' | 'manual'
  reason: string
}

export interface RiskPoint {
  id: string
  risk: 'low' | 'medium' | 'high' | 'critical'
  text: string
  approvalRequired: boolean
}

export interface TaskAssumption {
  id: string
  text: string
  status: 'open' | 'confirmed' | 'rejected' | 'stale'
}

export interface AgentPlanItem {
  id: string
  title: string
  description?: string
  status: 'pending' | 'in_progress' | 'completed' | 'blocked' | 'skipped'
  source: 'runtime' | 'model' | 'user'
  evidence?: string
  updatedAt: number
}
```

协议事件：

```ts
type AgentEventDelta =
  | { type: 'task_contract.created'; sessionId: string; turnId: string; contract: TaskContract }
  | { type: 'task_contract.updated'; sessionId: string; turnId: string; contract: TaskContract; reason: string; source: 'runtime' | 'model' | 'user' }
  | { type: 'plan.updated'; sessionId: string; turnId: string; items: AgentPlanItem[]; reason?: string; source: 'runtime' | 'model' | 'user'; createdAt: number }
```

MessagePart：

```ts
type MessagePartDelta =
  | { id: string; messageId: string; type: 'task_contract'; contract: TaskContract; createdAt: number }
  | { id: string; messageId: string; type: 'plan'; items: AgentPlanItem[]; reason?: string; createdAt: number }
```

## 运行流程

### Intake

```text
turn.submit
  -> classify task risk
  -> create lightweight TaskContract
  -> emit task_contract.created
  -> show Task Contract card
```

### 合同生成规则

- 如果用户请求是解释、问答、只读分析：生成轻量合同，scope 允许 unknown。
- 如果用户请求涉及写代码：必须有 goal、scope 或 exploration plan、acceptance criteria。
- 如果请求涉及命令、依赖、git、删除、远程工作区：必须添加 riskPoint。
- 如果目标存在多个互斥解释：先只读探索或调用 ask_user。

### 合同更新规则

以下情况触发更新：

- 只读探索发现真实修改范围。
- 用户补充或改变目标。
- Verification 发现验收标准不完整。
- Review 发现 diff 越界。
- 长任务进入新 feature 或 sprint。

当前已实现边界：

- 模型只能通过 `update_task_contract` 工具提交合同 patch，不能直接改 runtime 内存。
- runtime 只接受协议已有字段，空更新会返回工具错误。
- acceptance criteria 的状态目前只允许更新为 `unverified`、`covered`、`failed`、`waived`；这些状态暂时是合同自述，不等价于 Phase G 的 Evidence coverage。
- 合同更新会发出 `task_contract.updated`，并通过 `message.part.updated` 刷新同一个 Task Contract card，避免 timeline 重复卡片。

## 与其他模块关系

- Orchestrator 使用合同判断当前阶段和合法行动。
- Context Engine 优先注入合同。
- Tool Runtime 将工具结果绑定到合同目标。
- Policy 结合合同判断写入或命令是否越界。
- Verification 以 acceptanceCriteria 做 evidence coverage。
- Review 以 scope 和 nonGoals 判断 diff 合理性。
- Memory / Handoff 保存合同摘要和状态。
- UX 展示用户可理解的合同卡片。

## 实现步骤

1. 在 shared protocol 增加 TaskContract 相关类型和事件。
2. 在 AgentThread submitTurn 中创建轻量合同。
3. 在 AgentLoop system prompt 中说明当前合同。
4. 增加 `update_plan` 工具，让模型维护结构化计划。
5. AgentPanel 增加合同卡片。
6. 增加 `update_task_contract` 工具，让模型在 runtime 校验下维护合同变更。
7. 后续 Phase G 再让 Verification 和 Review 开始引用 acceptanceCriteria。

## 测试与验收

单元测试：

- 用户简单问答生成轻量合同。
- 修改任务生成至少一个 acceptance criterion。
- 高风险关键词生成 riskPoint。
- 合同更新保留旧 id 并更新时间。
- `update_task_contract` 非法字段或空更新返回 error。

集成测试：

- mock model 先探索再更新 scope。
- mock model 调用 `update_task_contract` 后产生 `task_contract.updated` 和同一 part 的 `message.part.updated`。
- 用户拒绝范围扩大时，合同不被更新为越界目标。
- final report 引用合同验收标准。

手工验收：

- 输入“修复当前类型错误”，UI 显示目标、范围、验证方式。
- 输入含糊需求，Agent 先探索或提问，而不是直接写文件。

## 反模式

- 用户一提交就直接改代码。
- 只记录“要做什么”，不记录“不要做什么”。
- 把模型推断当成已确认事实。
- 没有验收标准就进入完成。
- 合同更新不记录原因。
