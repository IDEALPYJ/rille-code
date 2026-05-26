# Step2 资料综合与差距归纳

## 当前差距来源

Step2 的差距来自对当前源码和 Step1 文档的复盘，并对标 Claude Code Desktop、Codex Desktop、Cursor 等顶尖工具的产品形态。

## 关键差距表

| 主题 | 顶尖产品能力 | RilleCode 当前状态 | Step2 规划方向 |
| --- | --- | --- | --- |
| MCP transport | 支持 stdio、HTTP、SSE、远程鉴权、重连和日志诊断。 | 仅 stdio child process lifecycle。 | Phase R 增加 remote MCP transport、auth、reconnect、tool policy。 |
| Windows compatibility | Windows 沙箱、命令执行、路径、PTY、Git、Node wrapper 都可发布。 | 主要是路径兼容和本地测试，仍有 Windows 测试失败。 | Phase S 建立 Windows compatibility gate 和 sandbox adapter。 |
| Plugin hooks | 用户可配置生命周期 hooks，插件可扩展且有安全边界。 | hooks 是内存 registry，plugin manifest 只解析 hooks 字段。 | Phase T 实现 hook manifest、脚本沙箱、权限和审计。 |
| Subagent worker | 子代理可隔离执行、修改、测试、产出 branch/diff，并由主 agent 合并。 | subagent 只读，真实模型失败会 deterministic fallback。 | Phase U 实现 writable subagent、真实模型策略、worktree merge gate。 |
| Automations | 支持后台任务、定时任务、review queue、长任务恢复。 | 有 handoff/compaction，但没有 scheduler 和 review queue。 | Phase V 增加 automation run、queue、wake/resume 和 evidence gate。 |
| Remote/cloud worker | 可在隔离远程环境运行任务、安装依赖、push branch。 | 有 SSH/WSL/worktree 抽象，但没有托管 worker。 | Phase W 增加 remote worker lifecycle、environment snapshot、branch handoff。 |
| Rules/context | AGENTS、rules、skills、memory、MCP 按治理策略分层加载。 | 已读 AGENTS/CLAUDE/RILLE/.rille rules，但无统一治理 UI。 | Phase X 建立 rules/context registry、冲突解释和激活 trace。 |
| Product UX | 多任务 command center、agent queue、subagent drilldown、trace analytics。 | AgentPanel 偏 session timeline 和基础状态卡。 | Phase Y 升级为任务队列、review center、远程 worker 状态台。 |
| Enterprise/eval | 真实模型 A/B、企业策略、插件签名、审计导出、release gate。 | 本地 deterministic governance audit。 | Phase Z 建立真实模型 eval、企业治理和发布硬门槛。 |

## Step2 产品判断

- Step1 证明 RilleCode 可以做“受控本地 agent loop”。
- Step2 要证明 RilleCode 可以做“可发布、可扩展、可远程协作的 agent 产品”。
- 新能力必须继续继承 Step1 的核心约束：模型不能绕过 runtime、写入必须可审查、完成必须有 evidence、review gate 是最终裁决。
