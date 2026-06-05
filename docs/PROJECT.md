# Terminal Agent — 项目文档

一个本地运行的终端 ReAct agent,接入任意 OpenAI 兼容 LLM(DeepSeek / Moonshot / Ollama / vLLM 等)。

类似 Claude Code / Gemini CLI 的体验,但用 TypeScript + Ink 从零手写实现 —— 不依赖 LangChain / Vercel AI SDK 等 agent 框架,ReAct 循环、工具调用、流式渲染都是自己的代码。

---

## 1. 项目定位与目标

- **目标用户**:开发者,需要 AI 协助完成"读代码、找文件、改文件、跑搜索、抓网页"类任务,但又不愿把工作目录交给远端 SaaS。
- **核心定位**:本地终端、REPL 多轮、工具受控、路径沙箱。
- **不做的事**:不执行任意 shell(`bash` 工具被刻意剔除)、不持久化会话历史(单进程内存)、不做复杂 sub-agent 调度(单 agent 串行)、不做 IDE 插件。

---

## 2. 架构

### 2.1 总体分层

```
┌────────────────────────────────────────────────────────────┐
│  UI 层 (Ink + React)                                        │
│  src/cli.tsx → src/app.tsx → src/components/*              │
│  (parseArgs, render, MessageList, ToolTrace, InputBox)     │
└────────────────────────────────────────────────────────────┘
                          │ AgentEvent
                          ▼
┌────────────────────────────────────────────────────────────┐
│  Agent 核心 (手写 ReAct 循环)                                │
│  src/agent/loop.ts ←── src/agent/context.ts (压缩)         │
│  src/agent/schema.ts (zod → JSON Schema)                    │
│  src/agent/tools.ts (工具注册表)                            │
│  src/agent/types.ts (核心类型)                              │
└────────────────────────────────────────────────────────────┘
            │                            │
            ▼                            ▼
┌──────────────────────┐    ┌────────────────────────────────┐
│  LLM 适配层           │    │  工具实现                       │
│  src/llm/client.ts    │    │  src/tools/{read,write,edit}_  │
│  src/llm/stream.ts    │    │             file.ts            │
│  (OpenAI 协议)         │    │  src/tools/{grep,glob}.ts      │
└──────────────────────┘    │  src/tools/http_fetch.ts        │
            │                └────────────────────────────────┘
            ▼                            │
┌──────────────────────────────────────┐ │
│  沙箱 / 错误                         │ │
│  src/safety/sandbox.ts               │◀┘
│  src/safety/errors.ts                │
└──────────────────────────────────────┘
                          │
                          ▼
                ┌──────────────────────┐
                │  Config              │
                │  src/config.ts       │
                │  (.env + JSON)       │
                └──────────────────────┘
```

### 2.2 数据流(一次 ReAct 回合)

```
用户输入
  │
  ▼
App.handleUserInput
  │ 构造 messages 数组 → runTurn()
  ▼
runTurn                                          ← src/agent/loop.ts
  │
  │ 1. shouldCompress?  →  触发 compress()
  │
  │ 2. while 循环:
  │    ┌─► chatCompletionStream()                ← src/llm/stream.ts
  │    │     │
  │    │     ▼
  │    │   OpenAI SDK (chat.completions.create, stream:true)
  │    │     │
  │    │     ▼ (流式 chunk)
  │    │   AgentEvent.text_delta    →  UI 流式打字
  │    │   AgentEvent.tool_call_start
  │    │   AgentEvent.done
  │    │
  │    ├──► 若 finish_reason='tool_calls':
  │    │     │
  │    │     ▼ 对每个 ToolCall:
  │    │    1. findTool(tools, name)
  │    │    2. safety 检查 (yolo 跳过 confirm)
  │    │    3. onConfirm(tc, tool)  ← UI 弹 y/n
  │    │    4. JSON.parse(arguments)
  │    │    5. schema.safeParse(...)
  │    │    6. tool.execute(data, ctx)
  │    │       ├── 沙箱: resolveWithinCwd + assertWritableExt
  │    │       └── 错误: SandboxError / ToolError
  │    │    7. 结果(或错误)推 messages(作为 tool role)
  │    │    8. onEvent(tool_call_end)
  │    │
  │    └──► 若 finish_reason='stop': 退出循环
  │
  │ 3. 收尾:onEvent(done)
  ▼
返回 RunTurnResult { messages, finishReason }
```

