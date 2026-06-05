# Changelog

All notable changes to this project will be documented in this file.
Format: roughly [Keep a Changelog](https://keepachangelog.com/).

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
