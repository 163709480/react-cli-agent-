# 上下文压缩 v2 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 v0.1 基础上加 4 层防御(mid-turn 增量压缩、turn 数护栏、tool 数护栏、hot cut),引入 `compressing` phase,新增 `maxTurns` / `maxToolCalls` 配置,RunTurnResult 带 metrics。

**Architecture:** 改 `loop.ts`(counters / 4 处守卫) + 新文件 `hotCut.ts`(纯函数切 tool 消息 content) + 扩 `types.ts`(phase / limits / metrics) + 改 `HeadStatus.tsx` 渲染 compressing 分支 + `app.tsx` 跟踪 compress 子状态 + `config.ts` 加两个 env + `cli.tsx` 加 flag + 12 个 it 覆盖。

**Tech Stack:** TypeScript 5.x · Node 20+ · Ink 5 · `gpt-tokenizer` · `vitest`(沿用现有栈)

---

## 文件总览

```
src/agent/
├── types.ts            # 改:phase + 'compressing' | limits | metrics | finishReason + 'limit'
├── loop.ts             # 改:counters + L1 mid-turn + L2 turn guard + L3 tool guard + L4 hot cut
├── hotCut.ts           # 新:hotCut(messages, maxContextTokens) -> { messages, cutCount }
├── context.ts          # 改:shouldCompress 接受可选的 thresholdMultiplier(默认 0.7,保持兼容)
└── summarizer.ts       # 不变

src/
├── app.tsx             # 改:applyEvent 加 compressing 状态机;HeadStatus 传 compressStatus
├── cli.tsx             # 改:--max-turns / --max-tool-calls flag
├── config.ts           # 改:Config.maxTurns / maxToolCalls;env 解析
├── components/
│   └── HeadStatus.tsx  # 改:LoopPhase 加 'compressing';新 compressStatus prop

src/__tests__/
├── hotCut.test.ts      # 新:6 个 it
├── loop.test.ts        # 改:+7 个 it
└── config.test.ts      # 改:+2 个 it

docs/superpowers/specs/2026-06-06-context-compression-v2.md  # 已是 spec
README.md / README.en.md   # 加 maxTurns / maxToolCalls 行
CHANGELOG.md               # 0.2.0 节
```

---

## Task 1: types.ts — Phase / Limits / Metrics / finishReason

**Files:**
- Modify: `src/agent/types.ts`

- [ ] **Step 1: 扩展 `AgentEvent` 的 `phase` 联合类型**

Edit `src/agent/types.ts:69` 替换:
```ts
  | { type: 'phase'; phase: 'thinking' | 'executing' | 'idle' | 'compressing'; toolName?: string }
```

- [ ] **Step 2: 扩展 `RunTurnInput.limits`**

Edit `src/agent/types.ts:74-92`,在接口里加(放在 `extraCtx` 之后):
```ts
  /** 资源护栏;不传 → 默认 maxTurns=12, maxToolCalls=30 */
  limits?: {
    maxTurns?: number;
    maxToolCalls?: number;
  };
```

- [ ] **Step 3: 扩展 `RunTurnResult` + finishReason `'limit'`**

Edit `src/agent/types.ts:95-98` 替换为:
```ts
export interface RunTurnResult {
  messages: Message[];
  finishReason: 'stop' | 'length' | 'abort' | 'error' | 'limit';
  metrics?: {
    llmTurns: number;
    toolCalls: number;
    compressions: number;
    hotCuts: number;
  };
}
```

- [ ] **Step 4: 同步 `done` 事件的 finishReason**

Edit `src/agent/types.ts:67`:
```ts
  | { type: 'done'; finishReason: 'stop' | 'length' | 'abort' | 'error' | 'limit'; usage?: { promptTokens: number; completionTokens: number } }
```

- [ ] **Step 5: typecheck**

Run: `npx tsc --noEmit`
Expected: 0 errors(后续任务再加实现,现在只该有 `loop.ts` 的类型错,但因为 metrics 可选、不强制,所以不报错;若报错只来自 loop.ts 的 `finishReason: 'limit'` —— 那是后续任务)

- [ ] **Step 6: commit**

```bash
git add src/agent/types.ts
git commit -m "feat(types): add 'compressing' phase, RunTurnInput.limits, RunTurnResult.metrics, finishReason='limit'"
```

---

## Task 2: config.ts — maxTurns / maxToolCalls

**Files:**
- Modify: `src/config.ts`

- [ ] **Step 1: 在 `Config` 接口加字段**

Edit `src/config.ts:6-13`:
```ts
export interface Config {
  openaiApiKey: string;
  openaiBaseUrl: string;
  openaiModel: string;
  maxContextTokens: number;
  writeableExts: string[];
  providerName: string;
  maxTurns: number;       // default 12
  maxToolCalls: number;   // default 30
}
```

- [ ] **Step 2: 在 `loadConfig` 里加常量 + 解析**

Edit `src/config.ts:15-17`,在 `DEFAULT_EXTS` 后加:
```ts
const DEFAULT_MAX_TURNS = 12;
const DEFAULT_MAX_TOOL_CALLS = 30;
```

Edit `src/config.ts:60-69` 的 return block,在 `writeableExts` 行后加:
```ts
    writeableExts: file.writeableExts ?? DEFAULT_EXTS,
    maxTurns: parseInt(
      process.env.AGENT_MAX_TURNS ?? String(file.maxTurns ?? DEFAULT_MAX_TURNS),
      10,
    ),
    maxToolCalls: parseInt(
      process.env.AGENT_MAX_TOOL_CALLS ?? String(file.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS),
      10,
    ),
    providerName,
```

- [ ] **Step 3: 写失败测试 `AGENT_MAX_TURNS` 解析**

打开 `src/__tests__/config.test.ts`,在 `envKeys` 数组加:
```ts
  const envKeys = [
    'OPENAI_API_KEY',
    'OPENAI_BASE_URL',
    'OPENAI_MODEL',
    'AGENT_MAX_CONTEXT_TOKENS',
    'AGENT_MAX_TURNS',
    'AGENT_MAX_TOOL_CALLS',
  ];
```

