import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  applyProviderPreset,
  saveUserConfig,
  loadUserConfig,
  defaultApiKeyForProvider,
  getConfigPath,
} from '../agent/userConfig.js';

describe('userConfig', () => {
  let tmpHome: string;
  const savedHome = process.env.AGENT_HOME_DIR;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-userconfig-'));
    process.env.AGENT_HOME_DIR = tmpHome;
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    if (savedHome === undefined) delete process.env.AGENT_HOME_DIR;
    else process.env.AGENT_HOME_DIR = savedHome;
  });

  it('applyProviderPreset 写入 preset 的 baseUrl + defaultModel', () => {
    const out = applyProviderPreset({}, 'ollama');
    expect(out.providerName).toBe('ollama');
    expect(out.openaiBaseUrl).toMatch(/^http:\/\/127\.0\.0\.1:11434/);
    expect(out.openaiModel).toBe('qwen2.5-coder:7b');
  });

  it('applyProviderPreset 不覆盖 user 显式设置的值', () => {
    const out = applyProviderPreset({ openaiModel: 'custom-model' }, 'ollama');
    expect(out.openaiModel).toBe('custom-model');
  });

  it('applyProviderPreset 未知 provider 抛错', () => {
    expect(() => applyProviderPreset({}, 'unknown-xyz')).toThrow(/Available/);
  });

  it('saveUserConfig + loadUserConfig 写读一致', () => {
    const p = saveUserConfig({ providerName: 'deepseek', openaiModel: 'deepseek-coder' });
    expect(p).toBe(getConfigPath());
    const back = loadUserConfig();
    expect(back.providerName).toBe('deepseek');
    expect(back.openaiModel).toBe('deepseek-coder');
  });

  it('配置文件权限为 0600', () => {
    const p = saveUserConfig({ providerName: 'ollama' });
    if (process.platform !== 'win32') {
      const stat = fs.statSync(p);
      expect(stat.mode & 0o777).toBe(0o600);
    }
  });

  it('defaultApiKeyForProvider: ollama 给占位 key,deepseek 给空', () => {
    expect(defaultApiKeyForProvider('ollama')).toBe('placeholder-key');
    expect(defaultApiKeyForProvider('deepseek')).toBe('');
    expect(defaultApiKeyForProvider('minimax')).toBe('');
    expect(defaultApiKeyForProvider('unknown')).toBe('');
    expect(defaultApiKeyForProvider(undefined)).toBe('');
  });
});
