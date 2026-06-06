# TodoWrite + AskUserQuestion 工具 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two P0-priority tools to react-cli-agent — `TodoWrite` (session-scoped task list) and `AskUserQuestion` (interactive 2-4 option picker) — so the LLM can self-organize and disambiguate decisions without leaving the agent loop. Both tools are inspired by Claude Code's built-in equivalents.

**Architecture:**

- **State path:** Extend `ToolCtx` with `sessionState: SessionState` (todos + onChange). `SessionState` is created once per `runTurn` and passed through every tool execution.
- **Interaction path:** Add `onAskUser` callback to `RunTurnInput`. `AskUserQuestionTool.execute` awaits it; the UI (`AskUserDialog` component) resolves it with the user's choice.
- **Behavior path:** New `src/agent/systemPrompt.ts` produces a short Chinese system prompt (TodoWrite + AskUserQuestion usage guidance) injected as the first message in `app.tsx`.
- **UI path:** New `src/components/AskUserDialog.tsx` (Ink) handles the question UI. `useInput` is extended to route to the active dialog (priority: question > confirm).
- **Event path:** Add 3 new `AgentEvent` variants: `todo_updated`, `ask_user`, `ask_user_resolved` (audit + UI).

**Tech Stack:** TypeScript 5.5, vitest 2.1, zod 3.23, ink + ink-testing-library (existing).

**Reference:**
- Borrow report: `docs/architecture-borrow-from-claude-code.md` (P0 recommendation)
- v0.3.0 plan: `docs/superpowers/plans/2026-06-06-tool-concurrency-partition.md` (precedent for this plan's shape)
- Claude Code upstream: 4-Question-Block + TodoWrite tools (book chapter 6)

---

## Decisions Locked (from brainstorming)

| # | Question | Decision |
|---|----------|----------|
| 1 | Where do todos live? | `extraCtx` widened → `SessionState` (mutable, passed via `ToolCtx`) |
| 2 | How does AskUserQuestion block? | Independent `AskUserDialog` component + `useInput` routes by `activeKind` |
| 3 | System prompt? | New `src/agent/systemPrompt.ts` injected at `app.tsx:152` |
| 4 | Scope? | Minimal MVP (1-7 todos, 2-4 options, no priority/owner) |

---

## File Structure

### New files
- `src/agent/systemPrompt.ts` — exports `buildSystemPrompt(): string`
- `src/agent/sessionState.ts` — `SessionState` interface + `createSessionState()` factory
- `src/tools/todo_write.ts` — `todoWriteTool: ToolDef`
- `src/tools/ask_user_question.ts` — `askUserQuestionTool: ToolDef`
- `src/components/AskUserDialog.tsx` — Ink component for question UI
- `src/components/TodoList.tsx` — Ink component for todo rendering
- `src/__tests__/systemPrompt.test.ts`
- `src/__tests__/sessionState.test.ts`
- `src/__tests__/tools/todo_write.test.ts`
- `src/__tests__/tools/ask_user_question.test.ts`
- `src/__tests__/components/AskUserDialog.test.tsx`

### Modified files
- `src/agent/types.ts` — add `SessionState`, `AskUserRequest`, `AskUserAnswer`; extend `ToolCtx`, `AgentEvent`, `RunTurnInput`
- `src/agent/loop.ts` — pass `sessionState` through `ToolCtx`; nothing else
- `src/app.tsx` — inject system prompt, create `SessionState`, wire `onAskUser`, render `AskUserDialog` + `TodoList`, extend `useInput` routing
- `package.json` — no new deps (ink-testing-library already in devDeps)

---

## Task 1: 新建 `src/agent/sessionState.ts` + 测试

**Files:**
- Create: `src/agent/sessionState.ts`
- Test: `src/__tests__/sessionState.test.ts`

### Step 1: 写失败测试

Create `src/__tests__/sessionState.test.ts` with EXACTLY this content:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createSessionState, type TodoItem } from '../agent/sessionState.js';

describe('SessionState', () => {
  it('初始 todos 为空', () => {
    const s = createSessionState();
    expect(s.todos).toEqual([]);
  });

  it('setTodos 写入并可通过 todos 读到', () => {
    const s = createSessionState();
    const next: TodoItem[] = [{ status: 'in_progress', content: '读 README' }];
    s.setTodos(next);
    expect(s.todos).toEqual(next);
  });

  it('setTodos 触发 onChange(传入最新 todos)', () => {
    const s = createSessionState();
    const cb = vi.fn();
    s.onChange = cb;
    const next: TodoItem[] = [{ status: 'completed', content: 'done' }];
    s.setTodos(next);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(next);
  });

  it('多次 setTodos 每次都触发 onChange', () => {
    const s = createSessionState();
    const cb = vi.fn();
    s.onChange = cb;
    s.setTodos([{ status: 'pending', content: 'a' }]);
    s.setTodos([{ status: 'completed', content: 'a' }]);
    expect(cb).toHaveBeenCalledTimes(2);
  });
});
```

### Step 2: 跑测试确认失败

```bash
cd /Users/eryiya/Documents/AI-info/agent && npx vitest run src/__tests__/sessionState.test.ts
```

Expected: FAIL with "Cannot find module '../agent/sessionState.js'".

### Step 3: 创建 sessionState.ts

Create `src/agent/sessionState.ts`:

```ts
export interface TodoItem {
  status: 'pending' | 'in_progress' | 'completed';
  content: string;
}

