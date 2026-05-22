# Orchestrator 与 Agent Loop 模块设计

## 目标

Orchestrator 负责把一次用户任务推进为可恢复、可审计、可验证的工程过程。

它解决：

- 主循环只是 model -> tool -> model，缺少阶段和完成门禁。
- 模型输出直接驱动工具，缺少合法性判断。
- 工具失败、权限拒绝、验证失败无法进入 repair loop。
- final answer 直接结束任务。

它不解决：

- 不拼接 prompt。
- 不直接调用 provider API。
- 不直接执行 shell 或写文件。
- 不自己判断权限。
- 不渲染 UI。

## 当前基线

当前实现：

- `AgentThread` 管理 session、turn、approval、edit apply/reject/rollback、post-apply verification。
- `AgentLoop` 负责模型调用迭代、解析 action、执行 tool、回灌 result。
- `AgentRunStage` 已有 `building_context`、`calling_model`、`executing_tools`、`waiting_approval`、`applying_edit`、`running_verification`、`compacting_context`、`completed`、`failed`。
- `message.part.updated` 已用于工具状态更新。
- 最大迭代次数为 12。

当前缺口：

- 没有 Task Contract 和 Plan 状态。
- ModelAction 只有 answer / tool_calls。
- Tool result 没有统一 Observation。
- 完成声明没有 before-stop evidence gate。
- Verification 主要在 edit apply 后触发，不是完整完成门禁。

## 设计原则

1. 模型输出是 ModelDecision，不是系统状态。
2. 每轮行动后必须做 progress check。
3. 失败是任务反馈，不是简单异常。
4. final answer 只能在完成门禁通过后出现。
5. Orchestrator 协调模块，不成为上帝对象。

## 核心数据结构

```ts
export type ModelDecision =
  | { type: 'assistant_text'; text: string }
  | { type: 'request_tool_calls'; toolCalls: RuntimeToolCall[]; text?: string }
  | { type: 'update_plan'; items: AgentPlanItem[] }
  | { type: 'ask_clarification'; question: string; choices?: string[] }
  | { type: 'claim_ready_for_verification'; reason: string }
  | { type: 'request_review'; reason: string }
  | { type: 'mark_blocked'; reason: string }
  | { type: 'final_response'; text: string }

export type LoopPhase =
  | 'intake'
  | 'planning'
  | 'exploration'
  | 'coding'
  | 'waiting_approval'
  | 'verification'
  | 'review'
  | 'repair'
  | 'handoff'
  | 'finalizing'
```

```ts
export interface ProgressCheck {
  advanced: boolean
  completedPlanItemIds: string[]
  repeatedFailure?: boolean
  needsVerification?: boolean
  needsReview?: boolean
  blockedReason?: string
}
```

## 运行流程

```text
submitTurn
  -> create TaskContract
  -> build initial plan
  -> while not stopped:
       build context for current phase
       call ModelGateway
       parse ModelDecision
       check decision legality
       dispatch tools / ask user / update plan
       convert results to Observation
       run progress check
       enter verification / review / repair / finalizing
```

### 决策合法性

- `request_tool_calls`：工具存在、当前 phase 允许、Policy 允许或 request approval。
- `claim_ready_for_verification`：进入 verification，不直接 completed。
- `final_response`：只有 Verification / Review gate 通过后允许。
- `update_plan`：只更新结构化 plan，不写文件。
- `ask_clarification`：进入 waiting user input，不伪造用户回答。

### Repair Loop

输入：

- tool failure。
- policy denial。
- verification failed。
- review request_changes。
- model output parse failure。
- context overflow。

Repair context 必须包含：

- 失败类型。
- 失败 evidence。
- 相关文件 / diff。
- 已尝试路径。
- 不应重复的动作。
- 下一步建议。

## 与其他模块关系

- 依赖 Task Contract 判断范围和验收标准。
- 调用 Context Engine 获取工作集。
- 调用 Model Gateway 获取 ModelDecision。
- 调用 Tool Runtime 执行动作。
- 调用 Policy 判断风险。
- 调用 Verification 和 Review 决定是否完成。
- 产出 Trace 给 Observability。
- 产出状态给 Product UX。

## 实现步骤

1. 扩展 ModelAction 为 ModelDecision。
2. 在 AgentLoop 中引入 phase 状态。
3. 将 tool results、policy denial、edit result、verification result 转为 Observation。
4. 实现 progress check。
5. 增加 before-stop gate：final_response 前检查 evidence。
6. 将 Verification / Review 失败注入下一轮 repair context。
7. 为 max iterations、repeated denial、repeated failure 写清晰 stop reason。

## 测试与验收

单元测试：

- final_response 在未验证时被转入 verification。
- policy denial 转为 Observation。
- repeated failure 触发 repair 或 blocked。
- max iteration 返回明确 reason。

集成测试：

- mock model 先 propose edit，再 claim ready，runtime 触发 verification。
- verification failed 后下一轮模型收到 repair context。
- review finding blocking 时不允许 final。

手工验收：

- 修改代码后测试失败，Agent 不说完成。
- 用户拒绝命令后，Agent 找替代路径或明确 blocked。

## 反模式

- 把 Orchestrator 写成所有逻辑的巨型函数。
- 模型返回 answer 就直接 completed。
- 工具失败只作为纯文本追加。
- 没有 phase，所有工具任何时候都可请求。
- 失败后重复同一动作。
