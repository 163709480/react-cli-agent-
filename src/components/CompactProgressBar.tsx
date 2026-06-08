import React from 'react';
import { Box, Text } from 'ink';
import type { CompactProgress } from '../agent/context.js';

/**
 * 压缩进度条 — P0.6
 *
 * 显示阶段式进度(10/25/40/75/100),不是伪装真实网络进度。
 * summarizer 阶段没有 token 级真实进度,所以这一版只显示"阶段"。
 */
export function CompactProgressBar({ event }: { event: CompactProgress | null }) {
  if (!event) return null;
  const width = 20;
  const filled = Math.max(0, Math.min(width, Math.round((event.percent / 100) * width)));
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
  const phaseLabel = (() => {
    switch (event.phase) {
      case 'estimating': return 'Estimating tokens';
      case 'loading_instructions': return 'Loading compact instructions';
      case 'summarizing': return 'Summarizing';
      case 'rebuilding': return 'Rebuilding context';
      case 'done': return 'Done';
      case 'nothing_to_compact': return 'Nothing to compact';
      case 'error': return 'Error';
    }
  })();
  if (event.phase === 'done') {
    const reduction = event.beforeTokens > 0
      ? Math.round(((event.beforeTokens - event.afterTokens) / event.beforeTokens) * 100)
      : 0;
    return (
      <Box flexDirection="column" marginY={1}>
        <Text>
          <Text color="magenta">⏺ </Text>
          <Text color="green">Compressing context</Text>
          <Text dimColor> [{bar}] {event.percent}% </Text>
          <Text>{phaseLabel}</Text>
        </Text>
        <Text dimColor>
          {`  ${event.beforeTokens.toLocaleString()} → ${event.afterTokens.toLocaleString()} tokens (${reduction}% reduced)${event.fallback ? ' · fallback used' : ''}`}
        </Text>
      </Box>
    );
  }
  if (event.phase === 'nothing_to_compact') {
    return (
      <Box marginY={1}>
        <Text dimColor>{`  nothing to compact (${event.messageCount} messages)`}</Text>
      </Box>
    );
  }
  if (event.phase === 'error') {
    return (
      <Box marginY={1}>
        <Text color="red">{`  compact error: ${event.error}`}</Text>
      </Box>
    );
  }
  return (
    <Box marginY={1}>
      <Text>
        <Text color="magenta">⏺ </Text>
        <Text color="green">Compressing context</Text>
        <Text dimColor> [{bar}] {event.percent}% </Text>
        <Text dimColor>{phaseLabel}</Text>
      </Text>
    </Box>
  );
}
