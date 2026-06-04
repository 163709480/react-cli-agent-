import { z } from 'zod';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveWithinCwd, assertWritableExt } from '../safety/sandbox.js';
import { ToolError } from '../safety/errors.js';
import type { ToolDef, ToolCtx } from '../agent/types.js';

const schema = z.object({
  path: z.string().describe('写入路径,必须在 cwd 内,且后缀在白名单'),
  content: z.string().describe('完整文件内容'),
});

async function execute(input: z.infer<typeof schema>, ctx: ToolCtx) {
  const abs = resolveWithinCwd(input.path, ctx.cwd);
  assertWritableExt(
    abs,
    ctx.writeableExts ?? [
      '.md',
      '.ts',
      '.tsx',
      '.js',
      '.jsx',
      '.json',
      '.yaml',
      '.yml',
      '.toml',
      '.txt',
    ],
  );
  try {
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, input.content, 'utf-8');
  } catch (e) {
    throw new ToolError('write_file', `Cannot write ${input.path}: ${(e as Error).message}`);
  }
  return { written: input.content.length, absPath: abs };
}

export const writeFileTool: ToolDef<z.infer<typeof schema>> = {
  name: 'write_file',
  description:
    '写入一个新文件,完全覆盖。路径必须在 cwd 内,后缀必须在白名单(.md/.ts/.js/.json/.yaml/.toml/.txt 等)。',
  safety: 'confirm',
  schema,
  execute,
};
