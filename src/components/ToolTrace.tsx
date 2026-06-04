import React from 'react';
import { Box, Text } from 'ink';

export function ToolTrace({ name, result }: { name: string; result: string }) {
  const isError = result.startsWith('Error:');
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={isError ? 'red' : 'gray'} paddingX={1}>
      <Text color="yellow">⚙ {name}</Text>
      <Text color={isError ? 'red' : 'gray'}>{result.slice(0, 500)}{result.length > 500 ? '…' : ''}</Text>
    </Box>
  );
}
