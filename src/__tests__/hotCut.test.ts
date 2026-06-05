import { describe, it, expect } from 'vitest';
import { hotCut } from '../agent/hotCut.js';
import { estimateTokens } from '../agent/context.js';
import type { Message } from '../agent/types.js';

describe('hotCut', () => {
  it('空 messages 返回 cutCount=0', () => {
    const r = hotCut([], 1000);
    expect(r.cutCount).toBe(0);
    expect(r.messages).toEqual([]);
  });

  it('短 messages 不切', () => {
    const msgs: Message[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
    ];
    const r = hotCut(msgs, 10_000);
    expect(r.cutCount).toBe(0);
    // 引用相等(无修改)
    expect(r.messages).toBe(msgs);
  });

  it('长 tool messages 切到 ≤ 0.85 * maxContextTokens', () => {
    // 构造 5 条巨大 tool message(每条约 5000 token,远大于阈值)
    const big = 'x'.repeat(20_000); // ~5K tokens
    const msgs: Message[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'task' },
      { role: 'tool', tool_call_id: 't1', content: big },
      { role: 'tool', tool_call_id: 't2', content: big },
      { role: 'tool', tool_call_id: 't3', content: big },
      { role: 'tool', tool_call_id: 't4', content: big },
      { role: 'tool', tool_call_id: 't5', content: big },
    ];
    // maxContextTokens=4000 → 0.85 * 4000 = 3400 token 上限
    const r = hotCut(msgs, 4000);
    expect(r.cutCount).toBeGreaterThan(0);
    // 切完应 ≤ 0.85 * maxContextTokens(best-effort 路径)
    expect(estimateTokens(r.messages)).toBeLessThanOrEqual(0.85 * 4000);
    // 改写后,原 tool message 的 content 必须变 marker
    const truncated = r.messages.filter(
      (m) => m.role === 'tool' && typeof m.content === 'string' && m.content.includes('truncated'),
    );
    expect(truncated.length).toBe(r.cutCount);
    // message 数量不变(只改 content,不动位置)
    expect(r.messages.length).toBe(msgs.length);
  });

  it('system 永远保留', () => {
    const big = 'x'.repeat(40_000);
    const msgs: Message[] = [
      { role: 'system', content: 'IMORTANT-SYS-MARKER' },
      { role: 'tool', tool_call_id: 't1', content: big },
      { role: 'tool', tool_call_id: 't2', content: big },
    ];
    const r = hotCut(msgs, 2000);
    const sys = r.messages.find((m) => m.role === 'system');
    expect(sys?.content).toBe('IMORTANT-SYS-MARKER');
  });

  it('最近 1 条 user 保留', () => {
    const big = 'x'.repeat(40_000);
    const msgs: Message[] = [
      { role: 'tool', tool_call_id: 't1', content: big },
      { role: 'tool', tool_call_id: 't2', content: big },
      { role: 'user', content: 'LAST-USER-MARKER' },
    ];
    const r = hotCut(msgs, 2000);
    // 最后一条 user 的 content 保持原值
    const lastUser = r.messages.filter((m) => m.role === 'user').pop();
    expect(lastUser?.content).toBe('LAST-USER-MARKER');
  });

  it('切完 message 还在原位(只改 content)', () => {
    const big = 'x'.repeat(40_000);
    const msgs: Message[] = [
      { role: 'system', content: 'sys' },
      { role: 'tool', tool_call_id: 't1', content: big },
      { role: 'tool', tool_call_id: 't2', content: big },
      { role: 'tool', tool_call_id: 't3', content: big },
    ];
    const r = hotCut(msgs, 1000);
    // 数组长度不变
    expect(r.messages.length).toBe(msgs.length);
    // 第一条还是 system(不动)
    expect(r.messages[0].role).toBe('system');
    // 被切的 tool 消息 role 不变,tool_call_id 不变
    const cutTool = r.messages.find(
      (m) => m.role === 'tool' && m.tool_call_id === 't1' && typeof m.content === 'string' && m.content.includes('truncated'),
    );
    expect(cutTool).toBeDefined();
  });
});