### 2.3 关键技术决策

| 决策 | 选择 | 理由 |
|---|---|---|
| Agent 模式 | 手写 ReAct 循环 | 题目要求"类似 Claude Code";LangChain/Vercel AI SDK 是禁用的"agent 框架" |
| LLM 协议 | OpenAI Chat Completions 兼容 | DeepSeek / Moonshot / Ollama / vLLM 都支持,生态最广 |
| UI 框架 | Ink 5 + React 18 | 题目允许 UI 框架,Ink 渲染 TUI 是事实标准 |
| 工具入参 | zod schema + zod-to-json-schema | 类型安全 + 运行时校验 + 给 LLM 的 JSON Schema 描述 |
| Token 估算 | gpt-tokenizer (cl100k_base) | 滑动窗口阈值要 token 计数,这个不调 LLM 自己估 |
| 测试 | vitest + vi.mock + vi.hoisted | 纯 ESM、TS 原生、mock 简洁 |
| 流式渲染 | React 状态追加 + ▍光标 | 单页面追加,避免整段重渲染 |
| 文件总规模 | ~32 个源文件,~1500 行 TS/TSX | 单一职责、可读性优先 |

---

## 3. 功能与实现情况

### 3.1 核心循环(`src/agent/loop.ts`)

**ReAct 主循环**:处理一轮用户输入,可能产生多个 LLM ↔ tool 往返。

- ✅ 串行执行多 tool_call(LLM 一次可能调多个,逐个执行,逐个推 messages)
- ✅ finish_reason 解析(stop / length / abort / error)
- ✅ `withRetry`:网络/上游错误重试 3 次(500/2000/8000ms 退避)
- ✅ 错误回灌:`SandboxError` / `ToolError` / `unknown error` 统一包装成 `Error: ...` 字符串,作为 `role: 'tool'` 消息推回去,让 LLM 自我纠错
- ✅ 用户拒绝确认:工具结果写 `"User declined this action. Please try a different approach."` 让 LLM 知道
- ✅ `AbortSignal` 支持:用户 Ctrl+C 中断,finishReason='abort',后续 LLM 请求携带 signal

**Yolo 模式**:`yolo && tool.safety !== 'dangerous'` 时跳过 confirm。`dangerous` 工具(`http_fetch`)即使在 yolo 下也走 onConfirm(刻意保留最后一道闸)。

### 3.2 工具系统(`src/tools/*.ts` + `src/agent/{schema,tools}.ts`)

| 工具 | safety | 功能 | 沙箱 | 备注 |
|---|---|---|---|---|
| `read_file` | safe | 读文件,>1MB 截断,offset/limit 分块 | 路径必须在 cwd 内 | 安全 |
| `write_file` | confirm | 写文件,完全覆盖,自动 mkdir -p | 路径 + 后缀白名单 | 后缀白名单在 config |
| `edit_file` | confirm | 字符串精确替换,要求 old_string 唯一 | 同上 | 防误改 |
| `grep` | safe | ripgrep 优先 / grep 兜底,正则 | 收敛到 cwd 内文件 | max_results 默认 100 |
| `glob` | safe | fast-glob 匹配路径 | base 必须可解析进 cwd | |
| `http_fetch` | dangerous | GET/POST,响应截断 100KB | POST 需要 `--allow-mutations` | 唯一网络出口 |

**工具注册**:`src/agent/tools.ts` 提供 `getToolDescriptors()`(给 LLM 用)和 `findTool()`(按 name 查)。App 启动时 `TOOLS: ToolDef[]` 数组聚合 6 个工具。

**JSON Schema 规整**(`src/agent/schema.ts`):
- 去掉 `$schema` 噪音
- object 上移除 `additionalProperties: false`(默认值无信息量;但 `record` 的 value 类型描述要保留)
- `integer` → `number`(LLM 不区分整数/浮点)
- union 保留 `type: [...]` 形式

### 3.3 沙箱(`src/safety/sandbox.ts`)

**路径解析 `resolveWithinCwd(p, cwd)`**:
- 绝对路径直接用,相对路径 `path.resolve(cwd, p)`
- `fs.realpathSync()` 跟随符号链接
- **macOS 兼容**:`/tmp` 在 macOS 是 `/private/tmp` 的 symlink,`realpath` 后会变,所以同时用"用户给的 cwd"和"realpath 后的 cwd"做边界检查,**只有当两边都判定越界时才抛错**(因为有时用户 cwd 是 `/tmp`,realpath 后的 cwd 是 `/private/tmp`,只查一边会误判)
- 输入是 `'.'` 直接返回用户给的 cwd 字符串(避免替换成 `/private/...` 让后续 display 不一致)

