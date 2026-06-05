import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { deleteFileTool } from '../../tools/delete_file.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('delete_file', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-df-'));
  });

  afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it('删除存在的文件,返回 deleted=true 与 preview', async () => {
    // macOS: cwd 在 /tmp 下会被 realpath 成 /private/tmp,工具返回的 absPath
    // 是规范化的;文件读不到用同样的 realpath 后路径对比
    const fsReal = await import('node:fs');
    const realCwd = fsReal.realpathSync(cwd);
    const target = path.join(realCwd, 'a.md');
    await fs.writeFile(target, '# hello world\nthis is the content to delete.');
    const r = await deleteFileTool.execute(
      { path: 'a.md' },
      { cwd, abort: new AbortController().signal, confirmedByUser: true },
    );
    expect(r.deleted).toBe(true);
    expect(r.absPath).toBe(target);
    expect(r.bytes).toBeGreaterThan(0);
    expect(r.preview).toContain('hello world');
    // 文件确实没了
    await expect(fs.stat(target)).rejects.toThrow(/ENOENT/);
  });

  it('文件不存在时,报清晰错误', async () => {
    await expect(
      deleteFileTool.execute(
        { path: 'nope.md' },
        { cwd, abort: new AbortController().signal, confirmedByUser: true },
      ),
    ).rejects.toThrow(/does not exist/);
  });

  it('拒绝删除目录(防 rm -rf)', async () => {
    const sub = path.join(cwd, 'subdir');
    await fs.mkdir(sub);
    await expect(
      deleteFileTool.execute(
        { path: 'subdir' },
        { cwd, abort: new AbortController().signal, confirmedByUser: true },
      ),
    ).rejects.toThrow(/Refusing to delete directory/);
    // 目录还在
    const stat = await fs.stat(sub);
    expect(stat.isDirectory()).toBe(true);
  });

  it('路径越界被沙箱拦截', async () => {
    await expect(
      deleteFileTool.execute(
        { path: '../escape.md' },
        { cwd, abort: new AbortController().signal, confirmedByUser: true },
      ),
    ).rejects.toThrow(/escapes cwd/);
  });

  it('safety 等级是 dangerous(yolo 也无法跳过)', () => {
    expect(deleteFileTool.safety).toBe('dangerous');
  });

  it('大文件 preview 只读前 200 字符', async () => {
    const target = path.join(cwd, 'big.txt');
    const big = 'x'.repeat(1000);
    await fs.writeFile(target, big);
    const r = await deleteFileTool.execute(
      { path: 'big.txt' },
      { cwd, abort: new AbortController().signal, confirmedByUser: true },
    );
    expect(r.bytes).toBe(1000);
    expect(r.preview.length).toBe(200);
  });
});
