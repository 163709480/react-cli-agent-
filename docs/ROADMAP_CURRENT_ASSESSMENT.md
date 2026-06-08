# react-cli-agent 当前评估与下一步规划

日期: 2026-06-08

## 1. 当前状态

`react-cli-agent` 已经具备可用 MVP 的主体能力,不是单纯 demo。当前代码包含:

- TypeScript + Ink 终端 UI
- OpenAI Chat Completions 兼容 LLM 接入
- 手写 ReAct loop
- 文件读写、搜索、HTTP、删除、todo、ask-user 等工具
- cwd 文件沙箱和写文件后缀白名单
- confirm / dangerous 分级确认
- SHA-256 hash chain JSONL 审计日志
- 上下文压缩、hot cut、turn/tool call 资源上限
- 只读工具并发分批执行
- 较完整的单元测试

当前验证结果:

```text
npm test          30 files, 180 tests passed
npm run typecheck passed
npm run build     passed
```

## 2. 项目优点

### 2.1 定位清楚

项目定位是本地终端开发者 Agent,强调轻量、可读、可审计、可自托管。不依赖 LangChain / Vercel AI SDK 等 Agent 框架,核心行为集中在少量 TypeScript 文件里,适合学习、审计和二次开发。

### 2.2 架构分层合理

主要模块边界清晰:

- `src/agent`: ReAct loop、上下文、工具描述、分批执行
- `src/tools`: 具体工具实现
- `src/safety`: 路径沙箱和错误类型
- `src/audit`: hash chain 审计日志
- `src/llm`: OpenAI-compatible client 和 stream 适配
- `src/components`: Ink UI 组件
- `src/config.ts`: 配置加载

这使得后续新增 provider、工具、审计 sink、UI 状态都比较容易。

### 2.3 安全意识强于普通原型

项目没有直接暴露任意 shell 工具。文件写入需要确认,并受 cwd 和后缀白名单限制。`dangerous` 工具在 `--yolo` 下仍然需要确认。审计日志使用 hash chain,能检测篡改、删除和插入。

### 2.4 测试基线较好

测试覆盖了 loop、sandbox、audit、context compression、tool partition、工具行为、组件交互等关键路径。当前测试和类型检查均通过,说明已有能力具备继续迭代的基础。

## 3. 主要问题

### 3.1 文档与代码状态漂移

当前文档存在多处版本和能力描述不一致:

- `package.json` 是 `0.2.0`,但部分文档仍写 `0.1.x current`
- README badge 写 `142 passed`,实际是 `180 passed`
- README 写了 v0.3/v0.4 能力,但 package 版本仍是 v0.2.0
- `src/app.tsx` 审计事件里 `agentVersion` 硬编码为 `0.1.0`
- CLI help 写的是 `AGENT_API_KEY / AGENT_BASE_URL / AGENT_MODEL`,但实际配置读取的是 `OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL`
- `--allow-mutations` 在 help 中描述为“允许修改文件”,但实际主要控制 HTTP 非 GET 请求

这会影响用户信任,也会影响后续发布。

### 3.2 沙箱仍有 symlink 边界风险

`resolveWithinCwd` 对已存在目标路径会 `realpathSync(abs)`,但对不存在路径会回退到 `path.resolve(abs)`。如果 cwd 内有一个符号链接目录指向 cwd 外部,写入这个链接目录下的新文件时可能绕过 realpath 检查。

风险示例:

```text
cwd/
  link -> /outside

write_file path="link/new.md"
```

目标文件 `link/new.md` 不存在时,当前逻辑可能只检查字面路径是否在 cwd 内,而实际写入会跟随 `link` 到 cwd 外部。

这是当前最优先的安全修复项。

### 3.3 缺少安全验证命令工具

Agent 已经能读写代码,但还不能安全地运行验证命令。开发类 Agent 完成修改后,最需要自动执行:

- `npm test`
- `npm run typecheck`
- `npm run build`
- 项目配置允许的 lint/test 命令

不建议开放任意 shell。更合理的是新增白名单式 `run_command` 或 `run_tests` 工具,只允许运行配置中声明的命令。

### 3.4 发布体验还不完整

项目已经有 `bin` 和 build 脚本,但仍需要发布前闭环:

- `npm pack` 验证产物
- 安装后 `react-cli-agent --version` / `--help` 验证
- README 安装步骤校准
- `.env.example` 和配置说明校准
- changelog 与 package version 同步

### 3.5 终端 UI 会持续向下滚动

