# RilleCode Agent Planning Index

## 定位

`plan/` 现在按阶段拆分为两套规划：

- `step1/`：RilleCode Agent V2 基线完成记录，覆盖 Phase A-Q，说明当前本地 agent harness 已经实现的协议、runtime、UX、eval 和治理能力。
- `step2/`：下一阶段完整实现规划，目标是从“本地完整 agent harness”升级为接近 Claude Code Desktop、Codex Desktop、Cursor 的顶尖桌面/远程 agent 产品。

## 阅读顺序

1. `step1/00_INDEX.md`：理解已完成的 V2 基线。
2. `step1/06_IMPLEMENTED_STATUS_MATRIX.md`：核对当前源码能力。
3. `step2/00_INDEX.md`：理解下一阶段目标和文档结构。
4. `step2/04_PHASE_R_TO_Z_MASTER_PLAN.md`：查看 Phase R-Z 总计划。
5. `step2/05_IMPLEMENTATION_ROADMAP.md`：查看推荐实施顺序。
6. `step2/08_EXECUTION_TRACKER.md`：后续执行时维护状态和完成记录。

## 维护规则

- Step1 只做历史基线修正，不承载新能力规划。
- Step2 是新增能力的唯一规划入口。
- 文档结构、状态矩阵、验收策略和执行总控必须同步更新。
- 文档路径使用相对当前文件的路径，避免移动后引用根目录旧文件。

## 文档验收命令

```bash
find plan -maxdepth 2 -type f | sort
rg -n "TO""DO|TB""D|待""补" plan/step1 plan/step2
rg -n "plan/0""[0-8]_|plan/0""4_|plan/0""5_|plan/0""6_|plan/0""7_|plan/0""8_" plan
```
