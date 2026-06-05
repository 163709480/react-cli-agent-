import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { DangerousConfirmBox } from '../components/DangerousConfirmBox.js';

describe('DangerousConfirmBox', () => {
  it('dangerous 严重度:渲染 ⚠ DANGEROUS ACTION + 工具名', () => {
    const { lastFrame } = render(
      <DangerousConfirmBox
        name="delete_file"
        args='{"path":"x.md"}'
        severity="dangerous"
      />,
    );
    const out = lastFrame();
    expect(out).toContain('DANGEROUS ACTION');
    expect(out).toContain('delete_file');
    expect(out).toContain('Press Y to confirm, N to cancel');
  });

  it('confirm 严重度:显示 Confirm — 标题(无 DANGEROUS)', () => {
    const { lastFrame } = render(
      <DangerousConfirmBox
        name="write_file"
        args='{"path":"a.md","content":"hi"}'
        severity="confirm"
      />,
    );
    const out = lastFrame();
    expect(out).toContain('Confirm');
    expect(out).toContain('write_file');
    expect(out).not.toContain('DANGEROUS ACTION');
  });

  it('preview 内容逐行展示', () => {
    const { lastFrame } = render(
      <DangerousConfirmBox
        name="delete_file"
        args='{"path":"x.md"}'
        severity="dangerous"
        preview="line1\nline2\nline3"
      />,
    );
    const out = lastFrame();
    expect(out).toContain('line1');
    expect(out).toContain('line2');
    expect(out).toContain('line3');
    expect(out).toContain('preview');
  });

  it('parsed 字段逐个键展示', () => {
    const { lastFrame } = render(
      <DangerousConfirmBox
        name="write_file"
        args='{"path":"a.md"}'
        severity="confirm"
        parsed={{ path: 'a.md', content: 'hello' }}
      />,
    );
    const out = lastFrame();
    expect(out).toContain('path:');
    expect(out).toContain('a.md');
    expect(out).toContain('content:');
    expect(out).toContain('hello');
  });

  it('明确提示回车键无效', () => {
    const { lastFrame } = render(
      <DangerousConfirmBox name="x" args="{}" severity="dangerous" />,
    );
    expect(lastFrame()).toContain('Enter alone is ignored');
  });
});