export interface SessionState {
  readonly todos: TodoItem[];
  setTodos(next: TodoItem[]): void;
  onChange?: (todos: TodoItem[]) => void;
}

export function createSessionState(): SessionState {
  let todos: TodoItem[] = [];
  return {
    get todos() { return todos; },
    setTodos(next) {
      todos = next;
      this.onChange?.(todos);
    },
    onChange: undefined,
  };
}
```

### Step 4: 跑测试

```bash
cd /Users/eryiya/Documents/AI-info/agent && npx tsc --noEmit && npx vitest run src/__tests__/sessionState.test.ts
```

Expected: 4 passed, tsc clean.

### Step 5: 提交

```bash
cd /Users/eryiya/Documents/AI-info/agent && git add src/agent/sessionState.ts src/__tests__/sessionState.test.ts && git commit -m "feat(agent): SessionState - mutable todos store with onChange callback"
```

---

## Task 2: 在 `src/agent/types.ts` 扩展 `ToolCtx` / `RunTurnInput` / `AgentEvent`

**Files:**
- Modify: `src/agent/types.ts` (extend `ToolCtx`, `RunTurnInput`, `AgentEvent`)
- Test: `src/__tests__/types.test.ts` (extend with new event variant tests)

### Step 1: 写失败测试

Read the current `src/__tests__/types.test.ts` (it exists from v0.3.0). Add a new `describe` block at the end of the file (before the final `});`):

```ts
describe('AgentEvent 新增变体(todo_updated / ask_user / ask_user_resolved)', () => {
  it('todo_updated 携带 todos 数组', () => {
    const ev = { type: 'todo_updated', todos: [{ status: 'in_progress', content: 'x' }] };
    expect(ev.type).toBe('todo_updated');
    if (ev.type === 'todo_updated') {
      expect(ev.todos).toHaveLength(1);
      expect(ev.todos[0].content).toBe('x');
    }
  });

  it('ask_user 携带 callId + question + options + multiSelect', () => {
    const ev = { type: 'ask_user', callId: 'c1', question: '?', options: ['a', 'b'], multiSelect: false };
    expect(ev.type).toBe('ask_user');
    if (ev.type === 'ask_user') {
      expect(ev.callId).toBe('c1');
      expect(ev.options).toEqual(['a', 'b']);
    }
  });

  it('ask_user_resolved 携带 callId + answer(单选:string / 多选:string[])', () => {
    const single = { type: 'ask_user_resolved', callId: 'c1', answer: 'a' };
    if (single.type === 'ask_user_resolved') {
      expect(typeof single.answer).toBe('string');
    }
    const multi = { type: 'ask_user_resolved', callId: 'c2', answer: ['a', 'b'] };
    if (multi.type === 'ask_user_resolved') {
      expect(Array.isArray(multi.answer)).toBe(true);
    }
  });
});
```

### Step 2: 跑测试

```bash
cd /Users/eryiya/Documents/AI-info/agent && npx vitest run src/__tests__/types.test.ts
```

Expected: 5 passed (2 旧 + 3 新). 这个测试是 runtime narrowing 验证,写完应当 pass。

### Step 3: 改 `src/agent/types.ts`

Add these exports near the top (after `import { z }` lines):

```ts
import type { TodoItem } from './sessionState.js';

export interface AskUserRequest {
  question: string;
  options: string[];
  multiSelect: boolean;
}

export type AskUserAnswer = string | string[];
```

In the `ToolCtx` interface, add one field:

```ts
export interface ToolCtx {
  cwd: string;
  abort: AbortSignal;
  confirmedByUser: boolean;
  writeableExts?: string[];
  allowMutations?: boolean;
  /** session-level mutable state (todos, etc.); 同一个 runTurn 内共享 */
  sessionState: import('./sessionState.js').SessionState;
}
```

In the `RunTurnInput` interface, add two fields:

```ts
export interface RunTurnInput {
  // ... existing fields ...
  /** session 状态: todos 等可写 store。loop 会自动注入到 ToolCtx.sessionState。 */
  sessionState: import('./sessionState.js').SessionState;
  /** AskUserQuestion 工具的交互回调。UI 必须实现,否则工具 execute 抛错。 */
  onAskUser: (req: AskUserRequest) => Promise<AskUserAnswer>;
}
```

In the `AgentEvent` union, add 3 variants (place them after `user_confirm`):

```ts
export type AgentEvent =
  // ... existing variants ...
  | { type: 'todo_updated'; todos: TodoItem[] }
  | { type: 'ask_user'; callId: string; question: string; options: string[]; multiSelect: boolean }
  | { type: 'ask_user_resolved'; callId: string; answer: AskUserAnswer };
