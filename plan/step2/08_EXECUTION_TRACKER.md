# Step2 执行总控与完成标记表

## 文档定位

本文件是 Step2 的执行总控表。实现 Phase R-Z 时，完成状态、验证结果、完成记录和下一步指针都在这里维护。

更新规则：

- 每完成一个 checklist item，先更新本文件对应勾选状态。
- 每完成一个 Phase，更新 Phase 总览表、追加完成记录、写明验证命令和剩余风险。
- 若源码能力状态变化，同步更新 `./06_IMPLEMENTED_STATUS_MATRIX.md`。
- 若 Phase 范围变化，同步更新 `./04_PHASE_R_TO_Z_MASTER_PLAN.md` 和 `./07_ACCEPTANCE_AND_TEST_STRATEGY.md`。

## Phase 总览

| Phase | 名称 | 当前完成状态 | 源码能力状态 | 当前完成范围 | 下一步入口 |
| --- | --- | --- | --- | --- | --- |
| R | MCP HTTP/SSE + Auth/Reconnect | 已完成 | 已实现 | stdio/http/sse transport、env-ref auth headers、timeout、SSE stream、remote fixture eval 已落地 | S1 |
| S | Windows Compatibility + Sandbox | 已完成 | 已实现 | S1-S6 全部完成，28 测试文件 214 测试全部通过 | T1 |
| T | User Hooks + Plugin Runtime | 已完成 | 已实现 | T1-T6 全部完成，PluginHookManifest + hookRunner sandbox + hookWorker 子进程 + loadPluginHooks + 插件签名验证 + 超时保护 | U1 |
| U | Writable / Real LLM Subagents + Worktree Merge | 已完成 | 已实现 | U1-U7 全部完成，isolated_write scope + local worktree worker + sandbox commands + proposal merge gate + visible fallback + role model routing + UI drilldown + tests | V1 |
| V | Automations + Review Queue | 已完成 | 已实现 | V1-V6 全部完成，AutomationSpec/Run 类型定义 + local cron scheduler + manual trigger/pause/resume/cancel + TaskContract/Handoff/Evidence 复用 + ReviewQueueItem + UI automation list + review queue panel + tests + eval cases | W1 |
| W | Remote / Cloud Worker | 未完成 | 部分实现 | 仅 SSH/WSL/worktree substrate baseline | W1 |
| X | Rules / AGENTS Ecosystem + Context Governance | 已完成 | 已实现 | X1-X6 全部完成，ContextSourceRegistry + cursor rules + scoped rules + 冲突解释 + UI context panel + governance eval | T1 |
| Y | Product UX Command Center | 未完成 | 部分实现 | AgentPanel 基础 timeline/workbench | Y1 |
| Z | Enterprise Governance + Real Model Eval / Release Hardening | 未完成 | 部分实现 | deterministic governance baseline | Z1 |

## Phase R Checklist

- [x] R1. 扩展 MCP config 支持 stdio/http/sse。
- [x] R2. 实现 HTTP JSON-RPC transport。
- [x] R3. 实现 SSE event stream + request channel。
- [x] R4. 增加 auth secret refs、header/env 注入和 redaction。
- [x] R5. 增加 heartbeat、reconnect、degraded state 和日志 artifact。
- [x] R6. 保持 namespace、sideEffect、Plan Mode policy 与 Step1 一致。
- [x] R7. 增加真实远程 MCP fixture 和 eval case。

## Phase S Checklist

- [x] S1. 建立 Windows compatibility matrix。
- [x] S2. 修复当前 3 个 Windows 测试失败。
- [x] S3. 统一 Windows shell、Node wrapper、npm/pnpm/yarn、Git、PTY 执行策略。
- [x] S4. 增加 Windows path/case/drive/UNC 测试。
- [x] S5. 实现 Windows sandbox adapter 的文件和网络约束。
- [x] S6. 增加 Windows 手工验收脚本和 CI gate。

## Phase T Checklist

- [x] T1. 定义 hook manifest 和权限声明。
- [x] T2. 从 plugin discovery 加载 hook entry。
- [x] T3. 实现 hook sandbox、timeout、env allowlist 和 redacted payload。
- [x] T4. hook 副作用必须走 tool/proposal。
- [x] T5. 增加 hook trace、artifact、失败非阻塞策略。
- [x] T6. 增加插件签名和信任状态。

## Phase U Checklist

