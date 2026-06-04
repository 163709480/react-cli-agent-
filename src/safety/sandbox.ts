import path from 'node:path';
import fs from 'node:fs';
import { SandboxError } from './errors.js';

/**
 * 把用户提供的路径解析成绝对路径,并断言它在 cwd 内。
 * 解析真实路径(跟随符号链接)后再做边界检查。
 */
export function resolveWithinCwd(p: string, cwd: string): string {
  if (!p || p.trim() === '') {
    throw new SandboxError('path is empty');
  }
  const abs = path.isAbsolute(p) ? p : path.resolve(cwd, p);
  let real: string;
  try {
    real = fs.realpathSync(abs);
  } catch {
    // 路径不存在 —— 用未跟随链接的解析,允许新建文件
    real = path.resolve(abs);
  }
  // 用物理路径(realpath 后的 cwd)与用户提供的 cwd 同时做边界检查,
  // 兼容 macOS 上 /tmp -> /private/tmp 这类符号链接场景。
  let realCwd = cwd;
  try {
    realCwd = fs.realpathSync(cwd);
  } catch {
    // ignore
  }
  const escapesViaUserCwd = isOutside(cwd, real);
  const escapesViaRealCwd = isOutside(realCwd, real);
  if (escapesViaUserCwd && escapesViaRealCwd) {
    throw new SandboxError(`Path escapes cwd: ${p}`);
  }
  // 输入是 cwd 本身(以 . 形式),直接返回用户提供的 cwd 字符串
  if (p === '.') {
    return cwd;
  }
  return real;
}

function isOutside(cwd: string, target: string): boolean {
  const rel = path.relative(cwd, target);
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
    return false;
  }
  return true;
}

export function assertWritableExt(absPath: string, allowedExts: string[]): void {
  const ext = path.extname(absPath).toLowerCase();
  if (!allowedExts.includes(ext)) {
    throw new SandboxError(`Extension not in write-allowlist: "${ext || '(none)'}"`);
  }
}
