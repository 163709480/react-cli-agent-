import { z } from 'zod';
import fs from 'node:fs/promises';
import { resolveWithinCwd, assertWritableExt } from '../safety/sandbox.js';
import { ToolError } from '../safety/errors.js';
import type { ToolDef, ToolCtx } from '../agent/types.js';

const schema = z.object({
  path: z.string().describe('文件路径'),
  old_string: z.string().describe('要被替换的字符串,必须在文件里唯一匹配'),
  new_string: z.string().describe('替换后的字符串'),
});

async function execute(input: z.infer<typeof schema>, ctx: ToolCtx) {
  const abs = resolveWithinCwd(input.path, ctx.cwd);
  assertWritableExt(
    abs,
    ctx.writeableExts ?? [
      '.md', '.ts', '.tsx', '.js', '.jsx',
      '.json', '.yaml', '.yml', '.toml', '.txt',
    ],
  );
  let original: string;
  try {
    original = await fs.readFile(abs, 'utf-8');
  } catch (e) {
    throw new ToolError('edit_file', `Cannot read ${input.path}: ${(e as Error).message}`);
  }
  const occurrences = original.split(input.old_string).length - 1;
  if (occurrences === 0) {
    throw new ToolError('edit_file', `old_string not found in ${input.path}`);
  }
  if (occurrences > 1) {
    throw new ToolError(
      'edit_file',
      `old_string matches ${occurrences} times in ${input.path}, must be unique`,
    );
  }
  const updated = original.replace(input.old_string, input.new_string);
  try {
    await fs.writeFile(abs, updated, 'utf-8');
  } catch (e) {
    throw new ToolError('edit_file', `Cannot write ${input.path}: ${(e as Error).message}`);
  }
  return { ok: true, absPath: abs };
}

export const editFileTool: ToolDef<z.infer<typeof schema>> = {
  name: 'edit_file',
  description:
    '在文件中替换一段字符串。old_string 必须在文件里唯一匹配,否则报错。',
  safety: 'confirm',
  schema,
  execute,
};