```

### Step 4: typecheck

```bash
cd /Users/eryiya/Documents/AI-info/agent && npx tsc --noEmit
```

Expected: **会报错** —— `app.tsx` 和 `loop.test.ts` 还没传 `sessionState` / `onAskUser` 给 `runTurn`。这是预期的,先不修,留到 Task 7 一起修。

### Step 5: 提交(types 改动先单独提交)

```bash
cd /Users/eryiya/Documents/AI-info/agent && git add src/agent/types.ts src/__tests__/types.test.ts && git commit -m "feat(types): SessionState + AskUserRequest + 3 new AgentEvent variants"
```

> 此时 tsc 报错是预期的(下游还没适配),不影响 commit 本身。

---

## Task 3: 新建 `src/agent/systemPrompt.ts` + 测试

**Files:**
- Create: `src/agent/systemPrompt.ts`
- Test: `src/__tests__/systemPrompt.test.ts`

### Step 1: 写失败测试

Create `src/__tests__/systemPrompt.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../agent/systemPrompt.js';

describe('buildSystemPrompt', () => {
  it('返回非空字符串', () => {
    const s = buildSystemPrompt();
    expect(s.length).toBeGreaterThan(50);
  });

  it('包含 TodoWrite 使用建议', () => {
    const s = buildSystemPrompt();
    expect(s).toContain('TodoWrite');
  });

  it('包含 AskUserQuestion 使用建议', () => {
    const s = buildSystemPrompt();
    expect(s).toContain('AskUserQuestion');
  });

  it('指明 TodoWrite 不适用于 ≤3 步任务(避免误用)', () => {
    const s = buildSystemPrompt();
    expect(s).toMatch(/[<=]\s*3\s*步/);
  });
});
```

### Step 2: 跑测试确认失败

```bash
cd /Users/eryiya/Documents/AI-info/agent && npx vitest run src/__tests__/systemPrompt.test.ts
```

Expected: FAIL — module not found.

### Step 3: 创建 systemPrompt.ts

Create `src/agent/systemPrompt.ts`:

```ts
export function buildSystemPrompt(): string {
  return [
    '你是一个在终端里运行的 CLI Agent,通过沙箱工具完成用户请求。',
    '',
    '## 工具使用建议',
    '',
    '- **TodoWrite**(todo_write):多步任务开始时调用,把步骤列出来;每完成一步更新 status。',
    '  - 任务 ≤ 3 步时不必调用(性价比低)',
    '  - 不要为了"看起来完整"硬列步骤',
    '  - 1-7 条,content 一句话',
    '- **AskUserQuestion**(ask_user_question):在 2-4 个互斥选项中让用户选一个/多个。',
    '  - 不要用于 yes/no(直接做或直接拒绝)',
    '  - 不要用于开放问题(给用户也会被 cancel)',
    '  - 选项要互斥、明确',
    '',
    '## 风格',
    '回答简洁,优先用工具而不是文字解释。中文输出。',
  ].join('\n');
}
```

### Step 4: 跑测试

```bash
cd /Users/eryiya/Documents/AI-info/agent && npx tsc --noEmit && npx vitest run src/__tests__/systemPrompt.test.ts
```

Expected: 4 passed.

### Step 5: 提交

```bash
cd /Users/eryiya/Documents/AI-info/agent && git add src/agent/systemPrompt.ts src/__tests__/systemPrompt.test.ts && git commit -m "feat(agent): systemPrompt with TodoWrite + AskUserQuestion usage guidance"
```

---

## Task 4: 新建 `src/tools/todo_write.ts` + 测试

**Files:**
- Create: `src/tools/todo_write.ts`
- Test: `src/__tests__/tools/todo_write.test.ts`

### Step 1: 写失败测试

Create `src/__tests__/tools/todo_write.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { todoWriteTool } from '../../tools/todo_write.js';
import { createSessionState } from '../../agent/sessionState.js';
import type { ToolCtx } from '../../agent/types.js';

function makeCtx(): { ctx: ToolCtx; events: Array<{ type: string; [k: string]: unknown }> } {
  const events: Array<{ type: string; [k: string]: unknown }> = [];
  const sessionState = createSessionState();
  return {
    ctx: {
      cwd: '/tmp',
      abort: new AbortController().signal,
      confirmedByUser: true,
      sessionState,
    } as ToolCtx,
    events,
  };
}