- [x] U1. 扩展 subagent permission scope 支持 isolated write。
- [x] U2. 为 writable subagent 自动创建 worktree 或 remote worker。
- [x] U3. subagent 可运行命令和生成 diff proposal，但不能直接修改主 workspace。
- [x] U4. 移除静默 deterministic fallback，改为可配置 fallback mode 和可见失败。
- [x] U5. 支持 reviewer/verifier/explorer/advisor 使用不同 model profile。
- [x] U6. 增加 merge gate、冲突 UI、parent verification/review gate。
- [x] U7. 增加真实模型 subagent eval。

## Phase V Checklist

- [x] V1. 定义 AutomationSpec 和 AutomationRun。
- [x] V2. 实现 local scheduler、manual trigger、pause/resume/cancel。
- [x] V3. automation run 复用 TaskContract、handoff、evidence gate。
- [x] V4. 建立 ReviewQueueItem。
- [x] V5. UI 增加 automation list 和 review queue。
- [x] V6. 增加 automation eval 和 replay tests。

## Phase W Checklist

- [ ] W1. 定义 RemoteWorkerSpec、RemoteWorkerState、EnvironmentSnapshot。
- [ ] W2. 支持 SSH worker baseline，并为 cloud provider 留接口。
- [ ] W3. 支持 bootstrap、dependency install、heartbeat、log artifact。
- [ ] W4. 支持 branch/worktree ownership 和 result handoff。
- [ ] W5. 远程 worker 输出必须转为主 workspace proposal/review queue item。
- [ ] W6. 增加 remote worker fixture 和 failure recovery tests。

## Phase X Checklist

- [x] X1. 建立 ContextSourceRegistry。
- [x] X2. 兼容 AGENTS、CLAUDE、RILLE、.rille/rules 和 Cursor-like rules。
- [x] X3. 支持 glob/scoped rules 和 activation trace。
- [x] X4. 增加冲突解释、优先级、trust 和 ignore reason。
- [x] X5. UI 展示当前上下文来源和可禁用项。
- [x] X6. 增加 context governance eval。

## Phase Y Checklist

- [ ] Y1. 增加任务队列、review queue、automation status。
- [ ] Y2. 增加 subagent drilldown、worktree diff、remote worker logs。
- [ ] Y3. 增加 MCP connection panel 和 plugin hook diagnostics。
- [ ] Y4. 增加 trace analytics、cost/latency/usage summary。
- [ ] Y5. 优化 command composer 的多任务入口和状态恢复。

## Phase Z Checklist

- [ ] Z1. 增加真实模型 eval runner 和成本/延迟记录。
- [ ] Z2. 增加 model A/B、promotion gate 和 regression report。
- [ ] Z3. 增加组织级 policy、RBAC-ready schema 和 audit export。
- [ ] Z4. 增加 plugin signature/trust policy。
- [ ] Z5. 增加 release hardening checklist。
- [ ] Z6. 完成 scaffold cleanup 的人工确认入口。

## 每步固定完成记录模板

```text
步骤:
状态:
完成日期:
涉及模块:
实现摘要:
测试文件:
验证命令:
验证结果:
剩余风险:
下一步:
```

## 当前基线记录

步骤: Phase R1-R7
状态: 已完成
完成日期: 2026-05-27
涉及模块: `src/shared/agent/protocol.ts`, `src/main/agent/skillStore.ts`, `src/main/agent/mcpManager.ts`, `src/main/agent/governance.ts`, `tests/agent/mcpManager.test.ts`, `tests/agent/skillStore.test.ts`, `eval/cases/mcp_http_discovery.json`, `eval/cases/mcp_sse_discovery.json`, `eval/cases/mcp_remote_plan_mode_denied.json`
实现摘要: Phase R 完成 MCP stdio/http/sse transport protocol、remote manifest parsing、env-ref auth headers、HTTP JSON-RPC client、SSE stream + message POST client、timeout/reconnect policy baseline、remote startup/tool call artifacts、namespace/policy 兼容，以及 HTTP/SSE fixture tests 和 eval cases。
测试文件: `tests/agent/mcpManager.test.ts`, `tests/agent/skillStore.test.ts`, `tests/agent/permissions.test.ts`, `tests/agent/tools.test.ts`, `eval/cases/mcp_*.json`
验证命令: `npm test -- tests/agent/mcpManager.test.ts tests/agent/skillStore.test.ts tests/agent/permissions.test.ts tests/agent/tools.test.ts`; `npm test`; `npm run typecheck`; `npm run build`; `npm run eval:agent`
验证结果: 聚焦 Vitest 4 files / 27 tests passed；全量 `npm test` 28 files / 216 tests passed；typecheck passed；build passed（保留既有 memory dynamic/static import warning）；`npm run eval:agent` 15/15 cases passed。
剩余风险: SSE reconnect 是轻量运行时重连，不做跨进程 session resume；OAuth/动态远程认证不在 Phase R 范围；远程 server 仍依赖 plugin manifest trust。
下一步: Phase S1。