**写后缀白名单 `assertWritableExt(abs, allowedExts)`**:
- 后缀转小写后比对 `writeableExts` 数组
- 默认白名单:`.md .ts .tsx .js .jsx .json .yaml .yml .toml .txt`
- 可通过 `~/.agent/config.json` 的 `writeableExts` 字段覆盖
- 故意不开放 `.sh` / `.bash` / 无后缀文件,跟"不执行任意 shell"的策略一致

### 3.4 LLM 适配(`src/llm/`)

**`createOpenAIClient(cfg)`**:用 `apiKey + baseURL` 构造 `OpenAI` 实例。`apiKey` 缺失抛 `OPENAI_API_KEY is not set. Please set it in .env or env.`,UI 端捕获后直接显示。

**`chatCompletionStream(input)`**:把 OpenAI stream 包成 `AsyncIterable<AgentEvent>`。
- text 增量:`delta.content` → `text_delta`
- tool_call 增量:按 `index` 累积 `id` / `name` / `arguments`,在 `finish_reason` 触发时**一次性 flush** 为 `tool_call_start` 事件(`flushed: Set<number>` 防重复)
- abort:每次循环检查 `signal.aborted`,立刻发 `done: 'abort'` 退出
- error:stream 创建阶段失败,发 `error` 事件返回;loop 接到会重试(`withRetry`)

### 3.5 上下文压缩(`src/agent/context.ts`)

**触发条件**:`estimateTokens(messages) > maxContextTokens * 0.7`(留 30% 余量给回答)。

**估算**:`gpt-tokenizer.encode()` 后取 `.length`,每条消息额外 +4(OpenAI 协议 overhead)。

**压缩策略**:
- 保留 system 消息
- 保留最近 6 条
- 中间折成一条 `[Summary of earlier conversation]\n...` 消息(role: user,让 LLM 当作"系统提示"读)
- summarizer 是 loop 注入的 LLM 调用(目前实现是 `text.slice(0, 200) + '...'` 占位,真实场景应换成 LLM 摘要调用)

**局限**:仅在轮次开始时压缩,不在每条 tool result 后增量压缩。

### 3.6 UI(`src/app.tsx` + `src/components/*`)

**Ink 5 + React 18**,组件:
- `MessageList`:纵向排列 user / assistant / tool 三种 message
  - user:青色 `❯` 前缀
  - assistant:绿色,流式时尾部 `▍` 光标
  - tool:嵌入 `ToolTrace`
- `ToolTrace`:圆角边框,执行中黄框 + `[y/n]` 提示,完成后灰框(result 红色 if 开头是 `Error:`)
- `InputBox`:底部 `❯ ` 提示 + `ink-text-input`,busy 状态显示"(agent 工作中,按 Ctrl+C 中断)"

**状态机**:
- `messages: Message[]`:发给 LLM 的源数据(全量,无截断)
- `display: DisplayMessage[]`:渲染用的扁平结构(text/tool 等)
- `busy: boolean`:控制 input 是否禁用
- `pending: DisplayMessage | null`:当前等待 y/n 的 confirm 请求
- `confirmResolversRef: useRef<Map>`:`onConfirm` 返回的 Promise 由 `useInput` 监听 y/n 键触发 resolve

**确认交互**:工具发起 confirm 时:
1. onConfirm(tc) → 构造新 Promise,resolver 存进 Map
2. setPending({...}) → UI 渲染 ToolTrace 的 pending 形态
3. 用户按 y/n → useInput 回调里取 resolver,resolve(true/false),清 pending

**headless 模式**:`-- "prompt string"`,处理完一轮后 `useApp().exit()`。

### 3.7 配置(`src/config.ts`)

**优先级**:`env > ~/.agent/config.json > default`

| Key | Env | 默认 |
|---|---|---|
| `openaiApiKey` | `OPENAI_API_KEY` | (必填,无默认) |
| `openaiBaseUrl` | `OPENAI_BASE_URL` | `https://api.deepseek.com/v1` |
| `openaiModel` | `OPENAI_MODEL` | `deepseek-chat` |
| `maxContextTokens` | `AGENT_MAX_CONTEXT_TOKENS` | `120000` |
| `writeableExts` | (无 env) | `['.md','.ts','.tsx','.js','.jsx','.json','.yaml','.yml','.toml','.txt']` |

