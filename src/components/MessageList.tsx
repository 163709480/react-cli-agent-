import React from 'react';
import { Box, Text } from 'ink';

export interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant';
  content?: string | null;
  streaming?: boolean;
}

export interface MessageListProps {
  messages: DisplayMessage[];
  /**
   * 视口内最多渲染的消息条数(从尾部向前数)。
   * 超出部分用 "earlier messages" 省略提示代替。
   * 不传则全部渲染。
   */
  maxMessages?: number;
}

export function MessageList({ messages, maxMessages }: MessageListProps) {
  const total = messages.length;
  const truncated = maxMessages !== undefined && total > maxMessages;
  const visible = truncated ? messages.slice(total - maxMessages!) : messages;
  const hiddenCount = truncated ? total - maxMessages! : 0;
  return (
    <Box flexDirection="column" overflowY="hidden" overflowX="hidden">
      {truncated && (
        <Box marginY={1}>
          <Text dimColor>  ... {hiddenCount} earlier messages ...</Text>
        </Box>
      )}
      {visible.map((m) => {
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
