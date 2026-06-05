# agent

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Node](https://img.shields.io/badge/node-%E2%89%A520.0.0-brightgreen.svg)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-123%20passed-brightgreen.svg)](#测试)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue.svg)](https://www.typescriptlang.org/)

本地终端 **ReAct agent**,TypeScript + Ink 从零手写实现。
接入任意 OpenAI 兼容 LLM(DeepSeek / Moonshot / Ollama / vLLM 等)。
灵感来自 Claude Code / Gemini CLI,但**不依赖** LangChain / Vercel AI SDK —— ReAct 循环、工具调用、流式渲染、审计日志全部自己写。

[English](README.md) · [设计文档](docs/) · [许可证(AGPL-3.0)](LICENSE)

---

## ✨ 特性

- **手写 ReAct 主循环** —— 不引 agent 框架,行为完全可控
- **流式 UX** —— 逐字渲染、动态工具状态、Claude Code 风格顶部状态栏
- **文件沙箱** —— 路径限制在 `cwd` 内、写后缀白名单、realpath 跟随符号链接
- **危险操作醒目确认** —— `write_file` / `edit_file` / `delete_file` / `http_fetch`
  触发时弹**红双线框 + ⚠ 警告 + 变更预览**,**必须输入字母 `y`** 才确认,`Enter` 键无效
- **合规审计日志** —— 每个 session 自动写一份带 **SHA-256 哈希链**的 JSONL 到
  `~/.agent/audit/<sessionId>.jsonl`(可改路径 / 关闭)。审计员可独立跑
  `npx tsx src/audit/verifyChain.ts <file>` 验证完整性
- **Provider 无关** —— 走 OpenAI Chat Completions 协议;`--provider deepseek` 切换 / 自定义 `OPENAI_BASE_URL`
- **真实摘要压缩** —— 长会话触发 LLM 摘要,失败回退保守截断

---

## 📦 安装

```bash
git clone https://github.com/<owner>/agent.git
cd agent
npm install
cp .env.example .env
$EDITOR .env       # 填 OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL
```

需要 **Node.js ≥ 20**。

---

## 🚀 用法

### 交互式 REPL

```bash
npm run dev
```

输入任务,回车。agent 会:
1. 逐字流式输出 LLM 回复
2. 决定是否调工具(读文件 / 搜 / 列 / 写 / …)
3. 破坏性操作前弹醒目确认框
4. 直到 LLM `stop` 退出循环

### 单次 headless

```bash
npm run dev -- "列出 src/ 下所有 TypeScript 文件"
```

### 常用参数

| 参数 | 作用 |
|---|---|
| `--yolo` | 跳过 `confirm` 工具确认;`dangerous` 工具仍要求 `y` |
| `--allow-mutations` | 允许 `http_fetch POST` 等副作用 |
| `--provider <name>` | 选内置 provider 预设(目前 `deepseek`) |
| `--cwd <path>` | 覆盖工作目录 |
| `--audit-log <path?>` | 写审计到指定路径(不传值则用默认 `~/.agent/audit/`) |
| `--no-audit-log` | 关闭审计(开发场景) |
| `-- "prompt"` | 位置参数 = headless 模式,处理完一轮即退出 |

### 示例

```bash
# 默认 DeepSeek,审计开启
npm run dev -- "列出 src/agent 目录"

# 写文件(会弹红框确认)
npm run dev -- "创建一个 README.md 描述这个项目"

# HTTP 请求(危险,必确认)
npm run dev -- --allow-mutations "POST https://api.example.com/webhook body {...}"

# 关闭审计
npm run dev -- --no-audit-log "快速提问"
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
| `writeableExts` | (仅 config 文件) | 见下 |

`~/.agent/config.json` 示例:

```json
{
  "openaiModel": "deepseek-chat",
  "maxContextTokens": 120000,
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
