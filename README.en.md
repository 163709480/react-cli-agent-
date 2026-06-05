# react-cli-agent

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Node](https://img.shields.io/badge/node-%E2%89%A520.0.0-brightgreen.svg)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-123%20passed-brightgreen.svg)](#testing)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue.svg)](https://www.typescriptlang.org/)

A local terminal **ReAct agent** built from scratch in TypeScript + Ink.
Connects to any OpenAI-compatible LLM (DeepSeek / Moonshot / Ollama / vLLM / …).
Inspired by Claude Code / Gemini CLI, but with no LangChain / Vercel AI SDK — the
ReAct loop, tool calling, streaming, and audit logging are all hand-written.

[中文文档](README.md) · [Design docs](docs/) · [License (AGPL-3.0)](LICENSE)

---

## ✨ Features

- **Hand-written ReAct loop** — no agent framework, full control over behavior
- **Streaming UX** — type-by-type text, dynamic tool status, Claude Code-style status bar
- **File sandbox** — paths constrained to `cwd`, write-extension allowlist, realpath symlink resolution
- **Dangerous-tool confirmation** — `write_file` / `edit_file` / `delete_file` / `http_fetch` show
  a **prominent confirm box** (red double border + ⚠ + diff preview). The user **must type `y`**
  to confirm; `Enter` alone does nothing.
- **Compliance audit log** — every session writes a tamper-proof **JSONL with SHA-256 hash chain**
  to `~/.agent/audit/<sessionId>.jsonl` by default. Auditors can independently verify with
  `npx tsx src/audit/verifyChain.ts <file>`.
- **Provider-agnostic** — OpenAI Chat Completions protocol. Switch providers via `--provider deepseek`
  or just `OPENAI_BASE_URL`.
- **Real summarization** — long sessions trigger a real LLM-driven summary; fallback to a
  conservative truncation if it fails.

---

## 📦 Install

```bash
git clone https://github.com/<owner>/react-cli-agent.git
cd react-cli-agent
npm install
cp .env.example .env
$EDITOR .env       # set OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL
```

Requires **Node.js ≥ 20**.

---

## 🚀 Usage

### Interactive REPL

```bash
npm run dev
```

Type a task, hit Enter. The agent will:
1. Stream LLM response token by token
2. Decide whether to call a tool (read_file / grep / glob / write_file / …)
3. Show a confirmation box for any destructive operation
4. Loop until the LLM signals `stop`

### Single-shot headless

```bash
npm run dev -- "List all TypeScript files under src/"
```

### Common flags

| Flag | Effect |
|---|---|
| `--yolo` | Skip confirmation for `confirm` tools. `dangerous` tools still require `y`. |
| `--allow-mutations` | Permit `http_fetch POST` and other mutation effects |
| `--provider <name>` | Pick a built-in provider preset (e.g. `deepseek`) |
| `--cwd <path>` | Override the working directory |
| `--audit-log <path?>` | Write audit log to `<path>` (omit value for default `~/.agent/audit/`) |
| `--no-audit-log` | Disable audit log entirely (dev scenario) |
| `-- "prompt"` | Positional prompt = headless mode, exit after one turn |

### Examples

```bash
# Default: DeepSeek, audit log on
npm run dev -- "List src/agent directory"

# Write a file (will show red confirm box)
npm run dev -- "Create README.md describing this project"

# HTTP fetch (dangerous, always confirms)
npm run dev -- --allow-mutations "POST https://api.example.com/webhook with body {...}"

# Disable audit
npm run dev -- --no-audit-log "Quick question"
```

---

## 🛠 Tools

| Tool | Safety | Function |
|---|---|---|
| `read_file` | safe | Read a file (1MB truncation, offset/limit) |
| `write_file` | confirm | Full overwrite, auto `mkdir -p` |
| `edit_file` | confirm | String replace, `old_string` must be unique |
| `grep` | safe | ripgrep preferred, grep fallback |
| `glob` | safe | fast-glob |
| `http_fetch` | **dangerous** | GET/POST, 100KB truncation |
| `delete_file` | **dangerous** | Permanent delete (refuses directories) |

> `safe` tools never prompt. `confirm` tools show a yellow bordered box.
> `dangerous` tools show a **red double-bordered box with `⚠ DANGEROUS ACTION`**
> and a full change preview (old/new content, URL+method, etc.). You **must
> type the letter `y`** to confirm — the `Enter` key does nothing.

---

## 📋 Compliance Audit

Every session produces a tamper-proof **JSONL** with a SHA-256 hash chain.

```bash
# Default location
~/.agent/audit/<sessionId>.jsonl

# Custom path
npm run dev -- --audit-log /var/log/agent/x.jsonl "..."

# Disable
npm run dev -- --no-audit-log "..."
```

Event types: `session_start` / `user_prompt` / `phase` / `text_delta` /
`tool_call_start` / `user_confirm` / `tool_call_end` / `llm_usage` / `done` /
`error` / `session_end`.

### Auditor verification

```bash
npx tsx src/audit/verifyChain.ts <path-to-jsonl>
# { ok: true, lines: <N> }           exit 0
# { ok: false, lines: <N>, firstBreakSeq: <S>, reason: "<R>" }   exit 1
```

Failure reasons: `hash-mismatch` (payload tampered), `prev-hash-mismatch`
(previous row tampered), `non-monotonic-seq` (row deleted),
`parse-error` (malformed JSON), `missing-field` (hash/prevHash/seq absent).

### Reading logs

```bash
# Tool calls + user confirmations
jq -c 'select(.type=="tool_call_start" or .type=="tool_call_end" or .type=="user_confirm")' <file>

# LLM token usage
jq -c 'select(.type=="llm_usage") | {ts, callIndex, promptTokens, completionTokens, finishReason}' <file>
```

Full design: [`docs/superpowers/specs/2026-06-05-audit-log-design.md`](docs/superpowers/specs/2026-06-05-audit-log-design.md).

---

## ⚙️ Configuration

Priority: `CLI flag` > `env var` > `~/.agent/config.json` > built-in default.

| Key | Env var | Default |
|---|---|---|
| `openaiApiKey` | `OPENAI_API_KEY` | (required) |
| `openaiBaseUrl` | `OPENAI_BASE_URL` | `https://api.deepseek.com/v1` |
| `openaiModel` | `OPENAI_MODEL` | `deepseek-chat` |
| `maxContextTokens` | `AGENT_MAX_CONTEXT_TOKENS` | `120000` |
| `maxTurns` | `AGENT_MAX_TURNS` | `12` |
| `maxToolCalls` | `AGENT_MAX_TOOL_CALLS` | `30` |
| `writeableExts` | (config file only) | `['.md','.ts','.tsx','.js','.jsx','.json','.yaml','.yml','.toml','.txt']` |

Example `~/.agent/config.json`:

```json
{
  "openaiModel": "deepseek-chat",
  "maxContextTokens": 120000,
  "writeableExts": [".md", ".ts", ".json"]
}
```

---

## 🧪 Testing

```bash
npm test           # 123 tests across 21 files
npm run typecheck  # tsc --noEmit, must be clean
```

---

## 🏗 Architecture

```
UI layer (Ink + React)
  src/cli.tsx → src/app.tsx → src/components/*
                ↓ AgentEvent
Agent core (hand-written ReAct)
  src/agent/loop.ts ← src/agent/context.ts (compress)
  src/agent/schema.ts (zod → JSON Schema)
  src/agent/tools.ts (registry)
                ↓
LLM adapter ───── Tools ───── Sandbox
  src/llm/         src/tools/   src/safety/
  (OpenAI compat)  (6+1 tools)  (path/extension)
                ↓
Audit (compliance)
  src/audit/  (canonical JSON, SHA-256 hash chain, JSONL sink)
```

Design docs in [`docs/superpowers/`](docs/superpowers/).

---

## 🤝 Contributing

PRs welcome! See [`CONTRIBUTING.md`](CONTRIBUTING.md) for dev setup, code style, and the PR process.
For security issues, read [`SECURITY.md`](SECURITY.md) — please do not file public issues for
vulnerabilities.

---

## 📜 License

**AGPL-3.0** — see [`LICENSE`](LICENSE).

This is a strong copyleft license. If you run a modified version of this agent as a network
service (e.g. a hosted agent product), you **must** publish the source of your modifications
to your users under the same license. See section 13 of the AGPL for details.

---

## 🗺 Roadmap

Tracked in [`docs/NEXT_STEPS_AND_FEATURE_DESIGN.md`](docs/NEXT_STEPS_AND_FEATURE_DESIGN.md).
Priorities: resource guards (`--max-turns`), session persistence, additional provider presets.
