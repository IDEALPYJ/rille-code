# Phase R 到 Phase Z 完整实现计划

## 总览

| Phase | 名称 | 当前状态 |
| --- | --- | --- |
| R | MCP HTTP/SSE + Auth/Reconnect | 未实现 |
| S | Windows Compatibility + Sandbox | 部分实现 |
| T | User Hooks + Plugin Runtime | 未实现 |
| U | Writable / Real LLM Subagents + Worktree Merge | 部分实现 |
| V | Automations + Review Queue | 未实现 |
| W | Remote / Cloud Worker | 部分实现 |
| X | Rules / AGENTS Ecosystem + Context Governance | 部分实现 |
| Y | Product UX Command Center | 部分实现 |
| Z | Enterprise Governance + Real Model Eval / Release Hardening | 部分实现 |

## Phase R: MCP HTTP/SSE + Auth/Reconnect

目标：把 MCP 从本地 stdio 扩展为可连接远程 server 的产品级 transport。

Checklist：

- [ ] R1. 扩展 MCP config 支持 stdio/http/sse。
- [ ] R2. 实现 HTTP JSON-RPC transport。
- [ ] R3. 实现 SSE event stream + request channel。
- [ ] R4. 增加 auth secret refs、header/env 注入和 redaction。
- [ ] R5. 增加 heartbeat、reconnect、degraded state 和日志 artifact。
- [ ] R6. 保持 namespace、sideEffect、Plan Mode policy 与 Step1 一致。
- [ ] R7. 增加真实远程 MCP fixture 和 eval case。

## Phase S: Windows Compatibility + Sandbox

目标：让 Windows 成为一等发布平台，并补齐 Windows sandbox 能力。

Checklist：

- [ ] S1. 建立 Windows compatibility matrix。
- [ ] S2. 修复当前 3 个 Windows 测试失败。
- [ ] S3. 统一 Windows shell、Node wrapper、npm/pnpm/yarn、Git、PTY 执行策略。
- [ ] S4. 增加 Windows path/case/drive/UNC 测试。
- [ ] S5. 实现 Windows sandbox adapter 的文件和网络约束。
- [ ] S6. 增加 Windows 手工验收脚本和 CI gate。

## Phase T: User Hooks + Plugin Runtime

目标：把内部 hooks 升级为用户可扩展、可治理的 plugin hook 系统。

Checklist：

- [ ] T1. 定义 hook manifest 和权限声明。
- [ ] T2. 从 plugin discovery 加载 hook entry。
- [ ] T3. 实现 hook sandbox、timeout、env allowlist 和 redacted payload。
- [ ] T4. hook 副作用必须走 tool/proposal，不允许直接写 workspace。
- [ ] T5. 增加 hook trace、artifact、失败非阻塞策略。
- [ ] T6. 增加插件签名和信任状态。

## Phase U: Writable / Real LLM Subagents + Worktree Merge

目标：让 subagent 从只读审查升级为可隔离交付的 worker。

Checklist：

- [ ] U1. 扩展 subagent permission scope 支持 isolated write。
- [ ] U2. 为 writable subagent 自动创建 worktree 或 remote worker。
- [ ] U3. subagent 可运行命令和生成 diff proposal，但不能直接修改主 workspace。
- [ ] U4. 移除静默 deterministic fallback，改为可配置 fallback mode 和可见失败。
- [ ] U5. 支持 reviewer/verifier/explorer/advisor 使用不同 model profile。
- [ ] U6. 增加 merge gate、冲突 UI、parent verification/review gate。
- [ ] U7. 增加真实模型 subagent eval。

## Phase V: Automations + Review Queue

目标：支持后台、定时、持续跟进任务，并集中处理用户确认项。

Checklist：

- [ ] V1. 定义 AutomationSpec 和 AutomationRun。
- [ ] V2. 实现 local scheduler、manual trigger、pause/resume/cancel。
- [ ] V3. automation run 复用 TaskContract、handoff、evidence gate。
- [ ] V4. 建立 ReviewQueueItem，用于 plan、approval、diff、failed evidence、blocking finding。
- [ ] V5. UI 增加 automation list 和 review queue。
- [ ] V6. 增加 automation eval 和 replay tests。

## Phase W: Remote / Cloud Worker

目标：让 agent 能在隔离远程环境执行长任务并回传可审查结果。

Checklist：

- [ ] W1. 定义 RemoteWorkerSpec、RemoteWorkerState、EnvironmentSnapshot。
- [ ] W2. 支持 SSH worker baseline，并为 cloud provider 留接口。
- [ ] W3. 支持 bootstrap、dependency install、heartbeat、log artifact。
- [ ] W4. 支持 branch/worktree ownership 和 result handoff。
- [ ] W5. 远程 worker 输出必须转为主 workspace proposal/review queue item。
- [ ] W6. 增加 remote worker fixture 和 failure recovery tests。

## Phase X: Rules / AGENTS Ecosystem + Context Governance

目标：统一管理项目规则、skills、memory、MCP context 和用户选择。

Checklist：

- [ ] X1. 建立 ContextSourceRegistry。
- [ ] X2. 兼容 AGENTS、CLAUDE、RILLE、.rille/rules 和 Cursor-like rules。
- [ ] X3. 支持 glob/scoped rules 和 activation trace。
- [ ] X4. 增加冲突解释、优先级、trust 和 ignore reason。
- [ ] X5. UI 展示当前上下文来源和可禁用项。
- [ ] X6. 增加 context governance eval。

## Phase Y: Product UX Command Center

目标：把 AgentPanel 从 timeline 升级为多任务 agent command center。

Checklist：

- [ ] Y1. 增加任务队列、review queue、automation status。
- [ ] Y2. 增加 subagent drilldown、worktree diff、remote worker logs。
- [ ] Y3. 增加 MCP connection panel 和 plugin hook diagnostics。
- [ ] Y4. 增加 trace analytics、cost/latency/usage summary。
- [ ] Y5. 优化 command composer 的多任务入口和状态恢复。

## Phase Z: Enterprise Governance + Real Model Eval / Release Hardening

目标：让模型、插件、策略、eval 和发布流程达到可治理标准。

Checklist：

- [ ] Z1. 增加真实模型 eval runner 和成本/延迟记录。
- [ ] Z2. 增加 model A/B、promotion gate 和 regression report。
- [ ] Z3. 增加组织级 policy、RBAC-ready schema 和 audit export。
- [ ] Z4. 增加 plugin signature/trust policy。
- [ ] Z5. 增加 release hardening checklist：Windows、remote MCP、subagent write、automation、remote worker。
- [ ] Z6. 完成 scaffold cleanup 的人工确认入口。
