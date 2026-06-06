import type { ZodType, ZodTypeDef } from 'zod';
import type { AuditSink } from '../audit/sink.js';
import type { TodoItem } from './sessionState.js';

export interface AskUserRequest {
  question: string;
  options: string[];
  multiSelect: boolean;
}

export type AskUserAnswer = string | string[];

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
  /**
   * 此工具的多个并发调用是否安全(只读 / 无外部副作用)。
   * 未声明 = false(fail-closed)。声明为 true 表示:此工具对同一组 input
   * 多次执行,结果与单次执行一致,且不会影响其他并发工具。
   * 编排器会据此把"连续出现的 safe 工具"合成一批并行执行。
   */
  concurrencySafe?: boolean;
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
  /** session-level mutable state (todos, etc.); 同一个 runTurn 内共享 */
  sessionState: import('./sessionState.js').SessionState;
  /** AskUserQuestion 工具的交互回调;UI 必须实现,否则该工具 execute 抛错 */
  onAskUser: (req: AskUserRequest) => Promise<AskUserAnswer>;
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
  | { type: 'done'; finishReason: 'stop' | 'length' | 'abort' | 'error' | 'limit'; usage?: { promptTokens: number; completionTokens: number } }
  | { type: 'error'; error: string }
  | { type: 'phase'; phase: 'thinking' | 'executing' | 'idle' | 'compressing'; toolName?: string }
  | { type: 'user_confirm'; toolCallId: string; toolName: string; approved: boolean; latencyMs: number }
  | { type: 'todo_updated'; todos: TodoItem[] }
  | { type: 'ask_user'; callId: string; question: string; options: string[]; multiSelect: boolean }
  | { type: 'ask_user_resolved'; callId: string; answer: AskUserAnswer }
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
  /** 资源护栏;不传 → 默认 maxTurns=12, maxToolCalls=30 */
  limits?: {
    maxTurns?: number;
    maxToolCalls?: number;
  };
  /** session 状态: todos 等可写 store。loop 会自动注入到 ToolCtx.sessionState。 */
  sessionState: import('./sessionState.js').SessionState;
  /** AskUserQuestion 工具的交互回调。UI 必须实现,否则工具 execute 抛错。 */
  onAskUser: (req: AskUserRequest) => Promise<AskUserAnswer>;
}

/** Loop 输出 */
export interface RunTurnResult {
  messages: Message[];
  finishReason: 'stop' | 'length' | 'abort' | 'error' | 'limit';
  metrics?: {
    llmTurns: number;
    toolCalls: number;
    compressions: number;
    hotCuts: number;
  };
}
