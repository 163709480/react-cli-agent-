# Terminal Agent 下一步建议与功能详细设计

**日期**: 2026-06-05  
**范围**: 基于当前仓库源码、`README.md`、`docs/PROJECT.md` 以及 `docs/superpowers/*` 中已有规划做项目评估，并给出下一阶段功能设计。

**当前进展**:

- 已修复 `grep` 工具在 ripgrep 单文件输出下解析为空的问题。
- 已修正 `--yolo` 下 `dangerous` 工具仍需用户确认的安全语义。
- 已实现 `--provider deepseek` 配置链路，并补充 README / `.env.example`。
- 当前验证结果: `npm test` 55/55 通过，`npm run typecheck` 通过。

---

## 1. 项目理解

这是一个本地终端 ReAct agent，目标是提供类似 Claude Code / Gemini CLI 的开发者体验，但保持实现轻量、可控、可审计：

- **运行形态**: TypeScript + Ink 的终端 REPL，支持单次 headless prompt。
- **LLM 协议**: OpenAI Chat Completions 兼容协议，当前默认 DeepSeek。
- **Agent 核心**: 手写 ReAct 循环，流式接收 LLM 输出，按 tool_call 执行本地工具，再把工具结果回灌给 LLM。
- **工具集**: `read_file`、`write_file`、`edit_file`、`grep`、`glob`、`http_fetch`。
- **安全边界**: 不提供任意 shell 工具；文件路径必须限制在 `cwd`；写文件受后缀白名单和确认机制保护。
- **当前规模**: `src/` 约 1900 行 TypeScript/TSX，测试 55 个用例。

项目当前已经具备 v0.1 的核心闭环：能对话、能读写文件、能搜索、能请求 HTTP、能做基础沙箱和确认。

---

## 2. 当前规划核验

### 2.1 已完成的基础规划

`docs/superpowers/specs/2026-06-04-terminal-agent-design.md` 和 `docs/superpowers/plans/2026-06-04-terminal-agent.md` 中的大部分基础功能已经落地：

- ReAct 主循环已在 `src/agent/loop.ts` 实现。
- 流式封装已在 `src/llm/stream.ts` 实现。
- 6 个工具已在 `src/tools/` 实现。
- 沙箱已在 `src/safety/sandbox.ts` 实现。
- UI 状态机已在 `src/app.tsx` 和 `src/components/` 实现。
- 上下文压缩框架已在 `src/agent/context.ts` 实现，但 summarizer 仍是占位实现。

### 2.2 `--provider` 规划状态

`docs/superpowers/specs/2026-06-05-deepseek-provider-flag-design.md` 和对应 plan 已经写到可执行任务级别。本次继续工作中已完成落地：

- `src/llm/providers.ts` 新增 provider 预设表，当前支持 `deepseek`。
- `src/config.ts` 支持 `loadConfig({ provider })`，provider 覆盖 baseUrl/model。
- `src/cli.tsx` 支持 `--provider`，未知 provider 在 Ink render 前报错并 `exit 2`。
- `src/app.tsx` 支持接收 CLI 预解析的 `config`，避免 provider 配置丢失。
- 新增 `providers.test.ts` / `config.test.ts` 共 8 个测试。

判断：provider 链路已达到最小可用状态。后续增加 Ollama / Moonshot / OpenAI 只需要扩展预设表并补对应测试。

### 2.3 当前基线状态

本次核验结果：

- `npm run typecheck`: 通过。
- `npm test`: 55/55 通过。

已修复的历史失败点：

```text
src/__tests__/tools/grep.test.ts > grep > 在文本文件里匹配(无 rg 时回退 grep)
expected 0 to be greater than or equal to 2
```

原因：`src/tools/grep.ts` 对 `rg` 输出统一按 `file:line:text` 解析，但逐文件执行 `rg pattern file` 时，ripgrep 可能输出 `line:text`，不带文件名前缀，导致匹配行被丢弃。当前实现已兼容两种格式。

