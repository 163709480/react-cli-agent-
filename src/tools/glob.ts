import { z } from 'zod';
import fg from 'fast-glob';
import path from 'node:path';
import { resolveWithinCwd } from '../safety/sandbox.js';
import type { ToolDef, ToolCtx } from '../agent/types.js';

const schema = z.object({
  pattern: z.string().describe('glob 模式,如 "src/**/*.ts"'),
});

async function execute(input: z.infer<typeof schema>, ctx: ToolCtx) {
  // 模式 base 必须能 resolve 到 cwd 内
  const base = path.dirname(input.pattern).split('*')[0] || '.';
  resolveWithinCwd(base, ctx.cwd);
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
  schema,
  execute,
};
