# Model Gateway 模块设计

## 目标

Model Gateway 把不同模型 provider 封装成统一的 Brain Runtime，让上层只面对 provider-neutral 的输入、输出和模型能力。

它解决：

- provider API 格式泄漏到 Orchestrator。
- JSON 文本工具协议脆弱。
- 原生 tool calling、streaming、usage、fallback 难以统一。
- 模型输出被误当成系统事实。

它不解决：

- 不决定任务是否完成。
- 不执行工具。
- 不判断权限。
- 不选择最终上下文内容。

## 当前基线

当前实现：

- `AgentChatMessage` 只有 system/user/assistant 和 string content。
- `callAgentModel` 根据 protocol 调用 OpenAI-compatible、Anthropic 或 Gemini。
- `TextJsonToolAdapter` 构造 system prompt 和用户消息。
- `parseTextJsonModelAction` 从模型文本中解析 answer 或 tool_calls。
- `getModelVisibleToolDefinitions` 提供稳定排序的工具定义。

当前缺口：

- 没有 provider-native tool call adapter。
- 没有 streaming。
- 没有 usage / latency / cache metadata。
- 没有 role-based model routing。
- 没有能力兼容检查和 fallback reason。

## 设计原则

1. 上层依赖模型能力，不依赖 provider 格式。
2. 原始模型输出不能直接驱动工具。
3. Tool schema 尽量稳定，服务 prompt caching。
4. Fallback 必须检查能力兼容。
5. 用户可见文本、ModelDecision、debug trace 分离。

## 核心数据结构

```ts
export interface ModelInput {
  purpose: 'planning' | 'exploration' | 'coding' | 'repair' | 'verification' | 'review' | 'summary'
  session: AgentSession
  taskContract?: TaskContract
  contextFragments: ContextFragment[]
  messages: AgentChatMessage[]
  tools: AgentToolDefinition[]
  outputMode: 'decision' | 'text' | 'summary'
}

export interface ModelGatewayAdapter {
  supports(config: AgentConfigSnapshot): boolean
  buildRequest(input: ModelInput, config: AgentConfigSnapshot): unknown
  call(request: unknown, signal: AbortSignal): Promise<ModelRawResult>
  parse(raw: ModelRawResult): ModelDecision
}

export interface ModelRawResult {
  text?: string
  toolCalls?: AgentToolCall[]
  finishReason?: string
  usage?: AgentUsage
  providerPayload?: unknown
}
```

```ts
export interface ModelCallTrace {
  id: string
  purpose: ModelInput['purpose']
  providerId: AgentProviderId
  protocol: AgentProviderProtocol
  model: string
  adapter: string
  startedAt: number
  completedAt?: number
  status: 'ok' | 'error' | 'cancelled' | 'fallback'
  usage?: AgentUsage
  errorType?: string
}
```

## 运行流程

```text
Orchestrator requests model decision
  -> Context Engine returns fragments
  -> Model Gateway selects adapter
  -> adapter builds provider request
  -> provider call with timeout / abort
  -> adapter parses raw output
  -> output normalized to ModelDecision
  -> usage and latency emitted as trace
```

### Adapter 路线

第一阶段：

- 保留 TextJsonToolAdapter。
- 将 system prompt、tool schema、parse action 完全封装。
- 记录 parse failure trace。

第二阶段：

- OpenAI-compatible native tool calls。
- Anthropic `tool_use`。
- Gemini function calling。
- Streaming text and tool call deltas。

第三阶段：

- role-based routing。
- fallback matrix。
- cache metadata。
- advisor call。

## 与其他模块关系

- 输入来自 Context Engine。
- 被 Orchestrator 调用。
- 工具定义来自 Tool Runtime。
- Policy 可限制 provider 和模型可见上下文。
- Observability 记录 ModelCallTrace。
- Product UX 只展示用户可见摘要，不展示敏感 raw payload。

## 实现步骤

1. 新增 provider-neutral `ModelInput`。
2. 将 `callAgentModel` 包装成 Gateway 入口。
3. 把 TextJsonToolAdapter 改为 Adapter 实现。
4. 统一输出 `ModelDecision`。
5. 增加 usage / latency trace。
6. 为原生 tool calling 增加 adapter，但保留文本 JSON fallback。
7. 增加 fallback 能力检查。

## 测试与验收

单元测试：

- Text JSON answer / tool_calls / malformed JSON 解析。
- 工具定义顺序稳定。
- unsupported protocol 返回清晰错误。
- usage trace 正确落入事件。

集成测试：

- mock provider native tool call 被归一化为 ModelDecision。
- provider error 进入 model_error，不触发工具执行。
- abort signal 能取消模型调用。

手工验收：

- 使用 OpenAI-compatible、Anthropic、Gemini 配置都能执行只读工具。
- 模型返回非 JSON 时不会崩溃，能给出阻塞说明或重试。

## 反模式

- Orchestrator 直接处理 provider payload。
- Fallback 时不检查上下文长度和工具能力。
- 让模型文本伪造工具结果。
- 为不同 mode 动态增删工具 schema。
- 把隐藏推理直接展示给用户。
