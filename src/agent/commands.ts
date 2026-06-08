/**
 * 内置 slash command 分流。
 *
 * 目标:让确定性本地操作(/compact /status /help 等)不进 LLM,
 * 减少冗余 token,也避免对 LLM 行为的依赖。
 *
 * 设计:
 * - parseBuiltinCommand(text) -> BuiltinCommand | null
 *   - null 表示"不是内置命令,应该走 LLM"
 * - 未知 /xxx 也会被识别成 `{ type: 'unknown', name }`,让 UI 报错
 *   而不是错误地发给 LLM
 */

export type BuiltinCommand =
  | { type: 'compact' }
  | { type: 'status' }
  | { type: 'clear' }
  | { type: 'reset' }
  | { type: 'help' }
  | { type: 'unknown'; name: string };

/** 第一版支持的内置命令清单(展示给 /help 用) */
export const BUILTIN_COMMAND_LIST: Array<{ name: string; description: string }> = [
  { name: 'compact', description: '手动压缩上下文(不调用 LLM summarizer 之外的任何 LLM)' },
  { name: 'status', description: '查看当前模型、cwd、turn/tool limits、缓存统计' },
  { name: 'clear', description: '清空当前屏幕显示(不清空真实消息历史)' },
  { name: 'reset', description: '清空当前 session 上下文(保留 cwd/config)' },
  { name: 'help', description: '显示本帮助' },
];

/**
 * 解析用户输入文本。返回 BuiltinCommand 表示应当走本地命令;
 * 返回 null 表示应当走 LLM。
 *
 * 规则:
 * - 必须以 `/` 开头才解析
 * - `/` 后第一个 token 是命令名(忽略大小写)
 * - 未知命令返回 `{ type: 'unknown' }`,由 UI 提示
 */
export function parseBuiltinCommand(text: string): BuiltinCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;
  // 切第一个 token 作为命令名
  const rest = trimmed.slice(1);
  // 命令名是直到空格/制表符为止
  const match = rest.match(/^(\S+)/);
  if (!match) return null;
  const name = match[1].toLowerCase();
  switch (name) {
    case 'compact': return { type: 'compact' };
    case 'status':  return { type: 'status' };
    case 'clear':   return { type: 'clear' };
    case 'reset':   return { type: 'reset' };
    case 'help':    return { type: 'help' };
    default:        return { type: 'unknown', name };
  }
}