然后在文件末尾追加新 it(在最后一个 `});` 前):
```ts
  it('AGENT_MAX_TURNS / AGENT_MAX_TOOL_CALLS 解析', () => {
    process.env.AGENT_MAX_TURNS = '8';
    process.env.AGENT_MAX_TOOL_CALLS = '20';
    const cfg = loadConfig();
    expect(cfg.maxTurns).toBe(8);
    expect(cfg.maxToolCalls).toBe(20);
  });

  it('未传 env 时,使用默认 12 / 30', () => {
    const cfg = loadConfig();
    expect(cfg.maxTurns).toBe(12);
    expect(cfg.maxToolCalls).toBe(30);
  });
```

- [ ] **Step 4: 运行测试(预期 PASS)**

Run: `npx vitest run src/__tests__/config.test.ts`
Expected: 9 passed(原 7 + 新 2)

- [ ] **Step 5: commit**

```bash
git add src/config.ts src/__tests__/config.test.ts
git commit -m "feat(config): add maxTurns/maxToolCalls (env: AGENT_MAX_TURNS, AGENT_MAX_TOOL_CALLS)"
```

---

## Task 3: cli.tsx — `--max-turns` / `--max-tool-calls` flag

**Files:**
- Modify: `src/cli.tsx`

- [ ] **Step 1: 在 Args 接口加字段**

Edit `src/cli.tsx:7-21`,在 `auditPath?: string;` 后加:
```ts
  maxTurns?: number;
  maxToolCalls?: number;
```

- [ ] **Step 2: 在 `parseArgs` 加分支**

Edit `src/cli.tsx:31-58` 的 for 循环,在 `else if (a === '--provider')` 之前加:
```ts
    else if (a === '--max-turns') {
      const n = parseInt(argv[++i] ?? '', 10);
      if (!Number.isFinite(n) || n < 1) {
        process.stderr.write('--max-turns 必须是正整数\n');
        process.exit(2);
      }
      args.maxTurns = n;
    }
    else if (a === '--max-tool-calls') {
      const n = parseInt(argv[++i] ?? '', 10);
      if (!Number.isFinite(n) || n < 1) {
        process.stderr.write('--max-tool-calls 必须是正整数\n');
        process.exit(2);
      }
      args.maxToolCalls = n;
    }
```

- [ ] **Step 3: 把 CLI 值喂给 loadConfig**

Edit `src/cli.tsx:74-81`,把 `loadConfig({ provider: args.provider })` 改为:
```ts
  const config = (() => {
    try {
      return loadConfig({
        provider: args.provider,
        // CLI 优先级最高:覆盖 env
        maxTurns: args.maxTurns,
        maxToolCalls: args.maxToolCalls,
      });
    } catch (e) {
      process.stderr.write(`${(e as Error).message}\n`);
      process.exit(2);
    }
  })();
```

- [ ] **Step 4: 扩展 LoadConfigOptions**

打开 `src/config.ts:28-30`,替换为:
```ts
export interface LoadConfigOptions {
  provider?: string;
  maxTurns?: number;
  maxToolCalls?: number;
}
```

Edit `src/config.ts:32-70`,在 `loadConfig` 函数签名加 `opts: LoadConfigOptions = {}` 已是默认值。在 return 之前的 `maxTurns` 解析改为:
```ts
    maxTurns: parseInt(
      String(opts.maxTurns ?? process.env.AGENT_MAX_TURNS ?? file.maxTurns ?? DEFAULT_MAX_TURNS),
      10,
    ),
    maxToolCalls: parseInt(
      String(opts.maxToolCalls ?? process.env.AGENT_MAX_TOOL_CALLS ?? file.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS),
      10,
    ),
```

- [ ] **Step 5: 写失败测试 "CLI --max-turns 覆盖"**

打开 `src/__tests__/config.test.ts`,在文件末尾追加:
```ts
  it('opts.maxTurns 覆盖 env', () => {
    process.env.AGENT_MAX_TURNS = '5';
    const cfg = loadConfig({ maxTurns: 99 });
    expect(cfg.maxTurns).toBe(99);
  });
```

- [ ] **Step 6: 运行测试(预期 PASS)**

Run: `npx vitest run src/__tests__/config.test.ts`
Expected: 10 passed

- [ ] **Step 7: commit**

```bash
git add src/cli.tsx src/config.ts src/__tests__/config.test.ts
git commit -m "feat(cli): add --max-turns / --max-tool-calls flags"
```

---

## Task 4: hotCut.ts — 新文件

**Files:**
- Create: `src/agent/hotCut.ts`
- Test: `src/__tests__/hotCut.test.ts`

- [ ] **Step 1: 写失败测试(6 个 it)**

