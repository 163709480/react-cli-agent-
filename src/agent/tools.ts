import { toolDescriptor } from './schema.js';
import type { ToolDef, ToolDescriptor } from './types.js';

/** 把一组工具转成 OpenAI 工具描述(发给 LLM) */
export function getToolDescriptors(tools: ToolDef[]): ToolDescriptor[] {
  return tools.map(toolDescriptor);
}

/** 按 name 查工具 */
export function findTool(tools: ToolDef[], name: string): ToolDef | undefined {
  return tools.find((t) => t.name === name);
}
