# Changelog

All notable changes to this project will be documented in this file.
Format: roughly [Keep a Changelog](https://keepachangelog.com/).

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
