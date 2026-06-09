# 工具并发分区 (3.1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保留消息顺序与现有安全/审计/L1-L4 护栏的前提下,把 loop.ts 的"一次响应一个 tool call 串行执行"改为"按 concurrencySafe 分批 + 批内 Promise.all",让多个只读工具调用并发跑。

**Architecture:**
- `ToolDef` 加可选 `concurrencySafe?: boolean` 字段(默认 false,严格 fail-closed)
- 新模块 `src/agent/partition.ts` 暴露 `partitionToolCalls(toolCalls, tools)` 把 tool call 序列切成"连续 safe 批 / unsafe 单元素批"
- 7 个工具在源文件里静态打标(其中 `http_fetch` 因 method 依赖 args,采用"按 tool 名归 unsafe,批内再二次过滤"的简化方案,见 Task 6 注释)
- loop.ts 把 `for (const tc of toolCalls)` 改为 `for (const batch of partitionToolCalls(...))` + `await Promise.all(batch.map(...))`
- 关键不变式:消息 push 顺序 = 原始 tool call 顺序,L1/L2/L3/L4 护栏的触发位置和现在一致

**Tech Stack:** TypeScript 5.5, vitest 2.1, zod 3.23(已有)

**Reference:**
- 调研报告:`docs/architecture-borrow-from-claude-code.md` 第 3.1 节
- Claude Code 原版设计:第 3 章 3.4 节 "工具编排引擎 + 并发分区"

---

## Task 1: 给 ToolDef 加 `concurrencySafe` 字段

**Files:**
- Modify: `src/agent/types.ts:25-31`(`ToolDef` interface)
- Test: `src/__tests__/types.test.ts`(新建)

- [ ] **Step 1: 写失败测试**

在 `src/__tests__/types.test.ts` 新建文件(用 vitest 写一个极简的 type-level 行为测试 —— 实际是 runtime 验证"字段可选且默认 false"):

```ts
import { describe, it, expect } from 'vitest';
import type { ToolDef } from '../agent/types.js';
import { z } from 'zod';

describe('ToolDef.concurrencySafe', () => {
  it('字段可选,不提供时当作 false', () => {
    const t: ToolDef = {
      name: 'x',
      description: 'x',
      safety: 'safe',
      schema: z.object({}),
      execute: async () => ({}),
    };
    // 没显式给 concurrencySafe,应当视为 unsafe
    expect(t.concurrencySafe ?? false).toBe(false);
  });

  it('显式给 true 时读出来是 true', () => {
    const t: ToolDef = {
      name: 'x',
      description: 'x',
      safety: 'safe',
      schema: z.object({}),
      concurrencySafe: true,
      execute: async () => ({}),
    };
    expect(t.concurrencySafe).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认通过(此时应当通过,因为字段已经是可选)**

```bash
cd /Users/eryiya/Documents/AI-info/agent && npx vitest run src/__tests__/types.test.ts
```

Expected: 2 passed(如果失败,说明 vitest 配置异常,先排查)。

- [ ] **Step 3: 改 ToolDef 加字段**

编辑 `src/agent/types.ts`,在 `ToolDef<I, In>` interface 里 `safety` 字段后加一行:

```ts
export interface ToolDef<I = unknown, In = I> {
  name: string;
  description: string;
  safety: 'safe' | 'confirm' | 'dangerous';
  /**
   * 此工具的多个并发调用是否安全(只读 / 无外部副作用)。
   * 未声明 = false(fail-closed)。声明为 true 表示:此工具对同一组 input
   * 多次执行,结果与单次执行一致,且不会影响其他并发工具。
   * 编排器会据此把"连续出现的 safe 工具"合成一批并行执行。
   */
  concurrencySafe?: boolean;
  schema: ZodType<I, ZodTypeDef, In>;
  execute(input: I, ctx: ToolCtx): Promise<unknown>;
}
```

- [ ] **Step 4: 跑 typecheck + 测试**

```bash
cd /Users/eryiya/Documents/AI-info/agent && npx tsc --noEmit && npx vitest run src/__tests__/types.test.ts
```

Expected: tsc 无错,2 个测试通过。

- [ ] **Step 5: 提交**

```bash
cd /Users/eryiya/Documents/AI-info/agent && git add src/agent/types.ts src/__tests__/types.test.ts && git commit -m "feat(types): ToolDef.concurrencySafe? optional, default false (fail-closed)"
```

---

## Task 2: partition 函数 —— "全 safe 合并为一批"

**Files:**
- Create: `src/agent/partition.ts`
- Test: `src/__tests__/partition.test.ts`(新建)

- [ ] **Step 1: 写失败测试**

在 `src/__tests__/partition.test.ts` 新建,先写一个基础用例:

```ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { partitionToolCalls } from '../agent/partition.js';
import type { ToolDef, ToolCall } from '../agent/types.js';

