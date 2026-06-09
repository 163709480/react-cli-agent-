import { describe, it, expect } from 'vitest';
import { parseBuiltinCommand, BUILTIN_COMMAND_LIST, completeBuiltinCommand } from '../agent/commands.js';

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

  it('/model /config 带 args 透传', () => {
    expect(parseBuiltinCommand('/model')).toEqual({ type: 'model', args: '' });
    expect(parseBuiltinCommand('/model ollama')).toEqual({ type: 'model', args: 'ollama' });
    expect(parseBuiltinCommand('/config')).toEqual({ type: 'config', args: '' });
    expect(parseBuiltinCommand('/config --provider deepseek')).toEqual({
      type: 'config', args: '--provider deepseek',
    });
  });

  it('未知命令返回 unknown 标记,不进 LLM', () => {
    expect(parseBuiltinCommand('/foobar')).toEqual({ type: 'unknown', name: 'foobar' });
    expect(parseBuiltinCommand('/qwerty')).toEqual({ type: 'unknown', name: 'qwerty' });
  });

  it('路径形式 /Users/foo 不被误判为 slash command,走 LLM', () => {
    // 含路径分隔符或大写开头的"命令名" — 视作普通文本
    expect(parseBuiltinCommand('/Users/eryiya/foo')).toBeNull();
    expect(parseBuiltinCommand('/etc/passwd')).toBeNull();
    expect(parseBuiltinCommand('/foo/bar/baz')).toBeNull();
  });

  it('只有名字看起来像命令才解析(必须有 letter/digit 开头)', () => {
    // 首字符是 / 后面跟非字母数字 → 走 LLM
    expect(parseBuiltinCommand('//config')).toBeNull();
    expect(parseBuiltinCommand('/-foo')).toBeNull();
    // 中文路径(不是 ASCII 字母)走 LLM
    expect(parseBuiltinCommand('/你好')).toBeNull();
  });

  it('中文路径不属于命令,走 LLM', () => {
    // "/你好 怎么做" — 名字非 ASCII 字母数字,直接走 LLM
    expect(parseBuiltinCommand('/你好 怎么做')).toBeNull();
  });

  it('BUILTIN_COMMAND_LIST 含 /model /config', () => {
    const names = BUILTIN_COMMAND_LIST.map((c) => c.name);
    expect(names).toContain('model');
    expect(names).toContain('config');
  });
});

describe('completeBuiltinCommand', () => {
  it('空输入或非 / 输入不补全', () => {
    expect(completeBuiltinCommand('').candidates).toEqual([]);
    expect(completeBuiltinCommand('hello').candidates).toEqual([]);
  });

  it('/ 后没有字母返回全部命令', () => {
    const r = completeBuiltinCommand('/');
    expect(r.candidates).toContain('compact');
    expect(r.candidates).toContain('help');
    expect(r.candidates).toContain('model');
    expect(r.completion).toBe('');
  });

  it('/c 匹配 compact /clear /config', () => {
    const r = completeBuiltinCommand('/c');
    expect(r.candidates.sort()).toEqual(['clear', 'compact', 'config']);
    // 公共前缀: clear / compact / config 都以 "c" 开头,再下一位不共享,所以无补全后缀
    expect(r.completion).toBe('');
  });

  it('/co 匹配 compact / config', () => {
    const r = completeBuiltinCommand('/co');
    expect(r.candidates.sort()).toEqual(['compact', 'config']);
    // compact=config=co, 共享 "co",再下一位 m vs n 不一致,completion 为空
    expect(r.completion).toBe('');
  });

  it('/conf 唯一匹配 config', () => {
    const r = completeBuiltinCommand('/conf');
    expect(r.candidates).toEqual(['config']);
    expect(r.completion).toBe('ig');
  });

  it('/xyz 无匹配', () => {
    const r = completeBuiltinCommand('/xyz');
    expect(r.candidates).toEqual([]);
    expect(r.completion).toBe('');
  });

  it('大小写不敏感,输入 /C 等同 /c', () => {
    const r = completeBuiltinCommand('/C');
    expect(r.candidates.sort()).toEqual(['clear', 'compact', 'config']);
  });

  it('路径形式不触发补全(走 LLM)', () => {
    const r = completeBuiltinCommand('/Users/eryiya/foo');
    expect(r.candidates).toEqual([]);
    expect(r.completion).toBe('');
  });
});
