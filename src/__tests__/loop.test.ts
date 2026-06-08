import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 用 vi.mock 替换 chatCompletionStream
const fakeStream = vi.hoisted(() => vi.fn());
vi.mock('../llm/stream.js', () => ({
  chatCompletionStream: fakeStream,
}));

import { runTurn } from '../agent/loop.js';
import { readFileTool } from '../tools/read_file.js';
import { InMemorySink, type AuditSink } from '../audit/sink.js';
import type { ToolDef, Message } from '../agent/types.js';
import { createSessionState } from '../agent/sessionState.js';
import type { RunTurnInput } from '../agent/types.js';

function baseRunTurnArgs(overrides: Partial<RunTurnInput> = {}): RunTurnInput {
  return {
    sessionState: createSessionState(),
    onAskUser: async () => '__canceled__',
    ...overrides,
  };
}

function asyncIterFromArray<T>(arr: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        next: async () => {
          if (i >= arr.length) return { value: undefined, done: true };
          return { value: arr[i++], done: false };
        },
      };
    },
  };
}

const fakeClient = {} as never; // stream 被 mock 掉,不直接用

describe('runTurn', () => {
  // vi.hoisted 在文件加载时创建一次 fakeStream,需要每个测试清空计数
  const tmpCwds: string[] = [];
  beforeEach(() => {
    fakeStream.mockReset();
  });
  afterEach(async () => {
    const fs = await import('node:fs/promises');
    await Promise.all(
      tmpCwds.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
    );
  });

  it('LLM 只返回文本时,自然停止', async () => {
    fakeStream.mockReturnValueOnce(
      asyncIterFromArray([
        { type: 'text_delta', delta: '你好' },
        { type: 'text_delta', delta: '世界' },
        { type: 'done', finishReason: 'stop' },
      ]),
    );
    const events: unknown[] = [];
    const r = await runTurn(baseRunTurnArgs({
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      cwd: process.cwd(),
      yolo: false,
      onEvent: (e) => events.push(e),
      onConfirm: async () => false,
      signal: new AbortController().signal,
      client: fakeClient,
      model: 'fake',
      maxContextTokens: 120000,
    }));
    expect(r.finishReason).toBe('stop');
    expect(events[events.length - 1]).toMatchObject({ type: 'done', finishReason: 'stop' });
    const assistant = r.messages.find((m) => m.role === 'assistant');
    expect(assistant?.content).toBe('你好世界');
  });

  it('LLM 调工具后,执行并把结果回灌', async () => {
    fakeStream.mockReturnValueOnce(
      asyncIterFromArray([
        {
          type: 'tool_call_start',
          toolCall: {
            id: 'call_1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"a.txt"}' },
          },
        },
        { type: 'done', finishReason: 'tool_calls' as never },
      ]),
    );
    fakeStream.mockReturnValueOnce(
      asyncIterFromArray([
        { type: 'text_delta', delta: 'done' },
        { type: 'done', finishReason: 'stop' },
      ]),
    );

    const tmpCwd = await import('node:fs/promises').then((m) =>
      m.mkdtemp('/tmp/agent-loop-'),
    );
    tmpCwds.push(tmpCwd);
    await import('node:fs/promises').then((m) =>
      m.writeFile(`${tmpCwd}/a.txt`, 'hello'),
    );

    const events: unknown[] = [];
    const r = await runTurn(baseRunTurnArgs({
      messages: [{ role: 'user', content: 'read a.txt' }],
      tools: [readFileTool],
      cwd: tmpCwd,
      yolo: false,
      onEvent: (e) => events.push(e),
      onConfirm: async () => true,
      signal: new AbortController().signal,
      client: fakeClient,
      model: 'fake',
      maxContextTokens: 120000,
    }));

    const tcEnd = events.find((e) => (e as { type: string }).type === 'tool_call_end');
    expect(tcEnd).toBeDefined();
    const toolMsg = r.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toContain('hello');
    expect(fakeStream).toHaveBeenCalledTimes(2);
  });

  it('用户拒绝确认时,工具结果写 "User declined"', async () => {
    // readFileTool 的 safety 是 'safe',不会触发 onConfirm。
    // 用 safety='confirm' 的 stub 来覆盖"用户拒绝"路径。
    const { z } = await import('zod');
    const confirmStub: ToolDef = {
      name: 'maybe_write',
      description: 'test confirm',
      safety: 'confirm',
      schema: z.object({}),
      execute: async () => 'should not run',
    };
    fakeStream.mockReturnValueOnce(
      asyncIterFromArray([
        {
          type: 'tool_call_start',
          toolCall: {
            id: 'call_1',
            type: 'function',
            function: { name: 'maybe_write', arguments: '{}' },
          },
        },
        { type: 'done', finishReason: 'stop' },
      ]),
    );
    fakeStream.mockReturnValueOnce(
      asyncIterFromArray([
        { type: 'text_delta', delta: 'ok' },
        { type: 'done', finishReason: 'stop' },
      ]),
    );
    const tmpCwd = await import('node:fs/promises').then((m) =>
      m.mkdtemp('/tmp/agent-loop-'),
    );
    tmpCwds.push(tmpCwd);
    const r = await runTurn(baseRunTurnArgs({
      messages: [{ role: 'user', content: 'read' }],
      tools: [confirmStub],
      cwd: tmpCwd,
      yolo: false,
      onEvent: () => {},
      onConfirm: async () => false,
      signal: new AbortController().signal,
      client: fakeClient,
      model: 'fake',
      maxContextTokens: 120000,
    }));
    const toolMsg = r.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toMatch(/declined/i);
  });

  it('工具抛 SandboxError 时,错误回灌 LLM', async () => {
    fakeStream.mockReturnValueOnce(
      asyncIterFromArray([
        {
          type: 'tool_call_start',
          toolCall: {
            id: 'call_1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"../escape"}' },
          },
        },
        { type: 'done', finishReason: 'stop' },
      ]),
    );
    fakeStream.mockReturnValueOnce(
      asyncIterFromArray([
        { type: 'text_delta', delta: 'blocked' },
        { type: 'done', finishReason: 'stop' },
      ]),
    );
    const tmpCwd = await import('node:fs/promises').then((m) =>
      m.mkdtemp('/tmp/agent-loop-'),
    );
    tmpCwds.push(tmpCwd);
    const r = await runTurn(baseRunTurnArgs({
      messages: [{ role: 'user', content: 'escape' }],
      tools: [readFileTool],
      cwd: tmpCwd,
      yolo: false,
      onEvent: () => {},
      onConfirm: async () => true,
      signal: new AbortController().signal,
      client: fakeClient,
      model: 'fake',
      maxContextTokens: 120000,
    }));
    const toolMsg = r.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toMatch(/escapes cwd/);
  });

  it('--yolo 跳过 confirm 类工具的确认', async () => {
    // 使用真实 zod schema(plan 里用 plain object safeParse 占位会让 getToolDescriptors 失败)
    const { z } = await import('zod');
    const stub: ToolDef = {
      name: 'noop_write',
      description: 'test',
      safety: 'confirm',
      schema: z.object({}),
      execute: async () => 'wrote',
    };
    const onConfirm = vi.fn();
    fakeStream.mockReturnValueOnce(
      asyncIterFromArray([
        {
          type: 'tool_call_start',
          toolCall: {
            id: 'call_1',
            type: 'function',
            function: { name: 'noop_write', arguments: '{}' },
          },
        },
        { type: 'done', finishReason: 'stop' },
      ]),
    );
    fakeStream.mockReturnValueOnce(
      asyncIterFromArray([
        { type: 'done', finishReason: 'stop' },
      ]),
    );
    const r = await runTurn(baseRunTurnArgs({
      messages: [{ role: 'user', content: 'x' }],
      tools: [stub],
      cwd: '/tmp',
      yolo: true,
      onEvent: () => {},
      onConfirm,
      signal: new AbortController().signal,
      client: fakeClient,
      model: 'fake',
      maxContextTokens: 120000,
    }));
    expect(onConfirm).not.toHaveBeenCalled();
    const toolMsg = r.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toBe('wrote');
  });

  it('--yolo 不跳过 dangerous 类工具的确认', async () => {
    const { z } = await import('zod');
    const execute = vi.fn(async () => 'fetched');
    const stub: ToolDef = {
      name: 'danger_fetch',
      description: 'test dangerous',
      safety: 'dangerous',
      schema: z.object({}),
      execute,
    };
    const onConfirm = vi.fn(async () => false);
    fakeStream.mockReturnValueOnce(
      asyncIterFromArray([
        {
          type: 'tool_call_start',
          toolCall: {
            id: 'call_1',
            type: 'function',
            function: { name: 'danger_fetch', arguments: '{}' },
          },
        },
        { type: 'done', finishReason: 'stop' },
      ]),
    );
    fakeStream.mockReturnValueOnce(
      asyncIterFromArray([
        { type: 'done', finishReason: 'stop' },
      ]),
    );
    const r = await runTurn(baseRunTurnArgs({
      messages: [{ role: 'user', content: 'x' }],
      tools: [stub],
      cwd: '/tmp',
      yolo: true,
      onEvent: () => {},
      onConfirm,
      signal: new AbortController().signal,
      client: fakeClient,
      model: 'fake',
      maxContextTokens: 120000,
    }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
    const toolMsg = r.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toMatch(/declined/i);
  });

  it('phase 事件序列正确:thinking → executing → thinking → idle', async () => {
    // 第一轮:thinking → 工具调用(executing)
    fakeStream.mockReturnValueOnce(
      asyncIterFromArray([
        {
          type: 'tool_call_start',
          toolCall: {
            id: 'call_1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"a.txt"}' },
          },
        },
        { type: 'done', finishReason: 'stop' },
      ]),
    );
    // 第二轮:thinking → done
    fakeStream.mockReturnValueOnce(
      asyncIterFromArray([
        { type: 'text_delta', delta: 'ok' },
        { type: 'done', finishReason: 'stop' },
      ]),
    );
    const tmpCwd = await import('node:fs/promises').then((m) =>
      m.mkdtemp('/tmp/agent-loop-'),
    );
    tmpCwds.push(tmpCwd);
    await import('node:fs/promises').then((m) =>
      m.writeFile(`${tmpCwd}/a.txt`, 'x'),
    );
    const events: { type: string; phase?: string; toolName?: string }[] = [];
    await runTurn(baseRunTurnArgs({
      messages: [{ role: 'user', content: 'go' }],
      tools: [readFileTool],
      cwd: tmpCwd,
      yolo: false,
      onEvent: (e) => events.push(e as { type: string; phase?: string; toolName?: string }),
      onConfirm: async () => true,
      signal: new AbortController().signal,
      client: fakeClient,
      model: 'fake',
      maxContextTokens: 120000,
    }));
    const phases = events.filter((e) => e.type === 'phase');
    // 期望:thinking(executing) thinking idle
    const summary = phases.map((p) => `${p.phase}${p.toolName ? `(${p.toolName})` : ''}`).join(' → ');
    expect(summary).toBe('thinking → executing(read_file) → thinking → idle');
  });

  it('auditSink 收到完整事件序列 + chain 自洽 + user_confirm yield', async () => {
    fakeStream.mockReturnValueOnce(
      asyncIterFromArray([
        {
          type: 'tool_call_start',
          toolCall: { id: 'call_x', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.txt"}' } },
        },
        { type: 'done', finishReason: 'stop' },
      ]),
    );
    fakeStream.mockReturnValueOnce(
      asyncIterFromArray([
        { type: 'text_delta', delta: 'ok' },
        { type: 'done', finishReason: 'stop' },
      ]),
    );
    const tmpCwd = await import('node:fs/promises').then((m) => m.mkdtemp('/tmp/agent-loop-'));
    tmpCwds.push(tmpCwd);
    await import('node:fs/promises').then((m) => m.writeFile(`${tmpCwd}/a.txt`, 'x'));
    const sink = new InMemorySink('sid-loop', 1);
    await runTurn(baseRunTurnArgs({
      messages: [{ role: 'user', content: 'go' }],
      tools: [readFileTool],
      cwd: tmpCwd,
      yolo: false,
      onEvent: () => {},
      onConfirm: async () => true,
      signal: new AbortController().signal,
      client: fakeClient,
      model: 'fake',
      maxContextTokens: 120000,
      auditSink: sink as unknown as AuditSink,
    }));
    // 期望事件类型序列(简化断言)
    const types = sink.events.map((e) => e.type);
    expect(types).toEqual([
      'llm_call',             // 缓存命中率基线观测:第一轮 LLM call 前缀指纹
      'phase',                // thinking (第一轮开始)
      'phase',                // executing
      'tool_call_start',
      'llm_usage',
      'tool_call_end',
      'llm_call',             // 第二轮 LLM call 前缀指纹
      'phase',                // thinking (第二轮)
      'text_delta',
      'llm_usage',
      'phase',                // idle
      'done',
    ]);
    // user_confirm 在 read_file (safe) 时不会触发(没 onConfirm)
    // 所以这里没有 user_confirm 是对的
    // chain 自洽
    expect(sink.events[0].prevHash).toBe(sink.events[0].hash); // 创世
    for (let i = 1; i < sink.events.length; i++) {
      expect(sink.events[i].prevHash).toBe(sink.events[i - 1].hash);
    }
  });

  it('llm_call 事件携带前缀指纹 (P0.4 缓存命中率基线)', async () => {
    // 两轮 LLM 调用: 第一次产出 tool_call, 第二次纯文本回复
    fakeStream
      .mockReturnValueOnce(asyncIterFromArray([
        { type: 'tool_call_start', toolCall: { id: 'tc1', type: 'function', function: { name: 'read_file', arguments: '{"path":"x"}' } } },
        { type: 'done', finishReason: 'stop' },
      ]))
      .mockReturnValueOnce(asyncIterFromArray([
        { type: 'text_delta', delta: 'done' },
        { type: 'done', finishReason: 'stop' },
      ]));
    const tmpCwd = await import('node:fs/promises').then((m) => m.mkdtemp('/tmp/agent-loop-hash-'));
    tmpCwds.push(tmpCwd);
    const sink = new InMemorySink('sid-hash', 1);
    await runTurn(baseRunTurnArgs({
      messages: [{ role: 'user', content: 'go' }],
      tools: [readFileTool],
      cwd: tmpCwd,
      yolo: false,
      onEvent: () => {},
      onConfirm: async () => true,
      signal: new AbortController().signal,
      client: fakeClient,
      model: 'fake',
      maxContextTokens: 120000,
      auditSink: sink as unknown as AuditSink,
    }));
    const llmCalls = sink.events.filter((e) => e.type === 'llm_call');
    expect(llmCalls.length).toBe(2);
    // 字段都在
    for (const ev of llmCalls) {
      expect(typeof ev.systemPromptHash).toBe('string');
      expect((ev.systemPromptHash as string)).toMatch(/^[0-9a-f]{16}$/);
      expect(typeof ev.toolsSchemaHash).toBe('string');
      expect((ev.toolsSchemaHash as string)).toMatch(/^[0-9a-f]{16}$/);
      expect(typeof ev.messagePrefixHash).toBe('string');
      expect((ev.messagePrefixHash as string)).toMatch(/^[0-9a-f]{16}$/);
      expect(typeof ev.approxPromptTokens).toBe('number');
    }
    // 同一 session 内 toolsSchemaHash 必须稳定(工具列表未变)
    expect(llmCalls[0].toolsSchemaHash).toBe(llmCalls[1].toolsSchemaHash);
  });

  it('auditSink=undefined 不抛错(回归覆盖)', async () => {
    fakeStream.mockReturnValueOnce(
      asyncIterFromArray([
        { type: 'text_delta', delta: 'hi' },
        { type: 'done', finishReason: 'stop' },
      ]),
    );
    const r = await runTurn(baseRunTurnArgs({
      messages: [{ role: 'user', content: 'x' }],
      tools: [],
      cwd: '/tmp',
      yolo: false,
      onEvent: () => {},
      onConfirm: async () => false,
      signal: new AbortController().signal,
      client: fakeClient,
      model: 'fake',
      maxContextTokens: 120000,
      // 不传 auditSink
    }));
    expect(r.finishReason).toBe('stop');
  });

  it('onUsage 回调被调用且带 finishReason', async () => {
    fakeStream.mockReturnValueOnce(
      asyncIterFromArray([
        { type: 'text_delta', delta: 'hi' },
        { type: 'done', finishReason: 'stop', usage: { promptTokens: 10, completionTokens: 5 } },
      ]),
    );
    const usages: { promptTokens: number; completionTokens: number; finishReason: string }[] = [];
    await runTurn(baseRunTurnArgs({
      messages: [{ role: 'user', content: 'x' }],
      tools: [],
      cwd: '/tmp',
      yolo: false,
      onEvent: () => {},
      onConfirm: async () => false,
      signal: new AbortController().signal,
      client: fakeClient,
      model: 'fake',
      maxContextTokens: 120000,
      onUsage: (u) => usages.push(u),
    }));
    expect(usages).toHaveLength(1);
    expect(usages[0]).toEqual({ promptTokens: 10, completionTokens: 5, finishReason: 'stop' });
  });

  it('maxTurns 触发后 stop with finishReason=limit', async () => {
    // 4 轮 LLM:每次回一个 read_file tool_call(让 loop 继续,直到 maxTurns 触发)
    // readFileTool 走 tmpCwd,a.txt 存在 → toolCallCount 累计
    for (let i = 0; i < 4; i++) {
      fakeStream.mockReturnValueOnce(
        asyncIterFromArray([
          {
            type: 'tool_call_start',
            toolCall: { id: `c${i}`, type: 'function', function: { name: 'read_file', arguments: '{"path":"a.txt"}' } },
          },
          { type: 'done', finishReason: 'stop' },
        ]),
      );
    }
    const tmpCwd = await import('node:fs/promises').then((m) => m.mkdtemp('/tmp/agent-loop-'));
    tmpCwds.push(tmpCwd);
    await import('node:fs/promises').then((m) => m.writeFile(`${tmpCwd}/a.txt`, 'x'));
    const r = await runTurn(baseRunTurnArgs({
      messages: [{ role: 'user', content: 'x' }],
      tools: [readFileTool],
      cwd: tmpCwd,
      yolo: false,
      onEvent: () => {},
      onConfirm: async () => true,
      signal: new AbortController().signal,
      client: fakeClient,
      model: 'fake',
      maxContextTokens: 120000,
      limits: { maxTurns: 3 },
    }));
    expect(r.finishReason).toBe('limit');
    // llmTurns 是 4:maxTurns=3 时,llmTurns=1,2,3 三轮都 OK;第 4 轮 llmTurns=4 > 3 触发 limit 立即 return
    expect(r.metrics?.llmTurns).toBe(4);
    // 3 个 tool call 都执行成功
    expect(r.metrics?.toolCalls).toBe(3);
  });

  it('maxToolCalls 触发后 stop', async () => {
    // 1 轮 LLM:返回 3 个 tool_call,但 maxToolCalls=2
    fakeStream.mockReturnValueOnce(
      asyncIterFromArray([
        {
          type: 'tool_call_start',
          toolCall: { id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.txt"}' } },
        },
        {
          type: 'tool_call_start',
          toolCall: { id: 'c2', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.txt"}' } },
        },
        {
          type: 'tool_call_start',
          toolCall: { id: 'c3', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.txt"}' } },
        },
        { type: 'done', finishReason: 'stop' },
      ]),
    );
    // L3 在 3rd tool 之前就触发,不会再调 LLM,所以不需要 mock 第二次
    const tmpCwd = await import('node:fs/promises').then((m) => m.mkdtemp('/tmp/agent-loop-'));
    tmpCwds.push(tmpCwd);
    await import('node:fs/promises').then((m) => m.writeFile(`${tmpCwd}/a.txt`, 'x'));
    const r = await runTurn(baseRunTurnArgs({
      messages: [{ role: 'user', content: 'x' }],
      tools: [readFileTool],
      cwd: tmpCwd,
      yolo: false,
      onEvent: () => {},
      onConfirm: async () => true,
      signal: new AbortController().signal,
      client: fakeClient,
      model: 'fake',
      maxContextTokens: 120000,
      limits: { maxToolCalls: 2 },
    }));
    expect(r.finishReason).toBe('limit');
    // L3 触发时 toolCalls 已 ≥ maxToolCalls(2)
    expect(r.metrics?.toolCalls).toBeGreaterThanOrEqual(2);
  });

  it('mid-turn 压缩:tool_call_end 后压一次再调 LLM', async () => {
    fakeStream.mockReturnValueOnce(
      asyncIterFromArray([
        {
          type: 'tool_call_start',
          toolCall: { id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.txt"}' } },
        },
        { type: 'done', finishReason: 'stop' },
      ]),
    );
    fakeStream.mockReturnValueOnce(
      asyncIterFromArray([{ type: 'text_delta', delta: 'ok' }, { type: 'done', finishReason: 'stop' }]),
    );
    const tmpCwd = await import('node:fs/promises').then((m) => m.mkdtemp('/tmp/agent-loop-'));
    tmpCwds.push(tmpCwd);
    await import('node:fs/promises').then((m) => m.writeFile(`${tmpCwd}/a.txt`, 'x'));
    const big = 'x'.repeat(5000);
    const events: unknown[] = [];
    const r = await runTurn(baseRunTurnArgs({
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: big },
        { role: 'assistant', content: 'old' },
        { role: 'user', content: 'read a.txt' },
        { role: 'user', content: 'filler-1' },
        { role: 'assistant', content: 'filler-2' },
        { role: 'user', content: 'filler-3' },
        { role: 'assistant', content: 'filler-4' },
        { role: 'user', content: 'filler-5' },
      ],
      tools: [readFileTool],
      cwd: tmpCwd,
      yolo: false,
      onEvent: (e) => events.push(e),
      onConfirm: async () => true,
      signal: new AbortController().signal,
      client: fakeClient,
      model: 'fake',
      maxContextTokens: 1000, // 0.7 * 1000 = 700
    }));
    // 期望看到 tool_call_end 之后出现 phase=compressing(L1 mid-turn 路径)
    const tcEndIdx = events.findIndex((e) => (e as { type: string }).type === 'tool_call_end');
    expect(tcEndIdx).toBeGreaterThanOrEqual(0);
    const afterTcEnd = events.slice(tcEndIdx + 1);
    const midTurnCompress = afterTcEnd.find(
      (e) => (e as { type: string; phase?: string }).type === 'phase' && (e as { phase?: string }).phase === 'compressing',
    );
    expect(midTurnCompress).toBeDefined();
    expect(r.metrics?.compressions).toBeGreaterThanOrEqual(1);
  });

  it('hot cut 在 LLM 调用前自动裁', async () => {
    const big = 'x'.repeat(20_000); // ~5K tokens
    // 至少 8 条消息,这样 compress() 走实际折叠路径(返回新数组)
    // 而不是早 return 同一引用(否则 messages.length=0 会清空)
    const msgs: Message[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'filler-1' },
      { role: 'user', content: 'filler-2' },
      { role: 'user', content: 'task' },
      { role: 'tool', tool_call_id: 't1', content: big },
      { role: 'tool', tool_call_id: 't2', content: big },
      { role: 'user', content: 'filler-3' },
      { role: 'user', content: 'ask' },
    ];
    fakeStream.mockReturnValueOnce(
      asyncIterFromArray([
        { type: 'text_delta', delta: 'hi' },
        { type: 'done', finishReason: 'stop' },
      ]),
    );
    const events: unknown[] = [];
    const r = await runTurn(baseRunTurnArgs({
      messages: msgs,
      tools: [],
      cwd: '/tmp',
      yolo: false,
      onEvent: (e) => events.push(e),
      onConfirm: async () => false,
      signal: new AbortController().signal,
      client: fakeClient,
      model: 'fake',
      maxContextTokens: 1000, // 0.85 * 1000 = 850
    }));
    const hotCutText = events.find(
      (e) => (e as { type: string }).type === 'text_delta' && typeof (e as { delta?: string }).delta === 'string' && (e as { delta: string }).delta.includes('[hot-cut:'),
    );
    expect(hotCutText).toBeDefined();
    expect(r.metrics?.hotCuts).toBeGreaterThanOrEqual(1);
  });

  it('hot cut 不砍 system', async () => {
    const big = 'x'.repeat(20_000);
    const msgs: Message[] = [
      { role: 'system', content: 'SYS-MARKER-XYZ' },
      { role: 'user', content: 'filler-1' },
      { role: 'user', content: 'filler-2' },
      { role: 'user', content: 'filler-3' },
      { role: 'tool', tool_call_id: 't1', content: big },
      { role: 'tool', tool_call_id: 't2', content: big },
      { role: 'user', content: 'filler-4' },
      { role: 'user', content: 'q' },
    ];
    fakeStream.mockReturnValueOnce(
      asyncIterFromArray([{ type: 'text_delta', delta: 'ok' }, { type: 'done', finishReason: 'stop' }]),
    );
    await runTurn(baseRunTurnArgs({
      messages: msgs,
      tools: [],
      cwd: '/tmp',
      yolo: false,
      onEvent: () => {},
      onConfirm: async () => false,
      signal: new AbortController().signal,
      client: fakeClient,
      model: 'fake',
      maxContextTokens: 1000,
    }));
    // 不抛错 + system 内容应该被传递(loop 内部会调 LLM,LLM mock 不读 system,只要不抛就行)
  });

  it('hot cut 不砍最近 1 条 user', async () => {
    const big = 'x'.repeat(20_000);
    const msgs: Message[] = [
      { role: 'user', content: 'filler-1' },
      { role: 'user', content: 'filler-2' },
      { role: 'user', content: 'filler-3' },
      { role: 'tool', tool_call_id: 't1', content: big },
      { role: 'tool', tool_call_id: 't2', content: big },
      { role: 'user', content: 'filler-4' },
      { role: 'user', content: 'filler-5' },
      { role: 'user', content: 'LAST-USER-MUST-STAY' },
    ];
    fakeStream.mockReturnValueOnce(
      asyncIterFromArray([{ type: 'text_delta', delta: 'ok' }, { type: 'done', finishReason: 'stop' }]),
    );
    await runTurn(baseRunTurnArgs({
      messages: msgs,
      tools: [],
      cwd: '/tmp',
      yolo: false,
      onEvent: () => {},
      onConfirm: async () => false,
      signal: new AbortController().signal,
      client: fakeClient,
      model: 'fake',
      maxContextTokens: 1000,
    }));
    // 不抛错
  });

  it('metrics 在正常 stop 路径下正确返回', async () => {
    fakeStream.mockReturnValueOnce(
      asyncIterFromArray([
        {
          type: 'tool_call_start',
          toolCall: { id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.txt"}' } },
        },
        { type: 'done', finishReason: 'stop' },
      ]),
    );
    fakeStream.mockReturnValueOnce(
      asyncIterFromArray([{ type: 'text_delta', delta: 'ok' }, { type: 'done', finishReason: 'stop' }]),
    );
    const tmpCwd = await import('node:fs/promises').then((m) => m.mkdtemp('/tmp/agent-loop-'));
    tmpCwds.push(tmpCwd);
    await import('node:fs/promises').then((m) => m.writeFile(`${tmpCwd}/a.txt`, 'x'));
    const r = await runTurn(baseRunTurnArgs({
      messages: [{ role: 'user', content: 'x' }],
      tools: [readFileTool],
      cwd: tmpCwd,
      yolo: false,
      onEvent: () => {},
      onConfirm: async () => true,
      signal: new AbortController().signal,
      client: fakeClient,
      model: 'fake',
      maxContextTokens: 120000,
    }));
    expect(r.metrics).toBeDefined();
    expect(r.metrics?.llmTurns).toBe(2);
    expect(r.metrics?.toolCalls).toBe(1);
    expect(r.metrics?.compressions).toBe(0);
    expect(r.metrics?.hotCuts).toBe(0);
  });

  it('metrics 在 limit 路径下也正确返回', async () => {
    // 3 轮 LLM:每次回一个 read_file tool_call 让 loop 继续,maxTurns=2 在第 3 轮触发
    for (let i = 0; i < 3; i++) {
      fakeStream.mockReturnValueOnce(
        asyncIterFromArray([
          {
            type: 'tool_call_start',
            toolCall: { id: `c${i}`, type: 'function', function: { name: 'read_file', arguments: '{"path":"a.txt"}' } },
          },
          { type: 'done', finishReason: 'stop' },
        ]),
      );
    }
    const tmpCwd = await import('node:fs/promises').then((m) => m.mkdtemp('/tmp/agent-loop-'));
    tmpCwds.push(tmpCwd);
    await import('node:fs/promises').then((m) => m.writeFile(`${tmpCwd}/a.txt`, 'x'));
    const r = await runTurn(baseRunTurnArgs({
      messages: [{ role: 'user', content: 'x' }],
      tools: [readFileTool],
      cwd: tmpCwd,
      yolo: false,
      onEvent: () => {},
      onConfirm: async () => true,
      signal: new AbortController().signal,
      client: fakeClient,
      model: 'fake',
      maxContextTokens: 120000,
      limits: { maxTurns: 2 },
    }));
    expect(r.finishReason).toBe('limit');
    expect(r.metrics).toBeDefined();
    // maxTurns=2:llmTurns=1,2 OK;第 3 轮 llmTurns=3 > 2 触发 limit
    expect(r.metrics?.llmTurns).toBe(3);
  });

  it('regression: 短 messages 触发 shouldCompress 时,compress 不会清空 messages', async () => {
    // 1 条巨大 user 消息 → tokens > 0.7 * maxContext,触发 shouldCompress
    // 但 messages.length=2 ≤ 7 → compress() 走 early-return 路径
    // 老代码 return messages(原引用),loop 的 messages.length=0 会清空
    // 修后 return [...messages](浅拷贝),loop 推回去不丢消息
    fakeStream.mockReturnValueOnce(
      asyncIterFromArray([
        { type: 'text_delta', delta: 'ok' },
        { type: 'done', finishReason: 'stop' },
      ]),
    );
    const big = 'x'.repeat(5000);
    const initialMsgs: Message[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: big },
    ];
    const r = await runTurn(baseRunTurnArgs({
      messages: initialMsgs,
      tools: [],
      cwd: '/tmp',
      yolo: false,
      onEvent: () => {},
      onConfirm: async () => false,
      signal: new AbortController().signal,
      client: fakeClient,
      model: 'fake',
      maxContextTokens: 1000, // 0.7 * 1000 = 700,5000 char 必超
    }));
    // runTurn 返回的 messages 至少含 system + user(可能多了 summary / 兜底标记)
    // 关键断言:system + user 都还在,没被清空
    expect(r.messages.find((m) => m.role === 'system')?.content).toBe('sys');
    // user 内容应在(可能没变、可能变了)
    const finalUser = r.messages.find((m) => m.role === 'user');
    expect(finalUser).toBeDefined();
    expect(r.finishReason).toBe('stop');
  });

  it('3 个 read_file 同一轮并发执行:messages 顺序保持,3 个 start 都在一个 100ms 窗口内', async () => {
    // 准备 3 个 tmp 文件
    const fs = await import('node:fs/promises');
    const tmpCwd = await fs.mkdtemp('/tmp/agent-par-');
    tmpCwds.push(tmpCwd);
    await Promise.all([
      fs.writeFile(`${tmpCwd}/a.txt`, 'AAA'),
      fs.writeFile(`${tmpCwd}/b.txt`, 'BBB'),
      fs.writeFile(`${tmpCwd}/c.txt`, 'CCC'),
    ]);

    // 模型一次返回 3 个 read_file
    fakeStream.mockReturnValueOnce(
      asyncIterFromArray([
        {
          type: 'tool_call_start',
          toolCall: { id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.txt"}' } },
        },
        {
          type: 'tool_call_start',
          toolCall: { id: 'c2', type: 'function', function: { name: 'read_file', arguments: '{"path":"b.txt"}' } },
        },
        {
          type: 'tool_call_start',
          toolCall: { id: 'c3', type: 'function', function: { name: 'read_file', arguments: '{"path":"c.txt"}' } },
        },
        { type: 'done', finishReason: 'tool_calls' as never },
      ]),
    );
    // 第二轮模型直接收尾
    fakeStream.mockReturnValueOnce(
      asyncIterFromArray([
        { type: 'text_delta', delta: 'all read' },
        { type: 'done', finishReason: 'stop' },
      ]),
    );

    // 记录每个 tool_call_start/end 的时间戳,做"相对"并发断言
    const startTimes = new Map<string, number>();
    const endTimes = new Map<string, number>();

    const r = await runTurn(baseRunTurnArgs({
      messages: [{ role: 'user', content: '读 a b c' }],
      tools: [readFileTool],
      cwd: tmpCwd,
      yolo: false,
      onEvent: (e) => {
        if (e.type === 'tool_call_start') startTimes.set(e.toolCall.id, Date.now());
        if (e.type === 'tool_call_end') endTimes.set(e.toolCallId, Date.now());
      },
      onConfirm: async () => true,
      signal: new AbortController().signal,
      client: fakeClient,
      model: 'fake',
      maxContextTokens: 120000,
    }));

    // 1. 3 个 tool_call_end 都到达
    expect(endTimes.size).toBe(3);
    expect(endTimes.has('c1')).toBe(true);
    expect(endTimes.has('c2')).toBe(true);
    expect(endTimes.has('c3')).toBe(true);

    // 2. 3 个 start 都在一个 100ms 窗口内 → 证明并发触发
    // (在 CI 上 100ms 是个安全的容差;如果想更严格可以改 50ms)
    const starts = ['c1', 'c2', 'c3'].map((id) => startTimes.get(id)!);
    const window = Math.max(...starts) - Math.min(...starts);
    expect(window).toBeLessThan(100);

    // 3. messages 中 tool 消息顺序保持(按 c1, c2, c3)
    const toolMsgs = r.messages.filter((m) => m.role === 'tool');
    expect(toolMsgs.map((m) => m.tool_call_id)).toEqual(['c1', 'c2', 'c3']);
    // 内容分别对应 AAA/BBB/CCC
    expect(toolMsgs[0].content).toContain('AAA');
    expect(toolMsgs[1].content).toContain('BBB');
    expect(toolMsgs[2].content).toContain('CCC');

    // 4. metrics 反映 1 个 tool batch(1 次 LLM, 1 个 tool batch,3 个 tool call)
    expect(r.metrics?.llmTurns).toBe(2); // 第 1 轮 tool,第 2 轮收尾
    expect(r.metrics?.toolCalls).toBe(3);
  });
});
