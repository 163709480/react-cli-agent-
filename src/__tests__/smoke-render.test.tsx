/**
 * Smoke 测试:模拟 80x30 终端,渲染完整 App,捕获前 60 帧输出,帮助定位
 * "esc to interrup" 被裁 / Thinking for -1s / 大块空白 等视觉 bug。
 *
 * 不直接 import App(它有副作用 + 依赖 audit 等),改用 HeadStatus + Welcome + InputBox
 * 组合 + 模拟的 messages list。
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { HeadStatus } from '../components/HeadStatus.js';
import { Welcome } from '../components/Welcome.js';
import { InputBox } from '../components/InputBox.js';
import { MessageList } from '../components/MessageList.js';

describe('TUI smoke render', () => {
  it('esc to interrupt 完整显示(InputBox disabled 状态)', async () => {
    const { lastFrame } = render(<InputBox onSubmit={() => {}} disabled={true} />);
    await new Promise<void>((r) => setTimeout(r, 50));
    const out = lastFrame()!;
    console.log('--- InputBox disabled ---');
    console.log(out);
    console.log('--- end ---');
    // 完整文案,不应该被裁
    expect(out).toMatch(/esc to interrupt/);
  });

  it('esc to interrupt 完整显示(80 列宽)', async () => {
    const { lastFrame, stdout } = render(<InputBox onSubmit={() => {}} disabled={true} />);
    Object.defineProperty(stdout, 'columns', { value: 80, configurable: true });
    await new Promise<void>((r) => setTimeout(r, 50));
    const out = lastFrame()!;
    console.log('--- 80 cols ---');
    console.log(out);
    console.log('--- end ---');
    expect(out).toMatch(/esc to interrupt/);
  });

  it('HeadStatus thinking 不会显示负数', async () => {
    const { lastFrame } = render(
      <HeadStatus phase="thinking" phaseStartMs={Date.now()} />,
    );
    await new Promise<void>((r) => setTimeout(r, 50));
    const out = lastFrame()!;
    console.log('--- thinking now ---');
    console.log(out);
    console.log('--- end ---');
    expect(out).not.toMatch(/-\d+s/);
  });

  it('HeadStatus thinking phaseStartMs 远在未来(模拟)也不会负数', async () => {
    const { lastFrame } = render(
      <HeadStatus phase="thinking" phaseStartMs={Date.now() + 5000} />,
    );
    await new Promise<void>((r) => setTimeout(r, 50));
    const out = lastFrame()!;
    console.log('--- thinking future +5s ---');
    console.log(out);
    console.log('--- end ---');
    expect(out).not.toMatch(/-\d+s/);
  });

  it('Welcome 实际渲染:有多少行?', async () => {
    const { lastFrame } = render(
      <Welcome model="MiniMax-M3" cwd="/Users/eryiya" provider="minimax" />,
    );
    await new Promise<void>((r) => setTimeout(r, 50));
    const out = lastFrame()!;
    const lines = out.split('\n');
    console.log('--- Welcome lines:', lines.length, '---');
    lines.forEach((l, i) => console.log(`${i.toString().padStart(2)}: |${l}|`));
    console.log('--- end ---');
    expect(lines.length).toBeGreaterThan(5);
  });

  it('完整 App 类布局模拟:30 行终端看效果', async () => {
    // 模拟 30 行终端,渲染 Welcome + HeadStatus + InputBox
    const { lastFrame, stdout } = render(
      <React.Fragment>
        <Welcome model="MiniMax-M3" cwd="/Users/eryiya" provider="minimax" />
        <MessageList messages={[]} />
        <HeadStatus phase="thinking" phaseStartMs={Date.now()} />
        <InputBox onSubmit={() => {}} disabled={false} />
      </React.Fragment>,
    );
    Object.defineProperty(stdout, 'columns', { value: 80, configurable: true });
    Object.defineProperty(stdout, 'rows', { value: 30, configurable: true });
    await new Promise<void>((r) => setTimeout(r, 50));
    const out = lastFrame()!;
    const lines = out.split('\n');
    console.log('--- 30-row full layout, lines:', lines.length, '---');
    lines.forEach((l, i) => console.log(`${i.toString().padStart(2)}: |${l}|`));
    console.log('--- end ---');
  });
});
