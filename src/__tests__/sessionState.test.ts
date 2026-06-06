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
