import { describe, it, expect } from 'vitest';
import { canonicalJson } from '../audit/canonical.js';

describe('canonicalJson', () => {
  it('同输入两遍输出 bit-identical(顺序无关)', () => {
    const a = { b: 1, a: 2, c: 3 };
    const b = { c: 3, a: 2, b: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(canonicalJson(a)).toBe('{"a":2,"b":1,"c":3}');
  });

  it('嵌套对象 / 数组正确处理', () => {
    const obj = { z: [{ y: 1, x: 2 }], a: { nested: { deep: 'v' } } };
    const expected = '{"a":{"nested":{"deep":"v"}},"z":[{"x":2,"y":1}]}';
    expect(canonicalJson(obj)).toBe(expected);
  });

  it('支持 Unicode / 空对象 / 数字 / null / boolean', () => {
    expect(canonicalJson({})).toBe('{}');
    expect(canonicalJson([])).toBe('[]');
    expect(canonicalJson('hi 你好')).toBe('"hi 你好"');
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson(true)).toBe('true');
    expect(canonicalJson({ a: 1.5, b: 0, c: -3 })).toBe('{"a":1.5,"b":0,"c":-3}');
  });

  it('遇到 undefined / function / symbol / bigint 抛错(防静默丢字段)', () => {
    expect(() => canonicalJson(undefined)).toThrow();
    expect(() => canonicalJson({ a: undefined as unknown as number })).toThrow(/undefined/);
    expect(() => canonicalJson({ a: () => 1 })).toThrow();
    expect(() => canonicalJson({ a: Symbol('x') as unknown as number })).toThrow();
    expect(() => canonicalJson({ a: 1n as unknown as number })).toThrow();
  });
});
