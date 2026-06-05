import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { globTool } from '../../tools/glob.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('glob', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-gb-'));
    await fs.mkdir(path.join(cwd, 'src'));
    await fs.writeFile(path.join(cwd, 'src/a.ts'), '');
    await fs.writeFile(path.join(cwd, 'src/b.ts'), '');
    await fs.writeFile(path.join(cwd, 'README.md'), '');
  });

  afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it('匹配所有 ts', async () => {
    const r = await globTool.execute(
      { pattern: 'src/*.ts' },
      { cwd, abort: new AbortController().signal, confirmedByUser: true },
    );
    expect(r.files.sort()).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('不匹配时返回空', async () => {
    const r = await globTool.execute(
      { pattern: 'src/*.py' },
      { cwd, abort: new AbortController().signal, confirmedByUser: true },
    );
    expect(r.files).toEqual([]);
  });

  it('绝对路径模式直接报错', async () => {
    await expect(
      globTool.execute(
        { pattern: path.join(cwd, 'src/*.ts') },
        { cwd, abort: new AbortController().signal, confirmedByUser: true },
      ),
    ).rejects.toThrow(/pattern must be relative to cwd/);
  });
});
