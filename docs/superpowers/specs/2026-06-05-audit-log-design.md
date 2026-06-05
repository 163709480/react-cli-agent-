# 全链路审计日志(合规审计 + 责任追溯)

**日期**: 2026-06-05
**关联设计**: `docs/superpowers/specs/2026-06-04-terminal-agent-design.md`
**状态**: 已实现

---

## 1. 目标与定位

国企对生产环境稳定性和合规性要求极高。AI 智能体作为连接多个系统的枢纽,如果发生越权操作、数据泄露或引发生产事故,必须能够清晰界定责任边界。本次改动为 agent 加 **全链路审计日志**能力,满足:

- **全链路留痕**:每一步思考(phase 切换、text_delta 增量)、工具调用(入参/出参)、用户确认(同意/拒绝)、输入输出,形成可重放的 JSONL 操作日志
- **不可篡改**:用 **hash chain**(SHA-256 链式)确保任何字节级篡改 / 删除都会被检出
- **可重放**:审计员拿到 `.jsonl` 文件 + canonical 验证脚本,就能还原某次任务的完整执行轨迹
- **默认开启**:国金合规场景下,审计是默认行为(`~/.agent/audit/<sessionId>.jsonl`);用户可用 `--no-audit-log` 关闭
- **失败兜底**:写审计失败(权限/磁盘满)不阻塞 agent 主体运行,stderr 警告一次后降级为 noop

**非目标**(本次不做):

- 远程日志上传(S3 / syslog / 加密上传)
- 数字签名(目前仅完整性,机密性靠文件系统权限)
- logrotate 配置脚本
- `text_delta` 压缩 / 聚合
- 多 session 合并视图 / Web UI
- 审计文件的二进制加密(AES)

---

## 2. 事件 schema

### 2.1 12 种事件类型

| type | 来源 | 业务字段 |
|---|---|---|
| `session_start` | 新增(审计专用) | `argv, cwd, model, provider, yolo, allowMutations, node, agentVersion` |
| `user_prompt` | 新增(审计专用) | `role, content` |
| `phase` | `AgentEvent` | `phase, toolName?` |
| `text_delta` | `AgentEvent` | `delta` |
| `tool_call_start` | `AgentEvent` | `toolCallId, toolName, args, argsParseError` |
| `user_confirm` | 新增(`AgentEvent`) | `toolCallId, toolName, approved, latencyMs` |
| `tool_call_end` | `AgentEvent` | `toolCallId, result, resultBytes, isError` |
| `llm_usage` | 新增(`AgentEvent`) | `callIndex, promptTokens, completionTokens, finishReason` |
| `done` | `AgentEvent` | `finishReason, usage?` |
| `error` | `AgentEvent` | `error` |
| `session_end` | 新增(审计专用) | `exitReason, totalEvents` |

**为什么是混合**:`text_delta` 逐条 + `tool_call_start/end` 独立 — 审计员要"录屏级"上下文,纯合并会丢思考节奏(LLM 可能在 text 中间断思考决定调工具,合并就看不到节奏)。`user_prompt` / `session_start` / `session_end` 单独成事件:不被压缩,事故复盘不依赖反推。

### 2.2 公共字段(每行都有)

| 字段 | 含义 |
|---|---|
| `ts` | ISO 8601 时间戳,毫秒级 |
| `sessionId` | uuid v4,本次启动唯一 |
| `pid` | 进程号(多 session 并发排查用) |
| `seq` | 本会话内单调递增序号,从 0 开始 |
| `prevHash` | 上一行的 `hash`(创世行 = 自身 `hash`) |
| `hash` | `sha256:` + hex(sha256(canonicalJson(payloadWithoutHash) + prevHash)) |

---

## 3. 哈希链算法

### 3.1 链规则

- **第 1 行(创世)**:`prevHash = hash = sha256(canonicalJson(payloadWithoutHash))`(自哈希)
- **第 N>1 行**:`hash = sha256(canonicalJson(payloadWithoutHash) + prevHash)`

**关键不变量**:`payloadWithoutHash` 必须同时去掉 `hash` 和 `prevHash` 两个字段(它们是链字段,不参与自身 hash 计算)。

### 3.2 Canonical JSON(手写 sortkeys)

为什么不用 `JSON.stringify`:**key 顺序在不同 Node 版本 / 不同引擎可能不一致**,破坏哈希稳定性。
为什么不用 `json-stable-stringify` 依赖:**国企合规项目加 dep 要走审批**,零新增依赖更易过审。

