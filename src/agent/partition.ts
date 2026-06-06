import type { ToolCall, ToolDef } from './types.js';

/**
 * 决定一个 toolCall 是不是"并发安全"的。
 * 工具未注册 / 工具没声明 concurrencySafe → 一律 false(fail-closed)。
 */
export function isToolConcurrencySafe(call: ToolCall, tools: ToolDef[]): boolean {
  const tool = tools.find((t) => t.name === call.function.name);
  if (!tool) return false;
  return tool.concurrencySafe === true;
}

/**
 * 把 LLM 在一轮响应中请求的一批 tool call 切分成可执行的批次:
 *   - 连续出现的 concurrencySafe=true 的 call 合并到同一批(批内可并行)
 *   - concurrencySafe=false 的 call 各自单独一批(批内只能串行)
 *
 * 设计动机:参考 Claude Code `partitionToolCalls` (《御舆》第 3 章 3.4 节):
 *   并发安全工具可并行,非安全工具串行;一旦出现非安全,无论之前是
 *   safe 还是 unsafe,都关掉当前批并为该 unsafe 单开一个新批(单元素)。
 *   safe 工具只有当"当前批至今全是 safe"时才能合入 —— 这就保证
 *   safe 批内永远不会和 unsafe 工具并发。
 * 输出批次按 tool call 原始顺序排列;每个批内的 call 也保持原顺序。
 */
export function partitionToolCalls(
  toolCalls: ToolCall[],
  tools: ToolDef[],
): ToolCall[][] {
  if (toolCalls.length === 0) return [];
  const batches: ToolCall[][] = [];
  let current: ToolCall[] = [];
  let currentAllSafe = true;

  for (const tc of toolCalls) {
    const safe = isToolConcurrencySafe(tc, tools);
    if (safe) {
      // safe call: 可合并到当前批,仅当当前批至今全是 safe
      if (current.length > 0 && currentAllSafe) {
        current.push(tc);
      } else {
        if (current.length > 0) batches.push(current);
        current = [tc];
        currentAllSafe = true;
      }
    } else {
      // unsafe call:永远单元素批 —— 关掉当前批(若有),开一个只含自己的批
      if (current.length > 0) batches.push(current);
      batches.push([tc]);
      current = [];
      currentAllSafe = true;
    }
  }
  if (current.length > 0) batches.push(current);
  return batches;
}
