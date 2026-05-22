# Memory 与 Long-running 模块设计

## 目标

Memory 和 Long-running 模块负责让 Agent 在未来任务中复用可靠知识，并在复杂任务中保持目标、进度、证据和风险不丢失。

它解决：

- 长任务依赖聊天上下文，reset 后无法继续。
- 进度记录过度乐观。
- 已实现但未验证的功能被标记为完成。
- 模型总结无来源地变成长期事实。
- 错误或过期记忆污染后续任务。

它不解决：

- 不替代 Event Log。
- 不替代 Verification。
- 不默认写入用户级或组织级记忆。
- 不把所有历史都放进上下文。

## 当前基线

当前已有：

- JSONL session events。
- session meta 和 summaries。
- resume last session。
- verification status 汇总。

当前缺口：

- 没有 project memory。
- 没有 Feature List、Progress、Handoff。
- 没有 checkpoint refs。
- 没有 memory source refs、stale、superseded、conflict 状态。
- Resume 时未检查 handoff 与 workspace 是否冲突。

## 设计原则

1. Event Log 记录发生过什么，Memory 记录未来值得复用的知识。
2. Memory 少而准，可追溯、可编辑、可删除。
3. Memory 注入上下文前必须检查相关性、新鲜度和安全。
4. 长任务状态比长上下文更重要。
5. Feature 状态必须区分 implemented_unverified 和 verified。
6. Handoff 是下一轮如何继续，不是漂亮总结。

## 核心数据结构

```ts
export interface ProjectMemoryEntry {
  id: string
  kind: 'command' | 'convention' | 'decision' | 'known_issue' | 'workflow' | 'handoff'
  text: string
  sourceRefs: string[]
  status: 'active' | 'stale' | 'superseded' | 'conflict'
  createdAt: number
  updatedAt: number
}

export interface FeatureItem {
  id: string
  title: string
  status: 'not_started' | 'in_progress' | 'implemented_unverified' | 'verified' | 'blocked' | 'dropped'
  acceptanceCriteriaIds: string[]
  evidenceRefs: string[]
  riskRefs: string[]
}

export interface ProgressState {
  taskContractId: string
  activeFeatureId?: string
  featureList: FeatureItem[]
  failedAttempts: string[]
  unresolvedRisks: string[]
  nextSteps: string[]
  updatedAt: number
}

export interface Handoff {
  id: string
  taskContractId: string
  summary: string
  completed: string[]
  implementedUnverified: string[]
  failedAttempts: string[]
  changedFiles: string[]
  evidenceRefs: string[]
  unresolvedRisks: string[]
  nextSteps: string[]
  createdAt: number
}
```

## 运行流程

### Memory 写入

```text
stable knowledge discovered
  -> verify source
  -> classify memory kind
  -> policy check
  -> create memory entry with sourceRefs
  -> user visible review if needed
```

### Long-running

```text
large task
  -> create Feature List
  -> track Progress
  -> feature implemented
  -> run Verification / Review
  -> mark verified or implemented_unverified
  -> write Handoff at pause / compaction / phase boundary
  -> resume checks workspace freshness
```

### Resume 检查

- 当前 git status 是否变化。
- handoff changed files 是否仍存在。
- evidence 是否对应当前 workspace。
- unresolved risks 是否仍有效。
- 上次 active feature 是否仍应继续。

## 与其他模块关系

- Task Contract 是长任务根目标。
- Context Engine 按需加载 memory 和 handoff。
- Verification 决定 feature 是否 verified。
- Review 决定阶段质量是否可接受。
- Policy 控制 memory 写入。
- Observability 记录 memory read/write trace。
- UX 展示 feature list 和 resume view。

## 实现步骤

1. 先在 session store 中保存 ProgressState 和 Handoff event。
2. 增加 Feature List part。
3. 在 compact / pause / stop 时生成 handoff。
4. Resume 时比较 handoff 和 workspace state。
5. 增加 project memory 文件读取候选。
6. Memory 写入先只支持用户确认的 project-level entry。
7. 增加 stale / conflict 标记。

## 测试与验收

单元测试：

- feature implemented_unverified 不能自动变 verified。
- evidence stale 时 feature 回到 partial。
- memory 无 sourceRefs 不允许写入。
- conflict memory 不注入 context。

集成测试：

- 长任务暂停后恢复，能展示 next steps。
- workspace 变化后 resume 显示 stale warning。
- handoff 包含 changed files 和 failed attempts。

手工验收：

- 多阶段任务中用户能看到哪些已验证、哪些未验证。
- 恢复任务时无需读完整历史。

## 反模式

- 把聊天摘要当 Memory。
- 什么都记。
- 没有来源的记忆。
- 长任务只靠长上下文。
- Handoff 只有总结，没有下一步和风险。
