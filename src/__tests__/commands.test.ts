import { describe, it, expect } from 'vitest';
import { parseBuiltinCommand, BUILTIN_COMMAND_LIST } from '../agent/commands.js';

describe('parseBuiltinCommand', () => {
  it('空字符串返回 null', () => {
    expect(parseBuiltinCommand('')).toBeNull();
  });

  it('不以 / 开头返回 null(走 LLM)', () => {
    expect(parseBuiltinCommand('hello')).toBeNull();
    expect(parseBuiltinCommand('  hello')).toBeNull();
  });

  it('仅 / 没有名字返回 null', () => {
    expect(parseBuiltinCommand('/')).toBeNull();
    expect(parseBuiltinCommand('/  ')).toBeNull();
  });

  it('/compact 解析为 compact 命令', () => {
    expect(parseBuiltinCommand('/compact')).toEqual({ type: 'compact' });
  });

  it('/COMPACT 大小写不敏感', () => {
    expect(parseBuiltinCommand('/COMPACT')).toEqual({ type: 'compact' });
  });

  it('/compact with trailing whitespace 仍然解析', () => {
    expect(parseBuiltinCommand('/compact   ')).toEqual({ type: 'compact' });
  });

  it('/status /clear /reset /help 都正确解析', () => {
    expect(parseBuiltinCommand('/status')).toEqual({ type: 'status' });
    expect(parseBuiltinCommand('/clear')).toEqual({ type: 'clear' });
    expect(parseBuiltinCommand('/reset')).toEqual({ type: 'reset' });
    expect(parseBuiltinCommand('/help')).toEqual({ type: 'help' });
  });

  it('未知命令返回 unknown 标记,不进 LLM', () => {
    expect(parseBuiltinCommand('/foobar')).toEqual({ type: 'unknown', name: 'foobar' });
    expect(parseBuiltinCommand('/qwerty')).toEqual({ type: 'unknown', name: 'qwerty' });
  });

  it('含问号的中文不属于命令', () => {
    // "/你好 怎么做" — 名字是 "你好" 不在白名单
    expect(parseBuiltinCommand('/你好 怎么做')).toEqual({ type: 'unknown', name: '你好' });
  });

  it('BUILTIN_COMMAND_LIST 至少含 5 个内置命令', () => {
    expect(BUILTIN_COMMAND_LIST.length).toBeGreaterThanOrEqual(5);
    const names = BUILTIN_COMMAND_LIST.map((c) => c.name);
    expect(names).toContain('compact');
    expect(names).toContain('help');
  });
});