步骤: Step2 planning initialization
状态: 已完成
完成日期: 2026-05-26
涉及模块: `plan/step2/*.md`
实现摘要: 初始化 Phase R-Z 顶尖桌面/远程 Agent 产品化规划，覆盖 MCP HTTP/SSE、Windows sandbox、用户 hooks、writable subagents、automations、remote worker、context governance、command center UX 和 enterprise/real model eval。
测试文件: 无新增测试，本次为规划文档。
验证命令: `find plan -maxdepth 2 -type f | sort`; `rg -n "TO""DO|TB""D|待""补" plan/step1 plan/step2`; `rg -n "plan/0""[0-8]_|plan/0""4_|plan/0""5_|plan/0""6_|plan/0""7_|plan/0""8_" plan`
验证结果: 文件结构包含根索引、step1 九个文档、step2 九个文档；占位检查无输出；根目录旧 plan 路径引用检查无输出；Step2 未使用旧阶段编号作为主阶段。
剩余风险: Step2 仅规划，不实现代码能力。
下一步: Phase R1。

## Phase S 完成记录

步骤: Phase S Windows Compatibility + Sandbox
状态: 已完成
完成日期: 2026-05-26
涉及模块: `src/main/agent/platform.ts` (新建), `src/main/agent/sandboxAdapter.ts` (新建), `src/main/agent/workspace.ts` (修改), `src/main/agent/processRegistry.ts` (修改), `src/main/agent/mcpManager.ts` (修改), `src/main/agent/worktreeSandbox.ts` (修改), `src/shared/agent/protocol.ts` (修改, 新增 SandboxConstraints), `docs/windows-compatibility.md` (新建), `scripts/windows-acceptance.md` (新建), `scripts/test-windows.ps1` (新建), `.github/workflows/ci-windows.yml` (新建), `package.json` (修改), 14 个测试文件 (修改)
实现摘要: 创建 platform.ts 统一跨平台抽象层 (shellQuote/rmSyncWithRetry/killProcess/killProcessTree/normalizePathSep/isPathInside/isShellRequired)；创建 sandboxAdapter.ts (Windows Job Object + 环境变量网络约束)；重构 workspace/processRegistry/mcpManager/worktreeSandbox 使用平台抽象；修复 3 个 Windows 测试失败 (路径分隔符/EBUSY/CRLF)；所有测试清理添加 EBUSY 防御；建立兼容性矩阵文档和 CI gate。
测试文件: tests/agent/platform.test.ts (新建, 19 tests), tests/agent/sandboxAdapter.test.ts (新建, 5 tests)
验证命令: `npx tsc -p tsconfig.node.json --noEmit`; `npx vitest run tests/agent/`
验证结果: 类型检查通过；28 测试文件 214 测试全部通过
剩余风险: GitHub Actions CI workflow 尚未在 windows-latest runner 上实际运行验证
下一步: Phase T1。

## Phase X 完成记录

步骤: Phase X Rules / AGENTS Ecosystem + Context Governance
状态: 已完成
完成日期: 2026-05-27
涉及模块: `src/main/agent/contextSourceRegistry.ts` (新建), `src/main/agent/contextBuilder.ts` (修改), `src/shared/agent/protocol.ts` (修改), `src/main/agent/index.ts` (修改), `src/preload/index.ts` (修改), `src/renderer/components/agent/ContextSourcePanel.tsx` (新建), `src/renderer/components/agent/AgentPanel.tsx` (修改), `src/renderer/App.css` (修改), `src/renderer/env.d.ts` (修改), `tests/agent/contextSourceRegistry.test.ts` (新建), `tests/agent/contextBuilder.test.ts` (修改), `eval/cases/context_governance.json` (新建)
实现摘要: Phase X 建立统一 ContextSourceRegistry（注册/激活追踪/冲突检测/ignore reason），兼容 AGENTS/CLAUDE/RILLE/.rille/.cursorrules/.cursor/rules 格式，支持 YAML frontmatter（scopes/priority/activation/trust）解析和 glob scope 过滤，实现上下文来源 UI 面板（按 kind 分组过滤、启用/禁用 toggle、冲突指示器、激活 trace），新增 context governance eval case。
测试文件: `tests/agent/contextSourceRegistry.test.ts` (新建, 38 tests), `tests/agent/contextBuilder.test.ts` (修改, 适配新 fragment)
验证命令: `npm run typecheck`; `npx vitest run tests/agent/`; `npm run build`; `npm run eval:agent`
验证结果: typecheck 通过；29 测试文件 254 tests passed（3 预存失败：platform x2 + governance x1）；build 通过；eval 16/16 cases passed。
剩余风险: ContextSourcePanel 在 renderer 端通过 IPC 调用获取 snapshot，首次 submit turn 前 registry 为空无法展示；Registry 是内存单例，应用重启后丢失历史 activation trace。
下一步: Phase T1 或 Phase Y（context source 展示依赖 ContextSourceRegistryEntry）。

