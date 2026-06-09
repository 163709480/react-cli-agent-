import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { resolveProvider } from './llm/providers.js';
import { loadUserConfig, defaultApiKeyForProvider, readApiKeyFromFile } from './agent/userConfig.js';

export interface Config {
  openaiApiKey: string;
  openaiBaseUrl: string;
  openaiModel: string;
  maxContextTokens: number;
  writeableExts: string[];
  providerName: string;
  maxTurns: number;       // default 12
  maxToolCalls: number;   // default 30
}

const DEFAULT_PROVIDER = 'deepseek';
const DEFAULT_MAX_CONTEXT = 120000;
const DEFAULT_EXTS = ['.md', '.ts', '.tsx', '.js', '.jsx', '.json', '.yaml', '.yml', '.toml', '.txt'];
const DEFAULT_MAX_TURNS = 12;
const DEFAULT_MAX_TOOL_CALLS = 30;

function loadJsonConfig(): import('./agent/userConfig.js').UserConfig {
  return loadUserConfig();
}

export interface LoadConfigOptions {
  provider?: string;
  maxTurns?: number;
  maxToolCalls?: number;
}

export function loadConfig(opts: LoadConfigOptions = {}): Config {
  const file = loadJsonConfig();
  // 显式 --provider 优先;否则看 user config 里持久化的 providerName
  const effectiveProvider = opts.provider ?? file.providerName;
  const provider = effectiveProvider ? resolveProvider(effectiveProvider) : undefined;
  const fallbackProvider = resolveProvider(DEFAULT_PROVIDER);

  // provider 名字:显式 --provider 优先,否则用 file.providerName,
  // 否则看实际 baseUrl 是不是某个 preset 的,都不是就标 'default'
  const baseUrl =
    provider?.baseUrl ??
    process.env.OPENAI_BASE_URL ??
    file.openaiBaseUrl ??
    fallbackProvider.baseUrl;
  const model =
    provider?.defaultModel ??
    process.env.OPENAI_MODEL ??
    file.openaiModel ??
    fallbackProvider.defaultModel;

  let providerName: string;
  if (effectiveProvider) {
    providerName = effectiveProvider;
  } else if (baseUrl === fallbackProvider.baseUrl) {
    providerName = DEFAULT_PROVIDER;
  } else {
    providerName = 'default';
  }

  // API key 优先级:
  //   1. env OPENAI_API_KEY(显式)
  //   2. secrets 文件 ~/.agent/secrets/{provider}.key(用户曾 /config 输入过)
  //   3. 对本地 provider(ollama)给占位 key
  //   4. 在线 provider 没设 env 也没 secrets 时给空串(由 App 启动时友好提示)
  const envKey = process.env.OPENAI_API_KEY ?? '';
  const fileKey = providerName ? (readApiKeyFromFile(providerName) ?? '') : '';
  const openaiApiKey = envKey || fileKey || defaultApiKeyForProvider(providerName);

  return {
    openaiApiKey,
    openaiBaseUrl: baseUrl,
    openaiModel: model,
    maxContextTokens: parseInt(
      process.env.AGENT_MAX_CONTEXT_TOKENS ?? String(file.maxContextTokens ?? DEFAULT_MAX_CONTEXT),
      10,
    ),
    writeableExts: file.writeableExts ?? DEFAULT_EXTS,
    maxTurns: parseInt(
      String(opts.maxTurns ?? process.env.AGENT_MAX_TURNS ?? file.maxTurns ?? DEFAULT_MAX_TURNS),
      10,
    ),
    maxToolCalls: parseInt(
      String(opts.maxToolCalls ?? process.env.AGENT_MAX_TOOL_CALLS ?? file.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS),
      10,
    ),
    providerName,
  };
}

