import { z } from 'zod';
import type { ToolDef, ToolCtx } from '../agent/types.js';

const schema = z.object({
  url: z.string().url(),
  method: z.enum(['GET', 'POST']).default('GET'),
  body: z.string().optional().describe('POST 请求体,字符串'),
  headers: z.record(z.string()).optional(),
});

async function execute(input: z.infer<typeof schema>, ctx: ToolCtx) {
  const { url, method = 'GET', body, headers = {} } = input;
  if (method !== 'GET' && !ctx.allowMutations) {
    throw new Error(
      'http_fetch: non-GET method requires --allow-mutations flag',
    );
  }
  const res = await fetch(url, {
    method,
    body: method === 'POST' ? body : undefined,
    headers,
    signal: ctx.abort,
  });
  const text = await res.text();
  const MAX = 100_000;
  return {
    status: res.status,
    statusText: res.statusText,
    body: text.length > MAX ? text.slice(0, MAX) + '\n[...truncated...]' : text,
  };
}

export const httpFetchTool: ToolDef<z.infer<typeof schema>> = {
  name: 'http_fetch',
  description:
    'HTTP 请求,默认只 GET。POST 需要 --allow-mutations flag。响应截断 100KB。',
  safety: 'dangerous',
  schema,
  execute,
};
