import React from 'react';
import { Box, Text } from 'ink';

export type ActiveToolState = 'running' | 'pending' | 'error';

export interface ActiveToolLineProps {
  name: string;
  args?: string;
  state: ActiveToolState;
  /** 子项(如展开的 ⎿  file.md 行) */
  children?: React.ReactNode;
}

/**
 * 单行紧凑展示当前正在跑的工具。
 * - running: ⏺ <name>(args) [+ children indented]
 * - pending: ⏸ <name>(args)  →  [y] 同意  [n] 拒绝
 * - error:   ✗ <name>
 */
export function ActiveToolLine({ name, args, state, children }: ActiveToolLineProps) {
  if (state === 'error') {
    return (
      <Box marginY={1}>
        <Text color="red">✗ {name}</Text>
      </Box>
    );
  }
  if (state === 'pending') {
    return (
      <Box flexDirection="column" marginY={1}>
        <Text color="yellow">⏸ {name}{args ? `(${args})` : ''}</Text>
        {children}
        <Text color="cyan">  [y] 同意  [n] 拒绝  →</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column" marginY={1}>
      <Text color="yellow">⏺ {name}{args ? `(${args})` : ''}</Text>
      {children}
    </Box>
  );
}