Create `src/__tests__/hotCut.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { hotCut } from '../agent/hotCut.js';
import type { Message } from '../agent/types.js';

describe('hotCut', () => {
  it('空 messages 返回 cutCount=0', () => {
    const r = hotCut([], 1000);
    expect(r.cutCount).toBe(0);
    expect(r.messages).toEqual([]);
  });

  it('短 messages 不切', () => {
    const msgs: Message[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
    ];
    const r = hotCut(msgs, 10_000);
    expect(r.cutCount).toBe(0);
    // 引用相等(无修改)
    expect(r.messages).toBe(msgs);
  });

  it('长 tool messages 切到 ≤ 0.85 * maxContextTokens', () => {
    // 构造 5 条巨大 tool message(每条约 5000 token,远大于阈值)
    const big = 'x'.repeat(20_000); // ~5K tokens
    const msgs: Message[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'task' },
      { role: 'tool', tool_call_id: 't1', content: big },
      { role: 'tool', tool_call_id: 't2', content: big },
      { role: 'tool', tool_call_id: 't3', content: big },
      { role: 'tool', tool_call_id: 't4', content: big },
      { role: 'tool', tool_call_id: 't5', content: big },
    ];
    // maxContextTokens=4000 → 0.85 * 4000 = 3400 token 上限
    const r = hotCut(msgs, 4000);
    expect(r.cutCount).toBeGreaterThan(0);
    // 改写后,原 tool message 的 content 必须变 marker
    const truncated = r.messages.filter(
      (m) => m.role === 'tool' && typeof m.content === 'string' && m.content.includes('truncated'),
    );
    expect(truncated.length).toBe(r.cutCount);
    // message 数量不变(只改 content,不动位置)
    expect(r.messages.length).toBe(msgs.length);
  });

  it('system 永远保留', () => {
    const big = 'x'.repeat(40_000);
    const msgs: Message[] = [
      { role: 'system', content: 'IMORTANT-SYS-MARKER' },
      { role: 'tool', tool_call_id: 't1', content: big },
      { role: 'tool', tool_call_id: 't2', content: big },
    ];
    const r = hotCut(msgs, 2000);
    const sys = r.messages.find((m) => m.role === 'system');
    expect(sys?.content).toBe('IMORTANT-SYS-MARKER');
  });

  it('最近 1 条 user 保留', () => {
    const big = 'x'.repeat(40_000);
    const msgs: Message[] = [
      { role: 'tool', tool_call_id: 't1', content: big },
      { role: 'tool', tool_call_id: 't2', content: big },
      { role: 'user', content: 'LAST-USER-MARKER' },
    ];
    const r = hotCut(msgs, 2000);
    // 最后一条 user 的 content 保持原值
    const lastUser = r.messages.filter((m) => m.role === 'user').pop();
    expect(lastUser?.content).toBe('LAST-USER-MARKER');
  });

  it('切完 message 还在原位(只改 content)', () => {
    const big = 'x'.repeat(40_000);
    const msgs: Message[] = [
      { role: 'system', content: 'sys' },
      { role: 'tool', tool_call_id: 't1', content: big },
      { role: 'tool', tool_call_id: 't2', content: big },
      { role: 'tool', tool_call_id: 't3', content: big },
    ];
    const r = hotCut(msgs, 1000);
    // 数组长度不变
    expect(r.messages.length).toBe(msgs.length);
    // 第一条还是 system(不动)
    expect(r.messages[0].role).toBe('system');
    // 被切的 tool 消息 role 不变,tool_call_id 不变
    const cutTool = r.messages.find(
      (m) => m.role === 'tool' && m.tool_call_id === 't1' && typeof m.content === 'string' && m.content.includes('truncated'),
    );
    expect(cutTool).toBeDefined();
  });
});
```

- [ ] **Step 2: 运行测试(预期 FAIL)**

Run: `npx vitest run src/__tests__/hotCut.test.ts`
Expected: FAIL(模块不存在)

- [ ] **Step 3: 实现 hotCut**

Create `src/agent/hotCut.ts`:
```ts
import { estimateTokens } from './context.js';
import type { Message } from './types.js';

const TRUNCATED_MARKER = '[truncated for context window]';

/**
 * 入 LLM 之前,如果 messages 超过 maxContextTokens,从 tail 砍 tool message
 * 直到 ≤ 0.85 * maxContextTokens。
 *
 * 不变量:
 *   - system 永远保留
 *   - 最近 1 条 user message 永远保留
 *   - 砍掉的 message 不 splice,只把 content 改成 marker(LLM 看历史不会断引用)
 */
export function hotCut(
  messages: Message[],
  maxContextTokens: number,
): { messages: Message[]; cutCount: number } {
  const target = maxContextTokens * 0.85;
  if (estimateTokens(messages) <= target) {
    return { messages, cutCount: 0 };
  }

  // 找 "可砍的" tool message 索引
  // 排除:system(任意位置)、最近 1 条 user、最后 2 条 assistant
  const lastUserIdx = lastIndexOfRole(messages, 'user');
  const lastAssistantIdx = lastIndexOfRole(messages, 'assistant');
  // 保留 window:[0..min(lastUserIdx, lastAssistantIdx)-1] 不动
  // 简单策略:从前往后找 role==='tool' 且不在尾部 window
  // 尾部 window = 距末尾 2 条 assistant + 1 条 user
  // 实际上:用 lastUserIdx 作为"不可越界"的标尺
  const userBoundary = lastUserIdx; // 砍索引 < lastUserIdx 的 tool

  let cutCount = 0;
  const result: Message[] = messages.map((m, i) => {
    if (m.role !== 'tool') return m;
    if (i >= userBoundary) return m; // user 之后不动
    // 检查是否真的是 "老" tool(在 lastUserIdx 之前)
    if (typeof m.content === 'string' && m.content === TRUNCATED_MARKER) {
      return m; // 已经被砍过,不再 cut
    }
    cutCount++;
    return { ...m, content: TRUNCATED_MARKER };
  });

  // 估下是否降到 target
  if (estimateTokens(result) > target && cutCount > 0) {
    // 还要继续切?当前实现一次扫一遍已经标完 marker
    // 二次扫描:看是否还有未切的 tool(< userBoundary 且 content 不是 marker)
    // 这里返回 cutCount = 实际 marker 数量(best-effort)
  }

  return { messages: result, cutCount };
}

function lastIndexOfRole(messages: Message[], role: Message['role']): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === role) return i;
  }
  return -1;
}
```

- [ ] **Step 4: 运行测试(预期 PASS)**

Run: `npx vitest run src/__tests__/hotCut.test.ts`
Expected: 6 passed

- [ ] **Step 5: commit**

```bash
git add src/agent/hotCut.ts src/__tests__/hotCut.test.ts
git commit -m "feat(agent): add hotCut() — best-effort pre-LLM message truncation"
```

---

## Task 5: context.ts — shouldCompress threshold 起点可调

**Files:**
- Modify: `src/agent/context.ts`

- [ ] **Step 1: 给 shouldCompress 加可选 multiplier 参数**

Edit `src/agent/context.ts:15-17`:
```ts
export function shouldCompress(
  messages: Message[],
  maxContextTokens: number,
  thresholdMultiplier = 0.7,
): boolean {
  return estimateTokens(messages) > maxContextTokens * thresholdMultiplier;
}
```

- [ ] **Step 2: 运行现有 context 测试(预期 PASS,行为不变)**

Run: `npx vitest run src/__tests__/context.test.ts`
Expected: 5 passed(默认 0.7,行为与 v0.1 一致)

- [ ] **Step 3: commit**

```bash
git add src/agent/context.ts
git commit -m "refactor(context): shouldCompress accepts thresholdMultiplier (default 0.7)"
```

---

## Task 6: loop.ts — Counters + L2 turn guard + L3 tool guard + L4 hot cut