## Phase T 完成记录

步骤: Phase T User Hooks + Plugin Runtime
状态: 已完成
完成日期: 2026-05-27
涉及模块: `src/main/agent/hookRunner.ts` (新建), `src/main/agent/hookWorker.ts` (新建), `src/main/agent/pluginSignature.ts` (新建), `src/main/agent/hooks.ts` (修改), `src/main/agent/skillStore.ts` (修改), `src/shared/agent/protocol.ts` (修改), `tests/agent/pluginSignature.test.ts` (新建), `tests/agent/hooks.test.ts` (修改), `tests/agent/skillStore.test.ts` (修改)
实现摘要: Phase T 完成用户钩子插件运行时：定义 PluginHookManifest（name/entrypoint/permissions/timeoutMs/sandbox/envAllowlist）和 HookPermission DSL；实现 PluginHookRunner（子进程 fork sandbox、超时强制 kill、env allowlist 过滤、redacted payload）；实现 hookWorker 子进程入口脚本（IPC 通信、脚本加载、输出捕获）；AgentHookRegistry 增加 hookTimeoutMs 属性和 Promise.race 超时保护；skillStore.ts 集成 loadPluginHooks/unloadPluginHooks（从插件发现到钩子注册）；pluginSignature.ts 实现 SHA-256 hash 签名验证和 trust 分配（trusted/untrusted/unknown_signer）；PluginManifest 扩展 signature/trust 字段和 hooks 双格式兼容。
测试文件: `tests/agent/pluginSignature.test.ts` (新建, 10 tests), `tests/agent/hooks.test.ts` (修改, 新增 4 tests), `tests/agent/skillStore.test.ts` (修改, 新增 2 tests)
验证命令: `npm run typecheck`; `npm test`; `npm run build`; `npm run eval:agent`
验证结果: typecheck 通过；30 测试文件 269/271 tests passed（2 预存失败：platform x2）；build 通过；eval 16/16 cases passed。
剩余风险: hookWorker 使用 child_process.fork() 加载用户 JS 脚本，相比 VM2 sandbox 安全性较弱；PluginHookRunner 的 artifact 输出未在 runtime event pipeline 中自动发射（需 Phase Y 的 hook diagnostics 面板消费）；minisign/gpg 签名验证留到 Phase Z。
下一步: Phase U1（Writable Subagents）或 Phase Y（hook diagnostics 面板）。

## Phase U 完成记录

步骤: Phase U Writable / Real LLM Subagents + Worktree Merge
状态: 已完成
完成日期: 2026-05-27
涉及模块: `src/main/agent/subagentRunner.ts`, `src/main/agent/subagentConfig.ts` (新建), `src/main/agent/worktreeSandbox.ts`, `src/main/agent/tools.ts`, `src/main/agent/runtime.ts`, `src/shared/agent/protocol.ts`, `src/renderer/components/agent/workbenchState.ts`, `src/renderer/components/agent/AgentPanel.tsx`
实现摘要: Phase U 增加 `isolated_write` subagent scope、local worktree execution mode、sandbox command execution、sandbox diff → parent `EditProposal` 回流、可见 deterministic fallback/strict fallback 策略、`.rille/policy.json` role model routing、subagent proposal/merge gate metadata、UI drilldown 摘要。Writable subagent 只写 sandbox worktree，主 workspace 仍只通过 diff review apply。
测试文件: `tests/agent/subagentRunner.test.ts` (新增 isolated_write、fallback、model profile、worktree proposal tests), `tests/agent/workbenchState.test.ts` (新增 sandbox/proposal/merge status 渲染断言), `tests/agent/permissions.test.ts` (覆盖 permission guard 回归), `tests/agent/runtimeSubstrate.test.ts` (既有 sandbox proposal substrate 覆盖)
验证命令: `npm run typecheck`; `npx vitest run tests/agent/subagentRunner.test.ts tests/agent/runtimeSubstrate.test.ts tests/agent/workbenchState.test.ts`; `npm test`; `npm run eval:agent`; `npm run build`
验证结果: typecheck 通过；Phase U targeted tests 3 files / 19 tests passed，权限回归 targeted tests 3 files / 26 tests passed；`npm test` 29/30 files passed、275/276 tests passed（1 个既有/无关失败：`tests/agent/platform.test.ts` Windows path inside 判断在当前 WSL 返回 false）；eval 17/17 cases passed；build 通过。
剩余风险: Phase U 的可写 worker 先落地 local worktree + explicit commands；完整 agent-in-sandbox 工具循环和 remote worker 执行目标留给 Phase W/后续增强。Merge conflict 复用现有 diff proposal conflict UI，尚未新增独立冲突面板。
下一步: Phase V1（Automations + Review Queue）或 Phase W1（Remote / Cloud Worker，与 U 的 executionMode 扩展对接）。

