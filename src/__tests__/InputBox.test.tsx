import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { InputBox } from '../components/InputBox.js';

const flush = () => new Promise<void>((r) => setTimeout(r, 50));

describe('InputBox 补全提示 (P0.7.3)', () => {
  it('value 为空时,不显示补全提示行', async () => {
    const { lastFrame } = render(<InputBox onSubmit={() => {}} disabled={false} />);
    await flush();
    const out = lastFrame()!;
    expect(out).not.toMatch(/Tab: 补全/);
    expect(out).not.toMatch(/候选:/);
  });

  it('输入 / 时,显示候选列表(compact / status / help / model / config)', async () => {
    const { lastFrame } = render(
      <InputBox onSubmit={() => {}} disabled={false} initialValue="/" />,
    );
    await flush();
    const out = lastFrame()!;
    expect(out).toMatch(/候选:/);
    expect(out).toMatch(/compact/);
    expect(out).toMatch(/help/);
    expect(out).toMatch(/model/);
    expect(out).toMatch(/config/);
  });

  it('输入 /c 时,显示 3 个候选(clear / compact / config)', async () => {
    const { lastFrame } = render(
      <InputBox onSubmit={() => {}} disabled={false} initialValue="/c" />,
    );
    await flush();
    const out = lastFrame()!;
    // BUILTIN_COMMAND_LIST 声明顺序保留: compact / status / clear / reset / model / config / help
    // 过滤 /c 前缀后顺序: compact, clear, config
    expect(out).toMatch(/候选: compact, clear, config/);
  });

  it('输入 /conf 唯一匹配 config,显示"补全 → /config",无候选列表', async () => {
    const { lastFrame } = render(
      <InputBox onSubmit={() => {}} disabled={false} initialValue="/conf" />,
    );
    await flush();
    const out = lastFrame()!;
    expect(out).toMatch(/补全 → \/config/);
    expect(out).not.toMatch(/候选:/);
  });

  it('输入 /xyz 无匹配,显示"无匹配命令"', async () => {
    const { lastFrame } = render(
      <InputBox onSubmit={() => {}} disabled={false} initialValue="/xyz" />,
    );
    await flush();
    const out = lastFrame()!;
    expect(out).toMatch(/无匹配命令/);
  });

  it('输入 hello(非 / 开头),不显示补全提示', async () => {
    const { lastFrame } = render(
      <InputBox onSubmit={() => {}} disabled={false} initialValue="hello" />,
    );
    await flush();
    const out = lastFrame()!;
    expect(out).not.toMatch(/Tab: 补全/);
    expect(out).not.toMatch(/候选:/);
  });

  it('disabled 时不渲染 TextInput + 也不显示补全', async () => {
    const { lastFrame } = render(
      <InputBox onSubmit={() => {}} disabled={true} initialValue="/" />,
    );
    await flush();
    const out = lastFrame()!;
    expect(out).toMatch(/esc to interrupt/);
    expect(out).not.toMatch(/Tab: 补全/);
  });

  // 注:以下交互测试(paste / backspace / 箭头)在 ink-testing-library 没法跑
  // — 它 mock 的 Stdin emit 的是 'data' 事件,ink 的 useInput 监听的是 'input' 事件,
  // stdin.write 根本到不了 useInput handler。运行时是正常的(真实终端走 'input' 事件)。
  // 实际验证:跑 react-cli-agent,粘贴 "hello pasted world",光标在 paste 末尾。
});