当前交互效果更接近“命令行追加日志”:用户输入一轮,assistant 回复一轮,内容会继续写到终端下方。多轮对话后屏幕一直向下滚,不像 Claude Code 那样把对话、工具状态、输入框控制在一个固定 TUI 工作区内。

期望体验:

```text
┌──────────────────────────────────────────────┐
│ status / model / cwd / tokens                │
├──────────────────────────────────────────────┤
│ conversation viewport                         │
│ ...                                           │
│ 只在这个区域内滚动/裁剪                       │
├──────────────────────────────────────────────┤
│ tool status / todos / confirm box             │
├──────────────────────────────────────────────┤
│ ❯ input                                       │
└──────────────────────────────────────────────┘
```

核心不是“不要产生历史”,而是历史渲染要进入受控 viewport。终端屏幕只保留当前应用布局,旧内容通过组件状态重绘,而不是不断向 stdout 追加。

### 3.6 缓存命中率还有优化空间

当前项目没有独立缓存层。已有能力主要是:

- API 侧可能有 provider 自带 prompt cache,但项目没有显式为它优化消息结构
- `context.ts` 会做上下文压缩,但压缩结果没有缓存
- `read_file` / `grep` / `glob` 每次工具调用都会重新读磁盘或重新搜索
- system prompt、工具描述、compact instructions 每轮都会重新拼进请求上下文

对本地 Agent 来说,缓存要分三类看:

1. **LLM prompt cache 命中率**
   - 重点是让请求前缀稳定
   - system prompt、工具 schema、工具描述顺序要固定
   - 不要把易变状态插到 prompt 前面
   - 历史消息尽量 append-only,避免频繁重写前缀

2. **本地工具结果缓存**
   - `read_file` 可按 `absPath + mtimeMs + size + offset + limit` 做缓存 key
   - `glob` 可按 `cwd + pattern + ignore + git HEAD/index 状态` 做短 TTL 缓存
   - `grep` 可按 `cwd + pattern + glob + max_results + 文件集 fingerprint` 做缓存
   - 文件写入、删除、编辑后必须失效相关缓存

3. **摘要/压缩缓存**
   - `summarizeConversation` 可按 `model + compactInstructionsHash + middleMessagesHash` 缓存
   - 相同历史中段不必重复调用 LLM 摘要
   - 摘要失败也可以短时间 negative cache,避免 provider 故障时每轮都重试

缓存优化的核心目标不是“缓存所有东西”,而是减少重复 token、重复工具 IO 和重复摘要调用。

### 3.7 缺少内置 slash commands

当前用户输入都会作为自然语言 prompt 进入 Agent。类似 `/compact` 这种确定性操作不应该发给 LLM,应该在 UI/App 层直接拦截并执行。

建议支持一组内置命令:

```text
/compact          手动触发上下文压缩
/status           查看当前模型、cwd、token、turn/tool limits、缓存统计
/clear            清空当前屏幕显示,不清空真实上下文
/reset            清空当前 session 上下文,保留 cwd/config
/todos            展开/收起 todo 列表
/audit            显示当前审计日志路径和 verify 命令
/help             显示内置命令帮助
```

第一版最重要的是 `/compact`。它可以复用现有 `compress()` / `summarizeConversation()` / `fallbackSummary()` 逻辑,但入口要从 `App.handleUserInput()` 分流,不要进入 `runTurn()` 的普通 LLM 对话路径。

### 3.8 上下文压缩缺少明确进度反馈

当前压缩状态主要通过 phase 和文本提示展示,用户只能看到最终 `[context compressed: X → Y tokens]`。如果 `/compact` 是手动命令,用户会更期待一个明确的进度条或阶段状态。

建议显示:

```text
Compressing context
[██████████░░░░░░░░░░] 50%
Estimating tokens -> Summarizing -> Rebuilding context -> Done
12,340 -> 4,512 tokens, 63% reduced
```

注意:LLM summarizer 本身通常没有真实 token 级进度,所以进度条第一版应该是“阶段进度”,不是伪装成真实网络进度。

建议阶段:

- 10%: estimating tokens
- 25%: loading compact instructions
- 40%: summarizing
- 75%: rebuilding messages
- 90%: estimating compressed tokens
- 100%: done

如果 summarizer 失败并进入 fallback,进度条仍然走到完成,但状态显示 `fallback used`。

### 3.9 缺少快捷模型配置入口

当前切换模型主要依赖:

- `--provider deepseek`
- `OPENAI_BASE_URL`
- `OPENAI_MODEL`
- `OPENAI_API_KEY`
- `~/.agent/config.json`