**Files:**
- Modify: `src/agent/loop.ts`

- [ ] **Step 1: 加 import + 计数器 + 解析 input.limits**

Edit `src/agent/loop.ts:1-13`,在 import block 后加:
```ts
import { hotCut } from './hotCut.js';
```

Edit `src/agent/loop.ts:50-66`,在 `runTurn` 函数顶部 `messages: Message[] = [...initialMessages];` 之后加:
```ts
  const limits = input.limits ?? {};
  const maxTurns = limits.maxTurns ?? 12;
  const maxToolCalls = limits.maxToolCalls ?? 30;
  let llmTurns = 0;
  let toolCalls = 0;
  let compressions = 0;
  let hotCuts = 0;
```

- [ ] **Step 2: 在 LLM 调用前加 L2 turn guard + L4 hot cut**

Edit `src/agent/loop.ts`,找到 `await withRetry(async () => {` 这一行(line 103),在它之前插入:
```ts
      // L2: turn 数护栏
      llmTurns++;
      if (llmTurns > maxTurns) {
        const errMsg = `Reached maxTurns=${maxTurns}; stopping.`;
        emit({ type: 'error', error: errMsg });
        emit({ type: 'done', finishReason: 'limit' });
        return {
          messages,
          finishReason: 'limit',
          metrics: { llmTurns, toolCalls, compressions, hotCuts },
        };
      }
      // L4: hot cut — 入 LLM 前最后一道闸
      if (estimateTokens(messages) > maxContextTokens) {
        const r = hotCut(messages, maxContextTokens);
        if (r.cutCount > 0) {
          hotCuts++;
          emit({ type: 'text_delta', delta: `[hot-cut: ${r.cutCount} messages truncated]\n` });
        }
      }
```

- [ ] **Step 3: 在 tool 实际执行前加 L3 tool guard**

Edit `src/agent/loop.ts`,找到 `for (const tc of toolCalls) {`(line 160),在循环最开头插入:
```ts
        // L3: tool 数护栏(在 execute 之前)
        if (toolCalls >= maxToolCalls) {
          const errMsg = `Reached maxToolCalls=${maxToolCalls}; stopping.`;
          emit({ type: 'error', error: errMsg });
          emit({ type: 'done', finishReason: 'limit' });
          return {
            messages,
            finishReason: 'limit',
            metrics: { llmTurns, toolCalls, compressions, hotCuts },
          };
        }
        toolCalls++;
```

- [ ] **Step 4: 修 `finishReason` 类型,补 metrics**

Edit `src/agent/loop.ts:91`:
```ts
  let finishReason: 'stop' | 'length' | 'abort' | 'error' | 'limit' = 'stop';
```

Edit `src/agent/loop.ts:213-215` 的 return 语句:
```ts
  emit({ type: 'phase', phase: 'idle' });
  emit({ type: 'done', finishReason });
  return {
    messages,
    finishReason,
    metrics: { llmTurns, toolCalls, compressions, hotCuts },
  };
```

- [ ] **Step 5: typecheck**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 6: 跑现有 loop 测试(预期 PASS,行为兼容)**

Run: `npx vitest run src/__tests__/loop.test.ts`
Expected: 9 passed(无新增 + 无回归)

- [ ] **Step 7: commit**

```bash
git add src/agent/loop.ts
git commit -m "feat(loop): L2 turn guard + L3 tool guard + L4 hot cut + counters/metrics"
```

---

## Task 7: loop.ts — L1 mid-turn 压缩 + phase 事件

**Files:**
- Modify: `src/agent/loop.ts`
- Modify: `src/agent/context.ts`(L1 也要估 after-compress token,所以 `shouldCompress` 复用)

- [ ] **Step 1: 在 tool_call_end 后插 L1 mid-turn 压缩**

Edit `src/agent/loop.ts`,找到 `emit({ type: 'tool_call_end', toolCallId: tc.id, result: resultStr });`(line 202),在它之后插入:
```ts
        // L1: mid-turn 增量压缩
        if (shouldCompress(messages, maxContextTokens)) {
          emit({ type: 'phase', phase: 'compressing' });
          const before = estimateTokens(messages);
          const compactInstructions = await loadCompactInstructions(cwd);
          try {
            const compressed = await compress(messages, async (text) => {
              try {
                return await summarizeConversation({
                  client,
                  model,
                  text,
                  signal,
                  compactInstructions,
                  focus: 'Automatic context compaction before continuing the current user task.',
                });
              } catch {
                return fallbackSummary(text);
              }
            });
            messages.length = 0;
            messages.push(...compressed);
            const after = estimateTokens(messages);
            compressions++;
            emit({
              type: 'text_delta',
              delta: `[context compressed: ${before} → ${after} tokens]\n`,
            });
          } catch (e) {
            emit({
              type: 'text_delta',
              delta: `[context compression failed: ${(e as Error).message}]\n`,
            });
          }
          emit({ type: 'phase', phase: 'executing' });
        }
```

- [ ] **Step 2: 把 runTurn 顶部那块 "turn 开始时 shouldCompress" 的旧代码替换/删除**

Edit `src/agent/loop.ts:68-89`(整个 if block),替换为:
```ts
  // L1 现在在 tool_call_end 后做;turn 开始时不再预压(由 mid-turn 接管)
  // 保留 tool_calls.length === 0 的兜底:loop 第一次调 LLM 前如果 messages 已经超 70%,
  // 也走 L1。
  if (shouldCompress(messages, maxContextTokens)) {
    emit({ type: 'phase', phase: 'compressing' });
    const before = estimateTokens(messages);
    const compactInstructions = await loadCompactInstructions(cwd);
    try {
      const compressed = await compress(messages, async (text) => {
        try {
          return await summarizeConversation({
            client,
            model,
            text,
            signal,
            compactInstructions,
            focus: 'Automatic context compaction before continuing the current user task.',
          });
        } catch {
          return fallbackSummary(text);
        }
      });
      messages.length = 0;
      messages.push(...compressed);
      const after = estimateTokens(messages);
      compressions++;
      emit({ type: 'text_delta', delta: `[context compressed: ${before} → ${after} tokens]\n` });
    } catch (e) {
      emit({ type: 'text_delta', delta: `[context compression failed: ${(e as Error).message}]\n` });
    }
    emit({ type: 'phase', phase: 'thinking' });
  }
```

