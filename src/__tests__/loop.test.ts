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
    const r = await runTurn({
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
    });
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
    const r = await runTurn({
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
    });

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
    const r = await runTurn({
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
    });
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
    const r = await runTurn({
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
    });
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
    const r = await runTurn({
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
    });
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
    const r = await runTurn({
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
    });
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
    await runTurn({
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
    });
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
    await runTurn({
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
    });
    // 期望事件类型序列(简化断言)
    const types = sink.events.map((e) => e.type);
    expect(types).toEqual([
      'phase',                // thinking (第一轮开始)
      'phase',                // executing
      'tool_call_start',
      'llm_usage',
      'tool_call_end',
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

  it('auditSink=undefined 不抛错(回归覆盖)', async () => {
    fakeStream.mockReturnValueOnce(
      asyncIterFromArray([
        { type: 'text_delta', delta: 'hi' },
        { type: 'done', finishReason: 'stop' },
      ]),
    );
    const r = await runTurn({
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
    });
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
    await runTurn({
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
    });
    expect(usages).toHaveLength(1);
    expect(usages[0]).toEqual({ promptTokens: 10, completionTokens: 5, finishReason: 'stop' });
  });
});