这对熟悉配置的人可用,但对日常使用不够顺手。用户更希望像下面这样快速选择:

```text
本地 Ollama
在线 DeepSeek
在线 MiniMax
自定义 OpenAI-compatible
```

建议做成“provider preset + 配置向导 + 当前 session 快速切换”三层:

1. **provider preset**
   - 代码内置常见 provider 的 `baseUrl`、默认模型、是否需要 API key
   - 例如 `ollama`、`deepseek`、`minimax`

2. **配置向导**
   - 命令行运行 `react-cli-agent config`
   - 或 TUI 内输入 `/config`
   - 通过选项选择 provider
   - 需要 key 时提示输入 API key
   - 写入 `~/.agent/config.json`

3. **当前 session 快速切换**
   - `/model` 查看当前 provider/model
   - `/model ollama`
   - `/model deepseek`
   - `/model minimax`
   - `/model custom`

第一版建议优先做持久配置,不要先做运行中热切换。运行中切换 provider 会涉及当前 client、model、审计记录、上下文是否继续沿用等问题,可以后置。

### 3.10 当前仍是单 Agent 模式

当前架构是一个主 `runTurn()` 驱动一个 ReAct agent。它已经支持“同一轮 LLM 响应里的只读工具并发”,但还没有真正的 subagent / multi-agent:

- 没有 coordinator agent
- 没有 worker agent 生命周期
- 没有子任务拆分协议
- 没有子 agent 独立上下文
- 没有结果合并器
- 没有跨 agent 写入冲突控制

任务很多时,单 agent 会遇到几个问题:

- 上下文快速膨胀
- 一个 agent 同时负责探索、计划、修改、验证,容易分心
- 大范围代码检索会占用主对话上下文
- 多个独立模块本可以并行分析,但现在只能串行
- 一旦开放写入型多 agent,又会带来文件冲突和审计复杂度

建议采用渐进式 subagent 路线:

1. **Explore subagent**
   - 只读
   - 只能用 `read_file` / `glob` / `grep`
   - 用于代码考古、定位文件、总结模块职责
   - 不允许写文件、不允许 HTTP POST、不允许删除

2. **Planner subagent**
   - 只读
   - 负责把大任务拆成子任务
   - 输出结构化 plan,不直接改代码

3. **Worker subagent**
   - 可写,但必须有文件所有权范围
   - 每个 worker 只能写 assigned files / assigned directories
   - 默认不并行写同一目录,更不并行写同一文件

4. **Coordinator**
   - 主 agent 保持用户交互、确认、审计和最终合并
   - coordinator 决定是否拆分、拆几个、每个 agent 的权限和上下文
   - 所有子 agent 结果必须汇总回主 agent

第一版不要做“自动任意拆分并写代码”。更安全的 MVP 是“主 agent 自动派发多个只读 Explore subagent”,用于并行查资料和读代码,再由主 agent 做最终判断。

## 4. 下一步路线图

## P0: 可信基线

目标: 先保证安全边界、文档可信、版本可信。

### P0.1 修复 symlink sandbox 风险

建议实现:

- 对不存在目标文件,检查其最近存在的父目录的 realpath
- 确认真实父目录仍在 cwd 内
- 再拼接不存在的尾部路径
- 保持 macOS `/tmp -> /private/tmp` 兼容逻辑

验收标准:

- cwd 内普通新文件仍可写
- cwd 内普通子目录新文件仍可写
- cwd 外路径仍被拒绝
- cwd 内 symlink 指向 cwd 外时,写入 `link/new.md` 被拒绝
- `npm test` / `npm run typecheck` 通过

### P0.2 校准版本、文档和 help

建议修改:

- README test badge 更新为 `180 passed`
- SECURITY 当前支持版本改为 `0.2.x`
- 审计日志里的 `agentVersion` 改为读取 package version,或由 CLI 传入
- CLI help 的环境变量改为实际支持的 `OPENAI_*`
- `--allow-mutations` 描述改为“允许 HTTP POST 等副作用请求”
- `docs/PROJECT.md` 中 summarizer 占位描述更新为真实 LLM summarizer + fallback

验收标准:

- README、SECURITY、CLI help、package version 不互相矛盾
- `react-cli-agent --help` 与实际配置行为一致

### P0.3 设计 Claude Code 风格固定 TUI 布局

建议先做设计和小步验证,不要一次性重写所有 UI。

当前可能原因:

