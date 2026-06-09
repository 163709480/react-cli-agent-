/**
 * 启动路径测试:模拟 "config 持久化到 minimax + env 没 key + secrets 没 key"
 * 的启动场景,验证 createOpenAIClient 会抛错,UI 应触发 ApiKeyInput。
 *
 * 不直接 render App(它有 audit / 副作用),改测底层的错误触发条件:
 * - loadConfig 算出 openaiApiKey = ''  ← 缺 key 信号
 * - createOpenAIClient(cfg) 抛错       ← UI 应捕获并弹框
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('启动期缺 key 检测(P0.7.4 启动路径)', () => {
  const savedEnv: Record<string, string | undefined> = {};
  const envKeys = ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL', 'AGENT_HOME_DIR'];
  let home: string;

  beforeEach(() => {
    for (const k of envKeys) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-startup-'));
    process.env.AGENT_HOME_DIR = home;
  });

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
    for (const k of envKeys) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it('持久化 minimax + 无 env + 无 secrets → loadConfig 算出 openaiApiKey = ""', async () => {
    const { loadConfig } = await import('../config.js');
    fs.mkdirSync(path.join(home, '.agent'), { recursive: true });
    fs.writeFileSync(
      path.join(home, '.agent', 'config.json'),
      JSON.stringify({
        providerName: 'minimax',
        openaiBaseUrl: 'https://api.minimaxi.com/v1',
        openaiModel: 'MiniMax-M3',
      }),
    );
    const cfg = loadConfig();
    expect(cfg.providerName).toBe('minimax');
    // 关键:openaiApiKey 是空串,不是 placeholder 也不是 "fake"
    expect(cfg.openaiApiKey).toBe('');
  });

  it('createOpenAIClient 在 openaiApiKey 为空时抛错(UI 用此信号触发 ApiKeyInput)', async () => {
    const { createOpenAIClient } = await import('../llm/client.js');
    expect(() =>
      createOpenAIClient({
        openaiApiKey: '',
        openaiBaseUrl: 'https://api.minimaxi.com/v1',
        openaiModel: 'MiniMax-M3',
        maxContextTokens: 120000,
        writeableExts: [],
        providerName: 'minimax',
        maxTurns: 12,
        maxToolCalls: 30,
      }),
    ).toThrow(/OPENAI_API_KEY is not set/);
  });

  it('secrets 文件存在时,启动期不会触发 ApiKeyInput(loadConfig 拿到 key)', async () => {
    const { loadConfig } = await import('../config.js');
    const { saveApiKey } = await import('../agent/userConfig.js');
    fs.mkdirSync(path.join(home, '.agent'), { recursive: true });
    fs.writeFileSync(
      path.join(home, '.agent', 'config.json'),
      JSON.stringify({ providerName: 'minimax' }),
    );
    saveApiKey('minimax', 'sk-real-key');
    const cfg = loadConfig();
    expect(cfg.openaiApiKey).toBe('sk-real-key');
  });

  it('ollama + 无任何配置 → loadConfig 给占位 key,不触发弹框', async () => {
    const { loadConfig } = await import('../config.js');
    fs.mkdirSync(path.join(home, '.agent'), { recursive: true });
    fs.writeFileSync(
      path.join(home, '.agent', 'config.json'),
      JSON.stringify({ providerName: 'ollama' }),
    );
    const cfg = loadConfig();
    expect(cfg.openaiApiKey).toBe('placeholder-key');
  });
});
