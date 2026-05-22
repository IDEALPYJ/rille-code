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
- apply edit 成功后自动运行首个可用 verifier。
- UI 展示 verification part。

当前缺口：

- 状态只有 passed/failed/skipped。
- 没有 Evidence 和 VerificationCoverage。
- 没有 before-stop hook。
- 没有关联 Task Contract acceptance criteria。
- 没有 stale evidence 检查。
- 没有 Review gate。

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
  | 'inconclusive'

export interface Evidence {
  id: string
  source: 'command' | 'diagnostics' | 'diff' | 'browser' | 'review' | 'user'
  status: VerificationStatus
  summary: string
  output?: string
  artifactRef?: string
  workspaceState?: RuntimeState
  createdAt: number
}

export interface VerificationCoverage {
  criterionId: string
  evidenceIds: string[]
  status: 'covered' | 'failed' | 'partial' | 'blocked' | 'waived' | 'stale'
  reason: string
}

export interface VerificationGateResult {
  status: VerificationStatus
  coverage: VerificationCoverage[]
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
  -> blocked/inconclusive: ask user or mark blocked
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

1. 扩展 VerificationStatus。
2. 新增 Evidence 和 VerificationCoverage 类型。
3. 增加 diagnostics verifier 和 diff verifier。
4. 在 AgentLoop final 前接入 before-stop hook。
5. 将 verification failed 转为 Observation。
6. UI 增加 coverage card。
7. 支持用户 waiver。

## 测试与验收

单元测试：

- command pass 映射 covered。
- command fail 映射 failed。
- no command 映射 skipped 或 blocked。
- workspace changed 后旧 evidence 标记 stale。
- waived 需要 user decision。

集成测试：

- apply edit 后 typecheck fail 进入 repair。
- final_response 未验证时触发 verifier。
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
