# react-cli-agent

> **Open source · Auditable · Zero bloat** — a terminal ReAct agent you can read end-to-end in one sitting.

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Node](https://img.shields.io/badge/node-%E2%89%A520.0.0-brightgreen.svg)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-142%20passed-brightgreen.svg)](#testing)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue.svg)](https://www.typescriptlang.org/)
[![Audit: SHA-256 hash chain](https://img.shields.io/badge/audit-SHA--256%20chain-blueviolet)](#-audit--compliance)
[![Dependencies: 10](https://img.shields.io/badge/runtime%20deps-10-success)](#-dependencies)

A local terminal **ReAct agent** built from scratch in TypeScript + Ink. Connects to any
OpenAI-compatible LLM (DeepSeek / Moonshot / Ollama / vLLM / …). Inspired by Claude Code /
Gemini CLI, but with **no LangChain / Vercel AI SDK** — the ReAct loop, tool calling,
streaming, and **compliance audit logging** are all hand-written.

[中文文档](README.md) · [Design docs](docs/) · [License (AGPL-3.0)](LICENSE)

---

## 🎯 Why react-cli-agent

| You care about | How we deliver |
|---|---|
| **Readable code** | Main loop + tools in ~3000 lines of TS, no agent framework. Every action is predictable. |
| **Compliance audit** | Every session auto-writes a **SHA-256 hash-chained JSONL**. `ts-node verifyChain.ts <file>` verifies offline — any line edit, deletion, or insertion is detected instantly. |
| **Privacy / self-hosted** | AGPL-3.0 open source, transparent code; works fully offline with Ollama / vLLM, no telemetry leaves your box. |
| **Zero vendor lock-in** | Standard OpenAI Chat Completions; switch via `--provider deepseek` or set `OPENAI_BASE_URL` to any compatible endpoint. |
| **Hackable** | Tools, confirm flow, compression policy, and audit sink are independent modules under `src/` — swap or extend at will. |

---

## ✨ Features

### 🔍 Audit & compliance

- **Per-session JSONL audit log**, defaulting to `~/.agent/audit/<sessionId>.jsonl`
- **SHA-256 hash chain** — each record's hash includes the previous record's hash. Any
  tampering (edit, delete, insert) is detected by `verifyChain.ts`.
- **Offline verification** — auditors need only the log file and the verifier; no agent,
  no network.
- **Customisable path / disable** — `--audit-log ./audit.jsonl` or `--no-audit-log`
- **Privacy mode** — `--no-audit-log` writes nothing to disk (common in dev)

### 🛠 Tools & sandbox

- **Hand-written ReAct loop** — no agent framework, full control over behavior
- **Streaming UX** — type-by-type text, dynamic tool status, Claude Code-style status bar
- **File sandbox** — paths constrained to `cwd`, write-extension allowlist, realpath symlink resolution
- **Dangerous-tool confirmation** — `write_file` / `edit_file` / `delete_file` / `http_fetch` show
  a **prominent confirm box** (red double border + ⚠ + diff preview). The user **must type `y`**
  to confirm; `Enter` alone does nothing.
- **Pluggable tools** — `src/tools/` is a flat module list. Adding a tool = `defineTool({...})`.

### 🧠 LLM & resources

- **Provider-agnostic** — OpenAI Chat Completions protocol. Switch via `--provider deepseek`
  or set `OPENAI_BASE_URL`.
- **Real summarization** — long sessions trigger a real LLM-driven summary with a conservative
  truncation fallback. v0.2 adds 4-layer defense (L1 mid-turn / L2 turn guard / L3 tool guard / L4 hot cut).
- **Resource caps** — `--max-turns 12` / `--max-tool-calls 30` prevent runaway sessions
  (also configurable via env vars).

### 📦 Dependencies & deploy

- **10 runtime deps** (`ink`, `openai`, `zod`, `fast-glob`, `gpt-tokenizer`, …) — no LangChain,
  no Vercel AI SDK.
- **AGPL-3.0** — fork, modify, even commercialize (must remain open source).
- **Single-file deploy** — `npm run build` produces `dist/cli.js`, runnable on any Node 20+.

---

## 📦 Install

Requires **Node.js ≥ 20**.

### Option A: Global install (recommended — like `claude`, launch from anywhere)

```bash
git clone https://github.com/163709480/react-cli-agent-.git
cd react-cli-agent
npm install
cp .env.example .env
$EDITOR .env       # set OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL
npm run build      # compile dist/ (only needed once)
npm link           # symlink `react-cli-agent` into your global PATH
```

After that, run `react-cli-agent` from **any directory**:

```bash
cd ~/anywhere
react-cli-agent                     # start interactive TUI
react-cli-agent --version           # print version
react-cli-agent --help              # print help
react-cli-agent "Refactor src/foo.ts"  # headless mode
```

> ⚠️ After editing anything under `src/`, you **must** re-run `npm run build` for the
> global `react-cli-agent` command to pick up your changes.
> For a faster edit-and-run loop, use Option B (`npm run dev`).

### Option B: Dev mode (runs `src/` directly, no build)

```bash
git clone https://github.com/163709480/react-cli-agent-.git
cd react-cli-agent
npm install
cp .env.example .env
$EDITOR .env
npm run dev                           # = tsx src/cli.tsx, runs .tsx directly
npm run dev -- "your prompt"            # headless
```

---

## 🚀 Usage

### Interactive REPL

```bash
# After global install:
react-cli-agent

# Or in dev mode:
npm run dev
```

Type a task, hit Enter. The agent will:
1. Stream LLM response token by token
2. Decide whether to call a tool (read_file / grep / glob / write_file / …)
3. Show a confirmation box for any destructive operation
4. Loop until the LLM signals `stop`

### Single-shot headless

```bash
react-cli-agent "List all TypeScript files under src/"
# Or in dev mode:
npm run dev -- "List all TypeScript files under src/"
```

### Common flags

| Flag | Effect |
|---|---|
| `--version`, `-v` | Print version and exit |
| `--help`, `-h` | Print help and exit |
| `--yolo` | Skip confirmation for `confirm` tools. `dangerous` tools still require `y`. |
| `--allow-mutations` | Permit `http_fetch POST` and other mutation effects |
| `--provider <name>` | Pick a built-in provider preset (e.g. `deepseek`) |
| `--cwd <path>` | Override the working directory |
| `--max-turns <n>` | Cap LLM turns per session (default 12) |
| `--max-tool-calls <n>` | Cap tool calls per session (default 30) |
| `--audit-log <path?>` | Write audit log to `<path>` (omit value for default `~/.agent/audit/`) |
| `--no-audit-log` | Disable audit log entirely (dev scenario) |
| `-- "prompt"` | Positional prompt = headless mode, exit after one turn |

### Examples

```bash
# Default: DeepSeek, audit log on
react-cli-agent "List src/agent directory"

# Write a file (will show red confirm box)
react-cli-agent "Create README.md describing this project"

# HTTP fetch (dangerous, always confirms)
react-cli-agent --allow-mutations "POST https://api.example.com/webhook with body {...}"

# Disable audit
react-cli-agent --no-audit-log "Quick question"

# Cap resources to prevent runaway
react-cli-agent --max-turns 5 --max-tool-calls 10
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

### End-to-end demo: from run to tamper detection

```bash
# 1. Run the agent, write log to a known path
npm run dev -- --audit-log ./audit.jsonl "List src/ directory"

# 2. Verify the chain — should be clean
npx tsx src/audit/verifyChain.ts ./audit.jsonl
# → { ok: true, lines: 42 }

# 3. Simulate an attacker editing one line
sed -i '' 's/"result":"ok"/"result":"ok (tampered)"/' ./audit.jsonl

# 4. Verify again — tampering is caught instantly
npx tsx src/audit/verifyChain.ts ./audit.jsonl
# → { ok: false, lines: 42, firstBreakSeq: 17, reason: 'hash-mismatch' }
```

> This is why we use a hash chain rather than a plain append-only file: a normal log
> can be edited by changing one or two lines (invisible to the human eye). A hash chain
> raises the cost of "edit one line" to "replay the entire session from scratch".

### Privacy mode

```bash
# Don't write any audit to disk (dev / sensitive data)
npm run dev -- --no-audit-log "..."
```
Use `--no-audit-log` for ephemeral debugging. For production / regulated environments,
**keep the audit on**.

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