- `MessageList` 以完整历史列表渲染,没有明确 viewport 高度和滚动策略
- `Box overflowY="hidden"` 只能裁剪 React/Ink 布局,不能天然提供“历史可滚动视口”
- assistant 流式输出持续追加到 display state,内容变长后会把 input 和后续内容向下推
- 工具状态、todo、确认框、message list 之间缺少固定高度预算

可选方案:

1. 固定屏幕布局 + 裁剪最近消息
   - 使用 `useStdout().stdout.rows` 获取终端高度
   - 给 header、todo、tool、input 预留固定行数
   - 剩余高度给 conversation viewport
   - `MessageList` 只渲染从底部向上的可见行
   - 优点:实现简单,适合第一版
   - 缺点:不能自由翻历史

2. 固定屏幕布局 + 可滚动 conversation viewport
   - 为 message history 建立渲染后的 line buffer
   - 默认 stick-to-bottom
   - 支持 PageUp/PageDown 或方向键滚动历史
   - 新 token 到来时,如果用户在底部则自动跟随;如果用户在看历史则不跳到底
   - 优点:接近 Claude Code 体验
   - 缺点:实现复杂,需要处理宽度变化和文本换行

3. 引入成熟 TUI viewport 组件
   - 调研 Ink 生态是否有稳定 scroll area / viewport 组件
   - 如果组件质量一般,宁可自己实现底部裁剪
   - 项目当前主打轻量可读,不宜为了滚动引入过重依赖

建议 MVP:

- 第一阶段做“固定布局 + 底部裁剪最近消息”
- 第二阶段再做 PageUp/PageDown 历史滚动
- 第三阶段优化鼠标滚轮、搜索历史、复制模式

验收标准:

- 多轮对话不会把 prompt 一直推到终端下方
- 当前屏幕始终保留 header、conversation、tool/todo、input 四个区域
- assistant 流式输出只更新 conversation 区域
- 长回复被裁剪在 conversation 区域内,不会破坏输入框位置
- 终端高度变化后布局能重新计算
- headless 模式不受影响

### P0.4 做缓存命中率基线观测

在调缓存前,先加可观测性,否则无法判断优化是否有效。

建议新增 metrics:

- 每次 LLM call 的 `promptTokens` / `completionTokens`
- system prompt hash
- tools schema hash
- message prefix hash
- compact instructions hash
- 是否发生 context compression
- compression 前后 token 数
- 本地工具 cache hit / miss / stale / invalidated

可以先只输出到 audit log 或 debug event,不一定先做 UI。

验收标准:

- 每次 LLM call 能看到稳定前缀 hash 是否变化
- 能统计 session 级 prompt cache 友好度
- 能统计工具缓存命中率
- 默认不泄露 API key 和完整敏感内容

### P0.5 新增内置 slash command 分流

目标: 让确定性本地操作不再走 LLM prompt。

建议新增模块:

```text
src/agent/commands.ts
```

职责:

- 判断输入是否为 slash command
- 解析命令名和参数
- 返回结构化 command object
- 未知命令返回错误提示,不要发给 LLM

建议类型:

```ts
type BuiltinCommand =
  | { type: 'compact' }
  | { type: 'status' }
  | { type: 'clear' }
  | { type: 'reset' }
  | { type: 'help' };
```

`App.handleUserInput()` 流程:

```text
input text
  -> parseBuiltinCommand(text)
  -> if command: executeBuiltinCommand(command)
  -> else: runTurn(...)
```

验收标准:

- `/compact` 不调用 chatCompletionStream
- `/help` 能列出内置命令
- 未知 `/xxx` 显示错误,不进入 LLM
- 普通自然语言仍按原逻辑进入 `runTurn`
- headless 模式可选择支持 slash command,例如 `react-cli-agent /compact`

### P0.6 手动 `/compact` 和压缩进度条

目标: 用户可以像 Claude Code 一样主动压缩上下文,并看到明确反馈。

建议实现:

- 把 `runTurn` 里的压缩逻辑抽成可复用函数,例如 `compactMessages()`
- `runTurn` 自动压缩和 `/compact` 手动压缩共用同一套实现
- `App` 新增 `compactProgress` state
- `HeadStatus` 或新增 `CompactProgress` 组件展示进度条
- 压缩成功后更新 `messages` state
- 压缩失败时保留原 messages,显示 fallback 或 error 状态

进度事件建议:

