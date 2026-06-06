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