### 2.4 发现的安全语义偏差

已有文档和 `runTurn` 的意图是：`--yolo` 只跳过 `confirm` 工具，`dangerous` 工具仍需确认。

此前 `src/app.tsx` 的 `onConfirm` 在 `yolo` 为 true 时直接 `resolve(true)`，因此即使 `runTurn` 对 `dangerous` 工具仍调用 `onConfirm`，UI 层也会自动放行。该偏差已经修复，当前策略为：

- `write_file` / `edit_file`: yolo 放行。
- `http_fetch`: yolo 下仍需确认。

判断：安全策略已与文档和 loop 设计一致。

---

## 3. 下一步优先级建议

### P0: 可信基线(已完成)

1. **修复 `grep` 工具解析，恢复测试全绿**
   - 支持 `file:line:text` 和 `line:text` 两种输出。
   - 统一返回相对 `cwd` 的文件路径，减少绝对路径泄漏和 UI 噪音。
   - 增加测试覆盖 ripgrep 单文件输出格式。

2. **修正 `--yolo` 与 `dangerous` 工具的确认语义**
   - `runTurn` 已有正确分层：`yolo && tool.safety !== 'dangerous'` 才降级为 safe。
   - `App` 层不要因为 `yolo` 直接确认所有工具。
   - 增加测试：`dangerous` 工具在 yolo 下仍调用 `onConfirm`。

这两项先做的原因：它们属于“现有承诺不成立”。继续做新功能前，应先保证测试基线和安全边界可信。

### P1: 已完成的产品化能力

3. **落地 `--provider <name>`**
   - 价值明确：降低 DeepSeek / Moonshot / Ollama 等兼容服务的接入成本。
   - 风险低：不改 agent loop，不改 stream，不改 tool 协议。
   - 当前支持 `deepseek`，未知 provider 会启动期报错并 exit 2。

### P1: 剩余高价值能力

4. **补齐真实 summarizer**
   - 当前压缩框架存在，但 `runTurn` 里用 `text.slice(0, 200) + '...'` 占位。
   - 一旦用户进行长会话或大文件工具调用，压缩质量会直接影响任务连续性。

5. **增加资源护栏**
   - 建议增加 `--max-turns`、`--max-tool-calls`、`--max-output-chars`。
   - 成本护栏 `--max-cost` 可以后置，因为不同 provider usage 返回不稳定。

### P2: 扩展类功能

6. **会话持久化**
   - 将 `.agent/sessions/*.json` 作为本地状态存储，支持 `--resume`。
   - 适合在上下文压缩稳定后做。

7. **安全的 `run_tests` 工具**
   - 不开放任意 shell，只允许配置文件中声明的白名单命令，例如 `npm test`、`npm run typecheck`。
   - 对开发类 agent 价值很高，但需要严格命令白名单和超时控制。

8. **Web UI / 多 agent**
   - 当前阶段不建议优先做。
   - 先把单 agent 的安全、上下文、配置、验证跑稳，再扩展交互形态或调度模型。

---

## 4. 下一阶段功能详细设计: v0.2 稳定运行与配置体验

### 4.1 v0.2 目标

v0.2 的核心目标不是扩大工具数量，而是让现有 agent 更可靠、更可配置、更适合真实项目使用：

- 测试全绿，基础工具行为稳定。
- 安全确认语义和文档一致。
- 用户能通过 `--provider` 显式选择内置 provider。
- 长上下文时能进行真实摘要压缩。
- 单轮任务有基本资源上限，避免失控循环。

### 4.2 非目标

- 不新增任意 shell 工具。
- 不引入 LangChain / Vercel AI SDK 等 agent 框架。
- 不在 v0.2 做 multi-agent。
- 不在 v0.2 做 Electron / Tauri / Web UI。
- 不改变现有 OpenAI Chat Completions 协议主线。

---

## 5. 功能 A: 基线修复包

### 5.1 A1: `grep` 输出解析修复

**问题**

