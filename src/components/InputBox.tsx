import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { completeBuiltinCommand } from '../agent/commands.js';

/**
 * 判断字符串是否全由可打印字符组成(不包含控制字符)。
 * - ASCII 可打印:0x20-0x7E
 * - 中文 / 日文 / 韩文(CJK):一-鿿 / ぀-ゟ / ゠-ヿ 等
 * - emoji 等补充平面:代 0x10000+ 由 surrogate pair 表达
 * 拒绝 0x00-0x1F 控制字符(ESC / TAB / CR 等)以及 0x7F DEL。
 */
function isPrintable(s: string): boolean {
  for (const codePoint of s) {
    const cp = codePoint.codePointAt(0)!;
    if (cp < 0x20) return false;
    if (cp === 0x7f) return false;
    if (cp >= 0x80) {
      // Unicode 区域:全接受(中文 / 日文 / emoji / 拉丁扩展等)
      continue;
    }
    // ASCII:0x20-0x7E 接受,0x7F 已在上面拒
  }
  return s.length > 0;
}

export interface InputBoxProps {
  onSubmit: (v: string) => void;
  disabled: boolean;
  /** 测试用: 强制初始 value */
  initialValue?: string;
  /**
   * 外部 paste 队列:App 层 useStdin 拦截到 paste 后往这个 ref 推文本。
   * InputBox 内部 useEffect 轮询消费(避免重渲染),把 paste 文本插到 cursor。
   * 选 ref 而不直接传 callback 是因为:setValue 是内部 state,
   * 外部要触发 setValue 必须通过 prop 间接传。
   */
  externalPasteRef?: React.MutableRefObject<string | null>;
}

/**
 * InputBox — 自管文本输入(不依赖 ink-text-input)。
 *
 * 为什么不用 TextInput:
 * ink-text-input 6.0.0 不处理终端 bracketed paste 协议 (ESC[200~...ESC[201~),
 * 粘贴时会把整段含 escape 的内容塞进 value,导致:
 * 1. 光标位置错乱(显示在头部)
 * 2. 后续 typing 是 overstrike 而非 insert
 * 这里我们直接 useInput,自己 strip paste 边界,自己管光标位置。
 *
 * 光标位置管理:
 * - 普通字符:在 cursor 位置插入,cursor 右移
 * - Backspace:删 cursor 左侧字符
 * - Delete(Ctrl+D):删 cursor 右侧字符
 * - 左右箭头:移动 cursor
 * - Home(Ctrl+A)/End(Ctrl+E):跳到头/尾
 * - paste:整段清洗后插到 cursor 位置
 */
export interface InputBoxProps {
  onSubmit: (v: string) => void;
  disabled: boolean;
  /** 测试用: 强制初始 value */
  initialValue?: string;
  /**
   * 外部 paste 队列:App 层 useStdin 拦截到 paste 后往这个 ref 推文本。
   * InputBox 内部 useEffect 轮询消费(避免重渲染),把 paste 文本插到 cursor。
   * 选 ref 而不直接传 callback 是因为:setValue 是内部 state,
   * 外部要触发 setValue 必须通过 prop 间接传。
   */
  externalPasteRef?: React.MutableRefObject<string | null>;
}