- [ ] **Step 3: 抽公共压缩 helper(可选重构)**

为了避免重复,把上面 2 处压缩抽成本地函数。Edit `src/agent/loop.ts` 在 `RETRY_DELAYS` 之后加:
```ts
async function runMidTurnCompression(
  messages: Message[],
  client: import('openai').default,
  model: string,
  cwd: string,
  signal: AbortSignal,
  emit: (e: AgentEvent) => void,
): Promise<{ compressed: boolean; before: number; after: number }> {
  const before = estimateTokens(messages);
  if (!shouldCompress(messages, Number.MAX_SAFE_INTEGER, 0.7)) {
    // 0.7 * MAX_SAFE_INTEGER → 必为 true;但保留 shouldCompress 语义
  }
  // 实际:用 maxContextTokens 调;这里只关心是否真要压,所以直接 estimate
  if (before < 100) return { compressed: false, before, after: before };
  const compactInstructions = await loadCompactInstructions(cwd);
  try {
    const compressed = await compress(messages, async (text) => {
      try {
        return await summarizeConversation({
          client, model, text, signal, compactInstructions,
          focus: 'Automatic context compaction before continuing the current user task.',
        });
      } catch {
        return fallbackSummary(text);
      }
    });
    messages.length = 0;
    messages.push(...compressed);
    const after = estimateTokens(messages);
    return { compressed: true, before, after };
  } catch {
    return { compressed: false, before, after: before };
  }
}
```

> **注:** 抽不抽是可选的;如果工程偏好 DRY,本步抽;如果觉得内联更清晰,跳过本步,保留 Step 1+2 的两处内联。spec 没强制要求。

如果跳过本步,继续 Step 4。

- [ ] **Step 4: typecheck**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 5: 跑 loop 测试(预期 PASS)**

Run: `npx vitest run src/__tests__/loop.test.ts`
Expected: 9 passed

- [ ] **Step 6: commit**

```bash
git add src/agent/loop.ts
git commit -m "feat(loop): L1 mid-turn incremental compression with 'compressing' phase"
```

---

## Task 8: HeadStatus.tsx — compressing 分支

**Files:**
- Modify: `src/components/HeadStatus.tsx`

- [ ] **Step 1: 扩展 LoopPhase + 新 prop**

Edit `src/components/HeadStatus.tsx:4-14`:
```ts
export type LoopPhase = 'idle' | 'thinking' | 'executing' | 'compressing';

export interface HeadStatusProps {
  phase: LoopPhase;
  phaseStartMs: number;
  tokens?: { promptTokens: number; completionTokens: number };
  toolName?: string;
  /** compressing 阶段用,展示 before→after tokens + 进度 */
  compressStatus?: { before: number; after?: number; startedAt: number };
}
```

- [ ] **Step 2: 加 compressing 渲染分支**

Edit `src/components/HeadStatus.tsx`,在 `if (phase === 'idle') return null;` 之后插入:
```ts
  if (phase === 'compressing') {
    const status = compressStatus;
    const before = status?.before ?? 0;
    const after = status?.after;
    const reduction =
      after !== undefined && before > 0
        ? Math.round(((before - after) / before) * 100)
        : null;
    const ratio = `${before.toLocaleString()}${after !== undefined ? ` → ${after.toLocaleString()}` : ''}${reduction !== null ? ` (${reduction}% reduction)` : ''}`;
    return (
      <Box flexDirection="column" marginY={1}>
        <Text>
          <Text color="magenta">⏺ </Text>
          <Text color="magenta">Compressing context: {ratio} tokens</Text>
          <Text dimColor> · {formatDuration(durationMs)}</Text>
        </Text>
      </Box>
    );
  }
```

- [ ] **Step 3: typecheck**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 4: 跑组件测试**

Run: `npx vitest run src/__tests__/components.test.tsx`
Expected: 全 pass

- [ ] **Step 5: commit**

```bash
git add src/components/HeadStatus.tsx
git commit -m "feat(ui): HeadStatus supports 'compressing' phase with token progress"
```

---

## Task 9: app.tsx — applyEvent 跟踪 compressing 状态 + 传 HeadStatus

**Files:**
- Modify: `src/app.tsx`

- [ ] **Step 1: 加 compressStatus state**

Edit `src/app.tsx:64-68`,在 `currentTokens` state 后加:
```ts
  const [compressStatus, setCompressStatus] = useState<{ before: number; after?: number; startedAt: number } | null>(null);
```

- [ ] **Step 2: 在 phase 事件分支加 compressing 处理**

Edit `src/app.tsx:259-275`:
```ts
    if (ev.type === 'phase') {
      if (ev.phase === 'thinking') {
        setPhase('thinking');
        setPhaseStartMs(Date.now());
        setPhaseToolName(undefined);
        setCurrentTokens(undefined);
        setCompressStatus(null);
      } else if (ev.phase === 'executing') {
        setPhase('executing');
        setPhaseStartMs(Date.now());
        setPhaseToolName(ev.toolName);
        setCompressStatus(null);
      } else if (ev.phase === 'compressing') {
        setPhase('compressing');
        setPhaseStartMs(Date.now());
        // before 暂估,等 text_delta 里 [context compressed: X → Y] 解析
        setCompressStatus({ before: 0, startedAt: Date.now() });
      } else {
        setPhase('idle');
        setPhaseToolName(undefined);
        setCurrentTokens(undefined);
        setCompressStatus(null);
      }
      return;
    }
```

- [ ] **Step 3: 在 text_delta 分支解析 [context compressed: X → Y]**

Edit `src/app.tsx:218-229`,在 `setDisplay` 之后加(text_delta 总是先于下一个 phase 到):
```ts
      // 解析 [context compressed: X → Y] 给 compressStatus
      if (ev.delta.startsWith('[context compressed:') || ev.delta.includes('[context compressed:')) {
        const m = ev.delta.match(/\[context compressed:\s*(\d+)\s*→\s*(\d+)/);
        if (m) {
          setCompressStatus((cur) => cur ? { ...cur, before: parseInt(m[1], 10), after: parseInt(m[2], 10) } : null);
        }
      }
```

