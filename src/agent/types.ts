import type { ZodType, ZodTypeDef } from 'zod';
import type { AuditSink } from '../audit/sink.js';

/** LLM API 返回的原始消息角色 */
export type Role = 'system' | 'user' | 'assistant' | 'tool';

/** 工具描述(给 LLM 看) */
export interface ToolDescriptor {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>; // JSON Schema
  };
}

/**
 * 工具定义(开发者写)。
 * schema 是 zod schema,参数化为 input/output 双类型位:
 *   - 第 1 个泛型 = output(I) — execute 拿到的
 *   - 第 3 个泛型 = input(In) — 外部调用方传进来的
 * 默认 I=In(常见情形),需要支持 .default() 的工具可显式分开
 * (如 In={max_results?: number}, I={max_results: number})。
 */
export interface ToolDef<I = unknown, In = I> {
  name: string;
  description: string;
  safety: 'safe' | 'confirm' | 'dangerous';
  schema: ZodType<I, ZodTypeDef, In>;
  execute(input: I, ctx: ToolCtx): Promise<unknown>;
}

/** 工具执行上下文 */
export interface ToolCtx {
  cwd: string;
  abort: AbortSignal;
  confirmedByUser: boolean;
  /** 可选扩展:由 loop 注入,工具按需读取 */
  writeableExts?: string[];
  allowMutations?: boolean;
}

/** 消息(OpenAI Chat Completions 风格) */
export interface Message {
  role: Role;
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

/** 一次工具调用(LLM 发起) */
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

/** Loop 推给 UI 的事件 */
export type AgentEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_call_start'; toolCall: ToolCall }
  | { type: 'tool_call_end'; toolCallId: string; result: string; error?: string }
  | { type: 'done'; finishReason: 'stop' | 'length' | 'abort' | 'error'; usage?: { promptTokens: number; completionTokens: number } }
  | { type: 'error'; error: string }
  | { type: 'phase'; phase: 'thinking' | 'executing' | 'idle'; toolName?: string }
  | { type: 'user_confirm'; toolCallId: string; toolName: string; approved: boolean; latencyMs: number }
  | { type: 'llm_usage'; callIndex: number; promptTokens: number; completionTokens: number; finishReason: string };

/** Loop 输入 */
export interface RunTurnInput {
  messages: Message[];
  tools: ToolDef[];
  cwd: string;
  yolo: boolean;
  onEvent: (e: AgentEvent) => void;
  onConfirm: (toolCall: ToolCall, tool: ToolDef) => Promise<boolean>;
  signal: AbortSignal;
  // 由 cli/loop 注入的实际依赖
  client: import('openai').default;
  model: string;
  maxContextTokens: number;
  /** 透传给 ToolCtx 的额外字段,如 writeableExts / allowMutations */
  extraCtx?: Record<string, unknown>;
  /** 可选审计 sink;若提供,loop 会把每条事件转发一份给 sink(配合合规审计) */
  auditSink?: AuditSink;
  /** 可选 LLM token 用量回调(每轮 LLM 调用结束时触发,供审计 sink 落 llm_usage 事件) */
  onUsage?: (u: { promptTokens: number; completionTokens: number; finishReason: string }) => void;
}

/** Loop 输出 */
export interface RunTurnResult {
  messages: Message[];
  finishReason: 'stop' | 'length' | 'abort' | 'error';
}
