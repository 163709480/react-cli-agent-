import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileTool } from '../../tools/write_file.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('write_file', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-wf-'));
  });

  afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it('写入新文件', async () => {
    const r = await writeFileTool.execute(
      { path: 'a.ts', content: 'export const x = 1;' },
      { cwd, abort: new AbortController().signal, confirmedByUser: true },
    );
    expect(r.written).toBeGreaterThan(0);
    const got = await fs.readFile(path.join(cwd, 'a.ts'), 'utf-8');
    expect(got).toBe('export const x = 1;');
  });

  it('不在白名单的后缀抛错', async () => {
    await expect(
      writeFileTool.execute(
        { path: 'a.exe', content: 'x' },
        { cwd, abort: new AbortController().signal, confirmedByUser: true },
      ),
    ).rejects.toThrow(/write-allowlist/);
  });

  it('自动创建父目录', async () => {
    await writeFileTool.execute(
      { path: 'sub/dir/a.md', content: 'hi' },
      { cwd, abort: new AbortController().signal, confirmedByUser: true },
    );
    const got = await fs.readFile(path.join(cwd, 'sub/dir/a.md'), 'utf-8');
    expect(got).toBe('hi');
  });

  it('safety 等级是 confirm', () => {
    expect(writeFileTool.safety).toBe('confirm');
  });
});
