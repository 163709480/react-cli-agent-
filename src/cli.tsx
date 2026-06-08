#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { App } from './app.js';
import { loadConfig } from './config.js';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const require = createRequire(import.meta.url);
// 读取 package.json 拿版本号
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgPath = path.resolve(__dirname, '..', 'package.json');
// 兼容:被 tsx 跑(根目录) vs 被 dist/cli.js 跑(上一级)
let VERSION = '0.0.0';
try {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  VERSION = pkg.version ?? VERSION;
} catch {
  // fallback: 尝试 import.meta.url 上一级或同级
  try {
    const pkg = JSON.parse(
      readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf-8'),
    );
    VERSION = pkg.version ?? VERSION;
  } catch { /* keep default */ }
}

interface Args {
  yolo: boolean;
  allowMutations: boolean;
  cwd: string;
  provider?: string;
  headlessPrompt?: string;
  /**
   * 审计日志模式:
   *   'default' = 写到 ~/.agent/audit/<sessionId>.jsonl(默认开启)
   *   'path'    = 写到用户指定路径(--audit-log <path>)
   *   'off'     = 关闭(--no-audit-log)
   */
  auditMode: 'default' | 'path' | 'off';
  auditPath?: string;
  maxTurns?: number;
  maxToolCalls?: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    yolo: false,
    allowMutations: false,
    cwd: process.cwd(),
    auditMode: 'default',
  };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--yolo') args.yolo = true;
    else if (a === '--allow-mutations') args.allowMutations = true;
    else if (a === '--cwd') args.cwd = argv[++i] ?? args.cwd;
    else if (a === '--provider') args.provider = argv[++i];
    else if (a === '--max-turns') {
      const n = parseInt(argv[++i] ?? '', 10);
      if (!Number.isFinite(n) || n < 1) {
        process.stderr.write('--max-turns 必须是正整数\n');
        process.exit(2);
      }
      args.maxTurns = n;
    }
    else if (a === '--max-tool-calls') {
      const n = parseInt(argv[++i] ?? '', 10);
      if (!Number.isFinite(n) || n < 1) {
        process.stderr.write('--max-tool-calls 必须是正整数\n');
        process.exit(2);
      }
      args.maxToolCalls = n;
    }
    else if (a === '--no-audit-log') {
      if (args.auditMode !== 'default') {
        process.stderr.write('audit flag conflict: --no-audit-log combined with --audit-log\n');
        process.exit(2);
      }
      args.auditMode = 'off';
    } else if (a === '--audit-log') {
      if (args.auditMode === 'off') {
        process.stderr.write('audit flag conflict: --audit-log combined with --no-audit-log\n');
        process.exit(2);
      }
      // 取下一个参数;若没有或下一个是另一个 flag,则用 'default' 路径
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args.auditMode = 'path';
        args.auditPath = next;
        i++;
      } else {
        args.auditMode = 'default';
      }
    } else if (!a.startsWith('--')) positional.push(a);
  }
  if (positional.length > 0) args.headlessPrompt = positional.join(' ');
  return args;
}

// 早期拦截: --version / --help / config 子命令(不进入 TUI)
{
  const idx = process.argv.indexOf('config');
  if (idx > 0) {
    // 透传 config 之后的参数(以及其后的)
    const rest = process.argv.slice(idx + 1);
    const cliConfigPath = path.resolve(__dirname, 'cli-config.js');
    const r = spawnSync(process.execPath, [cliConfigPath, ...rest], { stdio: 'inherit' });
    process.exit(r.status ?? (r.error ? 1 : 0));
  }
}

// 早期拦截: --version / --help(不需要加载 .env / 启动 TUI)
for (const a of process.argv.slice(2)) {
  if (a === '--version' || a === '-v') {
    process.stdout.write(`react-cli-agent ${VERSION}\n`);
    process.exit(0);
  }
  if (a === '--help' || a === '-h') {
    process.stdout.write(
      `react-cli-agent ${VERSION}\n` +
        '\n' +
        '用法: react-cli-agent [options] [prompt]\n' +
        '\n' +
        '选项:\n' +
        '  --version, -v              输出版本号并退出\n' +
        '  --help, -h                 打印本帮助并退出\n' +
        '  --yolo                     跳过工具调用的安全审批(谨慎使用)\n' +
        '  --allow-mutations          允许 HTTP POST 等副作用请求(写文件不受此选项控制)\n' +
        '  --cwd <path>               设置工作目录\n' +
        '  --provider <name>          指定 LLM provider(覆盖 env)\n' +
        '  --max-turns <n>            单次会话最大 LLM turns(默认 12)\n' +
        '  --max-tool-calls <n>       单次会话最大 tool calls(默认 30)\n' +
        '  --audit-log [path]         审计日志:可选指定路径,省略则用默认 ~/.agent/audit/\n' +
        '  --no-audit-log             关闭审计日志\n' +
        '\n' +
        '环境变量:\n' +
        '  OPENAI_API_KEY             provider API key\n' +
        '  OPENAI_BASE_URL            OpenAI 兼容 base URL\n' +
        '  OPENAI_MODEL               模型名(覆盖 provider preset 默认)\n' +
        '  AGENT_PROVIDER             LLM provider preset(覆盖 baseUrl/model)\n' +
        '  AGENT_MAX_CONTEXT_TOKENS   上下文窗口 token 上限\n' +
        '  AGENT_MAX_TURNS            覆盖默认 max-turns\n' +
        '  AGENT_MAX_TOOL_CALLS       覆盖默认 max-tool-calls\n' +
        '\n' +
        '示例:\n' +
        '  react-cli-agent                          启动 TUI\n' +
        '  react-cli-agent "重构 src/foo.ts"          headless 模式,直接跑完\n' +
        '  react-cli-agent --max-turns 5            限制 5 轮 LLM 调用\n' +
        '  react-cli-agent --audit-log ./audit.jsonl  写到指定路径\n' +
        '  react-cli-agent config --provider ollama  切到本地 Ollama\n' +
        '  react-cli-agent config --show            查看持久化配置(不含 key)\n' +
        '\n',
    );
    process.exit(0);
  }
}

const args = parseArgs(process.argv.slice(2));

// 加载 .env(开发期)
import('node:fs').then(async ({ existsSync, readFileSync }) => {
  if (existsSync('.env')) {
    for (const line of readFileSync('.env', 'utf-8').split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  }

  const config = (() => {
    try {
      return loadConfig({
        provider: args.provider,
        // CLI 优先级最高:覆盖 env
        maxTurns: args.maxTurns,
        maxToolCalls: args.maxToolCalls,
      });
    } catch (e) {
      process.stderr.write(`${(e as Error).message}\n`);
      process.exit(2);
    }
  })();

  render(
    <App
      yolo={args.yolo}
      allowMutations={args.allowMutations}
      cwd={args.cwd}
      headlessPrompt={args.headlessPrompt}
      config={config}
      auditMode={args.auditMode}
      auditPath={args.auditPath}
      agentVersion={VERSION}
    />,
  );
});