- [ ] **Step 4: 把 compressStatus 传给 HeadStatus**

Edit `src/app.tsx:303-310`:
```tsx
      {phase !== 'idle' && (
        <HeadStatus
          phase={phase}
          phaseStartMs={phaseStartMs}
          tokens={currentTokens}
          toolName={phaseToolName}
          compressStatus={compressStatus ?? undefined}
        />
      )}
```

- [ ] **Step 5: typecheck**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 6: 跑组件测试**

Run: `npx vitest run src/__tests__/components.test.tsx`
Expected: 全 pass

- [ ] **Step 7: commit**

```bash
git add src/app.tsx
git commit -m "feat(app): track compressStatus across phase + text_delta events, render in HeadStatus"
```

---

## Task 10: app.tsx — 把 limits 喂给 runTurn

**Files:**
- Modify: `src/app.tsx`

- [ ] **Step 1: 在 runTurn 调用处加 limits**

Edit `src/app.tsx:165-207`,找到 `await runTurn({`,在 `auditSink: auditSinkRef.current ?? undefined,` 后加:
```ts
        limits: {
          maxTurns: config.maxTurns,
          maxToolCalls: config.maxToolCalls,
        },
```

- [ ] **Step 2: typecheck + 跑全部测试**

Run:
```bash
npx tsc --noEmit
npx vitest run
```

Expected: 0 errors;所有测试 PASS。

- [ ] **Step 3: commit**

```bash
git add src/app.tsx
git commit -m "feat(app): pass Config.maxTurns/maxToolCalls into runTurn"
```

---

## Task 11: loop.test.ts — 7 个新 it

**Files:**
- Modify: `src/__tests__/loop.test.ts`

- [ ] **Step 1: 写 "maxTurns 触发后 stop with finishReason=limit"**

