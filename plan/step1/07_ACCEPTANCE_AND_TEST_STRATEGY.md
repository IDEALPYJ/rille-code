# V2 验收与测试策略

## 总原则

1. 文档只标“已实现”时必须能指向源码和测试证据。
2. 新协议必须补 replay 兼容测试。
3. 新 runtime 行为必须补 unit 或 integration test。
4. 新 UI 状态必须能从 event replay 恢复；无法自动化时记录手工验收。
5. Agent 行为改动必须逐步进入 eval case，而不是只依赖单元测试。

## 文档验收

只新增或修改 `plan` 文档时运行：

```bash
rg -n "TO""DO|TB""D|待""补" plan/step1 plan/step2
rg -n "下一步.*Phase ""K|Phase ""K.*下一步" plan/step1
rg -n "已实现|部分实现|未实现" plan/step1/06_IMPLEMENTED_STATUS_MATRIX.md
```

预期：

- 第一条无输出。
- 第二条无输出。
- 第三条列出状态矩阵中的状态标记。

## 基础代码验收

涉及代码时运行：

```bash
npm test
npm run typecheck
```

涉及 renderer、Electron/Vite、preload、协议 UI 集成时再运行：

```bash
npm run build
```

## Phase 测试策略

| Phase | 测试重点 |
| --- | --- |
| A | 文档一致性、产品边界 review。 |
| B | JSONL append/replay、schemaVersion、sequence、session resume/archive。 |
| C | workspace path guard、remote route、command timeout、output cap、checkpoint restore。 |
| D | provider adapters、stream delta parse、native tools、fallback reason、usage/cache metrics。 |
| E | tool validation、runtime-only deny、artifactRef、tool search、组合工具效果。 |
| F | policy rule match、BashArity、grant expiry、Guardian/classifier、secret redaction。 |
| G | contract creation/update、`/plan` planning shortcut、confirmation gate、plan/evidence binding。 |
| H | fragment priority、cacheKey、included/excluded trace、untrusted data、LSP/MCP fragments。 |
| I | diff proposal、dirty guard、rollback、side-git/checkpoint、worktree patch merge。 |
| J | evidence mapping、coverage gate、browser/user evidence、waiver、artifact-backed output。 |
| K | rule review、LLM evaluator parse/merge、blocking behavior、accepted risk、reviewer subagent。 |
| L | handoff、feature list、memory stale/superseded、compaction boundary、remote compact. |
| M | trace redaction、hooks、single-step eval、full-turn eval、fixture setup/teardown。 |
| N | event reducer、streaming UI、session card、composer parsing、trace view、subagent tree。 |
| O | skill discovery、activation trace、plugin manifest、MCP lifecycle、namespace policy。 |
| P | subagent isolation、permission-scoped tools、parallel scheduling、merge gate、advisor-only behavior。 |
| Q | feature lifecycle、config audit、model upgrade eval, migration compatibility。 |

## Eval Case 类型

### Single-step eval

验证模型在特定上下文下第一步是否选择正确动作。

示例：

- 用户要求“只规划不要修改”时，模型只做只读探索并输出计划，而不是 propose edit。
- 高风险命令出现时，runtime 请求 approval 或 deny。
- 需要读文件时选择 read/search，而不是直接猜测。

### Full-turn eval

验证完整任务能否完成。

示例：

- 修复一个小 TypeScript 类型错误。
- 修改一个 UI 文案并通过 build。
- 生成 diff proposal，被 apply 后运行 verifier。

### Multi-turn eval

验证跨 turn 记忆、handoff、resume。

示例：

- 第一轮实现未验证，第二轮继续验证并标记 verified。
- 用户 reject with reason 后，Agent 修正 proposal。
- Resume 后发现 workspace stale 并重新读取文件。

### Safety eval

验证 policy 和安全边界。

示例：

- destructive command 被 deny。
- runtime-only tool 被模型请求时拒绝。
- 读取 protected path 被拦截。
- prompt injection 出现在 tool output 时不被当作 instruction。
- workspace grant 只在同一 workspace key 和匹配 pattern 下生效。
- redirect、pipe、subshell、publish/deploy 被 BashArity/Guardian 标为 ask/deny。
- sandboxRequired 命令在 sandbox 不可用时 fail closed。

### Tool eval

验证工具设计是否让 Agent 更高效。

示例：

- `explore_codebase` 比多次 read/search 更少 token。
- `verify_changes` 正确收集 diff、diagnostics、command evidence。
- deferred tool 能被 `search_tools` 命中且不进入稳定 prompt。
- 组合工具 trajectory 包含底层 read/search/verification evidence，而不是只看最终自然语言答案。
- 大输出通过 ArtifactRef 引用，eval 校验 hash/size/redacted metadata。

### Model gateway eval

验证 provider adapter、streaming 和 fallback 是否稳定。

示例：

- OpenAI Responses payload 正确包含 instructions、input、function tools 和 prompt cache key。
- SSE semantic events 能聚合 text delta、tool argument delta、completed/failed。
- 429、5xx、empty response 和 unsupported streaming 产生 ProviderFallbackTrace。
- usage/cache metrics 写入 AgentUsage 和 TraceEvent。

## EvalCase V2 草案

```ts
interface EvalCaseV2 {
  id: string
  title: string
  task: string
  workspaceFixture?: string
  setupCommands?: string[]
  teardownCommands?: string[]
  stopAfter?: 'first_model_decision' | 'first_tool_call' | 'turn_complete' | 'session_complete'
  expectedTrajectory?: string[]
  expectedEvidence?: string[]
  expectedFindings?: string[]
  expectedState?: Record<string, unknown>
  forbiddenActions?: string[]
  assertions: Array<{
    kind: 'regex' | 'json_path' | 'trace_contains' | 'file_contains' | 'llm_judge'
    target: string
    expected: string
  }>
}
```

## 手工验收场景

每个大里程碑至少手工验收：

- 从用户输入到 TaskContract/Plan 展示。
- 工具执行和 approval 展示。
- Diff proposal、apply、verification、review、final。
- Reject with reason 后进入 repair。
- Resume session 后状态恢复。
- Trace export 不泄漏 raw secret。

## Release Gate

进入稳定版前必须满足：

- `npm test` passed。
- `npm run typecheck` passed。
- 涉及 UI 时 `npm run build` passed。
- 关键 eval suite passed。
- 文档状态矩阵与源码事实一致。
- 新增 Phase 的完成记录包含剩余风险。
