import React from 'react';
import { Box, Text } from 'ink';

export interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant';
  content?: string | null;
  streaming?: boolean;
}

export function MessageList({ messages }: { messages: DisplayMessage[] }) {
  return (
    <Box flexDirection="column">
      {messages.map((m) => {
        if (m.role === 'user') {
          return (
            <Box key={m.id} marginY={1}>
              <Text color="cyan">❯ </Text>
              <Text>{m.content}</Text>
            </Box>
          );
        }
        return (
          <Box key={m.id} marginY={1} flexDirection="column">
            {m.content && <Text color="green">{m.content}{m.streaming ? '▍' : ''}</Text>}
          </Box>
        );
      })}
    </Box>
  );
}
