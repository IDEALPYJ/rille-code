# Step2 Phase R-Z: 依赖关系图

## 总览

```
                    ┌──────────────────────────────────────────────────────┐
                    │                    Step1 Harness                      │
                    │  session/thread/runtime/tools/permissions/editStore   │
                    │  verificationGate/evaluator/contextBuilder/workspace  │
                    │  worktreeSandbox/subagentRunner/skillStore/mcpManager │
                    │  memory/hooks/trace/governance/featureStore/compaction│
                    └────┬─────┬─────┬─────┬─────┬──────┬─────┬─────┬──────┘
                         │     │     │     │     │      │     │     │
                         ▼     ▼     ▼     ▼     ▼      ▼     ▼     ▼
    ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌──────────┐  ┌─────────┐  ┌──────────┐
    │ Phase R │  │ Phase S │  │ Phase T │  │ Phase U  │  │ Phase W │  │ Phase X  │
    │  MCP    │  │Windows  │  │ Hooks/  │  │Writable  │  │ Remote  │  │ Context  │
    │ HTTP/SSE│  │Compat.  │  │ Plugin  │  │Subagent  │  │ Worker  │  │Governance│
    └────┬────┘  └────┬────┘  └───┬─────┘  └────┬─────┘  └────┬────┘  └────┬─────┘
         │            │           │              │             │            │
         │            │           │              ▼             │            │
         │            │           │       ┌──────────┐        │            │
         │            │           │       │ Phase V  │        │            │
         │            │           │       │Automation│        │            │
         │            │           │       │Review Q  │        │            │
         │            │           │       └────┬─────┘        │            │
         │            │           │            │              │            │
         └────────────┼───────────┼────────────┼──────────────┼────────────┘
                      │           │            │              │
                      ▼           ▼            ▼              ▼
               ┌──────────────────────────────────────────────────────┐
               │                   Phase Y                            │
               │            Product UX Command Center                 │
               │   (消费 R/T/U/V/W/X 的所有新状态和事件)               │
               └──────────────────────────┬───────────────────────────┘
                                          │
                                          ▼
               ┌──────────────────────────────────────────────────────┐
               │                   Phase Z                            │
               │     Enterprise Governance + Real Model Eval          │
               │   Z1-Z2 独立  |  Z4 ← T6  |  Z5 收集所有 Phase        │
               └──────────────────────────────────────────────────────┘
```

---

## 一、硬依赖矩阵

行 = 依赖方，列 = 被依赖方。◆ = 硬依赖，○ = 软依赖（增强价值但不阻塞）。

|  | R | S | T | U | V | W | X | Y | Z | Step1 |
|---|---|---|---|---|---|---|---|---|---|---|------|
| **R** | - | | | | | | | | | ◆ |
| **S** | | - | | | | | | | | ◆ |
| **T** | | | - | | | | | | | ◆ |
| **U** | | | | - | | | | | | ◆ |
| **V** | | | | ○ | - | | | | | ◆ |
| **W** | | | | ○ | | - | | | | ◆ |
| **X** | | | | | | | - | | | ◆ |
| **Y** | ◆ | ◆ | ◆ | ◆ | ◆ | ◆ | ◆ | - | | ◆ |
| **Z1-Z3** | | | | | | | | | - | ◆ |
| **Z4** | | | ◆ | | | | | | - | |
| **Z5** | ◆ | ◆ | ◆ | ◆ | ◆ | ◆ | ◆ | ◆ | - | ◆ |

---

## 二、每个 Phase 的详细依赖分析

### Phase R — MCP HTTP/SSE + Auth/Reconnect

| 依赖 | 类型 | 说明 |
|------|------|------|
| Step1 mcpManager.ts | 硬依赖 | 复用 McpServerConfig、namespace、sideEffect policy、Plan Mode 限制 |
| Step1 permissions.ts | 硬依赖 | auth secret redaction 策略 |
| Step1 trace.ts / artifactStore.ts | 硬依赖 | heartbeat/degraded state 事件和日志 artifact |
| 其他 Step2 Phase | 无 | 完全独立 |

**可并行性**: 可与 S、T、X 完全并行开发。

---

### Phase S — Windows Compatibility + Sandbox

| 依赖 | 类型 | 说明 |
|------|------|------|
| Step1 workspace.ts | 硬依赖 | path guard、canonical path、SSH/WSL route |
| Step1 processRegistry.ts | 硬依赖 | 命令执行和进程管理 |
| Step1 worktreeSandbox.ts | 软依赖 | Unix sandbox 模式可参考，但 Windows sandbox 实现独立 |
| 其他 Step2 Phase | 无 | 纯平台层工作 |

**可并行性**: 可与 R、T、X 完全并行。

---

### Phase T — User Hooks + Plugin Runtime

