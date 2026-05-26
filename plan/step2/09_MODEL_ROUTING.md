# Step2 Phase R-Z: 模型路由规划

## 分类原则

- **昂贵模型 (Opus/Pro)**：架构设计、安全边界、协议定义、跨模块重构、首次实现新模式
- **便宜模型 (Sonnet/Haiku)**：机械实现、UI 组件、已有模式扩展、文档/测试补充、参数调优

---

## Phase R — MCP HTTP/SSE + Auth/Reconnect

| 条目 | 模型 | 理由 |
|------|------|------|
| R1. 扩展 MCP config 支持 stdio/http/sse | 便宜 | 协议字段扩展，参照 Step1 McpServerConfig 模式 |
| R2. 实现 HTTP JSON-RPC transport | 昂贵 | 新增 transport 层，涉及网络请求、错误处理、超时策略 |
| R3. 实现 SSE event stream + request channel | 昂贵 | SSE 流解析 + request/response 通道映射，需与 HTTP transport 协调 |
| R4. 增加 auth secret refs、header/env 注入和 redaction | 昂贵 | 安全敏感：密钥管理、redaction 边界、不能写入 event/trace |
| R5. 增加 heartbeat、reconnect、degraded state 和日志 artifact | 便宜 | 状态机模式参照 Step1 processRegistry，日志走已有 ArtifactRef |
| R6. 保持 namespace、sideEffect、Plan Mode policy 与 Step1 一致 | 便宜 | 复用已有 policy 校验，验证一致性 |
| R7. 增加真实远程 MCP fixture 和 eval case | 便宜 | 参照已有 eval case 模板编写 fixture |

---

## Phase S — Windows Compatibility + Sandbox

| 条目 | 模型 | 理由 |
|------|------|------|
| S1. 建立 Windows compatibility matrix | 便宜 | 整理文档/矩阵，无代码 |
| S2. 修复当前 3 个 Windows 测试失败 | 便宜 | 已知问题：path separator、EBUSY、CRLF git worktree |
| S3. 统一 Windows shell、Node wrapper、npm/pnpm/yarn、Git、PTY 执行策略 | 昂贵 | 需要设计统一的 cross-platform command substrate，影响所有工具执行 |
| S4. 增加 Windows path/case/drive/UNC 测试 | 便宜 | 机械添加测试用例 |
| S5. 实现 Windows sandbox adapter 的文件和网络约束 | 昂贵 | OS 级隔离设计，安全边界，不同于 Unix sandbox |
| S6. 增加 Windows 手工验收脚本和 CI gate | 便宜 | 脚本编写，CI 配置 |

---

## Phase T — User Hooks + Plugin Runtime

| 条目 | 模型 | 理由 |
|------|------|------|
| T1. 定义 hook manifest 和权限声明 | 昂贵 | 安全模型设计：权限粒度、声明格式、与 Step1 policy 互操作 |
| T2. 从 plugin discovery 加载 hook entry | 便宜 | 复用 Step1 PluginManifest 解析 + skillStore discovery 模式 |
| T3. 实现 hook sandbox、timeout、env allowlist 和 redacted payload | 昂贵 | 用户代码执行沙箱是最高风险项：进程隔离、超时强制、环境变量白名单 |
| T4. hook 副作用必须走 tool/proposal，不允许直接写 workspace | 昂贵 | 架构约束设计：hook 如何通过受控通道产生副作用 |
| T5. 增加 hook trace、artifact、失败非阻塞策略 | 便宜 | 参照 Step1 trace.ts + hooks.ts 模式扩展 |
| T6. 增加插件签名和信任状态 | 昂贵 | 签名验证 + 信任链 + UI 指示器，安全基础设施 |

---

## Phase U — Writable / Real LLM Subagents + Worktree Merge