```ts
type CompactProgressEvent =
  | { phase: 'estimating'; percent: 10 }
  | { phase: 'loading_instructions'; percent: 25 }
  | { phase: 'summarizing'; percent: 40 }
  | { phase: 'rebuilding'; percent: 75 }
  | { phase: 'done'; percent: 100; beforeTokens: number; afterTokens: number; fallback: boolean };
```

验收标准:

- 输入 `/compact` 后立即显示压缩进度
- 压缩期间 input 禁用或显示 busy
- 成功后显示 token 前后变化和压缩比例
- fallback 时明确显示 `fallback used`
- 压缩后继续对话能使用压缩后的上下文
- 如果消息太少无需压缩,显示 `nothing to compact`
- 有测试覆盖 command parse、手动 compact 不进 LLM、进度状态

### P0.7 快捷配置入口设计

目标: 用户不需要手动编辑 `.env` 或 JSON,就能选择本地 Ollama / 在线 DeepSeek / 在线 MiniMax。

建议新增命令:

```text
react-cli-agent config
react-cli-agent config --provider ollama
react-cli-agent config --provider deepseek
react-cli-agent config --provider minimax
react-cli-agent config --show
```

TUI 内置命令:

```text
/config
/model
/model ollama
/model deepseek
/model minimax
```

配置文件建议:

```json
{
  "providerName": "deepseek",
  "openaiBaseUrl": "https://api.deepseek.com/v1",
  "openaiModel": "deepseek-chat",
  "openaiApiKeyRef": "env:OPENAI_API_KEY"
}
```

API key 存储建议:

- 第一版不要把 key 明文写入项目目录
- 优先写入 `~/.agent/config.json`,文件权限设为 `0600`
- 更安全的做法是只保存 `openaiApiKeyRef`,实际 key 仍从 env 读取
- 后续再考虑系统 keychain

验收标准:

- `react-cli-agent config --show` 能显示当前 provider/model/baseUrl,但不显示完整 API key
- `react-cli-agent config --provider ollama` 能写入本地 Ollama 配置
- `react-cli-agent config --provider deepseek` 能写入 DeepSeek 配置
- `react-cli-agent config --provider minimax` 能写入 MiniMax 配置
- 配置写入后直接运行 `react-cli-agent` 使用新 provider
- 未配置 key 的在线 provider 启动时给出清晰提示
- Ollama provider 允许使用占位 API key,不强制用户配置真实 key
- 配置文件权限测试覆盖 `0600`

## P1: 开发者实用能力

目标: 让 Agent 能完成“改代码 -> 验证 -> 反馈”的闭环。

### P1.1 新增白名单式 `run_command` / `run_tests` 工具

设计原则:

- 不开放任意 shell
- 不执行 LLM 自由拼接命令
- 命令必须来自配置白名单
- 每条命令使用 argv 数组,避免 shell 注入
- 默认超时,例如 60 秒
- stdout / stderr 截断,例如各 100KB
- 默认 safety 为 `confirm`
- 可配置某些只读验证命令为 safe,但初期建议都 confirm

配置示例:

```json
{
  "allowedCommands": {
    "test": ["npm", "test"],
    "typecheck": ["npm", "run", "typecheck"],
    "build": ["npm", "run", "build"]
  }
}
```

工具入参示例:

```json
{
  "name": "test"
}
```

验收标准:

- 未配置命令不能执行
- 配置命令能执行并返回 exitCode/stdout/stderr
- 超时会终止子进程
- 输出过长会截断
- 不经过 shell
- 有测试覆盖成功、失败、未授权、超时、输出截断

### P1.2 增加 provider preset

建议新增:

- `openai`
- `moonshot`
- `ollama`
- `vllm`
- `minimax`

注意:

- Ollama 通常不需要真实 API key,但 OpenAI SDK 仍可能要求传一个占位 key
- provider preset 只解决 baseUrl/model 默认值,不要把 API key 写进代码
- MiniMax 的 OpenAI-compatible baseUrl 和默认模型需要实现时按官方文档核对,不要凭记忆写死

验收标准:

- `--provider openai|deepseek|moonshot|ollama|vllm|minimax` 可解析
- 未知 provider 启动期报错
- env 覆盖规则有测试

### P1.2.1 Provider preset 数据结构升级

当前 `ProviderPreset` 只有:

```ts
interface ProviderPreset {
  baseUrl: string;
  defaultModel: string;
}
```

建议升级为:

```ts
interface ProviderPreset {
  id: string;
  label: string;
  kind: 'local' | 'online' | 'custom';
  baseUrl: string;
  defaultModel: string;
  requiresApiKey: boolean;
  apiKeyEnv?: string;
  notes?: string;
}
```