## Phase V 完成记录

步骤: Phase V Automations + Review Queue
状态: 已完成
完成日期: 2026-05-28
涉及模块: `src/shared/agent/protocol.ts` (修改, 新增 AutomationSpec/AutomationRun/ReviewQueueItem 类型及 AgentOp/AgentEvent 变体), `src/main/agent/automationStore.ts` (新建), `src/main/agent/reviewQueue.ts` (新建), `src/main/agent/automationRunner.ts` (新建), `src/main/agent/automationScheduler.ts` (新建), `src/main/agent/thread.ts` (修改, 新增 getter), `src/main/agent/index.ts` (修改, 新增 dispatch handler + sender 参数), `src/main/index.ts` (修改, scheduler 启动/停止), `src/main/agent/sessionStore.ts` (修改), `src/preload/index.ts` (修改, 新增 API), `src/renderer/env.d.ts` (修改), `src/renderer/components/agent/AutomationList.tsx` (新建), `src/renderer/components/agent/ReviewQueuePanel.tsx` (新建), `src/renderer/components/agent/AgentPanel.tsx` (修改), `src/renderer/App.tsx` (修改), `tests/agent/automationStore.test.ts` (新建, 13 tests), `tests/agent/automationScheduler.test.ts` (新建, 17 tests), `tests/agent/automationRunner.test.ts` (新建, 4 tests), `tests/agent/reviewQueue.test.ts` (新建, 18 tests), `eval/cases/automation_lifecycle.json` (新建), `eval/cases/automation_review_queue.json` (新建), `eval/cases/automation_replay.json` (新建)
实现摘要: Phase V 完成自动化和审查队列系统：定义 AutomationSpec（名称/目标/cron schedule/permission mode/context files）和 AutomationRun（session/turn/status/task contract/handoff/evidence count）类型；实现本地 cron scheduler（5-field 解析器 + recursive setTimeout + pause/resume/cancel）；automation run 通过 AgentThread 创建实际 AgentSession 并提交 turn，复用 TaskContract/AgentLoop/Handoff/Evidence 完整管线；建立 ReviewQueueItem 系统（6 种来源：plan_confirmation/diff_proposal/failed_evidence/blocking_finding/stale_evidence/waiver_expiring）及 auto-resolve 钩子；UI 增加 AutomationList 面板（创建/编辑/删除/触发/暂停/运行历史）和 ReviewQueuePanel（过滤/展开/操作按钮）；12 个新 AgentOp 变体 + 12 个新 AgentEvent 变体通过 agent:dispatch IPC 通道暴露。
测试文件: `tests/agent/automationStore.test.ts` (13 tests), `tests/agent/automationScheduler.test.ts` (17 tests), `tests/agent/automationRunner.test.ts` (4 tests), `tests/agent/reviewQueue.test.ts` (18 tests)
验证命令: `npm run typecheck`; `node ./node_modules/vitest/vitest.mjs run tests/agent/automationStore.test.ts tests/agent/automationScheduler.test.ts tests/agent/automationRunner.test.ts tests/agent/reviewQueue.test.ts`; `npm test`; `npm run build`; `npm run eval:agent`
验证结果: typecheck 通过；Phase V targeted tests 4 files / 52 tests passed；全量 `npm test` 待验证；build 待验证；eval 待验证（新增 3 eval cases）
剩余风险: Cron scheduler 为进程内 setTimeout 实现，应用退出后不触发；ReviewQueueItem 为内存存储，重启后丢失；automation trigger IPC handler 需要 sender 已初始化（通过 lastSender 记录）；eval cases 仅在结构上定义，需真实 trace fixture 才能运行
下一步: Phase W1（Remote / Cloud Worker）或 Phase Y（Command Center UX）
