# Step2 顶尖桌面/远程 Agent 产品化规划索引

## 定位

`plan/step2/` 是 RilleCode Agent 的下一阶段完整实现规划。Step1 已经完成本地 agent harness 的协议、loop、verification、review、MCP stdio、subagent 只读隔离和本地治理；Step2 的目标是补齐与 Claude Code Desktop、Codex Desktop、Cursor 等顶尖产品相比的产品化缺口。

Step2 不推翻 Step1，而是在 Step1 的安全边界、事件流、diff review、evidence gate 和 eval harness 上继续扩展。

## 阅读顺序

1. `01_SOURCE_SYNTHESIS.md`：看 Step2 的行业差距和设计原则。
2. `02_TARGET_ARCHITECTURE.md`：看目标架构和新增模块边界。
3. `03_PROTOCOL_AND_EVENTS.md`：看新增协议、事件和状态投影。
4. `04_PHASE_R_TO_Z_MASTER_PLAN.md`：看 Phase R 到 Phase Z 的完整计划。
5. `05_IMPLEMENTATION_ROADMAP.md`：看实施顺序和里程碑。
6. `06_IMPLEMENTED_STATUS_MATRIX.md`：看当前源码对 Step2 能力的基线状态。
7. `07_ACCEPTANCE_AND_TEST_STRATEGY.md`：看验收、跨平台、真实模型和安全测试策略。
8. `08_EXECUTION_TRACKER.md`：看执行总控、完成标记和记录模板。

## Step2 设计原则

1. 远程能力必须一等公民化：MCP HTTP/SSE、远程 worker、云端 worktree、review queue 不能只是本地 fallback。
2. Windows 兼容性按产品级 release blocker 处理，而不是测试特判。
3. Subagent 从只读 reviewer/explorer 升级为可隔离写入、可验证、可合并的 worker。
4. 用户 hooks 和 plugin runtime 必须有 manifest、policy、sandbox、签名和审计。
5. 自动化任务必须可暂停、恢复、取消、追踪成本，并能复用 Step1 的 evidence/review gate。
6. Rules、AGENTS、skills、memory、MCP context 进入统一 context governance。
7. Eval 从 deterministic fixture 扩展到真实模型、真实 MCP、真实远程环境和跨平台场景。

## 状态标记

| 状态 | 含义 |
| --- | --- |
| 已实现 | 当前源码已经具备产品可用的 Step2 能力和测试证据。 |
| 部分实现 | Step1 已有基础能力，但缺少 Step2 要求的传输、沙箱、远程、真实模型或产品 UX。 |
| 未实现 | 当前源码没有可用实现，或只有文档/协议预留。 |