示例:

```ts
const PROVIDERS = {
  ollama: {
    id: 'ollama',
    label: 'Ollama local',
    kind: 'local',
    baseUrl: 'http://127.0.0.1:11434/v1',
    defaultModel: 'qwen2.5-coder:7b',
    requiresApiKey: false,
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek online',
    kind: 'online',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    requiresApiKey: true,
    apiKeyEnv: 'OPENAI_API_KEY',
  },
  minimax: {
    id: 'minimax',
    label: 'MiniMax online',
    kind: 'online',
    baseUrl: '<verify-official-openai-compatible-base-url>',
    defaultModel: '<verify-official-default-model>',
    requiresApiKey: true,
    apiKeyEnv: 'OPENAI_API_KEY',
  },
};
```

验收标准:

- `listProviderNames()` 仍返回 provider id 列表
- `resolveProvider()` 返回完整 preset
- `loadConfig()` 能根据 `requiresApiKey` 决定是否允许占位 key
- Welcome/Status UI 能显示 `label` 而不是只显示 id
- providers snapshot 测试覆盖 preset 字段

### P1.3 优化 LLM prompt cache 命中率

目标: 让 provider 侧 prompt cache 更容易命中,减少长会话成本和响应延迟。

建议:

- 冻结 system prompt 字节内容
- 冻结工具数组顺序和工具 schema 输出
- 给 `getToolDescriptors()` 增加 snapshot 测试,防止无意改变 schema 字节
- 将高频变化状态放到消息尾部,不要插入 system prompt 后面
- 上下文压缩时尽量只替换中段,保留 system + stable prefix
- 避免把动态状态、耗时、token 数等塞进 system prompt
- 如果 provider 支持 prompt cache control,后续可抽象 provider-specific hints,但不要污染通用 OpenAI-compatible 主链路

验收标准:

- 连续两轮无工具结构变化时,system prompt hash 和 tools schema hash 不变
- 工具新增/修改时 snapshot 测试能明确提示 schema 变化
- context compression 不会导致 system/tools 前缀变化
- audit/debug 中可以看到 prefix hash 稳定

### P1.4 新增本地工具结果缓存

优先缓存只读工具:

- `read_file`
- `glob`
- `grep`

建议设计:

- 新增 `src/agent/cache.ts` 或 `src/tools/cache.ts`
- cache scope 默认为单 session 内存缓存
- 后续再考虑 `.agent/cache/` 磁盘缓存
- cache key 必须包含 cwd、工具名、参数、文件 fingerprint
- 写工具执行成功后统一触发 invalidation
- 缓存结果要进入审计事件,至少记录 hit/miss 和 key hash

缓存 key 建议:

```text
read_file:
  tool=read_file
  absPath
  offset
  limit
  stat.mtimeMs
  stat.size

glob:
  tool=glob
  cwd
  pattern
  dot/onlyFiles/options
  shortTTL

grep:
  tool=grep
  cwd
  pattern
  glob
  max_results
  fileSetFingerprint
```

失效规则:

- `write_file` 成功后,失效该 path 相关 `read_file`
- `edit_file` 成功后,失效该 path 相关 `read_file` 和可能覆盖它的 `grep`
- `delete_file` 成功后,失效该 path 相关 `read_file` / `glob` / `grep`
- 对 `glob` / `grep`,第一版可以采用短 TTL,例如 1-3 秒,避免复杂全量依赖追踪

验收标准:

- 相同 `read_file` 在文件未变时命中缓存
- 文件修改后 `read_file` 不返回旧内容
- 相同 `glob` 短时间内命中缓存
- 写入/删除后相关 `glob` 缓存失效或 TTL 到期
- cache hit/miss 有测试和 audit/debug 记录

### P1.5 新增摘要缓存和失败熔断

当前 `summarizeConversation` 在上下文压缩时会调用 LLM。长任务里如果中段历史相同,或 provider 连续失败,会浪费调用。

建议:

- 按 `model + compactInstructionsHash + middleMessagesHash + focusHash` 缓存摘要
- 单 session 内存缓存优先
- provider 摘要连续失败时,短时间熔断,直接走 `fallbackSummary`
- 熔断窗口例如 60 秒,避免每轮都打失败请求

验收标准:

- 相同 middle messages 第二次压缩不再调用 LLM summarizer
- compact instructions 改变后缓存失效
- model 改变后缓存失效
- summarizer 连续失败后进入短暂熔断
- 熔断期间仍能 fallback,不影响主 loop 继续工作

