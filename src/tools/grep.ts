import { z } from 'zod';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { resolveWithinCwd } from '../safety/sandbox.js';
import { ToolError } from '../safety/errors.js';
import type { ToolDef, ToolCtx } from '../agent/types.js';

const exec = promisify(execFile);

const schema = z.object({
  pattern: z.string().describe('正则表达式'),
  glob: z.string().optional().describe('文件 glob,默认 *'),
  max_results: z.number().int().positive().default(100),
});

async function execute(input: z.infer<typeof schema>, ctx: ToolCtx) {
  // 先用 glob 把范围收敛到 cwd 内
  const fg = await import('fast-glob');
  const files = await fg.default(input.glob ?? '*', {
    cwd: ctx.cwd,
    dot: false,
    onlyFiles: true,
    absolute: true,
  });
  if (files.length === 0) return { matches: [] };
  const matches: Array<{ file: string; line: number; text: string }> = [];
  for (const file of files) {
    let rel: string;
    try {
      rel = path.relative(ctx.cwd, file);
    } catch {
      continue;
    }
    if (rel.startsWith('..')) continue;
    try {
      const { stdout } = await exec('rg', [
        '-n', '--no-heading', '--color=never',
        input.pattern, file,
      ], { cwd: ctx.cwd, signal: ctx.abort });
      for (const line of stdout.split('\n').filter(Boolean)) {
        const m = line.match(/^(.+?):(\d+):(.*)$/);
        if (m) {
          matches.push({ file: m[1], line: parseInt(m[2], 10), text: m[3] });
          if (matches.length >= input.max_results) break;
        }
      }
    } catch (e) {
      const err = e as { code?: string; stderr?: string };
      if (err.code === 'ENOENT') {
        // rg 不在,fallback 到 grep
        try {
          const { stdout } = await exec('grep', ['-rn', '--color=never', input.pattern, file], {
            cwd: ctx.cwd, signal: ctx.abort,
          });
          for (const line of stdout.split('\n').filter(Boolean)) {
            const m = line.match(/^(.+?):(\d+):(.*)$/);
            if (m) {
              matches.push({ file: m[1], line: parseInt(m[2], 10), text: m[3] });
              if (matches.length >= input.max_results) break;
            }
          }
        } catch (ge) {
          if ((ge as { code?: number }).code !== 1) {
            throw new ToolError('grep', `grep failed: ${(ge as Error).message}`);
          }
          // exit 1 = 无匹配
        }
      } else if (err.code !== undefined && (e as { code?: number }).code !== 1) {
        throw new ToolError('grep', `rg failed: ${err.stderr ?? (e as Error).message}`);
      }
    }
    if (matches.length >= input.max_results) break;
  }
  return { matches };
}

export const grepTool: ToolDef<z.infer<typeof schema>> = {
  name: 'grep',
  description:
    '在 cwd 内用 ripgrep(优先)/grep 搜索正则。返回 {file, line, text} 列表。',
  safety: 'safe',
  schema,
  execute,
};
