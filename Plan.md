# Monaco-based AI Code Editor — 完整设计方案

## 技术选型

| 层 | 选择 | 理由 |
|---|---|---|
| **桌面壳** | Electron 34+ | 跨平台，成熟生态 |
| **编辑器核心** | `monaco-editor` v0.55+ | VS Code 同款编辑器，独立 npm 包 |
| **UI 框架** | React 19 + Tailwind CSS | Chat 面板、侧边栏、对话框等 UI |
| **语言** | TypeScript (strict) | 全栈 TypeScript |
| **语言服务** | `vscode-languageserver-protocol` + 各语言 LSP Server | 补全、跳转定义、诊断 |
| **构建** | Vite (renderer) + esbuild (main/preload) | 快 |
| **包管理** | pnpm | monorepo 友好 |
| **状态管理** | zustand | 轻量，适合此规模 |
| **AI SDK** | `@anthropic-ai/sdk` / OpenAI SDK | 不锁定单一 LLM 供应商 |

### 为什么不用 `monaco-vscode-api` 或 `@codingame/monaco-vscode-api`

`monaco-vscode-api` 试图模拟 VS Code 的完整扩展 API，让你直接运行 VS Code 扩展。但这引入了你不想要的复杂度：
- 你需要兼容 VS Code 生态（这正是你要避免的）
- 增加了约 500KB+ 的垫片代码
- 版本对齐问题（每次 Monaco 升级都需要等适配）

**结论：直接用 `monaco-editor` 原生的 `monaco.languages.*` API。**

---

## 项目结构

```
ai-code-editor/
├── package.json                          # monorepo root (pnpm workspace)
├── electron-builder.yml                  # 打包配置
│
├── packages/
│   │
│   ├── app/                              # Electron 主进程 + preload
│   │   ├── src/
│   │   │   ├── main/
│   │   │   │   ├── index.ts              # app.whenReady(), 创建窗口
│   │   │   │   ├── window.ts             # BrowserWindow 管理
│   │   │   │   ├── ipc.ts                # IPC handler 注册
│   │   │   │   ├── menu.ts               # 原生菜单
│   │   │   │   ├── fileSystem.ts         # 文件对话框、最近文件
│   │   │   │   └── updater.ts            # 自动更新
│   │   │   ├── preload/
│   │   │   │   └── index.ts              # contextBridge 暴露 API
│   │   │   └── shared/
│   │   │       └── channels.ts           # IPC channel 名称常量
│   │   └── electron-builder.yml
│   │
│   ├── editor/                           # Monaco 集成 + 编辑器 UI
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── Editor.tsx            # Monaco 容器组件
│   │   │   │   ├── EditorTabs.tsx        # 标签页
│   │   │   │   ├── FileTree.tsx          # 文件树
│   │   │   │   ├── StatusBar.tsx         # 状态栏
│   │   │   │   └── WelcomePage.tsx       # 欢迎页
│   │   │   ├── hooks/
│   │   │   │   ├── useMonaco.ts          # Monaco 实例管理
│   │   │   │   ├── useEditorStore.ts     # 编辑器状态 (zustand)
│   │   │   │   └── useLSP.ts             # LSP 生命周期
│   │   │   ├── services/
│   │   │   │   ├── lspManager.ts         # LSP 多语言管理
│   │   │   │   ├── languageConfig.ts     # 语言注册配置
│   │   │   │   ├── fileService.ts        # 文件读写（通过 IPC）
│   │   │   │   └── monacoSetup.ts        # Monaco worker/grammar 初始化
│   │   │   └── index.ts                  # 导出 EditorApp 组件
│   │   └── package.json
│   │
│   ├── ai/                               # AI 功能核心
│   │   ├── src/
│   │   │   ├── inlineCompletion/         # Inline 补全 (Cursor Tab)
│   │   │   │   ├── provider.ts           # InlineCompletionsProvider 实现
│   │   │   │   ├── context.ts            # 上下文构建（前后文代码）
│   │   │   │   ├── debounce.ts           # 防抖 & 智能触发
│   │   │   │   └── postProcess.ts        # 后处理（去重、截断、闭合括号）
│   │   │   │
│   │   │   ├── chat/                     # Chat 对话
│   │   │   │   ├── ChatPanel.tsx         # Chat 面板 UI
│   │   │   │   ├── MessageBubble.tsx     # 消息气泡 (markdown 渲染)
│   │   │   │   ├── CodeBlockActions.tsx  # 代码块操作 (Apply/Copy)
│   │   │   │   ├── chatStore.ts          # 对话状态 (zustand)
│   │   │   │   └── chatService.ts        # LLM 流式调用 + 解析
│   │   │   │
│   │   │   ├── agent/                    # Agent 自主循环
│   │   │   │   ├── agentLoop.ts          # Agent 主循环
│   │   │   │   ├── tools/                # Tool 实现
│   │   │   │   │   ├── index.ts          # Tool 注册表
│   │   │   │   │   ├── readFile.ts
│   │   │   │   │   ├── writeFile.ts
│   │   │   │   │   ├── searchCode.ts
│   │   │   │   │   ├── listFiles.ts
│   │   │   │   │   ├── executeCommand.ts
│   │   │   │   │   └── readLints.ts
│   │   │   │   ├── permission.ts         # 权限管理
│   │   │   │   └── sessionHistory.ts     # 会话历史持久化
│   │   │   │
│   │   │   ├── llm/                      # LLM 后端抽象
│   │   │   │   ├── provider.ts           # LLMProvider 接口
│   │   │   │   ├── anthropic.ts          # Claude 适配
│   │   │   │   ├── openai.ts             # OpenAI/兼容适配
│   │   │   │   └── local.ts              # 本地模型 (ollama)
│   │   │   │
│   │   │   ├── context/                  # AI 上下文构建
│   │   │   │   ├── fileContext.ts        # 打开文件、相关文件
│   │   │   │   ├── projectContext.ts     # 项目结构、git 状态
│   │   │   │   └── rules.ts              # .airules 规则文件解析
│   │   │   │
│   │   │   └── diff/                     # Diff 预览 & Apply
│   │   │       ├── DiffPreview.tsx        # Monaco DiffEditor 包装
│   │   │       ├── diffApply.ts          # 应用编辑到文件
│   │   │       └── editParser.ts         # 从 LLM 输出解析编辑
│   │   │
│   │   └── package.json
│   │
│   └── shared/                           # 共享类型 & 工具
│       ├── src/
│       │   ├── types.ts                  # 全局类型定义
│       │   ├── constants.ts
│       │   └── utils.ts
│       └── package.json
│
├── resources/                            # 图标、字体
├── scripts/                              # 构建脚本
├── tsconfig.json
└── vite.config.ts                        # renderer 构建
```

