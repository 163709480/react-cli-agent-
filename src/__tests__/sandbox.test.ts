import { describe, it, expect } from 'vitest';
import { resolveWithinCwd, assertWritableExt } from '../safety/sandbox.js';
import { SandboxError } from '../safety/errors.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

describe('resolveWithinCwd', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-sb-'));

  it('相对路径解析到 cwd', () => {
    expect(resolveWithinCwd('foo.txt', cwd)).toBe(path.join(cwd, 'foo.txt'));
  });

  it('绝对路径在 cwd 内允许', () => {
    const abs = path.join(cwd, 'sub', 'a.ts');
    expect(resolveWithinCwd(abs, cwd)).toBe(abs);
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
