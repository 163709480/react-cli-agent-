import type { ZodType } from 'zod';

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

/** 工具定义(开发者写) */
export interface ToolDef<I = unknown, O = unknown> {
  name: string;
  description: string;
  safety: 'safe' | 'confirm' | 'dangerous';
  schema: ZodType<I>;
  execute(input: I, ctx: ToolCtx): Promise<O>;
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
  | { type: 'error'; error: string };

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
}

/** Loop 输出 */
export interface RunTurnResult {
  messages: Message[];
  finishReason: 'stop' | 'length' | 'abort' | 'error';
}
