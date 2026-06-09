import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { ApiKeyInput } from '../components/ApiKeyInput.js';

const flush = () => new Promise<void>((r) => setTimeout(r, 50));

describe('ApiKeyInput(P0.7.4)', () => {
  it('显示 provider 名 + 提示行,初始带一行 "key:"', async () => {
    const { lastFrame } = render(
      <ApiKeyInput providerLabel="DeepSeek" onSubmit={() => {}} onCancel={() => {}} />,
    );
    await flush();
    const out = lastFrame()!;
    expect(out).toMatch(/DeepSeek/);
    expect(out).toMatch(/API key/i);
    expect(out).toMatch(/Esc 取消/);
  });

  it('初始没有 mask(还没输入)', async () => {
    const { lastFrame } = render(
      <ApiKeyInput providerLabel="DeepSeek" onSubmit={() => {}} onCancel={() => {}} />,
    );
    await flush();
    const out = lastFrame()!;
    expect(out).not.toMatch(/\*/);
  });

  it('空 key + 回车不触发 onSubmit', async () => {
    let submitted = false;
    const { stdin } = render(
      <ApiKeyInput providerLabel="DeepSeek" onSubmit={() => { submitted = true; }} onCancel={() => {}} />,
    );
    await flush();
    stdin.write('\r');
    await flush();
    expect(submitted).toBe(false);
  });

  it('输入字符不暴露明文(只显示 mask)', async () => {
    const { stdin, lastFrame } = render(
      <ApiKeyInput providerLabel="DeepSeek" onSubmit={() => {}} onCancel={() => {}} />,
    );
    await flush();
    stdin.write('sk-secret-key-1234');
    await flush();
    const out = lastFrame()!;
    // 不应出现明文片段
    expect(out).not.toMatch(/sk-secret-key-1234/);
    // 应出现若干个 * 掩码(16 字符 → 16 个 *)
    expect(out).toMatch(/\*{10,}/);
  });

  it('输入后回车 → 触发 onSubmit(key)', async () => {
    let captured = '';
    const { stdin } = render(
      <ApiKeyInput
        providerLabel="DeepSeek"
        onSubmit={(k) => { captured = k; }}
        onCancel={() => {}}
      />,
    );
    await flush();
    stdin.write('sk-abc');
    await flush();
    stdin.write('\r');
    await flush();
    expect(captured).toBe('sk-abc');
  });

  it('Esc → 触发 onCancel', async () => {
    let canceled = false;
    const { stdin } = render(
      <ApiKeyInput
        providerLabel="DeepSeek"
        onSubmit={() => {}}
        onCancel={() => { canceled = true; }}
      />,
    );
    await flush();
    stdin.write('partial');
    await flush();
    stdin.write('\x1b'); // ESC
    await flush();
    expect(canceled).toBe(true);
  });

  it('Ctrl+C 也视为取消(与 Esc 等价)', async () => {
    let canceled = false;
    const { stdin } = render(
      <ApiKeyInput
        providerLabel="DeepSeek"
        onSubmit={() => {}}
        onCancel={() => { canceled = true; }}
      />,
    );
    await flush();
    stdin.write('\x03'); // Ctrl+C
    await flush();
    expect(canceled).toBe(true);
  });
});
