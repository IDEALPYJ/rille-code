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
| R | MCP HTTP/SSE + Auth/Reconnect | 未完成 | 未实现 | 仅 Step1 stdio MCP baseline | R1 |
| S | Windows Compatibility + Sandbox | 未完成 | 部分实现 | 存在局部 Windows 兼容逻辑，仍有测试失败 | S1 |
| T | User Hooks + Plugin Runtime | 未完成 | 未实现 | 仅内部 hook registry 和 manifest 字段 | T1 |
| U | Writable / Real LLM Subagents + Worktree Merge | 未完成 | 部分实现 | 只读 subagent 和 deterministic fallback baseline | U1 |
| V | Automations + Review Queue | 未完成 | 未实现 | 仅 handoff/session/evidence 基线 | V1 |
| W | Remote / Cloud Worker | 未完成 | 部分实现 | 仅 SSH/WSL/worktree substrate baseline | W1 |
| X | Rules / AGENTS Ecosystem + Context Governance | 未完成 | 部分实现 | 已有 rules collector，无统一治理 | X1 |
| Y | Product UX Command Center | 未完成 | 部分实现 | AgentPanel 基础 timeline/workbench | Y1 |
| Z | Enterprise Governance + Real Model Eval / Release Hardening | 未完成 | 部分实现 | deterministic governance baseline | Z1 |

## Phase R Checklist

- [ ] R1. 扩展 MCP config 支持 stdio/http/sse。
- [ ] R2. 实现 HTTP JSON-RPC transport。
- [ ] R3. 实现 SSE event stream + request channel。
- [ ] R4. 增加 auth secret refs、header/env 注入和 redaction。
- [ ] R5. 增加 heartbeat、reconnect、degraded state 和日志 artifact。
- [ ] R6. 保持 namespace、sideEffect、Plan Mode policy 与 Step1 一致。
- [ ] R7. 增加真实远程 MCP fixture 和 eval case。

## Phase S Checklist

- [ ] S1. 建立 Windows compatibility matrix。
- [ ] S2. 修复当前 3 个 Windows 测试失败。
- [ ] S3. 统一 Windows shell、Node wrapper、npm/pnpm/yarn、Git、PTY 执行策略。
- [ ] S4. 增加 Windows path/case/drive/UNC 测试。
- [ ] S5. 实现 Windows sandbox adapter 的文件和网络约束。
- [ ] S6. 增加 Windows 手工验收脚本和 CI gate。

## Phase T Checklist

- [ ] T1. 定义 hook manifest 和权限声明。
- [ ] T2. 从 plugin discovery 加载 hook entry。
- [ ] T3. 实现 hook sandbox、timeout、env allowlist 和 redacted payload。
- [ ] T4. hook 副作用必须走 tool/proposal。
- [ ] T5. 增加 hook trace、artifact、失败非阻塞策略。
- [ ] T6. 增加插件签名和信任状态。

## Phase U Checklist

- [ ] U1. 扩展 subagent permission scope 支持 isolated write。
- [ ] U2. 为 writable subagent 自动创建 worktree 或 remote worker。
- [ ] U3. subagent 可运行命令和生成 diff proposal，但不能直接修改主 workspace。
- [ ] U4. 移除静默 deterministic fallback，改为可配置 fallback mode 和可见失败。
- [ ] U5. 支持 reviewer/verifier/explorer/advisor 使用不同 model profile。
- [ ] U6. 增加 merge gate、冲突 UI、parent verification/review gate。
- [ ] U7. 增加真实模型 subagent eval。

## Phase V Checklist

- [ ] V1. 定义 AutomationSpec 和 AutomationRun。
- [ ] V2. 实现 local scheduler、manual trigger、pause/resume/cancel。
- [ ] V3. automation run 复用 TaskContract、handoff、evidence gate。
- [ ] V4. 建立 ReviewQueueItem。
- [ ] V5. UI 增加 automation list 和 review queue。
- [ ] V6. 增加 automation eval 和 replay tests。

## Phase W Checklist

- [ ] W1. 定义 RemoteWorkerSpec、RemoteWorkerState、EnvironmentSnapshot。
- [ ] W2. 支持 SSH worker baseline，并为 cloud provider 留接口。
- [ ] W3. 支持 bootstrap、dependency install、heartbeat、log artifact。
- [ ] W4. 支持 branch/worktree ownership 和 result handoff。
- [ ] W5. 远程 worker 输出必须转为主 workspace proposal/review queue item。
- [ ] W6. 增加 remote worker fixture 和 failure recovery tests。

## Phase X Checklist

- [ ] X1. 建立 ContextSourceRegistry。
- [ ] X2. 兼容 AGENTS、CLAUDE、RILLE、.rille/rules 和 Cursor-like rules。
- [ ] X3. 支持 glob/scoped rules 和 activation trace。
- [ ] X4. 增加冲突解释、优先级、trust 和 ignore reason。
- [ ] X5. UI 展示当前上下文来源和可禁用项。
- [ ] X6. 增加 context governance eval。

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