---

## 核心架构

```
┌──────────────────────────────────────────────────────────────┐
│                     Electron Main Process                    │
│  ┌─────────┐  ┌──────────┐  ┌────────────┐                  │
│  │ 窗口管理  │  │ IPC 路由  │  │ 原生菜单    │                  │
│  └─────────┘  └──────────┘  └────────────┘                  │
│                                                               │
│  ┌──────────────────────────────────────┐                    │
│  │ File System IPC                      │                    │
│  │ (读/写/监听/对话框)                    │                    │
│  └──────────────────────────────────────┘                    │
└─────────────────────┬────────────────────────────────────────┘
                      │ IPC (contextBridge)
┌─────────────────────┴────────────────────────────────────────┐
│                   Electron Renderer Process                   │
│                                                               │
│  ┌───────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  Editor Shell │  │  AI Chat      │  │  File Tree       │  │
│  │  (标签页/状态栏)│  │  Panel (React)│  │  Sidebar (React) │  │
│  └───────┬───────┘  └──────┬───────┘  └──────────────────┘  │
│          │                 │                                   │
│          ▼                 ▼                                   │
│  ┌──────────────────────────────────────────────────────┐    │
│  │              Monaco Editor                           │    │
│  │  ┌─────────────┐ ┌─────────────┐ ┌───────────────┐  │    │
│  │  │ Inline      │ │ Suggest     │ │ Diff Editor   │  │    │
│  │  │ Completions │ │ Widget      │ │               │  │    │
│  │  │ (幽灵文本)   │ │ (下拉补全)   │ │               │  │    │
│  │  └─────────────┘ └─────────────┘ └───────────────┘  │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐    │
│  │              AI Module (packages/ai)                  │    │
│  │  ┌──────────┐ ┌───────────┐ ┌────────────────────┐  │    │
│  │  │ Inline   │ │ Chat      │ │ Agent Loop         │  │    │
│  │  │ Provider │ │ Service   │ │ (Tool → LLM →Tool) │  │    │
│  │  └──────────┘ └───────────┘ └────────────────────┘  │    │
│  │  ┌──────────────────────────────────────────────┐   │    │
│  │  │ LLM Abstraction                              │   │    │
│  │  │ (Anthropic / OpenAI / Ollama)                │   │    │
│  │  └──────────────────────────────────────────────┘   │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐    │
│  │              LSP Manager                              │    │
│  │  ┌──────┐ ┌──────┐ ┌──────┐ ┌───────┐ ┌─────────┐  │    │
│  │  │TS    │ │Python│ │Rust  │ │Go    │ │JSON/CSS │  │    │
│  │  │Server│ │Server│ │Server│ │Server│ │Built-in │  │    │
│  │  └──────┘ └──────┘ └──────┘ └───────┘ └─────────┘  │    │
│  └──────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

### 数据流关系

```
用户输入
  │
  ├─→ Monaco Editor (编辑)
  │     │
  │     ├─→ InlineCompletionProvider ──→ LLM API ──→ 幽灵文本渲染
  │     │
  │     └─→ CompletionProvider ──→ LSP Server ──→ 下拉补全
  │
  ├─→ Chat 面板输入 ──→ chatService.ts ──→ LLM API (流式)
  │     │                                      │
  │     │  ChatPanel 实时显示 markdown          │
  │     │                                      │
  │     └─→ 代码块 "Apply" 按钮
  │           │
  │           ├─→ editParser.ts (解析 LLM 输出)
  │           ├─→ DiffPreview.tsx (Monaco DiffEditor 预览)
  │           └─→ diffApply.ts (写入文件)
  │
  └─→ Agent 模式
        │
        └─→ agentLoop.ts
              │
              └─→ while (未完成) {
                    ├─→ 构建上下文 (打开文件 + 项目结构 + 对话历史)
                    ├─→ 调用 LLM (with tool definitions)
                    ├─→ 解析响应 (文本 或 tool_call)
                    ├─→ 如果是 tool_call:
                    │     ├─→ 权限检查 (permission.ts)
                    │     ├─→ 执行 tool
                    │     └─→ 追加结果到对话
                    └─→ 如果是文本: 渲染并等待用户确认
                  }
