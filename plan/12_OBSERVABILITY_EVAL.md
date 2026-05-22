# Observability、Trace 与 Eval 模块设计

## 目标

Observability 模块让 Agent 的行动过程可见、可复盘、可恢复、可评估。

它解决：

- 只保存最终回答，无法知道失败在哪一层。
- Context、Model、Tool、Policy、Runtime、Verification、Review 之间缺少可追踪关系。
- 成本、延迟、重复工具调用和失败重试无法分析。
- Eval 只看最终输出，不看 trajectory。

它不解决：

- 不替代业务日志系统。
- 不默认导出敏感 raw prompt。
- 不替代用户可见 UI。
- 不替代自动化测试。

## 当前基线

当前已有：

- AgentEvent 事件流。
- JSONL append/read/replay。
- schemaVersion 和 sequence。
- stage、tool started/completed、approval、edit、verification events。
- AgentPanel timeline 展示。

当前缺口：

- 没有 ContextTrace。
- 没有 ModelCallTrace / usage。
- 没有 PolicyTrace。
- 没有 Evidence coverage trace。
- 没有 Eval 数据集和 regression harness。
- 没有 debug export。

## 设计原则

1. Trace 不是附加日志，而是 Agent 基础能力。
2. 记录关键决策，不记录无意义噪声。
3. 用户视图和开发者 debug 视图分层。
4. Trace 可能含敏感信息，必须支持 redaction。
5. Eval 同时评估 final state 和 trajectory。
6. 失败必须能归因到模块。

## 核心数据结构

```ts
export type TraceEvent =
  | { type: 'task.created'; contractId: string; summary: string }
  | { type: 'context.built'; trace: ContextTrace }
  | { type: 'model.called'; trace: ModelCallTrace }
  | { type: 'tool.executed'; callId: string; name: string; status: string; durationMs?: number }
  | { type: 'policy.decided'; decision: PolicyDecision }
  | { type: 'runtime.state'; stateRef: string; summary: string }
  | { type: 'verification.coverage'; coverage: VerificationCoverage[] }
  | { type: 'review.completed'; result: ReviewResult }
  | { type: 'cost.updated'; usage: AgentUsage }

export interface AgentUsage {
  inputTokens?: number
  outputTokens?: number
  cachedInputTokens?: number
  costUsd?: number
  latencyMs?: number
}

export interface EvalCase {
  id: string
  title: string
  task: string
  workspaceFixture?: string
  expectedTrajectory: string[]
  expectedEvidence: string[]
  safetyExpectations: string[]
}
```

## 运行流程

```text
agent action happens
  -> emit domain event
  -> derive trace event
  -> persist JSONL
  -> redact sensitive payloads for user/debug views
  -> aggregate session trace summary
  -> feed eval and debug views
```

### Debug 归因路径

失败时按层排查：

```text
Task Contract 是否错
Context 是否缺关键事实
ModelDecision 是否非法
Tool 是否不可用或输出不可行动
Policy 是否过严或过松
Runtime 是否环境异常
Verification 是否跑错检查
Review 是否漏风险
Memory 是否污染上下文
```

### Eval 指标

```text
task success
scope control
tool appropriateness
context quality
failure recovery
verification coverage
review quality
policy compliance
cost / latency
resume reliability
```

## 与其他模块关系

- 每个模块都产出 trace。
- SessionStore 持久化 trace。
- Product UX 消费 trace summary。
- Eval 使用 trace 评估 trajectory。
- Memory 可引用 trace source refs。
- Policy 控制 trace redaction 和 export。

## 实现步骤

1. 定义 TraceEvent。
2. 将现有 AgentEvent 映射到 trace view。
3. 增加 context trace 和 model trace。
4. 增加 usage/cost event。
5. 增加 debug export，默认 redacted。
6. 建立 eval case 目录和 replay runner。
7. 将真实失败案例加入 regression eval。

## 测试与验收

单元测试：

- JSONL sequence 连续。
- trace redaction 移除 secret-like 内容。
- context trace 包含 included/excluded。
- cost event 聚合正确。

集成测试：

- 一次 edit+verify 任务能导出完整 trace。
- replay 能恢复 timeline 和 pending proposal。
- eval case 能判断缺失 verification。

手工验收：

- 失败任务能看出失败来自权限、验证还是模型输出。
- 用户视图不暴露敏感 raw prompt。

## 反模式

- 只记录最终回答。
- Trace 太杂但没有阶段和决策。
- Debug export 泄漏 secret。
- Eval 只看 final answer。
- 无法从失败定位到具体模块。
