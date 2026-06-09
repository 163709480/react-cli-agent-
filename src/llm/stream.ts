import type OpenAI from 'openai';
import type { ChatCompletionTool, ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';
import type { AgentEvent, Message } from '../agent/types.js';
import { stripThinking } from './thinking.js';

interface StreamInput {
  client: OpenAI;
  model: string;
  messages: Message[];
  tools: ChatCompletionTool[];
  signal: AbortSignal;
}

/**
 * 把 OpenAI stream 包装成 AsyncIterable<AgentEvent>。
 * 处理:
 *   - text_delta 增量
 *   - tool_calls 增量拼接(同一个 index 的 args 增量追加)
 *   - finish_reason
 *   - usage(若有)
 */
export async function* chatCompletionStream(input: StreamInput): AsyncGenerator<AgentEvent> {
  const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
    model: input.model,
    messages: input.messages as ChatCompletionMessageParam[],
    stream: true,
    tools: input.tools.length > 0 ? input.tools : undefined,
  };
  let stream;
  try {
    stream = await input.client.chat.completions.create(params, { signal: input.signal });
  } catch (e) {
    yield { type: 'error', error: (e as Error).message };
    return;
  }

  // 按 tool_call index 累积 args
  const argsBuffer = new Map<number, string>();
  const callIds = new Map<number, string>();
  const callNames = new Map<number, string>();
  const flushed = new Set<number>();

  // thinking 块过滤 — 部分 provider(minimax 等)在 delta.content 里塞 ``。
  // 思路:用 buffer 累积 content 增量,只在 chunk 边界(`` 闭合 / finish_reason)flush,
  // 剥掉 thinking 后再 yield。这样不会因为单 chunk 切断 thinking 块而漏剥。
  let contentBuf = '';
  let emittedFromBuf = 0; // 已经 emit 的 contentBuf 长度(用于 slice)
  function* flushContentBuf(force = false): Generator<AgentEvent, void, void> {
    const since = contentBuf.slice(emittedFromBuf);
    if (!since) return;
    const OPEN = '<think>';
    const CLOSE = '</think>';
    const closeIdx = since.indexOf(CLOSE);
    const openIdx = since.indexOf(OPEN);
    // 优先处理"since 里同时有开和闭":用状态机一次性剥完
    if (openIdx >= 0 && closeIdx >= 0 && openIdx < closeIdx) {
      const safe = stripThinking(since);
      if (safe) yield { type: 'text_delta', delta: safe };
      emittedFromBuf += since.length;
      return;
    }
    if (openIdx >= 0) {
      // 只有开:emit 开之前的(正文),跳到 since 末尾(等待后续 chunk 带来 close)
      const before = since.slice(0, openIdx);
      if (before) yield { type: 'text_delta', delta: before };
      emittedFromBuf += since.length;
      return;
    }
    if (closeIdx >= 0) {
      // 只有闭:假定这是更早 chunk 开的 thinking 收尾,丢闭之前,emit 闭之后
      const after = since.slice(closeIdx + CLOSE.length);
      if (after) yield { type: 'text_delta', delta: after };
      emittedFromBuf += since.length;
      return;
    }
    // 都没出现,只 emit 到最后一个完整 token 边界(空格/换行),
    // 保留最后 50 字符作 lookahead 防 `` 跨 chunk。
    if (force) {
      const safe = stripThinking(since);
      if (safe) yield { type: 'text_delta', delta: safe };
      emittedFromBuf += since.length;
    } else {
      const LOOKAHEAD = 50;
      if (since.length > LOOKAHEAD) {
        const cut = since.length - LOOKAHEAD;
        let boundary = cut;
        const ch = since[boundary];
        if (ch && !/\s/.test(ch)) {
          const next = since.slice(cut).search(/\s/);
          boundary = next >= 0 ? cut + next + 1 : cut;
        }
        if (boundary > 0) {
          yield { type: 'text_delta', delta: since.slice(0, boundary) };
          emittedFromBuf += boundary;
        }
      }
    }
  }

  for await (const chunk of stream) {
    if (input.signal.aborted) {
      yield* flushContentBuf(true);
      yield { type: 'done', finishReason: 'abort' };
      return;
    }
    const choice = chunk.choices?.[0];
    if (!choice) continue;
    const delta = choice.delta;

    if (delta.content) {
      contentBuf += delta.content;
      yield* flushContentBuf(false);
    }

    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        if (tc.id) callIds.set(tc.index, tc.id);
        if (tc.function?.name) callNames.set(tc.index, tc.function.name);
        if (tc.function?.arguments) {
          argsBuffer.set(tc.index, (argsBuffer.get(tc.index) ?? '') + tc.function.arguments);
        }
      }
    }

    if (choice.finish_reason) {
      yield* flushContentBuf(true);
      for (const [idx, id] of callIds) {
        if (flushed.has(idx)) continue;
        flushed.add(idx);
        const name = callNames.get(idx) ?? '';
        const args = argsBuffer.get(idx) ?? '';
        yield {
          type: 'tool_call_start',
          toolCall: {
            id,
            type: 'function',
            function: { name, arguments: args },
          },
        };
      }
      const finish: 'stop' | 'length' = choice.finish_reason === 'length' ? 'length' : 'stop';
      const usage = chunk.usage
        ? { promptTokens: chunk.usage.prompt_tokens, completionTokens: chunk.usage.completion_tokens }
        : undefined;
      yield { type: 'done', finishReason: finish, usage };
    }
  }
}
