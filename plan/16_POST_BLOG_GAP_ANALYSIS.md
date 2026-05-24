# 博客分析差距与下一步完善计划

## 文档定位

本文件基于对 27 篇各家 (Anthropic、OpenAI、LangChain、Claude Code) coding agent 设计理念博客的系统分析，对照 RilleCode 当前实现（Phase D-I、J1 与 J 后端 hardening 已完成），识别关键差距并规划后续 Phase。

**核心结论**：RilleCode 在"单 Agent + 强护栏"范式下已达到很高完成度，Task Contract 和 Verification Gate 的实现是业界一流水平。但与 Anthropic/OpenAI 的前沿实践相比，在 **LLM 评估器、子智能体并行、上下文压缩、Eval 框架、Advisor 策略** 方面存在显著差距——这些正是博客中反复论证的"从能用到好用"的关键跃升点。

本文件不替代 `15_FULL_AGENT_IMPLEMENTATION_MASTER_PLAN.md`，而是在其基础上为下一步工作提供方向论证和优先级排序。

---

## 一、博客分析摘要

### 1.1 已高度对齐的能力（保持并持续打磨）

| 能力 | 博客共识 | RilleCode 现状 |
|------|---------|---------------|
| Task Contract / Sprint Contract | Anthropic、LangChain 一致推荐 | `taskContract.ts` — 六维合同模型 + 模型可更新 |
| 证据驱动的完成判定 | Anthropic Harness、LangChain Deep Agents | Evidence → Coverage → Gate → Review 四层验证链 |
| Diff Proposal 模式 | Anthropic Writing Tools | `propose_file_edit` + runtime-only `apply_file_edit` |
| 权限纵深防御 | Anthropic Auto Mode、OpenAI Harness | 8 级命令风险分类 + DenialTracker + `.rille/policy.json` |
| 渐进式上下文披露 | Claude Skills、CLAUDE.md、Large Codebases | stable_prefix/dynamic_suffix + 17 种 FragmentType + 确定性裁剪 |
| 结构化上下文交接 | Anthropic Effective Harnesses、Managed Agents | Handoff + ProgressState + FeatureItem |
| 可观测性/Trace | LangChain、OpenAI | TraceEvent (9 种子类型) + AgentUsage + trajectory metrics |

### 1.2 关键差距（按影响力排序）

| 优先级 | 差距 | 博客来源 | 当前状态 | 影响 |
|--------|------|---------|---------|------|
| **P0** | 独立 LLM 评估器 | Anthropic Harness Design — "分离生成器和评估器是最强杠杆" | 已有可选 LLM evaluator MVP：配置读取、skeptical prompt、diff/evidence 输入、review merge、source badge、usage trace；仍缺完整 EvaluatorAgent 抽象 | 语义审查已起步，但还需稳定成可观测质量层 |
| **P0** | 子智能体/并行执行 | Claude Subagents、Multi-Agent Coordination、Desktop Redesign、OpenAI Codex | 单 Agent 循环，明确不做多 Agent | 无上下文隔离、无并行探索、无独立验证 Agent |
| **P1** | 上下文压缩 (Compaction) | Claude Session Management、OpenAI Codex Loop — "compaction 是长对话必需品" | 协议定义了 `compacting_context` stage 但未实现 | 长任务会撑爆上下文窗口 |
| **P1** | 流式输出 (Streaming) | Claude Prompt Caching — "streaming 改善用户体验和感知延迟" | 无 streaming，模型调用是阻塞的 | 用户等待时间长，无渐进式反馈 |
| **P1** | Eval 框架 | LangChain Evaluating Deep Agents — "每个数据点需要专属测试逻辑" | 仅有 EvalCase 类型定义和基础 trajectory 匹配 | 无法做回归测试、无法量化改进效果 |
| **P2** | Advisor 策略（分层模型） | Claude Advisor Strategy — "以前沿模型 1/5 成本实现同等质量" | 单模型/会话 | token 成本无法优化 |
| **P2** | 工具粒度组合化 | Anthropic Writing Tools、Claude Seeing Like an Agent — "为 Agent 设计组合工具" | 15 个原子工具，底层操作 | Agent 选择负担大，容易做出次优工具调用序列 |
| **P2** | Worktree/沙箱隔离 | Anthropic Managed Agents、OpenAI Codex — "沙箱是安全的结构性保障" | 直接在工作区操作，无隔离 | Agent 错误操作直接影响用户工作区 |
| **P3** | 持久化 Feature List 文件 | Anthropic Effective Harnesses — "JSON feature list 是跨会话的真实来源" | Handoff 在内存/事件中，无磁盘文件 | 跨会话连续性依赖 replay，不够健壮 |
| **P3** | 环境 bootstrap (init.sh) | Anthropic Effective Harnesses | 无环境初始化概念 | 新会话需要重新探索环境 |
| **P3** | 模型版本升级配置审查 | Claude Opus 4.7 Best Practices、Large Codebases | 无自动审查机制 | 配置随模型升级而过时 |

