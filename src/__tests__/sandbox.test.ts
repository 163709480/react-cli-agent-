import { describe, it, expect } from 'vitest';
import { resolveWithinCwd, assertWritableExt } from '../safety/sandbox.js';
import { SandboxError } from '../safety/errors.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

describe('resolveWithinCwd', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-sb-'));

  it('相对路径解析到 cwd', () => {
    // 期望返回 realpath 后的物理路径 — 在 macOS 上 /tmp -> /private/tmp
    // 只要物理路径在 cwd 内就认为合法
    const realCwd = fs.realpathSync(cwd);
    const result = resolveWithinCwd('foo.txt', cwd);
    expect(result.startsWith(realCwd + path.sep) || result === realCwd).toBe(true);
  });

  it('绝对路径在 cwd 内允许', () => {
    const abs = path.join(cwd, 'sub', 'a.ts');
    const realCwd = fs.realpathSync(cwd);
    const result = resolveWithinCwd(abs, cwd);
    expect(result.startsWith(realCwd + path.sep) || result === realCwd).toBe(true);
  });

  it('.. 跳出 cwd 抛 SandboxError', () => {
    expect(() => resolveWithinCwd('../escape.txt', cwd)).toThrow(SandboxError);
  });

  it('绝对路径在 cwd 外抛 SandboxError', () => {
    expect(() => resolveWithinCwd('/etc/passwd', cwd)).toThrow(SandboxError);
  });

  it('cwd 本身允许', () => {
    expect(resolveWithinCwd('.', cwd)).toBe(cwd);
  });

  it('符号链接跳出 cwd 抛 SandboxError', () => {
    const target = path.join(cwd, '..', 'outside.txt');
    fs.writeFileSync(target, 'x');
    const link = path.join(cwd, 'link.txt');
    try {
      fs.symlinkSync(target, link);
      expect(() => resolveWithinCwd(link, cwd)).toThrow(SandboxError);
    } finally {
      fs.unlinkSync(target);
    }
  });

  it('空字符串抛 SandboxError', () => {
    expect(() => resolveWithinCwd('', cwd)).toThrow(SandboxError);
  });

  it('cwd 内符号链接目录指向 cwd 外时,新文件路径被拒绝', () => {
    // 准备外部目录
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-sb-out-'));
    try {
      // 在 cwd 内建一个指向 outsideDir 的符号链接
      const linkDir = path.join(cwd, 'link');
      fs.symlinkSync(outsideDir, linkDir, 'dir');
      // 尝试在 linkDir/new.md 写入 — new.md 不存在
      // realpath 应跟随 link 解析到 outsideDir,超出 cwd,必须被拒绝
      expect(() => resolveWithinCwd(path.join('link', 'new.md'), cwd)).toThrow(SandboxError);
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it('cwd 内子目录的新文件允许', () => {
    // 子目录不存在,需要 mkdir 后再写新文件;
    // 也覆盖"中间祖先不存在,只有最终文件不存在"的解析路径
    const nested = path.join(cwd, 'nested', 'deeper');
    const target = path.join(nested, 'fresh.md');
    const realCwd = fs.realpathSync(cwd);
    const result = resolveWithinCwd(target, cwd);
    // 解析出的物理路径必须在 cwd 内
    expect(result.startsWith(realCwd + path.sep) || result === realCwd).toBe(true);
  });

  it('跨越多级 symlink 链跳出 cwd 抛 SandboxError', () => {
    // 构造: cwd/a -> cwd/b -> /outside
    // 用户写 a/deep/new.md 时,b/deep/ 是真实子路径,realpath 应解析到 /outside
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-sb-out2-'));
    try {
      const b = path.join(cwd, 'b');
      fs.symlinkSync(outsideDir, b, 'dir');
      const a = path.join(cwd, 'a');
      fs.symlinkSync(b, a, 'dir');
      expect(() => resolveWithinCwd(path.join('a', 'deep', 'new.md'), cwd)).toThrow(SandboxError);
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});

describe('assertWritableExt', () => {
  const allowed = ['.md', '.ts', '.txt'];

  it('白名单内后缀通过', () => {
    expect(() => assertWritableExt('/a/b/c.ts', allowed)).not.toThrow();
  });

  it('大小写不敏感', () => {
    expect(() => assertWritableExt('/a/b/C.TS', allowed)).not.toThrow();
  });

  it('白名单外后缀抛错', () => {
    expect(() => assertWritableExt('/a/b/c.exe', allowed)).toThrow(SandboxError);
  });

  it('无后缀抛错', () => {
    expect(() => assertWritableExt('/a/b/Makefile', allowed)).toThrow(SandboxError);
  });
});
