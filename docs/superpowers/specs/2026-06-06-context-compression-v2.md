# 上下文压缩 v2:mid-turn + 资源护栏 + 状态栏 + hot cut

**日期**: 2026-06-06
**关联**: `docs/superpowers/specs/2026-06-04-terminal-agent-design.md`(v0.1 设计)、`docs/superpowers/specs/2026-06-05-audit-log-design.md`(审计事件)
**状态**: 待评审

---

## 1. 目标与定位

v0.1 的上下文压缩已实现基础(`shouldCompress` 70% 阈值 + 真实 LLM 摘要 + 保守截断 fallback),但实战中暴露 4 类问题:

1. **mid-turn 暴增**:压缩只在 `runTurn` 开头触发,长 turn 内 LLM 多次调工具 → tool result 累积 → 调下一轮 LLM 时可能直接超 maxContextTokens → OpenAI 报 400
2. **循环无上限**:ReAct 循环没有 turn 数 / 工具调用数硬限,理论上可无限迭代(虽然 withRetry 限到 3 次,但迭代次数没限)
3. **UI 不透明**:`[context compressed]` 是塞进 text_delta 的一段文字,既不显眼也不一致(应该走 phase 事件)
4. **极端情况压不动**:摘要生成失败 + 单条消息体积极大(>10K token),压完仍然超限 → 4 层 fail 路径都没覆盖

本次 v2 修这 4 个。

**非目标**(本次不做):

- 多 session 合并视图
- session 持久化(`.agent/sessions/*.json`)
- token 计量上报(usage 已有但 UI 不展示累计)
- 自动从零开始的 sub-agent 调度

---

## 2. 设计

### 2.1 4 层防御(由粗到细)

| 层次 | 触发时机 | 行为 |
|---|---|---|
| L1 mid-turn 增量 | 每次 `tool_call_end` 后(在 `messages.push(toolMsg)` 之后) | 估 token,超 `maxContextTokens * 0.7` → 调 `compress()` |
| L2 turn 数护栏 | 每轮 LLM 调用前 | `llmTurns >= maxTurns`(默认 12)→ 主动 `done: 'error'` 退出 |
| L3 tool 数护栏 | 每个 tool_call 实际执行前 | `toolCalls >= maxToolCalls`(默认 30)→ 报 'too many tool calls' 退出 |
| L4 hot cut | 实际 `chatCompletionStream` 之前 | `estimateTokens(messages) > maxContextTokens` → 从 tail 砍 tool message,直到 ≤ 0.85 倍阈值。砍完塞一条 `[messages truncated for context window]` |

**优先级**:L1 在 loop 内做"软"压缩;L2/L3 是主动停下;L4 是 LLM 调用前最后一道闸,**失败也能跑**(只发警告不退出)。

### 2.2 状态机新增 `compressing` phase

```ts
// src/agent/types.ts
| { type: 'phase'; phase: 'thinking' | 'executing' | 'idle' | 'compressing' };
```

事件序列示例(一次 mid-turn 压缩):

```
phase=thinking        # 调 LLM 第 N 轮
text_delta ...
tool_call_start
tool_call_end
phase=compressing     # ← 新增
text_delta "[context compressed: 12.3K → 4.5K tokens]\n"
phase=thinking        # 继续下一轮 LLM
```

`compressing` phase 不计入 `llmTurns` 计数(不调 LLM)。

### 2.3 状态栏 `HeadStatus` 进度

`HeadStatus` 在 `phase === 'compressing'` 时展示:
```
⏺ Compressing context: 12,340 → 4,512 tokens (63% reduction) · 1.2s
```

需要:
- `currentTokens`(已有,从 LLM usage 来)
- `targetTokens`(压缩目标)
- `compressedAt: number`(时间戳,显示耗时)

`App` 在 `applyEvent` 收到 `phase: 'compressing'` 时启动一个**子状态**:
```ts
interface CompressStatus {
  before: number;
  after?: number;
  startedAt: number;
  finishedAt?: number;
}
```
UI 实时 render(用现有的 setInterval 模式)。

### 2.4 类型 / CLI / Config 改动

#### 2.4.1 `RunTurnInput` 新增 limits

```ts
export interface RunTurnInput {
  // ...existing...
  limits?: {
    maxTurns?: number;           // 默认 12
    maxToolCalls?: number;       // 默认 30
  };
}
```

#### 2.4.2 `RunTurnResult` 新增 metrics

```ts
export interface RunTurnResult {
  messages: Message[];
  finishReason: 'stop' | 'length' | 'abort' | 'error';
  metrics?: {
    llmTurns: number;
    toolCalls: number;
    compressions: number;
    hotCuts: number;
  };
}
```

#### 2.4.3 资源超限的 finishReason

新增 `'limit'` 变体:

```ts
finishReason: 'stop' | 'length' | 'abort' | 'error' | 'limit';
```