实现要点(`src/audit/canonical.ts`,~30 行):
- object: key 按 `localeCompare` 排序后递归
- array: 保持顺序递归
- 遇到 `undefined` / function / symbol / bigint → **抛错**(防静默丢字段)
- `number` / `boolean` / `null` / `string` 走 `JSON.stringify` 兜底
- 空对象 → `{}`,空数组 → `[]`

---

## 4. 文件结构

### 4.1 写入策略

| 决策 | 选择 | 理由 |
|---|---|---|
| 格式 | **JSONL**(每行一个 JSON 对象) | 追加写友好、tail/grep/jq 处理简单 |
| 写入方式 | **同步 `appendFileSync`** | 合规 > 性能;crash-safe;本地单行 < 1ms |
| 文件名 | **`<sessionId>.jsonl`** | 一次 session = 一个文件,天然分卷 |
| 目录 | **`~/.agent/audit/`** | 用户级默认;`--audit-log <path>` 可覆盖 |
| 行尾 | LF | 跨平台拷贝时 Windows 工具可能改 `\r\n`,`verifyChain` 容忍两种 |

### 4.2 失败兜底

```ts
// src/audit/sink.ts:108-138
emit(ev) {
  if (this.auditDisabled) return;
  try {
    if (!this.dirEnsured) {
      try { mkdirSync(dirname(this.filePath), { recursive: true }); } catch {}
      this.dirEnsured = true;
    }
    appendFileSync(this.filePath, line + '\n', 'utf8');
  } catch (err) {
    if (!this.warned) {
      process.stderr.write(`[audit] disabled: ${err.message}\n`);
      this.warned = true;
    }
    this.auditDisabled = true;
  }
}
```

- 首次写盘异常 → stderr 警告一次 + `auditDisabled = true`
- 后续 emit 直接 return(不抛错)
- agent 主体运行**完全不阻塞**

---

## 5. CLI 接口

```bash
# 默认:写到 ~/.agent/audit/<sessionId>.jsonl
npm run dev -- "列出 src 目录"

# 自定义路径
npm run dev -- --audit-log /var/log/agent/x.jsonl "列出 src 目录"

# 关闭审计(开发场景)
npm run dev -- --no-audit-log "列出 src 目录"

# 冲突:同时给 --audit-log 和 --no-audit-log → 立即 stderr 报错并 exit 2
```

---

## 6. 事件解读示例(实测片段)

以下是一段真实运行的 `.jsonl` 节选(sessionId 截短,5 条事件,seq 14-18):

```jsonl
{"type":"phase","phase":"executing","toolName":"glob","ts":"...","seq":14,"prevHash":"sha256:7b455881...","hash":"sha256:ab208c83..."}
{"type":"tool_call_start","toolCallId":"call_00_g0CVBLT42j81VYuy51Wc6572","toolName":"glob","args":{"pattern":"*"},"argsParseError":false,"ts":"...","seq":15,"prevHash":"sha256:ab208c83...","hash":"sha256:6a9eae12..."}
{"type":"llm_usage","callIndex":2,"promptTokens":1005,"completionTokens":42,"finishReason":"stop","ts":"...","seq":16,"prevHash":"sha256:6a9eae12...","hash":"sha256:7d170748..."}
{"type":"tool_call_end","toolCallId":"call_00_g0CVBLT42j81VYuy51Wc6572","result":"{\n  \"files\": [\"README.md\",...]\n}","resultBytes":167,"isError":false,"ts":"...","seq":17,"prevHash":"sha256:7d170748...","hash":"sha256:9a09c6c8..."}
{"type":"phase","phase":"thinking","ts":"...","seq":18,"prevHash":"sha256:9a09c6c8..."}
```

### 逐行解读

| seq | type | 含义 |
|---|---|---|
| 14 | `phase=executing` | loop 切到"执行"态,**不是工具调用本身**;为 seq 15 做铺垫 |
| 15 | `tool_call_start` | LLM 这一轮决定调 `glob`,参数 `pattern: "*"`。`toolCallId` 关联 seq 17 的 end。`argsParseError: false` 说明 LLM 返回的 arguments 字符串是合法 JSON |
| 16 | `llm_usage` | 与 seq 15 **同一毫秒** — stream 吐完 `tool_call_start` 后立刻给 `done`,loop 在 done 回调里 yield 此事件。`callIndex: 2` = 第 2 次 LLM 调用;`finishReason: "stop"` 而非 `"tool_calls"`(DeepSeek 等国产模型常给 `stop`,**审计忠实记录原值**,合规层面更可信) |
| 17 | `tool_call_end` | 8ms 后工具完成;返回 7 个文件名(README/analysis/hello-world/package-lock/package/tsconfig/vitest.config);**没有** `.env.example` / `.gitignore` → 印证 `glob` 配的是 `dot: false`。`resultBytes: 167` 量化"agent 看到多少数据",**防 LLM 被 prompt injection 灌超大文件** |
| 18 | `phase=thinking` | 工具结果已回灌,重新进入"思考"阶段,准备发起第 3 次 LLM 调用(callIndex=3) |