`grepTool` 当前逐文件调用 `rg`，但解析器只接受 `file:line:text`。在单文件场景下，`rg -n --no-heading pattern file` 可能输出 `line:text`。测试创建了单个文件，因此解析结果为空。

**设计**

新增一个内部解析函数：

```ts
function parseSearchLine(line: string, currentFile: string): { file: string; line: number; text: string } | null
```

解析顺序：

1. 优先匹配 `file:line:text`。
2. 如果失败，再匹配 `line:text`。
3. 第二种格式使用当前正在搜索的 `currentFile` 补齐 file。
4. 输出 file 建议统一转成相对 `ctx.cwd` 的路径。

**边界条件**

- 文本内容里可能包含冒号，只按前两个字段拆。
- 文件路径本身可能包含冒号，macOS/Linux 常规路径影响较小；如需更稳，可让 `rg` 输出 JSON，但当前项目保持轻量即可。
- `rg` exit code 1 表示无匹配，不应当抛 ToolError。

**测试**

- 单文件匹配：期望返回两条 `hello`。
- glob 过滤：现有测试保持。
- 解析 `line:text` 格式。
- 解析 `file:line:text` 格式。

### 5.2 A2: `dangerous` 工具确认语义修复

**问题**

`runTurn` 已经区分：

```ts
const effectiveSafety = yolo && tool.safety !== 'dangerous' ? 'safe' : tool.safety;
```

但 `App` 传入的 `onConfirm` 在 `yolo` 为 true 时直接返回 true，导致 dangerous 工具仍被自动确认。

**设计**

将“是否因为 yolo 跳过确认”的逻辑只放在 `runTurn` 内，`App.onConfirm` 始终只表达真实用户确认：

- 移除 `App.onConfirm` 内的 `if (yolo) resolve(true)`。
- 由 `runTurn` 决定哪些工具需要调用 `onConfirm`。
- `dangerous` 工具在 yolo 下仍会调用 `onConfirm`。

**测试**

- 现有 `--yolo 跳过 confirm 类工具的确认` 保持。
- 新增 `--yolo 不跳过 dangerous 工具确认`：
  - stub 工具 safety 为 `dangerous`。
  - yolo true。
  - 断言 `onConfirm` 被调用一次。
  - `onConfirm` 返回 false 时，工具不执行，tool message 为 declined。

---

## 6. 功能 B: `--provider <name>` 显式 Provider 选择

### 6.1 用户价值

当前默认是 DeepSeek，但用户只能通过 `OPENAI_BASE_URL` / `OPENAI_MODEL` 间接配置。`--provider` 让常用 provider 以名字选择，降低配置错误率，也让 README 更直观。

### 6.2 CLI 行为

```bash
npm run dev -- --provider deepseek
npm run dev -- --provider deepseek "列出 src 下的 TypeScript 文件"
```

优先级：

1. `--provider <name>` 覆盖 baseUrl + model。
2. `OPENAI_BASE_URL` / `OPENAI_MODEL`。
3. `~/.agent/config.json`。
4. 内置默认。

API key 不受 provider 影响，仍通过 `OPENAI_API_KEY` 或 config 文件读取。

### 6.3 模块设计

新增 `src/llm/providers.ts`：

```ts
export interface ProviderPreset {
  baseUrl: string;
  defaultModel: string;
}

const PROVIDERS: Record<string, ProviderPreset> = {
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat' },
};
```

导出：

- `listProviderNames(): string[]`
- `resolveProvider(name: string): ProviderPreset`

修改 `src/config.ts`：

- `loadConfig(opts: { provider?: string } = {})`
- 有 provider 时调用 `resolveProvider`。
- 没有 provider 时保持原有 env / json / default 行为。

修改 `src/cli.tsx`：

- `parseArgs` 支持 `--provider`。
- `.env` 加载后、Ink render 前解析 config。
- provider 错误直接 `stderr` + `exit(2)`，不进入 TUI。

修改 `src/app.tsx`：

