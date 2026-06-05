import { describe, it, expect } from 'vitest';
import React from 'react';
import { Text } from 'ink';
import { render } from 'ink-testing-library';
import { HeadStatus } from '../components/HeadStatus.js';
import { ActiveToolLine } from '../components/ActiveToolLine.js';

describe('HeadStatus', () => {
  it('idle 阶段不渲染任何内容', () => {
    const { lastFrame } = render(<HeadStatus phase="idle" phaseStartMs={Date.now()} />);
    expect(lastFrame()).toBe('');
  });

  it('thinking 阶段显示 "Thinking for Ns"', () => {
    const { lastFrame } = render(
      <HeadStatus phase="thinking" phaseStartMs={Date.now() - 5000} />,
    );
    expect(lastFrame()).toMatch(/Thinking for 5s/);
  });

  it('thinking 阶段带 token 统计', () => {
    const { lastFrame } = render(
      <HeadStatus
        phase="thinking"
        phaseStartMs={Date.now()}
        tokens={{ promptTokens: 100, completionTokens: 42 }}
      />,
    );
    expect(lastFrame()).toMatch(/↓ 42 tokens/);
  });

  it('executing 阶段映射工具名到动词', () => {
    const { lastFrame } = render(
      <HeadStatus phase="executing" phaseStartMs={Date.now() - 3000} toolName="read_file" />,
    );
    expect(lastFrame()).toMatch(/Reading/);
    expect(lastFrame()).toMatch(/3s/);
  });

  it('executing 未知工具名 fall back 到 "Running X"', () => {
    const { lastFrame } = render(
      <HeadStatus phase="executing" phaseStartMs={Date.now()} toolName="my_custom_tool" />,
    );
    expect(lastFrame()).toMatch(/Running my_custom_tool/);
  });

  it('executing 阶段无 toolName 显示 Working', () => {
    const { lastFrame } = render(
      <HeadStatus phase="executing" phaseStartMs={Date.now()} />,
    );
    expect(lastFrame()).toMatch(/Working/);
  });
});

describe('ActiveToolLine', () => {
  it('running 状态显示 ⏺ + 工具名 + args', () => {
    const { lastFrame } = render(
      <ActiveToolLine name="read_file" args={'{"path":"foo.ts"}'} state="running" />,
    );
    expect(lastFrame()).toMatch(/⏺/);
    expect(lastFrame()).toMatch(/read_file/);
    expect(lastFrame()).toMatch(/foo\.ts/);
  });

  it('pending 状态显示 y/n 提示', () => {
    const { lastFrame } = render(
      <ActiveToolLine name="write_file" args={'{"path":"x"}'} state="pending" />,
    );
    expect(lastFrame()).toMatch(/\[y\] 同意/);
    expect(lastFrame()).toMatch(/\[n\] 拒绝/);
  });

  it('error 状态显示 ✗', () => {
    const { lastFrame } = render(
      <ActiveToolLine name="read_file" args="oops" state="error" />,
    );
    expect(lastFrame()).toMatch(/✗/);
  });

  it('children 渲染为子项(⎿ 风格)', () => {
    const { lastFrame } = render(
      <ActiveToolLine name="read_file" args='{"path":"foo.md"}' state="running">
        <Text dimColor>  ⎿  foo.md</Text>
      </ActiveToolLine>,
    );
    expect(lastFrame()).toMatch(/⎿/);
    expect(lastFrame()).toMatch(/foo\.md/);
  });
});