### 时间轴还原

```
T+0ms    phase=executing(glob)         // loop 切态
T+2ms    tool_call_start  glob(*)      // LLM 决定
T+2ms    llm_usage  1005→42 stop       // 本轮 LLM 统计
T+10ms   tool_call_end  7 files 167B   // 工具返回
T+11ms   phase=thinking                // 回灌,等 LLM 再想
```

整段 ~11ms;**审计忠实记录事件实际产生时刻**(毫秒级),不强制按 LLM 边界对齐。事故复盘时能精准判断"用户看着 glob 那条命令,T+10ms 拿到结果,中间没卡"还是"中间等了 3 秒才回来 → LLM 慢 / 工具慢"。

### 链完整性核对

```text
seq 14 hash=ab208c83…
seq 15 prev=ab208c83…  ← 15.prev == 14.hash ✓
seq 16 prev=6a9eae12…  ← 16.prev == 15.hash ✓
seq 17 prev=7d170748…  ✓
seq 18 prev=9a09c6c8…  ← 18.prev == 17.hash ✓
```

---

## 7. 审计员独立验证

### 7.1 链验证 CLI

```bash
npx tsx src/audit/verifyChain.ts /path/to/<sessionId>.jsonl
# 链完好: { "ok": true,  "lines": <N> }           exit 0
# 链断裂: { "ok": false, "lines": <N>, "firstBreakSeq": <S>, "reason": "<R>" }   exit 1
# 解析错误: stderr "verifyChain: <err>"          exit 2
```

### 7.2 失败原因枚举

| reason | 含义 |
|---|---|
| `hash-mismatch` | 当前行 payload 被改 |
| `prev-hash-mismatch` | 上一行被改(本行 prevHash 对不上) |
| `missing-field` | 当前行缺 `hash` / `prevHash` / `seq` |
| `parse-error` | 当前行不是合法 JSON |
| `non-monotonic-seq` | 当前行 seq 与上行不连续(**行被删除**) |

### 7.3 jq 常用模式

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

---

## 8. 关键不变量

1. **不可变字段**:写入盘后不再修改。`AuditSink` 不暴露任何 setter。
2. **自校验**:`hash === "sha256:" + hex(sha256(canonicalJson(payloadWithoutHash) + prevHash))`。
3. **`seq` 单调**:三种 sink 内部自增,不允许外部指定。
4. **`prevHash` 链**:首行 = 创世;后续行 `prevHash` = 上一行 `hash`。
5. **失败降级单次**:`JsonlFileSink` 用 `auditDisabled` 标志;首次失败 `process.stderr.write("[audit] disabled: <err>\n")` 后 `auditDisabled = true`,后续 `emit` 直接 return。
6. **零新增依赖**:`uuid` 已存在;sha256 / fs / `node:crypto` 内置;canonical 手写。
7. **回放忠实性**:`user_prompt` 单独成事件(不靠 `messages` 反推,可能被压缩);`text_delta` 逐条保留 → 拼回去 = 完整 LLM 输出。
8. **路径安全**:`JsonlFileSink` 创建时 `path.resolve` + 父目录 `mkdir -p`;不限制文件扩展名,允许 `.jsonl` / 自定义。
9. **目录创建**:`~/.agent/audit/` 不存在时,首次 emit 前自动 `fs.mkdirSync(dir, { recursive: true })`。

---

## 9. 风险与缓解

