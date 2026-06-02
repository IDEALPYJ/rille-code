# Step2 当前实现状态矩阵

## Capability: MCP HTTP/SSE Transport

Current status: 已实现

Step1 baseline:
已有 stdio MCP lifecycle、namespace、sideEffect policy 和三模式权限约束。

Implemented details:
`McpTransport` 支持 `stdio`、`http`、`sse`；plugin manifest 可声明 remote `url`、`messageUrl`、static headers、env-ref auth headers、timeout、heartbeat 和 reconnect policy；MCP manager 已抽象 transport client，保留 stdio Content-Length framing，并新增 HTTP JSON-RPC POST 与 SSE stream + message POST；remote tools 继续使用 `mcp.<pluginId>.<serverId>.<toolName>` namespace、sideEffect policy、三模式 permission policy 和 artifact-backed tool output。

Missing pieces:
SSE reconnect 当前是本进程内轻量重连，不做跨 app 重启 session resume；远程 OAuth/动态 auth flow 留到后续插件信任与企业治理阶段。

Next phase:
Phase S / Phase T

## Capability: Windows Compatibility and Sandbox

Current status: 部分实现

Step1 baseline:
已有部分 Windows path、shell wrapper、SSH/WSL/terminal 兼容逻辑。

Missing pieces:
当前 Windows 测试失败修复、Windows compatibility matrix、filesystem/network sandbox adapter、Windows CI/手工 gate。

Next phase:
Phase S

## Capability: User Hooks and Plugin Runtime

Current status: 已实现

Step1 baseline:
已有内部 hook lifecycle、hook trace、plugin manifest discovery、hooks 字段解析。

Implemented details:
`PluginHookManifest` 定义钩子声明（name/entrypoint/permissions/timeoutMs/sandbox/envAllowlist）和 `HookPermission` DSL；`PluginHookRunner` 实现子进程 fork sandbox（超时 SIGTERM→SIGKILL、env allowlist 过滤、redacted payload 白名单）；`hookWorker.ts` 子进程入口（IPC 通信、用户脚本加载、stdout/stderr 捕获）；`AgentHookRegistry` 新增 `hookTimeoutMs` 属性 + `Promise.race` 超时保护；`loadPluginHooks`/`unloadPluginHooks` 从插件发现到钩子注册的完整集成；`pluginSignature.ts` SHA-256 hash 签名验证 + trust 分配（trusted/untrusted/unknown_signer）；`PluginManifest` 扩展 `signature`/`trust` 字段，`hooks` 支持 `string[]` 和 `PluginHookManifest[]` 双格式。

Missing pieces:
minisign/gpg 签名验证（留到 Phase Z）；钩子输出 artifact 在 runtime event pipeline 中自动发射（需 Phase Y hook diagnostics 面板）；VM2 sandbox（当前仅 process 隔离）。

Next phase:
Phase U (Writable Subagents) 或 Phase Y (hook diagnostics 面板)

## Capability: Writable / Real LLM Subagents

Current status: 已实现

Step1 baseline:
已有 SubagentContract、parent-child session、只读 SubagentRunner、scheduler、subagent events、review merge。

Implemented details:
新增 `isolated_write` permission scope、`local_worktree` execution mode、`strict` / `visible_deterministic` fallback mode、role-specific model profile routing；writable subagent 自动创建 local Git worktree sandbox，在 sandbox 内运行显式命令并将 diff 转为父会话 `EditProposal`；主 workspace 不被 subagent 直接写入，apply 仍走既有 diff review。Runtime 增加 subagent proposal merge metadata，UI 展示 scope/model/fallback/sandbox/proposal/merge status。

Missing pieces:
remote/cloud worker 执行目标留到 Phase W；完整 agent-in-sandbox 工具循环可作为后续增强；独立 merge conflict 面板未新增，当前复用既有 diff proposal conflict UI。

Next phase:
Phase V (Automations + Review Queue) 或 Phase W (Remote / Cloud Worker)

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

Current status: 已实现

Step1 baseline:
已有 AGENTS、CLAUDE、RILLE、.rille/rules、skills、memory、MCP context fragments。

Implemented details:
`ContextSourceRegistry` 统一注册所有上下文来源（rule_file/rule_directory/memory/skill/mcp/feature_list），支持注册/注销/启用禁用/激活追踪/冲突检测/ignore reason；规则文件读取兼容 AGENTS.md、CLAUDE.md、RILLE.md、.rille/rules.md、.rille/rules/*.md、.cursorrules、.cursor/rules/*.md、README.md、.rille/local.md；支持 YAML frontmatter（scopes/priority/activation/trust）解析和 glob scope 过滤；UI `ContextSourcePanel` 组件按 kind 分组展示上下文来源、支持启用/禁用 toggle、冲突指示器、激活 trace 展开；新增 `context_governance` eval case。

Missing pieces:
Registry 为内存单例，应用重启后丢失历史 activation trace；语义级冲突检测（不同规则文件的矛盾指令分析）尚未实现；ContextSourcePanel 需在首次 submit turn 后才有数据。

Next phase:
Phase Y (context source 展示面板消费 ContextSourceRegistryEntry)

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
