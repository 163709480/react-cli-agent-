import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { genesisHash, nextHash } from './hashChain.js';
import type { AgentEvent } from '../agent/types.js';

/**
 * 审计事件 = 公字段(包/排序) + 业务字段(各类型不同)。
 *
 * 公字段:ts / sessionId / pid / seq / prevHash / hash。
 * 业务字段由 type 决定。`user_prompt` / `session_start` / `session_end` /
 * `llm_usage` / `user_confirm` 是新增的审计专用事件;
 * 其他 6 个 type(text_delta / tool_call_start / tool_call_end / phase /
 * done / error)与 AgentEvent 一一对应。
 */
export type AuditEvent = Record<string, unknown> & {
  ts: string;
  sessionId: string;
  pid: number;
  seq: number;
  prevHash: string;
  hash: string;
  type: string;
};

/**
 * 把 AgentEvent 转换成"业务字段剥离后的 payload"(不含 ts/sessionId/pid/seq/prevHash/hash)。
 * sink 负责填公字段 + 算 hash + 落盘。
 */
export function buildAuditEvent(
  base: { ts: string; sessionId: string; pid: number; seq: number; prevHash: string; hash: string },
  ev: Record<string, unknown>,
): AuditEvent {
  return { ...base, ...ev } as AuditEvent;
}

export interface AuditSink {
  /**
   * 接收"业务字段"事件(不含 ts/sessionId/pid/seq/prevHash/hash),
   * sink 内部填公字段 + 算 hash + 落盘/缓存。
   */
  emit(ev: Record<string, unknown>): void;
  /** 写 session_end 事件并 fsync。 */
  close(exitReason: 'normal' | 'error' | 'abort' | 'signal'): Promise<void>;
  /** 是否真的写盘(给 UI 展示用) */
  readonly enabled: boolean;
}

/**
 * 默认 no-op,所有 emit 立即返回,close 也 noop。
 * 用于 auditMode='off' 或未配置 auditSink 时。
 */
export class NoopSink implements AuditSink {
  readonly enabled = false;
  emit(): void { /* noop */ }
  async close(): Promise<void> { /* noop */ }
}

/**
 * 内存 sink,用于测试。事件按 emit 顺序进数组。
 */
export class InMemorySink implements AuditSink {
  readonly enabled = true;
  events: AuditEvent[] = [];
  private seq = 0;
  private prevHash: string | undefined;
  constructor(private readonly sessionId: string, private readonly pid: number) {}

  emit(ev: Record<string, unknown>): void {
    const seq = this.seq++;
    const ts = new Date().toISOString();
    const payloadWithoutHash = { ...ev, ts, sessionId: this.sessionId, pid: this.pid, seq };
    if (this.prevHash === undefined) {
      // 创世行:本行 prevHash = 创世;hash 自哈希
      const hash = genesisHash(payloadWithoutHash);
      const prevHash = hash;
      this.events.push({ ...payloadWithoutHash, prevHash, hash } as AuditEvent);
      this.prevHash = hash;
    } else {
      const hash = nextHash(this.prevHash, payloadWithoutHash);
      this.events.push({ ...payloadWithoutHash, prevHash: this.prevHash, hash } as AuditEvent);
      this.prevHash = hash;
    }
  }

  async close(exitReason: 'normal' | 'error' | 'abort' | 'signal'): Promise<void> {
    this.emit({ type: 'session_end', exitReason, totalEvents: this.events.length });
  }
}

/**
 * JSONL 文件 sink,同步 appendFileSync,合规 > 性能。
 * 失败兜底:首次写盘异常 → stderr 警告一次 → auditDisabled=true → 后续 noop。
 */
export class JsonlFileSink implements AuditSink {
  readonly enabled = true;
  private seq = 0;
  private prevHash: string | undefined;
  private auditDisabled = false;
  private warned = false;
  private dirEnsured = false;

  constructor(
    private readonly filePath: string,
    private readonly sessionId: string,
    private readonly pid: number,
  ) {}

  emit(ev: Record<string, unknown>): void {
    if (this.auditDisabled) return;
    const seq = this.seq++;
    const ts = new Date().toISOString();
    const base = { ...ev, ts, sessionId: this.sessionId, pid: this.pid, seq };
    let line: string;
    if (this.prevHash === undefined) {
      const hash = genesisHash(base);
      const full = { ...base, prevHash: hash, hash };
      line = JSON.stringify(full);
      this.prevHash = hash;
    } else {
      const hash = nextHash(this.prevHash, base);
      const full = { ...base, prevHash: this.prevHash, hash };
      line = JSON.stringify(full);
      this.prevHash = hash;
    }
    try {
      if (!this.dirEnsured) {
        try { mkdirSync(dirname(this.filePath), { recursive: true }); } catch { /* 静默,appendFileSync 会再报一次 */ }
        this.dirEnsured = true;
      }
      appendFileSync(this.filePath, line + '\n', 'utf8');
    } catch (err) {
      if (!this.warned) {
        process.stderr.write(`[audit] disabled: ${(err as Error).message}\n`);
        this.warned = true;
      }
      this.auditDisabled = true;
    }
  }

  async close(exitReason: 'normal' | 'error' | 'abort' | 'signal'): Promise<void> {
    this.emit({ type: 'session_end', exitReason, totalEvents: this.seq });
  }
}

/**
 * 工具:把 AgentEvent 转换成"去掉 type 后的业务字段 dict",sink 不假设业务 schema。
 */
export function agentEventToAuditFields(ev: AgentEvent): Record<string, unknown> {
  // 显式列字段,防止 AgentEvent 加新变体时漏审计
  switch (ev.type) {
    case 'text_delta': return { type: ev.type, delta: ev.delta };
    case 'tool_call_start': {
      const argsStr = ev.toolCall.function.arguments;
      try {
        return { type: ev.type, toolCallId: ev.toolCall.id, toolName: ev.toolCall.function.name, args: JSON.parse(argsStr), argsParseError: false };
      } catch {
        return { type: ev.type, toolCallId: ev.toolCall.id, toolName: ev.toolCall.function.name, args: argsStr, argsParseError: true };
      }
    }
    case 'tool_call_end': return { type: ev.type, toolCallId: ev.toolCallId, result: ev.result, resultBytes: Buffer.byteLength(ev.result, 'utf8'), isError: ev.result.startsWith('Error:') };
    case 'done': return { type: ev.type, finishReason: ev.finishReason, ...(ev.usage ? { usage: ev.usage } : {}) };
    case 'error': return { type: ev.type, error: ev.error };
    case 'phase': return { type: ev.type, phase: ev.phase, ...(ev.toolName ? { toolName: ev.toolName } : {}) };
    case 'user_confirm': return { type: ev.type, toolCallId: ev.toolCallId, toolName: ev.toolName, approved: ev.approved, latencyMs: ev.latencyMs };
    case 'llm_usage': return { type: ev.type, callIndex: ev.callIndex, promptTokens: ev.promptTokens, completionTokens: ev.completionTokens, finishReason: ev.finishReason };
  }
}

function parseArgs(s: string): { parsed: unknown; parseError: boolean } {
  // 保留为模块内部 helper(目前未使用;tool_call_start 直接 inline)
  try {
    return { parsed: JSON.parse(s), parseError: false };
  } catch {
    return { parsed: s, parseError: true };
  }
}
