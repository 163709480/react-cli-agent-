# 终端 Agent 设计稿

**日期**: 2026-06-04
**形态**: ReAct / 工具调用型终端 agent(类似 Claude Code)
**栈**: TypeScript + Ink + 手写 ReAct 循环 + OpenAI 兼容 SDK

---

## 1. 目标与定位

构建一个**本地运行**的终端 agent:

- 用户在 REPL 里用自然语言描述目标
- agent 拆解步骤、自动调用工具(读/写文件、搜索、抓网页)
- 多步循环直到任务完成或用户中断
- 通过 OpenAI 兼容协议接入 LLM(DeepSeek / Moonshot / Groq / 本地 Ollama / 任意 OpenAI 兼容服务)

**非目标**(本次不实现):

- 不做跨 session 持久化(后续可加)
- 不暴露 shell 执行工具(避免任意命令注入)
- 不做 agent 框架(LangChain / Vercel AI SDK)依赖
- 不接 Anthropic SDK(只走 OpenAI 兼容协议)

---

## 2. 形态与交互

- **REPL 多轮对话**:启动后进入交互循环,支持多轮追问
- **streaming + 工具 trace 可视化**:用 Ink 渲染 token 流、工具调用、确认提示
- **可单次 headless 调用**:`agent "fix the bug"` 一次起止,适合 CI/脚本
- **可中断恢复**:Ctrl+C 不丢上下文,下一句"继续"接上

---

## 3. 工具集

| 工具 | safety | 说明 |
|---|---|---|
| `read_file` | safe | 读文件,可指定 offset/limit,>1MB 截断 |
| `write_file` | confirm | 写新文件,写入前 diff 预览 + 确认;沙箱后缀白名单 |
| `edit_file` | confirm | 字符串替换,要求 `old_string` 唯一;沙箱后缀白名单 |
| `grep` | safe | ripgrep 包装,限 cwd |
| `glob` | safe | fast-glob,限 cwd |
| `http_fetch` | dangerous | 每次都需确认,默认只 GET,POST 需 `--allow-mutations` |

**默认写白名单后缀**:`.md .ts .tsx .js .jsx .json .yaml .yml .toml .txt`

可在 `~/.agent/config.json` 修改,格式:

```json
{
  "writeableExts": [".md", ".ts", ".txt"],
  "yolo": false,
  "maxContextTokens": 120000
}
```

CLI flag 优先级 > 配置文件 > 内置默认。

---

## 4. 安全模型

### 4.1 三级 safety

- `safe`:静默执行(read/grep/glob)
- `confirm`:UI 渲染 diff/参数,等 `y`/`n`/`a`(本次会话后续全部同意)
- `dangerous`:UI 渲染请求,只能 `y`/`n`,无 "全部同意" 选项

### 4.2 沙箱

- 路径解析:所有工具的 `path` 参数必须 `resolveWithinCwd(p, cwd)`,越界抛 `SandboxError`
- 写后缀白名单:`write_file` / `edit_file` 命中白名单才允许
- 全局 flag `--yolo`:把 confirm/dangerous 降级为 safe(脚本场景,**默认 false**)

### 4.3 错误回灌

工具执行失败、沙箱违反、用户拒绝、schema 校验失败 —— **都把错误以 `role:"tool"` 回灌 LLM**,让它自己决定重试/换方案/放弃。仅 LLM 网络错误做指数退避重试 3 次(0.5s / 2s / 8s)。

---

## 5. 上下文管理

- **滑动窗口 + 摘要压缩**
- 触发条件:估算 token 数 > `maxContextTokens × 0.7`(默认 120000 × 0.7 = 84000)
- 策略:保留 system + 最近 6 条原始消息,中间折成一条 `[Summary]` 消息
- 摘要生成:再调一次 LLM,固定 prompt "压缩成 200 字内中文摘要"
- token 估算用 `gpt-tokenizer`(`cl100k_base`)

---

## 6. 架构

### 6.1 目录结构

```
src/
├── cli.tsx                # 入口,启动 Ink
├── app.tsx                # <App/> 根组件
├── components/
│   ├── MessageList.tsx
│   ├── ToolTrace.tsx
│   └── InputBox.tsx
├── agent/
│   ├── loop.ts            # 核心 ReAct 循环(纯异步,不依赖 Ink)
│   ├── context.ts         # 滑动窗口 + 压缩
│   ├── tools.ts           # 工具注册中心
│   ├── schema.ts          # zod → JSON Schema
│   └── types.ts           # Message / ToolCall / RunState
├── tools/
│   ├── read_file.ts
│   ├── write_file.ts
│   ├── edit_file.ts
│   ├── grep.ts
│   ├── glob.ts
│   └── http_fetch.ts
├── safety/
│   ├── sandbox.ts         # resolveWithinCwd + 写后缀断言
│   └── confirm.ts
├── llm/
│   ├── client.ts          # OpenAI 客户端工厂
│   └── stream.ts          # 把 stream 包成 AsyncIterable<StreamEvent>
└── config.ts              # 读 env
```

