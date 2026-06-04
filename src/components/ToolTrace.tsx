import React from 'react';
import { Box, Text } from 'ink';

export interface ToolTraceProps {
  name: string;
  args?: string;
  result?: string;
  pending?: boolean;
  onConfirm?: (ok: boolean) => void;
}

export function ToolTrace({ name, args, result, pending, onConfirm }: ToolTraceProps) {
  if (pending) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
        <Text color="yellow">⚙ {name} 申请执行</Text>
        {args && <Text color="gray">  args: {args.slice(0, 300)}</Text>}
        <Text color="cyan">  [y] 同意  [n] 拒绝  →</Text>
      </Box>
    );
  }
  const isError = (result ?? '').startsWith('Error:');
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={isError ? 'red' : 'gray'} paddingX={1}>
      <Text color="yellow">⚙ {name}</Text>
      <Text color={isError ? 'red' : 'gray'}>{(result ?? '').slice(0, 500)}{(result ?? '').length > 500 ? '…' : ''}</Text>
    </Box>
  );
}
