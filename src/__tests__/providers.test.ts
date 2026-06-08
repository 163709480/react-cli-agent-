import { describe, it, expect } from 'vitest';
import { listProviderNames, resolveProvider, listProviders } from '../llm/providers.js';

describe('listProviderNames', () => {
  it('包含 ollama / deepseek / minimax (P0.7)', () => {
    const names = listProviderNames();
    expect(names).toContain('ollama');
    expect(names).toContain('deepseek');
    expect(names).toContain('minimax');
  });
});

describe('resolveProvider', () => {
  it('deepseek 返回正确的 baseUrl + defaultModel', () => {
    const p = resolveProvider('deepseek');
    expect(p.baseUrl).toBe('https://api.deepseek.com/v1');
    expect(p.defaultModel).toBe('deepseek-chat');
    expect(p.requiresApiKey).toBe(true);
  });

  it('ollama 标记为本地,允许占位 key', () => {
    const p = resolveProvider('ollama');
    expect(p.kind).toBe('local');
    expect(p.requiresApiKey).toBe(false);
    expect(p.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:11434/);
  });

  it('minimax 在线,需要 key', () => {
    const p = resolveProvider('minimax');
    expect(p.kind).toBe('online');
    expect(p.requiresApiKey).toBe(true);
    // 标注了 notes 提示需要核对文档
    expect(p.notes).toBeTruthy();
  });

  it('未知 provider 抛错,错误信息含可用名单', () => {
    expect(() => resolveProvider('unknown-xyz')).toThrow(/Available/);
  });
});

describe('listProviders', () => {
  it('返回完整 preset 列表', () => {
    const all = listProviders();
    expect(all.length).toBeGreaterThanOrEqual(3);
    for (const p of all) {
      expect(typeof p.id).toBe('string');
      expect(typeof p.label).toBe('string');
      expect(['local', 'online', 'custom']).toContain(p.kind);
      expect(typeof p.requiresApiKey).toBe('boolean');
    }
  });
});
