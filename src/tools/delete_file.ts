import { z } from 'zod';
import fs from 'node:fs/promises';
import { resolveWithinCwd } from '../safety/sandbox.js';
import { ToolError } from '../safety/errors.js';
import type { ToolDef, ToolCtx } from '../agent/types.js';

const schema = z.object({
  path: z.string().describe('要删除的文件路径,必须在 cwd 内;**不允许删除目录**'),
});

interface ExecuteResult {
  deleted: true;
  absPath: string;
  bytes: number;
  preview: string;
}

async function execute(input: z.infer<typeof schema>, ctx: ToolCtx): Promise<ExecuteResult> {
  const abs = resolveWithinCwd(input.path, ctx.cwd);

  // 先 stat 一次拿类型/大小,失败 = 文件不存在
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(abs);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      throw new ToolError('delete_file', `File does not exist: ${input.path}`);
    }
    throw new ToolError('delete_file', `Cannot stat ${input.path}: ${err.message}`);
  }

  if (stat.isDirectory()) {
    throw new ToolError(
      'delete_file',
      `Refusing to delete directory "${input.path}". ` +
        `Use a manual shell or remove contents first. (rm -rf 类操作刻意不开放)`,
    );
  }

  // 读前 200 字符做 preview(给 confirm UI 展示),失败不阻塞删除
  let preview = '';
  try {
    const fh = await fs.open(abs, 'r');
    try {
      const buf = Buffer.alloc(Math.min(200, stat.size));
      await fh.read(buf, 0, buf.length, 0);
      preview = buf.toString('utf-8');
    } finally {
      await fh.close();
    }
  } catch {
    /* preview 失败不阻塞 */
  }

  try {
    await fs.unlink(abs);
  } catch (e) {
    throw new ToolError('delete_file', `Cannot delete ${input.path}: ${(e as Error).message}`);
  }

  return { deleted: true, absPath: abs, bytes: stat.size, preview };
}

export const deleteFileTool: ToolDef<z.infer<typeof schema>> = {
  name: 'delete_file',
  description:
    '永久删除一个文件。路径必须在 cwd 内;**不允许删除目录**(防 rm -rf 类误操作)。' +
    'safety=dangerous,即使在 --yolo 下也需用户确认。',
  safety: 'dangerous',
  schema,
  execute,
};
