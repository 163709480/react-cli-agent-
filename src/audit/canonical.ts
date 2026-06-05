/**
 * canonical JSON 序列化器。
 *
 * 目的:无论源对象 key 顺序如何,输出一致的字符串,让 hash chain 可重现。
 * 规则:
 *   - object key 按 localeCompare 排序
 *   - array 保持原序
 *   - 遇到 undefined / function 抛错(防止静默丢字段)
 *   - number / boolean / null / string 走 JSON 原生序列化
 *
 * 零依赖。手写约 30 行,符合"国企合规项目加 dep 要走审批"的约束。
 */
export function canonicalJson(value: unknown): string {
  return stringify(value);
}

function stringify(v: unknown): string {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) {
      throw new TypeError(`canonicalJson: non-finite number ${v}`);
    }
    return JSON.stringify(v);
  }
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) {
    return '[' + v.map(stringify).join(',') + ']';
  }
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj).sort((a, b) => a.localeCompare(b));
    return (
      '{' +
      keys
        .map((k) => {
          const val = obj[k];
          if (val === undefined) {
            throw new TypeError(`canonicalJson: undefined value for key "${k}"`);
          }
          return JSON.stringify(k) + ':' + stringify(val);
        })
        .join(',') +
      '}'
    );
  }
  if (typeof v === 'undefined') {
    throw new TypeError('canonicalJson: undefined at top level');
  }
  if (typeof v === 'function' || typeof v === 'symbol' || typeof v === 'bigint') {
    throw new TypeError(`canonicalJson: unsupported type ${typeof v}`);
  }
  throw new TypeError(`canonicalJson: unhandled value ${String(v)}`);
}