| 依赖 | 类型 | 说明 |
|------|------|------|
| Step1 hooks.ts | 硬依赖 | 内部 hook registry、hook lifecycle、hook trace |
| Step1 skillStore.ts | 硬依赖 | PluginManifest 解析和 plugin discovery |
| Step1 permissions.ts | 硬依赖 | hook 权限检查和 policy 决策 |
| Step1 artifactStore.ts | 硬依赖 | hook 输出 ArtifactRef |
| Phase S | 软依赖 | 两个 sandbox 设计（hook sandbox vs Windows sandbox）可互相借鉴 |
| 其他 Step2 Phase | 无 | |

**可并行性**: 可与 R、S、X 并行。

**对外输出**: T6（插件签名/信任）→ Z4 的企业插件信任策略依赖此能力。

---

### Phase U — Writable / Real LLM Subagents + Worktree Merge

| 依赖 | 类型 | 说明 |
|------|------|------|
| Step1 subagentRunner.ts | 硬依赖 | SubagentContract、SubagentRun、scheduler、parent-child session |
| Step1 worktreeSandbox.ts | 硬依赖 | worktree 创建/销毁/失败诊断 |
| Step1 verificationGate.ts | 硬依赖 | merge gate + parent verification/review final gate |
| Step1 editStore.ts | 硬依赖 | diff proposal 生成和 apply |
| Step1 sessionStore.ts | 硬依赖 | child session 持久化 |
| Step1 provider.ts | 硬依赖 | 多 model profile 路由 |
| Phase W | 软依赖 | W 的远程 worker 可作为 U 的可写 subagent 的执行目标之一 |
| 其他 Step2 Phase | 无 | |

**可并行性**: 可与 R、S、T、X 并行。W 应与 U 协调但非阻塞。

**对外输出**: 
- writable subagent 产出的 diff proposal + verification evidence + blocking finding → V 的 review queue 需要展示
- subagent worktree 状态 → Y2 的 drilldown UI 需要消费

---

### Phase V — Automations + Review Queue

| 依赖 | 类型 | 说明 |
|------|------|------|
| Step1 AgentThread | 硬依赖 | automation 复用 session 和 turn 生命周期 |
| Step1 runtime.ts | 硬依赖 | automation run 复用 TaskContract、handoff、evidence gate |
| Step1 featureStore.ts | 硬依赖 | automation 状态持久化 |
| Step1 sessionStore.ts | 硬依赖 | session 的 archive/unarchive 与 automation 生命周期交互 |
| Step1 editStore.ts | 硬依赖 | diff proposal 进入 review queue |
| Step1 verificationGate.ts | 硬依赖 | failed evidence / blocking finding 进入 review queue |
| Phase U | 软依赖 | U 的 subagent proposal/finding 丰富了 review queue 的内容类型，但 V 可以先只用 Step1 的 proposal/finding 构建 review queue 框架，后续再接入 U |

**可并行性**: 可在 U 完成前开始（只用 Step1 数据源搭建框架），但完整价值需等 U 完成。

**对外输出**: 所有 UI 状态 → Y1、Y2。

---

### Phase W — Remote / Cloud Worker

| 依赖 | 类型 | 说明 |
|------|------|------|
| Step1 workspace.ts | 硬依赖 | SSH/WSL/worktree 执行底座 |
| Step1 processRegistry.ts | 硬依赖 | 远程进程管理 |
| Step1 artifactStore.ts | 硬依赖 | bootstrap log、heartbeat、环境快照 ArtifactRef |
| Phase U | 软依赖 | U 定义"隔离 worker"模式，W 将其扩展到远程环境。两者共享 SubagentWorktree、branch ownership 等概念，但 W 不阻塞 U，U 也不阻塞 W |

**可并行性**: 可与 U 并行设计协议，实现时需与 U 协调 SubagentWorktree 接口。

**对外输出**: 远程 worker 日志和环境快照 → Y2。

---

### Phase X — Rules / AGENTS Ecosystem + Context Governance

| 依赖 | 类型 | 说明 |
|------|------|------|
| Step1 contextBuilder.ts | 硬依赖 | rules collector、fragment pipeline、context trace |
| Step1 skillStore.ts | 硬依赖 | skill activation trace |
| Step1 memory.ts | 硬依赖 | memory 来源注册 |
| Step1 mcpManager.ts | 硬依赖 | MCP context 来源注册 |
| 其他 Step2 Phase | 无 | 完全独立 |

**可并行性**: 可与 R、S、T、U 完全并行。

**对外输出**: context source 列表和 activation trace → Y。

---

### Phase Y — Product UX Command Center

