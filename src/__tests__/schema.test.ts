import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { toolDescriptor, zodToJsonSchema } from '../agent/schema.js';

describe('zodToJsonSchema', () => {
  it('转换 string zod', () => {
    const s = zodToJsonSchema(z.string());
    expect(s).toEqual({ type: 'string' });
  });

  it('转换 object with optional field', () => {
    const s = zodToJsonSchema(
      z.object({
        path: z.string(),
        offset: z.number().int().nonnegative().optional(),
        limit: z.number().int().positive().optional(),
      }),
    );
    expect(s).toMatchObject({
      type: 'object',
      properties: {
        path: { type: 'string' },
        offset: { type: 'number' },
        limit: { type: 'number' },
      },
      required: ['path'],
    });
  });

  it('转换 enum', () => {
    const s = zodToJsonSchema(z.enum(['GET', 'POST']));
    expect(s).toEqual({ type: 'string', enum: ['GET', 'POST'] });
  });

  it('转换 nested object', () => {
    const s = zodToJsonSchema(
      z.object({
        url: z.string().url(),
        headers: z.record(z.string()).optional(),
      }),
    );
    expect(s).toMatchObject({
      type: 'object',
      properties: {
        url: { type: 'string', format: 'uri' },
        headers: { type: 'object', additionalProperties: { type: 'string' } },
      },
      required: ['url'],
    });
  });
});

describe('toolDescriptor', () => {
  it('包装为 OpenAI tool 格式', () => {
    const d = toolDescriptor({
      name: 'read_file',
      description: 'Read a file from disk',
      safety: 'safe',
      schema: z.object({ path: z.string() }),
      execute: async () => '',
    });
    expect(d).toEqual({
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read a file from disk',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      },
    });
  });
});
