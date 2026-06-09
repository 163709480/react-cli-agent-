import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { zodToJsonSchema } from '../agent/schema.js';
import { chatCompletionStream } from '../llm/stream.js';
import type OpenAI from 'openai';

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

// --- 集成测试:thinking 块过滤 ---

interface FakeChunk {
  choices?: Array<{ delta: { content?: string; tool_calls?: unknown[] }; finish_reason?: string | null }>;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

function makeFakeStream(chunks: FakeChunk[]): AsyncIterable<FakeChunk> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next() {
          if (i >= chunks.length) return { value: undefined, done: true };
          return { value: chunks[i++], done: false };
        },
      };
    },
  };
}

function makeFakeClient(chunks: FakeChunk[]): OpenAI {
  return {
    chat: {
      completions: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        create: async () => makeFakeStream(chunks) as any,
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

async function collectText(stream: AsyncGenerator<unknown>): Promise<string> {
  let out = '';
  for await (const ev of stream) {
    if ((ev as { type: string; delta?: string }).type === 'text_delta') {
      out += (ev as { delta: string }).delta;
    }
  }
  return out;
}

describe('chatCompletionStream thinking 块过滤', () => {
  it('单 chunk 完整 thinking 块被剥', async () => {
    const client = makeFakeClient([
      { choices: [{ delta: { content: 'hello<think>reasoning</think>world' }, finish_reason: 'stop' }] },
    ]);
    const events = chatCompletionStream({
      client,
      model: 'm',
      messages: [{ role: 'user', content: 'x' }],
      tools: [],
      signal: new AbortController().signal,
    });
    const text = await collectText(events);
    expect(text).toBe('helloworld');
  });

  it('thinking 块跨多 chunk 也剥干净', async () => {
    // 现实场景:`<think>` 后整段 thinking 内容可能在不同 chunk,直到 `</think>` 才闭合
    const client = makeFakeClient([
      { choices: [{ delta: { content: 'A<think>' } }] },
      { choices: [{ delta: { content: 'step 1, ' } }] },
      { choices: [{ delta: { content: 'step 2' } }] },
      { choices: [{ delta: { content: '</think>B' }, finish_reason: null }] },
      { choices: [{ delta: { content: 'C' }, finish_reason: 'stop' }] },
    ]);
    const text = await collectText(chatCompletionStream({
      client, model: 'm', messages: [{ role: 'user', content: 'x' }],
      tools: [], signal: new AbortController().signal,
    }));
    expect(text).toBe('ABC');
  });

  it('未闭合的 thinking(`` 后到末尾)被剥', async () => {
    const client = makeFakeClient([
      { choices: [{ delta: { content: 'before<think>half-baked reasoning' }, finish_reason: 'stop' }] },
    ]);
    const text = await collectText(chatCompletionStream({
      client, model: 'm', messages: [{ role: 'user', content: 'x' }],
      tools: [], signal: new AbortController().signal,
    }));
    expect(text).toBe('before');
  });

  it('无 thinking 时正常输出', async () => {
    const client = makeFakeClient([
      { choices: [{ delta: { content: 'plain ' } }] },
      { choices: [{ delta: { content: 'text' }, finish_reason: 'stop' }] },
    ]);
    const text = await collectText(chatCompletionStream({
      client, model: 'm', messages: [{ role: 'user', content: 'x' }],
      tools: [], signal: new AbortController().signal,
    }));
    expect(text).toBe('plain text');
  });

  it('纯 thinking(没正文)返回空', async () => {
    const client = makeFakeClient([
      { choices: [{ delta: { content: '<think>only thinking</think>' }, finish_reason: 'stop' }] },
    ]);
    const text = await collectText(chatCompletionStream({
      client, model: 'm', messages: [{ role: 'user', content: 'x' }],
      tools: [], signal: new AbortController().signal,
    }));
    expect(text).toBe('');
  });

  it('abort 路径 force flush 也剥 thinking(回归:之前 force 路径没 strip)', async () => {
    const ac = new AbortController();
    const client = makeFakeClient([
      { choices: [{ delta: { content: 'half<think>reasoning' } }] },
      { choices: [{ delta: { content: ' still going' } }] },
    ]);
    const events = chatCompletionStream({
      client, model: 'm', messages: [{ role: 'user', content: 'x' }],
      tools: [], signal: ac.signal,
    });
    const collected: string[] = [];
    for await (const ev of events) {
      const e = ev as { type: string; delta?: string; finishReason?: string };
      if (e.type === 'text_delta') collected.push(e.delta!);
      // 中途 abort(模拟用户 Ctrl+C)
      ac.abort();
    }
    // 不应有 "<think>" 或 "still going" 这种泄漏(如果 force 没 strip,会出现 "still going")
    const full = collected.join('');
    expect(full).not.toMatch(/<think>/);
    expect(full).not.toMatch(/still going/);
    expect(full).toBe('half');
  });
});
