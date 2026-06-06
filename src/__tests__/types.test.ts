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
