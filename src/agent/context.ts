import { encode } from 'gpt-tokenizer';
import type { Message } from './types.js';

/** 估算 messages 数组的总 token 数(粗略) */
export function estimateTokens(messages: Message[]): number {
  let total = 0;
  for (const m of messages) {
    const text = typeof m.content === 'string' ? m.content : '';
    total += encode(text).length + 4;
  }
  return total;
}

/** 是否需要压缩? */
export function shouldCompress(
  messages: Message[],
  maxContextTokens: number,
  thresholdMultiplier = 0.7,
): boolean {
  return estimateTokens(messages) > maxContextTokens * thresholdMultiplier;
}

function formatMessageForSummary(m: Message): string {
  const parts = [`[${m.role}]`];
  if (m.name) parts.push(`name=${m.name}`);
  if (m.tool_call_id) parts.push(`tool_call_id=${m.tool_call_id}`);
  if (m.content) parts.push(m.content);
  if (m.tool_calls?.length) {
    for (const tc of m.tool_calls) {
      parts.push(
        `[tool_call ${tc.id}] ${tc.function.name}(${tc.function.arguments})`,
      );
    }
  }
  return parts.join(' ');
}

/**
 * 压缩策略:
 *   保留:system + 最近 6 条
 *   中间:折成一条 summary 消息(由 summarizer LLM 生成)
 *   头尾:角色对齐
 */
export async function compress(
  messages: Message[],
  summarizer: (text: string) => Promise<string>,
): Promise<Message[]> {
  if (messages.length <= 7) return messages; // 不够折的,不动

  const system = messages.find((m) => m.role === 'system');
  const tail = messages.slice(-6);
  const middle = messages
    .filter((m) => m !== system && !tail.includes(m))
    .map(formatMessageForSummary)
    .join('\n');

  const summary = await summarizer(middle);
  const summaryMsg: Message = {
    role: 'user',
    content: `[Summary of earlier conversation]\n${summary}`,
  };

  const result: Message[] = [];
  if (system) result.push(system);
  result.push(summaryMsg);
  result.push(...tail);
  return result;
}