| 条目 | 模型 | 理由 |
|------|------|------|
| U1. 扩展 subagent permission scope 支持 isolated write | 昂贵 | 安全边界重新设计：write scope 的精确定义、什么能写什么不能 |
| U2. 为 writable subagent 自动创建 worktree 或 remote worker | 昂贵 | 生命周期管理：创建/绑定/清理 worktree，与 Step1 worktreeSandbox 协调 |
| U3. subagent 可运行命令和生成 diff proposal，但不能直接修改主 workspace | 昂贵 | 核心约束设计：command + diff proposal 权限边界 |
| U4. 移除静默 deterministic fallback，改为可配置 fallback mode 和可见失败 | 便宜 | 主要是可见性改进 + 配置项，不改变核心调用路径 |
| U5. 支持 reviewer/verifier/explorer/advisor 使用不同 model profile | 便宜 | 扩展已有 profile 路由逻辑，参照 evaluator profile 模式 |
| U6. 增加 merge gate、冲突 UI、parent verification/review gate | 昂贵 | 冲突检测 + merge 裁决逻辑 + UI 交互，与 Step1 verificationGate 深度交互 |
| U7. 增加真实模型 subagent eval | 便宜 | 参照已有 eval fixture 格式，添加真实模型调用路径 |

---

## Phase V — Automations + Review Queue

| 条目 | 模型 | 理由 |
|------|------|------|
| V1. 定义 AutomationSpec 和 AutomationRun | 便宜 | 协议定义，参照 Step1 TaskContract/Session 模式 |
| V2. 实现 local scheduler、manual trigger、pause/resume/cancel | 昂贵 | 调度器设计：持久化、跨进程唤醒、生命周期状态机 |
| V3. automation run 复用 TaskContract、handoff、evidence gate | 极便宜 | 纯复用，接入已有 runtime 路径 |
| V4. 建立 ReviewQueueItem，统一 plan/approval/diff/failed evidence/blocking finding | 便宜 | 数据模型抽象 + 已有事件的收集逻辑 |
| V5. UI 增加 automation list 和 review queue | 便宜 | UI 组件开发，参照 AgentPanel 现有卡片模式 |
| V6. 增加 automation eval 和 replay tests | 便宜 | 参照已有 eval 模板 |

---

## Phase W — Remote / Cloud Worker

| 条目 | 模型 | 理由 |
|------|------|------|
| W1. 定义 RemoteWorkerSpec、RemoteWorkerState、EnvironmentSnapshot | 昂贵 | 新领域协议设计：生命周期、环境快照、资源规格 |
| W2. 支持 SSH worker baseline，并为 cloud provider 留接口 | 昂贵 | 传输抽象层设计 + 可扩展 provider interface |
| W3. 支持 bootstrap、dependency install、heartbeat、log artifact | 昂贵 | 远程执行生命周期：命令序列、失败处理、心跳协议 |
| W4. 支持 branch/worktree ownership 和 result handoff | 昂贵 | 分布式状态同步：分支所有权、结果传输、冲突处理 |
| W5. 远程 worker 输出必须转为主 workspace proposal/review queue item | 便宜 | 复用已有 proposal/review queue 路径 |
| W6. 增加 remote worker fixture 和 failure recovery tests | 便宜 | 参照已有 fixture 模板 |

---

## Phase X — Rules / AGENTS Ecosystem + Context Governance

| 条目 | 模型 | 理由 |
|------|------|------|
| X1. 建立 ContextSourceRegistry | 昂贵 | 统一注册表设计：碎片来源追踪、优先级模型、生命周期 |
| X2. 兼容 AGENTS、CLAUDE、RILLE、.rille/rules 和 Cursor-like rules | 便宜 | 文件格式解析，参照 Step1 contextBuilder rules collector |
| X3. 支持 glob/scoped rules 和 activation trace | 便宜 | glob 匹配 + trace 记录，参照 skill activation trace |
| X4. 增加冲突解释、优先级、trust 和 ignore reason | 昂贵 | 冲突裁决逻辑 + 用户可理解的解释生成 |
| X5. UI 展示当前上下文来源和可禁用项 | 便宜 | UI 组件，参照已有 settings/panel 模式 |
| X6. 增加 context governance eval | 便宜 | 参照已有 eval 模板 |

---

## Phase Y — Product UX Command Center