```

---

## 关键模块设计

### 1. Inline 补全 (Cursor Tab 等价物)

Monaco 已经提供了完整的渲染管线。你只需要实现 `InlineCompletionsProvider`：

```typescript
// packages/ai/src/inlineCompletion/provider.ts

import type { languages, editor, Position, CancellationToken } from 'monaco-editor';

export function createAIInlineProvider(llm: LLMProvider): languages.InlineCompletionsProvider {
  return {
    provideInlineCompletions: async (
      model: editor.ITextModel,
      position: Position,
      context: languages.InlineCompletionContext,
      token: CancellationToken
    ) => {
      // 1. 构建上下文
      const prefix = model.getValueInRange({
        startLineNumber: Math.max(1, position.lineNumber - 100),
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });
      const suffix = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: position.column,
        endLineNumber: Math.min(model.getLineCount(), position.lineNumber + 50),
        endColumn: model.getLineMaxColumn(Math.min(model.getLineCount(), position.lineNumber + 50)),
      });

      // 2. 调用 LLM (Fill-in-the-Middle)
      const completion = await llm.complete({
        prefix,
        suffix,
        language: model.getLanguageId(),
        filePath: model.uri.path,
      });

      if (!completion || token.isCancellationRequested) return { items: [] };

      // 3. 计算 range
      const wordUntil = model.getWordUntilPosition(position);

      return {
        items: [{
          insertText: completion,
          range: new monaco.Range(
            position.lineNumber, wordUntil.startColumn,
            position.lineNumber, wordUntil.endColumn
          ),
        }],
        enableForwardStability: true,  // 用户继续打字时不消失
      };
    },

    // 清理回调
    freeInlineCompletions: () => {},
    disposeInlineCompletions: () => {},     // 兼容新旧 Monaco
    handleItemDidShow: () => {},            // 可用于遥测
  };
}
```

**注册方式**：
```typescript
// packages/editor/src/services/monacoSetup.ts
const disposables: IDisposable[] = [];

