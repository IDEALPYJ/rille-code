# Step2 验收与测试策略

## 总原则

1. Step2 能力必须证明产品可用，不只证明协议存在。
2. Windows、remote MCP、plugin hook、writable subagent、automation、remote worker 都必须有失败路径测试。
3. 真实模型 eval 不替代 deterministic unit/eval，而是作为 release gate 的新增层。
4. 所有远程、hook、plugin、MCP、worker 输出必须 redacted，并通过 ArtifactRef 存储大输出。

## 文档验收

```bash
find plan -maxdepth 2 -type f | sort
rg -n "TO""DO|TB""D|待""补" plan/step1 plan/step2
rg -n "plan/0""[0-8]_|plan/0""4_|plan/0""5_|plan/0""6_|plan/0""7_|plan/0""8_" plan
```

预期：

- 文件结构包含根索引、step1 九个文档、step2 九个文档。
- 无无意占位。
- 不出现指向根目录旧 plan 文档的引用。

## 基础验收

文档-only 改动：

```bash
find plan -maxdepth 2 -type f | sort
rg -n "TO""DO|TB""D|待""补" plan/step1 plan/step2
```

涉及协议/runtime/UI：

```bash
npm test
npm run typecheck
npm run build
npm run eval:agent
npm run governance:agent
```

## Phase 测试策略

| Phase | 测试重点 |
| --- | --- |
| R | HTTP/SSE MCP fixture、auth redaction、heartbeat、reconnect、Plan Mode sideEffect deny。 |
| S | Windows path/shell/PTY/Git/npm wrapper、sandbox filesystem/network policy、Windows CI。 |
| T | hook manifest parsing、sandbox timeout、env allowlist、redacted payload、plugin trust。 |
| U | writable subagent isolation、worktree diff proposal、real model failure visibility、merge conflict。 |
| V | scheduler lifecycle、pause/resume/cancel、review queue replay、automation evidence gate。 |
| W | remote worker bootstrap、heartbeat、artifact logs、branch handoff、failure recovery。 |
| X | rules registry、glob activation、conflict explain、context source disable、trace replay。 |
| Y | command center reducer、queue UX state、subagent drilldown、remote logs、MCP diagnostics。 |
| Z | real model eval, A/B regression, enterprise policy, audit export, plugin signature trust。 |

## 手工验收场景

- Windows 上打开项目、运行命令、启动终端、执行 agent verification。
- 连接远程 MCP server，断网后重连并保留诊断。
- 安装一个带 hook 的本地 plugin，触发 hook 并查看 trace。
- 启动 writable subagent，产生 proposal，经主 agent review/verify 后合并。
- 创建 automation，进入 waiting_review，在 review queue 里处理 diff。
- 启动远程 worker，查看 bootstrap log、heartbeat、result handoff。

## Release Gate

- 所有 Step1 gate 继续通过。
- Phase R-Z 对应新增 tests/eval 通过。
- Windows compatibility matrix 无 release blocker。
- 真实模型 eval 无高危 regression。
- Secret redaction 检查覆盖 MCP、hook、remote worker、eval artifact。
