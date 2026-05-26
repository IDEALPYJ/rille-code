# V2 实现路线图

## 路线原则

1. 先闭环，再扩展；先单 Agent，再 subagents。
2. 每个里程碑都要能 replay、verify、export trace。
3. 协议和事件先行，runtime 其次，UI 最后。
4. 对用户工作区有副作用的能力必须有 policy、diff/review 或 sandbox。
5. Eval case 随功能增长，不在末尾补债。

## Milestone 1: Foundation

覆盖 Phase A-C。

目标：

- 明确产品合同和系统边界。
- 建立 durable session/event log。
- 稳住 workspace execution substrate。

当前状态：

- Phase A-C 已实现。

已完成任务：

- 已补齐 `plan` 自身的执行总控和完成标记规则。
- 已增加 archive/unarchive session 设计和实现。
- 已建立 ArtifactRef store 作为大输出、trace、verification output、runtime state、checkpoint 的基础。
- 已为 workspace runtime state 定义统一 artifact/event 路径。

里程碑验收：

```text
Session 可创建、运行、恢复、归档。
Event replay 后 UI 状态一致。
命令和文件访问都经过 workspace route 和 path guard。
大输出不会直接塞入 JSONL。
```

## Milestone 2: Core Loop

覆盖 Phase D-H。

目标：

- 完成 Brain Gateway、Tool Runtime、Policy、TaskContract、Context Engine 主闭环。
- 建立 streaming-ready 和 cache-aware 的模型调用基础。

当前状态：

- Phase D-H 已实现。

已完成任务：

- 已实现 SSE streaming event model。
- 已完成 OpenAI Responses API adapter。
- 已加入 provider fallback matrix。
- 已为 tools 加 artifactRef、deferred discovery 和组合工具。
- 已引入 explicit Plan Mode、PlanConfirmation 和 user confirmation gate。
- 已将 cache metrics 与 ContextTrace 打通。

里程碑验收：

```text
一次任务能从 TaskContract 到 tool loop 到 evidence gate 完成。
模型输出可流式显示，tool call delta 可追踪。
Context trace 能解释 included/excluded 和 cache behavior。
高风险动作默认 ask 或 deny。
```

## Milestone 3: Safety and Quality

覆盖 Phase I-M。

目标：

- 补齐 reviewable edit、rollback、verification、review/evaluator、long-running memory、trace/eval。

当前状态：

- Phase I-M 已实现。

优先任务：

- 已实现 checkpoint/side-git snapshot、checkpoint restore proposal 和 sandbox diff proposal。
- 已增加 browser/user evidence 和 waiver UI。
- 已将 evaluator config/run 提升为可追踪 public protocol。
- 已实现 explicit `context.compacted`、cache-safe compact fork 和 compaction task。
- 已扩展 eval runner：fixture setup/teardown、single-step、full-turn。
- 已增加 lifecycle hooks。

里程碑验收：

```text
所有写入可 diff review、拒绝、回滚。
code_changed 后没有 evidence 不能 final。
LLM evaluator finding 能阻塞 final 并进入 repair。
长任务 resume 能恢复 handoff、feature progress 和 stale warning。
eval runner 能验证 trajectory、state 和 forbidden actions。
```

## Milestone 4: UX and Extensibility

覆盖 Phase N-O。

目标：

- 完成 IDE 工作台体验，建立 skills/plugins/MCP 扩展体系。

当前状态：

- N 已实现。
- O 未实现。

优先任务：

- 已完成 Session card 展示 risk、latest verification、last action、handoff。
- 已完成 Composer 支持 `/plan`、`/fix`、`/verify`、`@file`、`#selection`。
- 已完成 Trace/debug view 和 subagent 协议占位树。
- SkillContract、skill discovery、progressive disclosure。
- MCP registry、namespace、policy 和 lifecycle。

里程碑验收：

```text
用户不用读完整日志即可判断任务目标、风险、证据和下一步。
技能按需加载，不污染稳定 prompt prefix。
MCP 工具有 namespace、policy 和 trace。
```

## Milestone 5: Scale-out

覆盖 Phase P-Q。

目标：

- 引入 subagents、advisor、parallel work 和长期治理。

当前状态：

- P/Q 未实现。

优先任务：

- SubagentContract 和 parent-child session tree。
- Explorer / Verifier / Reviewer subagents。
- Advisor advisory-only flow。
- Parallel scheduling and merge gate。
- Feature lifecycle、model upgrade review、config audit、scaffold cleanup。

里程碑验收：

```text
Explorer subagent 可隔离探索并返回结构化发现。
Reviewer subagent 能用 fresh context 审查 diff。
Advisor 只给建议，不调用工具，不面向用户输出。
主 Agent 对所有 subagent 输出做合并、裁决和验证。
每次模型/配置升级都有 eval 和清理记录。
```

## 推荐实施顺序

1. ArtifactRef store。
2. Streaming event model。
3. Responses API adapter and provider fallback trace。
4. Explicit Plan Mode and user confirmation gate。
5. Checkpoint / side-git rollback。
6. Browser/user evidence and waiver UI。
7. Cache-safe compaction。
8. Eval harness expansion。
9. Session card and composer UX。
10. Skills/plugins/MCP.
11. Subagents and advisor。
12. Release governance。

当前入口：A-N 已收口，后续从 Phase O1 SkillContract 和扩展体系继续。

## 每阶段固定记录

完成任一 Phase 或重要子项后，记录：

```text
Phase:
Step:
Status:
Implemented files:
Protocol changes:
Runtime changes:
UI changes:
Tests:
Validation commands:
Known risks:
Next phase:
```