- `AppProps` 增加 `config?: Config`。
- CLI 已经传入 config 时，App 不再重复 `loadConfig()`。
- 保留 fallback，方便未来测试或其他入口直接渲染 `App`。

### 6.4 错误处理

| 场景 | 行为 |
|---|---|
| `--provider deepseek` | 使用 DeepSeek baseUrl + defaultModel |
| `--provider ollama` 且未预置 | stderr 输出 `Unknown --provider "ollama". Available: deepseek`，exit 2 |
| provider 正确但 key 缺失 | 沿用 `createOpenAIClient` 的现有错误提示 |
| 重复 provider | 取最后一个，保持与 `--cwd` 类似的简单规则 |

### 6.5 测试

- `providers.test.ts`
  - `listProviderNames()` 包含 `deepseek`。
  - `resolveProvider('deepseek')` 返回预期 baseUrl/model。
  - 未知 provider 抛错且错误信息含可用列表。
- `config.test.ts`
  - provider 覆盖 env 中的 baseUrl/model。
  - 不传 provider 时原行为不变。
  - API key 仍从 env 读取。
- CLI smoke
  - `npm run dev -- --provider ollama "hi"` 立即 exit 2。
  - `OPENAI_API_KEY=sk-fake npm run dev -- --provider deepseek "hi"` 不报 unknown provider。

---

## 7. 功能 C: 真实上下文摘要压缩

### 7.1 问题

当前 `compress()` 支持注入 summarizer，但 `runTurn` 实际传的是占位实现：

```ts
text.slice(0, 200) + '...'
```

这会丢失任务状态、文件名、用户约束、已执行工具结果等关键信息。长会话中，agent 容易忘记上下文或重复工作。

### 7.2 设计

新增 `src/agent/summarizer.ts`：

```ts
export interface SummarizeInput {
  client: OpenAI;
  model: string;
  text: string;
  signal: AbortSignal;
}

export async function summarizeConversation(input: SummarizeInput): Promise<string>
```

摘要 prompt 要求：

- 保留用户目标、明确约束、已改文件、未完成事项。
- 保留关键错误和用户拒绝过的动作。
- 保留工具结果中的路径、命令、状态码、测试结果摘要。
- 输出控制在 800 到 1200 中文字以内。

`runTurn` 改为：

- 触发 `shouldCompress` 后调用真实 summarizer。
- summarizer 失败时，不静默吞掉；应回退到保守截断摘要，并向 UI 发出 `[context compression fallback]`。
- 压缩后的 summary message 保持 `role: 'user'`，沿用当前结构。

### 7.3 资源控制

新增配置：

- `AGENT_SUMMARY_MODEL` 可选，不设置时使用主模型。
- `AGENT_SUMMARY_MAX_CHARS` 默认 24000，避免把超大工具结果直接塞给 summarizer。

### 7.4 测试

- mock OpenAI completion，验证 summarizer 被调用。
- summarizer 失败时 fallback 生效。
- summary 包含固定前缀 `[Summary of earlier conversation]`。
- 压缩后保留 system + summary + 最近 6 条。

---

## 8. 功能 D: 资源护栏

### 8.1 用户价值

ReAct agent 可能因为模型误判进入多轮工具循环。当前没有轮数、工具数、输出长度上限。建议先做 provider 无关、成本无关的硬限制。

### 8.2 CLI 与配置

新增 CLI：

```bash
npm run dev -- --max-turns 8 --max-tool-calls 20 "修复测试"
```

新增 env / config：

- `AGENT_MAX_TURNS`，默认 12。
- `AGENT_MAX_TOOL_CALLS`，默认 30。
- `AGENT_MAX_TOOL_RESULT_CHARS`，默认 100000。

### 8.3 类型设计

`RunTurnInput` 增加：

```ts
limits?: {
  maxTurns?: number;
  maxToolCalls?: number;
  maxToolResultChars?: number;
}
```

`RunTurnResult` 增加：

