import { chatCompletionStream } from '../llm/stream.js';
import { findTool, getToolDescriptors } from './tools.js';
import { shouldCompress, compress, estimateTokens } from './context.js';
import { partitionToolCalls } from './partition.js';
import { fallbackSummary, loadCompactInstructions, summarizeConversation } from './summarizer.js';
import { hotCut } from './hotCut.js';
import { SandboxError, ToolError } from '../safety/errors.js';
import type {
  Message,
  RunTurnInput,
  RunTurnResult,
  AgentEvent,
  ToolCall,
} from './types.js';
import type { ChatCompletionTool } from 'openai/resources/chat/completions.js';
import { agentEventToAuditFields } from '../audit/sink.js';

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
    auditSink, onUsage, sessionState, onAskUser,
  } = input;

  // 包装 onEvent:既通知 UI,也转一份给 auditSink(若提供)。
  // 4 处调用都改 emit(),单点维护。
  let usageCallIndex = 0;
  const emit = (ev: AgentEvent): void => {
    onEvent(ev);
    if (auditSink) auditSink.emit(agentEventToAuditFields(ev));
  };

  const messages: Message[] = [...initialMessages];
  const limits = input.limits ?? {};
  const maxTurns = limits.maxTurns ?? 12;
  const maxToolCalls = limits.maxToolCalls ?? 30;
  let llmTurns = 0;
  let toolCallCount = 0;
  let compressions = 0;
  let hotCuts = 0;
  const descriptors: ChatCompletionTool[] = getToolDescriptors(tools) as unknown as ChatCompletionTool[];

  if (shouldCompress(messages, maxContextTokens)) {
    emit({ type: 'phase', phase: 'compressing' });
    const before = estimateTokens(messages);
    const compactInstructions = await loadCompactInstructions(cwd);
    try {
      const compressed = await compress(messages, async (text) => {
        try {
          return await summarizeConversation({
            client,
            model,
            text,
            signal,
            compactInstructions,
            focus: 'Automatic context compaction before continuing the current user task.',
          });
        } catch (e) {
          if (signal.aborted) throw e;
          emit({ type: 'text_delta', delta: '[context compression fallback]\n' });
          return fallbackSummary(text);
        }
      });
      messages.length = 0;
      messages.push(...compressed);
      const after = estimateTokens(messages);
      compressions++;
      emit({ type: 'text_delta', delta: `[context compressed: ${before} → ${after} tokens]\n` });
    } catch (e) {
      emit({ type: 'text_delta', delta: `[context compression failed: ${(e as Error).message}]\n` });
    }
    emit({ type: 'phase', phase: 'thinking' });
  }

  let finishReason: 'stop' | 'length' | 'abort' | 'error' | 'limit' = 'stop';

  try {
    let continueLoop = true;
    while (continueLoop) {
      if (signal.aborted) { finishReason = 'abort'; break; }

      let textBuf = '';
      const toolCalls: NonNullable<Message['tool_calls']> = [];
      let sawFinish = false;
      let roundFinishReason: 'stop' | 'length' = 'stop';

      // L2: turn 数护栏
      llmTurns++;
      if (llmTurns > maxTurns) {
        const errMsg = `Reached maxTurns=${maxTurns}; stopping.`;
        emit({ type: 'error', error: errMsg });
        emit({ type: 'done', finishReason: 'limit' });
        return {
          messages,
          finishReason: 'limit',
          metrics: { llmTurns, toolCalls: toolCallCount, compressions, hotCuts },
        };
      }
      // L4: hot cut — 入 LLM 前最后一道闸
      if (estimateTokens(messages) > maxContextTokens) {
        const r = hotCut(messages, maxContextTokens);
        if (r.cutCount > 0) {
          hotCuts++;
          emit({ type: 'text_delta', delta: `[hot-cut: ${r.cutCount} messages truncated]\n` });
        }
      }

      await withRetry(async () => {
        textBuf = '';
        toolCalls.length = 0;
        sawFinish = false;
        roundFinishReason = 'stop';
        emit({ type: 'phase', phase: 'thinking' });
        const gen = chatCompletionStream({ client, model, messages, tools: descriptors, signal });
        for await (const ev of gen) {
          if (ev.type === 'text_delta') {
            textBuf += ev.delta;
            emit(ev);
          } else if (ev.type === 'tool_call_start') {
            toolCalls.push(ev.toolCall);
            emit({ type: 'phase', phase: 'executing', toolName: ev.toolCall.function.name });
            emit(ev);
          } else if (ev.type === 'done') {
            sawFinish = true;
            roundFinishReason = ev.finishReason === 'length' ? 'length' : 'stop';
            // 透传 usage 给审计(以及任何 onUsage 订阅方)
            if (onUsage) {
              onUsage({
                promptTokens: ev.usage?.promptTokens ?? 0,
                completionTokens: ev.usage?.completionTokens ?? 0,
                finishReason: roundFinishReason,
              });
            }
            if (auditSink) {
              usageCallIndex++;
              auditSink.emit({
                type: 'llm_usage',
                callIndex: usageCallIndex,
                promptTokens: ev.usage?.promptTokens ?? 0,
                completionTokens: ev.usage?.completionTokens ?? 0,
                finishReason: roundFinishReason,
              });
            }
          } else if (ev.type === 'error') {
            throw new Error(ev.error);
          }
        }
        if (!sawFinish) roundFinishReason = 'stop';
      }, signal);

      finishReason = roundFinishReason;

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

      // L3: tool 数护栏(在 batch 之前)
      if (toolCallCount >= maxToolCalls) {
        const errMsg = `Reached maxToolCalls=${maxToolCalls}; stopping.`;
        emit({ type: 'error', error: errMsg });
        emit({ type: 'done', finishReason: 'limit' });
        return {
          messages,
          finishReason: 'limit',
          metrics: { llmTurns, toolCalls: toolCallCount, compressions, hotCuts },
        };
      }

      // 把 toolCalls 按 concurrencySafe 切成批:
      //   - 连续 safe 批 → 批内 Promise.all 并行
      //   - unsafe 批(单元素)→ 串行
      // partition 自身不会抛错(未知工具按 unsafe 处理)
      const batches = partitionToolCalls(toolCalls, tools);

      for (const batch of batches) {
        // batch 内每个 tc 共享一个并发上限语义:fail-closed 的安全性已经由
        // partition 阶段保证(safe 工具无副作用),这里只负责执行。
        const results = await Promise.all(
          batch.map(async (tc): Promise<{ tc: ToolCall; resultStr: string }> => {
            toolCallCount++;
            const tool = findTool(tools, tc.function.name);
            let resultStr: string;
            if (!tool) {
              resultStr = `Error: unknown tool "${tc.function.name}"`;
            } else {
              const effectiveSafety = yolo && tool.safety !== 'dangerous' ? 'safe' : tool.safety;
              let confirmed = true;
              if (effectiveSafety === 'confirm' || effectiveSafety === 'dangerous') {
                const t0 = Date.now();
                confirmed = await onConfirm(tc, tool);
                emit({
                  type: 'user_confirm',
                  toolCallId: tc.id,
                  toolName: tc.function.name,
                  approved: confirmed,
                  latencyMs: Date.now() - t0,
                });
              }
              if (!confirmed) {
                resultStr = 'User declined this action. Please try a different approach.';
              } else {
                let parsed: unknown;
                try { parsed = JSON.parse(tc.function.arguments); }
                catch (e) { resultStr = `Error: invalid JSON arguments: ${(e as Error).message}`; return { tc, resultStr }; }
                const v = tool.schema.safeParse(parsed);
                if (!v.success) {
                  resultStr = `Error: invalid arguments: ${v.error.message}`;
                } else {
                  try {
                    const out = await tool.execute(v.data, {
                      cwd, abort: signal, confirmedByUser: true,
                      sessionState, onAskUser,
                      ...(extraCtx ?? {}),
                    } as never);
                    resultStr = stringifyResult(out);
                  } catch (e) {
                    resultStr = errorAsToolResult(tool.name, e);
                  }
                }
              }
            }
            return { tc, resultStr };
          }),
        );

        // 按 batch 原顺序 push messages + emit tool_call_end
        for (const { tc, resultStr } of results) {
          messages.push({ role: 'tool', tool_call_id: tc.id, content: resultStr });
          emit({ type: 'tool_call_end', toolCallId: tc.id, result: resultStr });
        }
      }

      // L1: mid-turn 增量压缩(整个 tool 批序列跑完后做一次,不在每个 batch 后做)
      if (shouldCompress(messages, maxContextTokens)) {
        emit({ type: 'phase', phase: 'compressing' });
        const before = estimateTokens(messages);
        const compactInstructions = await loadCompactInstructions(cwd);
        try {
          const compressed = await compress(messages, async (text) => {
            try {
              return await summarizeConversation({
                client, model, text, signal, compactInstructions,
                focus: 'Automatic context compaction before continuing the current user task.',
              });
            } catch (e) {
              if (signal.aborted) throw e;
              emit({ type: 'text_delta', delta: '[context compression fallback]\n' });
              return fallbackSummary(text);
            }
          });
          messages.length = 0;
          messages.push(...compressed);
          const after = estimateTokens(messages);
          compressions++;
          emit({ type: 'text_delta', delta: `[context compressed: ${before} → ${after} tokens]\n` });
        } catch (e) {
          emit({ type: 'text_delta', delta: `[context compression failed: ${(e as Error).message}]\n` });
        }
        emit({ type: 'phase', phase: 'executing' });
      }

      // L3 over-run: 一个 safe batch 内并发 N 个 tool 可能让 toolCallCount
      // 超过 maxToolCalls(pre-batch 检查只看 ≥,不预扣 batch.length)。
      // 这里捕获 over-run 并停止 outer while —— 否则下一轮还会再调 LLM。
      // 注意用 `>`(严格大于);恰好等于不算超额,继续走 pre-batch 检查路径。
      if (toolCallCount > maxToolCalls) {
        const errMsg = `Reached maxToolCalls=${maxToolCalls}; stopping.`;
        emit({ type: 'error', error: errMsg });
        emit({ type: 'done', finishReason: 'limit' });
        return {
          messages,
          finishReason: 'limit',
          metrics: { llmTurns, toolCalls: toolCallCount, compressions, hotCuts },
        };
      }
    }
  } catch (e) {
    if (signal.aborted) finishReason = 'abort';
    else {
      finishReason = 'error';
      emit({ type: 'error', error: (e as Error).message });
    }
  }

  emit({ type: 'phase', phase: 'idle' });
  emit({ type: 'done', finishReason });
  return {
    messages,
    finishReason,
    metrics: { llmTurns, toolCalls: toolCallCount, compressions, hotCuts },
  };
}
