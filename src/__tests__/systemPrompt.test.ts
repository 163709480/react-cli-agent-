import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../agent/systemPrompt.js';

describe('buildSystemPrompt', () => {
  it('返回非空字符串', () => {
    const s = buildSystemPrompt();
    expect(s.length).toBeGreaterThan(50);
  });

  it('包含 TodoWrite 使用建议', () => {
    const s = buildSystemPrompt();
    expect(s).toContain('TodoWrite');
  });

  it('包含 AskUserQuestion 使用建议', () => {
    const s = buildSystemPrompt();
    expect(s).toContain('AskUserQuestion');
  });

  it('指明 TodoWrite 不适用于 ≤3 步任务(避免误用)', () => {
    const s = buildSystemPrompt();
    expect(s).toMatch(/[<=]\s*3\s*步/);
  });
});
