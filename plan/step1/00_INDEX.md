# Step1 / RilleCode Agent V2 基线完成记录索引

## 定位

`plan/step1/` 是 RilleCode Agent V2 的基线完成记录。它从 Phase A 到 Phase Q 描述完整本地 Agent Runtime 的设计、实现状态、验收策略和完成记录。

Step1 的定位是历史基线：保留已经完成的 V2 架构事实，不再作为下一阶段新增能力的主规划入口。新的顶尖桌面/远程 Agent 产品化路线见 `../step2/00_INDEX.md`。

本规划吸收两类资料：

- `OpenSourceCode/blogs/`：Anthropic、Claude、OpenAI、LangChain 等关于 agent harness、tool design、prompt cache、subagents、eval、managed agents 的行业设计思想。
- `OpenSourceCode/learn_from/`：Claude Code、Codex、DeepSeek TUI、OpenCode 的源码拆解和可借鉴工程模式。

## 阅读顺序

1. `01_SOURCE_SYNTHESIS.md`：先看参考资料如何被抽象为 RilleCode 的设计原则。
2. `02_TARGET_ARCHITECTURE.md`：看完整目标架构和模块边界。
3. `03_PROTOCOL_AND_EVENTS.md`：看从零协议、事件、消息 part 和 trace 设计。
4. `04_PHASE_A_TO_Q_MASTER_PLAN.md`：看 Phase A 到 Phase Q 的完整实现计划。
5. `05_IMPLEMENTATION_ROADMAP.md`：看依赖顺序、里程碑和实施节奏。
6. `06_IMPLEMENTED_STATUS_MATRIX.md`：看当前源码已经实现了哪些目标能力。
7. `07_ACCEPTANCE_AND_TEST_STRATEGY.md`：看验收、测试和 eval 策略。
8. `08_EXECUTION_TRACKER.md`：看执行总控、完成标记表和完成记录。

## 状态标记

| 状态 | 含义 |
| --- | --- |
| 已实现 | 当前源码中已有核心协议、runtime 行为、持久化或测试证据，后续只需扩展或打磨。 |
| 部分实现 | 当前源码已有骨架或 MVP，但缺少关键边界、产品交互、协议完整性或评估闭环。 |
| 未实现 | 当前源码没有可用能力，或只有文档预留但没有 runtime 行为。 |

## V2 设计原则

1. IDE-native agent 不是聊天助手；它必须能理解 workspace、diff、diagnostics、verification 和 user approval。
2. Session 是 durable state，context window 只是临时视野。
3. Harness 控制边界、恢复、验证和审计；Brain 只提出候选意图。
4. Hands 是受控执行环境，可以是 local、WSL、SSH、worktree、sandbox 或未来 remote runtime。
5. Tool 是模型影响外部世界的唯一通道；runtime-only action 不能暴露给模型。
6. Ask 默认，deny-and-continue，危险动作 fail closed。
7. Task Contract 和 Plan 先于执行，Evidence 和 Review 决定完成。
8. Generator 不评估自己的工作；独立 evaluator/reviewer 是质量层。
9. Context 通过 fragment pipeline 构造；stable prefix、dynamic suffix 和 cache key 是架构约束。
10. 长任务依靠 handoff、feature list、checkpoint、compaction 和 event log，而不是无限聊天历史。
11. Subagent 用于上下文隔离和并行探索，不能绕过主 Agent 的 policy、verification 和 review。
12. Eval 是工程能力；要评估 trajectory、state、tool choice、policy compliance 和 final outcome。
13. UI 消费事件和状态，不在前端实现 Agent Loop。
14. 每个阶段都要可验证、可回放、可降级、可删除。

## 执行更新规则

- 实际推进时以 `08_EXECUTION_TRACKER.md` 的完成标记为准。
- 完成任一 Phase 或 checklist item 后，更新 `08_EXECUTION_TRACKER.md` 的状态、验证结果、完成记录和下一步指针。
- 若源码事实发生变化，同步更新 `06_IMPLEMENTED_STATUS_MATRIX.md`。
- 若 Phase 范围或验收标准发生变化，同步更新 `04_PHASE_A_TO_Q_MASTER_PLAN.md` 和 `07_ACCEPTANCE_AND_TEST_STRATEGY.md`。

## 文档验收命令

```bash
rg -n "TO""DO|TB""D|待""补" plan/step1 plan/step2
rg -n "下一步.*Phase ""K|Phase ""K.*下一步" plan/step1
rg -n "已实现|部分实现|未实现" plan/step1/06_IMPLEMENTED_STATUS_MATRIX.md
```
