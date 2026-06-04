import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { editFileTool } from '../../tools/edit_file.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('edit_file', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-ef-'));
  });

  afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it('唯一匹配时替换', async () => {
    await fs.writeFile(path.join(cwd, 'a.ts'), 'const x = 1;\nconst y = 2;');
    await editFileTool.execute(
      { path: 'a.ts', old_string: 'const x = 1;', new_string: 'const x = 99;' },
      { cwd, abort: new AbortController().signal, confirmedByUser: true },
    );
    const got = await fs.readFile(path.join(cwd, 'a.ts'), 'utf-8');
    expect(got).toBe('const x = 99;\nconst y = 2;');
  });

  it('无匹配抛错', async () => {
    await fs.writeFile(path.join(cwd, 'a.ts'), 'foo');
    await expect(
      editFileTool.execute(
        { path: 'a.ts', old_string: 'bar', new_string: 'baz' },
        { cwd, abort: new AbortController().signal, confirmedByUser: true },
      ),
    ).rejects.toThrow(/not found/);
  });

  it('多处匹配抛错', async () => {
    await fs.writeFile(path.join(cwd, 'a.ts'), 'foo foo');
    await expect(
      editFileTool.execute(
        { path: 'a.ts', old_string: 'foo', new_string: 'bar' },
        { cwd, abort: new AbortController().signal, confirmedByUser: true },
      ),
    ).rejects.toThrow(/2 times/);
  });
});
