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
  saveApiKey,
  readApiKeyFromFile,
  getApiKeyPath,
  clearApiKey,
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

describe('API key 文件持久化(P0.7.4)', () => {
  let tmpHome: string;
  const savedHome = process.env.AGENT_HOME_DIR;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-secrets-'));
    process.env.AGENT_HOME_DIR = tmpHome;
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    if (savedHome === undefined) delete process.env.AGENT_HOME_DIR;
    else process.env.AGENT_HOME_DIR = savedHome;
  });

  it('saveApiKey 写到 ~/.agent/secrets/{provider}.key,文件 0600 权限', () => {
    const p = saveApiKey('deepseek', 'sk-test-1234567890');
    expect(p).toBe(getApiKeyPath('deepseek'));
    expect(fs.readFileSync(p, 'utf-8')).toBe('sk-test-1234567890');
    if (process.platform !== 'win32') {
      const stat = fs.statSync(p);
      expect(stat.mode & 0o777).toBe(0o600);
    }
  });

  it('readApiKeyFromFile 读回保存的 key,文件不存在时返回 null', () => {
    expect(readApiKeyFromFile('deepseek')).toBeNull();
    saveApiKey('deepseek', 'sk-abc');
    expect(readApiKeyFromFile('deepseek')).toBe('sk-abc');
  });

  it('readApiKeyFromFile 自动 trim 末尾换行', () => {
    const p = getApiKeyPath('deepseek');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, 'sk-with-newline\n', 'utf-8');
    expect(readApiKeyFromFile('deepseek')).toBe('sk-with-newline');
  });

  it('两个 provider 的 key 独立存储', () => {
    saveApiKey('deepseek', 'sk-deepseek');
    saveApiKey('minimax', 'sk-minimax');
    expect(readApiKeyFromFile('deepseek')).toBe('sk-deepseek');
    expect(readApiKeyFromFile('minimax')).toBe('sk-minimax');
  });

  it('provider 名字只接受合法字符,拒绝路径穿越', () => {
    expect(() => saveApiKey('../etc/passwd', 'x')).toThrow();
    expect(() => saveApiKey('..', 'x')).toThrow();
    expect(() => saveApiKey('/abs', 'x')).toThrow();
    expect(() => saveApiKey('', 'x')).toThrow();
  });
});

describe('clearApiKey(P0.7.5)', () => {
  let tmpHome: string;
  const savedHome = process.env.AGENT_HOME_DIR;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-clearkey-'));
    process.env.AGENT_HOME_DIR = tmpHome;
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    if (savedHome === undefined) delete process.env.AGENT_HOME_DIR;
    else process.env.AGENT_HOME_DIR = savedHome;
  });

  it('删除已存在的 key 文件,返回 true', () => {
    saveApiKey('deepseek', 'sk-abc');
    expect(fs.existsSync(getApiKeyPath('deepseek'))).toBe(true);
    expect(clearApiKey('deepseek')).toBe(true);
    expect(fs.existsSync(getApiKeyPath('deepseek'))).toBe(false);
    expect(readApiKeyFromFile('deepseek')).toBeNull();
  });

  it('删除不存在的 key 文件,返回 false(无副作用)', () => {
    expect(clearApiKey('minimax')).toBe(false);
  });

  it('只删指定 provider,不影响其他', () => {
    saveApiKey('deepseek', 'sk-d');
    saveApiKey('minimax', 'sk-m');
    clearApiKey('deepseek');
    expect(readApiKeyFromFile('deepseek')).toBeNull();
    expect(readApiKeyFromFile('minimax')).toBe('sk-m');
  });

  it('provider 名字校验(防路径穿越)', () => {
    expect(() => clearApiKey('../etc/passwd')).toThrow();
  });
});
