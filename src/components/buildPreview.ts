import fs from 'node:fs/promises';
import path from 'node:path';

export interface PreviewResult {
  /** 多行 preview 内容(可能空) */
  preview: string;
  /** 解析后的参数(给 DangerousConfirmBox 的 parsed 字段) */
  parsed?: Record<string, unknown>;
}

/**
 * 为破坏性工具生成变更预览。
 * 用于 DangerousConfirmBox 在用户按 y 之前展示"将发生什么"。
 *
 * - write_file: 显示 content 前 200 字符(若文件已存在,显示将要覆盖的旧内容前 100 + 新内容前 100)
 * - edit_file:  显示 -old / +new diff(各前 200 字符)
 * - delete_file:显示 absPath + 字节数 + 内容前 100 字符
 * - http_fetch: 显示 URL + method + body 前 200 字符(若有)
 * - 其他:返回 args 原文
 */
export async function buildPreview(
  toolName: string,
  args: Record<string, unknown>,
  cwd: string,
): Promise<PreviewResult> {
  switch (toolName) {
    case 'write_file': return previewWriteFile(args, cwd);
    case 'edit_file': return previewEditFile(args, cwd);
    case 'delete_file': return previewDeleteFile(args, cwd);
    case 'http_fetch': return previewHttpFetch(args);
    default: return { preview: JSON.stringify(args), parsed: args };
  }
}

const SNIP = 200;

async function safeRead(abs: string, max: number): Promise<string | null> {
  try {
    const stat = await fs.stat(abs);
    if (stat.isDirectory()) return null;
    const fh = await fs.open(abs, 'r');
    try {
      const buf = Buffer.alloc(Math.min(max, stat.size));
      await fh.read(buf, 0, buf.length, 0);
      return buf.toString('utf-8');
    } finally {
      await fh.close();
    }
  } catch {
    return null;
  }
}

async function previewWriteFile(args: Record<string, unknown>, cwd: string): Promise<PreviewResult> {
  const p = typeof args.path === 'string' ? args.path : '';
  const content = typeof args.content === 'string' ? args.content : '';
  const abs = path.isAbsolute(p) ? p : path.resolve(cwd, p);
  const existing = await safeRead(abs, 100);
  const newSnip = content.length > SNIP ? content.slice(0, SNIP) + '\n[…truncated…]' : content;
  let lines: string[];
  if (existing !== null) {
    lines = [
      `- ${abs} (overwriting, ${content.length} chars new)`,
      `  current first 100 chars:`,
      ...existing.split('\n').map((l) => `    ${l}`),
      `+ new content (first ${SNIP} chars):`,
      ...newSnip.split('\n').map((l) => `    ${l}`),
    ];
  } else {
    lines = [
      `+ ${abs} (new file, ${content.length} chars)`,
      `  content:`,
      ...newSnip.split('\n').map((l) => `    ${l}`),
    ];
  }
  return { preview: lines.join('\n'), parsed: args };
}

async function previewEditFile(args: Record<string, unknown>, cwd: string): Promise<PreviewResult> {
  const p = typeof args.path === 'string' ? args.path : '';
  const oldStr = typeof args.old_string === 'string' ? args.old_string : '';
  const newStr = typeof args.new_string === 'string' ? args.new_string : '';
  const abs = path.isAbsolute(p) ? p : path.resolve(cwd, p);
  const oldSnip = oldStr.length > SNIP ? oldStr.slice(0, SNIP) + '\n[…truncated…]' : oldStr;
  const newSnip = newStr.length > SNIP ? newStr.slice(0, SNIP) + '\n[…truncated…]' : newStr;
  return {
    preview: [
      `! ${abs}`,
      `- old_string:`,
      ...oldSnip.split('\n').map((l) => `    ${l}`),
      `+ new_string:`,
      ...newSnip.split('\n').map((l) => `    ${l}`),
    ].join('\n'),
    parsed: args,
  };
}

async function previewDeleteFile(args: Record<string, unknown>, cwd: string): Promise<PreviewResult> {
  const p = typeof args.path === 'string' ? args.path : '';
  const abs = path.isAbsolute(p) ? p : path.resolve(cwd, p);
  let size = 0;
  let snip: string | null = null;
  try {
    const stat = await fs.stat(abs);
    size = stat.size;
    snip = await safeRead(abs, 100);
  } catch {
    // 不存在也展示路径,让用户知道
  }
  const lines = [
    `× ${abs} (${size} bytes)`,
    snip !== null ? `  content first 100 chars:` : '  (file not found or unreadable)',
    ...(snip ? snip.split('\n').map((l) => `    ${l}`) : []),
  ];
  return { preview: lines.join('\n'), parsed: args };
}

function previewHttpFetch(args: Record<string, unknown>): PreviewResult {
  const url = String(args.url ?? '');
  const method = String(args.method ?? 'GET');
  const body = typeof args.body === 'string' ? args.body : '';
  const lines = [
    `→ ${method} ${url}`,
    body ? `  body (first ${SNIP} chars):` : '  (no body)',
    ...(body ? (body.length > SNIP ? body.slice(0, SNIP) + '\n[…truncated…]' : body).split('\n').map((l) => `    ${l}`) : []),
  ];
  return { preview: lines.join('\n'), parsed: args };
}