## P2: 长期使用体验

目标: 从单次工具变成可长期使用的本地 Agent。

### P2.1 会话持久化与恢复

建议:

- 保存到 `.agent/sessions/<sessionId>.json`
- 支持 `--resume <sessionId>`
- 审计日志关联 sessionId
- 压缩摘要和原始消息分开存储

验收标准:

- 中断后能恢复最近上下文
- 恢复时不重复注入 system prompt
- session 文件不破坏 cwd 沙箱

### P2.2 审计增强

建议:

- 审计事件记录真实 package version
- 记录工具确认 preview hash
- 记录配置摘要,避免泄露 API key
- 增加 `verifyChain` 的 CLI 包装命令

验收标准:

- 审计日志可独立验证
- 不记录敏感 key
- 版本、cwd、provider、model、limits 可追踪

### P2.3 发布闭环

建议:

- 增加 `npm pack` 检查脚本
- 增加 smoke test: `node dist/cli.js --help`
- 确认 `files` 字段或 `.npmignore`
- 更新 CHANGELOG
- 打 tag 前跑完整验证

验收标准:

- 从 npm tarball 安装后可运行
- README 安装步骤真实可复现
- `--version` 与 package version 一致

### P2.4 Subagent 架构准备

目标: 在不破坏当前单 agent 稳定性的前提下,为 multi-agent 做最小架构扩展。

建议新增模块:

```text
src/agent/subagents.ts
src/agent/subagentTypes.ts
src/agent/taskPlanner.ts
```

核心类型:

```ts
type SubagentRole = 'explore' | 'planner' | 'worker';

interface SubagentSpec {
  id: string;
  role: SubagentRole;
  goal: string;
  cwd: string;
  allowedTools: string[];
  readonly: boolean;
  fileScope?: string[];
  maxTurns: number;
  maxToolCalls: number;
}

interface SubagentResult {
  id: string;
  role: SubagentRole;
  status: 'ok' | 'error' | 'limit' | 'aborted';
  summary: string;
  evidence: Array<{ file?: string; line?: number; text: string }>;
  changedFiles: string[];
}
```

设计原则:

- 子 agent 默认只读
- 子 agent 必须有独立 limits
- 子 agent 必须有独立 audit span,但归属于同一个 sessionId
- 子 agent 不直接和用户交互,需要问用户时回传给 coordinator
- 子 agent 的结果必须结构化,不能只返回一段散文
- coordinator 负责最终回答和写入动作

验收标准:

- 可以手动创建一个只读 explore subagent
- explore subagent 只能调用只读工具
- 子 agent 超过 maxTurns / maxToolCalls 会停止
- 子 agent 事件能进入审计日志,带 parentAgentId / subagentId
- 主 agent 能拿到结构化 SubagentResult

### P2.5 只读 Explore Subagent MVP

目标: 先让多 agent 在“读代码/找信息”场景产生价值,不碰并发写入风险。

触发方式:

```text
/agents explore "分析 src/agent 目录职责"
/agents explore "找出所有配置读取入口"
```

或者主 agent 在大任务中自动派发:

```text
用户: 帮我评估整个项目架构并找出安全风险

coordinator:
  - explore-1: 审查 src/safety 和 src/tools
  - explore-2: 审查 src/agent 和上下文压缩
  - explore-3: 审查 src/audit 和配置
```

自动拆分触发条件建议:

- 用户任务明显包含多个独立目录或主题
- 预计需要读取超过 N 个文件,例如 15 个
- todo 数超过 5 个
- grep/glob 结果覆盖多个模块
- 用户明确说“全面评估”、“全项目”、“多个模块”、“并行”

限制:

- 第一版最多 3 个 subagent
- 每个 subagent 只读
- 每个 subagent 独立上下文最多 20k tokens
- 每个 subagent 最多 4 turns / 12 tool calls
- coordinator 合并结果后再决定是否进入写入阶段

验收标准:

- `/agents explore ...` 能跑一个只读子 agent
- 自动模式最多派发 3 个 explore subagent
- 多个 explore subagent 可并行运行
- UI 能显示 subagent 状态: queued / running / done / error
- 结果合并后主 agent 给出统一总结
- 子 agent 不污染主 messages,只把 summary/evidence 注入主上下文

### P2.6 Worker Subagent 写入模式

目标: 在 Explore MVP 稳定后,再允许多个 worker 并行处理不同文件范围。

建议先只支持显式用户批准:

```text
/agents split
```

