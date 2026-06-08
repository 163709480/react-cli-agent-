export type ProviderKind = 'local' | 'online' | 'custom';

/**
 * Provider preset — 描述一个可用的 LLM 接入点。
 *
 * 第一版: ollama / deepseek / minimax。
 * 更多信息(是否需要 key / 默认 model / baseUrl)由 preset 提供,
 * 让 CLI config 命令和 TUI /model 命令都能直接消费。
 */
export interface ProviderPreset {
  id: string;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  defaultModel: string;
  /** 是否需要真实 API key(本地服务如 Ollama 可填占位 key) */
  requiresApiKey: boolean;
  /** 推荐环境变量名(用于提示用户);默认 OPENAI_API_KEY */
  apiKeyEnv?: string;
  notes?: string;
}

const PROVIDERS: Record<string, ProviderPreset> = {
  ollama: {
    id: 'ollama',
    label: 'Ollama (local)',
    kind: 'local',
    baseUrl: 'http://127.0.0.1:11434/v1',
    defaultModel: 'qwen2.5-coder:7b',
    requiresApiKey: false,
    notes: '本地 Ollama 服务;key 可用占位如 "ollama"',
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek (online)',
    kind: 'online',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    requiresApiKey: true,
    apiKeyEnv: 'OPENAI_API_KEY',
  },
  minimax: {
    id: 'minimax',
    label: 'MiniMax (online)',
    // TODO(verify): baseUrl/model 需要按 MiniMax 官方 OpenAI-compatible 文档核对,
    // 当前为占位,正式发布前必须替换。详见 docs/ROADMAP_CURRENT_ASSESSMENT.md P1.2。
    kind: 'online',
    baseUrl: 'https://api.minimax.chat/v1',
    defaultModel: 'minimax-chat',
    requiresApiKey: true,
    apiKeyEnv: 'OPENAI_API_KEY',
    notes: 'baseUrl/model 需按官方 OpenAI-compatible 文档核对',
  },
};

export function listProviderNames(): string[] {
  return Object.keys(PROVIDERS);
}

export function resolveProvider(name: string): ProviderPreset {
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new Error(
      `Unknown --provider "${name}". Available: ${listProviderNames().join(', ')}`,
    );
  }
  return provider;
}

export function listProviders(): ProviderPreset[] {
  return Object.values(PROVIDERS);
}
