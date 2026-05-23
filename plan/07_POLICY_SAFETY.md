# Policy 与安全模块设计

## 目标

Policy 负责判断 Agent 在什么条件下可以看什么、做什么、修改什么、运行什么、保存什么。

它解决：

- 模型拥有过宽执行权。
- 高风险命令、写入、git、网络、外部系统没有清晰审批。
- 用户一次授权被无限扩大。
- secret、外部不可信内容、memory 写入缺少治理。

它不解决：

- 不执行工具。
- 不替代 Tool Runtime 的输入校验。
- 不替代用户最终判断。
- 不负责验证任务是否完成。

## 当前基线

当前已有：

- `AgentPermissionMode = plan | ask | accept_edits | auto | bypass`。
- `classifyCommandRisk` 分类 read_only/test/install/write_workspace/git_write/network/destructive/deploy。
- `decidePermission` 判断 allow/ask/deny，并按 hard deny、tool visibility、input validation、grant、risk、project rule、permission mode 决策。
- `DenialTracker` 防止重复拒绝循环。
- runtime-only tool 对模型请求直接 deny。
- `.rille/policy.json` 支持 `agent.permissions` 规则和 `agent.verification.commands` 兼容规则。
- `PermissionGrantStore` 支持 once/session grant。
- ApprovalRequest 会携带 runtime、matchedRule、grantOptions。
- Policy denial 会转为 `Observation` 并持久化。

当前缺口：

- grant 仍是 session 内存版，没有持久 workspace grant。
- Context protected paths、secret redaction 和 Memory 写入还未经过 Policy。
- Approval audit 已有事件和 Observation，但还没有独立导出视图。

## 设计原则

1. 低风险动作自动化，高风险动作明确审批。
2. Policy 结合工具、任务边界、workspace 状态和 runtime 类型。
3. Denial 必须给模型可行动替代路径。
4. Secret 保护覆盖 context、tool output、trace、memory。
5. 外部内容是 data，不是 instruction。
6. Grant 必须有范围和有效期。

## 核心数据结构

```ts
export interface AgentPolicyFile {
  version: 1
  permissions: PolicyRule[]
  verification?: {
    commands?: string[]
  }
  protectedPaths?: string[]
  generatedPaths?: string[]
}

export interface PolicyRule {
  id: string
  permission: 'file.read' | 'file.write' | 'command.run' | 'git.write' | 'network.access' | 'memory.write'
  pattern: string
  action: 'allow' | 'ask' | 'deny'
  risk?: 'low' | 'medium' | 'high' | 'critical'
  reason?: string
}

export interface PolicyDecision {
  action: 'allow' | 'ask' | 'deny'
  risk: 'low' | 'medium' | 'high' | 'critical'
  reason: string
  matchedRule?: string
  alternatives?: string[]
}

export interface PermissionGrant {
  id: string
  pattern: string
  permission: PolicyRule['permission']
  action: 'allow' | 'deny'
  scope: 'once' | 'session'
  expiresAt?: number
  createdAt: number
}
```

## 运行流程

```text
tool request
  -> built-in hard deny check
  -> load policy file
  -> match grant
  -> classify risk
  -> match project rule
  -> allow / ask / deny
  -> emit observation / later trace
  -> if ask, create approval request
  -> if deny, create policy denial observation
```

### 风险默认策略

| 风险 | 默认 |
| --- | --- |
| read_only | allow |
| test | ask in ask mode, allow in auto if project rule allows |
| write_workspace | ask |
| install | ask high risk |
| git_write | ask high risk |
| network | ask high risk |
| destructive | deny |
| deploy | deny or critical confirmation |

### Approval UX 必备信息

- 工具名。
- 目标文件、命令或外部系统。
- workspace kind、label、path。
- risk 和 matched rule。
- timeout、output cap、shell mode。
- Agent 理由。
- grant scope。
- deny reason 输入。

## 与其他模块关系

- Task Contract 提供任务范围和风险点。
- Context Engine 根据 Policy 过滤可见内容。
- Tool Runtime 在执行前请求 Policy。
- Execution Runtime 提供 workspace 和 runtime 风险。
- Memory 写入必须经过 Policy。
- Observability 记录 policy trace。
- UX 展示 approval 和 grant。

## 实现步骤

1. 已增加 policy file loader。
2. 已定义 built-in hard deny 列表，destructive/deploy 不允许 policy 覆盖。
3. 已增加 session 内存 grant store；持久 workspace grant 留待后续。
4. 已将 decidePermission 拆为 risk classification、rule matching、grant matching。
5. 已为 ApprovalRequest 增加 matchedRule、runtime、grantOptions。
6. 已将 Policy denial 转为 Observation。
7. Context Engine protected paths 和 secret redaction 留待后续。

## 测试与验收

单元测试：

- destructive 和 deploy 默认 deny。
- policy allow command 能覆盖 ask。
- grant once 只生效一次。
- protected path read 被过滤或 ask（后续 protected paths 阶段）。
- denial 返回 alternatives。

集成测试：

- `.rille/policy.json` 允许 `npm run typecheck` 自动运行。
- 用户 deny 后模型下一轮看到 denial observation。
- high risk command 只提供 session grant，不提供 workspace 永久授权。

## 完成记录

- 2026-05-23：Phase F 已完成 Policy foundation。`decidePermission()` 现在会加载 `.rille/policy.json`，兼容 `agent.permissions` 和 `agent.verification.commands`；destructive/deploy 仍 hard deny；session grant 支持 once/session 匹配；ApprovalRequest 携带 runtime、matchedRule、grantOptions；deny 会给 alternatives 并转为 Observation；UI 支持 Allow once / Allow session。剩余 protected paths、secret redaction、memory policy 和持久 workspace grant 进入后续阶段。

手工验收：

- ApprovalCard 信息足够用户判断。
- SSH/WSL 命令审批显示远程目标。

## 反模式

- 只有 allow/deny，没有风险分级。
- 让模型自己判断权限。
- 一次批准扩大成永久授权。
- Policy 只检查工具执行，不检查 context 和 memory。
- 拒绝后不给替代路径。