---

## 二、下一步 Phase 规划

### 总体路线

```text
Phase K: LLM Evaluator + Reviewer Model (P0)
Phase L: Subagents + Parallel Execution (P0)
Phase M: Streaming + Compaction + Eval Framework (P1)
Phase N: Advisor Strategy + Tool Composition (P2)
Phase O: Worktree Isolation + Feature List + Bootstrap (P2-P3)
```

原则：

- 每 Phase 独立可验证，不依赖后续 Phase。
- P0 优先：LLM 评估器和子智能体是博客中最反复强调的差异化能力。
- P1 紧随：没有 compaction 和 streaming，用户体验始终受限。
- P2-P3 是锦上添花，在核心闭环更稳定后推进。
- 每个 Phase 保持"先协议、再 runtime、最后 UI"的实现顺序。

---

## Phase K: LLM Evaluator + Reviewer Model

### 目标

将当前的规则驱动 Review (`runRuleBasedReview`) 升级为独立 LLM 评估器，实现真正的 Generator-Evaluator 分离。这是 Anthropic Harness Design 博客中论证的"单一改进效果最大的杠杆"。

### 核心设计

```
Generator Agent (当前 AgentLoop)
  → 产出: code changes + evidence
  → 不参与: 对自己的工作质量判断

Evaluator Agent (新增, 独立 LLM 调用)
  → 输入: TaskContract + Evidence + Diff + VerificationResult
  → 输出: ReviewResult (findings + severity + blocking + recommendation)
  → 特点: 被调校为"skeptical"（怀疑态度），不轻信生成器的自我评估
```

### 博客依据

> "Separating the agent doing the work from the agent judging it proves to be a strong lever."
> "Tuning a standalone evaluator to be skeptical turns out to be far more tractable than making a generator critical of its own work."
> — Anthropic, Harness Design for Long-Running Application Development

> "验证器的好坏取决于其标准。只被告知'检查输出是否良好'而没有进一步标准的验证器，只会对生成器的输出走个过场。"
> — Claude, Multi-Agent Coordination Patterns

### 实现步骤

- [x] K1. 协议扩展：`EvaluatorConfig` 暂保持 runtime 内部配置，不提升到 shared protocol；后续需要 UI/IPC 时再正式增加 public protocol。
- [x] K2. 实现 `EvaluatorRunner`：已从 AgentLoop final gate 抽出独立 runner 边界；后续 reviewer subagent 进入 Phase L。
- [x] K3. Evaluator prompt 工程：注入"skeptical reviewer"角色指令，明确评估标准（正确性、安全性、测试覆盖、架构一致性、范围控制），并包含受限 diff 摘要。
- [x] K4. 将 `runFinalGate()` 的 rule-based review 与 LLM evaluator 合并；当前为顺序执行 MVP，后续可改为真正并行。
- [x] K5. 评估器成本控制：支持 `maxTokens`、默认仅 code_changed 触发、独立 model profile、timeout 和 evaluator usage trace。
- [x] K6. AgentPanel 展示 LLM evaluator 发现，与 rule-based finding 区分来源。
- [x] K7. 补充 evaluator prompt、评估结果合并、provider maxTokens 测试。
- [x] K8. 更新 01、10、14、15、16 文档并记录当前 MVP 验证结果。

### 当前状态

