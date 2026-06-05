#!/usr/bin/env -S npx tsx
/**
 * 审计员独立验证 CLI。
 *
 * 用法:
 *   npx tsx src/audit/verifyChain.ts <path-to-jsonl>
 *
 * 输出(stdout 一行 JSON):
 *   { ok: true,  lines: N }                         链完好,exit 0
 *   { ok: false, lines: N,
 *     firstBreakSeq: S, reason: R }                 链断裂,exit 1
 *   stderr: parse error 等                          exit 2
 *
 * 字段含义:
 *   - lines:         文件有效行数(忽略空行)
 *   - firstBreakSeq: **0-based**,对应文件第 (S+1) 行。
 *                    例: firstBreakSeq: 7 → 文件第 8 行
 *   - reason:        'hash-mismatch' | 'prev-hash-mismatch' |
 *                    'missing-field' | 'parse-error' |
 *                    'non-monotonic-seq'(行被删)
 *
 * 排错步骤(拿到 firstBreakSeq 后):
 *   1) sed -n '<S+1>p' <file> | jq          # 看断裂行
 *   2) sed -n '<S>p;<S+1>p' <file> | jq     # 对比上行 hash 与本行 prevHash
 *      - 上一行被改 → reason: prev-hash-mismatch
 *      - 本行被改   → reason: hash-mismatch
 *      - 中间行被删 → reason: non-monotonic-seq
 */
import { verifyChain } from './hashChain.js';

async function main() {
  const file = process.argv[2];
  if (!file) {
    process.stderr.write('Usage: verifyChain <path-to-jsonl>\n');
    process.exit(2);
  }
  try {
    const r = await verifyChain(file);
    process.stdout.write(JSON.stringify(r) + '\n');
    process.exit(r.ok ? 0 : 1);
  } catch (e) {
    process.stderr.write(`verifyChain: ${(e as Error).message}\n`);
    process.exit(2);
  }
}

await main();
