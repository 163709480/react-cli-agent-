# agent

本地终端 ReAct agent,接入任意 OpenAI 兼容 LLM(DeepSeek / Moonshot / Ollama 等)。

## 用法

```bash
# 装依赖
npm install

# 配 .env(参考 .env.example)
cp .env.example .env
$EDITOR .env

# 启动 REPL
npm run dev

# 单次 headless
npm run dev -- "修复 foo.ts 里的拼写错误"

# 跳过所有确认(脚本场景)
npm run dev -- --yolo "重命名所有 *.js 为 *.ts"

# 显式选择 provider(覆盖 env / json config)
# 当前仅支持 deepseek(也是默认值)
npm run dev -- --provider deepseek "列出 src 下的 TypeScript 文件"

# 未知 provider 会立即报错并 exit 2
npm run dev -- --provider ollama
```

## 合规审计(默认开启)

agent 默认**开启**全链路审计日志,满足国企合规审计与责任追溯要求。

```bash
# 默认:写到 ~/.agent/audit/<sessionId>.jsonl
npm run dev -- "列出 src 目录"

# 自定义路径
npm run dev -- --audit-log /var/log/agent/x.jsonl "列出 src 目录"

# 关闭审计(开发场景)
npm run dev -- --no-audit-log "列出 src 目录"
```

### 审计文件内容

每行一个 JSON 事件,带 hash chain 防篡改:

| 字段 | 含义 |
|---|---|
| `ts` | ISO 8601 时间戳 |
| `sessionId` | uuid v4,本次启动唯一 |
| `pid` | 进程号 |
| `seq` | 本会话内单调递增序号 |
| `prevHash` | 上一行的 `hash` |
| `hash` | `sha256:` + hex(sha256(canonicalJson(payloadWithoutHash) + prevHash)) |

事件类型:`session_start` / `session_end` / `user_prompt` / `phase` /
`text_delta` / `tool_call_start` / `tool_call_end` / `user_confirm` /
`llm_usage` / `done` / `error`。`user_confirm` 记录每次 y/n 决定及
`latencyMs`;`tool_call_start` 同时记录解析后的 `args`(解析失败时
`argsParseError: true` 保留原字符串)。

### 审计员独立验证

```bash
# 验证一条 .jsonl 的 hash chain 完好
npx tsx src/audit/verifyChain.ts /path/to/<sessionId>.jsonl
# 输出: {"ok":true,"lines":<N>}

# 篡改后验证会失败
# sed -i '' 's/某字符/某字符x/' /path/to/<sessionId>.jsonl
# npx tsx src/audit/verifyChain.ts /path/to/<sessionId>.jsonl
# 输出: {"ok":false,"lines":<N>,"firstBreakSeq":<S>,"reason":"hash-mismatch"}
```

### 失败兜底

若审计目录不可写(权限/磁盘满),agent 在 stderr 打印一行
`[audit] disabled: <err>` 后降级为 no-op,**不会阻塞 agent 运行**。
LLM 调用的 token 使用会同时通过 `onUsage` 回调透传,可在自定义 UI
中复用。

### 事件解读示例

下面是一段实测的 `.jsonl` 节选(5 条事件,seq 14-18),完整还原一次
"LLM 决定调 `glob` 列目录 → 工具返回 7 个文件 → 重新进入思考阶段"。

```jsonl
{"type":"phase","phase":"executing","toolName":"glob","ts":"...","seq":14,"prevHash":"sha256:7b455881...","hash":"sha256:ab208c83..."}
{"type":"tool_call_start","toolCallId":"call_00_g0CVBLT42j81VYuy51Wc6572","toolName":"glob","args":{"pattern":"*"},"argsParseError":false,"ts":"...","seq":15,"prevHash":"sha256:ab208c83...","hash":"sha256:6a9eae12..."}
{"type":"llm_usage","callIndex":2,"promptTokens":1005,"completionTokens":42,"finishReason":"stop","ts":"...","seq":16,"prevHash":"sha256:6a9eae12...","hash":"sha256:7d170748..."}
{"type":"tool_call_end","toolCallId":"call_00_g0CVBLT42j81VYuy51Wc6572","result":"{\n  \"files\": [\"README.md\",...]\n}","resultBytes":167,"isError":false,"ts":"...","seq":17,"prevHash":"sha256:7d170748...","hash":"sha256:9a09c6c8..."}
{"type":"phase","phase":"thinking","ts":"...","seq":18,"prevHash":"sha256:9a09c6c8..."}
```