| 条目 | 模型 | 理由 |
|------|------|------|
| Y1. 增加任务队列、review queue、automation status | 便宜 | UI 组件，消费已有状态 |
| Y2. 增加 subagent drilldown、worktree diff、remote worker logs | 便宜 | UI 组件，消费已有 subagent/sandbox/remote worker 数据 |
| Y3. 增加 MCP connection panel 和 plugin hook diagnostics | 便宜 | UI 面板，消费已有 MCP state + hook trace |
| Y4. 增加 trace analytics、cost/latency/usage summary | 便宜 | 数据聚合 + 图表组件 |
| Y5. 优化 command composer 的多任务入口和状态恢复 | 便宜 | UI 优化，扩展已有 composer |

---

## Phase Z — Enterprise Governance + Real Model Eval / Release Hardening

| 条目 | 模型 | 理由 |
|------|------|------|
| Z1. 增加真实模型 eval runner 和成本/延迟记录 | 昂贵 | 真实模型调用路径 + cost/latency metrics 采集 |
| Z2. 增加 model A/B、promotion gate 和 regression report | 昂贵 | A/B 比较框架 + 回归判定逻辑 + promotion 决策 |
| Z3. 增加组织级 policy、RBAC-ready schema 和 audit export | 便宜 | Schema 定义 + 导出格式，无实时 RBAC 执行 |
| Z4. 增加 plugin signature/trust policy | 便宜 | 扩展 T6 的签名基础设施到组织级 |
| Z5. 增加 release hardening checklist | 便宜 | Checklist 文档 + CI gate 集成 |
| Z6. 完成 scaffold cleanup 的人工确认入口 | 便宜 | UI 入口，参照已有 governance audit 输出 |

---

## 汇总

### 需要昂贵模型的条目 (27 条, 45%)

| Phase | 昂贵条目 |
|-------|----------|
| R | R2, R3, R4 |
| S | S3, S5 |
| T | T1, T3, T4, T6 |
| U | U1, U2, U3, U6 |
| V | V2 |
| W | W1, W2, W3, W4 |
| X | X1, X4 |
| Y | (无) |
| Z | Z1, Z2 |

### 可用便宜模型的条目 (33 条, 55%)

| Phase | 便宜条目 |
|-------|----------|
| R | R1, R5, R6, R7 |
| S | S1, S2, S4, S6 |
| T | T2, T5 |
| U | U4, U5, U7 |
| V | V1, V3, V4, V5, V6 |
| W | W5, W6 |
| X | X2, X3, X5, X6 |
| Y | Y1, Y2, Y3, Y4, Y5 (全部) |
| Z | Z3, Z4, Z5, Z6 |

### 按 Phase 统计

| Phase | 总条目 | 昂贵 | 便宜 | 建议执行模型 |
|-------|--------|------|------|-------------|
| R | 7 | 3 | 4 | **混合**：R1/R5/R6/R7 用便宜，R2/R3/R4 用昂贵 |
| S | 6 | 2 | 4 | **混合**：S3/S5 用昂贵，其余用便宜 |
| T | 6 | 4 | 2 | **偏昂贵**：安全模型和沙箱需要昂贵模型主导 |
| U | 7 | 4 | 3 | **偏昂贵**：核心架构变更需要昂贵模型主导 |
| V | 6 | 1 | 5 | **偏便宜**：仅 scheduler 设计用昂贵，其余是机械工作 |
| W | 6 | 4 | 2 | **偏昂贵**：新领域，协议和传输层需要昂贵模型 |
| X | 6 | 2 | 4 | **偏便宜**：核心设计用昂贵，兼容解析和 UI 用便宜 |
| Y | 5 | 0 | 5 | **全便宜**：纯 UI 层工作 |
| Z | 6 | 2 | 4 | **偏便宜**：真实 eval 和 A/B 用昂贵，其余用便宜 |

### 建议实施策略

1. **先导阶段**：每个 Phase 的昂贵条目先做（设计协议、安全边界、核心架构），产出明确的设计文档/协议定义/接口签名
2. **跟进阶段**：便宜条目跟进（机械实现、UI、测试、文档），基于昂贵条目产出的明确设计执行
3. **纯便宜 Phase（Y）**：可在昂贵条目间隙并行执行，充分利用便宜模型的吞吐量
4. **高浓度 Phase（T、U、W）**：需要最多昂贵模型调用，应优先安排，因为它们的设计决策会影响后续 Phase