Phase K 已完成当前收口目标：`agent.evaluator` 配置由 `.rille/policy.json` 读取；默认关闭，开启后在 code_changed final gate 中通过 `EvaluatorRunner` 调用独立模型配置；输入包含 TaskContract、Evidence、changed/proposed files、受限 diff 摘要和高风险点；输出复用 ReviewResult，并用 `source: 'llm'` 与 rule finding 区分。该配置仍是 runtime 内部类型，不是 shared public protocol。

当前验证结果：`npm test` 为 16 files / 138 tests passed；`npm run typecheck` passed；`npm run build` passed；文档占位检查无输出；总控 checklist 可列出当前完成与未完成项。

### 验收标准

```text
- code_changed 后，LLM evaluator 独立审查 diff 和 evidence
- evaluator 能发现 rule-based review 无法检测的语义问题（如逻辑错误、不完整实现）
- evaluator 的 blocking finding 阻止 completed
- evaluator 使用独立模型调用，不影响生成器上下文
- 简单任务（无 code change）不触发 evaluator，节省成本
```

---

## Phase L: Subagents + Parallel Execution

### 目标

从单 Agent 循环扩展为支持子智能体的编排架构。实现上下文隔离的并行探索、独立验证和流水线工作流。

### 核心设计

```
Main Agent (Orchestrator)
  ├── Explorer Subagent (read-only, 上下文隔离)
  │     → 搜索代码库、理解架构、返回结构化发现
  ├── Verifier Subagent (read-only + command)
  │     → 运行测试、检查诊断、验证修改
  └── Reviewer Subagent (read-only)
        → 审查 diff、评估质量（与 Phase K 的 Evaluator Agent 协同）
```

### 博客依据

> "将子智能体视为 Claude Code 会话的浏览器标签页：一个可以追踪旁支事务而不会丢失主线程的地方。"
> — Claude, Subagents in Claude Code

> "当需要探索十个或更多文件，或涉及三个或更多独立工作单元时，这是引导 Claude 使用子智能体的强烈信号。"
> — Claude, Subagents in Claude Code

> "For many developers, the shape of agentic work has changed. You're not typing one prompt and waiting. You're kicking off a refactor in one repo, a bug fix in another..."
> — Claude, Redesigning Claude Code on Desktop for Parallel Agents

> "模式之间的核心区别在于它们如何管理上下文边界和信息流。"
> — Claude, Multi-Agent Coordination Patterns

### 实现步骤

- [ ] L1. 协议扩展：增加 `SubagentContract`、`SubagentRole`、`SubagentResult`、`subagent.started/completed` 事件。
- [ ] L2. 实现 `SubagentRunner`：创建隔离的 AgentLoop 实例，限制工具集和权限（read_only / review_only）。
- [ ] L3. 实现 Explorer Subagent：只读工具（read_file、search_files、list_directory、git_status、git_diff），上下文独立于主 Agent。
- [ ] L4. 实现 Verifier Subagent：可运行验证命令，产出 Evidence，不修改文件。
- [ ] L5. 主 Agent 增加 `delegate_explorer` 和 `delegate_verifier` 工具。
- [ ] L6. 并行执行：独立子任务（如同时探索两个模块）使用 Promise.all 并行调度。
- [ ] L7. 子智能体输出验证：主 Agent 必须合并、裁决和验证所有子智能体输出。
- [ ] L8. AgentPanel 展示 Subagent 调用状态和输出摘要。
- [ ] L9. 补充 subagent isolation、并行执行、输出合并、权限边界测试。
- [ ] L10. 更新 01、03、06、14、15、16 文档。

### 验收标准

```text
- Explorer subagent 能独立探索大型代码库而不污染主 Agent 上下文
- 多个独立 Explorer 可并行运行
- Subagent 无权写文件或执行高风险命令
- Subagent 输出被主 Agent 引用和裁决，不是直接通过
- Subagent 失败时主 Agent 能感知并采取替代策略
```

---

## Phase M: Streaming + Compaction + Eval Framework

### 目标

补齐三个基础能力：流式输出改善用户体验、上下文压缩支持长任务、Eval 框架支持回归测试和持续改进。

### M1: Streaming

#### 博客依据

