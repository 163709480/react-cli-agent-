import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileTool } from '../../tools/read_file.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('read_file', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-rf-'));
  });

  afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it('读取已有文件', async () => {
    await fs.writeFile(path.join(cwd, 'a.txt'), 'hello');
    const r = await readFileTool.execute({ path: 'a.txt' }, { cwd, abort: new AbortController().signal, confirmedByUser: true });
    expect(r.content).toBe('hello');
  });

  it('不存在的文件抛 ToolError', async () => {
    await expect(
      readFileTool.execute({ path: 'missing.txt' }, { cwd, abort: new AbortController().signal, confirmedByUser: true }),
    ).rejects.toThrow(/Cannot read/);
  });

  it('越界路径抛 SandboxError', async () => {
    await expect(
      readFileTool.execute({ path: '../escape.txt' }, { cwd, abort: new AbortController().signal, confirmedByUser: true }),
    ).rejects.toThrow(/escapes cwd/);
  });

  it('safety 等级是 safe', () => {
    expect(readFileTool.safety).toBe('safe');
  });
});
