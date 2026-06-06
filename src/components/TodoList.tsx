import React from 'react';
import { Box, Text } from 'ink';
import type { TodoItem } from '../agent/sessionState.js';

export interface TodoListProps {
  todos: TodoItem[];
}

function statusIcon(status: TodoItem['status']): string {
  if (status === 'completed') return '✓';
  if (status === 'in_progress') return '▶';
  return '·';
}

export function TodoList({ todos }: TodoListProps) {
  if (todos.length === 0) return null;
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} marginBottom={1}>
      <Text dimColor>Tasks</Text>
      {todos.map((t, i) => (
        <Text key={i} color={t.status === 'completed' ? 'gray' : undefined} strikethrough={t.status === 'completed'}>
          {statusIcon(t.status)} {t.content}
        </Text>
      ))}
    </Box>
  );
}
