# Step2 协议与事件规划

## 新增协议族

### MCP Transport

- `McpTransportConfig`：`stdio | http | sse`，包含 endpoint、headers/env secret refs、timeout、heartbeat、reconnect policy。
- `McpConnectionState`：connecting、ready、degraded、reconnecting、failed、stopped。
- `McpAuthRef`：只保存 secret 引用，不把明文写入 session/event/trace。

### Plugin Hook Runtime

- `PluginHookManifest`：hook name、entrypoint、permission、timeout、sandbox、env allowlist。
- `HookRun`：pluginId、hookName、status、duration、artifactRefs、redacted input/output。
- `HookPolicyDecision`：allow、ask、deny 和原因。

### Subagent Worker

- `SubagentPermissionScope` 扩展 writable/worktree/remote worker scope。
- `SubagentWorktree`：baseRef、branchName、changedFiles、proposalSetId、verificationRefs。
- `SubagentModelPolicy`：requiredModel、fallbackMode、budget、failureVisibility。

### Automation and Queue

- `AutomationSpec`：name、schedule、trigger、taskContractTemplate、workspace、modelProfile、status。
- `AutomationRun`：queued、running、waiting_review、blocked、completed、failed、cancelled。
- `ReviewQueueItem`：plan confirmation、approval、diff proposal、failed evidence、blocking finding、automation handoff。

### Remote Worker

- `RemoteWorkerSpec`：provider、workspaceRef、bootstrap、secretRefs、resourceClass。
- `RemoteWorkerState`：provisioning、ready、running、syncing、failed、disposed。
- `EnvironmentSnapshot`：git ref、dependency hash、toolchain summary、bootstrap logs。

### Context Governance

- `ContextSourceRegistryEntry`：source、priority、trust、activation reason、conflicts。
- `RulesActivationTrace`：loaded files、matched globs、ignored files、conflict resolution。

### Model Eval Telemetry

- `RealModelEvalRun`：model profile、fixture、trajectory、score、cost、latency、failure category。
- `ModelABResult`：baseline、candidate、regressions、promotion decision。

## 新增事件

- `mcp.connection.started/ready/degraded/reconnecting/failed`
- `hook.run.started/completed/failed/denied`
- `subagent.worktree.created/proposed/merged/blocked`
- `automation.created/queued/started/waiting_review/completed/failed/cancelled`
- `review_queue.item.created/resolved`
- `remote_worker.provisioned/heartbeat/failed/disposed`
- `context.registry.built`
- `model_eval.started/completed/regressed`

## Replay 要求

- 所有新增事件必须能从 JSONL replay 恢复 UI 状态。
- 大输出、日志、远程 worker bootstrap、MCP server output、eval trace 必须走 ArtifactRef。
- secret 明文不能进入 event、trace、artifact metadata 或 renderer state。
