/**
 * 过滤 LLM 响应里的 "thinking" 块。
 *
 * 背景:部分 provider(minimax-M3 等)默认开启 chain-of-thought 模式,
 * 响应里会把内部推理用 `` 这种标签包起来。
 * 如果不剥,这些会混进用户看到的正文,体验很差。
 *
 * 处理(状态机:扫文本,只在匹配的 `` 对之间丢内容):
 * - 闭合对 ``...`` → 完全丢弃
 * - 只有 `` 没 `` → 当作"开过头",后面整段 thinking 丢
 * - 多个 thinking 块全部剥
 * - 不属于 thinking 的内容原样保留
 * - 孤立的 ``(前面没有对应的 ``)→ 保留(可能是 chunk 边界切断的尾巴)
 */
export function stripThinking(text: string): string {
  if (!text) return text;
  const OPEN = '<think>';
  const CLOSE = '</think>';
  const out: string[] = [];
  let i = 0;
  let inThinking = false;
  while (i < text.length) {
    if (!inThinking) {
      const openIdx = text.indexOf(OPEN, i);
      if (openIdx < 0) {
        out.push(text.slice(i));
        break;
      }
      out.push(text.slice(i, openIdx));
      i = openIdx + OPEN.length;
      inThinking = true;
    } else {
      const closeIdx = text.indexOf(CLOSE, i);
      if (closeIdx < 0) {
        // 开了但没关 — 丢到末尾
        i = text.length;
        break;
      }
      i = closeIdx + CLOSE.length;
      inThinking = false;
    }
  }
  return out.join('');
}
