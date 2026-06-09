import { describe, it, expect } from 'vitest';
import { stripThinking } from '../llm/thinking.js';

describe('stripThinking(屏蔽 provider 自带的 CoT 块)', () => {
  it('空串/无 tag 原样返回', () => {
    expect(stripThinking('')).toBe('');
    expect(stripThinking('hello world')).toBe('hello world');
  });

  it('整段闭合的 thinking 块被剥', () => {
    const inp = '你好<think>The user said hello</think>世界';
    expect(stripThinking(inp)).toBe('你好世界');
  });

  it('多段 thinking 块都被剥', () => {
    const inp = 'A<think>thinking 1</think>B<think>thinking 2</think>C';
    expect(stripThinking(inp)).toBe('ABC');
  });

  it('未闭合的 thinking 块:`` 之后到末尾全丢', () => {
    const inp = '前面<think>还没想完的推理...';
    expect(stripThinking(inp)).toBe('前面');
  });

  it('纯 thinking 内容(整段都是)返回空', () => {
    expect(stripThinking('<think>all thinking, no answer</think>')).toBe('');
  });

  it('跨多行 thinking 也能剥', () => {
    const inp = '开始<think>line 1\nline 2\nline 3</think>结束';
    expect(stripThinking(inp)).toBe('开始结束');
  });

  it('大小写敏感:大写 THINK 不会触发', () => {
    // 仅处理小写 ``(LLM 通常统一用小写,这里保持严格)
    expect(stripThinking('hi<think>x</think>')).toBe('hi');
    expect(stripThinking('hi<THINK>x</THINK>')).toBe('hi<THINK>x</THINK>');
  });

  it('孤立的 ``(没有 ``)原样保留', () => {
    // 这种情况可能是 chunk 边界切断 — `` 之前不是 thinking
    expect(stripThinking('1, step 2</think>B')).toBe('1, step 2</think>B');
  });

  it('连续 3 个 thinking 块', () => {
    const inp = 'A<think>1</think>B<think>2</think>C<think>3</think>D';
    expect(stripThinking(inp)).toBe('ABCD');
  });
});
