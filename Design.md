# 总纲：不要做“AI 聊天写代码”，要做“Agentic Coding Runtime”

Anthropic 这些文章合起来表达的核心不是“Claude 比以前更会写代码”，而是：

> AI Coding 产品的核心竞争力不只是模型，而是 **模型 + 上下文系统 + 工具系统 + 验证系统 + 多 agent 协调 + UI 工作台 + 企业治理 + 成本控制** 组成的完整 runtime。
> 

Agentic coding 的定义也很清楚：它不是 autocomplete，也不是让用户复制粘贴代码片段，而是系统接收高层目标后，自己读取代码库、拆解任务、运行测试、根据反馈迭代，直到目标完成。([Claude](https://claude.com/blog/introduction-to-agentic-coding))

所以产品目标应该从：

```
用户问问题 → 模型回答代码
```

升级为：

```
用户定义目标
↓
agent 理解项目上下文
↓
agent 制定计划
↓
agent 搜索代码、读文件、调用工具
↓
agent 修改代码
↓
hooks / tests / reviewers / subagents 验证
↓
用户审查 diff、批准、合并
```

---

# 1. 产品定位：开发者是 orchestrator，agent 是执行团队

## 1.1 不要把产品做成“聊天框 + 文件树”

Claude Code Desktop redesign 的核心判断是：agentic coding 已经变成“多个任务同时进行”的工作方式。开发者可能同时启动一个重构、一个 bug fix、一个测试补全任务，然后在多个 session 之间切换、检查状态、审查 diff。新版桌面端因此加入了多 session sidebar、拖拽式 workspace、内置 terminal、file editor 等能力。([Claude](https://claude.com/blog/claude-code-desktop-redesign))

这说明 AI Coding 产品的 UI 核心对象不应该是 message，而应该是：

```
Session
Task
Plan
Diff
Terminal output
Test result
Subagent finding
Review comment
Approval decision
```

## 1.2 用户角色变化

传统 IDE 中，用户是直接操作者。

Agentic coding 中，用户更像：

```
目标设定者
上下文提供者
风险裁判
任务调度者
最终 reviewer
```

产品应该让用户能做这些事：

```
- 启动任务
- 看到 agent 当前计划
- 看到 agent 正在读哪些文件
- 看到 agent 修改了什么
- 看到测试和验证结果
- 中途纠偏
- 批准或拒绝改动
- 回滚到某个 checkpoint
```

---

# 2. 总体架构：一个 Claude Code 类产品应该分 10 层

可以把完整系统设计成这样：

```
┌──────────────────────────────────────────┐
│ 1. Workspace UI Layer                     │
│ sessions / tasks / diff / terminal       │
│ editor / preview / side chat / approvals │
├──────────────────────────────────────────┤
│ 2. Agent Runtime Layer                    │
│ planner / executor / loop / checkpoints  │
│ permissions / stop conditions            │
├──────────────────────────────────────────┤
│ 3. Context Management Layer               │
│ session / compact / clear / rewind       │
│ CLAUDE.md / memory / project maps        │
├──────────────────────────────────────────┤
│ 4. Prompt Cache & Cost Layer              │
│ stable prefix / tool schema stability    │
│ cache-safe fork / model routing          │
├──────────────────────────────────────────┤
│ 5. Tool Layer                             │
│ read / grep / glob / edit / shell        │
│ ask_user / plan / task / review          │
├──────────────────────────────────────────┤
│ 6. Code Intelligence Layer                │
│ ripgrep / AST / tree-sitter / LSP        │
│ symbol search / references / diagnostics │
├──────────────────────────────────────────┤
│ 7. Skill & Knowledge Layer                │
│ skills / examples / scripts / assets     │
│ CLAUDE.md / MCP / memory                 │
├──────────────────────────────────────────┤
│ 8. Delegation Layer                       │
│ subagents / verifier / reviewer          │
│ advisor model / multi-agent patterns     │
├──────────────────────────────────────────┤
│ 9. Verification Layer                     │
│ hooks / tests / lint / typecheck         │
│ security review / code review            │
├──────────────────────────────────────────┤
│ 10. Governance & Distribution Layer       │
│ plugins / permissions / audit / budgets  │
│ org policies / analytics / marketplace   │
└──────────────────────────────────────────┘
```

这 10 层里，模型只是其中一层。真正的产品壁垒来自 harness。

---

# 3. 上下文方法论：上下文不是越多越好，而是要分层、隔离、按需加载

Anthropic 反复强调 session、context 和 compaction 的管理会显著影响 Claude Code 的效果；即使有 1M context，也需要考虑什么时候 compact、rewind、clear 或使用 subagents。([Claude](https://claude.com/blog/using-claude-code-session-management-and-1m-context))

## 3.1 上下文分 6 类

| 上下文类型 | 应该放哪里 | 说明 |
| --- | --- | --- |
| 当前任务状态 | session context | 当前目标、计划、已读文件、当前 diff |
| 项目长期约定 | `CLAUDE.md` | 项目结构、常用命令、代码规范、测试方式 |
| 可复用专业流程 | Skills | 安全审查、前端设计、发布流程、迁移流程 |
| 用户/团队偏好 | Memory | 长期偏好、常用工作方式、团队习惯 |
| 外部事实 | MCP / connectors | GitHub issue、Slack、文档、数据库、内部系统 |
| 支线探索 | Subagent context | 大量文件搜索、独立 review、并行任务 |

关键原则：

```
不要把所有东西塞进 system prompt。
不要把所有东西塞进 memory。
不要让支线探索污染主会话。
```

## 3.2 CLAUDE.md：项目地图，不是百科全书

`CLAUDE.md` 的作用是给 Claude persistent project context，让它每次都知道项目结构、编码标准和工作流。Anthropic 明确说它会自动进入每次对话，用来避免重复解释架构、测试要求和代码风格。([Claude](https://claude.com/blog/using-claude-md-files))

一个好的 `CLAUDE.md` 应该包含：

```markdown
# Project Overview
这个项目是什么，主要技术栈是什么。

# Key Directories
src/api/      API routes
src/models/   database models
src/ui/       frontend components

# Commands
pnpm test
pnpm lint
pnpm typecheck

# Coding Standards
- TypeScript strict mode
- Prefer small functions
- Use existing design system components

# Workflow
- For architectural changes, propose a plan first
- For code changes, run related tests before finishing
- Do not edit generated files

# Known Pitfalls
- Auth middleware is shared across API and admin routes
- Payment flow has legacy compatibility logic
```

Anthropic 也强调 `CLAUDE.md` 应该保持简洁、人类可读，并且每一项都应该解决真实遇到过的问题，而不是理论上可能需要的信息；它会成为 Claude 每次会话的一部分。([Claude](https://claude.com/blog/using-claude-md-files))

## 3.3 Skills：任务型知识，按需加载

Skills 不是 prompt 模板，而是可复用工作流包。Anthropic 将 Skills 定位为 Claude agentic ecosystem 的构件之一，用来和 prompts、Projects、MCP、subagents 配合。([Claude](https://claude.com/blog/skills-explained))

更清楚地说：

```
CLAUDE.md 解决：这个项目是什么？
Skills 解决：这类任务应该怎么做？
MCP 解决：外部数据在哪里？
Subagents 解决：谁来独立执行？
Memory 解决：用户/团队长期偏好是什么？
```

一个 coding product 里应该内置这些 skills：

```
frontend-design-skill
security-review-skill
test-writing-skill
migration-skill
performance-debugging-skill
release-checklist-skill
api-design-skill
database-migration-skill
documentation-skill
```

Skill 里不只放文字，还可以放：

```
- instructions
- checklist
- output schema
- examples
- scripts
- templates
- design tokens
- screenshots
- validation commands
```

Frontend design skill 的文章很好地说明了为什么需要 Skills：没有明确指导时，LLM 容易收敛到训练数据里的普通设计，例如 Inter 字体、紫色渐变、白底和少量动画；Skills 可以把模型从“高概率平庸解”拉向更具体的审美方向。([Claude](https://claude.com/blog/improving-frontend-design-through-skills))

## 3.4 Memory：长期偏好，不是代码事实数据库

Memory 适合保存：

```
- 用户偏好的代码风格
- 团队常用工作流
- 常见项目偏好
- 长期业务背景
- 个人协作习惯
```

但不适合保存：

```
- 当前代码文件内容
- 测试结果
- 最新 issue 状态
- 当前 repo 结构
- 安全敏感信息
```

Anthropic 的 Memory 是 project-scoped，用户可以查看和编辑 memory，并且有 incognito chat 不写入 memory；这说明 memory 必须可控、可见、可隔离。([Claude](https://claude.com/blog/memory))

---

# 4. Prompt caching 方法论：缓存是架构约束，不是性能优化细节

Prompt caching 那篇是非常关键的底层设计文章。Anthropic 明确说 Claude Code 的整个 harness 都围绕 prompt caching 构建，高 cache hit rate 可以降低成本和延迟，他们甚至会监控 cache hit rate 并把异常当事故处理。([Claude](https://claude.com/blog/lessons-from-building-claude-code-prompt-caching-is-everything))

## 4.1 Prompt 排列顺序

Claude Code 的 prompt 排列方式是：

```
1. Static system prompt & tools
2. CLAUDE.md
3. Session context
4. Conversation messages
```

原因是 prompt caching 是 prefix match，越稳定的内容越应该放前面，越动态的内容越应该放后面。([Claude](https://claude.com/blog/lessons-from-building-claude-code-prompt-caching-is-everything))

你的 harness 应该遵守：

```
稳定内容前置
动态内容后置
不要频繁改 system prompt
不要中途增删 tools
不要中途切模型
工具定义顺序必须 deterministic
```

## 4.2 不要中途增删工具

直觉上，进入 plan mode 时可以只保留 read-only tools。但 Anthropic 明确说中途改变 tool set 会破坏缓存；Claude Code 的做法是保留同一套 tools，用 EnterPlanMode / ExitPlanMode 这类工具表达状态变化。([Claude](https://claude.com/blog/lessons-from-building-claude-code-prompt-caching-is-everything))

也就是说：

```
错误做法：
进入 plan mode → 移除 edit/shell tools

正确做法：
保留 tools → 用 state/tool/message 告诉 agent 当前是 plan mode
```

## 4.3 Compaction 要 cache-safe

如果长会话需要总结，不要用一个完全不同的 summarization prompt 和 tool set 去重新发完整历史，因为这样会失去缓存。Claude Code 的做法是用和父会话相同的 system prompt、user context、tool definitions，然后在末尾追加 compact prompt。([Claude](https://claude.com/blog/lessons-from-building-claude-code-prompt-caching-is-everything))

你可以把这个设计成：

```
compact_session(parent_session):
    reuse parent system prompt
    reuse parent tool schemas
    reuse parent project context
    append compaction request
    produce summary
    resume new session with summary
```

---

# 5. 工具设计方法论：从 agent 视角设计工具，不是从 API 清单出发

`Seeing like an agent` 的核心是：agent harness 最难的部分之一是工具设计；到底给一个通用 bash，还是给很多专用工具，取决于模型是否真的能理解和稳定调用。([Claude](https://claude.com/blog/seeing-like-an-agent))

## 5.1 工具要少而强

不要一开始设计几十个工具。基础工具应该是：

```
read_file
list_files
grep
glob
edit_file
run_shell
run_tests
ask_user
create_plan
update_task
review_diff
spawn_subagent
consult_advisor
```

判断是否新增工具时，问 5 个问题：

```
1. 模型是否经常需要这个动作？
2. 模型用自然语言/普通 shell 做是否不稳定？
3. 这个动作是否需要结构化输入输出？
4. 这个动作是否影响权限、安全或用户体验？
5. 新工具是否会增加模型决策负担？
```

## 5.2 结构化交互要工具化

Anthropic 最后做了 `AskUserQuestion` tool：当 Claude 需要问用户问题时，调用工具，前端弹出 modal，并阻塞 agent loop，直到用户回答。这样比让模型输出某种 Markdown 格式可靠得多。([Claude](https://claude.com/blog/seeing-like-an-agent))

因此你应该把这些交互做成工具：

```
ask_user_choice
request_approval
confirm_risky_change
select_files
choose_strategy
approve_plan
approve_diff
```

不要依赖模型自己写：

```markdown
Please choose:
1. ...
2. ...
3. ...
```

因为格式可能不稳定，也不容易变成可靠 UI。

## 5.3 工具要随模型能力演进

Anthropic 早期用 TodoWrite 帮模型保持任务方向，但后来随着模型能力提升，todo 和提醒反而可能限制模型调整路线，于是工具需要演进。([Claude](https://claude.com/blog/seeing-like-an-agent))

这意味着 harness 不是一次性设计。你需要持续观察：

```
- 哪些工具很少被正确调用？
- 哪些工具导致模型卡住？
- 哪些工具已经不再需要？
- 哪些 prompt 约束现在反而限制强模型？
- 哪些任务应该从 prompt 变成 tool？
- 哪些 tool 应该从 tool 变成 skill？
```

---

# 6. Codebase 理解方法论：不要只靠 RAG，要让 agent 在 live codebase 中探索

大型代码库文章强调，Claude Code 已在多百万行 monorepo、老旧系统、几十个 repo 的分布式架构、上千开发者组织中使用；这些场景下，关键不是把所有代码塞进上下文，而是让系统能帮助 agent 找到正确上下文。([Claude](https://claude.com/blog/how-claude-code-works-in-large-codebases-best-practices-and-where-to-start))

## 6.1 代码理解应该分 4 层

```
1. 文件系统层
   list, glob, read

2. 文本搜索层
   ripgrep, grep, exact search

3. 结构搜索层
   AST, tree-sitter, import graph

4. 语义/符号层
   LSP, go-to-definition, find references, diagnostics
```

对于大型代码库，只靠 grep 会有大量噪音；应该接 LSP，让 agent 能按符号理解代码。

## 6.2 让代码库对 agent 可导航

需要提供：

```
- 根目录 CLAUDE.md
- 子目录 CLAUDE.md
- codebase map
- ignore rules
- generated files exclusion
- common commands by directory
- test selection rules
- LSP server
- dependency graph
```

Large codebases 文章中也把这些 extension component 的边界讲得很清楚：`CLAUDE.md` 是每次自动读取的项目上下文，hooks 是事件触发脚本，skills 是按需加载的复用专业能力，plugins 用来把配置在组织内分发。([Claude](https://claude.com/blog/how-claude-code-works-in-large-codebases-best-practices-and-where-to-start))

---

# 7. 多 agent 方法论：多 agent 不是越多越好，而是信息流设计

Anthropic 的 multi-agent coordination 文章给出 5 种模式，并建议从最简单能工作的模式开始，而不是因为某个架构听起来高级就使用它。([Claude](https://claude.com/blog/multi-agent-coordination-patterns))

## 7.1 五种模式

| 模式 | 适合场景 | Coding 场景 |
| --- | --- | --- |
| Generator-Verifier | 有明确评估标准 | 写代码 + 测试/审查 |
| Orchestrator-Subagent | 任务可拆分，子任务有边界 | 主 agent + 研究 subagent |
| Agent Teams | 长期、并行、独立任务 | monorepo 大规模迁移 |
| Message Bus | 事件驱动 pipeline | CI failure、PR、alert 触发不同 agent |
| Shared State | 多 agent 共享发现 | 研究系统、知识图谱、issue board |

## 7.2 推荐默认路径

不要从 Agent Teams 起步。建议路径是：

```
阶段 1：Single Agent
阶段 2：Generator-Verifier
阶段 3：Orchestrator-Subagent
阶段 4：Agent Teams
阶段 5：Message Bus / Shared State
```

## 7.3 Subagent 的真正价值是 context isolation

Subagent 适合：

```
- 研究型任务
- 多个独立子任务
- fresh perspective review
- commit 前验证
- 并行探索
```

Anthropic 明确说，当理解代码是修改前提时，subagent 可以探索代码库并返回摘要，而不是把几十个文件都倒进主会话；这能保持主对话干净。([Claude](https://claude.com/blog/subagents-in-claude-code))

默认 routing policy 可以这样设计：

```
if files_to_read_estimate > 10:
    spawn read-only research subagent

if independent_subtasks >= 3:
    spawn parallel subagents

if task_type == "review":
    spawn fresh reviewer subagent

if task_touches_security_or_payment:
    spawn security verifier subagent

if task_is_small:
    keep in main agent
```

## 7.4 不要滥用 subagents

不适合 subagents 的场景：

```
- 小任务
- 强顺序依赖任务
- 多个 agent 同时编辑同一个文件
- agent 之间需要实时通信
- specialist agents 太多导致路由混乱
```

如果多个 agent 需要持续协作和共享状态，就不要硬用 subagents，应该升级到 Agent Teams 或 Shared State。

---

# 8. Advisor 方法论：不要全程用最强模型，要按需升级智能

Advisor strategy 很关键：让 Sonnet 或 Haiku 作为 executor 执行完整任务，负责工具调用、读取结果、迭代；当 executor 遇到无法合理解决的决策时，咨询 Opus advisor。Advisor 不直接调用工具，也不产生用户可见输出，只返回计划、修正或停止信号。([Claude](https://claude.com/blog/the-advisor-strategy))

这给出一种比 multi-agent 更轻的智能分层方式：

```
默认模型：负责执行
强模型 advisor：负责关键判断
```

适合 advisor 的场景：

```
- 架构设计分歧
- agent 多轮修复失败
- 测试一直过不了
- diff 变得过大
- 涉及安全/支付/权限
- 需要判断是否停止
- 需要选择多种方案之一
```

Advisor API 还支持 `max_uses` 控制调用次数，并单独报告 advisor tokens，方便成本治理。([Claude](https://claude.com/blog/the-advisor-strategy))

产品里可以设计：

```
advisor_policy:
  max_uses_per_task: 3
  trigger_on:
    - repeated_test_failure >= 2
    - high_risk_file_changed
    - architecture_change
    - large_diff
    - confidence_low
```

---

# 9. 验证方法论：AI Coding 的瓶颈会从“生成”转向“验证”

Code Review 文章给出了很重要的判断：AI 让代码产出增长后，code review 成为瓶颈。Claude Code 的 Code Review 会在每个 PR 上派出一组 agents，目标是捕捉人类 skim 容易漏掉的 bug，强调“深度而不是速度”。([Claude](https://claude.com/blog/code-review))

因此 AI Coding 产品不能只做：

```
write code
```

而必须做：

```
write code
↓
run tests
↓
lint/typecheck
↓
review diff
↓
security review
↓
risk ranking
↓
human approval
```

## 9.1 Hooks 是硬约束，prompt 是软约束

不要只在 prompt 里写：

```
完成前请运行测试。
```

应该做成 hook：

```
BeforeStop:
  if code_changed and tests_not_run:
      run related tests
      if failed:
          block stop
          return failure output to agent
```

Large codebases 文章中也明确区分了 hooks 和 prompts：hooks 是关键时刻自动运行的脚本，适合自动化一致行为；常见错误是把应该自动运行的东西写成 prompt。([Claude](https://claude.com/blog/how-claude-code-works-in-large-codebases-best-practices-and-where-to-start))

## 9.2 Verification layer 设计

建议内置这些 verifier：

```
test_verifier
- 运行相关测试
- 判断失败是否与改动相关
- 提供最小失败上下文

typecheck_verifier
- TypeScript / mypy / pyright / tsc
- 把错误映射到文件和符号

lint_verifier
- eslint / ruff / prettier / biome
- 自动修复安全的格式问题

security_verifier
- auth
- permission
- injection
- secret leakage
- payment/user data changes

diff_verifier
- diff 是否过大
- 是否改了无关文件
- 是否修改 generated files
- 是否引入 debug logs

architecture_verifier
- 是否破坏模块边界
- 是否绕过已有 abstraction
- 是否重复造轮子
```

## 9.3 Review comments 要经过聚合和排序

不要让每个 reviewer agent 直接评论。应该：

```
candidate findings
↓
deduplicate
↓
verify
↓
rank severity
↓
filter low-confidence
↓
render inline comments
```

否则 AI review 会变成噪音制造机。

---

# 10. UI 方法论：做 agent 工作台，不是聊天窗口

UI 应围绕并行任务、状态可见、diff 审查、验证证据来设计。

## 10.1 推荐布局

```
┌─────────────────────────────────────────────┐
│ Top: repo / branch / task / usage / mode    │
├───────────────┬─────────────────────────────┤
│ Left Sidebar  │ Main Workspace              │
│               │                             │
│ Sessions      │ Diff / Editor / Preview     │
│ Tasks         │                             │
│ Subagents     │                             │
│ PRs           │                             │
├───────────────┴─────────────────────────────┤
│ Bottom: terminal / tests / logs             │
├─────────────────────────────────────────────┤
│ Right: agent timeline / plan / findings     │
└─────────────────────────────────────────────┘
```

## 10.2 必备 UI 对象

```
Session Card:
- repo
- branch
- task title
- status
- last action
- risk level
- tests status

Agent Timeline:
- plan created
- files read
- commands run
- edits made
- tests run
- subagents spawned
- advisor consulted
- waiting for approval

Diff Review:
- file-level summary
- inline changes
- test evidence
- risk findings
- approve / reject / request revision

Side Chat:
- 解释问题
- 临时问答
- 不污染主任务上下文
```

Desktop redesign 里的关键不是它加了哪些控件，而是它把用户放在 orchestrator seat：多任务并行、用户随时检查、纠偏和审查 diff。([Claude](https://claude.com/blog/claude-code-desktop-redesign))

---

# 11. 权限与安全方法论：默认可控，逐步授权

Agentic coding 需要执行命令、编辑文件、读项目，风险比普通 chat 高很多。

建议权限分层：

```
Read-only:
- list files
- read files
- grep
- LSP navigation

Safe edit:
- edit source files
- create tests
- update docs

Sensitive edit:
- auth
- payment
- security config
- database migration
- infra files

Shell:
- safe commands
- test commands
- install commands
- destructive commands

External:
- GitHub
- Slack
- internal docs
- production data
```

默认策略：

```
- 读文件不需要确认
- 修改文件需要展示 diff
- 执行测试命令可以自动
- install/delete/migration/deploy 需要确认
- 涉及 auth/payment/security 自动触发 reviewer
- destructive shell command 必须阻止或确认
```

---

# 12. 企业化方法论：把个人经验变成组织能力

大型组织中，最危险的是“高手本地配置得很好，但团队无法复用”。Anthropic 的 large codebases 文章强调，plugins 可以把 skills、hooks、MCP configs 打包分发，避免好的设置停留在 tribal knowledge。([Claude](https://claude.com/blog/how-claude-code-works-in-large-codebases-best-practices-and-where-to-start))

企业化需要：

```
- project-level CLAUDE.md
- team-level skills
- org-level plugins
- permission policy
- cost budgets
- audit logs
- review dashboards
- MCP registry
- approved tool list
- security-owned rules
```

## 12.1 组织级插件

一个企业插件可以包含：

```
company-coding-plugin/
  skills/
    security-review/
    frontend-design/
    release-checklist/
  hooks/
    before-stop-test.sh
    before-commit-review.sh
  mcp/
    github.json
    internal-docs.json
  policies/
    permissions.yaml
    spend-limits.yaml
```

## 12.2 管理指标

必须跟踪：

```
Productivity:
- tasks completed
- average task duration
- manual intervention rate

Quality:
- test pass rate
- review finding acceptance rate
- reverted changes
- bugs after merge

Agent behavior:
- tool call success rate
- repeated failure loops
- subagent usefulness
- advisor trigger rate

Cost:
- token usage per task
- cache hit rate
- advisor spend
- subagent spend

Safety:
- blocked commands
- sensitive file touches
- permission escalations
- policy violations
```

---

# 13. MVP 到成熟产品的路线图

## Phase 1：单 agent 可用闭环

目标：跑通最小 coding loop。

```
- repo 打开
- read / grep / edit / shell
- task plan
- diff viewer
- run tests
- user approval
- session history
```

成功标准：

```
用户能让 agent 修一个小 bug，并看到 diff 和测试结果。
```

## Phase 2：上下文和项目适配

```
- CLAUDE.md 支持
- /clear
- /compact
- /rewind
- ignore rules
- project commands
- basic LSP
```

成功标准：

```
agent 在中型代码库里不迷路，不反复问基础项目结构。
```

## Phase 3：验证闭环

```
- before-stop hook
- test verifier
- lint/typecheck verifier
- diff verifier
- generated file protection
- risky file detection
```

成功标准：

```
agent 不会在明显测试失败或 lint 失败时声称完成。
```

## Phase 4：Skills 和专业能力

```
- skill discovery
- frontend design skill
- security review skill
- test writing skill
- migration skill
- release skill
```

成功标准：

```
特定任务质量显著提升，而不污染所有任务上下文。
```

## Phase 5：Subagents 和 Advisor

```
- read-only research subagent
- reviewer subagent
- parallel subagents
- advisor model routing
- max cost controls
```

成功标准：

```
大任务能拆解，复杂决策能升级，成本仍可控。
```

## Phase 6：PR Review 和企业治理

```
- GitHub PR review
- severity ranking
- org plugins
- permission policies
- audit logs
- spend dashboards
- MCP registry
```

成功标准：

```
从个人 coding assistant 进化为团队 DevEx 基础设施。
```

---

# 14. 关键反模式

## 反模式 1：把所有知识塞进 system prompt

应该改成：

```
CLAUDE.md：项目常驻上下文
Skills：任务型专业知识
Memory：长期偏好
MCP：动态外部事实
Subagents：隔离探索
```

## 反模式 2：只做 RAG，不让 agent 自己探索

应该提供：

```
grep + read + LSP + AST + code map
```

让 agent 能逐步发现上下文。

## 反模式 3：所有任务都开多 agent

应该先判断：

```
是否有独立子任务？
是否需要隔离上下文？
是否需要 fresh perspective？
是否有明确聚合机制？
```

没有这些，就用单 agent。

## 反模式 4：让模型“记得跑测试”

应该用 hook 强制执行。

## 反模式 5：review agent 直接发评论

应该经过 verifier / aggregator / severity ranking。

## 反模式 6：中途换工具、换模型、改 system prompt

会破坏 prompt cache，增加成本和延迟。Claude Code 的经验是要保持 tool set 和 prompt prefix 稳定。([Claude](https://claude.com/blog/lessons-from-building-claude-code-prompt-caching-is-everything))

---

# 15. 最终设计原则清单

可以把整套 Anthropic / Claude Code 方法论压缩成 20 条原则：

1. **不要做聊天机器人，做 agentic coding runtime。**
2. **用户是 orchestrator，不是逐行指挥者。**
3. **消息不是核心对象，task / diff / test / approval 才是核心对象。**
4. **上下文是稀缺资源，要分层、隔离、按需加载。**
5. **CLAUDE.md 放项目常驻知识。**
6. **Skills 放可复用任务流程。**
7. **Memory 放长期偏好，不放动态代码事实。**
8. **MCP 连接外部动态数据。**
9. **Subagents 用来隔离探索、并行任务和独立 review。**
10. **Prompt caching 是架构约束，不是后期优化。**
11. **稳定 prefix、稳定 tool set、稳定模型是成本控制关键。**
12. **工具要从 agent 视角设计，少而强。**
13. **结构化交互要工具化，不要依赖 Markdown 格式。**
14. **不要只靠 RAG，要让 agent 在 live codebase 里探索。**
15. **大型代码库需要 LSP、ignore rules、codebase map。**
16. **多 agent 的本质是信息流设计，不是 agent 数量。**
17. **Advisor strategy 适合按需升级智能。**
18. **确定性验证必须做进 runtime，不能靠 prompt。**
19. **AI code review 要深度、验证、去重、排序。**
20. **企业落地靠 plugins、policy、audit、analytics，而不是个人经验。**

---

# 16. 一句话总方法论

> 一个优秀的 AI Coding 产品，不是把最强模型接进 IDE，而是构建一个可控、可验证、可扩展、可治理的工程执行系统：让 agent 能理解项目、调用工具、隔离上下文、复用技能、按需升级智能、自动验证结果，并让人类在关键节点审查和决策。
>