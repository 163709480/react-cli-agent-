import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { resolveProvider } from './llm/providers.js';

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

function loadJsonConfig(): Partial<Config> {
  const p = path.join(os.homedir(), '.agent', 'config.json');
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return {};
  }
}

export interface LoadConfigOptions {
  provider?: string;
}

export function loadConfig(opts: LoadConfigOptions = {}): Config {
  const file = loadJsonConfig();
  const provider = opts.provider ? resolveProvider(opts.provider) : undefined;
  const fallbackProvider = resolveProvider(DEFAULT_PROVIDER);

  // provider 名字:显式 --provider 优先,否则看实际 baseUrl 是不是某个 preset 的,
  // 都不是就标 'default'(说明用了自定义 baseUrl)。
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
  if (opts.provider) {
    providerName = opts.provider;
  } else if (baseUrl === fallbackProvider.baseUrl) {
    providerName = DEFAULT_PROVIDER;
  } else {
    providerName = 'default';
  }

  return {
    openaiApiKey: process.env.OPENAI_API_KEY ?? '',
    openaiBaseUrl: baseUrl,
    openaiModel: model,
    maxContextTokens: parseInt(
      process.env.AGENT_MAX_CONTEXT_TOKENS ?? String(file.maxContextTokens ?? DEFAULT_MAX_CONTEXT),
      10,
    ),
    writeableExts: file.writeableExts ?? DEFAULT_EXTS,
    maxTurns: parseInt(
      process.env.AGENT_MAX_TURNS ?? String(file.maxTurns ?? DEFAULT_MAX_TURNS),
      10,
    ),
    maxToolCalls: parseInt(
      process.env.AGENT_MAX_TOOL_CALLS ?? String(file.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS),
      10,
    ),
    providerName,
  };
}