### 6.2 核心接口

```typescript
// 工具契约
interface ToolDef<I, O> {
  name: string;
  description: string;
  safety: 'safe' | 'confirm' | 'dangerous';
  schema: ZodType<I>;
  execute(input: I, ctx: ToolCtx): Promise<O>;
}

interface ToolCtx {
  cwd: string;
  abort: AbortSignal;
  confirmedByUser: boolean;
}

// loop 对外接口(纯异步,无 Ink 依赖)
interface RunTurnInput {
  messages: Message[];
  tools: ToolDef[];
  onEvent: (e: AgentEvent) => void;
  signal: AbortSignal;
}

interface RunTurnResult {
  messages: Message[];   // 本轮新增
  finishReason: 'stop' | 'length' | 'abort' | 'error';
}
```

### 6.3 数据流

```
用户输入
  → Message{role:user}
  → openai.chat.completions.create({stream:true, tools})
  → AgentEvent 流(text_delta / tool_call_start / ...)
  → UI 渲染(text 流式 / ToolTrace 等待确认)
  → 工具执行 → Message{role:tool}
  → 循环,直到不再产生 tool_call
```

---

## 7. 错误处理

| 类别 | 处理 |
|---|---|
| LLM 网络/超时 | 指数退避 3 次(0.5/2/8s)→ 失败回灌 LLM |
| LLM 配额/认证 | 不重试,UI 提示,退到输入态 |
| 工具 schema 校验失败 | 错误回灌 LLM |
| 工具执行抛错 | 截断 500 字,回灌 LLM |
| 沙箱违反 | 不重试,回灌 LLM |
| 用户拒绝确认 | 回灌 LLM "用户拒绝" |
| 上下文超限 | 自动滑动窗口压缩(见 §5) |
| Ctrl+C | abort 当前 run,保留已生成内容,下一轮 "继续" 接上 |

---

## 8. 测试

- **单元(20~30)**:sandbox 边界、schema 转换、stream 拼接、压缩、五个工具各 happy/error path
- **集成(5~8)**:vi.mock 替换 openai SDK 注入假 SSE,验证 loop 行为
- **E2E(1~2,后续)**:录制真实 LLM 回复做回放
- **不做**:mock Ink 测 UI、不测 LLM 质量、不接 CI 跑真实 LLM

---

## 9. 配置

通过环境变量(`.env` 也可):

```
OPENAI_API_KEY=...
OPENAI_BASE_URL=https://api.deepseek.com/v1   # 默认
OPENAI_MODEL=deepseek-chat                    # 默认
AGENT_CWD=/path/to/project                    # 默认 process.cwd()
AGENT_MAX_CONTEXT_TOKENS=120000               # 默认
```

CLI flag:

```
agent                       # 进入 REPL
agent "fix the bug"         # 单次 headless
agent --yolo                # 跳过所有确认
agent --allow-mutations     # 允许 http_fetch POST
agent --debug               # 把请求/响应写到 ~/.agent-debug/
agent --resume <runId>      # 继续上次中断的会话(后续)
```

---

## 10. 依赖

**运行依赖**:

- `openai`(OpenAI 兼容协议 SDK)
- `ink` + `@inkjs/ui`(TUI)
- `ink-text-input` / `ink-select-input`(输入与确认)
- `zod`(工具 schema)
- `gpt-tokenizer`(token 估算)
- `fast-glob`(glob 工具)
- `chalk`(颜色,避免自己写 ANSI)
- `uuid`(runId)

**开发依赖**:

- `typescript`、`tsx`
- `vitest`
- `@types/node`

---

## 11. 实现里程碑(概要)

1. **脚手架 + LLM 客户端 + REPL 最小骨架**(能对话,无工具)
2. **read_file / grep / glob 三个 safe 工具**
3. **write_file / edit_file + 沙箱 + 确认 UI**
4. **http_fetch + dangerous 级别**
5. **滑动窗口 + 压缩**
6. **--yolo / --allow-mutations flag**
7. **--debug 日志**
8. **单测 + 集成测试**

(详细 plan 由 writing-plans 技能产出)
