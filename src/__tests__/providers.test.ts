import { describe, it, expect } from 'vitest';
import { listProviderNames, resolveProvider } from '../llm/providers.js';

describe('listProviderNames', () => {
  it('包含 deepseek', () => {
    expect(listProviderNames()).toContain('deepseek');
  });
});

describe('resolveProvider', () => {
  it('deepseek 返回正确的 baseUrl + defaultModel', () => {
    const p = resolveProvider('deepseek');
    expect(p.baseUrl).toBe('https://api.deepseek.com/v1');
    expect(p.defaultModel).toBe('deepseek-chat');
  });

  it('未知 provider 抛错,错误信息含可用名单', () => {
    expect(() => resolveProvider('ollama')).toThrow(/deepseek/);
    expect(() => resolveProvider('ollama')).toThrow(/Available/);
  });
});