> "streaming 改善用户体验和感知延迟"
> — Claude, Prompt Caching is Everything

#### 实现要点

- [ ] M1.1. provider 层增加 SSE streaming 支持（OpenAI/Anthropic/Gemini）。
- [ ] M1.2. ModelAdapter 增加 streaming parse 模式（增量 JSON 解析）。
- [ ] M1.3. AgentLoop 支持 streaming turn（逐 token 推送到 UI）。
- [ ] M1.4. AgentPanel 展示 streaming 文本和渐进式 tool call 状态。

### M2: Compaction

#### 博客依据

> "在模型最不智能的时候进行压缩——即上下文退化最严重的时候。"
> — Claude, Session Management and 1M Context

> "当 token 总数超过阈值时，自动将对话压缩为更小的表示。"
> — OpenAI, Unrolling the Codex Agent Loop

#### 实现要点

- [ ] M2.1. 实现 `compactContext()` ：截断阈值触发 → 调用模型生成结构化摘要（goal、progress、key findings、open issues、next steps）。
- [ ] M2.2. Compaction 保留 TaskContract + Plan + Evidence + Handoff，只压缩中间工具输出。
- [ ] M2.3. Compaction 复用 parent 的 system prompt 前缀以保持 prompt cache 热度。
- [ ] M2.4. Compaction 后注入 `session_summary` fragment 到后续 turn。

### M3: Eval Framework

#### 博客依据

> "深度智能体的每个数据点都需要专属的测试逻辑。回归问题通常发生在单个决策点上，而非整个执行序列中。"
> — LangChain, Evaluating Deep Agents

> "干净、可重现的评估环境至关重要。深度智能体评估需要每个测试都重置环境。"
> — LangChain, Improving Deep Agents with Harness Engineering

#### 实现要点

- [ ] M3.1. 扩展 EvalCase：增加 `setupCommands`、`teardownCommands`、`expectedEvidence`、`expectedFindings`、`forbiddenActions`。
- [ ] M3.2. 实现 EvalRunner：创建隔离 workspace → 运行 setup → 提交任务 → 收集 trace → 运行 teardown → 断言。
- [ ] M3.3. 支持单步评估（验证特定工具调用）和完整轨迹评估（验证端到端行为）。
- [ ] M3.4. 建立 eval case 库：成功场景、修复场景、拒绝场景、越界场景、dirty workspace 场景。
- [ ] M3.5. 集成到 CI：`npm run eval` 运行完整 eval suite。

### 验收标准

```text
Streaming:
- 模型输出逐 token 显示在 UI 中
- Tool call 在模型完成推理后立即展示，不等所有 tool 执行完

Compaction:
- 超过阈值（如 80% context budget）时自动触发压缩
- 压缩后 Task Contract 和关键 Evidence 不丢失
- 压缩后的上下文能正确引导后续 turn

Eval:
- 至少 10 个 eval case 覆盖主要场景
- CI 中可运行 eval suite
- 新增 Agent 行为修改必须通过 eval 回归测试
```

---

## Phase N: Advisor Strategy + Tool Composition

### 目标

引入分层模型架构优化成本/智能平衡，以及组合工具减少 Agent 选择负担。

### N1: Advisor Strategy

#### 博客依据

> "在执行者遇到困难时咨询顾问——这颠覆了常见的大模型编排器 + 小模型工作者模式。以前沿模型 1/5 的成本实现同等质量。"
> — Claude, The Advisor Strategy

> "顾问绝不直接调用工具或产生面向用户的输出。顾问仅提供指导（计划、纠正、停止信号）。"
> — Claude, The Advisor Strategy

#### 实现要点

- [ ] N1.1. 协议扩展：增加 `AdvisorConfig`（触发条件、max_uses、model preference）。
- [ ] N1.2. 实现 `AdvisorAgent`：只读、不调用工具、仅输出指导文本。
- [ ] N1.3. AgentLoop 增加 advisor 触发点：规划前（复杂任务分解）、修复前（连续失败时）、审查前（高风险修改）。
- [ ] N1.4. 成本追踪：advisor token 独立核算，与 executor token 分开展示。

### N2: Tool Composition

#### 博客依据

