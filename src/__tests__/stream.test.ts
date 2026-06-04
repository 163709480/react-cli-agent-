import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { zodToJsonSchema } from '../agent/schema.js';

describe('schema edge cases for stream input', () => {
  it('array 类型', () => {
    const s = zodToJsonSchema(z.array(z.string()));
    expect(s).toMatchObject({ type: 'array', items: { type: 'string' } });
  });

  it('union(实际为 type 数组形式)', () => {
    // zod-to-json-schema 对原始类型 union 用 draft-07 的 type 数组形式
    const s = zodToJsonSchema(z.union([z.string(), z.number()]));
    expect(s).toMatchObject({ type: ['string', 'number'] });
  });

  it('literal', () => {
    const s = zodToJsonSchema(z.literal('on'));
    expect(s).toMatchObject({ const: 'on' });
  });
});
