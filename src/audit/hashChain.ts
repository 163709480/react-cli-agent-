import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { canonicalJson } from './canonical.js';

/**
 * SHA-256 hash chain。
 *
 * 链规则:
 *   - 第 1 行(prevHash = 创世):hash = sha256(canonicalJson(payloadMinusHash))
 *   - 第 N>1 行:hash = sha256(canonicalJson(payloadMinusHash) + prevHash)
 *
 * "payloadMinusHash" 指的是要写盘的 payload 对象去掉 `hash` 字段本身(因为
 * hash 不能参与自身计算)。`prevHash` 在第一行视为空字符串之外的固定起点。
 *
 * 验证公式:对文件里每行,剥离 hash 字段后,重算 = 记录的 hash。
 */

const PREFIX = 'sha256:';

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * 创世行 hash(第一行,无 prevHash)。
 * 注意:输入应是"去掉 hash 字段的 payload"。
 */
export function genesisHash(payloadWithoutHash: object): string {
  return PREFIX + sha256(canonicalJson(payloadWithoutHash));
}

/**
 * 链中第 N>0 行的 hash。
 * @param prev 上一行记录的 hash(创世行用其自身 hash)
 * @param payloadWithoutHash 当前行去掉 hash 字段的 payload
 */
export function nextHash(prev: string, payloadWithoutHash: object): string {
  return PREFIX + sha256(canonicalJson(payloadWithoutHash) + prev);
}

export interface VerifyResult {
  ok: boolean;
  lines: number;
  /** 首个不匹配行的 seq(0-based),若无问题则 undefined */
  firstBreakSeq?: number;
  /** 首个不匹配的具体原因 */
  reason?: 'hash-mismatch' | 'prev-hash-mismatch' | 'missing-field' | 'parse-error' | 'duplicate-seq' | 'non-monotonic-seq';
}

interface ParsedLine {
  seq: number;
  hash: string;
  prevHash: string;
  payload: Record<string, unknown>;
  /** 去掉 hash 后的 payload,canonicalJson 用 */
  payloadWithoutHash: Record<string, unknown>;
}

/**
 * 读取整个 JSONL 文件,逐行重算 hash 链。
 * 容忍 \n 和 \r\n 行尾。
 */
export async function verifyChain(filePath: string): Promise<VerifyResult> {
  const text = await readFile(filePath, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  let prevHash: string | undefined;
  let prevSeq = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let parsed: ParsedLine;
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      if (typeof obj.hash !== 'string' || typeof obj.prevHash !== 'string' || typeof obj.seq !== 'number') {
        return { ok: false, lines: lines.length, firstBreakSeq: i, reason: 'missing-field' };
      }
      // payloadWithoutHash = obj 去掉 hash 和 prevHash(这两个字段不参与自身 hash 计算)
      const { hash: _h, prevHash: _p, ...payloadWithoutHash } = obj;
      parsed = {
        seq: obj.seq,
        hash: obj.hash,
        prevHash: obj.prevHash,
        payload: obj,
        payloadWithoutHash: payloadWithoutHash as Record<string, unknown>,
      };
    } catch {
      return { ok: false, lines: lines.length, firstBreakSeq: i, reason: 'parse-error' };
    }
    if (parsed.seq !== prevSeq + 1) {
      return { ok: false, lines: lines.length, firstBreakSeq: i, reason: 'non-monotonic-seq' };
    }
    const expected = prevHash === undefined
      ? genesisHash(parsed.payloadWithoutHash)
      : nextHash(prevHash, parsed.payloadWithoutHash);
    if (parsed.hash !== expected) {
      return { ok: false, lines: lines.length, firstBreakSeq: i, reason: 'hash-mismatch' };
    }
    if (prevHash !== undefined && parsed.prevHash !== prevHash) {
      return { ok: false, lines: lines.length, firstBreakSeq: i, reason: 'prev-hash-mismatch' };
    }
    prevHash = parsed.hash;
    prevSeq = parsed.seq;
  }
  return { ok: true, lines: lines.length };
}
