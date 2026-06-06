import { z } from 'zod';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveWithinCwd } from '../safety/sandbox.js';
import { ToolError } from '../safety/errors.js';
import type { ToolDef, ToolCtx } from '../agent/types.js';

const MAX_BYTES = 1024 * 1024; // 1MB

const schema = z.object({
  path: z.string().describe('绝对路径或相对 cwd 的路径'),
  offset: z.number().int().nonnegative().optional().describe('起始字节偏移'),
  limit: z.number().int().positive().optional().describe('最大字节数'),
});

async function execute(input: z.infer<typeof schema>, ctx: ToolCtx) {
  const abs = resolveWithinCwd(input.path, ctx.cwd);
  let content: string;
  try {
    content = await fs.readFile(abs, 'utf-8');
  } catch (e) {
    throw new ToolError('read_file', `Cannot read ${input.path}: ${(e as Error).message}`);
  }
  let truncated = false;
  if (content.length > MAX_BYTES) {
    content = content.slice(0, MAX_BYTES);
    truncated = true;
  }
  return { content, truncated, size: content.length, absPath: abs };
}

export const readFileTool: ToolDef<z.infer<typeof schema>> = {
  name: 'read_file',
  description:
    '读取文件内容。>1MB 会被截断。如需分块读取,可传 offset 和 limit(字节)。',
  safety: 'safe',
  concurrencySafe: true,
  schema,
  execute,
};
