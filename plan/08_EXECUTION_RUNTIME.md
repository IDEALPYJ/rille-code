# Execution Runtime 模块设计

## 目标

Execution Runtime 定义 Agent 行动发生在哪里、以什么状态执行、如何记录环境事实、如何保护用户工作。

它解决：

- local / WSL / SSH 路径和命令执行分散。
- 命令卡住、输出过大、环境错误难以判断。
- dirty workspace 被覆盖。
- 远程工作区风险不透明。
- 验证结果缺少运行环境信息。

它不解决：

- 不决定任务策略。
- 不判断权限。
- 不判断任务完成。
- 不管理模型调用。

## 当前基线

当前已有：

- `AgentWorkspaceLocation` 支持 `local | ssh | wsl`。
- `workspace.ts` 统一 read directory、read file、write file、search、git status、git diff、run command。
- `withinWorkspace` 做路径边界检查。
- `needsShell` 判断 shell mode。
- remote workspace 通过 `WorkspaceHost` 路由。
- `workspaceRunCommand` 有 timeout 和 output limit。

当前缺口：

- 没有 dev server/process registry。
- 没有 checkpoint/snapshot。
- verification evidence 未记录完整 workspace state。
- remote runtime 的 UI 风险信息还不完整。
- dirty workspace 区分用户改动和 Agent 改动仍不足。

## 设计原则

1. Workspace 当前状态是一等事实。
2. 用户已有修改必须被保护。
3. Runtime 类型影响 Policy 风险。
4. 命令必须可超时、可取消、可截断。
5. 验证 evidence 必须包含运行环境。
6. Checkpoint 用于长任务和高风险修改。

## 核心数据结构

```ts
export interface RuntimeState {
  workspace: AgentWorkspaceLocation
  git?: {
    branch?: string
    head?: string
    statusSummary: string
    dirtyFiles: string[]
    untrackedFiles: string[]
  }
  processes: RuntimeProcessSummary[]
  capturedAt: number
}

export interface RuntimeProcessSummary {
  id: string
  commandLine: string
  cwd: string
  status: 'running' | 'exited' | 'failed' | 'cancelled'
  port?: number
  startedAt: number
}

export interface RuntimeCommandResult {
  output: string
  exitCode: number | null
  status: 'ok' | 'error' | 'timeout' | 'cancelled'
  durationMs: number
  truncated: boolean
  workspaceStateRef?: string
}

export interface CheckpointRef {
  id: string
  kind: 'edit_snapshot' | 'turn_snapshot' | 'side_git_snapshot'
  changedFiles: string[]
  createdAt: number
}
```

## 运行流程

```text
tool execution request
  -> require workspace
  -> resolve local/remote route
  -> enforce withinWorkspace
  -> capture pre-state if needed
  -> execute read/write/search/git/command
  -> enforce timeout/output cap
  -> capture result and runtime metadata
  -> emit runtime trace
```

### 写入规则

- 所有写入通过 EditStore。
- 写入前检查 originalContent 是否匹配。
- 冲突时不覆盖当前文件。
- rollback 生成反向 proposal，不静默写回。

### 命令规则

- cwd 必须在 workspace 内。
- 默认 timeout 120s，最大 600s。
- 默认 output cap 50KB，最大 512KB。
- shell write 由 Policy 拦截，推荐 propose_file_edit。
- long-running dev server 后续进入 process registry。

## 与其他模块关系

- Tool Runtime 定义动作语义。
- Policy 判断动作能否执行。
- EditStore 使用 Runtime 写文件。
- Verification 使用 Runtime 运行命令并记录环境。
- Context Engine 使用 Runtime 读取 workspace facts。
- Observability 保存 runtime trace。

## 实现步骤

1. 增加 RuntimeState 捕获工具。
2. 让 command result 附带 workspace kind、cwd、duration、truncated。
3. 将 verification result 绑定 RuntimeState。
4. 增加 process registry，用于 dev server 和长命令。
5. 增加 checkpoint API，先基于 edit snapshots。
6. 对 remote workspace 的 approval details 补 host/path。

## 测试与验收

单元测试：

- withinWorkspace 拒绝越界。
- cwd 越界被拒绝。
- timeout 返回 timeout 状态。
- output 超限标记 truncated。
- remote workspace 调用 host。

集成测试：

- apply edit 冲突不覆盖用户修改。
- verification evidence 包含 workspace kind 和 path。
- SSH/WSL tool result 包含 label。

手工验收：

- dirty 文件被修改前显示风险。
- 命令被取消或超时后 Agent 能继续说明状态。

## 反模式

- 本地和远程各写一套工具路径。
- 命令无 timeout。
- 写文件绕过 EditStore。
- 只看工具名，不看 runtime 风险。
- 验证报告不说明在哪个环境运行。