> "更多的工具通常会导致更差的结果，而不是更好。工具应整合功能，一次性处理多个步骤。不要围绕 API 端点设计工具；要围绕代理自然解决任务的方式设计工具。"
> — Anthropic, Writing Effective Tools for AI Agents

> "偏好专用工具而非让模型解析非结构化输出。提高添加新工具的门槛。"
> — Claude, Seeing Like an Agent

#### 实现要点

- [ ] N2.1. 审查现有 15 个工具的调用频率和失败率（基于 Trace 数据）。
- [ ] N2.2. 合并高频组合：`explore_codebase` (read_file + search_files + list_directory 的智能组合)、`verify_changes` (git_diff + diagnostics + test run)。
- [ ] N2.3. 工具描述 prompt 工程：增加使用场景、反模式、输出格式示例。
- [ ] N2.4. A/B 测试：对比组合工具 vs 原子工具的任务完成率和 token 消耗。

### 验收标准

```text
Advisor:
- 复杂任务（>3 个 plan items 或 high risk）自动触发 advisor
- Advisor token 消耗独立追踪
- Advisor 建议可被 executor 忽略（advisory only）

Tool Composition:
- 工具数量保持在 12 个以下
- 高频工具调用序列被合并为组合工具
- 组合工具的 token 消耗低于原子工具序列
```

---

## Phase O: Worktree Isolation + Feature List + Bootstrap

### 目标

补齐环境隔离、跨会话持久化和环境初始化三个基础设施能力。

### O1: Worktree Isolation

#### 博客依据

> "沙箱是安全的结构性保障。大脑不应等待手的配置。"
> — Anthropic, Scaling Managed Agents

#### 实现要点

- [ ] O1.1. 实现 `WorktreeSandbox`：创建 git worktree → Agent 在隔离目录中操作 → 完成后合并或丢弃。
- [ ] O1.2. Workspace 抽象增加 `kind: 'worktree'`。
- [ ] O1.3. 沙箱内 Agent 无权访问主工作区的未提交更改。
- [ ] O1.4. 沙箱结果通过 git diff 或 patch 文件回传到主工作区。

### O2: 持久化 Feature List

#### 博客依据

> "一个包含特性需求列表的 JSON 文件（所有特性初始标记为'失败'）...这为所有未来的会话奠定了基础。"
> — Anthropic, Effective Harnesses for Long-Running Agents

#### 实现要点

- [ ] O2.1. 实现 `.rille/features.json`：持久化的 FeatureItem 列表，跨会话共享。
- [ ] O2.2. Session 启动时读取 features.json，结束时更新状态。
- [ ] O2.3. Handoff 引用 features.json 中的 feature ID。

### O3: 环境 Bootstrap

#### 博客依据

> "每个编码会话应遵循标准化的'定位'程序：运行 pwd，阅读 git 日志，阅读进度文件，确定下一个要处理的高优先级特性，在开始任何新工作之前运行测试验证现有功能。"
> — Anthropic, Effective Harnesses for Long-Running Agents

#### 实现要点

- [ ] O3.1. 支持 `.rille/init.sh` 或 `.rille/init.json` 定义会话启动命令。
- [ ] O3.2. Session 创建时自动运行 bootstrap → 收集环境信息 → 注入 context。
- [ ] O3.3. Bootstrap 输出作为 `environment_info` fragment 纳入 context。

### 验收标准

```text
Worktree:
- Agent 可选在隔离 worktree 中操作
- 沙箱内修改不直接影响主工作区
- 用户可审查沙箱 diff 后决定是否合并

Feature List:
- features.json 在会话间持久化
- Resume 时能自动定位下一个待处理 feature
- Feature 状态变更立即写回 JSON 文件

Bootstrap:
- 新会话自动运行 init.sh（如果存在）
- Bootstrap 失败时阻止 Agent 执行
```

---

## 三、优先级与时间线建议

