# Step2 当前实现状态矩阵

## Capability: MCP HTTP/SSE Transport

Current status: 未实现

Step1 baseline:
已有 stdio MCP lifecycle、namespace、sideEffect policy 和 Plan Mode 限制。

Missing pieces:
HTTP transport、SSE transport、remote auth、heartbeat、reconnect、degraded state、远程 MCP fixture。

Next phase:
Phase R

## Capability: Windows Compatibility and Sandbox

Current status: 部分实现

Step1 baseline:
已有部分 Windows path、shell wrapper、SSH/WSL/terminal 兼容逻辑。

Missing pieces:
当前 Windows 测试失败修复、Windows compatibility matrix、filesystem/network sandbox adapter、Windows CI/手工 gate。

Next phase:
Phase S

## Capability: User Hooks and Plugin Runtime

Current status: 未实现

Step1 baseline:
已有内部 hook lifecycle、hook trace、plugin manifest discovery、hooks 字段解析。

Missing pieces:
用户脚本加载、hook manifest、sandbox、timeout、env allowlist、插件签名、hook policy 和审计 UI。

Next phase:
Phase T

## Capability: Writable / Real LLM Subagents

Current status: 部分实现

Step1 baseline:
已有 SubagentContract、parent-child session、只读 SubagentRunner、scheduler、subagent events、review merge。

Missing pieces:
写权限 scope、隔离 worktree/remote worker、命令执行、diff proposal 输出、真实模型必选/失败可见、多模型策略、merge conflict UI。

Next phase:
Phase U

## Capability: Automations and Review Queue

Current status: 未实现

Step1 baseline:
已有 session、handoff、feature list、evidence/review gate、archive/unarchive。

Missing pieces:
AutomationSpec、scheduler、run lifecycle、queue state、集中 review queue、后台 wake/resume。

Next phase:
Phase V

## Capability: Remote / Cloud Worker

Current status: 部分实现

Step1 baseline:
已有 local/WSL/SSH/worktree execution substrate 和 process registry。

Missing pieces:
远程 worker lifecycle、bootstrap、environment snapshot、heartbeat、branch ownership、remote proposal handoff、cloud provider 接口。

Next phase:
Phase W

## Capability: Rules / AGENTS Ecosystem and Context Governance

Current status: 部分实现

Step1 baseline:
已有 AGENTS、CLAUDE、RILLE、.rille/rules、skills、memory、MCP context fragments。

Missing pieces:
统一 registry、glob/scoped rules、冲突解释、trust/priority UI、context source disable、governed activation trace。

Next phase:
Phase X

## Capability: Product UX Command Center

Current status: 部分实现

Step1 baseline:
已有 AgentPanel timeline、risk card、verification/review cards、trace/debug、subagent tree。

Missing pieces:
任务队列、review queue、automation dashboard、remote worker logs、MCP connection panel、plugin hook diagnostics、cost/latency analytics。

Next phase:
Phase Y

## Capability: Enterprise Governance and Real Model Eval

Current status: 部分实现

Step1 baseline:
已有 deterministic governance audit、eval runner、model upgrade checklist、config/scaffold report。

Missing pieces:
真实模型 eval、A/B promotion gate、组织级 policy、audit export、plugin signature trust、release hardening gate。

Next phase:
Phase Z
