import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../config.js';

describe('loadConfig', () => {
  const savedEnv: Record<string, string | undefined> = {};
  const envKeys = [
    'OPENAI_API_KEY',
    'OPENAI_BASE_URL',
    'OPENAI_MODEL',
    'AGENT_MAX_CONTEXT_TOKENS',
    'AGENT_MAX_TURNS',
    'AGENT_MAX_TOOL_CALLS',
    'AGENT_HOME_DIR',
  ];
  let home: string;

  beforeEach(async () => {
    for (const k of envKeys) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-config-home-'));
    process.env.AGENT_HOME_DIR = home;
  });

  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true });
    for (const k of envKeys) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it('不传 provider 时,行为保持 env 优先', () => {
    process.env.OPENAI_BASE_URL = 'https://example.com/v1';
    process.env.OPENAI_MODEL = 'some-model';
    const cfg = loadConfig();
    expect(cfg.openaiBaseUrl).toBe('https://example.com/v1');
    expect(cfg.openaiModel).toBe('some-model');
  });

  it('不传 provider 且无 env 时,使用 deepseek 默认值', () => {
    const cfg = loadConfig();
    expect(cfg.openaiBaseUrl).toBe('https://api.deepseek.com/v1');
    expect(cfg.openaiModel).toBe('deepseek-chat');
    expect(cfg.providerName).toBe('deepseek');
  });

  it('不传 provider 但 env 自定义 baseUrl 时,providerName 标 default', () => {
    process.env.OPENAI_BASE_URL = 'https://example.com/v1';
    const cfg = loadConfig();
    expect(cfg.providerName).toBe('default');
  });

  it('显式传 --provider 时,providerName 用传进来的名字', () => {
    const cfg = loadConfig({ provider: 'deepseek' });
    expect(cfg.providerName).toBe('deepseek');
  });

  it('传 provider 时,覆盖 env 中的 baseUrl 和 model', () => {
    process.env.OPENAI_BASE_URL = 'https://example.com/v1';
    process.env.OPENAI_MODEL = 'some-model';
    const cfg = loadConfig({ provider: 'deepseek' });
    expect(cfg.openaiBaseUrl).toBe('https://api.deepseek.com/v1');
    expect(cfg.openaiModel).toBe('deepseek-chat');
  });

  it('传未知 provider 时抛错', () => {
    expect(() => loadConfig({ provider: 'nonexistent-xyz' })).toThrow(/Unknown --provider/);
  });

  it('传 provider 时,API key 仍从 env 读取', () => {
    process.env.OPENAI_API_KEY = 'sk-test-123';
    const cfg = loadConfig({ provider: 'deepseek' });
    expect(cfg.openaiApiKey).toBe('sk-test-123');
  });

  it('AGENT_MAX_TURNS / AGENT_MAX_TOOL_CALLS 解析', () => {
    process.env.AGENT_MAX_TURNS = '8';
    process.env.AGENT_MAX_TOOL_CALLS = '20';
    const cfg = loadConfig();
    expect(cfg.maxTurns).toBe(8);
    expect(cfg.maxToolCalls).toBe(20);
  });

  it('未传 env 时,使用默认 12 / 30', () => {
    const cfg = loadConfig();
    expect(cfg.maxTurns).toBe(12);
    expect(cfg.maxToolCalls).toBe(30);
  });

  it('opts.maxTurns 覆盖 env', () => {
    process.env.AGENT_MAX_TURNS = '5';
    const cfg = loadConfig({ maxTurns: 99 });
    expect(cfg.maxTurns).toBe(99);
  });
});

describe('loadConfig API key 来源优先级(P0.7.4)', () => {
  const savedEnv: Record<string, string | undefined> = {};
  const envKeys = ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL', 'AGENT_HOME_DIR'];
  let home: string;

  beforeEach(async () => {
    for (const k of envKeys) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-config-priority-'));
    process.env.AGENT_HOME_DIR = home;
  });

  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true });
    for (const k of envKeys) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it('env OPENAI_API_KEY 优先于 secrets 文件', () => {
    fsSync.mkdirSync(path.join(home, '.agent', 'secrets'), { recursive: true });
    fsSync.writeFileSync(path.join(home, '.agent', 'secrets', 'deepseek.key'), 'from-file');
    process.env.OPENAI_API_KEY = 'from-env';
    const cfg = loadConfig({ provider: 'deepseek' });
    expect(cfg.openaiApiKey).toBe('from-env');
  });

  it('secrets 文件在 env 没设时生效', () => {
    fsSync.mkdirSync(path.join(home, '.agent', 'secrets'), { recursive: true });
    fsSync.writeFileSync(path.join(home, '.agent', 'secrets', 'deepseek.key'), 'from-file');
    const cfg = loadConfig({ provider: 'deepseek' });
    expect(cfg.openaiApiKey).toBe('from-file');
  });

  it('ollama 没有 secrets 文件也用占位 key', () => {
    const cfg = loadConfig({ provider: 'ollama' });
    expect(cfg.openaiApiKey).toBe('placeholder-key');
  });

  it('在线 provider 既无 env 也无 secrets 时给空串', () => {
    const cfg = loadConfig({ provider: 'minimax' });
    expect(cfg.openaiApiKey).toBe('');
  });
});
