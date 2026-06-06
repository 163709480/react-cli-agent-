# react-cli-agent

> **开源 · 可审计 · 零依赖臃肿** —— 一个 3000 行内能读完的终端 ReAct agent。

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Node](https://img.shields.io/badge/node-%E2%89%A520.0.0-brightgreen.svg)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-142%20passed-brightgreen.svg)](#测试)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue.svg)](https://www.typescriptlang.org/)
[![Audit: SHA-256 hash chain](https://img.shields.io/badge/audit-SHA--256%20chain-blueviolet)](#-审计日志)
[![Dependencies: 10](https://img.shields.io/badge/runtime%20deps-10-success)](#-依赖)

本地终端 **ReAct agent**,TypeScript + Ink 从零手写实现。接入任意 OpenAI 兼容 LLM
(DeepSeek / Moonshot / Ollama / vLLM 等)。
灵感来自 Claude Code / Gemini CLI,但**不依赖** LangChain / Vercel AI SDK —— ReAct 循环、
工具调用、流式渲染、**合规审计日志**全部自己写。

[English](README.en.md) · [设计文档](docs/) · [许可证(AGPL-3.0)](LICENSE)

---

## 🎯 为什么用 react-cli-agent

| 你在意 | 我们怎么做的 |
|---|---|
| **代码可读** | 主循环 + 工具层一共 ~3000 行 TS,无任何 agent 框架。每个动作行为可预测。 |
| **合规审计** | 每个 session 自动写一份 **SHA-256 哈希链 JSONL**。`ts-node verifyChain.ts <file>` 离线验证,任何一行被改、删、插都能秒级发现。 |
| **隐私自托管** | AGPL-3.0 开源,代码透明;接 Ollama / vLLM **完全离线跑**,对话不外发。 |
| **零供应商锁定** | 走标准 OpenAI Chat Completions;`--provider deepseek` 一键切,或塞 `OPENAI_BASE_URL` 接任何兼容服务。 |
| **可改造** | 工具、确认流程、压缩策略、审计 sink 全部是独立模块(见 `src/`),可插可换。 |

---

## ✨ 特性

### 🔍 审计 & 合规

- **每 session 一份 JSONL 审计日志**,默认写入 `~/.agent/audit/<sessionId>.jsonl`
- **SHA-256 哈希链**——每条记录的 hash 包含前一条 hash,任何篡改(改字、删行、插行)都会被 `verifyChain.ts` 检测到
- **离线验证**:审计员拿日志 + 工具就能验,不需要 agent 本身、不需要联网
- **可选路径 / 关闭**:`--audit-log ./audit.jsonl` 或 `--no-audit-log`
- **隐私模式**:`--no-audit-log` 完全不落盘(开发期常用)

### 🛠 工具 & 沙箱

- **手写 ReAct 主循环**——不引 agent 框架,行为完全可控
- **流式 UX**——逐字渲染、动态工具状态、Claude Code 风格顶部状态栏
- **文件沙箱**——路径限制在 `cwd` 内、写后缀白名单、`realpath` 跟随符号链接
- **危险操作醒目确认**——`write_file` / `edit_file` / `delete_file` / `http_fetch`
  触发时弹**红双线框 + ⚠ 警告 + 变更预览**,**必须输入字母 `y`** 才确认,`Enter` 键无效
- **可插拔工具**——`src/tools/` 独立模块,加一个新工具 = 加一个 `defineTool({...})`

### 🧠 LLM & 资源

- **Provider 无关**——走 OpenAI Chat Completions 协议;`--provider deepseek` 切换 / 自定义 `OPENAI_BASE_URL`
- **真实摘要压缩**——长会话触发 LLM 摘要,失败回退保守截断;v0.2 引入 4 层防御(L1 mid-turn / L2 turn guard / L3 tool guard / L4 hot cut)
- **资源上限**——`--max-turns 12` / `--max-tool-calls 30`,防止失控(也可由环境变量配)
- **工具并发执行**——v0.3 引入:连续出现的只读工具(`read_file` / `glob` / `grep`)会按 partition 合成一批并行执行;写入类工具仍按 LLM 调用顺序串行,避免"读到了写之前的数据"。

### 📦 依赖 & 部署

- **运行时 10 个依赖**(`ink`, `openai`, `zod`, `fast-glob`, `gpt-tokenizer` 等),无 LangChain / Vercel AI SDK
- **AGPL-3.0 开源**——鼓励 fork、改造、商用(必须保持开源)
- **单文件二进制部署**:`npm run build` 完就是 Node 20+ 可跑的 `dist/cli.js`

---

## 📦 安装

需要 **Node.js ≥ 20**。

### 方式 A:全局安装(推荐,像 `claude` 那样直接启动)

```bash
git clone https://github.com/163709480/react-cli-agent-.git
cd react-cli-agent
npm install
cp .env.example .env
$EDITOR .env       # 填 OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL
npm run build      # 编译 dist/(只装一次需要)
npm link           # 把 react-cli-agent 软链到全局 PATH
```

装好后,**任意目录** 直接输 `react-cli-agent` 就能启动:

```bash
cd ~/anywhere
react-cli-agent                     # 进交互式 TUI
react-cli-agent --version           # 看版本
react-cli-agent --help              # 看帮助
react-cli-agent "重构 src/foo.ts"     # headless 模式
```

> ⚠️ 改了 `src/` 之后**必须** `npm run build` 一次,`react-cli-agent` 才会用到新代码。
> 开发期想改完即跑,可以用方式 B 的 `npm run dev`。

### 方式 B:开发模式(改了 src/ 立刻跑)

```bash
git clone https://github.com/163709480/react-cli-agent-.git
cd react-cli-agent
npm install
cp .env.example .env
$EDITOR .env
npm run dev                           # = tsx src/cli.tsx,直接跑 .tsx
npm run dev -- "你的 prompt"            # headless
```

---

## 🚀 用法

### 交互式 REPL

```bash
# 全局安装后:
react-cli-agent

# 或开发模式:
npm run dev
```

输入任务,回车。agent 会:
1. 逐字流式输出 LLM 回复
2. 决定是否调工具(读文件 / 搜 / 列 / 写 / …)
3. 破坏性操作前弹醒目确认框
4. 直到 LLM `stop` 退出循环

### 单次 headless

```bash
react-cli-agent "列出 src/ 下所有 TypeScript 文件"
# 或开发模式:
npm run dev -- "列出 src/ 下所有 TypeScript 文件"
```

### 常用参数

| 参数 | 作用 |
|---|---|
| `--version`, `-v` | 输出版本号并退出 |
| `--help`, `-h` | 打印帮助并退出 |
| `--yolo` | 跳过 `confirm` 工具确认;`dangerous` 工具仍要求 `y` |
| `--allow-mutations` | 允许 `http_fetch POST` 等副作用 |
| `--provider <name>` | 选内置 provider 预设(目前 `deepseek`) |
| `--cwd <path>` | 覆盖工作目录 |
| `--max-turns <n>` | 单次会话最大 LLM turns(默认 12) |
| `--max-tool-calls <n>` | 单次会话最大 tool calls(默认 30) |
| `--audit-log <path?>` | 写审计到指定路径(不传值则用默认 `~/.agent/audit/`) |
| `--no-audit-log` | 关闭审计(开发场景) |
| `-- "prompt"` | 位置参数 = headless 模式,处理完一轮即退出 |

### 示例

```bash
# 默认 DeepSeek,审计开启
react-cli-agent "列出 src/agent 目录"

# 写文件(会弹红框确认)
react-cli-agent "创建一个 README.md 描述这个项目"

# HTTP 请求(危险,必确认)
react-cli-agent --allow-mutations "POST https://api.example.com/webhook body {...}"

# 关闭审计
react-cli-agent --no-audit-log "快速提问"

# 限制资源,避免失控
react-cli-agent --max-turns 5 --max-tool-calls 10
```

---

## 🛠 工具

| 工具 | safety | 功能 |
|---|---|---|
| `read_file` | safe | 读文件,>1MB 截断,offset/limit |
| `write_file` | confirm | 完全覆盖,自动 mkdir |
| `edit_file` | confirm | 字符串替换,`old_string` 必须唯一 |
| `grep` | safe | ripgrep 优先,grep 兜底 |
| `glob` | safe | fast-glob |
| `http_fetch` | **dangerous** | GET/POST,100KB 截断 |
| `delete_file` | **dangerous** | 永久删除(禁止删目录) |

> `safe` 工具不弹框;`confirm` 工具弹黄色边框;
> `dangerous` 工具弹**红双线框 + `⚠ DANGEROUS ACTION` 标 + 完整变更预览**(旧/新内容、URL+method 等)。
> **必须输入字母 `y` 才确认** —— `Enter` 键无效,防误碰。

---

## 📋 合规审计

每个 session 自动生成带 **SHA-256 哈希链**的 **JSONL** 操作日志,任何字节级篡改/删除都会被发现。

```bash
# 默认路径
~/.agent/audit/<sessionId>.jsonl

# 自定义
npm run dev -- --audit-log /var/log/agent/x.jsonl "..."

# 关闭
npm run dev -- --no-audit-log "..."
```

事件类型:`session_start` / `user_prompt` / `phase` / `text_delta` /
`tool_call_start` / `user_confirm` / `tool_call_end` / `llm_usage` / `done` /
`error` / `session_end`。

### 审计员独立验证

```bash
npx tsx src/audit/verifyChain.ts <path-to-jsonl>
# { ok: true, lines: <N> }                                 链完好
# { ok: false, lines: <N>, firstBreakSeq: <S>, reason: ... }  链断裂
```

失败原因:`hash-mismatch`(内容被改)/ `prev-hash-mismatch`(上一行被改)/
`non-monotonic-seq`(行被删)/ `parse-error`(JSON 损坏)/ `missing-field`(缺字段)。

### 端到端示例:从跑 agent 到验证

```bash
# 1. 跑一次 agent,日志写到指定路径
npm run dev -- --audit-log ./audit.jsonl "列出 src/ 目录"

# 2. 验证链完好
npx tsx src/audit/verifyChain.ts ./audit.jsonl
# → { ok: true, lines: 42 }

# 3. 模拟攻击者改了一行(把 tool_call_end 的 result 改了)
sed -i '' 's/"result":"ok"/"result":"ok (tampered)"/' ./audit.jsonl

# 4. 再次验证 — 秒级发现
npx tsx src/audit/verifyChain.ts ./audit.jsonl
# → { ok: false, lines: 42, firstBreakSeq: 17, reason: 'hash-mismatch' }
```

> 这就是为什么我们用哈希链而不是单纯追加文件:普通日志被改一两行肉眼根本看不出来,
> 哈希链让"改一行必须连带改后面所有行"的成本变成"重新跑整个 session"。

### 隐私模式

```bash
# 完全不写盘(开发 / 敏感数据场景)
npm run dev -- --no-audit-log "..."

# 跑完事后看内存版(只存在于 session 内的 InMemorySink,无 dump)
```
`--no-audit-log` 适合临时调试、生产 / 合规场景务必保留审计。

### 常用 jq 模式

```bash
# 工具调用 + 用户确认
jq -c 'select(.type=="tool_call_start" or .type=="tool_call_end" or .type=="user_confirm")' <file>

# LLM token 用量
jq -c 'select(.type=="llm_usage") | {ts, callIndex, promptTokens, completionTokens, finishReason}' <file>
```

完整 spec:[`docs/superpowers/specs/2026-06-05-audit-log-design.md`](docs/superpowers/specs/2026-06-05-audit-log-design.md)。

---

## ⚙️ 配置

优先级:`CLI flag` > `env var` > `~/.agent/config.json` > 内置默认。

| Key | 环境变量 | 默认值 |
|---|---|---|
| `openaiApiKey` | `OPENAI_API_KEY` | (必填) |
| `openaiBaseUrl` | `OPENAI_BASE_URL` | `https://api.deepseek.com/v1` |
| `openaiModel` | `OPENAI_MODEL` | `deepseek-chat` |
| `maxContextTokens` | `AGENT_MAX_CONTEXT_TOKENS` | `120000` |
| `maxTurns` | `AGENT_MAX_TURNS` | `12` |
| `maxToolCalls` | `AGENT_MAX_TOOL_CALLS` | `30` |
| `writeableExts` | (仅 config 文件) | 见下 |

`~/.agent/config.json` 示例:

```json
{
  "openaiModel": "deepseek-chat",
  "maxContextTokens": 120000,
  "maxTurns": 12,
  "maxToolCalls": 30,
  "writeableExts": [".md", ".ts", ".json"]
}
```

---

## 🧪 测试

```bash
npm test           # 123 个测试,21 个文件
npm run typecheck  # tsc --noEmit,必须干净
```

---

## 🏗 架构

```
UI 层 (Ink + React)
  src/cli.tsx → src/app.tsx → src/components/*
                ↓ AgentEvent
Agent 核心 (手写 ReAct)
  src/agent/loop.ts ← src/agent/context.ts (压缩)
  src/agent/schema.ts (zod → JSON Schema)
  src/agent/tools.ts (注册表)
                ↓
LLM 适配 ───── 工具 ───── 沙箱
  src/llm/         src/tools/   src/safety/
  (OpenAI 兼容)    (7 个工具)   (路径/后缀)
                ↓
审计 (合规)
  src/audit/  (canonical JSON + SHA-256 哈希链 + JSONL 落盘)
```

设计文档在 [`docs/superpowers/`](docs/superpowers/)。

---

## 🤝 贡献

欢迎 PR!开发规范与提交流程见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。
安全问题请读 [`SECURITY.md`](SECURITY.md) —— **不要**在公开 issue 里提漏洞。

---

## 📜 许可证

**AGPL-3.0** —— 见 [`LICENSE`](LICENSE)。

强 copyleft:如果你把修改后的版本作为网络服务提供(比如托管的 agent 产品),**必须**把修改的源代码以同样协议公开发布给用户。详见 AGPL 第 13 节。

---

## 🗺 路线图

见 [`docs/NEXT_STEPS_AND_FEATURE_DESIGN.md`](docs/NEXT_STEPS_AND_FEATURE_DESIGN.md)。
近期重点:资源护栏(`--max-turns`)、会话持久化、更多 provider 预设。
