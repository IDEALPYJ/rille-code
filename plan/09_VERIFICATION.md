# Verification 模块设计

## 目标

Verification 负责判断任务是否由 evidence 证明完成。

它解决：

- 模型说完成就结束。
- 跑了无关测试却声称验证充分。
- 测试失败仍 final。
- 长任务中“已实现未验证”被误标为完成。
- evidence 无法追溯到命令、文件、diff 或环境。

它不解决：

- 不负责实现代码。
- 不判断实现是否优雅。
- 不替代 Review。
- 不替代用户对无法自动验证事项的判断。

## 当前基线

当前已有：

- `VerificationResult` 包含 id、sessionId、turnId、verifier、command、status、output、exitCode、duration。
- `VerifierRunner` 从 `.rille/policy.json` 的 verification commands 或 `package.json` scripts 发现命令。
- `VerifierRunner` 可同时返回 legacy `VerificationResult` 和 command Evidence。
- apply edit 成功后自动运行首个可用 verifier，并持久化 Evidence。
- AgentLoop 会从 diagnostics、command、diff/proposal 生成 Evidence，并在 final answer 前执行 before-stop gate。
- Coverage 会按 Task Contract acceptance criteria 聚合 Evidence。
- UI 展示 verification part、evidence coverage card。

当前缺口：

- 用户 waiver 只有状态预留，尚无交互 UI。
- stale evidence 的 workspace freshness 检查留到 Phase H。
- Evidence output 没有 artifactRef 存储，仍使用现有截断策略。

## 设计原则

1. 完成必须由 evidence 支撑。
2. Verification 不等于测试命令成功。
3. Evidence 必须关联当前 workspace 状态。
4. 失败结果进入 repair context。
5. 低风险任务可轻量验证，高风险任务需要多证据。
6. Waiver 必须显式记录。

## 核心数据结构

```ts
export type VerificationStatus =
  | 'passed'
  | 'failed'
  | 'skipped'
  | 'partial'
  | 'blocked'
  | 'stale'
  | 'waived'

export interface Evidence {
  id: string
  sessionId: string
  turnId: string
  source: 'command' | 'diagnostics' | 'diff' | 'browser' | 'review' | 'user'
  status: VerificationStatus
  summary: string
  output?: string
  artifactRef?: string
  data?: Record<string, unknown>
  createdAt: number
}

export interface VerificationCoverage {
  contractId: string
  criteria: Array<{
    criterionId: string
    evidenceIds: string[]
    status: 'covered' | 'failed' | 'partial' | 'blocked' | 'waived' | 'stale'
    reason: string
  }>
  updatedAt: number
}

export interface VerificationGateResult {
  status: VerificationStatus
  coverage: VerificationCoverage | null
  evidence: Evidence[]
  nextAction: 'allow_final' | 'repair' | 'run_more_checks' | 'ask_user' | 'blocked'
}
```

## 运行流程

```text
code changed or model claims ready
  -> collect acceptance criteria
  -> discover relevant verifiers
  -> run diagnostics / command / diff checks
  -> create Evidence
  -> map evidence to criteria
  -> compute VerificationCoverage
  -> passed: allow review/final
  -> failed/partial: create repair context
  -> blocked: ask user or mark blocked
```

### Before-stop hook

在 final_response 前执行：

```text
if code_changed:
  if no evidence:
    run verifier or ask user
  if evidence failed:
    block final and enter repair
  if evidence partial:
    final only with explicit risk/waiver
```

### Verifier 类型

```text
diagnostics_verifier
typecheck_verifier
test_verifier
lint_verifier
build_verifier
diff_verifier
browser_verifier
security_verifier
```

## 与其他模块关系

- Task Contract 提供 acceptance criteria。
- Execution Runtime 运行命令并记录环境。
- Tool Runtime 提供 diagnostics、diff、command results。
- Review 使用 Verification evidence。
- Context Engine 把失败 evidence 注入 repair context。
- Product UX 展示 coverage 和 evidence。

## 实现步骤

1. 已扩展 VerificationStatus。
2. 已新增 Evidence、VerificationCoverage 和 VerificationGateResult 类型。
3. 已增加 diagnostics evidence 和 diff/proposal evidence。
4. 已在 AgentLoop final 前接入 before-stop hook。
5. 已将 verification failed/blocked 转为 Observation。
6. UI 已增加 coverage card。
7. 用户 waiver 只有状态预留，完整交互留待后续。

## 测试与验收

单元测试：

- command pass 映射 covered。
- command fail 映射 failed。
- no command 映射 skipped 或 blocked。
- stale / waived 作为协议状态可 replay；完整交互和 freshness 检查留待后续。

集成测试：

- apply edit 后 typecheck fail 进入 repair。
- final_response 未验证时触发 before-stop gate 并进入 repair context。
- diff verifier 发现无关文件修改。

手工验收：

- 修改 TypeScript 后最终回答包含实际验证命令。
- 测试失败时 Agent 不声称完成。
- 用户接受未验证风险时 final 明确显示 waiver。

## 反模式

- 模型说完成就完成。
- 只跑最方便的测试。
- 跑了测试但不关联验收标准。
- Evidence 没有命令、时间、workspace 信息。
- 把 Review 当 Verification。

## 完成记录

- 2026-05-23：Phase G 已完成 Verification foundation。新增 Evidence、VerificationCoverage、VerificationGateResult 和相关事件；VerifierRunner 支持 command Evidence；AgentLoop 会生成 diagnostics / command / diff Evidence，并在 final 前执行 before-stop gate；failed/blocked/partial coverage 会按最终 Agent 标准阻止任务完成并注入 repair context；缺少检查时 final gate 会自动运行一次项目 verifier；coverage card 已接入 AgentPanel。剩余 stale workspace freshness、waiver UI 和 artifactRef 存储进入后续阶段。
- 2026-05-23：按最终完整 Agent 标准硬化 Phase G。Coverage 现在按 acceptance criterion 的每个 `evidenceRequired` 类型逐项覆盖，重复 command evidence 不能代替 diagnostics；任何 failed/blocked evidence 都会阻止 final；proposal diff 与 applied/workspace diff 分层，未应用的 edit proposal 不再被视为任务已完成。