```ts
metrics?: {
  llmTurns: number;
  toolCalls: number;
}
```

### 8.4 行为

- 每次请求 LLM 算 1 个 `llmTurns`。
- 每个 tool_call 算 1 个 `toolCalls`。
- 超限时停止 loop，向 UI 发 `error` 或 `done: 'error'`，并在最终 assistant 文本中说明达到限制。
- tool result 统一通过 helper 截断，避免某个工具输出把上下文撑爆。

### 8.5 测试

- 达到 maxTurns 后停止。
- 达到 maxToolCalls 后不再执行后续工具。
- 超长 tool result 被截断并带 `[...truncated...]`。
- 默认值不影响现有测试。

---

## 9. 建议实施顺序

### Sprint 0: 基线修复

1. 修复 `grep` 解析，跑 `npm test`。
2. 修复 dangerous + yolo 语义，补测试。
3. 更新文档中关于 yolo 的描述，确保 README / PROJECT / 代码一致。

验收：

- `npm test` 全绿。
- `npm run typecheck` 通过。
- `http_fetch` 在 yolo 下仍需要用户确认。

### Sprint 1: Provider 体验

1. 新增 `src/llm/providers.ts`。
2. 扩展 `loadConfig({ provider })`。
3. `cli.tsx` 解析 `--provider`，render 前校验。
4. `App` 接收可选 config。
5. 更新 README 和 `.env.example`。

验收：

- 新增 provider/config 测试通过。
- 未知 provider exit 2。
- 默认行为兼容现有 `.env` 用法。

### Sprint 2: 长上下文可靠性

1. 新增真实 summarizer。
2. 加 summary prompt 测试和 fallback 测试。
3. 增加 summary 字符预算。

验收：

- 长会话压缩后仍保留任务状态。
- summarizer 失败不导致 runTurn 失败。

### Sprint 3: 资源护栏

1. 增加 `limits` 类型和配置读取。
2. loop 统计 turns/tool calls。
3. tool result 统一截断。

验收：

- 超限可预测停止。
- 用户能通过 CLI 调整限制。

---

## 10. 不建议现在做的事

- **任意 shell 工具**: 与当前项目安全定位冲突。未来如需跑测试，应做白名单 `run_tests`，而不是开放 shell。
- **multi-agent**: 当前单 agent 的确认、安全、上下文还没完全稳定，过早调度会放大问题。
- **Web UI**: 交互层可后置。当前更需要让核心 loop 和工具行为可靠。
- **复杂 provider 抽象**: 只要继续走 OpenAI 兼容协议，provider preset 表足够，不需要工厂模式或多 SDK 适配层。

---

## 11. 风险清单

| 风险 | 影响 | 缓解 |
|---|---|---|
| `grep` 工具曾因 ripgrep 输出格式返回空结果 | 基础搜索工具不可完全信任 | 已修复解析并补测试 |
| yolo 曾放行 dangerous 工具 | 网络副作用风险被低估 | 已修正确认语义并补测试 |
| summarizer 占位 | 长任务丢上下文 | P1/P2 替换为真实摘要 |
| 无资源上限 | 可能长时间循环或输出过大 | 增加 maxTurns/maxToolCalls |
| `docs/PROJECT.md` 未跟踪 | 项目文档可能未进入版本管理 | 确认是否纳入 git |

---

## 12. 结论

当前已经完成“基线修复 → provider 体验”。下一步建议继续按“上下文可靠性 → 资源护栏 → 会话持久化 / run_tests”的顺序推进。

最小有效 v0.2 当前已包含：

- 修复 `grep` 测试失败。
- 修复 `--yolo` 对 dangerous 工具的误放行。
- 实现 `--provider deepseek`。

下一组建议纳入 v0.2 或 v0.3：

- 替换上下文压缩占位 summarizer。
- 增加基础资源护栏。

这样能把项目从“能跑的原型”推进到“可重复验证、边界清晰、适合日常开发使用”的本地终端 agent。
