# Product UX 模块设计

## 目标

Product UX 模块把复杂 Agent 状态翻译成用户能理解、能干预、能信任的 IDE 工作台体验。

它解决：

- Agent 黑盒执行，用户不知道目标、进度、风险和证据。
- 每个工具调用都暴露给用户造成信息过载。
- 审批信息不足，用户不知道批准了什么。
- final report 只有总结，没有 evidence。
- 长任务恢复需要读完整历史。

它不解决：

- 不实现 Agent Loop。
- 不直接执行工具。
- 不自己保存事实源。
- 不替代 protocol 和 event stream。

## 当前基线

当前 AgentPanel 已有：

- session list。
- context line。
- timeline。
- stage part。
- tool group。
- approval card。
- diff proposal。
- Monaco diff review modal。
- edit result。
- verification part。
- composer。
- permission mode 和 model select。

当前缺口：

- 没有 Task Contract card。
- 没有 structured Plan card。
- 没有 Evidence coverage card。
- 没有 Review findings。
- 没有 Feature List / Handoff。
- session list 的 risk、verification、last action 信息仍可增强。

## 设计原则

1. UI 消费 agent event/state，不实现 Agent Loop。
2. 用户需要看到目标、计划、动作、风险、diff、evidence 和下一步。
3. 低风险路径尽量流畅，高风险路径清晰审批。
4. 展示关键状态，不倾倒全部内部日志。
5. Final UX 不隐藏不确定性和 waiver。
6. 长任务要能快速 resume。

## 核心 UI 对象

```ts
type AgentTimelineItem =
  | { type: 'task_contract'; contract: TaskContract }
  | { type: 'plan'; items: AgentPlanItem[] }
  | { type: 'stage'; stage: AgentRunStage; detail?: string }
  | { type: 'tool_group'; tools: ToolCallView[] }
  | { type: 'approval'; request: ApprovalRequest }
  | { type: 'diff'; proposal: EditProposal }
  | { type: 'verification'; coverage: VerificationCoverage[]; evidence: Evidence[] }
  | { type: 'review'; findings: ReviewFinding[] }
  | { type: 'handoff'; handoff: Handoff }
  | { type: 'message'; text: string }
```

```ts
interface SessionCardView {
  id: string
  title: string
  workspaceLabel: string
  status: AgentSession['status']
  permissionMode: AgentPermissionMode
  latestVerificationStatus?: VerificationStatus
  risk?: 'low' | 'medium' | 'high' | 'critical'
  lastAction?: string
  updatedAt: number
}
```

## 运行流程

```text
AgentEvent arrives
  -> reducer updates session state
  -> derive timeline items
  -> group low-level tool events
  -> show approval/diff/evidence cards
  -> user action sends AgentOp
```

### 工作台区域

```text
Top/Context Bar:
  workspace, model, permission, active file, dirty count, diagnostics count

Session Sidebar:
  title, status, risk, latest verification, last action

Timeline:
  task contract, plan, stages, tool groups, approvals, diffs, evidence, review, final

Review/Modal:
  diff preview, apply/reject/rollback, evidence, review findings

Composer:
  natural input, /plan, /fix, @file, #selection, stop
```

### Approval UX

Approval card 展示：

- Agent 想做什么。
- 为什么需要。
- 影响哪些文件或命令。
- 风险等级。
- runtime 环境。
- grant 范围。
- allow once / allow for session / deny with reason。

## 与其他模块关系

- Task Contract 提供目标卡片。
- Orchestrator 提供 stage 和 plan。
- Tool Runtime 提供工具摘要。
- Policy 提供 approval 和 risk。
- Verification 提供 evidence coverage。
- Review 提供 findings。
- Long-running 提供 feature list 和 handoff。
- Trace 提供 debug view。

## 实现步骤

1. 增加 Task Contract card。
2. 增加 structured Plan card。
3. 扩展 session list risk/verification/last action。
4. ApprovalCard 展示 Policy details。
5. Diff card 旁展示 verification evidence。
6. 增加 Review findings card。
7. 增加 Feature List / Handoff view。
8. Composer 增加 `/plan`、`/fix`、`@file`、`#selection` 解析为结构化 op。

## 测试与验收

单元测试：

- event reducer 正确处理 task_contract、plan、verification、review。
- tool events 能聚合为 tool group。
- session card latest verification 更新正确。

集成测试：

- approval allow/deny 更新 UI 状态。
- apply edit 后 diff state 和 verification part 更新。
- resume 后恢复 pending proposal。

手工验收：

- 用户无需读完整日志即可知道 Agent 当前做什么。
- 高风险审批信息足够做判断。
- final 显示验证证据和未解决风险。

## 反模式

- UI 内实现 Agent 状态机。
- 展示所有底层日志淹没重点。
- 审批只有允许/拒绝按钮，没有影响说明。
- final 只显示“完成了”。
- 长任务恢复时要求用户读完整历史。
