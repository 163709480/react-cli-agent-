import { chatCompletionStream } from '../llm/stream.js';
import { findTool, getToolDescriptors } from './tools.js';
import { shouldCompress, compress } from './context.js';
import { SandboxError, ToolError } from '../safety/errors.js';
import type {
  Message,
  RunTurnInput,
  RunTurnResult,
} from './types.js';
import type { ChatCompletionTool } from 'openai/resources/chat/completions.js';

function stringifyResult(v: unknown): string {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function errorAsToolResult(toolName: string, err: unknown): string {
  if (err instanceof SandboxError) return `Error: ${err.message}`;
  if (err instanceof ToolError) return `Error: ${err.message}`;
  return `Error in ${toolName}: ${(err as Error).message ?? String(err)}`;
}

const RETRY_DELAYS = [500, 2000, 8000];

async function withRetry<T>(fn: () => Promise<T>, signal: AbortSignal, max = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < max; i++) {
    if (signal.aborted) throw new Error('aborted');
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (signal.aborted) throw e;
      await new Promise((r) => setTimeout(r, RETRY_DELAYS[i] ?? 8000));
    }
  }
  throw lastErr;
}

/**
 * 一次 ReAct 循环:处理一轮用户输入,可能产生多个 LLM ↔ tool 往返。
 */
export async function runTurn(input: RunTurnInput): Promise<RunTurnResult> {
  const {
    messages: initialMessages, tools, cwd, yolo,
    onEvent, onConfirm, signal, client, model, maxContextTokens, extraCtx,
  } = input;

  const messages: Message[] = [...initialMessages];
  const descriptors: ChatCompletionTool[] = getToolDescriptors(tools) as unknown as ChatCompletionTool[];

  if (shouldCompress(messages, maxContextTokens)) {
    onEvent({ type: 'text_delta', delta: '[context compressed]\n' });
    const compressed = await compress(messages, async (text) => text.slice(0, 200) + '...');
    messages.length = 0;
    messages.push(...compressed);
  }

  let finishReason: 'stop' | 'length' | 'abort' | 'error' = 'stop';

  try {
    let continueLoop = true;
    while (continueLoop) {
      if (signal.aborted) { finishReason = 'abort'; break; }

      let textBuf = '';
      const toolCalls: NonNullable<Message['tool_calls']> = [];
      let sawFinish = false;

      await withRetry(async () => {
        textBuf = '';
        toolCalls.length = 0;
        sawFinish = false;
        const gen = chatCompletionStream({ client, model, messages, tools: descriptors, signal });
        for await (const ev of gen) {
          if (ev.type === 'text_delta') {
            textBuf += ev.delta;
            onEvent(ev);
          } else if (ev.type === 'tool_call_start') {
            toolCalls.push(ev.toolCall);
            onEvent(ev);
          } else if (ev.type === 'done') {
            sawFinish = true;
            finishReason = ev.finishReason === 'length' ? 'length' : 'stop';
          } else if (ev.type === 'error') {
            throw new Error(ev.error);
          }
        }
        if (!sawFinish) finishReason = 'stop';
      }, signal);

      const assistantMsg: Message = {
        role: 'assistant',
        content: textBuf || null,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      };
      messages.push(assistantMsg);

      if (toolCalls.length === 0) {
        continueLoop = false;
        break;
      }

      for (const tc of toolCalls) {
        const tool = findTool(tools, tc.function.name);
        let resultStr: string;
        if (!tool) {
          resultStr = `Error: unknown tool "${tc.function.name}"`;
        } else {
          const effectiveSafety = yolo && tool.safety !== 'dangerous' ? 'safe' : tool.safety;
          let confirmed = true;
          if (effectiveSafety === 'confirm' || effectiveSafety === 'dangerous') {
            confirmed = await onConfirm(tc, tool);
          }
          if (!confirmed) {
            resultStr = 'User declined this action. Please try a different approach.';
          } else {
            let parsed: unknown;
            try { parsed = JSON.parse(tc.function.arguments); }
            catch (e) { resultStr = `Error: invalid JSON arguments: ${(e as Error).message}`; continue; }
            const v = tool.schema.safeParse(parsed);
            if (!v.success) {
              resultStr = `Error: invalid arguments: ${v.error.message}`;
            } else {
              try {
                const out = await tool.execute(v.data, {
                  cwd, abort: signal, confirmedByUser: true,
                  ...(extraCtx ?? {}),
                } as never);
                resultStr = stringifyResult(out);
              } catch (e) {
                resultStr = errorAsToolResult(tool.name, e);
              }
            }
          }
        }
        messages.push({ role: 'tool', tool_call_id: tc.id, content: resultStr });
        onEvent({ type: 'tool_call_end', toolCallId: tc.id, result: resultStr });
      }
    }
  } catch (e) {
    if (signal.aborted) finishReason = 'abort';
    else {
      finishReason = 'error';
      onEvent({ type: 'error', error: (e as Error).message });
    }
  }

  onEvent({ type: 'done', finishReason });
  return { messages, finishReason };
}
