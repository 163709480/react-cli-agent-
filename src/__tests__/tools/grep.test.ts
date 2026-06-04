import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { grepTool } from '../../tools/grep.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('grep', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-gr-'));
    await fs.writeFile(path.join(cwd, 'a.txt'), 'hello world\nfoo bar\nhello again');
  });

  afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it('在文本文件里匹配(无 rg 时回退 grep)', async () => {
    const r = await grepTool.execute(
      { pattern: 'hello', max_results: 10 },
      { cwd, abort: new AbortController().signal, confirmedByUser: true },
    );
    expect(r.matches.length).toBeGreaterThanOrEqual(2);
  });

  it('glob 过滤', async () => {
    const r = await grepTool.execute(
      { pattern: 'hello', glob: '*.ts', max_results: 10 },
      { cwd, abort: new AbortController().signal, confirmedByUser: true },
    );
    expect(r.matches).toEqual([]);
  });
});
