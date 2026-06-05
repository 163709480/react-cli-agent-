import { describe, it, expect, vi } from 'vitest';
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

  it('传给 summarizer 的中间文本包含 role / content / tool_call / name / tool_call_id', async () => {
    // tail = slice(-6) → 9 条时 tail 覆盖索引 3~8
    // 我们要 tool_call / tool_call_id / name 都落在 middle 里
    // 所以把它们都放在索引 1~2(system 占 0),tail 3~8 都是普通 user/assistant
    const msgs: Message[] = [
      { role: 'system', content: 'sys' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_abc',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"x.ts"}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_abc', name: 'read_file', content: 'file contents' },
      { role: 'user', content: 'tail1' },
      { role: 'assistant', content: 'tail2' },
      { role: 'user', content: 'tail3' },
      { role: 'assistant', content: 'tail4' },
      { role: 'user', content: 'tail5' },
      { role: 'assistant', content: 'tail6' },
    ];

    const summarizer = vi.fn(async () => '<<SUMMARY>>');
    const out = await compress(msgs, summarizer);

    expect(summarizer).toHaveBeenCalledTimes(1);
    const input = summarizer.mock.calls[0][0] as string;

    // role 前缀
    expect(input).toMatch(/\[assistant\]/);
    expect(input).toMatch(/\[tool\]/);
    // tool_call 被序列化进文本
    expect(input).toContain('[tool_call call_abc]');
    expect(input).toContain('read_file(');
    expect(input).toContain('"path":"x.ts"');
    // tool message 的 name / tool_call_id 都带上
    expect(input).toContain('name=read_file');
    expect(input).toContain('tool_call_id=call_abc');
    expect(input).toContain('file contents');
    // 尾部 tail1~6 不该出现在 middle 里
    expect(input).not.toContain('tail1');
    expect(input).not.toContain('tail6');

    // 摘要结果仍含 prefix
    const summary = out.find((m) => typeof m.content === 'string' && m.content.includes('<<SUMMARY>>'));
    expect(summary?.content).toMatch(/\[Summary of earlier conversation\]/);
    // 最终 out = 1 system + 1 summary + 6 tail = 8
    expect(out.length).toBe(8);
  });

  it('只有 7 条及以下时不做压缩', async () => {
    const summarizer = vi.fn(async () => '<<SUMMARY>>');
    const msgs: Message[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' },
    ];
    const out = await compress(msgs, summarizer);
    expect(summarizer).not.toHaveBeenCalled();
    // 返回浅拷贝(避免 caller 突变影响,见 loop.ts 的 messages.length=0 模式)
    expect(out).not.toBe(msgs);
    expect(out).toEqual(msgs);
  });
});
