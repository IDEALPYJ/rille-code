# 参考资料综合与设计思想映射

## 输入资料

本文件综合当前可读资料：

- `blogs/`：27 篇 Anthropic、Claude、OpenAI、LangChain 和 harness 资源文章。
- `learn_from/claude-code.md`
- `learn_from/codex.md`
- `learn_from/deepseek-tui.md`
- `learn_from/opencode.md`

当前 `learn_from` 目录只包含上述 4 份 Markdown；不可见 PDF 或 Warp 文档不纳入本轮依据。

## 资料覆盖清单

本轮规划覆盖的 blog 资料包括：

- Anthropic：building effective agents、Claude Code auto mode、effective harnesses for long-running agents、harness design for long-running apps、managed agents、writing tools for agents。
- Claude：Opus 4.7 best practices、desktop redesign、code review、large codebase practices、frontend skills、agentic coding introduction、prompt caching、memory、multi-agent coordination、seeing like an agent、skills explained、subagents、advisor strategy、session management、CLAUDE.md。
- OpenAI：harness engineering、unlocking the Codex harness、unrolling the Codex agent loop。
- LangChain：evaluating deep agents、improving deep agents with harness engineering。
- Ecosystem：awesome-agent-harness catalog。

本轮规划覆盖的 learn_from 资料包括：

- Claude Code：streaming-first、tool as capability、permission boundary、context as memory、prompt cache、compaction、subagent、tool search、plan mode、hooks、memory。
- Codex：Responses API、SQ/EQ、sandbox、Guardian、fragment injection、remote compact task、feature lifecycle、execution policy、hooks、command runtime。
- DeepSeek TUI：EventFrame、ThreadManager、JobManager、ExecPolicy、Hook sinks、RLM、LSP、side-git、provider profile。
- OpenCode：client/server control plane、MessageV2 part、PubSub、schema tool、plugin、permission、LSP、provider SSE、session parent-child、snapshot rollback。

## 设计思想矩阵

