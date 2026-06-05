import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  fallbackSummary,
  loadCompactInstructions,
  summarizeConversation,
} from '../agent/summarizer.js';
import type OpenAI from 'openai';

type CreateMock = ReturnType<typeof vi.fn>;

interface FakeClient {
  chat: { completions: { create: CreateMock } };
}

function makeClient(impl: (params: unknown) => Promise<unknown>): FakeClient {
  return {
    chat: {
      completions: {
        create: vi.fn(async (params: unknown) => impl(params)),
      },
    },
  };
}

describe('fallbackSummary', () => {
  it('空文本返回占位说明', () => {
    expect(fallbackSummary('')).toMatch(/no earlier conversation/i);
    expect(fallbackSummary('   \n  ')).toMatch(/no earlier conversation/i);
  });

  it('短文本原样返回', () => {
    expect(fallbackSummary('hello world')).toBe('hello world');
  });

  it('超长文本截断并加标记', () => {
    const long = 'x'.repeat(2000);
    const out = fallbackSummary(long, 500);
    expect(out.length).toBeLessThan(2000);
    expect(out).toMatch(/truncated/i);
    expect(out.startsWith('x')).toBe(true);
  });
});

describe('summarizeConversation', () => {
  it('调用 client.chat.completions.create 并把 system / user prompt 传过去', async () => {
    const captured: { params?: unknown; opts?: unknown } = {};
    const client = makeClient(async (params) => {
      captured.params = params;
      return { choices: [{ message: { content: '<<SUMMARY>>' } }] };
    });

    const out = await summarizeConversation({
      client: client as unknown as OpenAI,
      model: 'fake-model',
      text: 'something happened',
      signal: new AbortController().signal,
    });

    expect(out).toBe('<<SUMMARY>>');
    expect(client.chat.completions.create).toHaveBeenCalledTimes(1);

    const params = captured.params as {
      model: string;
      messages: Array<{ role: string; content: string }>;
      max_tokens?: number;
      temperature?: number;
    };
    expect(params.model).toBe('fake-model');
    expect(params.messages).toHaveLength(2);
    expect(params.messages[0].role).toBe('system');
    expect(params.messages[0].content).toMatch(/context compactor/i);
    expect(params.messages[1].role).toBe('user');
    expect(params.messages[1].content).toContain('something happened');
    expect(params.messages[1].content).toMatch(/Required output sections/);
    // 控制摘要长度,不能无界
    expect(params.max_tokens).toBe(1200);
    expect(params.temperature).toBe(0);
  });

  it('focus 和 compactInstructions 会被拼到 user prompt', async () => {
    const captured: { params?: unknown } = {};
    const client = makeClient(async (params) => {
      captured.params = params;
      return { choices: [{ message: { content: 'ok' } }] };
    });

    await summarizeConversation({
      client: client as unknown as OpenAI,
      model: 'm',
      text: 'body',
      signal: new AbortController().signal,
      focus: '保留未完成项',
      compactInstructions: '项目风格: 中文',
    });

    const userContent = (captured.params as {
      messages: Array<{ role: string; content: string }>;
    }).messages[1].content;
    expect(userContent).toContain('User compact focus');
    expect(userContent).toContain('保留未完成项');
    expect(userContent).toContain('Project compact instructions');
    expect(userContent).toContain('项目风格: 中文');
  });

  it('maxInputChars 限制输入文本', async () => {
    const captured: { params?: unknown } = {};
    const client = makeClient(async (params) => {
      captured.params = params;
      return { choices: [{ message: { content: 'ok' } }] };
    });

    const big = 'A'.repeat(10_000);
    await summarizeConversation({
      client: client as unknown as OpenAI,
      model: 'm',
      text: big,
      signal: new AbortController().signal,
      maxInputChars: 200,
    });

    const userContent = (captured.params as {
      messages: Array<{ role: string; content: string }>;
    }).messages[1].content;
    // 截断后必须包含 truncation 标记
    expect(userContent).toMatch(/truncated before summarization/i);
    // 不能把 1 万字符全塞进去
    expect(userContent.length).toBeLessThan(2_000);
  });

  it('LLM 返回空内容时回退 fallbackSummary', async () => {
    const client = makeClient(async () => ({ choices: [{ message: { content: '' } }] }));

    const out = await summarizeConversation({
      client: client as unknown as OpenAI,
      model: 'm',
      text: 'X'.repeat(50),
      signal: new AbortController().signal,
    });

    expect(out).toBe('X'.repeat(50));
  });

  it('LLM 抛错时,错误向上抛出(由 loop 决定是否 fallback)', async () => {
    const client = makeClient(async () => {
      throw new Error('network down');
    });

    await expect(
      summarizeConversation({
        client: client as unknown as OpenAI,
        model: 'm',
        text: 'x',
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/network down/);
  });
});

describe('loadCompactInstructions', () => {
  const tmpCwds: string[] = [];
  afterEach(async () => {
    await Promise.all(
      tmpCwds.splice(0).map((d) => rm(d, { recursive: true, force: true })),
    );
  });

  async function mkCwd(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'agent-compact-'));
    tmpCwds.push(dir);
    return dir;
  }

  it('两个文件都缺失时返回空字符串', async () => {
    const cwd = await mkCwd();
    expect(await loadCompactInstructions(cwd)).toBe('');
  });

  it('只存在 AGENT.md 时,只读它', async () => {
    const cwd = await mkCwd();
    await writeFile(path.join(cwd, 'AGENT.md'), '保持中文回复', 'utf-8');
    const out = await loadCompactInstructions(cwd);
    expect(out).toContain('AGENT.md');
    expect(out).toContain('保持中文回复');
    expect(out).not.toContain('compact.md');
  });

  it('只存在 .agent/compact.md 时,只读它', async () => {
    const cwd = await mkCwd();
    await mkdir(path.join(cwd, '.agent'), { recursive: true });
    await writeFile(path.join(cwd, '.agent', 'compact.md'), 'preserve tests', 'utf-8');
    const out = await loadCompactInstructions(cwd);
    expect(out).toContain('compact.md');
    expect(out).toContain('preserve tests');
    expect(out).not.toContain('AGENT.md');
  });

  it('两个文件都存在时,两个 section 都拼进去', async () => {
    const cwd = await mkCwd();
    await writeFile(path.join(cwd, 'AGENT.md'), 'A 指令', 'utf-8');
    await mkdir(path.join(cwd, '.agent'), { recursive: true });
    await writeFile(path.join(cwd, '.agent', 'compact.md'), 'B 指令', 'utf-8');
    const out = await loadCompactInstructions(cwd);
    expect(out).toContain('AGENT.md');
    expect(out).toContain('A 指令');
    expect(out).toContain('compact.md');
    expect(out).toContain('B 指令');
    // AGENT.md 出现在前
    expect(out.indexOf('AGENT.md')).toBeLessThan(out.indexOf('compact.md'));
  });

  it('空文件不写入 section', async () => {
    const cwd = await mkCwd();
    await writeFile(path.join(cwd, 'AGENT.md'), '   \n  ', 'utf-8');
    expect(await loadCompactInstructions(cwd)).toBe('');
  });
});
