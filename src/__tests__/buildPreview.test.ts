import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildPreview } from '../components/buildPreview.js';

describe('buildPreview', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-prev-'));
  });
  afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it('write_file 新建文件:显示 + 路径与内容前 200 字符', async () => {
    const r = await buildPreview('write_file', { path: 'a.md', content: 'hello\nworld' }, cwd);
    expect(r.preview).toContain('+ ');
    expect(r.preview).toContain('a.md');
    expect(r.preview).toContain('hello');
    expect(r.preview).toContain('world');
  });

  it('write_file 覆盖已存在:显示 current 与 new 两段', async () => {
    await fs.writeFile(path.join(cwd, 'a.md'), 'OLD CONTENT');
    const r = await buildPreview('write_file', { path: 'a.md', content: 'NEW CONTENT' }, cwd);
    expect(r.preview).toContain('overwriting');
    expect(r.preview).toContain('OLD CONTENT');
    expect(r.preview).toContain('NEW CONTENT');
  });

  it('write_file 超长内容被截断 + 标注 truncated', async () => {
    const big = 'x'.repeat(500);
    const r = await buildPreview('write_file', { path: 'a.md', content: big }, cwd);
    expect(r.preview).toContain('truncated');
    // preview 行数不应该爆
    expect(r.preview.split('\n').length).toBeLessThan(50);
  });

  it('edit_file:显示 -/+/! 标记', async () => {
    const r = await buildPreview(
      'edit_file',
      { path: 'a.md', old_string: 'foo', new_string: 'bar' },
      cwd,
    );
    expect(r.preview).toContain('! ');
    expect(r.preview).toContain('- old_string:');
    expect(r.preview).toContain('+ new_string:');
    expect(r.preview).toContain('foo');
    expect(r.preview).toContain('bar');
  });

  it('delete_file 存在:显示 × 路径 + 字节数 + 内容预览', async () => {
    await fs.writeFile(path.join(cwd, 'x.md'), 'data to delete');
    const r = await buildPreview('delete_file', { path: 'x.md' }, cwd);
    expect(r.preview).toContain('× ');
    expect(r.preview).toContain('x.md');
    expect(r.preview).toContain('data to delete');
  });

  it('delete_file 不存在:显示 file not found', async () => {
    const r = await buildPreview('delete_file', { path: 'nope.md' }, cwd);
    expect(r.preview).toContain('× ');
    expect(r.preview).toContain('not found');
  });

  it('http_fetch GET:显示 URL + method,无 body', async () => {
    const r = await buildPreview('http_fetch', { url: 'https://api.example.com', method: 'GET' }, cwd);
    expect(r.preview).toContain('GET');
    expect(r.preview).toContain('https://api.example.com');
    expect(r.preview).toContain('no body');
  });

  it('http_fetch POST:显示 body 预览', async () => {
    const r = await buildPreview(
      'http_fetch',
      { url: 'https://api.example.com/x', method: 'POST', body: '{"k":"v"}' },
      cwd,
    );
    expect(r.preview).toContain('POST');
    expect(r.preview).toContain('body');
    expect(r.preview).toContain('"k":"v"');
  });

  it('未知工具:返回 args JSON', async () => {
    const r = await buildPreview('custom_tool', { foo: 'bar' }, cwd);
    expect(r.preview).toContain('"foo"');
    expect(r.preview).toContain('"bar"');
  });
});
