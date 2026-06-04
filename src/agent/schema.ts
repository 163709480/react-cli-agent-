import { zodToJsonSchema as zodToJsonSchemaImpl } from 'zod-to-json-schema';
import type { ZodType } from 'zod';
import type { ToolDef, ToolDescriptor } from './types.js';

/**
 * 把 zod-to-json-schema 的输出规整成 OpenAI tool 期望的最小形态:
 * - 去掉 $schema 噪音
 * - 移除 object 上的 additionalProperties: false(默认值,无信息量;但保留 record 的
 *   additionalProperties: { type: ... } 用以描述 value 类型)
 * - 把 integer 退化为 number(LLM 不区分整数/浮点)
 */
function normalize(node: unknown, parentKey?: string): unknown {
  if (Array.isArray(node)) return node.map((n) => normalize(n));
  if (node && typeof node === 'object') {
    const src = node as Record<string, unknown>;
    const isObjectSchema = src.type === 'object';
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(src)) {
      if (k === '$schema') continue;
      // 只在 object 的 schema 上移除 additionalProperties: false,record 的要保留
      if (k === 'additionalProperties' && isObjectSchema && v === false) continue;
      out[k] = normalize(v, k);
    }
    if (out.type === 'integer') out.type = 'number';
    return out;
  }
  return node;
}

export function zodToJsonSchema(schema: ZodType): Record<string, unknown> {
  return normalize(zodToJsonSchemaImpl(schema)) as Record<string, unknown>;
}

export function toolDescriptor<I>(tool: ToolDef<I>): ToolDescriptor {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: zodToJsonSchema(tool.schema),
    },
  };
}

/** 辅助:从 ToolDef 推断入参类型 */
export type InferToolInput<T> = T extends ToolDef<infer I> ? I : never;