| 主题 | 来源 | 设计思想 | RilleCode V2 落点 |
| --- | --- | --- | --- |
| Agent 基本形态 | Anthropic Building Effective Agents、Claude Introduction | 从简单 loop 开始，只有当任务需要时才增加复杂 agentic system。 | Phase A-C 先定义单 Agent 主闭环和执行边界，Phase P 才引入 subagent。 |
| Harness 分层 | Anthropic Managed Agents、OpenAI Codex Harness | session、harness、sandbox/hand 分离；brain 不应耦合执行环境。 | 目标架构拆成 Session、Harness、Brain Gateway、Hands Runtime、Workspace Substrate。 |
| Prompt cache | Claude Prompt Caching、Claude Code 拆解 | stable prefix 保持字节稳定；不要 mid-session 改工具集；compaction 要 cache-safe fork。 | Phase H 定义 stable/dynamic fragment，Phase L 实现 cache-safe compaction。 |
| Tool design | Anthropic Writing Tools、Claude Seeing Like an Agent、OpenCode Tool 系统 | 少而强、面向 agent 任务设计、schema 驱动、输出高信号、错误可行动、渐进披露。 | Phase E 定义 tool metadata、artifactRef、组合工具、deferred tool/tool search。 |
| 权限与安全 | Claude Auto Mode、Codex Guardian、DeepSeek ExecPolicy、OpenCode Permission | 三模式权限；高风险命令确认；AI classifier/Guardian 可作为第二意见；BashArity 避免过宽匹配。 | Phase F 定义 policy engine、persistent grant、Guardian/classifier、command subject parsing。 |
| Task/Plan | Claude Plan Mode、Claude Seeing Like an Agent | `/plan` 是只读规划提示，不再是独立权限枚举；任务比 todo 更适合多 agent 协作。 | Phase G 定义 TaskContract、PlanItem、planning shortcut 和 user confirmation gate。 |
| Context | Codex Fragment、Claude CLAUDE.md、large codebase best practices | Context 是工作集，不是历史堆叠；项目规则、skills、LSP、MCP 要分层加载。 | Phase H 定义 ContextFragment、project rules、memory_ref、LSP/MCP context。 |
| Reviewable edit | Claude agentic coding、OpenCode Snapshot、DeepSeek side-git | 用户应审查 diff；回滚不污染项目 git；快照和 checkpoint 是用户信任基础。 | Phase I 定义 diff proposal、dirty guard、rollback proposal、side-git/checkpoint。 |
| Verification | Anthropic Harness Design、LangChain Harness Engineering | 完成必须有 evidence；generator 自验证不足；测试失败要进入 repair loop。 | Phase J 定义 Evidence、Coverage、before-stop gate、waiver。 |
| Evaluator | Anthropic Harness Design、Claude Code Review | generator/evaluator 分离，reviewer 要 skeptical，blocking finding 进入修复循环。 | Phase K 定义 rule review、LLM evaluator、reviewer subagent。 |
| Long-running | Anthropic Effective Harnesses、Claude session management、Codex compaction | 长任务靠 feature list、handoff、progress、checkpoint、compaction。 | Phase L 定义 FeatureList、Handoff、ProjectMemory、remote compact task。 |
| Observability/Eval | LangChain evaluating deep agents、OpenAI harness、DeepSeek Hook sinks | Eval 要看 state、trajectory、single-step 和 full-turn；trace 要可导出可脱敏。 | Phase M 定义 TraceEvent、EvalCase、fixture、hooks、metrics。 |
| UX | Claude Desktop redesign、OpenCode MessageV2、DeepSeek EventFrame | UI 应展示状态、风险、流式输出、工具生命周期和 session 列表，而不是 dump 日志。 | Phase N 定义 workbench、streaming UI、session risk card、subagent tree。 |
| Skills/Plugins/MCP | Claude Skills、Claude large codebase、OpenCode Plugin、awesome harness | 专业知识按需加载，插件分发成功配置，MCP 扩展外部工具。 | Phase O 定义 SkillContract、PluginPackage、MCP lifecycle。 |
| Subagent/Advisor | Claude Subagents、Claude Advisor、Codex delegate、OpenCode subagent | 子 agent 用于隔离、并行和 fresh review；advisor 只指导，不执行工具。 | Phase P 定义 explorer/reviewer/verifier/advisor。 |
| 治理和熵清理 | OpenAI Harness Engineering、Codex feature lifecycle、Claude model upgrade | 模型进步后应移除脚手架；配置和 feature flag 需要生命周期。 | Phase Q 定义 feature lifecycle、config audit、model upgrade review。 |

## 各取所长后的 RilleCode 取舍

RilleCode V2 不直接复制任一项目：

- 采用 Claude Code 的 prompt cache 和 planning workflow 思路，但保留 RilleCode 当前的 TypeScript/Electron 技术栈和 IDE UI。
- 采用 Codex 的 session/harness/sandbox 分离、Responses/streaming 模型和 Guardian 安全思想，但不要求 Phase A 就实现 OS 级 sandbox。
- 采用 DeepSeek TUI 的 EventFrame、JobManager、side-git 和 BashArity 思路，但不把 RilleCode 改成 TUI-first。
- 采用 OpenCode 的 part-based message、client/server control plane、schema tool 和 subagent permission 思路，但不引入 Effect-TS 作为必要前提。
- 采用 LangChain 的 eval 方法论，但 eval runner 优先围绕本地 fixture、trace 和 Vitest 生态构建。

## 对当前 RilleCode 的判断

当前 RilleCode 已经不是空白项目。它具备：

- 单 Agent tool loop。
- JSONL session 持久化和 replay。
- TaskContract、Plan、ContextFragment。
- Tool metadata、Policy、PermissionGrant、Observation。
- Diff proposal、runtime-only apply、dirty guard。
- Evidence、Coverage、before-stop gate、rule review、LLM evaluator MVP。
- Handoff、Progress、ProjectMemory MVP。
- TraceEvent、AgentUsage、eval skeleton。
- AgentPanel 基础工作台。

V2 的价值不是推翻这些，而是把这些能力放入更完整的从零架构里，补齐 streaming、cache-safe compaction、subagents、skills/plugins/MCP、eval harness、sandbox/checkpoint 和长期治理。
