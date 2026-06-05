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
}

const DEFAULT_PROVIDER = 'deepseek';
const DEFAULT_MAX_CONTEXT = 120000;
const DEFAULT_EXTS = ['.md', '.ts', '.tsx', '.js', '.jsx', '.json', '.yaml', '.yml', '.toml', '.txt'];

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

  return {
    openaiApiKey: process.env.OPENAI_API_KEY ?? '',
    openaiBaseUrl:
      provider?.baseUrl ??
      process.env.OPENAI_BASE_URL ??
      file.openaiBaseUrl ??
      fallbackProvider.baseUrl,
    openaiModel:
      provider?.defaultModel ??
      process.env.OPENAI_MODEL ??
      file.openaiModel ??
      fallbackProvider.defaultModel,
    maxContextTokens: parseInt(
      process.env.AGENT_MAX_CONTEXT_TOKENS ?? String(file.maxContextTokens ?? DEFAULT_MAX_CONTEXT),
      10,
    ),
    writeableExts: file.writeableExts ?? DEFAULT_EXTS,
  };
}