| 风险 | 缓解 |
|---|---|
| `text_delta` 太多导致 jsonl 巨大(长 session 数百 MB) | 文档说明;`JsonlFileSink` 接受 `maxBytes?` 扩展点(本期不实现) |
| `appendFileSync` 在 NFS / 容器慢盘上阻塞 agent | 文档写明推荐本地 fs;若实测成为瓶颈,后续切异步 + fsync 批 |
| `canonicalJson` 实现被改 → 链断 | 固化算法 + 在 README 写"如何验证";`verifyChain.ts` 自带参考实现 |
| 审计员拿到文件后,误把 `<sid>.jsonl` 复制到 Windows / 不同行尾环境 | 文档要求保留 LF 行尾;`verifyChain` 容忍 `\r\n` 兼容读取 |
| 多个 session 并发(`headlessPrompt` 路径) | 一个进程 = 一个 sessionId = 一个文件,天然不冲突;多进程 = 多文件,各算各的链 |
| `--audit-log` 显式 path 与 `--no-audit-log` 冲突 | 解析时同时出现 → 报 stderr 错误并 exit 2(与 `loadConfig` 错误一致) |
| `~/.agent/audit/` 权限被设死(只读) | `JsonlFileSink` 静默降级,stderr 警告一次,agent 继续运行(默认行为) |
| 默认开启给开发者产生意外的本地 audit 垃圾 | 在 README "合规审计" 节明确写"默认开启,关闭用 `--no-audit-log`" |

---

## 10. Verification(端到端)

### 10.1 自动测试

```bash
npm run typecheck          # 类型干净
npm test                   # 全量:84 现有 it + 12 新增 it 全绿
```

新增 12 个 it 分布:
- `src/__tests__/audit-canonical.test.ts` — 4 个
- `src/__tests__/audit-hashChain.test.ts` — 5 个
- `src/__tests__/audit-sink.test.ts` — 3 个
- `src/__tests__/loop.test.ts` — 3 个(其中 1 个回归、2 个新场景)

### 10.2 smoke 验证(开发期 1 次,不入 CI)

```bash
# 启用审计跑一次
npm run dev -- --audit-log /tmp/agent-audit-smoke.jsonl "列出 src 目录"
head -3 /tmp/agent-audit-smoke.jsonl
npx tsx src/audit/verifyChain.ts /tmp/agent-audit-smoke.jsonl   # { ok: true, lines: <N> }

# 篡改测试
sed -i '' 's/好的/好的x/' /tmp/agent-audit-smoke.jsonl
npx tsx src/audit/verifyChain.ts /tmp/agent-audit-smoke.jsonl   # { ok: false, firstBreakSeq: 7 }
```

### 10.3 默认开启验证(无 flag)

```bash
npm run dev -- "ls src"
ls -lt ~/.agent/audit/ | head -3
npx tsx src/audit/verifyChain.ts $(ls -t ~/.agent/audit/*.jsonl | head -1)
```

### 10.4 失败兜底验证

```bash
mkdir -p /tmp/agent-audit-test-dir && chmod 000 /tmp/agent-audit-test-dir
npm run dev -- --audit-log /tmp/agent-audit-test-dir/x.jsonl "ls"
# 期望:stderr 一行 [audit] disabled: EACCES ..., agent 正常运行不退出
chmod 755 /tmp/agent-audit-test-dir && rm -rf /tmp/agent-audit-test-dir
```

---

## 11. 关键文件清单

| 路径 | 作用 |
|---|---|
| `src/audit/canonical.ts` | **新**,手写 sortkeys 序列化器,~30 行,零依赖 |
| `src/audit/hashChain.ts` | **新**:`genesisHash` / `nextHash` / `verifyChain` |
| `src/audit/sink.ts` | **新**:`AuditSink` 接口 + `NoopSink` / `InMemorySink` / `JsonlFileSink` |
| `src/audit/verifyChain.ts` | **新**,审计员 CLI(`npx tsx src/audit/verifyChain.ts <file>`) |
| `src/audit/index.ts` | **新**,barrel 统一导出 |
| `src/agent/types.ts` | `AgentEvent` 扩 `user_confirm` / `llm_usage`;`RunTurnInput` 扩 `auditSink?` / `onUsage?` |
| `src/agent/loop.ts` | 4 处 `onEvent` 旁追加 `auditSink?.emit`;`onConfirm` 前加 `user_confirm` yield;`done` 分支调 `onUsage` |
| `src/app.tsx` | sink 创建 / 销毁 / 透传到 `runTurn` |
| `src/cli.tsx` | `--audit-log` / `--no-audit-log` 解析 + 冲突检测 |
| `src/__tests__/audit-canonical.test.ts` | **新**,4 个 it |
| `src/__tests__/audit-hashChain.test.ts` | **新**,5 个 it |
| `src/__tests__/audit-sink.test.ts` | **新**,3 个 it |
| `src/__tests__/loop.test.ts` | +3 个 it(auditSink 注入 / undefined 回归 / onUsage) |
| `README.md` | "合规审计" 节 |