export function InputBox({ onSubmit, disabled, initialValue = '', externalPasteRef }: InputBoxProps) {
  const [value, setValue] = useState(initialValue);
  const [cursor, setCursor] = useState(initialValue.length);
  // 测试用:initialValue 改变时同步
  useEffect(() => {
    setValue(initialValue);
    setCursor(initialValue.length);
  }, [initialValue]);

  // 轮询 externalPasteRef,把外部 paste 文本插入 cursor
  useEffect(() => {
    if (!externalPasteRef) return;
    const id = setInterval(() => {
      if (disabled) return; // 跑任务时不接收 paste
      const text = externalPasteRef.current;
      if (text !== null && text !== '') {
        externalPasteRef.current = '';
        insertAt(text);
      }
    }, 30);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalPasteRef, disabled]);

  useInput((input, key) => {
    if (disabled) return;

    // paste 模式被 App 层 useStdin 拦截处理。
    // 这里不再做兜底(之前用 split/join 兜底会和 useStdin 重复 emit,导致
    // 显示 "[200~hello pasted" 残留)。如果 useInput 偶尔收到 paste 序列,
    // 我们直接丢弃 — useStdin 路径会处理,不会丢数据。

    // 1. 各种控制键
    if (key.return) {
      if (value.trim()) {
        onSubmit(value);
        setValue('');
        setCursor(0);
      }
      return;
    }
    if (key.backspace || key.delete || input === '\x7f' || input === '\b') {
      // 历史包袱:macOS 终端 Backspace 键发 \x7f,ink 的 parseKeypress 把它识别为
      // key.delete(不是 key.backspace),但用户期望"按 Backspace 删左侧"。
      // 这里把 key.delete 和 \x7f / \b 都当 backspace 处理(删左侧)。真要"Delete 键"
      // 几乎没有用户用,iTerm/Terminal 默认 Backspace 都是 \x7f。
      if (cursor > 0) {
        setValue(v => v.slice(0, cursor - 1) + v.slice(cursor));
        setCursor(c => c - 1);
      }
      return;
    }
    if (key.leftArrow) {
      setCursor(c => Math.max(0, c - 1));
      return;
    }
    if (key.rightArrow) {
      setCursor(c => Math.min(value.length, c + 1));
      return;
    }
    if (key.ctrl && input === 'a') {
      setCursor(0);
      return;
    }
    if (key.ctrl && input === 'e') {
      setCursor(value.length);
      return;
    }
    if (key.ctrl && input === 'k') {
      setValue(v => v.slice(0, cursor));
      return;
    }
    // 3. 普通字符 — 接受 ASCII 可打印 + 全部可打印 Unicode(中文 / 日文 / emoji)
    // 控制字符(0x00-0x1F 含 ESC / TAB 等)已经在上面分桶,这里只接受可打印的。
    if (input && isPrintable(input)) {
      insertAt(input);
    }
  });

  // 辅助:把一段已经确定不是 paste 的字符插到 cursor
  function handleChunk(s: string, _key: unknown) {
    if (!s) return;
    if (isPrintable(s)) insertAt(s);
  }

  function insertAt(s: string) {
    if (!s) return;
    setValue(v => v.slice(0, cursor) + s + v.slice(cursor));
    setCursor(c => c + s.length);
  }
  // ... rest of render ...
  if (disabled) {
    return <Text dimColor>  esc to interrupt</Text>;
  }
  // 当前补全状态 — 当 value 以 / 开头时实时算
  const trimmed = value.trimStart();
  const showCompletion = trimmed.startsWith('/') && !/\s/.test(trimmed);
  const { completion, candidates } = showCompletion
    ? completeBuiltinCommand(value)
    : { completion: '', candidates: [] as string[] };

  // 准备展示的提示行
  const hint = showCompletion
    ? (candidates.length === 0
        ? '  (无匹配命令)'
        : candidates.length === 1
          ? `  Tab: 补全 → /${candidates[0]}`
          : `  Tab: 补全 → /${trimmed.slice(1) + completion}  (候选: ${candidates.join(', ')})`)
    : '';

  return (
    <Box flexDirection="column">
      <Box>
        <Text color="cyan">❯ </Text>
        {cursor === 0 ? null : <Text>{value.slice(0, cursor)}</Text>}
        <Text color="cyan">▌</Text>
        {cursor < value.length ? <Text>{value.slice(cursor)}</Text> : null}
      </Box>
      {showCompletion && (
        <Box><Text dimColor>{hint}</Text></Box>
      )}
    </Box>
  );
}