| seq | type | 含义 |
|---|---|---|
| 14 | `phase=executing` | loop 切到"执行"态,不是工具调用本身;为 seq 15 做铺垫 |
| 15 | `tool_call_start` | LLM 这一轮决定调 `glob`,参数 `pattern: "*"`。`toolCallId` 关联 seq 17 的 end。`argsParseError: false` 说明 LLM 返回的 arguments 是合法 JSON |
| 16 | `llm_usage` | 与 seq 15 **同一毫秒** — stream 吐完 `tool_call_start` 后立刻给 `done`,loop 在 done 回调里 yield 此事件。`callIndex: 2` = 第 2 次 LLM 调用;`finishReason: "stop"` 而非 `"tool_calls"`(DeepSeek 等国产模型常给 `stop`,**审计忠实记录原值**) |
| 17 | `tool_call_end` | 8ms 后工具完成;返回 7 个文件名(README/analysis/hello-world/package-lock/package/tsconfig/vitest.config);**没有** `.env.example` / `.gitignore` → 印证 `glob` 配的是 `dot: false`。`resultBytes: 167` 量化"agent 看到多少数据",**防 LLM 被 prompt injection 灌超大文件** |
| 18 | `phase=thinking` | 工具结果已回灌,重新进入"思考"阶段,准备发起第 3 次 LLM 调用 |

**时间轴**:

```
T+0ms    phase=executing(glob)         # loop 切态
T+2ms    tool_call_start  glob(*)      # LLM 决定
T+2ms    llm_usage  1005→42 stop       # 本轮 LLM 统计
T+10ms   tool_call_end  7 files 167B   # 工具返回
T+11ms   phase=thinking                # 回灌,等 LLM 再想
```

整段 ~11ms。审计**忠实记录事件实际产生时刻**(毫秒级),不强制按 LLM
边界对齐 — 事故复盘时能精准判断"用户看着 glob 那条命令,T+10ms 拿到
结果,中间没卡"还是"中间等了 3 秒才回来 → LLM 慢 / 工具慢"。

**链完整性核对**:`seq N 的 prevHash === seq N-1 的 hash`(创世行除外,
其 `prevHash === hash`)。上面 5 条全链自洽,可直接跑
`verifyChain` 通过。

### 常用 jq 模式

```bash
# 只看 user 提问 + AI 文字回复
jq -r 'select(.type=="user_prompt" or .type=="text_delta") | [.ts, .type, (.content // .delta)] | @tsv' <file>

# 只看工具调用 + 用户确认
jq -c 'select(.type=="tool_call_start" or .type=="tool_call_end" or .type=="user_confirm")' <file>

# 只看 LLM 调用统计
jq -c 'select(.type=="llm_usage") | {ts, callIndex, promptTokens, completionTokens, finishReason}' <file>

# 12:00 之后的事件
jq -c 'select(.ts >= "2026-06-05T12:00:00Z")' <file>

# 跨 session 列表
jq -c 'select(.type=="session_start") | {ts, sessionId, model, provider}' ~/.agent/audit/*.jsonl
```

完整 spec 见 `docs/superpowers/specs/2026-06-05-audit-log-design.md`。

## 工具

- read_file / write_file / edit_file / grep / glob / http_fetch
- 路径必须在 cwd 内,后缀必须在白名单

## 测试

```bash
npm test
npm run typecheck
```

## 设计文档

- `docs/superpowers/specs/2026-06-04-terminal-agent-design.md`
- `docs/superpowers/plans/2026-06-04-terminal-agent.md`
