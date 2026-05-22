# Review 与质量门模块设计

## 目标

Review 模块判断实现是否值得接受，而不只是行为是否可能通过。

它解决：

- 测试通过但实现越界、过度重构或破坏架构。
- Coder 自己解释自己的 diff，缺少独立判断。
- Review 问题只是给用户看的文字，不能进入 repair loop。
- blocking issue 和 suggestion 混在一起。

它不解决：

- 不替代 Verification。
- 不直接执行修复。
- 不替代用户对产品取舍的最终判断。
- 不默认引入独立子代理。

## 当前基线

当前已有：

- Diff proposal 和 Monaco diff review。
- Apply / Reject / Reject with reason / Rollback。
- Verification part 展示。
- Agent final 文本可总结改动。

当前缺口：

- 没有 ReviewFinding 类型。
- 没有独立 review gate。
- 没有 review category、severity、blocking 标记。
- 没有 review issue -> repair context。
- 没有 high-risk diff 自动触发 review。

## 设计原则

1. Verification 证明目标是否达成，Review 判断实现是否可接受。
2. Review 必须基于 Task Contract、diff、evidence 和项目约定。
3. Review 输出要可行动。
4. Blocking 和 suggestion 分开。
5. 大 diff、高风险文件、重复失败需要更强 Review。
6. Reviewer 结果不是事实，仍需主 Agent 裁决。

## 核心数据结构

```ts
export interface ReviewFinding {
  id: string
  sessionId: string
  turnId: string
  category: 'scope' | 'architecture' | 'behavior' | 'security' | 'testing' | 'maintainability' | 'evidence'
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical'
  blocking: boolean
  title: string
  body: string
  filePath?: string
  range?: AgentTextRange
  evidenceRefs: string[]
  recommendation?: string
  status: 'open' | 'fixed' | 'accepted_risk' | 'dismissed'
  createdAt: number
}

export interface ReviewResult {
  id: string
  sessionId: string
  turnId: string
  status: 'approved' | 'request_changes' | 'needs_more_verification' | 'out_of_scope' | 'blocked'
  findingIds: string[]
  summary: string
  createdAt: number
}
```

## 运行流程

```text
verification passed or large/risky diff
  -> collect review context
  -> run rule-based checks
  -> optional reviewer model/advisor
  -> create ReviewFindings
  -> aggregate and rank
  -> approved: allow final
  -> request_changes: create repair context
  -> needs_more_verification: route to Verification
```

### Review 检查项

- Scope：是否服务 Task Contract，是否修改无关文件。
- Diff 合理性：是否过大、重复、不必要重构。
- 架构边界：是否绕过已有 abstraction。
- 行为风险：是否改变现有 API 或用户行为。
- 安全风险：auth、permission、secret、command、network。
- 测试缺口：是否缺少相关验证。
- 可维护性：命名、复杂度、依赖和风格。
- Evidence 一致性：报告是否和 diff / evidence 一致。

## 与其他模块关系

- Task Contract 提供 scope 和 non-goals。
- Verification 提供 evidence。
- Context Engine 为 reviewer 构造 review context。
- Orchestrator 根据 ReviewResult 决定 final 或 repair。
- Product UX 展示 findings。
- Memory 保存被确认的重要设计决策。

## 实现步骤

1. 新增 ReviewFinding 和 ReviewResult 类型。
2. 实现基础 rule-based diff review。
3. 触发条件：large diff、高风险路径、verification partial、高风险 task。
4. UI 增加 Review card。
5. Blocking finding 转 Observation。
6. Repair context 注入 finding。
7. 后续接入 reviewer model 或 advisor。

## 测试与验收

单元测试：

- out-of-scope file 生成 blocking finding。
- missing verification 生成 needs_more_verification。
- low severity suggestion 不阻止 final。
- accepted_risk 需要用户决策。

集成测试：

- Review request_changes 后 Agent 下一轮修复。
- high-risk file 修改自动触发 Review。
- final report 包含 open risk。

手工验收：

- 大 diff 时 UI 展示 Review findings。
- Review 问题修复后状态变为 fixed。

## 反模式

- Coder 自己 review 自己。
- Review 只看模型总结，不看 diff。
- 把风格建议当 blocking。
- Review finding 不进入 repair loop。
- 子代理 review 结果未经主 Agent 裁决。
