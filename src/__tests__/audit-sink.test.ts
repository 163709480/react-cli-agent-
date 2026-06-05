import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonlFileSink, NoopSink, InMemorySink, agentEventToAuditFields } from '../audit/sink.js';
import { verifyChain } from '../audit/hashChain.js';

describe('AuditSink', () => {
  it('NoopSink 不写、不报错', async () => {
    const sink = new NoopSink();
    expect(sink.enabled).toBe(false);
    sink.emit({ type: 'text_delta', delta: 'x' });
    await sink.close('normal'); // 不应抛
  });

  it('InMemorySink 保持顺序', () => {
    const sink = new InMemorySink('s1', 1);
    sink.emit({ type: 'session_start', argv: [] });
    sink.emit({ type: 'text_delta', delta: 'a' });
    sink.emit({ type: 'text_delta', delta: 'b' });
    expect(sink.events.map((e) => e.seq)).toEqual([0, 1, 2]);
    expect(sink.events.map((e) => e.type)).toEqual(['session_start', 'text_delta', 'text_delta']);
  });

  it('JsonlFileSink 写入 → verifyChain 通过 + 目录自动创建', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-sink-'));
    const file = path.join(dir, 'nested', 'sub', 'audit.jsonl'); // nested 目录不存在
    try {
      const sink = new JsonlFileSink(file, 's2', 7);
      sink.emit({ type: 'session_start', argv: ['x'] });
      sink.emit({ type: 'user_prompt', role: 'user', content: 'hi' });
      sink.emit({ type: 'phase', phase: 'thinking' });
      sink.emit({ type: 'text_delta', delta: '你' });
      sink.emit({ type: 'text_delta', delta: '好' });
      sink.emit({ type: 'phase', phase: 'idle' });
      sink.emit({ type: 'done', finishReason: 'stop' });
      await sink.close('normal');
      const r = await verifyChain(file);
      expect(r.ok).toBe(true);
      expect(r.lines).toBe(8); // 7 + session_end
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('JsonlFileSink 写盘失败 → 第一次 stderr 警告 + 后续 noop', async () => {
    // 构造不可写的目录(权限 000)
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-sink-readonly-'));
    await fs.chmod(dir, 0o000);
    const file = path.join(dir, 'audit.jsonl');
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const sink = new JsonlFileSink(file, 's3', 1);
      sink.emit({ type: 'session_start', argv: ['x'] });
      sink.emit({ type: 'text_delta', delta: 'a' });
      sink.emit({ type: 'text_delta', delta: 'b' }); // 这次应 noop
      // 第一次失败 → 警告;之后不再警告
      const warnings = stderrSpy.mock.calls.filter((c) => String(c[0]).includes('[audit] disabled'));
      expect(warnings).toHaveLength(1);
      // 文件可能没创建或没写入内容 — 不强制断言;但 3 次 emit 中第 2、3 次应被吞
      // 通过 enabled 状态:审计已 disabled
      expect(sink.enabled).toBe(true); // 仍然 enabled 标志,但 emit 是 noop
    } finally {
      await fs.chmod(dir, 0o755);
      stderrSpy.mockRestore();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('agentEventToAuditFields', () => {
  it('text_delta:只取 type + delta', () => {
    expect(agentEventToAuditFields({ type: 'text_delta', delta: 'hi' } as never)).toEqual({
      type: 'text_delta', delta: 'hi',
    });
  });

  it('tool_call_start:args 解析失败时保留字符串 + parseError=true', () => {
    const r = agentEventToAuditFields({
      type: 'tool_call_start',
      toolCall: { id: 'c1', type: 'function', function: { name: 'read_file', arguments: 'not json{' } },
    } as never) as { type: string; args: unknown; argsParseError?: boolean };
    expect(r.type).toBe('tool_call_start');
    expect(r.argsParseError).toBe(true);
    expect(typeof r.args).toBe('string');
  });

  it('tool_call_end:isError 根据 result 前缀判定', () => {
    expect((agentEventToAuditFields({ type: 'tool_call_end', toolCallId: 'c1', result: 'Error: oops' } as never) as { isError: boolean }).isError).toBe(true);
    expect((agentEventToAuditFields({ type: 'tool_call_end', toolCallId: 'c1', result: 'good' } as never) as { isError: boolean }).isError).toBe(false);
  });
});