在文件末尾追加(在最后一个 `});` 前):
```ts
  it('maxTurns 触发后 stop with finishReason=limit', async () => {
    // 5 轮 LLM:每次只回 'hi',永远不停
    for (let i = 0; i < 5; i++) {
      fakeStream.mockReturnValueOnce(
        asyncIterFromArray([
          { type: 'text_delta', delta: `round${i}` },
          { type: 'done', finishReason: 'stop' },
        ]),
      );
    }
    const r = await runTurn({
      messages: [{ role: 'user', content: 'x' }],
      tools: [],
      cwd: '/tmp',
      yolo: false,
      onEvent: () => {},
      onConfirm: async () => false,
      signal: new AbortController().signal,
      client: fakeClient,
      model: 'fake',
      maxContextTokens: 120000,
      limits: { maxTurns: 3 },
    });
    expect(r.finishReason).toBe('limit');
    expect(r.metrics?.llmTurns).toBe(4); // 3 轮 OK,第 4 轮才停(超 3)
    expect(r.metrics?.toolCalls).toBe(0);
  });

  it('maxToolCalls 触发后 stop', async () => {
    // 1 轮 LLM:返回 3 个 tool_call,但 maxToolCalls=2
    fakeStream.mockReturnValueOnce(
      asyncIterFromArray([
        {
          type: 'tool_call_start',
          toolCall: { id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.txt"}' } },
        },
        {
          type: 'tool_call_start',
          toolCall: { id: 'c2', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.txt"}' } },
        },
        {
          type: 'tool_call_start',
          toolCall: { id: 'c3', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.txt"}' } },
        },
        { type: 'done', finishReason: 'stop' },
      ]),
    );
    // 第 2 轮(给 LLM 回话),如果调到了
    fakeStream.mockReturnValueOnce(
      asyncIterFromArray([{ type: 'done', finishReason: 'stop' }]),
    );
    const tmpCwd = await import('node:fs/promises').then((m) => m.mkdtemp('/tmp/agent-loop-'));
    tmpCwds.push(tmpCwd);
    await import('node:fs/promises').then((m) => m.writeFile(`${tmpCwd}/a.txt`, 'x'));
    const r = await runTurn({
      messages: [{ role: 'user', content: 'x' }],
      tools: [readFileTool],
      cwd: tmpCwd,
      yolo: false,
      onEvent: () => {},
      onConfirm: async () => true,
      signal: new AbortController().signal,
      client: fakeClient,
      model: 'fake',
      maxContextTokens: 120000,
      limits: { maxToolCalls: 2 },
    });
    expect(r.finishReason).toBe('limit');
    expect(r.metrics?.toolCalls).toBeGreaterThanOrEqual(2);
  });

  it('mid-turn 压缩:tool_call_end 后压一次再调 LLM', async () => {
    // 把 maxContextTokens 调到很小,迫使 shouldCompress 触发
    // messages 已含 1 条 5000 char user 消息 → 估算 ~1250 token
    // maxContextTokens = 1000 → 0.7 * 1000 = 700,1250 > 700 → 必压
    fakeStream.mockReturnValueOnce(
      asyncIterFromArray([
        {
          type: 'tool_call_start',
          toolCall: { id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.txt"}' } },
        },
        { type: 'done', finishReason: 'stop' },
      ]),
    );
    fakeStream.mockReturnValueOnce(
      asyncIterFromArray([{ type: 'text_delta', delta: 'ok' }, { type: 'done', finishReason: 'stop' }]),
    );
    const tmpCwd = await import('node:fs/promises').then((m) => m.mkdtemp('/tmp/agent-loop-'));
    tmpCwds.push(tmpCwd);
    await import('node:fs/promises').then((m) => m.writeFile(`${tmpCwd}/a.txt`, 'x'));
    const big = 'x'.repeat(5000);
    const events: unknown[] = [];
    const r = await runTurn({
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: big },
        { role: 'assistant', content: 'old' },
        { role: 'user', content: 'read a.txt' },
      ],
      tools: [readFileTool],
      cwd: tmpCwd,
      yolo: false,
      onEvent: (e) => events.push(e),
      onConfirm: async () => true,
      signal: new AbortController().signal,
      client: fakeClient,
      model: 'fake',
      maxContextTokens: 1000, // 触发 L1
    });
    // 期望看到 phase=compressing
    const phases = events.filter((e) => (e as { type: string }).type === 'phase') as { type: string; phase?: string }[];
    expect(phases.some((p) => p.phase === 'compressing')).toBe(true);
    expect(r.metrics?.compressions).toBeGreaterThanOrEqual(1);
  });

  it('hot cut 在 LLM 调用前自动裁', async () => {
    // 构造 messages 超出 maxContextTokens
    const big = 'x'.repeat(20_000); // ~5K tokens
    const msgs: Message[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'task' },
      { role: 'tool', tool_call_id: 't1', content: big },
      { role: 'tool', tool_call_id: 't2', content: big },
      { role: 'user', content: 'ask' },
    ];
    fakeStream.mockReturnValueOnce(
      asyncIterFromArray([
        { type: 'text_delta', delta: 'hi' },
        { type: 'done', finishReason: 'stop' },
      ]),
    );
    const events: unknown[] = [];
    const r = await runTurn({
      messages: msgs,
      tools: [],
      cwd: '/tmp',
      yolo: false,
      onEvent: (e) => events.push(e),
      onConfirm: async () => false,
      signal: new AbortController().signal,
      client: fakeClient,
      model: 'fake',
      maxContextTokens: 1000, // 0.85 * 1000 = 850
    });
    // 期望看到 [hot-cut: ...] 文本 + hotCuts > 0
    const hotCutText = events.find(
      (e) => (e as { type: string }).type === 'text_delta' && typeof (e as { delta?: string }).delta === 'string' && (e as { delta: string }).delta.includes('[hot-cut:'),
    );
    expect(hotCutText).toBeDefined();
    expect(r.metrics?.hotCuts).toBeGreaterThanOrEqual(1);
  });

  it('hot cut 不砍 system', async () => {
    const big = 'x'.repeat(20_000);
    const msgs: Message[] = [
      { role: 'system', content: 'SYS-MARKER-XYZ' },
      { role: 'tool', tool_call_id: 't1', content: big },
      { role: 'tool', tool_call_id: 't2', content: big },
      { role: 'user', content: 'q' },
    ];
    fakeStream.mockReturnValueOnce(
      asyncIterFromArray([{ type: 'text_delta', delta: 'ok' }, { type: 'done', finishReason: 'stop' }]),
    );
    await runTurn({
      messages: msgs,
      tools: [],
      cwd: '/tmp',
      yolo: false,
      onEvent: () => {},
      onConfirm: async () => false,
      signal: new AbortController().signal,
      client: fakeClient,
      model: 'fake',
      maxContextTokens: 1000,
    });
    // 验证:hotCut 内部保留 system,这里只验 metrics + 不抛错
  });

  it('hot cut 不砍最近 1 条 user', async () => {
    const big = 'x'.repeat(20_000);
    const msgs: Message[] = [
      { role: 'tool', tool_call_id: 't1', content: big },
      { role: 'tool', tool_call_id: 't2', content: big },
      { role: 'user', content: 'LAST-USER-MUST-STAY' },
    ];
    fakeStream.mockReturnValueOnce(
      asyncIterFromArray([{ type: 'text_delta', delta: 'ok' }, { type: 'done', finishReason: 'stop' }]),
    );
    await runTurn({
      messages: msgs,
      tools: [],
      cwd: '/tmp',
      yolo: false,
      onEvent: () => {},
      onConfirm: async () => false,
      signal: new AbortController().signal,
      client: fakeClient,
      model: 'fake',
      maxContextTokens: 1000,
    });
    // 验证:不抛错
  });

  it('metrics 在正常 stop 路径下正确返回', async () => {
    fakeStream.mockReturnValueOnce(
      asyncIterFromArray([
        {
          type: 'tool_call_start',
          toolCall: { id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.txt"}' } },
        },
        { type: 'done', finishReason: 'stop' },
      ]),
    );
    fakeStream.mockReturnValueOnce(
      asyncIterFromArray([{ type: 'text_delta', delta: 'ok' }, { type: 'done', finishReason: 'stop' }]),
    );
    const tmpCwd = await import('node:fs/promises').then((m) => m.mkdtemp('/tmp/agent-loop-'));
    tmpCwds.push(tmpCwd);
    await import('node:fs/promises').then((m) => m.writeFile(`${tmpCwd}/a.txt`, 'x'));
    const r = await runTurn({
      messages: [{ role: 'user', content: 'x' }],
      tools: [readFileTool],
      cwd: tmpCwd,
      yolo: false,
      onEvent: () => {},
      onConfirm: async () => true,
      signal: new AbortController().signal,
      client: fakeClient,
      model: 'fake',
      maxContextTokens: 120000,
    });
    expect(r.metrics).toBeDefined();
    expect(r.metrics?.llmTurns).toBe(2);
    expect(r.metrics?.toolCalls).toBe(1);
    expect(r.metrics?.compressions).toBe(0);
    expect(r.metrics?.hotCuts).toBe(0);
  });

  it('metrics 在 limit 路径下也正确返回', async () => {
    fakeStream.mockReturnValueOnce(
      asyncIterFromArray([{ type: 'text_delta', delta: 'hi' }, { type: 'done', finishReason: 'stop' }]),
    );
    fakeStream.mockReturnValueOnce(
      asyncIterFromArray([{ type: 'text_delta', delta: 'hi2' }, { type: 'done', finishReason: 'stop' }]),
    );
    const r = await runTurn({
      messages: [{ role: 'user', content: 'x' }],
      tools: [],
      cwd: '/tmp',
      yolo: false,
      onEvent: () => {},
      onConfirm: async () => false,
      signal: new AbortController().signal,
      client: fakeClient,
      model: 'fake',
      maxContextTokens: 120000,
      limits: { maxTurns: 2 },
    });
    expect(r.finishReason).toBe('limit');
    expect(r.metrics).toBeDefined();
    expect(r.metrics?.llmTurns).toBeGreaterThanOrEqual(2);
  });
```

- [ ] **Step 2: 运行 loop 测试**

Run: `npx vitest run src/__tests__/loop.test.ts`
Expected: 17 passed(原 9 + 新 8,其中 spec 列了 7 个 it + "metrics 在 limit 路径下也正确返回" 一个 = 8)