// 为每种语言注册
for (const lang of ['typescript', 'javascript', 'python', 'go', 'rust', 'java', 'cpp', 'csharp']) {
  const d = monaco.languages.registerInlineCompletionsProvider(
    lang,
    createAIInlineProvider(llmProvider)
  );
  disposables.push(d);
}
```

Monaco 内的编辑器设置：
```typescript
monaco.editor.create(container, {
  inlineSuggest: {
    enabled: true,
    mode: 'subwordSmart',     // 推荐: 子词+智能匹配
    showToolbar: 'onHover',   // 悬停显示工具栏 (Accept/Reject)
    keepOnBlur: false,
    suppressSuggestions: false,
  },
  // 快速建议也开启（传统补全下拉）
  quickSuggestions: true,
  suggest: {
    preview: true,           // 预览模式, 类似 inline
  },
});
```

**关键参数说明**：
- `mode: 'subwordSmart'` — 在 . / camelCase / snake_case 边界都会触发
- `enableForwardStability: true` — 如果用户打的字符恰好匹配建议的下一个字符，建议不会消失
- `suppressSuggestions: false` — 不压制下拉补全，inline 和 dropdown 可以共存

---

### 2. Chat 面板

核心组件设计：

```typescript
// packages/ai/src/chat/ChatPanel.tsx — 结构示意

<ChatPanel>
  <MessageList>
    {messages.map(msg => (
      <MessageBubble role={msg.role}>
        {msg.role === 'assistant' ? (
          <>
            <MarkdownRenderer content={msg.content} />
            {msg.codeBlocks.map(block => (
              <CodeBlockActions          // Apply | Copy | Insert at cursor
                code={block.code}
                language={block.language}
                onApply={() => applyDiff(block)}
                onInsert={() => insertAtCursor(block.code)}
              />
            ))}
          </>
        ) : (
          <UserMessage content={msg.content} />
        )}
      </MessageBubble>
    ))}
  </MessageList>
  <ChatInput
    onSend={handleSend}
    onAttachFile={handleAttachFile}
    placeholder="Ask AI to edit code... (Cmd+L)"
  />
</ChatPanel>
```

消息类型设计：
```typescript
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  codeBlocks: CodeBlock[];
  toolCalls?: ToolCallResult[];    // 仅 Agent 模式
  timestamp: number;
}

interface CodeBlock {
  code: string;
  language: string;
  filePath?: string;               // LLM 指定的目标文件
}
```

---

### 3. Agent 循环

这是 Cursor 的 Agent mode 等价物。核心循环：

```typescript
// packages/ai/src/agent/agentLoop.ts

async function runAgentLoop(
  userRequest: string,
  llm: LLMProvider,
  tools: Tool[],
  context: AgentContext,
  callbacks: AgentCallbacks
): Promise<AgentResult> {
  const messages: LLMMessage[] = [
    { role: 'system', content: buildSystemPrompt(tools, context.rules) },
    { role: 'user', content: buildUserPrompt(userRequest, context) },
  ];

  let turnCount = 0;
  const MAX_TURNS = 50;

  while (turnCount < MAX_TURNS) {
    turnCount++;
    callbacks.onThinking(turnCount);

    const response = await llm.chat({
      messages,
      tools: tools.map(t => t.definition),
      tool_choice: 'auto',
    });

    const choice = response.choices[0];

    if (choice.finish_reason === 'stop') {
      // Agent 完成
      callbacks.onComplete(choice.message.content);
      return { success: true, content: choice.message.content };
    }

    if (choice.message.tool_calls) {
      for (const toolCall of choice.message.tool_calls) {
        // 权限检查
        const approval = await callbacks.onToolRequest(toolCall);
        if (!approval) {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: 'User denied permission',
          });
          continue;
        }

        // 执行工具
        const result = await executeTool(toolCall, context.workspaceRoot);
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
        callbacks.onToolResult(toolCall, result);
      }
    }

    // 把助手消息加到历史
    messages.push(choice.message);
  }

  return { success: false, error: 'Max turns exceeded' };
}
```

**Tool 系统设计**：
```typescript
interface Tool {
  definition: ToolDefinition;      // OpenAI function 格式
  execute: (params: any, workspaceRoot: string) => Promise<ToolResult>;
  requiresApproval: boolean;       // 是否需要用户确认
  approvalMessage: (params: any) => string;  // 确认提示
}

const tools: Tool[] = [
  readFileTool,          // requiresApproval: false
  writeFileTool,         // requiresApproval: true
  searchCodeTool,        // requiresApproval: false (grep)
  listFilesTool,         // requiresApproval: false
  executeCommandTool,    // requiresApproval: true
  readLintsTool,         // requiresApproval: false
];
```

**权限 UI**：
```
┌──────────────────────────────────┐
│ 🔧 Tool: write_file              │
│                                  │
│ File: src/utils/helper.ts        │
│                                  │
│ ┌ Diff Preview ────────────────┐ │
│ │ - old code                   │ │
│ │ + new code                   │ │
│ └──────────────────────────────┘ │
│                                  │
│ [✓ Accept]  [✗ Reject]          │
│ [✓ Accept all]  [Always trust]  │
└──────────────────────────────────┘
```

---

### 4. Diff / Apply

Monaco **本身就内置了 DiffEditor**。你不需要任何额外库：

```typescript
// packages/ai/src/diff/DiffPreview.tsx

