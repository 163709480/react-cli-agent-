import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { genesisHash, nextHash, verifyChain } from '../audit/hashChain.js';
import { InMemorySink } from '../audit/sink.js';

describe('hashChain', () => {
  it('genesisHash / nextHash 输出确定且格式为 "sha256:<hex>"', () => {
    const a = genesisHash({ a: 1 });
    const b = genesisHash({ a: 1 });
    expect(a).toBe(b);
    expect(a).toMatch(/^sha256:[0-9a-f]{64}$/);
    const c = nextHash(a, { b: 2 });
    expect(c).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(c).not.toBe(a);
  });

  it('改 1 字节 → 后续 hash 全变', () => {
    const p1 = { msg: 'hello' };
    const p2 = { msg: 'hellx' };
    const h1 = genesisHash(p1);
    const h2 = genesisHash(p2);
    expect(h1).not.toBe(h2);
  });

  it('InMemorySink 写出顺序 + chain 自洽', async () => {
    const sink = new InMemorySink('sid-1', 1234);
    sink.emit({ type: 'session_start', argv: ['x'] });
    sink.emit({ type: 'user_prompt', role: 'user', content: 'hi' });
    sink.emit({ type: 'phase', phase: 'thinking' });
    sink.emit({ type: 'text_delta', delta: '你' });
    sink.emit({ type: 'text_delta', delta: '好' });
    sink.emit({ type: 'phase', phase: 'idle' });
    sink.emit({ type: 'done', finishReason: 'stop' });
    await sink.close('normal');

    expect(sink.events).toHaveLength(8);
    // 顺序 + seq 单调
    expect(sink.events.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    // 创世:prevHash === hash
    expect(sink.events[0].prevHash).toBe(sink.events[0].hash);
    // 后续:prevHash === 上一行 hash
    for (let i = 1; i < sink.events.length; i++) {
      expect(sink.events[i].prevHash).toBe(sink.events[i - 1].hash);
    }
    // 自校验:每行重算 = 记录的 hash(payloadWithoutHash = ev 去掉 hash / prevHash)
    for (const ev of sink.events) {
      const { hash: _h, prevHash: _p, ...payloadWithoutHash } = ev;
      const expected = ev.prevHash === ev.hash
        ? genesisHash(payloadWithoutHash)
        : nextHash(ev.prevHash, payloadWithoutHash);
      expect(ev.hash).toBe(expected);
    }
  });

  it('verifyChain 检测篡改 / 删除 / prevHash 错', async () => {
    const sink = new InMemorySink('sid-2', 99);
    sink.emit({ type: 'session_start', argv: ['x'] });
    sink.emit({ type: 'user_prompt', role: 'user', content: 'hi' });
    sink.emit({ type: 'phase', phase: 'thinking' });
    sink.emit({ type: 'done', finishReason: 'stop' });
    await sink.close('normal');

    const tmpFile = path.join(os.tmpdir(), `audit-chain-test-${Date.now()}.jsonl`);
    await fs.writeFile(tmpFile, sink.events.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
    try {
      // 正向
      const ok = await verifyChain(tmpFile);
      expect(ok.ok).toBe(true);
      expect(ok.lines).toBe(5);

      // 篡改第 2 行的 user_prompt content
      const lines = (await fs.readFile(tmpFile, 'utf8')).split('\n').filter(Boolean);
      const obj = JSON.parse(lines[1]) as Record<string, unknown>;
      obj.content = 'tampered';
      lines[1] = JSON.stringify(obj);
      await fs.writeFile(tmpFile, lines.join('\n') + '\n', 'utf8');
      const tampered = await verifyChain(tmpFile);
      expect(tampered.ok).toBe(false);
      expect(tampered.firstBreakSeq).toBeGreaterThanOrEqual(1);
      expect(tampered.reason).toMatch(/hash-mismatch|prev-hash-mismatch/);

      // 恢复
      await fs.writeFile(tmpFile, sink.events.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
      const ok2 = await verifyChain(tmpFile);
      expect(ok2.ok).toBe(true);
    } finally {
      await fs.rm(tmpFile, { force: true });
    }
  });

  it('verifyChain 容忍 \\r\\n 行尾', async () => {
    const sink = new InMemorySink('sid-3', 1);
    sink.emit({ type: 'session_start', argv: ['x'] });
    await sink.close('normal');
    const tmpFile = path.join(os.tmpdir(), `audit-crlf-${Date.now()}.jsonl`);
    await fs.writeFile(tmpFile, sink.events.map((e) => JSON.stringify(e)).join('\r\n') + '\r\n', 'utf8');
    try {
      const r = await verifyChain(tmpFile);
      expect(r.ok).toBe(true);
      expect(r.lines).toBe(2);
    } finally {
      await fs.rm(tmpFile, { force: true });
    }
  });
});
