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
  if (messages.length <= 7) return [...messages]; // 不够折的,不动;返回拷贝避免 caller 突变影响我们

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

/**
 * 手动/可观测压缩包装:在 compress() 的关键阶段发出 progress 事件,
 * 给 UI 提供阶段式进度条。
 *
 * 设计目标:
 * - 阶段粒度:estimating / loading_instructions / summarizing /
 *   rebuilding / done
 * - 失败时返回原 messages 并标 `fallback=true`,让 UI 知道走了 fallback
 * - 不引入新依赖,纯回调形式,便于测试
 */
export type CompactProgress =
  | { phase: 'estimating'; percent: 10; beforeTokens: number }
  | { phase: 'loading_instructions'; percent: 25 }
  | { phase: 'summarizing'; percent: 40 }
  | { phase: 'rebuilding'; percent: 75 }
  | { phase: 'done'; percent: 100; beforeTokens: number; afterTokens: number; fallback: boolean }
  | { phase: 'nothing_to_compact'; percent: 100; messageCount: number }
  | { phase: 'error'; percent: 100; error: string };

export interface CompactOptions {
  /** LLM 摘要函数(由 caller 注入,失败时 caller 可决定 fallback) */
  summarizer: (text: string) => Promise<string>;
  /** 加载 compact instructions 的函数(若传空,跳过该阶段) */
  loadInstructions?: () => Promise<string>;
  /** 进度回调,UI 端订阅 */
  onProgress?: (ev: CompactProgress) => void;
  /** 当 summarizer 抛错时,caller 提供的兜底摘要(可为 fallbackSummary) */
  fallback?: (text: string) => string;
}

/**
 * 跑一次手动压缩,带阶段进度。返回:
 *   { messages, fallback, nothing }
 *   - messages:压缩后的消息数组(若 nothing 则等于原 messages 拷贝)
 *   - fallback:是否走了 fallback 路径
 *   - nothing:消息太少,没有可压缩的
 */
export async function compactMessages(
  messages: Message[],
  opts: CompactOptions,
): Promise<{ messages: Message[]; fallback: boolean; nothing: boolean }> {
  const before = estimateTokens(messages);
  opts.onProgress?.({ phase: 'estimating', percent: 10, beforeTokens: before });

  // 消息太少 — 没有任何中间消息可折
  if (messages.length <= 7) {
    opts.onProgress?.({ phase: 'nothing_to_compact', percent: 100, messageCount: messages.length });
    return { messages: [...messages], fallback: false, nothing: true };
  }

  if (opts.loadInstructions) {
    opts.onProgress?.({ phase: 'loading_instructions', percent: 25 });
    await opts.loadInstructions();
  } else {
    opts.onProgress?.({ phase: 'loading_instructions', percent: 25 });
  }

  opts.onProgress?.({ phase: 'summarizing', percent: 40 });

  // 真正的 compress + 失败 fallback
  let fallbackUsed = false;
  const safeMessages: Message[] = await (async () => {
    try {
      return await compress(messages, opts.summarizer);
    } catch (e) {
      if (opts.fallback) {
        fallbackUsed = true;
        return await compress(messages, async (t) => opts.fallback!(t));
      }
      throw e;
    }
  })();

  opts.onProgress?.({ phase: 'rebuilding', percent: 75 });
  const after = estimateTokens(safeMessages);
  opts.onProgress?.({ phase: 'done', percent: 100, beforeTokens: before, afterTokens: after, fallback: fallbackUsed });
  return { messages: safeMessages, fallback: fallbackUsed, nothing: false };
}
