# Changelog

All notable changes to this project will be documented in this file.
Format: roughly [Keep a Changelog](https://keepachangelog.com/).

## [0.2.1] - 2026-06-08

### Security
- **修复 symlink sandbox 逃逸** —— `resolveWithinCwd` 在路径不存在时只对最终路径 realpath 失败回退字面路径,被 `cwd/link -> /outside; write link/new.md` 绕过。改为逐级 realpath 最近祖先再拼回尾部,堵住多级 symlink 链。新增 3 个测试覆盖(直接 symlink 目录、多级链)。`src/safety/sandbox.ts`。

### Fixed
- `agentVersion` 不再硬编码 `'0.1.0'`,由 CLI 从 `package.json` 读取并通过 `App` props 注入(`src/cli.tsx` + `src/app.tsx`)。审计事件里现在能反映真实包版本。
- CLI help 环境变量从 `AGENT_PROVIDER / AGENT_MODEL / AGENT_API_KEY / AGENT_BASE_URL`(旧且不准确)改为 `OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL / AGENT_PROVIDER`,与 `loadConfig()` 实际读取的 env 一致。
- `--allow-mutations` help 描述从"允许修改文件"改为"允许 HTTP POST 等副作用请求(写文件不受此选项控制)"。
- README test badge `142 passed` → `183 passed`;正文"123 个测试,21 个文件" → "183 个测试,30 个文件"。
- SECURITY.md `Supported versions`: `0.1.x` (current) → `0.2.x` (current),`0.1.x` 移入 unsupported 列。
- `docs/PROJECT.md` 两处 summarizer 过期描述(原"占位实现")更新为"真 LLM 摘要 + fallback"。

### Added
- **固定 TUI 布局 MVP** —— `useStdout` 拿终端行数 + 监听 resize,给 conversation viewport 算固定 `height`,多轮对话不再把 input 推到屏幕外。`MessageList` 新增 `maxMessages` prop,超出尾部裁剪,顶部显示 `... N earlier messages ...`。`src/components/MessageList.tsx` + `src/app.tsx`。
- **LLM 前缀指纹观测** —— 每次 LLM call 前 auditSink 发出 `llm_call` 事件,带 `systemPromptHash / toolsSchemaHash / messagePrefixHash / approxPromptTokens`(16 位 hex,稳定键排序)。便于观察 provider 侧 prompt cache 命中率。`src/agent/loop.ts`。
- **内置 slash command** —— `src/agent/commands.ts` 新模块 + `parseBuiltinCommand()` + `BUILTIN_COMMAND_LIST`。支持 `/compact /status /clear /reset /help`,未知 `/xxx` 不进 LLM,直接显示错误。
- **手动 `/compact` + 阶段进度条** —— `compactMessages()` 包装 + 5 阶段进度事件(`estimating 10% → loading_instructions 25% → summarizing 40% → rebuilding 75% → done 100%`)。fallback 时显示 `fallback used`,消息太少显示 `nothing to compact`。`src/agent/context.ts` + `src/components/CompactProgressBar.tsx` + `src/app.tsx`。
- **快捷配置入口** —— `react-cli-agent config [--provider X] [--show]`,持久化到 `~/.agent/config.json`(权限 0600),不持久化 API key(仍走 env)。Provider 三个 preset:`ollama` (本地,占位 key) / `deepseek` (在线) / `minimax` (在线,带 notes 提示核对文档)。`src/llm/providers.ts` + `src/agent/userConfig.ts` + `src/cli-config.ts`。
- **SessionState.reset()** —— `/reset` 内部使用,清空 todos 并触发 onChange。
- 新测试 32 个(`sandbox` 3、`MessageList` 5、`loop` 2(更新+新)、`commands` 10、`context.compactMessages` 4、`providers` 4、`userConfig` 6),合计 180 → 212。

## [0.4.0] - 2026-06-06

### Added
- **TodoWrite 工具**(`todo_write`)——LLM 可在多步任务中维护 1-7 条任务清单,会话级 state,UI 实时渲染。
- **AskUserQuestion 工具**(`ask_user_question`)——LLM 可弹出 2-4 选项的单/多选题,等用户决策。独立 Ink 组件 + useInput 路由。
- **System Prompt 注入**——`src/agent/systemPrompt.ts` 在每轮会话开始时注入行为指引(TodoWrite / AskUserQuestion 使用建议)。
- **SessionState**——`src/agent/sessionState.ts` 提供 session 级 mutable state 通道(`SessionState.todos` + `onChange`)。
- **3 个新 AgentEvent 变体**:`todo_updated` / `ask_user` / `ask_user_resolved`(`audit/sink.ts` 同步扩展 exhaustive switch)。
- **新组件**:`AskUserDialog` (Ink 弹窗) + `TodoList` (会话顶部持续显示)。
- 新测试:sessionState 4 例、systemPrompt 4 例、todo_write 6 例、ask_user_question 5 例、AskUserDialog 4 例,共 23 新增(154 → 180)。

### Changed
- `RunTurnInput` 加 2 个必填字段:`sessionState` + `onAskUser`。`ToolCtx` 加 `sessionState` 字段。
- `loop.test.ts` 引入 `baseRunTurnArgs` helper,统一给所有 `runTurn({...})` 调用注入 `sessionState` + `onAskUser` 默认值。
- 发现一个 tsconfig 缺口:`src/__tests__/**` 被 exclude,导致测试里漏传必填字段不会被 tsc 抓到(后续 v0.5 可以单独加 lint rule 修)。

## [0.3.0] - 2026-06-06

### Added
- **工具并发分区**——参考 Claude Code `partitionToolCalls` 模式。`read_file` / `glob` / `grep` 现在可在同一轮 LLM 响应中并发执行(parallel within a batch);`write_file` / `edit_file` / `delete_file` / `http_fetch` 仍按调用顺序串行,避免"读到了写之前的数据"。
- 新模块 `src/agent/partition.ts` 暴露 `partitionToolCalls(toolCalls, tools)` 和 `isToolConcurrencySafe(call, tools)` —— 编排器可独立复用。
- `ToolDef.concurrencySafe?: boolean` 字段(可选,默认 false,严格 fail-closed)。
- 新测试:partition 7 例、tools-safety 2 例、types 2 例、loop 并发 1 例,共 12 新增。

### Changed
- `loop.ts` 的工具执行从"一次响应一个 tool call 串行"改为"按 partition 切批 + 批内 `Promise.all`",消息顺序与 LLM 返回顺序保持一致(由 `Promise.all` 的数组顺序保证)。
- L1 mid-turn 压缩从"每个 tool 后做一次"挪到"整个 tool 批后做一次"(在 batch 内部不再做 compress,避免并发打架)。
- 新增 L3 over-run 守门(`toolCallCount > maxToolCalls`),捕获单批内 N 个并发 tool 一次推过预算的边界情况。

## [0.2.0] - 2026-06-06

### Added
- **Context compression v2: 4-layer defense**
  - L1 mid-turn incremental compression (fires after each `tool_call_end` when `shouldCompress` is true)
  - L2 turn guard (`maxTurns`, default 12) — emits `error` + `done: 'limit'` and exits the loop
  - L3 tool guard (`maxToolCalls`, default 30) — same exit path, but triggered by tool execution count
  - L4 hot cut (`hotCut(messages, maxContextTokens)`) — best-effort pre-LLM truncation of old tool messages (sets content to `[truncated for context window]` marker; preserves `id`/`role`/`tool_call_id` for reference continuity)
- New `compressing` phase in `AgentEvent` and `HeadStatus` UI — shows `before → after (X% reduction) tokens · duration`
- `RunTurnInput.limits?` (`maxTurns?` / `maxToolCalls?`)
- `RunTurnResult.metrics?` (`llmTurns` / `toolCalls` / `compressions` / `hotCuts`)
- New `finishReason: 'limit'` (distinct from `'error'` so UI/audit can tell "model stopped" from "resource exhausted")
- CLI flags `--max-turns` and `--max-tool-calls`
- Env vars `AGENT_MAX_TURNS` and `AGENT_MAX_TOOL_CALLS`
- `Config.maxTurns` and `Config.maxToolCalls` (also via `~/.agent/config.json`)

### Changed
- `shouldCompress()` accepts optional `thresholdMultiplier` (default `0.7`, behavior preserved)
- `compress()` and `hotCut()` early-return paths now return shallow copies (not the input array reference), preventing a latent aliasing bug where `loop.ts` mutation could wipe the messages array

### Fixed
- `loop.ts` mutation of `messages` after `compress()` no longer wipes the conversation when `compress()` early-returns on `messages.length <= 7` (was a latent v0.1 bug, now reachable in v2 with default `maxContextTokens` and large pasted prompts)

## [0.1.0] - 2026-06-05

### Added
- **Compliance audit log** — JSONL + SHA-256 hash chain, written by default to
  `~/.agent/audit/<sessionId>.jsonl`. CLI flags `--audit-log` / `--no-audit-log`.
  Independent verification via `npx tsx src/audit/verifyChain.ts <file>`.
- **Provider presets** — `--provider deepseek` flag; extensible
  (`src/llm/providers.ts`).
- **Dangerous-tool confirmation UI** — `DangerousConfirmBox` with red double
  border + ⚠ + change preview (old/new content, URL+method, etc.). You **must
  type `y`** to confirm; `Enter` alone does nothing.
- **`delete_file` tool** — `safety=dangerous`, refuses directories,
  supports `DangerousConfirmBox` preview.
- **Real summarization** — long sessions trigger an actual LLM-driven
  summary with a conservative truncation fallback.
- **Claude Code-style status bar** — `HeadStatus` shows "Thinking for Ns" /
  "Reading…" with internal `setInterval` for elapsed time.
- **Welcome screen** with Unicode rose art.
- **CHANGELOG.md / CONTRIBUTING.md / SECURITY.md** /
  **`.github/ISSUE_TEMPLATE/` / `.github/PULL_REQUEST_TEMPLATE.md`**
- **CI workflow** — `.github/workflows/ci.yml` runs `typecheck` + `test`
  on Node 20/22 across ubuntu / macos / windows.

### Changed
- `App` component rewritten around a cleaner state machine
  (`phase` / `activeTool` / `tokens`).
- `ToolTrace` removed in favor of `ActiveToolLine` (single-line, dynamic).
- `glob` tool rejects absolute patterns up front (was returning
  misleading "Path escapes cwd" error).
- `package.json` → `private: false`, license `AGPL-3.0`, Node engine `>=20`.

### Fixed
- `--yolo` no longer auto-confirms `dangerous` tools (regression test added).
- `grep` handles both `file:line:text` and `line:text` ripgrep output formats.
- `loop.test.ts` `afterEach` cleans `mkdtemp` directories to avoid `/tmp` pollution.

### Security
- File paths constrained to `cwd` (realpath-aware, macOS symlink-safe).
- Write-extension allowlist (default: `.md .ts .tsx .js .jsx .json .yaml .yml .toml .txt`).
- No arbitrary shell tool by design.
- `OPENAI_API_KEY` required; no anonymous access.

### Stats
- 21 test files, 123 tests
- ~3500 lines of TypeScript/TSX
- 0 runtime dependencies added by audit / safety features