`done` 事件也带这个值。审计忠实记录(`llm_usage` 事件也加)。

#### 2.4.4 Config / CLI

```ts
// src/config.ts
interface Config {
  // ...existing...
  maxTurns: number;       // default 12
  maxToolCalls: number;   // default 30
}
```

```bash
npm run dev -- --max-turns 8 --max-tool-calls 20 "..."
```

```bash
AGENT_MAX_TURNS=8
AGENT_MAX_TOOL_CALLS=20
```

`.env.example` 加注释。

### 2.5 L4 hot cut 详细规则

`src/agent/hotCut.ts`(新文件):

```ts
/**
 * 入 LLM 之前,如果 messages 超过 maxContextTokens,从 tail 砍 tool message
 * 直到 ≤ 0.85 * maxContextTokens。
 *
 * 砍的是非 system、非 user、非最近 2 条 assistant 的 tool 消息(role=tool)。
 * 优先砍"最老"的 tool message(尾部之前)。
 *
 * 砍掉的 message 在 messages 数组里**不删**,而是把 content 标为
 * "[truncated for context window]",保留 id/role 让后续 agent_call 引用
 * 不会断。
 *
 * 实际做法:把 content 改成 marker,而不是 splice。
 */
export function hotCut(messages: Message[], maxContextTokens: number): {
  messages: Message[];
  cutCount: number;
}
```

不 splice 的理由:保留 message 在数组里,LLM 看历史时不会突然发现"上一条 tool_call 找不到"。

#### 边界:

- 全砍光还不够 → 返回 cutCount 等于"能砍多少就砍多少",不报错(因为 hot cut 是 best-effort,不是 gate)
- system message **绝不砍**
- 用户的最近 1 条 user message **绝不砍**
- 压缩目标:`0.85 * maxContextTokens`(留 15% 给 LLM 回答)

### 2.6 L1 mid-turn 压缩在 loop.ts 的位置

当前 `loop.ts` 的 tool_call 处理:

```ts
// 1. onConfirm
// 2. JSON.parse args
// 3. tool.execute()
// 4. messages.push(toolMsg)        ← 在这里之后加
// 5. onEvent(tool_call_end)        ← 在这里加 emit phase=compressing
```

```ts
// loop.ts (新增逻辑)
const toolMsg: Message = { role: 'tool', content: resultStr, tool_call_id: tc.id };
messages.push(toolMsg);
onEvent({ type: 'tool_call_end', toolCallId: tc.id, result: resultStr });

// ← 新增:mid-turn 压缩检查
if (shouldCompress(messages, maxContextTokens)) {
  onEvent({ type: 'phase', phase: 'compressing' });
  const t0 = Date.now();
  const before = estimateTokens(messages);
  try {
    const compressed = await compress(messages, async (text) => {
      try {
        return await summarizeConversation({ client, model, text, signal });
      } catch {
        return fallbackSummary(text);
      }
    });
    messages.length = 0;
    messages.push(...compressed);
    const after = estimateTokens(messages);
    onEvent({
      type: 'text_delta',
      delta: `[context compressed: ${before} → ${after} tokens]\n`,
    });
  } catch (e) {
    onEvent({ type: 'text_delta', delta: `[context compression failed: ${(e as Error).message}]\n` });
  }
  onEvent({ type: 'phase', phase: 'executing' });  // 回到 executing 等待下一轮
}
```

### 2.7 L2/L3 护栏位置

```ts
// loop.ts 顶部 llmTurns/toolCalls 计数器
let llmTurns = 0;
let toolCalls = 0;
let compressions = 0;
let hotCuts = 0;

// 调 LLM 之前
llmTurns++;
if (limits.maxTurns && llmTurns > limits.maxTurns) {
  onEvent({
    type: 'error',
    error: `Reached maxTurns=${limits.maxTurns}; stopping.`,
  });
  onEvent({ type: 'done', finishReason: 'limit' });
  return { messages, finishReason: 'limit', metrics: { llmTurns, toolCalls, compressions, hotCuts } };
}

// hot cut 在 LLM 调用前
if (estimateTokens(messages) > maxContextTokens) {
  const r = hotCut(messages, maxContextTokens);
  if (r.cutCount > 0) {
    hotCuts++;
    onEvent({ type: 'text_delta', delta: `[hot-cut: ${r.cutCount} messages truncated]\n` });
  }
}

// tool 实际执行前
if (limits.maxToolCalls && toolCalls >= limits.maxToolCalls) {
  onEvent({
    type: 'error',
    error: `Reached maxToolCalls=${limits.maxToolCalls}; stopping.`,
  });
  onEvent({ type: 'done', finishReason: 'limit' });
  return { ... };
}
```

---

## 3. 关键不变量

