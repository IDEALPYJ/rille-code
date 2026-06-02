# Step2 目标架构

## 总体架构

Step2 在 Step1 七层架构上新增五个产品化平面：

1. Remote Extension Plane：MCP HTTP/SSE、plugin runtime、hook sandbox。
2. Worker Plane：writable subagent、remote worker、automation runner、worktree merge。
3. Platform Plane：Windows sandbox、cross-platform command/PTY/Git compatibility。
4. Context Governance Plane：rules registry、skill/memory/MCP activation trace、conflict explain。
5. Product Command Plane：review queue、automation dashboard、subagent drilldown、trace analytics。

## 新增模块边界

### MCP Remote Transport

- 支持 stdio、HTTP、SSE 三类 transport。
- transport 负责连接、鉴权、重连、心跳、工具发现和日志 artifact。
- tool namespace、sideEffect、三模式 permission policy 继续沿用 Step1。

### Windows Sandbox Adapter

- 将 Windows path、shell、Node wrapper、Git、PTY、network policy 和 filesystem policy 统一收口。
- Windows 测试失败不允许通过 skip 关闭，必须归入 compatibility matrix。

### Plugin Hook Runtime

- plugin manifest 声明 hook entry、权限、timeout、env、sandbox policy。
- hook runtime 只接收 redacted payload，输出 trace/event，不直接修改 workspace。
- 需要副作用时走受控 tool 或 proposal。

### Writable Subagent Worker

- 子代理默认在隔离 worktree/remote worker 中执行。
- 可写子代理只能产出 diff proposal、verification evidence 和 review findings。
- parent agent 负责 merge、冲突裁决、verification/review final gate。

### Automation and Review Queue

- automation 复用 session、TaskContract、handoff、artifact 和 evidence gate。
- review queue 统一展示待确认 plan、approval、diff proposal、failed evidence、blocking finding。

### Remote Worker

- worker 有 environment snapshot、dependency bootstrap、branch ownership、log artifact 和 heartbeat。
- 所有远程写入仍回到主 workspace 的 reviewable merge。

### Context Governance

- AGENTS、CLAUDE、RILLE、rules、skills、memory、MCP context 统一进入 registry。
- registry 解释每个上下文片段为什么被加载、来源、优先级、信任级别和冲突结果。

## 保持不变的 Step1 边界

- 模型仍只提出 tool calls 和候选文本。
- runtime 仍是权限、写入、验证、审查和完成裁决的唯一执行者。
- diff proposal、artifact、trace、session replay、evidence gate 继续作为所有新能力的公共底座。