**`.env` 加载**:`src/cli.tsx` 在 `render()` 之前手动解析 `.env` 文件(因为不引 `dotenv` 包),仅在变量未在 `process.env` 中设置时填入。

**CLI 参数**:
- `--yolo`:跳过 confirm 类工具的确认(dangerous 仍保留确认)
- `--allow-mutations`:允许 http_fetch 用 POST、删除文件等副作用
- `--cwd <path>`:覆盖工作目录
- 位置参数(非 `--` 开头):作为 `headlessPrompt`,处理完一轮即退出

---

## 4. 测试与验证

### 4.1 单元测试(vitest)

**位置**:`src/__tests__/`(平铺)+ `src/__tests__/tools/`(按工具分子目录)

**覆盖**:
- `loop.test.ts`(5 用例):LLM 文本停 / 调工具回灌 / 用户拒绝 / 沙箱错误回灌 / yolo 跳过 confirm
- `context.test.ts`(4 用例):空估 0 / 字符串估 token / 阈值判定 / 压缩结构
- `sandbox.test.ts`:路径越界、符号链接、`.` 输入、写后缀白名单
- `schema.test.ts`:zod → JSON Schema 规整(`$schema` 移除、integer → number、record 保留 value 类型)
- `stream.test.ts`:OpenAI stream 增量累积,union 类型、`anyOf` 处理
- `tools/*test.ts`:6 个工具各 2-4 用例,主要覆盖沙箱触发、参数校验、输出格式

**模式**:
- `vi.hoisted` 提前构造 mock,放在 `import` 之前,避免 hoisting 坑
- `vi.mock('../llm/stream.js', ...)` 替换真实 LLM 调用,测试跑得很快
- `mkdtemp('/tmp/agent-loop-')` 给每次测试独立 cwd,`afterEach` 清理(`0de7927` 修的)

**结果**:`npm test` 46/46 通过,`npm run typecheck` exit 0。

### 4.2 端到端验证(在「测试一下吧」阶段跑的 5 轮)

| # | 验证项 | 结果 |
|---|---|---|
| 1 | tsc + vitest | ✅ 46/46,tsc exit 0 |
| 2 | `loadConfig` + `createOpenAIClient` 缺 key | ✅ 抛 `OPENAI_API_KEY is not set. Please set it in .env or env.` |
| 3 | 沙箱拦截越界写入 | ✅ LLM 调 `write_file('../escape.sh')` → 沙箱抛 `Path escapes cwd: ../escape.sh`,错误回灌 LLM,`/tmp/escape.sh` 未创建 |
| 4 | read_file + write_file 真实集成 | ✅ read_file 读到 source.txt 内容,write_file 真实落盘 copy.md,3 轮 LLM↔tool 循环,6 个 AgentEvent |
| 5 | 压缩 + 工具函数 | ✅ 21 条不压缩(701 tokens),80 条超阈值压缩(>84000 tokens),101 条压缩到 8 条(4806→316 tokens,93% 降幅),结构(system + summary + 6 recent)正确 |

### 4.3 顺带修复

- **`0de7927`** loop.test.ts 加 `afterEach` 清理 `mkdtemp` 临时目录(发现测试会往 `/tmp` 留垃圾,不是新 bug)

---

## 5. 文件清单

### 5.1 源代码(`src/`)