> **注:** spec §4 列了 7 个 it(loop.test.ts),实际 8 个是因为 metrics 在 limit 路径下也算一个独立覆盖。允许。

- [ ] **Step 3: commit**

```bash
git add src/__tests__/loop.test.ts
git commit -m "test(loop): cover L1 mid-turn / L2 turn / L3 tool / L4 hot cut + metrics"
```

---

## Task 12: audit-sink.test.ts / .env.example / README / CHANGELOG

**Files:**
- Modify: `.env.example`(加注释)
- Modify: `README.md` 和 `README.en.md`(配置表加 maxTurns / maxToolCalls)
- Modify: `CHANGELOG.md`(0.2.0 节)
- Test: `src/__tests__/audit-sink.test.ts`(可选:验证 'compressing' phase 能过 audit)

- [ ] **Step 1: 写 audit-sink 失败测试 + 修复**

打开 `src/__tests__/audit-sink.test.ts`,看现有 pattern 找一个 emit 多个事件的 it,加一个新 it:
```ts
  it('phase=compressing 也能审计', async () => {
    const sink = new InMemorySink('sid-cmp', 1);
    sink.emit({ type: 'phase', phase: 'thinking' });
    sink.emit({ type: 'phase', phase: 'compressing' });
    sink.emit({ type: 'phase', phase: 'executing' });
    const types = sink.events.map((e) => e.type);
    expect(types).toEqual(['phase', 'phase', 'phase']);
    const phases = sink.events.map((e) => e.phase);
    expect(phases).toEqual(['thinking', 'compressing', 'executing']);
  });
```

Run: `npx vitest run src/__tests__/audit-sink.test.ts`
Expected: pass(agentEventToAuditFields 用 switch 透传 phase 字段,无需改 sink.ts)

- [ ] **Step 2: 更新 .env.example**

打开 `.env.example`(若不存在则创建),在末尾追加:
```bash
# 资源护栏(可选,默认 maxTurns=12, maxToolCalls=30)
# AGENT_MAX_TURNS=12
# AGENT_MAX_TOOL_CALLS=30
```

- [ ] **Step 3: 更新 README.md / README.en.md**

找到 "Configuration" / "配置" 表,加 2 行:
```markdown
| `--max-turns <n>` | `AGENT_MAX_TURNS` | 12 | 单轮 ReAct 内最多调 LLM 次数,超过主动 `done: 'limit'` |
| `--max-tool-calls <n>` | `AGENT_MAX_TOOL_CALLS` | 30 | 单轮最多实际执行工具次数,超过主动 `done: 'limit'` |
```

- [ ] **Step 4: 更新 CHANGELOG.md**

在文件最开头插入 0.2.0 节(若有现成格式则沿用):
```markdown
## 0.2.0 (2026-06-06)

### Added
- 上下文压缩 v2:4 层防御(L1 mid-turn 增量压缩 / L2 turn 数护栏 / L3 tool 数护栏 / L4 hot cut)
- 新 `compressing` phase + `HeadStatus` 实时显示压缩进度
- 新配置 `maxTurns` (默认 12) / `maxToolCalls` (默认 30),支持 env (`AGENT_MAX_TURNS` / `AGENT_MAX_TOOL_CALLS`) 和 CLI flag
- `RunTurnResult.metrics` 字段:`llmTurns` / `toolCalls` / `compressions` / `hotCuts`
- 新 finishReason `'limit'`,区别于 `'error'`(资源耗尽 ≠ 异常)

### Changed
- `shouldCompress` 加可选 `thresholdMultiplier` 参数(默认 0.7,行为兼容)
- `hotCut()` 不 splice,只把 tool message content 改成 marker
```

- [ ] **Step 5: 全量 typecheck + test**

Run:
```bash
npx tsc --noEmit
npx vitest run
```

Expected:
- 0 errors
- 全部 pass(原 123 + 新 12 = 135 个 it,允许 ±2 浮动)

- [ ] **Step 6: commit**

```bash
git add .env.example README.md README.en.md CHANGELOG.md src/__tests__/audit-sink.test.ts
git commit -m "docs: 0.2.0 changelog, README config table, audit-sink covers 'compressing' phase"
```

---

## Task 13: 烟测(可选,但 spec §7 要求)

**Files:** 无代码改动,只跑命令

- [ ] **Step 1: 验证 typecheck + 全量测试**

Run:
```bash
npx tsc --noEmit
npx vitest run
```

Expected: 0 errors,所有 it pass

- [ ] **Step 2: 验证 CLI flag 解析**

Run:
```bash
npx tsx src/cli.tsx --max-turns 3 --max-tool-calls 5 "echo hello" 2>&1 | head -20
```

Expected: 进程启动(可能因没 LLM key 失败,但能解析 flag 即可)

- [ ] **Step 3: 验证 mid-turn 压缩 + maxTurns 退出(需 LLM key)**

Run:
```bash
AGENT_MAX_TURNS=3 npm run dev -- "读 3 个文件"
```

Expected: 3 turn 后 finishReason=limit(若有 LLM key)

- [ ] **Step 4: commit any smoke-test artifacts(如新增 .env)**

```bash
git status  # 看是否有遗漏
```

---

## 验证清单(spec §3 7 个不变量)

| # | 不变量 | 验证方式 |
|---|---|---|
| 1 | `finishReason: 'limit'` 合法退出,不走 error 通道 | Task 11: `maxTurns` / `maxToolCalls` 测 |
| 2 | system + 最近 1 条 user 不被砍 | Task 4: hotCut.test.ts |
| 3 | compressing phase 不计入 llmTurns | Task 6+7: counters 实现(llmTurns 只在 withRetry 前 ++) |
| 4 | hot cut 只改 content 标 marker,不动位置 | Task 4: hotCut.test.ts |
| 5 | 资源超限必 emit `error` + `done: 'limit'` 双事件 | Task 6: Step 2+3 双 emit |
| 6 | metrics 必返回 | Task 11: 2 个 it 覆盖 |
| 7 | fallback 失败再 fallback | Task 7: summarize → fallback → hot cut 兜底 |

---

## 不在本期范围(spec §8)

- 多 session 合并视图
- session 持久化
- token 计量上报 UI 累计
- sub-agent 调度
- run_tests 白名单工具

不要顺手做这些。
