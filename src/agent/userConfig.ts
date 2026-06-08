import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { resolveProvider } from '../llm/providers.js';

/**
 * 持久化用户配置 — 写到 ~/.agent/config.json
 *
 * 第一版(P0.7): 只持久化 provider 选择(以及 preset 默认的 baseUrl/model),
 * 不持久化 API key — 真实 key 仍然走 env(OPENAI_API_KEY),
 * 本地 provider 允许占位 key(由 preset.requiresApiKey 决定)。
 *
 * 配置文件权限:0600(只有当前用户可读写),写完后用 chmod 强制。
 */

export interface UserConfig {
  providerName?: string;
  openaiBaseUrl?: string;
  openaiModel?: string;
  /** 引用:实际 key 仍从 env 读取;本字段只声明引用,不写明文 */
  openaiApiKeyRef?: string;
  maxTurns?: number;
  maxToolCalls?: number;
  maxContextTokens?: number;
  writeableExts?: string[];
}

const CONFIG_FILE_MODE = 0o600;

/**
 * 可被测试覆盖的目录解析函数。生产环境就是 ~ + /.agent,
 * 测试里可以通过 process.env.AGENT_HOME_DIR 隔离,
 * 或者通过 vi.spyOn(userConfig, 'resolveConfigDir') 替换。
 */
export function resolveConfigDir(): string {
  const home = process.env.AGENT_HOME_DIR ?? os.homedir();
  return path.join(home, '.agent');
}

function configFilePath(): string {
  return path.join(resolveConfigDir(), 'config.json');
}

export function getConfigPath(): string {
  return configFilePath();
}

export function loadUserConfig(): UserConfig {
  try {
    return JSON.parse(fs.readFileSync(configFilePath(), 'utf-8')) as UserConfig;
  } catch {
    return {};
  }
}

/**
 * 应用 provider preset:把 provider id 翻译成 baseUrl/model,合并到 userConfig。
 * 不覆盖 user 已显式设置的非空字段。
 */
export function applyProviderPreset(
  cfg: UserConfig,
  providerName: string,
): UserConfig {
  const preset = resolveProvider(providerName);
  return {
    ...cfg,
    providerName,
    openaiBaseUrl: cfg.openaiBaseUrl ?? preset.baseUrl,
    openaiModel: cfg.openaiModel ?? preset.defaultModel,
  };
}

/**
 * 写入 user config 文件。返回写入的路径(给 CLI 输出)。
 * 写完后强制 chmod 0600,降低 key 泄露风险。
 */
export function saveUserConfig(cfg: UserConfig): string {
  const dir = resolveConfigDir();
  const file = path.join(dir, 'config.json');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n', 'utf-8');
  // chmod 0600 — 配置文件含 API key 引用(虽然本版不存明文 key),降低风险
  try { fs.chmodSync(file, CONFIG_FILE_MODE); } catch { /* Windows 等不支持 */ }
  return file;
}

/**
 * 根据 preset 决定是否允许占位 API key(用于 loadConfig 的 openaiApiKey 缺省)。
 */
export function defaultApiKeyForProvider(providerName?: string): string {
  if (!providerName) return '';
  try {
    const p = resolveProvider(providerName);
    if (!p.requiresApiKey) return 'placeholder-key';
  } catch { /* unknown */ }
  return '';
}