| 路径 | 职责 | 行数级别 |
|---|---|---|
| `cli.tsx` | CLI 入口、参数解析、`.env` 加载、Ink render | ~40 |
| `app.tsx` | 顶层 React 组件、状态机、runTurn 调用、y/n 监听 | ~170 |
| `config.ts` | env + JSON 配置加载、默认值 | ~40 |
| `agent/types.ts` | 核心类型:`ToolDef`、`Message`、`AgentEvent`、`RunTurnInput` | ~90 |
| `agent/loop.ts` | ReAct 主循环、retry、错误回灌 | ~150 |
| `agent/context.ts` | token 估算、压缩策略 | ~50 |
| `agent/schema.ts` | zod → JSON Schema + normalize | ~50 |
| `agent/tools.ts` | 工具注册表 | ~15 |
| `llm/client.ts` | OpenAI 客户端工厂 | ~15 |
| `llm/stream.ts` | stream → `AsyncIterable<AgentEvent>` | ~90 |
| `safety/sandbox.ts` | `resolveWithinCwd` + `assertWritableExt` | ~50 |
| `safety/errors.ts` | `SandboxError` + `ToolError` | ~15 |
| `tools/read_file.ts` | 读文件、>1MB 截断、offset/limit | ~40 |
| `tools/write_file.ts` | 写文件、白名单、自动 mkdir | ~50 |
| `tools/edit_file.ts` | 字符串替换、唯一匹配校验 | ~55 |
| `tools/grep.ts` | rg 优先 / grep 兜底 | ~85 |
| `tools/glob.ts` | fast-glob、base 沙箱校验 | ~30 |
| `tools/http_fetch.ts` | GET 默认,POST 需 flag,100KB 截断 | ~40 |
| `components/InputBox.tsx` | 底部输入框 | ~20 |
| `components/MessageList.tsx` | 消息流渲染 | ~40 |
| `components/ToolTrace.tsx` | 工具 trace(执行中/完成两态) | ~30 |

### 5.2 测试(`src/__tests__/`)

| 文件 | 用例数 |
|---|---|
| `loop.test.ts` | 5 |
| `context.test.ts` | 4 |
| `sandbox.test.ts` | 6 |
| `schema.test.ts` | 3 |
| `stream.test.ts` | 4 |
| `tools/read_file.test.ts` | 3 |
| `tools/write_file.test.ts` | 4 |
| `tools/edit_file.test.ts` | 5 |
| `tools/grep.test.ts` | 3 |
| `tools/glob.test.ts` | 3 |
| `tools/http_fetch.test.ts` | 3 |
| **合计** | **46** |

### 5.3 文档

| 路径 | 内容 |
|---|---|
| `README.md` | 极简使用说明(10 行) |
| `docs/PROJECT.md`(本文件) | 项目文档:架构 + 功能 + 实现情况 |
| `docs/superpowers/specs/2026-06-04-terminal-agent-design.md` | 设计稿(为什么这么做) |
| `docs/superpowers/plans/2026-06-04-terminal-agent.md` | 实施计划(14 task,2590 行 TDD 步骤) |

---

## 6. 已知限制与未做的事

- **未持久化**:进程退出即丢,跨 session 不记忆。
- **summarizer 是占位**:`compress()` 里的 `text.slice(0, 200) + '...'` 不是真 LLM 摘要,真用需要换成 `await chatCompletion({...summarize prompt...})`。
- **压缩时机粗**:只在 runTurn 开头压一次,不在 tool result 增量后压。
- **无 shell 工具**:刻意不提供,跟"路径/后缀沙箱"配对的安全策略。
- **Ink 需 TTY**:`script -q /dev/null` 这种伪 TTY 在本环境下 Ink 报 `Raw mode is not supported`,真实终端可用,headless 模式(`-- "prompt"`)可绕开。
- **不支持多模态**:只 text + tool_call,image/file_url 等未做。
- **confirm 工具串行执行**:一次 LLM 调用如果有 N 个 confirm 工具,N 个都弹 y/n 依次确认(没有"一次接受全部"按钮)。
- **无费用/token 计量上报**:usage 拿到但不展示、不累计。

---

## 7. 快速开始

```bash
# 1. 装依赖
npm install

# 2. 配 .env
cp .env.example .env  # 改 OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL

# 3. 启动 REPL
npm run dev

# 4. 或单次 headless
npm run dev -- "列出 src/ 下的所有 .ts 文件"
```

**首次使用建议先跑**:
```bash
npm test          # 看 46/46 绿
npm run typecheck # 看 tsc 干净
```

---

## 8. 后续可考虑

- [ ] 替换 summarizer 占位为真 LLM 摘要调用
- [ ] UI 加"接受全部 confirm"快捷键
- [ ] 加 `--max-cost` / `--max-turns` 资源护栏
- [ ] 加 `.agent/sessions/` JSON 持久化(跨 session 记忆)
- [ ] `multi_agent` 模式:head agent 调度多个子 agent
- [ ] 加 `code_search`(对 ripgrep 的语义包装)、`run_tests`(只跑白名单命令)等专用工具
- [ ] Web UI(Electron / Tauri),把 Ink 渲染换成浏览器

---

**版本**:v0.1.0
**状态**:核心功能完整,46/46 单测 + 5 轮 E2E 通过
**协议**:MIT
**最近更新**:2026-06-04
