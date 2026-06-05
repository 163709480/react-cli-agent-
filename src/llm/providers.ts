export interface ProviderPreset {
  baseUrl: string;
  defaultModel: string;
}

const PROVIDERS: Record<string, ProviderPreset> = {
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
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
