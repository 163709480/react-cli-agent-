import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface Config {
  openaiApiKey: string;
  openaiBaseUrl: string;
  openaiModel: string;
  maxContextTokens: number;
  writeableExts: string[];
}

const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1';
const DEFAULT_MODEL = 'deepseek-chat';
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

export function loadConfig(): Config {
  const file = loadJsonConfig();
  return {
    openaiApiKey: process.env.OPENAI_API_KEY ?? '',
    openaiBaseUrl: process.env.OPENAI_BASE_URL ?? file.openaiBaseUrl ?? DEFAULT_BASE_URL,
    openaiModel: process.env.OPENAI_MODEL ?? file.openaiModel ?? DEFAULT_MODEL,
    maxContextTokens: parseInt(
      process.env.AGENT_MAX_CONTEXT_TOKENS ?? String(file.maxContextTokens ?? DEFAULT_MAX_CONTEXT),
      10,
    ),
    writeableExts: file.writeableExts ?? DEFAULT_EXTS,
  };
}