function showDiffPreview(original: string, modified: string, filePath: string) {
  // Monaco DiffEditor 直接可用
  const diffEditor = monaco.editor.createDiffEditor(container, {
    readOnly: true,
    renderSideBySide: true,       // 并排显示, 类似 Cursor
    originalEditable: false,
  });

  const originalModel = monaco.editor.createModel(original, 'typescript');
  const modifiedModel = monaco.editor.createModel(modified, 'typescript');

  diffEditor.setModel({
    original: originalModel,
    modified: modifiedModel,
  });
}
```

---

### 5. LSP 集成

每个语言启动一个 LSP 子进程，通过 stdin/stdout 通信：

```typescript
// packages/editor/src/services/lspManager.ts

interface LSPConfig {
  id: string;
  languages: string[];
  command: string;
  args: string[];
  initializationOptions?: any;
}

const LSP_CONFIGS: LSPConfig[] = [
  {
    id: 'typescript',
    languages: ['typescript', 'javascript', 'tsx', 'jsx'],
    command: 'typescript-language-server',
    args: ['--stdio'],
  },
  {
    id: 'python',
    languages: ['python'],
    command: 'pyright-langserver',
    args: ['--stdio'],
  },
  {
    id: 'rust',
    languages: ['rust'],
    command: 'rust-analyzer',
    args: [],
  },
  {
    id: 'go',
    languages: ['go'],
    command: 'gopls',
    args: [],
  },
];

// 注册到 Monaco
// 使用 monaco-languages API bridge LSP → Monaco registration
// 每个 LSP 启动为子进程，通过 vscode-languageserver-protocol 类型通信
```

各语言的 **语法高亮**（tokenization）在 Monaco 中已经内置（Monarch tokenizer 或 TextMate grammars），不需要 LSP。只有补全、跳转、诊断等才走 LSP。

对于 **HTML/CSS/JSON/Markdown** —— Monaco 内置了语言服务器（vscode-html-languageservice、vscode-css-languageservice 等），不需要额外进程。

---

### 6. LLM 后端抽象

```typescript
// packages/ai/src/llm/provider.ts

interface LLMProvider {
  /** Inline 补全 (Fill-in-the-Middle) */
  complete(params: CompleteParams): Promise<string | null>;

  /** Chat 对话 */
  chat(params: ChatParams): Promise<LLMResponse>;

  /** Chat 流式 (用于 Chat 面板实时显示) */
  chatStream(params: ChatParams): AsyncIterable<LLMStreamChunk>;
}

interface CompleteParams {
  prefix: string;
  suffix: string;
  language: string;
  filePath: string;
}

interface ChatParams {
  messages: LLMMessage[];
  tools?: ToolDefinition[];
  tool_choice?: 'auto' | 'none' | 'required';
  model?: string;
  maxTokens?: number;
}

// 实现: Anthropic, OpenAI, Ollama...
```

---

### 7. 上下文构建

```typescript
// packages/ai/src/context/fileContext.ts

