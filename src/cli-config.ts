#!/usr/bin/env node
/**
 * CLI 子命令: `react-cli-agent config [--provider <name>] [--show]`
 *
 * 用途:把 provider 选择和默认 baseUrl/model 持久化到 ~/.agent/config.json。
 * 不持久化 API key — 真实 key 仍走 env(OPENAI_API_KEY)。
 *
 * 输出: 直接 stdout,退出码 0 成功 / 2 错误。
 */

import { listProviderNames, listProviders, resolveProvider } from './llm/providers.js';
import {
  applyProviderPreset,
  saveUserConfig,
  loadUserConfig,
  getConfigPath,
} from './agent/userConfig.js';

interface CliArgs {
  provider?: string;
  show: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { show: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--provider') {
      out.provider = argv[++i];
    } else if (a === '--show') {
      out.show = true;
    } else if (a === '--help' || a === '-h') {
      out.help = true;
    } else {
      process.stderr.write(`react-cli-agent config: 未知参数: ${a}\n`);
      process.exit(2);
    }
  }
  return out;
}

function printHelp(): void {
  process.stdout.write(
    `react-cli-agent config — 配置 provider / model 持久化\n` +
      '\n' +
      '用法:\n' +
      '  react-cli-agent config [--provider <name>] [--show]\n' +
      '\n' +
      '选项:\n' +
      `  --provider <name>    选择 provider: ${listProviderNames().join(' | ')}\n` +
      '  --show               显示当前持久化配置(provider / baseUrl / model,不含 key)\n' +
      '  -h, --help           显示本帮助\n' +
      '\n' +
      '示例:\n' +
      '  react-cli-agent config --provider ollama       切换到本地 Ollama\n' +
      '  react-cli-agent config --provider deepseek     切回在线 DeepSeek\n' +
      '  react-cli-agent config --show                  查看当前配置\n' +
      '\n' +
      '说明:\n' +
      '  - 配置文件: ~/.agent/config.json (权限 0600)\n' +
      '  - API key 不会写入配置文件,请通过环境变量 OPENAI_API_KEY 提供\n' +
      '  - 在线 provider 启动时若未设 OPENAI_API_KEY 会给出提示\n' +
      '\n',
  );
}

function runShow(): void {
  const cfg = loadUserConfig();
  process.stdout.write(`配置文件: ${getConfigPath()}\n`);
  if (cfg.providerName) {
    process.stdout.write(`provider:   ${cfg.providerName}\n`);
  } else {
    process.stdout.write(`provider:   (未设置,使用默认)\n`);
  }
  if (cfg.openaiBaseUrl) process.stdout.write(`baseUrl:    ${cfg.openaiBaseUrl}\n`);
  if (cfg.openaiModel) process.stdout.write(`model:      ${cfg.openaiModel}\n`);
  if (cfg.maxTurns) process.stdout.write(`maxTurns:   ${cfg.maxTurns}\n`);
  if (cfg.maxToolCalls) process.stdout.write(`maxToolCalls: ${cfg.maxToolCalls}\n`);
  // 不打印 key
}

function runSetProvider(name: string): void {
  let merged;
  try {
    merged = applyProviderPreset(loadUserConfig(), name);
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    process.exit(2);
  }
  const path = saveUserConfig(merged);
  const preset = resolveProvider(name);
  process.stdout.write(`✓ 已切换到 ${preset.label}\n`);
  process.stdout.write(`  baseUrl: ${preset.baseUrl}\n`);
  process.stdout.write(`  model:   ${preset.defaultModel}\n`);
  process.stdout.write(`  配置已写入 ${path}\n`);
  if (preset.requiresApiKey) {
    const env = preset.apiKeyEnv ?? 'OPENAI_API_KEY';
    process.stdout.write(
      `\n注意: ${preset.label} 需要 API key。\n` +
        `请确保 ${env} 已设置(或写入 ~/.zshrc / ~/.bashrc)。\n`,
    );
  } else {
    process.stdout.write(`\n本地 provider,不需要 API key(会用占位 key)。\n`);
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  if (args.show && !args.provider) {
    runShow();
    process.exit(0);
  }
  if (args.provider) {
    runSetProvider(args.provider);
    process.exit(0);
  }
  // 无参数:列出可用 provider
  process.stdout.write('可用 provider:\n');
  for (const p of listProviders()) {
    const key = p.requiresApiKey ? '(需 API key)' : '(本地,占位 key)';
    process.stdout.write(`  ${p.id.padEnd(10)} ${p.label.padEnd(24)} ${key}\n`);
  }
  process.stdout.write('\n用法: react-cli-agent config --provider <name>\n');
}

main();
