import OpenAI from 'openai';
import type { Config } from '../config.js';

export function createOpenAIClient(cfg: Config): OpenAI {
  if (!cfg.openaiApiKey) {
    throw new Error('OPENAI_API_KEY is not set. Please set it in .env or env.');
  }
  return new OpenAI({
    apiKey: cfg.openaiApiKey,
    baseURL: cfg.openaiBaseUrl,
  });
}