或由主 agent 生成拆分计划后弹确认:

```text
将创建 2 个 worker:
1. worker-a: 修改 src/tools/*
2. worker-b: 修改 src/components/*

是否允许并行执行?
```

写入安全规则:

- 每个 worker 必须声明 fileScope
- fileScope 不能重叠
- worker 只能写 fileScope 内文件
- worker 不能删除文件,除非单独 dangerous confirm
- worker 完成后返回 changedFiles 和 summary
- coordinator 负责最终测试和冲突检查

验收标准:

- fileScope 重叠时拒绝并行 worker
- worker 写 scope 外文件会被 sandbox 拒绝
- 两个 worker 可并行修改不重叠目录
- changedFiles 汇总准确
- coordinator 最后运行验证命令或提示用户验证

### P2.7 Subagent UI 和命令

建议内置命令:

```text
/agents              查看当前 subagent 状态
/agents explore ...  创建只读 explore subagent
/agents stop <id>    停止某个 subagent
/agents stop-all     停止全部 subagent
/agents result <id>  查看某个 subagent 结果
/agents split        让 planner 生成拆分计划
```

UI 建议:

```text
Agents
  explore-1  running  src/safety risk scan       12s
  explore-2  done     config/provider review     4 files
  explore-3  error    audit review               maxTurns
```

验收标准:

- agent 状态不会刷屏
- 固定 TUI 布局中有 agents 状态区
- 子 agent 完成时有简短提示
- 用户可以中止子 agent

## 5. 建议执行顺序

1. 修 symlink sandbox 风险
2. 更新相关测试
3. 校准 README / SECURITY / CLI help / audit version
4. 做固定 TUI 布局 MVP,解决多轮对话持续向下滚动
5. 增加缓存命中率观测指标
6. 新增内置 slash command 分流
7. 实现 `/compact` 和压缩进度条
8. 设计并实现快捷配置入口 `/config` / `react-cli-agent config`
9. 新增白名单式验证命令工具
10. 优化 LLM prompt cache 稳定前缀
11. 增加只读工具结果缓存
12. 扩展 provider preset
13. 做会话持久化
14. 做 subagent 架构准备
15. 做只读 Explore subagent MVP
16. 做 Worker subagent 写入模式
17. 做发布前 npm pack 和 smoke test

## 6. 近期里程碑

### v0.2.1: 安全与文档修复版

范围:

- 修复 symlink sandbox 风险
- 文档、help、版本号一致
- 审计 `agentVersion` 不再硬编码
- 固定 TUI 布局 MVP:多轮对话不再持续推着终端向下滚
- 增加 prompt/tools/cache 相关 hash 和 hit/miss 观测
- 新增 slash command 分流
- 支持 `/compact` 手动压缩上下文
- 压缩时显示阶段式进度条
- 新增快捷配置设计:本地 Ollama / 在线 DeepSeek / 在线 MiniMax
- 测试保持全绿

### v0.3.0: 开发验证闭环版

范围:

- 实现 `react-cli-agent config` 和 `/config`
- Provider preset 支持 Ollama / DeepSeek / MiniMax
- 新增白名单式 `run_command` / `run_tests`
- Agent 修改代码后可自动跑测试和 typecheck
- 输出截断、超时、确认、安全测试齐全
- LLM prompt cache 稳定前缀优化
- 只读工具结果缓存 MVP

### v0.4.0: 可长期使用版

范围:

- 会话持久化
- `--resume`
- 审计增强
- 摘要缓存和 summarizer 失败熔断
- 更多 provider preset
- 发布流程稳定

### v0.5.0: Subagent 只读探索版

范围:

- Subagent 基础类型和生命周期
- `/agents explore ...`
- 最多 3 个只读 Explore subagent 并行
- 子 agent 独立 limits 和审计 span
- 主 agent 只接收 summary/evidence,不被子 agent 原始上下文污染

### v0.6.0: Subagent 自动拆分版

范围:

- Planner 生成结构化拆分计划
- 大任务自动建议拆分
- 用户确认后并行运行多个 Explore subagent
- UI 展示 agent 状态和结果

### v0.7.0: Worker Subagent 写入试点

范围:

- 显式确认后创建 worker subagent
- worker 必须声明 fileScope
- 禁止重叠写入范围
- coordinator 汇总 changedFiles 并运行验证

## 7. 当前最重要的一句话

项目已经有比较好的 Agent 雏形。下一步不要急着堆更多工具,应该先把“安全边界可信、文档可信、验证闭环可信”这三件事做扎实。