| 依赖 | 类型 | 说明 |
|------|------|------|
| Step1 AgentPanel.tsx | 硬依赖 | 基础 timeline、risk card、verification/review cards |
| Step1 workbenchState.ts | 硬依赖 | risk summary、composer draft |
| **Phase R** | 硬依赖 | Y3: MCP connection panel 需要 McpConnectionState |
| **Phase S** | 软依赖 | 无直接 UI 依赖，但 Windows 兼容性影响 Y 在 Windows 上的可用性 |
| **Phase T** | 硬依赖 | Y3: plugin hook diagnostics 需要 HookRun 状态和 artifact |
| **Phase U** | 硬依赖 | Y2: subagent drilldown、worktree diff 需要 SubagentRun、SubagentWorktree |
| **Phase V** | 硬依赖 | Y1: 任务队列、review queue、automation status 需要 AutomationRun、ReviewQueueItem |
| **Phase W** | 硬依赖 | Y2: remote worker logs 需要 RemoteWorkerState、EnvironmentSnapshot |
| **Phase X** | 硬依赖 | Y: context source 展示需要 ContextSourceRegistryEntry |

**Y 是整个 Step2 的汇合点**——几乎所有 Phase 的新状态都需要在 Y 中可视化。

**策略**: Y 不能等所有 Phase 完成后再开始。应该：
1. Y 的**骨架**（多任务面板布局、路由框架）可与 R/S/T/X 并行开发
2. 每个子面板（MCP panel、hook diagnostics、subagent drilldown 等）随对应 Phase 完成而接入
3. Y 是增量交付的，不是一次性交付的

---

### Phase Z — Enterprise Governance + Real Model Eval

| 依赖 | 类型 | 说明 |
|------|------|------|
| Step1 governance.ts | 硬依赖 | feature lifecycle、model upgrade checklist、config audit |
| Step1 eval runner | 硬依赖 | deterministic eval fixture 格式 |
| Step1 trace.ts | 硬依赖 | TraceCollector 和 redacted export |
| **Phase T** | 硬依赖 | Z4: plugin signature/trust policy 依赖 T6 的签名基础设施 |
| **Phase R/S/U/V/W/X/Y** | 硬依赖 | Z5: release hardening checklist 收集所有 Phase 的完成状态 |

---

## 三、并行执行建议

### 第一波（全部可并行）

```
Track 1: Phase R  (MCP HTTP/SSE)        ─── 3-4 周
Track 2: Phase S  (Windows Compat)      ─── 3-4 周
Track 3: Phase T  (Hooks/Plugin)        ─── 4-5 周
Track 4: Phase X  (Context Governance)  ─── 2-3 周
```

4 个 Track 互不依赖，全部只依赖 Step1，可同时开工。

### 第二波（U 先行，V/W/Y 骨架跟进）

```
Track 5: Phase U  (Writable Subagent)   ─── 5-6 周 ← 最复杂，先启动
Track 6: Phase V  (骨架)                 ─── U 启动后 2 周启动，先建框架用 Step1 数据
Track 7: Phase W  (Remote Worker)       ─── 与 U 并行设计协议，实现可与 U 交叉
Track 8: Phase Y  (骨架)                 ─── 第一波完成后启动，建 layout + 路由
```

### 第三波（汇合与收尾）

```
Track 9:  Phase Y  (接入所有面板)        ─── 第二波完成后 4-5 周
Track 10: Phase Z  (Governance + Eval)   ─── T 完成后可启动 Z1-Z2，Z5 等所有 Phase 完成
```

---

## 四、关键路径分析

从开工到发布的最短路径（不考虑资源并行）：

```
S (3周) → U (5周) → V (3周) → Y (4周) → Z5 (1周) = 16 周
```

如果 R/S/T/X 全部并行 + U 及时完成，实际总工期：

```
第一波 5周(max(T)) + 第二波 6周(U) + 第三波 5周(Y) = 16 周 ≈ 4 个月
```

关键路径上是 **T → U → Y**，因为：
- T 在第一波中最长（4-5 周）
- U 是整个 Step2 最复杂的 Phase（5-6 周）
- Y 必须等 U 和 V 完成才能接入 subagent/automation 面板

---

## 五、风险依赖

| 风险 | 影响范围 | 缓解措施 |
|------|---------|---------|
| U 的设计复杂度超预期 | V 完整价值、Y2 面板、W 接口 | U 拆为 U-core（scope+worktree+proposal）和 U-adv（real model+merge UI），U-core 先交付 |
| W 的远程 infra 需求膨胀 | Y2 remote worker 面板 | W 缩小范围为 SSH worker only，删除 cloud provision |
| Y 等所有 Phase 完成后才开始 | 整体延期 | Y 骨架在第一波完成后立即启动，按 Phase 增量接入面板 |
| T 的 plugin sandbox 安全设计困难 | Z4 plugin trust | T3 先用 process 隔离（child_process），签名/信任链推迟到 Z |
