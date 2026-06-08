import { describe, it, expect } from 'vitest';
import React from 'react';
import { Box } from 'ink';
import { render } from 'ink-testing-library';
import { MessageList, type DisplayMessage } from '../components/MessageList.js';

function mkMessages(n: number, role: 'user' | 'assistant' = 'assistant'): DisplayMessage[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `m${i}`,
    role,
    content: `${role} #${i}`,
  }));
}

describe('MessageList', () => {
  it('未传 maxMessages 时全部渲染', () => {
    const { lastFrame } = render(
      <Box width={80}><MessageList messages={mkMessages(5)} /></Box>,
    );
    const out = lastFrame();
    for (let i = 0; i < 5; i++) {
      expect(out).toMatch(new RegExp(`assistant #${i}`));
    }
  });

  it('传 maxMessages 时只渲染尾部', () => {
    const { lastFrame } = render(
      <Box width={80}><MessageList messages={mkMessages(10)} maxMessages={3} /></Box>,
    );
    const out = lastFrame();
    // 应当显示最后 3 条
    expect(out).toMatch(/assistant #7/);
    expect(out).toMatch(/assistant #8/);
    expect(out).toMatch(/assistant #9/);
    // 应当不显示前 7 条
    expect(out).not.toMatch(/assistant #0/);
    expect(out).not.toMatch(/assistant #6/);
  });

  it('传 maxMessages 时显示"earlier messages"省略提示', () => {
    const { lastFrame } = render(
      <Box width={80}><MessageList messages={mkMessages(10)} maxMessages={3} /></Box>,
    );
    expect(lastFrame()).toMatch(/earlier messages/);
  });

  it('maxMessages 大于等于消息数时不显示省略', () => {
    const { lastFrame } = render(
      <Box width={80}><MessageList messages={mkMessages(3)} maxMessages={5} /></Box>,
    );
    expect(lastFrame()).not.toMatch(/earlier messages/);
  });

  it('maxMessages=0 显示完整省略提示', () => {
    const { lastFrame } = render(
      <Box width={80}><MessageList messages={mkMessages(5)} maxMessages={0} /></Box>,
    );
    expect(lastFrame()).toMatch(/earlier messages/);
    for (let i = 0; i < 5; i++) {
      expect(lastFrame()).not.toMatch(new RegExp(`assistant #${i}`));
    }
  });
});