1. **resource guard 退出路径**:`finishReason: 'limit'` 是合法退出,**不**走 error 通道(用户能区分"模型主动停"和"超限强停")
2. **system + 最近 1 条 user 不被砍**(hot cut)
3. **compressing phase 不计入 llmTurns**(它不调 LLM)
4. **hot cut 只改 content 标 marker,不动 message 在数组中的位置**(LLM 看历史时不会"上一条 tool_call 找不到")
5. **资源超限必 emit `error` 事件 + `done: 'limit'` 事件**(双事件,UI 和审计都能拿到)
6. **metrics 必返回**(即使在 limit / error 路径)
7. **fallback 失败再 fallback**:`summarizeConversation` 失败 → `fallbackSummary`(截断);`fallbackSummary` 也失败 → hot cut 兜底

---

## 4. 测试覆盖

新增 ~12 个 it:

| 文件 | it |
|---|---|
| `src/__tests__/loop.test.ts` | `maxTurns 触发后 stop with finishReason=limit`<br>`maxToolCalls 触发后 stop`<br>`mid-turn 压缩:tool_call_end 后压一次再调 LLM`<br>`hot cut 在 LLM 调用前自动裁`<br>`hot cut 不砍 system`<br>`hot cut 不砍最近 1 条 user`<br>`metrics 在正常 stop 路径下正确返回`<br>`metrics 在 limit 路径下也正确返回` |
| `src/__tests__/hotCut.test.ts`(新) | `空 messages 返回 cutCount=0`<br>`短 messages 不切`<br>`长 tool messages 切到 ≤ 0.85 * maxContextTokens`<br>`system 永远保留`<br>`最近 user 保留`<br>`切完 message 还在原位(只改 content)` |
| `src/__tests__/config.test.ts` | `AGENT_MAX_TURNS / AGENT_MAX_TOOL_CALLS 解析`<br>`CLI --max-turns 覆盖` |

---

## 5. 风险与缓解

| 风险 | 缓解 |
|---|---|
| mid-turn 压缩让 LLM 困惑(它刚刚说"读 file X"然后被压掉) | 压缩保留最近 6 条(含当前 tool_call) → LLM 仍能看到上下文 |
| hot cut 标 marker 让 LLM 看不到 tool 结果 | marker 文案明确写"[truncated for context window]",LLM 知道是系统裁的不用回复 |
| maxTurns 太小导致正常任务被强停 | 默认 12,够大多数 ReAct 循环;CLI 可调 |
| `compress` 失败但 still 继续 LLM 调用 | fallback 路径是 `fallbackSummary`(简单截断);再失败 hot cut 兜底;L4 是 hard limit |
| UI 状态栏 phase 切换闪烁 | compressing 通常 < 1s,内部 setInterval 1s 刷新,人类感知不到 |

---

## 6. 关键文件清单

| 路径 | 改动 |
|---|---|
| `src/agent/types.ts` | `AgentEvent.phase` 加 `'compressing'`;`RunTurnInput` 加 `limits`;`RunTurnResult` 加 `metrics` + `finishReason` 加 `'limit'` |
| `src/agent/loop.ts` | 4 处逻辑:counters / L2 L3 / L1 mid-turn / L4 hot cut |
| `src/agent/hotCut.ts` | **新**:`hotCut(messages, maxContextTokens)` |
| `src/agent/context.ts` | 微调:`shouldCompress` 接受 metric 起点 |
| `src/agent/summarizer.ts` | 不变 |
| `src/components/HeadStatus.tsx` | 加 `compressing` phase 渲染分支(进度 + 耗时) |
| `src/app.tsx` | applyEvent 跟踪 `compressing` 进度;audit sink 加 `metrics` |
| `src/config.ts` | `Config` 加 `maxTurns` / `maxToolCalls`;env 解析 |
| `src/cli.tsx` | `--max-turns` / `--max-tool-calls` flag |
| `src/__tests__/hotCut.test.ts` | **新** |
| `src/__tests__/loop.test.ts` | +5 个 it |
| `src/__tests__/config.test.ts` | +2 个 it |
| `README.md` / `README.en.md` | 工具 / 配置表加 `maxTurns` / `maxToolCalls` |
| `CHANGELOG.md` | 0.2.0 节 |

---

## 7. 验收

```bash
npm run typecheck
npm test           # 现有 123 + 新增 12 = 135 个 it
```

smoke:
```bash
# 验证 mid-turn 压缩 + maxTurns 退出
AGENT_MAX_TURNS=3 npm run dev -- "读 10 个文件然后写一个总结"
# 期望:前 3 turn 看到 [context compressed: ...] 提示,3 turn 后 finishReason=limit

# 验证 hot cut
npm run dev -- --max-turns 5 "读大文件直到超限"
# 期望:看到 [hot-cut: N messages truncated] 提示,继续跑
```

---

## 8. 不在本期范围

- 多 session 合并视图
- session 持久化(`.agent/sessions/*.json`)
- token 计量上报(usage 已有但 UI 不展示累计)
- 自动从零开始的 sub-agent 调度
- run_tests 白名单工具
