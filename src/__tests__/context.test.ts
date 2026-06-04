import { describe, it, expect } from 'vitest';
import { estimateTokens, shouldCompress, compress } from '../agent/context.js';
import type { Message } from '../agent/types.js';

describe('estimateTokens', () => {
  it('空 messages 估 0', () => {
    expect(estimateTokens([])).toBe(0);
  });

  it('字符串 content 估 token', () => {
    const tokens = estimateTokens([{ role: 'user', content: 'hello world' }]);
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThan(10);
  });
});

describe('shouldCompress', () => {
  it('低于阈值不压缩', () => {
    const msgs: Message[] = [
      { role: 'system', content: 'short' },
      { role: 'user', content: 'hi' },
    ];
    expect(shouldCompress(msgs, 1000)).toBe(false);
  });

  it('超过阈值压缩', () => {
    const long = 'x'.repeat(5000);
    const msgs: Message[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: long },
      { role: 'assistant', content: long },
    ];
    // max 1000 * 0.7 = 700
    expect(shouldCompress(msgs, 1000)).toBe(true);
  });
});

describe('compress', () => {
  it('保留 system 和最近 6 条,中间折成 summary', async () => {
    const msgs: Message[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'old1' },
      { role: 'assistant', content: 'old2' },
      { role: 'user', content: 'old3' },
      { role: 'assistant', content: 'old4' },
      { role: 'user', content: 'recent1' },
      { role: 'assistant', content: 'recent2' },
      { role: 'user', content: 'recent3' },
    ];
    // 注入假 summarizer
    const out = await compress(msgs, async () => '<<SUMMARY>>');
    // system 保留
    expect(out[0]).toEqual({ role: 'system', content: 'sys' });
    // 中间有 summary(包含 prefix)
    const summary = out.find((m) => typeof m.content === 'string' && m.content.includes('<<SUMMARY>>'));
    expect(summary).toBeDefined();
    // summary 标记前缀
    expect(summary?.content).toMatch(/\[Summary of earlier conversation\]/);
    // 最后 6 条保留
    expect(out[out.length - 1].content).toBe('recent3');
    // 总数 = 1 system + 1 summary + 6 recent = 8
    expect(out.length).toBe(8);
  });
});
