# Step2 实施路线图

## 路线原则

1. 先补平台和扩展底座，再放大 agent 并行能力。
2. 先本地可测，再远程可恢复，最后产品化队列和企业治理。
3. 每个阶段都必须保留 Step1 的 permission、diff review、evidence 和 replay 边界。
4. 真实模型、真实 MCP、Windows 和远程 worker 都必须进入 release gate。

## Milestone 1: Extension and Platform Hardening

覆盖 Phase R-S-T。

目标：

- MCP 可以连接远程 server。
- Windows 测试和沙箱达到可发布标准。
- 用户 hooks/plugin runtime 具备安全执行边界。

验收：

```text
HTTP/SSE MCP 可启动、鉴权、重连、发现和调用工具。
Windows 兼容性测试通过，sandbox adapter 有明确约束。
用户 hook 可从 plugin manifest 加载并在 sandbox 中执行。
```

## Milestone 2: Scaled Agent Work

覆盖 Phase U-V。

目标：

- Subagent 可以在隔离 worktree/worker 中写入、验证、提交 proposal。
- Automation 可以后台运行并把所有用户确认项归入 review queue。

验收：

```text
Writable subagent 不直接改主 workspace，只产出 proposal/evidence/finding。
真实模型 subagent 失败可见，不被静默 deterministic fallback 掩盖。
Review queue 能集中处理 plan、approval、diff 和 failed evidence。
```

## Milestone 3: Remote Execution

覆盖 Phase W。

目标：

- 支持远程 worker 的 provision、bootstrap、heartbeat、artifact 和 branch handoff。

验收：

```text
远程 worker 可执行任务并回传 reviewable proposal。
远程失败能恢复、重试或进入 blocked 状态。
远程日志和环境快照可追踪。
```

## Milestone 4: Context and UX Productization

覆盖 Phase X-Y。

目标：

- 建立 context governance。
- AgentPanel 升级为 command center。

验收：

```text
用户能看到每条上下文来源、激活原因和冲突处理。
用户能在一个界面处理任务队列、review queue、subagent、MCP、automation 和 remote worker。
```

## Milestone 5: Release Governance

覆盖 Phase Z。

目标：

- 真实模型 eval、企业策略、插件信任和发布门槛闭环。

验收：

```text
模型升级必须经过真实 eval 和 regression report。
插件和 policy 有审计与信任状态。
发布前硬门槛覆盖 Windows、MCP remote、subagent write、automation、remote worker。
```

## 推荐实施顺序

1. R1-R7 MCP HTTP/SSE。
2. S1-S6 Windows compatibility and sandbox。
3. T1-T6 user hooks/plugin runtime。
4. U1-U7 writable/real subagents。
5. V1-V6 automations/review queue。
6. W1-W6 remote worker。
7. X1-X6 context governance。
8. Y1-Y5 command center UX。
9. Z1-Z6 enterprise governance and real model eval。

当前入口：Phase R1。
