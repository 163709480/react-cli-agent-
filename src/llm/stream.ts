import type OpenAI from 'openai';
import type { ChatCompletionTool, ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';
import type { AgentEvent, Message } from '../agent/types.js';

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

  for await (const chunk of stream) {
    if (input.signal.aborted) {
      yield { type: 'done', finishReason: 'abort' };
      return;
    }
    const choice = chunk.choices?.[0];
    if (!choice) continue;
    const delta = choice.delta;

    if (delta.content) {
      yield { type: 'text_delta', delta: delta.content };
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
