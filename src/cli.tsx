#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { App } from './app.js';
import { loadConfig } from './config.js';

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
    />,
  );
});