describe('todoWriteTool', () => {
  it('execute 写入 sessionState.todos', async () => {
    const { ctx } = makeCtx();
    await todoWriteTool.execute(
      { todos: [{ status: 'in_progress', content: '读 README' }] },
      ctx,
    );
    expect(ctx.sessionState.todos).toEqual([{ status: 'in_progress', content: '读 README' }]);
  });

  it('execute 触发 sessionState.onChange', async () => {
    const { ctx } = makeCtx();
    const cb = vi.fn();
    ctx.sessionState.onChange = cb;
    await todoWriteTool.execute(
      { todos: [{ status: 'pending', content: 'a' }] },
      ctx,
    );
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('execute 返 {count}', async () => {
    const { ctx } = makeCtx();
    const r = await todoWriteTool.execute(
      { todos: [
        { status: 'pending', content: 'a' },
        { status: 'completed', content: 'b' },
      ] },
      ctx,
    );
    expect(r).toEqual({ count: 2 });
  });

  it('schema 拒绝空 todos 数组', () => {
    const r = todoWriteTool.schema.safeParse({ todos: [] });
    expect(r.success).toBe(false);
  });

  it('schema 拒绝 8 条以上', () => {
    const todos = Array.from({ length: 8 }, (_, i) => ({
      status: 'pending' as const, content: `task ${i}`,
    }));
    const r = todoWriteTool.schema.safeParse({ todos });
    expect(r.success).toBe(false);
  });

  it('schema 拒绝非法 status', () => {
    const r = todoWriteTool.schema.safeParse({
      todos: [{ status: 'paused', content: 'x' }],
    });
    expect(r.success).toBe(false);
  });
});
```

### Step 2: 跑测试确认失败

```bash
cd /Users/eryiya/Documents/AI-info/agent && npx vitest run src/__tests__/tools/todo_write.test.ts
```

Expected: FAIL — module not found.

### Step 3: 创建 todo_write.ts

Create `src/tools/todo_write.ts`:

```ts
import { z } from 'zod';
import type { ToolDef } from '../agent/types.js';

const schema = z.object({
  todos: z
    .array(
      z.object({
        status: z.enum(['pending', 'in_progress', 'completed']),
        content: z.string().min(1).max(200),
      }),
    )
    .min(1)
    .max(7),
});

async function execute(
  input: z.infer<typeof schema>,
  ctx: import('../agent/types.js').ToolCtx,
): Promise<{ count: number }> {
  ctx.sessionState.setTodos(input.todos);
  // 触发 UI re-render(emit 在 loop 里统一处理,工具直接调 emit 不行,
  // 所以这里用 ctx.onTodoUpdate 回调 / 或者改成 emit via passed fn)
  // 简化方案:工具不直接 emit,而是让 sessionState.onChange 触发
  // (app.tsx 在 onChange 里负责 emit todo_updated)
  return { count: input.todos.length };
}

export const todoWriteTool: ToolDef<z.infer<typeof schema>> = {
  name: 'todo_write',
  description:
    '更新当前会话的任务清单(1-7 条)。每条 status ∈ pending / in_progress / completed,content 一句话说明。多步任务开始时调用,每完成一个步骤就更新 status。任务 ≤ 3 步时不必调用。',
  safety: 'safe',
  schema,
  execute,
};
```

> **设计点**:工具不直接 emit `todo_updated` 事件,而是通过 `sessionState.onChange` 触发(由 app.tsx 订阅 onChange 并 emit)。这样 `ToolDef` 不需要新增 `emit` 字段,保持接口精简。

### Step 4: 跑测试

```bash
cd /Users/eryiya/Documents/AI-info/agent && npx tsc --noEmit && npx vitest run src/__tests__/tools/todo_write.test.ts
```

Expected: 6 passed.

### Step 5: 提交

```bash
cd /Users/eryiya/Documents/AI-info/agent && git add src/tools/todo_write.ts src/__tests__/tools/todo_write.test.ts && git commit -m "feat(tools): todo_write - session-scoped todo list (1-7 items, status enums)"
```

---

## Task 5: 新建 `src/tools/ask_user_question.ts` + 测试

**Files:**
- Create: `src/tools/ask_user_question.ts`
- Test: `src/__tests__/tools/ask_user_question.test.ts`

### Step 1: 写失败测试

Create `src/__tests__/tools/ask_user_question.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { askUserQuestionTool } from '../../tools/ask_user_question.js';
import { createSessionState } from '../../agent/sessionState.js';
import type { ToolCtx } from '../../agent/types.js';

function makeCtx(opts: { answer?: string | string[] } = {}): {
  ctx: ToolCtx;
  callLog: Array<{ question: string; options: string[]; multiSelect: boolean }>;
} {
  const callLog: Array<{ question: string; options: string[]; multiSelect: boolean }> = [];
  const sessionState = createSessionState();
  const onAskUser = async (req: { question: string; options: string[]; multiSelect: boolean }) => {
    callLog.push(req);
    return opts.answer ?? req.options[0]!;
  };
  return {
    ctx: {
      cwd: '/tmp',
      abort: new AbortController().signal,
      confirmedByUser: true,
      sessionState,
      onAskUser,
    } as unknown as ToolCtx,
    callLog,
  };
}

describe('askUserQuestionTool', () => {
  it('execute 调 onAskUser 并把 answer 作为结果返回(单选)', async () => {
    const { ctx, callLog } = makeCtx({ answer: 'option-b' });
    const r = await askUserQuestionTool.execute(
      { question: '?', options: ['option-a', 'option-b'], multiSelect: false },
      ctx,
    );
    expect(callLog).toHaveLength(1);
    expect(callLog[0]).toEqual({ question: '?', options: ['option-a', 'option-b'], multiSelect: false });
    expect(r).toBe('option-b');
  });

  it('execute 支持多选,answer 是 string[]', async () => {
    const { ctx } = makeCtx({ answer: ['option-a', 'option-b'] });
    const r = await askUserQuestionTool.execute(
      { question: '?', options: ['option-a', 'option-b'], multiSelect: true },
      ctx,
    );
    expect(r).toEqual(['option-a', 'option-b']);
  });

  it('multiSelect 默认为 false', () => {
    const r = askUserQuestionTool.schema.safeParse({
      question: '?',
      options: ['a', 'b'],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.multiSelect).toBe(false);
  });

  it('schema 拒绝少于 2 个选项', () => {
    const r = askUserQuestionTool.schema.safeParse({ question: '?', options: ['only'] });
    expect(r.success).toBe(false);
  });

  it('schema 拒绝多于 4 个选项', () => {
    const r = askUserQuestionTool.schema.safeParse({
      question: '?',
      options: ['a', 'b', 'c', 'd', 'e'],
    });
    expect(r.success).toBe(false);
  });
});
```

### Step 2: 跑测试确认失败

```bash
cd /Users/eryiya/Documents/AI-info/agent && npx vitest run src/__tests__/tools/ask_user_question.test.ts
```

Expected: FAIL — module not found.

### Step 3: 创建 ask_user_question.ts

Create `src/tools/ask_user_question.ts`:

```ts
import { z } from 'zod';
import type { ToolDef, AskUserAnswer } from '../agent/types.js';

const schema = z.object({
  question: z.string().min(1).max(200),
  options: z.array(z.string().min(1).max(50)).min(2).max(4),
  multiSelect: z.boolean().default(false),
});

async function execute(
  input: z.infer<typeof schema>,
  ctx: import('../agent/types.js').ToolCtx,
): Promise<AskUserAnswer> {
  const req = { question: input.question, options: input.options, multiSelect: input.multiSelect };
  const answer = await ctx.onAskUser(req);
  return answer;
}

export const askUserQuestionTool: ToolDef<z.infer<typeof schema>> = {
  name: 'ask_user_question',
  description:
    '向用户展示一个 2-4 选项的单/多选题并等待回答。仅在你需要在互斥方案中让用户决策时使用。不要用于 yes/no(直接做或直接拒绝),不要用于开放问题(用户也会取消)。选项要互斥、明确。',
  safety: 'safe',
  schema,
  execute,
};
```

### Step 4: 跑测试

```bash
cd /Users/eryiya/Documents/AI-info/agent && npx tsc --noEmit && npx vitest run src/__tests__/tools/ask_user_question.test.ts
```

Expected: 5 passed.

### Step 5: 提交

```bash
cd /Users/eryiya/Documents/AI-info/agent && git add src/tools/ask_user_question.ts src/__tests__/tools/ask_user_question.test.ts && git commit -m "feat(tools): ask_user_question - 2-4 option picker with multiSelect"
```

---

## Task 6: 新建 `src/components/AskUserDialog.tsx` + 测试

**Files:**
- Create: `src/components/AskUserDialog.tsx`
- Test: `src/__tests__/components/AskUserDialog.test.tsx`

### Step 1: 写失败测试

Create `src/__tests__/components/AskUserDialog.test.tsx`. This uses `ink-testing-library` (already in devDeps per the v0.3.0 tooling):

```ts
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { AskUserDialog } from '../../components/AskUserDialog.js';

describe('AskUserDialog', () => {
  it('渲染 question + 所有 options', () => {
    const { lastFrame } = render(
      <AskUserDialog
        question="你选哪个?"
        options={['A', 'B', 'C']}
        multiSelect={false}
        onResolve={() => {}}
      />,
    );
    const out = lastFrame()!;
    expect(out).toContain('你选哪个?');
    expect(out).toContain('A');
    expect(out).toContain('B');
    expect(out).toContain('C');
  });

  it('单选:回车 resolve 第一个 option', () => {
    const onResolve = vi.fn();
    const { stdin } = render(
      <AskUserDialog
        question="?"
        options={['X', 'Y']}
        multiSelect={false}
        onResolve={onResolve}
      />,
    );
    stdin.write('\r');  // Enter
    expect(onResolve).toHaveBeenCalledWith('X');
  });

  it('单选:下箭头 + 回车 resolve 第二个', () => {
    const onResolve = vi.fn();
    const { stdin } = render(
      <AskUserDialog
        question="?"
        options={['X', 'Y']}
        multiSelect={false}
        onResolve={onResolve}
      />,
    );
    stdin.write('[B');  // down arrow
    stdin.write('\r');
    expect(onResolve).toHaveBeenCalledWith('Y');
  });

  it('Esc 触发 cancel sentinel', () => {
    const onResolve = vi.fn();
    const { stdin } = render(
      <AskUserDialog
        question="?"
        options={['X', 'Y']}
        multiSelect={false}
        onResolve={onResolve}
      />,
    );
    stdin.write('');  // Esc
    expect(onResolve).toHaveBeenCalledWith('__canceled__');
  });
});
```

### Step 2: 跑测试确认失败

```bash
cd /Users/eryiya/Documents/AI-info/agent && npx vitest run src/__tests__/components/AskUserDialog.test.tsx
```

Expected: FAIL — module not found.

### Step 3: 创建 AskUserDialog.tsx

Create `src/components/AskUserDialog.tsx`:

```tsx
import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

export interface AskUserDialogProps {
  question: string;
  options: string[];
  multiSelect: boolean;
  onResolve: (answer: string | string[] | '__canceled__') => void;
}

export function AskUserDialog({ question, options, multiSelect, onResolve }: AskUserDialogProps) {
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  useInput((input, key) => {
    if (key.escape) {
      onResolve('__canceled__');
      return;
    }
    if (key.upArrow) {
      setCursor((c) => (c - 1 + options.length) % options.length);
      return;
    }
    if (key.downArrow) {
      setCursor((c) => (c + 1) % options.length);
      return;
    }
    if (multiSelect && input === ' ') {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(cursor)) next.delete(cursor);
        else next.add(cursor);
        return next;
      });
      return;
    }
    if (key.return) {
      if (multiSelect) {
        if (selected.size === 0) return;
        const answer = Array.from(selected).sort().map((i) => options[i]!);
        onResolve(answer);
      } else {
        onResolve(options[cursor]!);
      }
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold>{question}</Text>
      {options.map((opt, i) => {
        const isCursor = i === cursor;
        const isSelected = selected.has(i);
        const prefix = isCursor ? '▶ ' : '  ';
        const marker = multiSelect ? (isSelected ? '[x]' : '[ ]') : '  ';
        return (
          <Text key={i}>
            {prefix}
            {marker} {opt}
          </Text>
        );
      })}
      <Text dimColor>
        {multiSelect ? '↑↓ 移动 / 空格 勾选 / 回车 确认 / Esc 取消' : '↑↓ 移动 / 回车 确认 / Esc 取消'}
      </Text>
    </Box>
  );
}
```

### Step 4: 跑测试

```bash
cd /Users/eryiya/Documents/AI-info/agent && npx tsc --noEmit && npx vitest run src/__tests__/components/AskUserDialog.test.tsx
```

Expected: 4 passed. (如果 ink-testing-library 报 stdio 控制码问题,查 stdin.write 的实际转义码是否匹配平台)

### Step 5: 提交

```bash
cd /Users/eryiya/Documents/AI-info/agent && git add src/components/AskUserDialog.tsx src/__tests__/components/AskUserDialog.test.tsx && git commit -m "feat(ui): AskUserDialog - Ink component for 2-4 option picker with Esc cancel"
```

---

## Task 7: 新建 `src/components/TodoList.tsx`(无独立测试,集成到 app.tsx 时一起验)

**Files:**
- Create: `src/components/TodoList.tsx`

### Step 1: 创建 TodoList.tsx

```tsx
import React from 'react';
import { Box, Text } from 'ink';
import type { TodoItem } from '../agent/sessionState.js';

export interface TodoListProps {
  todos: TodoItem[];
}

function statusIcon(status: TodoItem['status']): string {
  if (status === 'completed') return '✓';
  if (status === 'in_progress') return '▶';
  return '·';
}

export function TodoList({ todos }: TodoListProps) {
  if (todos.length === 0) return null;
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} marginBottom={1}>
      <Text dimColor>Tasks</Text>
      {todos.map((t, i) => (
        <Text key={i} color={t.status === 'completed' ? 'gray' : undefined} strikethrough={t.status === 'completed'}>
          {statusIcon(t.status)} {t.content}
        </Text>
      ))}
    </Box>
  );
}
```

### Step 2: typecheck

```bash
cd /Users/eryiya/Documents/AI-info/agent && npx tsc --noEmit
```

Expected: clean (TodoList 没有依赖任何还没接的运行时,只 import type)。

### Step 3: 提交

```bash
cd /Users/eryiya/Documents/AI-info/agent && git add src/components/TodoList.tsx && git commit -m "feat(ui): TodoList - Ink component for session todo display"
```

---

## Task 8: 改 `src/agent/loop.ts` —— 把 sessionState 注入 ToolCtx

**Files:**
- Modify: `src/agent/loop.ts` (1 行改动)

### Step 1: 找到 `tool.execute(...)` 调用的地方

`grep -n "extraCtx" src/agent/loop.ts` 找到 ToolCtx 构造点(在 batch map 的 async 函数里)。

### Step 2: 改 1 行

在构造 ToolCtx 对象那行加 `sessionState`:

```ts
const out = await tool.execute(v.data, {
  cwd, abort: signal, confirmedByUser: true,
  sessionState,                 // <-- ADD
  ...(extraCtx ?? {}),
} as never);
```

(loop 顶部 `const sessionState = input.sessionState;` 在 destructure 时一行加上即可,见 Step 3。)

### Step 3: 在 runTurn 顶部解构 sessionState / onAskUser

找到 `const { messages: initialMessages, tools, cwd, yolo, onEvent, onConfirm, signal, client, model, maxContextTokens, extraCtx, auditSink, onUsage } = input;`

扩展为:

```ts
const { messages: initialMessages, tools, cwd, yolo, onEvent, onConfirm, signal, client, model, maxContextTokens, extraCtx, auditSink, onUsage, sessionState, onAskUser } = input;
```

### Step 4: 跑现有 loop.test.ts 看基线

```bash
cd /Users/eryiya/Documents/AI-info/agent && npx vitest run src/__tests__/loop.test.ts 2>&1 | tail -5
```

Expected: **会失败** —— 旧的 `runTurn` 调用没传 `sessionState` / `onAskUser`。预期行为。

### Step 5: 改 loop.test.ts 所有 `runTurn({...})` 调用

**机械改动**:在每个 `runTurn({` 调用里加 2 个字段:

```ts
sessionState: createSessionState(),
onAskUser: async () => '__canceled__',
```

如果嫌每个测试都加太繁琐,可以在测试文件顶部加一个 helper:

```ts
function baseRunTurnArgs(overrides: Partial<Parameters<typeof runTurn>[0]>) {
  return {
    sessionState: createSessionState(),
    onAskUser: async () => '__canceled__',
    ...overrides,
  };
}
```

然后把所有 `runTurn({...})` 改成 `runTurn(baseRunTurnArgs({...}))`。

### Step 6: 跑全套测试

```bash
cd /Users/eryiya/Documents/AI-info/agent && npx tsc --noEmit && npx vitest run
```

Expected: 全过(包括之前 154 个 + 本次新增 23 个 = ~177)。

### Step 7: 提交

```bash
cd /Users/eryiya/Documents/AI-info/agent && git add src/agent/loop.ts src/__tests__/loop.test.ts && git commit -m "feat(loop): inject sessionState into ToolCtx; propagate to all tools"
```

---

## Task 9: 改 `src/app.tsx` —— 注入 system prompt + 接 AskUserDialog + 渲染 TodoList

**Files:**
- Modify: `src/app.tsx`

### Step 1: 加 imports

```ts
import { buildSystemPrompt } from './agent/systemPrompt.js';
import { createSessionState, type TodoItem } from './agent/sessionState.js';
import { AskUserDialog } from './components/AskUserDialog.js';
import { TodoList } from './components/TodoList.js';
```

### Step 2: 注入 system prompt

找到 app.tsx 构造 initialMessages 的地方(`messages: [{ role: 'user', content: 'hi' }]` 这种调用 runTurn 的地方),改成:

```ts
const sessionState = createSessionState();
const messages = useMemo(
  () => [{ role: 'system', content: buildSystemPrompt() }, ...initialMessages],
  [initialMessages],
);
```

### Step 3: 订阅 sessionState.onChange

```ts
const [todos, setTodos] = useState<TodoItem[]>([]);
useEffect(() => {
  sessionState.onChange = (next) => setTodos(next);
  return () => { sessionState.onChange = undefined; };
}, [sessionState]);
```

### Step 4: 加 pendingQuestion state + onAskUser 实现

```ts
const [pendingQuestion, setPendingQuestion] = useState<AskUserRequest | null>(null);
const pendingResolveRef = useRef<((a: AskUserAnswer) => void) | null>(null);

const onAskUser = useCallback((req: AskUserRequest): Promise<AskUserAnswer> => {
  return new Promise((resolve) => {
    pendingResolveRef.current = resolve;
    setPendingQuestion(req);
  });
}, []);
```

### Step 5: 扩展 applyEvent

加 3 个 case(在现有 case 列表末尾):

```ts
case 'ask_user': {
  // 工具侧会 await onAskUser,我们不需要在这里 set state(set 由 onAskUser 完成)
  break;
}
case 'todo_updated': {
  // 已由 sessionState.onChange 触发 setTodos
  break;
}
```

(其实可以省略这两个 case,UI 全靠 onChange + onAskUser 推动,事件仅作审计/转发)

### Step 6: 把 sessionState / onAskUser 传给 runTurn

在 `runTurn({...})` 调用里加:

```ts
sessionState,
onAskUser,
```

### Step 7: 渲染 TodoList + AskUserDialog

在主消息流的渲染区(<MainArea> 或 inline)加:

```tsx
<TodoList todos={todos} />
{pendingQuestion && (
  <AskUserDialog
    question={pendingQuestion.question}
    options={pendingQuestion.options}
    multiSelect={pendingQuestion.multiSelect}
    onResolve={(ans) => {
      setPendingQuestion(null);
      if (ans === '__canceled__') {
        pendingResolveRef.current?.('__canceled__');
      } else {
        pendingResolveRef.current?.(ans as AskUserAnswer);
      }
      pendingResolveRef.current = null;
    }}
  />
)}
```

### Step 8: 跑全套测试

```bash
cd /Users/eryiya/Documents/AI-info/agent && npx tsc --noEmit && npx vitest run && npm run build
```

Expected: 全过(177 个),build 成功。

### Step 9: 提交

```bash
cd /Users/eryiya/Documents/AI-info/agent && git add src/app.tsx && git commit -m "feat(app): wire systemPrompt + SessionState + AskUserDialog + TodoList"
```

---

## Task 10: 写 CHANGELOG + README

**Files:**
- Modify: `CHANGELOG.md`(新增 v0.4.0 条目)
- Modify: `README.md`(添加 TodoWrite + AskUserQuestion 一行说明)

### Step 1: 在 CHANGELOG.md 顶部加 v0.4.0

```markdown
## [0.4.0] - 2026-06-06

### Added
- **TodoWrite 工具**——LLM 可在多步任务中维护 1-7 条任务清单,会话级 state,UI 实时渲染。
- **AskUserQuestion 工具**——LLM 可弹出 2-4 选项的单/多选题,等用户决策。独立 Ink 组件 + useInput 路由。
- **System Prompt 注入**——`src/agent/systemPrompt.ts` 在每轮会话开始时注入行为指引(TodoWrite / AskUserQuestion 使用建议)。
- **SessionState**——`src/agent/sessionState.ts` 提供 session 级 mutable state 通道(`SessionState.todos` + `onChange`)。
- **3 个新 AgentEvent 变体**:`todo_updated` / `ask_user` / `ask_user_resolved`。
- **新组件**:`AskUserDialog` (Ink 弹窗) + `TodoList` (会话顶部持续显示)。
- 新测试:sessionState 4 例、systemPrompt 4 例、todo_write 6 例、ask_user_question 5 例、AskUserDialog 4 例,共 23 新增。
```

### Step 2: 在 README.md 加 2 行

加在"工具并发执行"那条下方:

```markdown
- **TodoWrite 任务清单**——v0.4 引入:多步任务时 LLM 自动维护 1-7 条 todo,UI 顶部持续显示进度。
- **AskUserQuestion 反问**——v0.4 引入:LLM 在 2-4 互斥方案间可弹单/多选题给用户,Esc 取消。
```

### Step 3: 跑全套 + build

```bash
cd /Users/eryiya/Documents/AI-info/agent && npx tsc --noEmit && npx vitest run && npm run build
```

Expected: 全部通过,build 成功。

### Step 4: 提交

```bash
cd /Users/eryiya/Documents/AI-info/agent && git add CHANGELOG.md README.md && git commit -m "docs: v0.4.0 changelog + README TodoWrite + AskUserQuestion"
```

---

## Self-Review Checklist

- [x] **Spec coverage**: 4 个 brainstorming 决策全部映射到具体 task
  - session state 拓宽 → Task 1 (`sessionState.ts`) + Task 2 (ToolCtx 扩展) + Task 8 (loop 注入)
  - 独立 UI 组件 + useInput 路由 → Task 6 (`AskUserDialog`) + Task 9 (app.tsx 路由)
  - systemPrompt.ts + 注入 → Task 3 + Task 9
  - MVP 范围 → Task 4 (1-7 todos) + Task 5 (2-4 options)
- [x] **No placeholders**: 每个 step 都有完整代码
- [x] **Type consistency**: `SessionState` / `TodoItem` / `AskUserRequest` / `AskUserAnswer` 在 Task 1+2 定义后,后续 task 全部复用同一组类型
- [x] **TDD order**: 9 个实现 task 都是 test-first
- [x] **Frequent commits**: 10 个 task / 至少 10 次 commit

---

## Estimate

| Task | 内容 | 代码(估) | 测试(估) | 时间 |
|------|------|----------|----------|------|
| 1 | SessionState | 30 | 30 | 5 min |
| 2 | types 扩展 | 25 | 20 | 5 min |
| 3 | systemPrompt | 25 | 15 | 5 min |
| 4 | todo_write | 50 | 40 | 8 min |
| 5 | ask_user_question | 50 | 35 | 8 min |
| 6 | AskUserDialog | 80 | 35 | 12 min |
| 7 | TodoList | 25 | 0 | 3 min |
| 8 | loop.ts 改 1 行 + 测试更新 | 5 | 15 | 8 min |
| 9 | app.tsx 接入 | 60 | 0 | 15 min |
| 10 | CHANGELOG + README | 20 | 0 | 5 min |
| **合计** | | **~370** | **~190** | **~75 min** |
