import path from 'node:path';
import fs from 'node:fs';
import { SandboxError } from './errors.js';

/**
 * 把用户提供的路径解析成绝对路径,并断言它在 cwd 内。
 * 解析真实路径(跟随符号链接)后再做边界检查。
 *
 * 安全策略:
 * - 路径存在:对最终路径 realpath,跟随所有符号链接后做边界检查。
 * - 路径不存在(将新建):逐级向上 realpath 最近存在的祖先,确保
 *   中途没有符号链接把目标带出 cwd,然后再拼回尾部。
 *   这是为了堵住 "cwd/link -> /outside,写 link/new.md 绕过沙箱"
 *   这类攻击。
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
    // 路径不存在 —— 必须先把祖先全部 realpath,再判断物理祖先是否在 cwd 内
    real = resolveClosestExisting(abs);
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

/**
 * 对不存在的目标路径,从其自身开始向上找最近存在的祖先,
 * 对该祖先 realpath,再把不存在的尾部拼回去。
 *
 * 这样能确保:如果中间存在符号链接把路径带出 cwd,就会被 realpath
 * 暴露并被外层 isOutside 检查拒绝。
 *
 * 例: abs = cwd/link/new.md, link 是指向 /outside 的符号链接
 *   - /outside 存在 → realpath('/outside') = '/outside'
 *   - 拼回 'new.md' → '/outside/new.md'
 *   - isOutside(cwd, '/outside/new.md') === true → 拒绝
 *
 * 如果一路向上都没有 symlink 干扰,real 仍然以 cwd 为前缀,继续放行。
 */
function resolveClosestExisting(abs: string): string {
  let current = path.resolve(abs);
  let tail = '';
  // 限制向上回溯深度,防止意外死循环或逃逸
  const maxHops = 64;
  for (let i = 0; i < maxHops; i++) {
    try {
      const real = fs.realpathSync(current);
      if (tail === '') {
        return real;
      }
      return path.join(real, tail);
    } catch {
      const parent = path.dirname(current);
      const base = path.basename(current);
      tail = tail === '' ? base : path.join(base, tail);
      if (parent === current) {
        // 已经到根还没找到,直接返回原 abs
        return path.resolve(abs);
      }
      current = parent;
    }
  }
  return path.resolve(abs);
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
