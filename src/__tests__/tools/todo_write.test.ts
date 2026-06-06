import { describe, it, expect, vi } from 'vitest';
import { todoWriteTool } from '../../tools/todo_write.js';
import { createSessionState } from '../../agent/sessionState.js';
import type { ToolCtx } from '../../agent/types.js';

function makeCtx(): { ctx: ToolCtx } {
  const sessionState = createSessionState();
  return {
    ctx: {
      cwd: '/tmp',
      abort: new AbortController().signal,
      confirmedByUser: true,
      sessionState,
      onAskUser: async () => '',
    } as unknown as ToolCtx,
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