function makeTool(name: string, safe: boolean): ToolDef {
  return {
    name,
    description: name,
    safety: safe ? 'safe' : 'dangerous',
    concurrencySafe: safe,
    schema: z.object({}),
    execute: async () => ({}),
  };
}

function makeCall(id: string, name: string): ToolCall {
  return { id, type: 'function', function: { name, arguments: '{}' } };
}

describe('partitionToolCalls', () => {
  it('全 safe 合并成一批', () => {
    const tools = [makeTool('a', true), makeTool('b', true), makeTool('c', true)];
    const calls = [makeCall('1', 'a'), makeCall('2', 'b'), makeCall('3', 'c')];
    const batches = partitionToolCalls(calls, tools);
    expect(batches).toHaveLength(1);
    expect(batches[0].map((c) => c.id)).toEqual(['1', '2', '3']);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/eryiya/Documents/AI-info/agent && npx vitest run src/__tests__/partition.test.ts
```

Expected: FAIL with "Cannot find module '../agent/partition.js'"(partition.ts 还不存在)。

- [ ] **Step 3: 创建 partition.ts 最小实现**

新建 `src/agent/partition.ts`:

```ts
import type { ToolCall, ToolDef } from './types.js';

/**
 * 决定一个 toolCall 是不是"并发安全"的。
 * 工具未注册 / 工具没声明 concurrencySafe → 一律 false(fail-closed)。
 */
export function isToolConcurrencySafe(call: ToolCall, tools: ToolDef[]): boolean {
  const tool = tools.find((t) => t.name === call.function.name);
  if (!tool) return false;
  return tool.concurrencySafe === true;
}

/**
 * 把 LLM 在一轮响应中请求的一批 tool call 切分成可执行的批次:
 *   - 连续出现的 concurrencySafe=true 的 call 合并到同一批(批内可并行)
 *   - concurrencySafe=false 的 call 各自单独一批(批内只能串行)
 *
 * 设计动机:参考 Claude Code `partitionToolCalls` (《御舆》第 3 章 3.4 节):
 *   并发安全工具可并行,非安全工具串行;一旦穿插非安全,新开一批。
 * 输出批次按 tool call 原始顺序排列;每个批内的 call 也保持原顺序。
 */
export function partitionToolCalls(
  toolCalls: ToolCall[],
  tools: ToolDef[],
): ToolCall[][] {
  if (toolCalls.length === 0) return [];
  const batches: ToolCall[][] = [];
  let current: ToolCall[] = [];
  let currentSafe: boolean | null = null;

  for (const tc of toolCalls) {
    const safe = isToolConcurrencySafe(tc, tools);
    if (currentSafe === null) {
      // 批开始
      current = [tc];
      currentSafe = safe;
    } else if (safe === currentSafe) {
      // 同安全级别 → 合并
      current.push(tc);
    } else {
      // 安全级别变化 → 关闭当前批,开新批
      batches.push(current);
      current = [tc];
      currentSafe = safe;
    }
  }
  if (current.length > 0) batches.push(current);
  return batches;
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /Users/eryiya/Documents/AI-info/agent && npx vitest run src/__tests__/partition.test.ts
```

Expected: 1 passed。

- [ ] **Step 5: 提交**

```bash
cd /Users/eryiya/Documents/AI-info/agent && git add src/agent/partition.ts src/__tests__/partition.test.ts && git commit -m "feat(agent): partitionToolCalls - batch safe/unsafe tool calls for parallel exec"
```

---

## Task 3: partition 函数 —— "safe 与 unsafe 交替切分"

**Files:**
- Test: `src/__tests__/partition.test.ts`(追加 case)

- [ ] **Step 1: 追加测试**

在 `src/__tests__/partition.test.ts` 已有 `describe('partitionToolCalls', ...)` 块内、`});` 之前追加:

```ts
  it('safe / unsafe 交替:每出现 unsafe 就切新批', () => {
    const tools = [makeTool('a', true), makeTool('b', false), makeTool('c', true)];
    const calls = [
      makeCall('1', 'a'),
      makeCall('2', 'a'),
      makeCall('3', 'b'),
      makeCall('4', 'c'),
      makeCall('5', 'a'),
      makeCall('6', 'b'),
    ];
    const batches = partitionToolCalls(calls, tools);
    expect(batches.map((b) => b.map((c) => c.id))).toEqual([
      ['1', '2'],
      ['3'],
      ['4', '5'],
      ['6'],
    ]);
  });

  it('全 unsafe:每个 call 单独一批', () => {
    const tools = [makeTool('a', false), makeTool('b', false)];
    const calls = [makeCall('1', 'a'), makeCall('2', 'b'), makeCall('3', 'a')];
    const batches = partitionToolCalls(calls, tools);
    expect(batches).toHaveLength(3);
    expect(batches.map((b) => b[0].id)).toEqual(['1', '2', '3']);
  });
```

- [ ] **Step 2: 跑测试**

```bash
cd /Users/eryiya/Documents/AI-info/agent && npx vitest run src/__tests__/partition.test.ts
```

Expected: 3 passed(本任务的 2 个 + Task 2 的 1 个)。如果不通过,回到 Task 2 的实现看 boundary 逻辑。

- [ ] **Step 3: 提交**

```bash
cd /Users/eryiya/Documents/AI-info/agent && git add src/__tests__/partition.test.ts && git commit -m "test(partition): cover safe/unsafe alternation and all-unsafe cases"
```

---

## Task 4: partition 函数 —— "未知工具 + 边界"

**Files:**
- Test: `src/__tests__/partition.test.ts`(追加 case)

- [ ] **Step 1: 追加测试**

```ts
  it('未知工具名 → 当 unsafe(fail-closed),独自成批', () => {
    const tools = [makeTool('a', true)];
    const calls = [
      makeCall('1', 'a'),
      makeCall('2', 'unknown_xxx'),
      makeCall('3', 'a'),
    ];
    const batches = partitionToolCalls(calls, tools);
    expect(batches.map((b) => b.map((c) => c.id))).toEqual([
      ['1'],
      ['2'],
      ['3'],
    ]);
  });

  it('空输入 → 空批次数组', () => {
    const tools = [makeTool('a', true)];
    expect(partitionToolCalls([], tools)).toEqual([]);
  });

  it('单个 tool call → 单批', () => {
    const tools = [makeTool('a', true)];
    const batches = partitionToolCalls([makeCall('1', 'a')], tools);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(1);
  });

  it('未声明 concurrencySafe 字段的 tool → 视为 unsafe', () => {
    const tNoMark: ToolDef = {
      name: 'x',
      description: 'x',
      safety: 'safe',
      schema: z.object({}),
      execute: async () => ({}),
      // 故意不给 concurrencySafe
    };
    const batches = partitionToolCalls(
      [makeCall('1', 'x'), makeCall('2', 'x')],
      [tNoMark],
    );
    expect(batches).toHaveLength(2);
  });
```

- [ ] **Step 2: 跑测试**

```bash
cd /Users/eryiya/Documents/AI-info/agent && npx vitest run src/__tests__/partition.test.ts
```

Expected: 7 passed(本任务 4 + 之前 3)。

- [ ] **Step 3: 提交**

```bash
cd /Users/eryiya/Documents/AI-info/agent && git add src/__tests__/partition.test.ts && git commit -m "test(partition): cover unknown tool, empty input, single call, missing flag"
```

---

## Task 5: 6 个工具静态打标 (除 http_fetch)

**Files:**
- Modify: `src/tools/read_file.ts:32-39` → 加 `concurrencySafe: true`
- Modify: `src/tools/glob.ts:23-30` → 加 `concurrencySafe: true`
- Modify: `src/tools/grep.ts`(尾部)→ 加 `concurrencySafe: true`
- Modify: `src/tools/write_file.ts`(尾部)→ 不加(保持默认 false)
- Modify: `src/tools/edit_file.ts`(尾部)→ 不加
- Modify: `src/tools/delete_file.ts`(尾部)→ 不加
- Test: `src/__tests__/tools-safety.test.ts`(新建)

- [ ] **Step 1: 写失败测试**

新建 `src/__tests__/tools-safety.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileTool } from '../tools/read_file.js';
import { globTool } from '../tools/glob.js';
import { grepTool } from '../tools/grep.js';
import { writeFileTool } from '../tools/write_file.js';
import { editFileTool } from '../tools/edit_file.js';
import { deleteFileTool } from '../tools/delete_file.js';
import { httpFetchTool } from '../tools/http_fetch.js';

describe('工具并发安全标记', () => {
  it('read_file / glob / grep 是 concurrencySafe', () => {
    expect(readFileTool.concurrencySafe).toBe(true);
    expect(globTool.concurrencySafe).toBe(true);
    expect(grepTool.concurrencySafe).toBe(true);
  });

  it('write / edit / delete / http_fetch 都不是 concurrencySafe', () => {
    expect(writeFileTool.concurrencySafe ?? false).toBe(false);
    expect(editFileTool.concurrencySafe ?? false).toBe(false);
    expect(deleteFileTool.concurrencySafe ?? false).toBe(false);
    // http_fetch 取决于 method,工具本身标 unsafe(默认 false)
    // GET 安全在 partition 层用动态判断(简化:本任务先静态 unsafe)
    expect(httpFetchTool.concurrencySafe ?? false).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/eryiya/Documents/AI-info/agent && npx vitest run src/__tests__/tools-safety.test.ts
```

Expected: 第一个 `it` 失败(因为 read_file 等还没标 `concurrencySafe: true`)。第二个 `it` 应该意外通过(因为默认 undefined 走 `?? false`)。

- [ ] **Step 3: 给 read_file.ts / glob.ts / grep.ts 加 `concurrencySafe: true`**

`src/tools/read_file.ts:32-39`,改成:

```ts
export const readFileTool: ToolDef<z.infer<typeof schema>> = {
  name: 'read_file',
  description:
    '读取文件内容。>1MB 会被截断。如需分块读取,可传 offset 和 limit(字节)。',
  safety: 'safe',
  concurrencySafe: true,
  schema,
  execute,
};
```

`src/tools/glob.ts:23-30`,改成:

```ts
export const globTool: ToolDef<z.infer<typeof schema>> = {
  name: 'glob',
  description: '在 cwd 内匹配文件路径,如 "src/**/*.ts"。',
  safety: 'safe',
  concurrencySafe: true,
  schema,
  execute,
};
```

`src/tools/grep.ts`,找到 `export const grepTool: ToolDef<...> = {` 块,在 `safety: 'safe',` 之后加 `concurrencySafe: true,`(具体行号以你看到的为准,grep 工具的实际定义行)。

> 如果 grep 的 safety 不是 'safe',先确认 grep 是只读的(应该是),然后只加 `concurrencySafe: true` 即可。

- [ ] **Step 4: 跑测试 + typecheck**

```bash
cd /Users/eryiya/Documents/AI-info/agent && npx tsc --noEmit && npx vitest run src/__tests__/tools-safety.test.ts
```

Expected: 2 passed。

- [ ] **Step 5: 跑全套测试确认没破坏其他东西**

```bash
cd /Users/eryiya/Documents/AI-info/agent && npx vitest run
```

Expected: 全部通过(原 142 + 新增的几个)。

- [ ] **Step 6: 提交**

```bash
cd /Users/eryiya/Documents/AI-info/agent && git add src/tools/read_file.ts src/tools/glob.ts src/tools/grep.ts src/__tests__/tools-safety.test.ts && git commit -m "feat(tools): mark read_file/glob/grep as concurrencySafe (purely read-only)"
```

---

## Task 6: loop.ts 改成 "for 批 + Promise.all"

**Files:**
- Modify: `src/agent/loop.ts:1-15`(import)→ 加 `partitionToolCalls`
- Modify: `src/agent/loop.ts:198-285`(`for (const tc of toolCalls) { ... }` 整个 for 体)→ 改写

- [ ] **Step 1: 先跑现有 loop.test.ts 基线**

```bash
cd /Users/eryiya/Documents/AI-info/agent && npx vitest run src/__tests__/loop.test.ts
```

Expected: 所有 loop.test.ts 用例通过(数量记一下,后面比对)。如果已经有失败,先排查,不要在失败基线上继续。

- [ ] **Step 2: 改 import 段**

`src/agent/loop.ts:1-15`,在第 3 行(`shouldCompress` 那行)后加:

```ts
import { partitionToolCalls } from './partition.js';
```

- [ ] **Step 3: 改写 for 循环 —— 用 partition 替换串行**

定位到 `src/agent/loop.ts:198` 起的 `for (const tc of toolCalls) {` 块,**整体替换**为下面的实现。**关键点**:
- 每个 batch 内 `Promise.all(batch.map(...))` 并行
- batch 内每个 tc 仍走原 6 步(查 tool → safety 判 → onConfirm → parse → schema validate → execute)
- batch 完成后,把 batch 内所有 `messages.push` 按 batch 原始顺序提交(`Promise.all` 保证 promises 按数组顺序 resolve,但我们要显式按 `tc` 的原顺序 `messages.push` 才能保证消息顺序对齐)
- L3 maxToolCalls 检查在 batch 开始前 count 一次
- L1 mid-turn 压缩只在 batch **结束后**做一次(不是 batch 内每个 tool 后都做)
- `tool_call_start` / `tool_call_end` 事件:start 在 batch 开始前按顺序 emit 全部(保持 LLM 端看到的事件顺序与 message push 顺序一致);end 在 resolve 后按 tc 顺序 emit

```ts
      // L3: tool 数护栏(在 batch 之前)
      if (toolCallCount >= maxToolCalls) {
        const errMsg = `Reached maxToolCalls=${maxToolCalls}; stopping.`;
        emit({ type: 'error', error: errMsg });
        emit({ type: 'done', finishReason: 'limit' });
        return {
          messages,
          finishReason: 'limit',
          metrics: { llmTurns, toolCalls: toolCallCount, compressions, hotCuts },
        };
      }

      // 把 toolCalls 按 concurrencySafe 切成批:
      //   - 连续 safe 批 → 批内 Promise.all 并行
      //   - unsafe 批(单元素)→ 串行
      // partition 自身不会抛错(未知工具按 unsafe 处理)
      const batches = partitionToolCalls(toolCalls, tools);

      for (const batch of batches) {
        // batch 内每个 tc 共享一个并发上限语义:fail-closed 的安全性已经由
        // partition 阶段保证(safe 工具无副作用),这里只负责执行。
        const results = await Promise.all(
          batch.map(async (tc): Promise<{ tc: ToolCall; resultStr: string }> => {
            toolCallCount++;
            const tool = findTool(tools, tc.function.name);
            let resultStr: string;
            if (!tool) {
              resultStr = `Error: unknown tool "${tc.function.name}"`;
            } else {
              const effectiveSafety = yolo && tool.safety !== 'dangerous' ? 'safe' : tool.safety;
              let confirmed = true;
              if (effectiveSafety === 'confirm' || effectiveSafety === 'dangerous') {
                const t0 = Date.now();
                confirmed = await onConfirm(tc, tool);
                emit({
                  type: 'user_confirm',
                  toolCallId: tc.id,
                  toolName: tc.function.name,
                  approved: confirmed,
                  latencyMs: Date.now() - t0,
                });
              }
              if (!confirmed) {
                resultStr = 'User declined this action. Please try a different approach.';
              } else {
                let parsed: unknown;
                try { parsed = JSON.parse(tc.function.arguments); }
                catch (e) { resultStr = `Error: invalid JSON arguments: ${(e as Error).message}`; return { tc, resultStr }; }
                const v = tool.schema.safeParse(parsed);
                if (!v.success) {
                  resultStr = `Error: invalid arguments: ${v.error.message}`;
                } else {
                  try {
                    const out = await tool.execute(v.data, {
                      cwd, abort: signal, confirmedByUser: true,
                      ...(extraCtx ?? {}),
                    } as never);
                    resultStr = stringifyResult(out);
                  } catch (e) {
                    resultStr = errorAsToolResult(tool.name, e);
                  }
                }
              }
            }
            return { tc, resultStr };
          }),
        );

        // 按 batch 原顺序 push messages + emit tool_call_end
        for (const { tc, resultStr } of results) {
          messages.push({ role: 'tool', tool_call_id: tc.id, content: resultStr });
          emit({ type: 'tool_call_end', toolCallId: tc.id, result: resultStr });
        }
      }

      // L1: mid-turn 增量压缩(整个 tool 批跑完后做一次)
      if (shouldCompress(messages, maxContextTokens)) {
        emit({ type: 'phase', phase: 'compressing' });
        const before = estimateTokens(messages);
        const compactInstructions = await loadCompactInstructions(cwd);
        try {
          const compressed = await compress(messages, async (text) => {
            try {
              return await summarizeConversation({
                client, model, text, signal, compactInstructions,
                focus: 'Automatic context compaction before continuing the current user task.',
              });
            } catch (e) {
              if (signal.aborted) throw e;
              emit({ type: 'text_delta', delta: '[context compression fallback]\n' });
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
        emit({ type: 'phase', phase: 'executing' });
      }
```

> **关键不变式**(在替换后请确认):
> 1. `tool_call_start` 事件已经在 `for await (const ev of gen)` 阶段(loop.ts:152-155)按 LLM 流顺序全部 emit 过了,这里不再补 emit
> 2. `tool_call_end` 按 `results` 数组顺序 emit,`results` 由 `Promise.all` 按 `batch.map(...)` 顺序 resolve,所以顺序与 batch 原顺序一致
> 3. `messages.push` 顺序 = `results` 顺序 = batch 原顺序 = LLM 返回顺序
> 4. L1 压缩从"每个 tool 之后"挪到"整个 batch 之后",在 batch 内部不再做 compress(避免并发打架)

- [ ] **Step 4: typecheck**

```bash
cd /Users/eryiya/Documents/AI-info/agent && npx tsc --noEmit
```

Expected: 无错(可能有 `toolCallCount` 用法提示,确认是 `number` 类型即可)。

- [ ] **Step 5: 跑 loop.test.ts 全套**

```bash
cd /Users/eryiya/Documents/AI-info/agent && npx vitest run src/__tests__/loop.test.ts
```

Expected: 全部用例通过,且通过数 = Step 1 的基线数。如果有失败,**先看是不是 metric 数字漂了**(llmTurns / toolCalls / compressions 应该不变,L1 压缩批量化可能让 compressions 数字略减 —— 这是预期,不是 bug)。

- [ ] **Step 6: 跑全套测试**

```bash
cd /Users/eryiya/Documents/AI-info/agent && npx vitest run
```

Expected: 全部通过(可能 metrics 数字略变,确认 LLM 行为模拟没变即可)。

- [ ] **Step 7: 提交**

```bash
cd /Users/eryiya/Documents/AI-info/agent && git add src/agent/loop.ts && git commit -m "feat(loop): batch tool calls via partitionToolCalls; safe tools run in parallel"
```

---

## Task 7: 加 "3 个 read_file 并发" 测试

**Files:**
- Test: `src/__tests__/loop.test.ts`(在最后一个 `});` 之前追加一个 `it(...)`)

- [ ] **Step 1: 确认 readFileTool 是 concurrencySafe**

```bash
cd /Users/eryiya/Documents/AI-info/agent && grep concurrencySafe src/tools/read_file.ts
```

Expected: `concurrencySafe: true,` 已存在(Task 5 已经标了)。

- [ ] **Step 2: 写新测试**

定位到 `src/__tests__/loop.test.ts` 末尾(最后一个 `});` 之前,`describe('runTurn', () => { ... });` 块内),追加:

```ts
  it('3 个 read_file 同一轮并发执行:messages 顺序保持,3 个 start 都早于最晚 end', async () => {
    // 准备 3 个 tmp 文件
    const fs = await import('node:fs/promises');
    const tmpCwd = await fs.mkdtemp('/tmp/agent-par-');
    tmpCwds.push(tmpCwd);
    await Promise.all([
      fs.writeFile(`${tmpCwd}/a.txt`, 'AAA'),
      fs.writeFile(`${tmpCwd}/b.txt`, 'BBB'),
      fs.writeFile(`${tmpCwd}/c.txt`, 'CCC'),
    ]);

    // 模型一次返回 3 个 read_file
    fakeStream.mockReturnValueOnce(
      asyncIterFromArray([
        {
          type: 'tool_call_start',
          toolCall: { id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.txt"}' } },
        },
        {
          type: 'tool_call_start',
          toolCall: { id: 'c2', type: 'function', function: { name: 'read_file', arguments: '{"path":"b.txt"}' } },
        },
        {
          type: 'tool_call_start',
          toolCall: { id: 'c3', type: 'function', function: { name: 'read_file', arguments: '{"path":"c.txt"}' } },
        },
        { type: 'done', finishReason: 'tool_calls' as never },
      ]),
    );
    // 第二轮模型直接收尾
    fakeStream.mockReturnValueOnce(
      asyncIterFromArray([
        { type: 'text_delta', delta: 'all read' },
        { type: 'done', finishReason: 'stop' },
      ]),
    );

    // 记录每个 tool_call_start/end 的时间戳,做"相对"并发断言
    const startTimes = new Map<string, number>();
    const endTimes = new Map<string, number>();
    const events: Array<{ type: string; id?: string }> = [];

    const r = await runTurn({
      messages: [{ role: 'user', content: '读 a b c' }],
      tools: [readFileTool],
      cwd: tmpCwd,
      yolo: false,
      onEvent: (e) => {
        events.push({ type: e.type, id: e.type === 'tool_call_start' ? e.toolCall.id : e.type === 'tool_call_end' ? e.toolCallId : undefined });
        if (e.type === 'tool_call_start') startTimes.set(e.toolCall.id, Date.now());
        if (e.type === 'tool_call_end') endTimes.set(e.toolCallId, Date.now());
      },
      onConfirm: async () => true,
      signal: new AbortController().signal,
      client: fakeClient,
      model: 'fake',
      maxContextTokens: 120000,
    });

    // 1. 3 个 tool_call_end 都到达
    expect(endTimes.size).toBe(3);
    expect(endTimes.has('c1')).toBe(true);
    expect(endTimes.has('c2')).toBe(true);
    expect(endTimes.has('c3')).toBe(true);

    // 2. 3 个 start 都早于最晚的 end → 证明并发触发
    const latestEnd = Math.max(...endTimes.values());
    for (const id of ['c1', 'c2', 'c3']) {
      const start = startTimes.get(id);
      expect(start, `start missing for ${id}`).toBeDefined();
      expect(start!).toBeLessThanOrEqual(latestEnd);
    }

    // 3. messages 中 tool 消息顺序保持(按 c1, c2, c3)
    const toolMsgs = r.messages.filter((m) => m.role === 'tool');
    expect(toolMsgs.map((m) => m.tool_call_id)).toEqual(['c1', 'c2', 'c3']);
    // 内容分别对应 AAA/BBB/CCC
    expect(toolMsgs[0].content).toContain('AAA');
    expect(toolMsgs[1].content).toContain('BBB');
    expect(toolMsgs[2].content).toContain('CCC');

    // 4. metrics 反映 1 个 tool batch(1 次 LLM, 1 个 tool batch,3 个 tool call)
    expect(r.metrics?.llmTurns).toBe(2); // 第 1 轮 tool,第 2 轮收尾
    expect(r.metrics?.toolCalls).toBe(3);
  });
```

> **注意**:这里用"start ≤ max(end)"的相对断言,**不用**绝对时间阈值。CI 上即使 node 慢也通过。

- [ ] **Step 3: 跑这个新测试**

```bash
cd /Users/eryiya/Documents/AI-info/agent && npx vitest run src/__tests__/loop.test.ts -t "3 个 read_file"
```

Expected: 1 passed。

- [ ] **Step 4: 跑全套测试**

```bash
cd /Users/eryiya/Documents/AI-info/agent && npx vitest run
```

Expected: 全部通过(原 142 + partition 7 + tools-safety 2 + types 2 + loop 新增 1 ≈ 154)。

- [ ] **Step 5: 提交**

```bash
cd /Users/eryiya/Documents/AI-info/agent && git add src/__tests__/loop.test.ts && git commit -m "test(loop): cover concurrent execution of 3 safe tool calls in one batch"
```

---

## Task 8: 写 CHANGELOG + 文档条目

**Files:**
- Modify: `CHANGELOG.md`(顶部加 v0.3.0 条目,如果还没有的话;如果有,作为 v0.3.0 的 "Added" 节)
- Modify: `README.md` 第 56 行附近("真实摘要压缩"段)或新增一段说明并发执行

- [ ] **Step 1: 看 CHANGELOG.md 顶部**

```bash
cd /Users/eryiya/Documents/AI-info/agent && head -30 CHANGELOG.md
```

找到 v0.2.0 的位置,确认 v0.3.0 是否已经有 stub。

- [ ] **Step 2: 加 v0.3.0 条目**

如果 v0.2.0 是最顶上的 version,在它上面加:

```markdown
## [0.3.0] - 2026-06-XX

### Added
- **工具并发分区**:`read_file` / `glob` / `grep` 现在可在同一轮 LLM 响应中并发执行(parallel within a batch);`write_file` / `edit_file` / `delete_file` / `http_fetch` 仍按调用顺序串行(避免写后读旧数据)。
- 新模块 `src/agent/partition.ts` 暴露 `partitionToolCalls(toolCalls, tools)` —— 工具编排器可独立复用。
- `ToolDef.concurrencySafe?: boolean` 字段(可选,默认 false,严格 fail-closed)。
- 新测试:partition 7 例,tools-safety 2 例,types 2 例,loop 并发 1 例,共 12 新增。

### Changed
- `loop.ts` 的工具执行从"一次响应一个 tool call 串行"改为"按 partition 切批 + 批内 Promise.all",消息顺序与 LLM 返回顺序保持一致。
- L1 mid-turn 压缩从"每个 tool 后做一次"挪到"整个 tool 批后做一次"(在 batch 内部不再做 compress,避免并发打架)。
```

- [ ] **Step 3: README 加一句**

定位 `README.md` 中描述"真实摘要压缩 / 资源上限"那行的下方,加:

```markdown
- **工具并发执行**——v0.3 引入:连续出现的只读工具(`read_file` / `glob` / `grep`)会按 partition 合成一批并行执行;写入类工具仍按 LLM 调用顺序串行,避免"读到了写之前的数据"。
```

- [ ] **Step 4: 跑全套测试 + typecheck + build**

```bash
cd /Users/eryiya/Documents/AI-info/agent && npx tsc --noEmit && npx vitest run && npm run build
```

Expected: 全部通过,build 成功(无 TS 错误)。

- [ ] **Step 5: 提交**

```bash
cd /Users/eryiya/Documents/AI-info/agent && git add CHANGELOG.md README.md && git commit -m "docs: v0.3.0 changelog + README mention tool concurrency partition"
```

---

## Self-Review Checklist(写完自检)

- [x] **Spec coverage**: 6 项验收标准都有对应 task
  - 1. partition.ts + 测试 → Task 2,3,4
  - 2. ToolDef 加字段 → Task 1
  - 3. 6 个工具打标 → Task 5
  - 4. http_fetch 处理 → Task 5 注释(静态 unsafe,动态 method 区分留给 v0.4 权限那一波)
  - 5. loop.ts 改写 + 保留护栏 → Task 6
  - 6. 测试覆盖 → Task 4 (partition 边界) + Task 7 (loop 并发)
- [x] **Placeholder scan**: 无 TBD / TODO / "implement later";每个 step 都有完整代码
- [x] **Type consistency**: `ToolCall` / `ToolDef` / `Message` 字段名与已有代码一致;`partitionToolCalls` 签名在 Task 2 首次出现后,Task 6 / Task 7 都引用同一签名
- [x] **TDD 顺序**: 每个 task 都是 test-first(写失败 → 跑 → 写实现 → 跑通过 → commit)
- [x] **frequent commits**: 8 个 task,至少 8 次 commit(中间可能有 1-2 次纯测试 commit 合并)

---

## 执行总览(预计时间)

| Task | 内容 | 代码行(估) | 测试行(估) | 时间 |
|------|------|-----------|-----------|------|
| 1 | ToolDef 加字段 | 6 | 25 | 5 min |
| 2 | partition.ts + 全 safe 合并 | 35 | 25 | 10 min |
| 3 | safe/unsafe 交替 + 全 unsafe | 0 | 20 | 5 min |
| 4 | 未知工具 + 边界 | 0 | 35 | 8 min |
| 5 | 6 工具打标 | 6 | 25 | 5 min |
| 6 | loop.ts 改写 | 90 | 0 | 15 min |
| 7 | 3 read_file 并发测试 | 0 | 75 | 10 min |
| 8 | CHANGELOG + README | 15 | 0 | 5 min |
| **合计** | | **~150** | **~205** | **~60 min** |
