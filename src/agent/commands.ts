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
 * - 部分命令带参数(如 /model deepseek、/config --provider ollama),
 *   由 `args` 字段透传到 caller
 */

export type BuiltinCommand =
  | { type: 'compact' }
  | { type: 'status' }
  | { type: 'clear' }
  | { type: 'reset' }
  | { type: 'help' }
  | { type: 'model'; args: string }
  | { type: 'config'; args: string }
  | { type: 'unknown'; name: string };

/** 第一版支持的内置命令清单(展示给 /help 用) */
export const BUILTIN_COMMAND_LIST: Array<{ name: string; description: string }> = [
  { name: 'compact', description: '手动压缩上下文(不调用 LLM summarizer 之外的任何 LLM)' },
  { name: 'status', description: '查看当前模型、cwd、turn/tool limits、缓存统计' },
  { name: 'clear', description: '清空当前屏幕显示(不清空真实消息历史)' },
  { name: 'reset', description: '清空当前 session 上下文(保留 cwd/config)' },
  { name: 'model', description: '查看/切换当前 provider(/model ollama | deepseek | minimax)' },
  { name: 'config', description: '查看/切换持久化 provider(/config --provider X)' },
  { name: 'help', description: '显示本帮助' },
];

/** 候选参数(用于 / 命令补全 + /model 校验) */
export const PROVIDER_NAMES = ['ollama', 'deepseek', 'minimax'] as const;

/**
 * 解析用户输入文本。返回 BuiltinCommand 表示应当走本地命令;
 * 返回 null 表示应当走 LLM。
 *
 * 规则:
 * - 必须以 `/` 开头才解析
 * - `/` 后第一个 token 是命令名(忽略大小写)
 *   - 名字必须只含 [a-zA-Z0-9_-],含 / 或其他字符(如路径 `/foo/bar`)→ 不是命令,走 LLM
 *   - 这避免用户输入 "/Users/eryiya/foo" 被误判为未知命令
 * - 后续 token 用 `args` 字段带出
 * - 未知命令返回 `{ type: 'unknown' }`,由 UI 提示
 */
export function parseBuiltinCommand(text: string): BuiltinCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;
  const rest = trimmed.slice(1);
  const match = rest.match(/^(\S+)(?:\s+(.*))?$/);
  if (!match) return null;
  const name = match[1].toLowerCase();
  // 名字含 / 或其他路径分隔符 → 视作普通文本(走 LLM 让 LLM 解释路径)
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(name)) return null;
  const args = (match[2] ?? '').trim();
  switch (name) {
    case 'compact': return { type: 'compact' };
    case 'status':  return { type: 'status' };
    case 'clear':   return { type: 'clear' };
    case 'reset':   return { type: 'reset' };
    case 'help':    return { type: 'help' };
    case 'model':   return { type: 'model', args };
    case 'config':  return { type: 'config', args };
    default:        return { type: 'unknown', name };
  }
}

/**
 * 命令补全 — 给当前输入前缀找最长公共补全。
 *
 * - 输入必须以 `/` 开头才补全
 * - 候选来源:BUILTIN_COMMAND_LIST 的所有 name
 * - 返回 `{ completion, candidates }`:
 *     completion: 公共补全后缀(空串表示无公共补全)
 *     candidates: 所有匹配当前前缀的命令名(用于 UI 列表展示)
 */
export function completeBuiltinCommand(text: string): {
  completion: string;
  candidates: string[];
} {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('/')) return { completion: '', candidates: [] };
  // 当前已输入的命令前缀(去掉 /)
  const prefix = trimmed.slice(1).toLowerCase();
  // 含 / 或其他路径分隔符 → 不是命令,不补全(走 LLM)
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(prefix) && prefix !== '') {
    return { completion: '', candidates: [] };
  }
  // 还没输入 / 后面的字母:返回所有命令
  if (prefix === '') {
    return {
      completion: '',
      candidates: BUILTIN_COMMAND_LIST.map((c) => c.name),
    };
  }
  const matched = BUILTIN_COMMAND_LIST
    .map((c) => c.name)
    .filter((n) => n.startsWith(prefix));
  if (matched.length === 0) return { completion: '', candidates: [] };
  if (matched.length === 1) {
    return { completion: matched[0].slice(prefix.length), candidates: matched };
  }
  // 多匹配:求最长公共前缀中"超出当前 prefix 的部分"
  const lcp = matched.reduce((acc, n) => longestCommonPrefix(acc, n), matched[0]);
  const completion = lcp.slice(prefix.length);
  return { completion, candidates: matched };
}

function longestCommonPrefix(a: string, b: string): string {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return a.slice(0, i);
}