function buildContext(editorState: EditorState, projectRoot: string): AgentContext {
  return {
    // 当前打开文件 (最多 5 个)
    openFiles: editorState.openFiles.slice(0, 5).map(f => ({
      path: f.path,
      content: f.content,              // 截断到 200 行
      language: f.language,
    })),

    // 当前光标位置
    cursor: {
      file: editorState.activeFile.path,
      line: editorState.cursorPosition.line,
      column: editorState.cursorPosition.column,
    },

    // 选中文本
    selection: editorState.selection,

    // 项目结构 (文件树摘要)
    projectStructure: getProjectTreeSummary(projectRoot, { maxDepth: 3 }),

    // Git 状态
    gitStatus: getGitDiff(projectRoot),    // `git diff --stat`

    // 规则文件
    rules: loadRulesFile(projectRoot),     // 读取 .airules 或 .cursorrules
  };
}
```

---

## 实施路线图

### Phase 1: 可用的编辑器 (2 周)

目标：一个能打开文件、编辑代码、有基本 UI 的编辑器。

- [ ] Electron 壳 + React renderer 搭建
- [ ] Monaco Editor 集成（`packages/editor`）
- [ ] 文件树 + 标签页
- [ ] 文件读写 IPC
- [ ] 基本语法高亮（Monaco 内置 grammars）
- [ ] 主题（dark/light）

### Phase 2: Inline 补全 (1.5 周)

目标：Cursor Tab 体验。

- [ ] LLM 后端抽象 + 至少一个实现 (Anthropic Claude)
- [ ] `InlineCompletionsProvider` 实现
- [ ] 上下文构建（prefix/suffix 截取）
- [ ] 防抖 & 智能触发策略
- [ ] 状态栏指示器（loading / ready）

### Phase 3: Chat + Diff Apply (2 周)

目标：在聊天中生成代码并预览/应用编辑。

- [ ] Chat 面板 UI（React）
- [ ] 流式 markdown 渲染
- [ ] LLM chat 调用（带系统提示词）
- [ ] 代码块 "Apply" 按钮
- [ ] Monaco DiffEditor 预览
- [ ] 编辑应用 + undo 支持

### Phase 4: Agent 模式 (2 周)

目标：自主多步骤编辑。

- [ ] Agent 主循环
- [ ] Tool 系统（read/write/search/list/command）
- [ ] 权限 UI
- [ ] 会话历史 + 持久化
- [ ] Agent 进度显示

### Phase 5: LSP 语言服务 (1.5 周)

目标：真正的代码补全、跳转定义、诊断。

- [ ] LSP 进程管理器
- [ ] TypeScript/JavaScript 语言服务器
- [ ] Python, Rust, Go 语言服务器
- [ ] Monaco CompletionProvider 桥接 LSP
- [ ] 诊断显示（波浪线）

### Phase 6: 打磨 (2 周+)

- [ ] `.airules` 规则文件支持
- [ ] @-file 引用
- [ ] Cmd+K 内联编辑
- [ ] 多模型切换
- [ ] 键盘快捷键
- [ ] 打包分发 (electron-builder)

---

## 验证方案

每个 Phase 完成后：

1. **Phase 1**: `pnpm dev` 启动，能打开目录、创建/编辑/保存文件
2. **Phase 2**: 输入代码时看到 AI 幽灵文本补全，Tab 接受，Esc 拒绝
3. **Phase 3**: Cmd+L 打开 Chat，输入 "写一个排序函数"，看到流式输出，点击 Apply 将代码写入编辑器
4. **Phase 4**: 输入 "重构 src/utils.ts 中的 helper 函数"，Agent 自动读文件、改写、写回，每步显示进度
5. **Phase 5**: 输入 `document.` 看到 LSP 提供的准确补全列表（不是 AI 的，是语言服务器解析后的）
6. **Phase 6**: 在项目中创建 `.airules` 文件，Agent 的响应遵循规则

---

## 关键技术要点

1. **Monaco 的 Inline Completes 是 pull-based，不是 push-based** — 你注册 `provideInlineCompletions`，Monaco 在用户停止输入后调用你，你返回结果。这天然支持防抖（Monaco 内部已经做了）。

2. **Fill-in-the-Middle (FIM) 是关键** — Inline 补全不是 chat，需要 FIM 模型（Claude、GPT-4、DeepSeek 都支持）。传递给 LLM 的是 `prefix`(光标前) + `suffix`(光标后)，LLM 返回中间应该插入的代码。

3. **Monaco DiffEditor 不需要额外实现** — `monaco.editor.createDiffEditor()` 已经是完整的并排 diff 视图，和 VS Code 的 diff 一模一样。

4. **LSP 客户端需要自己实现** — Monaco 不内置 LSP 客户端。使用 `vscode-languageserver-protocol` 类型，通过子进程 stdin/stdout 与语言服务器通信，然后把结果注册到 Monaco 的 `CompletionItemProvider`、`HoverProvider`、`DefinitionProvider` 等。

5. **性能关键路径**：编辑器渲染（Monaco 已优化）、inline 补全延迟（< 500ms 用户才能感知为 "即时"）、LSP 进程启动（懒加载，首次打开某语言文件时才启动）。

6. **不依赖 VS Code 扩展生态就意味着**：
   - 不需要 `monaco-vscode-api` 垫片层
   - LSP 直接通过子进程管理，不走 VS Code 的 ExtensionHost
   - 所有 UI 都是自定义的，没有任何 legacy 约束