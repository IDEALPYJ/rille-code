# Tool Runtime 模块设计

## 目标

Tool Runtime 负责把模型意图转成受控、可审计、可恢复的真实行动。

它解决：

- 模型直接影响外部世界。
- 工具输入复杂导致模型经常填错。
- 工具输出只是混乱文本，无法指导下一步。
- 工具失败无法进入 repair loop。
- model-visible 工具和 runtime-only 操作边界不清。

它不解决：

- 不决定任务策略。
- 不判断最终完成。
- 不负责 UI 审批展示。
- 不替代 Execution Runtime。

## 当前基线

当前 `toolRegistry` 已有：

model-visible：

```text
get_active_editor
get_open_files
read_diagnostics
list_directory
read_file
search_files
git_status
git_diff
propose_file_edit
run_command
```

runtime-only：

```text
apply_file_edit
```

当前 `executeToolCall` 已统一捕获异常并返回 `AgentToolResult`。

当前缺口：

- 没有统一 ToolFailure 分类。
- 没有 Observation 类型。
- 大输出没有 artifact ref。
- 工具 schema 校验依赖模型遵守，没有 runtime schema validator。
- 结构化交互工具不足，例如 ask_user、update_plan、select_files。

## 设计原则

1. Tool 是模型影响外部世界的唯一通道。
2. 工具请求是意图，不是执行结果。
3. 工具少而强，输入贴近模型认知。
4. 输出必须能支持下一步决策。
5. 失败要结构化，不能只有字符串。
6. 副作用必须显式标记。

## 核心数据结构

```ts
export interface RegisteredTool {
  definition: AgentToolDefinition
  visibility: 'model' | 'runtime' | 'ui'
  sideEffect: 'none' | 'workspace_read' | 'workspace_write' | 'process' | 'network' | 'external'
  summarize(input: Record<string, unknown>, context: AgentContextSnapshot): string
  validate(input: Record<string, unknown>): ToolValidationResult
  execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResultView>
}

export interface ToolValidationResult {
  ok: boolean
  normalizedInput?: Record<string, unknown>
  error?: string
}

export type ToolFailureType =
  | 'invalid_input'
  | 'unknown_tool'
  | 'permission_denied'
  | 'path_not_found'
  | 'path_outside_workspace'
  | 'conflict'
  | 'timeout'
  | 'environment_missing'
  | 'output_too_large'
  | 'cancelled'
  | 'tool_failed'
```

```ts
export interface ToolObservation {
  id: string
  callId: string
  toolName: string
  status: 'ok' | 'error' | 'denied' | 'timeout' | 'conflict'
  summary: string
  structured?: Record<string, unknown>
  artifactRef?: string
  failureType?: ToolFailureType
  createdAt: number
}
```

## 运行流程

```text
ModelDecision.request_tool_calls
  -> tool exists
  -> validate input
  -> Policy decision
  -> Execution Runtime route
  -> capture output / error / timeout
  -> create ToolObservation
  -> emit tool.completed
  -> feed observation into next context
```

### 新增工具

```text
ask_user
  用于结构化澄清，不让模型用 Markdown 伪造用户选择。

update_plan
  用于结构化更新 plan card。

select_files
  用于请求用户选择文件或确认范围。

inspect_symbol
  用于后续 LSP/symbol 能力。

find_references
  用于影响面分析。
```

### 编辑工具边界

- `propose_file_edit` 继续 model-visible。
- `apply_file_edit` 保持 runtime-only。
- Ask 默认模式下，模型不能直接写盘。
- accept_edits / auto 也必须经过 Policy 和 EditStore conflict check。

## 与其他模块关系

- Orchestrator 分发 ModelDecision。
- Policy 判断工具是否允许。
- Execution Runtime 执行文件、命令、远程动作。
- EditStore 处理编辑提案。
- Context Engine 注入 ToolObservation。
- Verification 使用命令、诊断、diff 工具结果作为 evidence。

## 实现步骤

1. 为 RegisteredTool 增加 visibility 和 sideEffect。
2. 增加 runtime input validator。
3. 将 ToolResultView 转换为 ToolObservation。
4. 为失败分类补标准字段。
5. 增加 artifactRef 支持。
6. 增加 ask_user 和 update_plan 工具。
7. 将 ToolObservation 写入 session event。

## 测试与验收

单元测试：

- runtime-only tool 被模型请求时拒绝。
- invalid input 返回 invalid_input。
- path outside workspace 返回结构化失败。
- output too large 产生 artifact ref 或 truncated marker。

集成测试：

- mock model 调用 propose_file_edit，产生 diff proposal observation。
- denied command 进入 observation，不重复请求。
- ask_user 阻塞 loop 直到用户回答。

手工验收：

- UI 展示工具名、输入摘要、状态、失败分类。
- 模型无法绕过 proposal 直接写文件。

## 反模式

- 直接暴露底层 API 给模型。
- 工具输出一大段不可行动日志。
- 工具失败只抛异常。
- 所有工具都 model-visible。
- 工具自己判断完整安全策略。
