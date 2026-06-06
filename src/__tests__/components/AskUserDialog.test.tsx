import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { AskUserDialog } from '../../components/AskUserDialog.js';

// Wait for the Ink component to mount and useInput's useEffect to register
// the 'readable' listener on stdin. Without this, stdin.write is emitted
// before setRawMode(true) runs, and the input is dropped on the floor.
const flush = () => new Promise<void>((r) => setTimeout(r, 50));

describe('AskUserDialog', () => {
  it('渲染 question + 所有 options', () => {
    const { lastFrame } = render(
      <AskUserDialog
        question="你选哪个?"
        options={['A', 'B', 'C']}
        multiSelect={false}
        onResolve={() => {}}
      />,
    );
    const out = lastFrame()!;
    expect(out).toContain('你选哪个?');
    expect(out).toContain('A');
    expect(out).toContain('B');
    expect(out).toContain('C');
  });

  it('单选:回车 resolve 第一个 option', async () => {
    const onResolve = vi.fn();
    const { stdin } = render(
      <AskUserDialog
        question="?"
        options={['X', 'Y']}
        multiSelect={false}
        onResolve={onResolve}
      />,
    );
    await flush();
    stdin.write('\r');  // Enter
    expect(onResolve).toHaveBeenCalledWith('X');
  });

  it('单选:下箭头 + 回车 resolve 第二个', async () => {
    const onResolve = vi.fn();
    const { stdin } = render(
      <AskUserDialog
        question="?"
        options={['X', 'Y']}
        multiSelect={false}
        onResolve={onResolve}
      />,
    );
    await flush();
    stdin.write('[B');  // down arrow
    await flush();
    stdin.write('\r');
    expect(onResolve).toHaveBeenCalledWith('Y');
  });

  it('Esc 触发 cancel sentinel', async () => {
    const onResolve = vi.fn();
    const { stdin } = render(
      <AskUserDialog
        question="?"
        options={['X', 'Y']}
        multiSelect={false}
        onResolve={onResolve}
      />,
    );
    await flush();
    stdin.write('');  // Esc
    expect(onResolve).toHaveBeenCalledWith('__canceled__');
  });
});