```text
Phase K (LLM Evaluator)          ████████████ 预计 2-3 周  P0 - 最大单项改进
Phase L (Subagents)              ████████████ 预计 3-4 周  P0 - 架构扩展
Phase M1 (Streaming)             ██████       预计 1 周     P1 - 用户体验
Phase M2 (Compaction)            ██████       预计 1-2 周   P1 - 长任务支撑
Phase M3 (Eval Framework)        ████████     预计 2 周     P1 - 质量保障
Phase N1 (Advisor Strategy)      ██████       预计 1-2 周   P2 - 成本优化
Phase N2 (Tool Composition)      ████         预计 1 周     P2 - 工具优化
Phase O1 (Worktree Isolation)    ██████       预计 1-2 周   P2 - 安全加固
Phase O2 (Feature List)          ███          预计 0.5 周   P3 - 持久化
Phase O3 (Bootstrap)             ███          预计 0.5 周   P3 - 环境初始化
```

### 建议执行顺序

1. **Phase K 先行** — LLM Evaluator 是博客中最一致的推荐，且实现风险低（本质是一个受控的独立 LLM 调用），能立即提升完成质量。
2. **Phase L 紧跟** — 子智能体是架构级的扩展，影响面大，需要在 K 稳定后推进。
3. **Phase M1 穿插** — Streaming 是纯增量功能，可在 K/L 进行中并行开发。
4. **Phase M2 在 L 之后** — Compaction 依赖多轮对话场景，子智能体到位后更容易触发长上下文。
5. **Phase M3 持续建设** — Eval case 可以逐步积累，不需要一次性完成。
6. **Phase N/O 按需推进** — 成本和隔离优化，在核心体验稳定后再投入。

---

## 四、全局设计原则补充

基于博客分析，在现有 10 条原则（见 `00_INDEX.md`）基础上补充：

11. **Generator 不评估自己的工作。** 独立 LLM 评估器是验证质量的最后一道防线。规则审查是必要的但不是充分的。
12. **上下文隔离是一种能力倍增器。** 子智能体不仅仅是"并行执行"，更重要的是让每个 Agent 拥有干净的上下文窗口，不被无关信息干扰。
13. **缓存意识是架构约束而非性能优化。** stable_prefix/dynamic_suffix 分区已为此奠定基础，Compaction 和 Streaming 的实现也要考虑缓存影响。
14. **Eval 是工程的组成部分，不是事后补充。** 深度 Agent 的行为难以靠直觉预测，eval case 是唯一可重复的验证手段。
15. **模型在进步，脚手架要定期拆除。** 每个 Phase 实现的能力都要设计为可降级、可移除的。当模型能力提升到不再需要某个护栏时，应及时移除而非保留为技术债务。

---

## 五、与现有文档的关系

- 本文件是 `14_IMPLEMENTATION_ROADMAP.md` 和 `15_FULL_AGENT_IMPLEMENTATION_MASTER_PLAN.md` 的后续扩展。
- `15_FULL_AGENT_IMPLEMENTATION_MASTER_PLAN.md` 的 J2-J9 中有部分内容与本文件的 Phase L/N 重叠（Skills、Subagents、Advisor），执行时以本文件为准。
- 每个 Phase 完成后，需同步更新 `01_CURRENT_BASELINE.md`、对应模块文档和 `15_FULL_AGENT_IMPLEMENTATION_MASTER_PLAN.md`。
- 本文件的 Phase 编号从 K 开始，承接已完成的 Phase D-I、J1 与 J 后端 hardening；J2-J9 中与 Skills/Subagents/Advisor 重叠的内容迁移到 Phase L/N。

---

## 六、立即行动项

以下是可以立即开始的工作，不需要等待其他 Phase：

1. **阅读 `plan/` 中与 Phase K 相关的设计文档**（`09_VERIFICATION.md`、`10_REVIEW_QUALITY.md`），为 LLM Evaluator 协议设计做准备。
2. **收集当前 Trace 数据**：分析 Agent 最常见的失败模式（什么类型的 verification 失败最多？什么类型的 review finding 最频繁？），为 Evaluator prompt 工程和 Eval case 设计提供数据支撑。
3. **审查现有 15 个工具的调用统计**：识别高频组合、低效调用和可合并序列，为 Phase N2 Tool Composition 提供依据。
4. **建立 eval case 骨架**：即使没有完整 EvalRunner，也可以先手工记录 5-10 个典型任务场景，作为后续自动化 Eval 的基础。
