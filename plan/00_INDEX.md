# RilleCode Agent 模块化设计文档索引

## 目标

本目录是 RilleCode Agent 后续实现的模块化设计入口。每个核心模块独立成文，方便逐一实现、评审和更新。

执行推进时以 `15_FULL_AGENT_IMPLEMENTATION_MASTER_PLAN.md` 为唯一总控看板。每次完成一个实现步骤后，先更新 15 号文档的完成标记、验证结果、完成记录和下一步指针，再同步对应模块文档。

这套文档解决：

- 把 Agent 设计拆成可执行模块，而不是单一巨型总纲。
- 把当前仓库已有实现作为事实基线。
- 把任务边界、上下文、工具、权限、执行、验证、Review、记忆、Trace 和 UX 的职责分清。
- 给后续工程实现提供明确接口草案、流程、测试和反模式。

这套文档不解决：

- 不直接修改代码。
- 不替代源码中的真实类型定义。
- 不把尚未实现的能力写成已完成。
- 不引入多 Agent 复杂化作为默认路径。

## 阅读顺序

建议按这个顺序阅读和实现：

1. `15_FULL_AGENT_IMPLEMENTATION_MASTER_PLAN.md`：执行总控、完成标记、验收记录和下一步指针。
2. `01_CURRENT_BASELINE.md`：先确认当前系统已经具备什么。
3. `02_TASK_CONTRACT.md`：定义任务边界和验收标准。
4. `03_ORCHESTRATOR_AGENT_LOOP.md`：定义主循环和完成门禁。
5. `04_MODEL_GATEWAY.md`：隔离 provider 和模型输出。
6. `05_CONTEXT_ENGINE.md`：重构上下文构造。
7. `06_TOOL_RUNTIME.md`：治理工具和 Observation。
8. `07_POLICY_SAFETY.md`：引入项目级权限和安全策略。
9. `08_EXECUTION_RUNTIME.md`：稳住 local / WSL / SSH 执行环境。
10. `09_VERIFICATION.md`：建立 evidence-driven completion。
11. `10_REVIEW_QUALITY.md`：建立独立质量门。
12. `11_MEMORY_LONG_RUNNING.md`：支持长任务和可治理记忆。
13. `12_OBSERVABILITY_EVAL.md`：支持 trace、debug、replay 和 eval。
14. `13_PRODUCT_UX.md`：把复杂状态翻译成可控工作台。
15. `14_IMPLEMENTATION_ROADMAP.md`：阶段说明和历史完成记录；执行状态以 15 号文档为准。
16. `16_POST_BLOG_GAP_ANALYSIS.md`：基于 27 篇各家 coding agent 博客的差距分析与后续 Phase K-O 规划。

## 模块依赖图

```text
Task Contract
  -> Orchestrator
  -> Context Engine
  -> Tool Runtime
  -> Policy
  -> Execution Runtime
  -> Verification
  -> Review
  -> Memory / Long-running
  -> Observability / Eval
  -> Product UX

Model Gateway 被 Orchestrator 调用，并消费 Context Engine 输出。
Tool Runtime 只执行受控动作，不决定任务策略。
Policy 横跨 Context、Tool、Execution、Memory 和 UX。
Verification 与 Review 都必须回到 Task Contract 和 Evidence。
```

## 全局设计原则

1. 模型负责推理和候选意图，系统负责边界、执行、验证和恢复。
2. 用户请求先转成 Task Contract，再进入执行。
3. Context 是当前工作集，不是事实源。
4. Tool 是模型影响外部世界的唯一通道。
5. 文件写入默认走 diff proposal。
6. 权限不是最后的拦截器，而是行动链路的一部分。
7. 完成由 evidence 和 review gate 判断，不由模型自述决定。
8. 长任务靠 progress、handoff、checkpoint 和 evidence 维持连续性。
9. Trace 是 debug、eval、resume 和用户信任的基础。
10. 先把单 Agent 闭环做硬，再引入 Skills、Advisor 和 Subagents。
11. Generator 不评估自己的工作，独立 LLM 评估器是质量最后防线。
12. 上下文隔离是能力倍增器，子智能体让每个 Agent 拥有干净的上下文窗口。
13. 缓存意识是架构约束而非性能优化。
14. Eval 是工程的组成部分，不是事后补充。
15. 模型在进步，脚手架要定期拆除。

## 执行规则

1. 完全体协议和架构从一开始纳入设计，避免临时 MVP 形态反复推翻。
2. 编码按可验证小步推进，每一步都要有测试或明确手工验收记录。
3. 新增协议必须补 JSONL replay 兼容测试。
4. 新增 runtime 行为必须补 unit 或 integration 测试。
5. 新增 UI 状态必须能从 event replay 恢复。
6. 每步完成后必须更新 `15_FULL_AGENT_IMPLEMENTATION_MASTER_PLAN.md`。

## 统一文档结构

除索引和路线图外，每个模块文档都使用以下结构：

- 目标
- 当前基线
- 设计原则
- 核心数据结构
- 运行流程
- 与其他模块关系
- 实现步骤
- 测试与验收
- 反模式

## 术语表

| 术语 | 含义 |
| --- | --- |
| Task Contract | 一次任务的目标、范围、非目标、约束、验收标准和风险点 |
| ModelDecision | 模型输出的候选意图，不代表系统事实或执行结果 |
| Observation | 工具、权限、验证、Review 或用户决策产生的新事实 |
| Evidence | 可追溯的完成证据，例如测试输出、诊断、diff、截图、Review 结论 |
| Handoff | 支持暂停、恢复和交接的结构化工作状态 |
| Trace | 可复盘的任务轨迹，覆盖 context、model、tool、policy、runtime、verification、review |

## 基线验证命令

后续改动 Agent 相关模块时，至少运行：

```text
npm test
npm run typecheck
```

涉及构建入口、Electron/Vite 或 renderer 集成时，再运行：

```text
npm run build
```
