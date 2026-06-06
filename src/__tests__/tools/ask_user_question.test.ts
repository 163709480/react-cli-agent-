import { describe, it, expect } from 'vitest';
import { askUserQuestionTool } from '../../tools/ask_user_question.js';
import { createSessionState } from '../../agent/sessionState.js';
import type { ToolCtx } from '../../agent/types.js';

function makeCtx(opts: { answer?: string | string[] } = {}): {
  ctx: ToolCtx;
  callLog: Array<{ question: string; options: string[]; multiSelect: boolean }>;
} {
  const callLog: Array<{ question: string; options: string[]; multiSelect: boolean }> = [];
  const sessionState = createSessionState();
  const onAskUser = async (req: { question: string; options: string[]; multiSelect: boolean }) => {
    callLog.push(req);
    return opts.answer ?? req.options[0]!;
  };
  return {
    ctx: {
      cwd: '/tmp',
      abort: new AbortController().signal,
      confirmedByUser: true,
      sessionState,
      onAskUser,
    } as unknown as ToolCtx,
    callLog,
  };
}

describe('askUserQuestionTool', () => {
  it('execute 调 onAskUser 并把 answer 作为结果返回(单选)', async () => {
    const { ctx, callLog } = makeCtx({ answer: 'option-b' });
    const r = await askUserQuestionTool.execute(
      { question: '?', options: ['option-a', 'option-b'], multiSelect: false },
      ctx,
    );
    expect(callLog).toHaveLength(1);
    expect(callLog[0]).toEqual({ question: '?', options: ['option-a', 'option-b'], multiSelect: false });
    expect(r).toBe('option-b');
  });

  it('execute 支持多选,answer 是 string[]', async () => {
    const { ctx } = makeCtx({ answer: ['option-a', 'option-b'] });
    const r = await askUserQuestionTool.execute(
      { question: '?', options: ['option-a', 'option-b'], multiSelect: true },
      ctx,
    );
    expect(r).toEqual(['option-a', 'option-b']);
  });

  it('multiSelect 默认为 false', () => {
    const r = askUserQuestionTool.schema.safeParse({
      question: '?',
      options: ['a', 'b'],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.multiSelect).toBe(false);
  });

  it('schema 拒绝少于 2 个选项', () => {
    const r = askUserQuestionTool.schema.safeParse({ question: '?', options: ['only'] });
    expect(r.success).toBe(false);
  });

  it('schema 拒绝多于 4 个选项', () => {
    const r = askUserQuestionTool.schema.safeParse({
      question: '?',
      options: ['a', 'b', 'c', 'd', 'e'],
    });
    expect(r.success).toBe(false);
  });
});
