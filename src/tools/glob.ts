import { z } from 'zod';
import fg from 'fast-glob';
import path from 'node:path';
import type { ToolDef, ToolCtx } from '../agent/types.js';

const schema = z.object({
  pattern: z.string().describe(
    'glob 模式,相对 cwd,如 "src/**/*.ts"。不要传绝对路径。',
  ),
});

async function execute(input: z.infer<typeof schema>, ctx: ToolCtx) {
  if (path.isAbsolute(input.pattern)) {
    throw new Error(
      `glob: pattern must be relative to cwd, got absolute path "${input.pattern}"`,
    );
  }
  const files = await fg(input.pattern, {
    cwd: ctx.cwd,
    dot: false,
    onlyFiles: true,
    absolute: false,
  });
  return { files };
}

export const globTool: ToolDef<z.infer<typeof schema>> = {
  name: 'glob',
  description: '在 cwd 内匹配文件路径,如 "src/**/*.ts"。',
  safety: 'safe',
  concurrencySafe: true,
  schema,
  execute,
};
