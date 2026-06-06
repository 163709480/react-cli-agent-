import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

export interface AskUserDialogProps {
  question: string;
  options: string[];
  multiSelect: boolean;
  onResolve: (answer: string | string[] | '__canceled__') => void;
}

export function AskUserDialog({ question, options, multiSelect, onResolve }: AskUserDialogProps) {
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  useInput((input, key) => {
    if (key.escape) {
      onResolve('__canceled__');
      return;
    }
    if (key.upArrow) {
      setCursor((c) => (c - 1 + options.length) % options.length);
      return;
    }
    if (key.downArrow) {
      setCursor((c) => (c + 1) % options.length);
      return;
    }
    if (multiSelect && input === ' ') {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(cursor)) next.delete(cursor);
        else next.add(cursor);
        return next;
      });
      return;
    }
    if (key.return) {
      if (multiSelect) {
        if (selected.size === 0) return;
        const answer = Array.from(selected).sort().map((i) => options[i]!);
        onResolve(answer);
      } else {
        onResolve(options[cursor]!);
      }
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold>{question}</Text>
      {options.map((opt, i) => {
        const isCursor = i === cursor;
        const isSelected = selected.has(i);
        const prefix = isCursor ? '▶ ' : '  ';
        const marker = multiSelect ? (isSelected ? '[x]' : '[ ]') : '  ';
        return (
          <Text key={i}>
            {prefix}
            {marker} {opt}
          </Text>
        );
      })}
      <Text dimColor>
        {multiSelect ? '↑↓ 移动 / 空格 勾选 / 回车 确认 / Esc 取消' : '↑↓ 移动 / 回车 确认 / Esc 取消'}
      </Text>
    </Box>
  );
}
