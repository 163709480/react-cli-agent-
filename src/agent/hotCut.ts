import { estimateTokens } from './context.js';
import type { Message } from './types.js';

const TRUNCATED_MARKER = '[truncated for context window]';

/**
 * 入 LLM 之前,如果 messages 超过 maxContextTokens,从 tail 砍 tool message
 * 直到 ≤ 0.85 * maxContextTokens。
 *
 * 不变量:
 *   - system 永远保留
 *   - 最近 1 条 user message 永远保留
 *   - 砍掉的 message 不 splice,只把 content 改成 marker(LLM 看历史不会断引用)
 *   - best-effort:即使砍完仍超限,也不抛错
 */
export function hotCut(
  messages: Message[],
  maxContextTokens: number,
): { messages: Message[]; cutCount: number } {
  const target = maxContextTokens * 0.85;
  if (estimateTokens(messages) <= target) {
    return { messages, cutCount: 0 };
  }

  // 找"最近 1 条 user"的索引;不越过它砍
  const lastUserIdx = lastIndexOfRole(messages, 'user');

  let cutCount = 0;
  const result: Message[] = messages.map((m, i) => {
    if (m.role !== 'tool') return m;
    // 跳过"最近 1 条 user"本身(不是 tool,但保险起见)
    if (i === lastUserIdx) return m;
    // 已经砍过的不重复计
    if (typeof m.content === 'string' && m.content === TRUNCATED_MARKER) {
      return m;
    }
    cutCount++;
    return { ...m, content: TRUNCATED_MARKER };
  });

  return { messages: result, cutCount };
}

function lastIndexOfRole(messages: Message[], role: Message['role']): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === role) return i;
  }
  return -1;
}
