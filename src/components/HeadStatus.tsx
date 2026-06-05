import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';

export type LoopPhase = 'idle' | 'thinking' | 'executing' | 'compressing';

export interface HeadStatusProps {
  phase: LoopPhase;
  /** phase 开始时刻(epoch ms) */
  phaseStartMs: number;
  /** 当前轮的累计 token 使用(可选) */
  tokens?: { promptTokens: number; completionTokens: number };
  /** executing 阶段时正在执行的工具名 */
  toolName?: string;
  /** compressing 阶段用,展示 before→after tokens + 进度 */
  compressStatus?: { before: number; after?: number; startedAt: number };
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m${s % 60}s`;
}

function describeTool(name: string): string {
  if (name === 'read_file') return 'Reading';
  if (name === 'write_file') return 'Writing';
  if (name === 'edit_file') return 'Editing';
  if (name === 'grep') return 'Searching';
  if (name === 'glob') return 'Listing files';
  if (name === 'http_fetch') return 'Fetching URL';
  return `Running ${name}`;
}

/**
 * 头部状态行。Claude Code 风格。
 * 内部每秒 setState 一次以更新 durationMs,不需要父组件驱动。
 */
export function HeadStatus({ phase, phaseStartMs, tokens, toolName, compressStatus }: HeadStatusProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (phase === 'idle') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [phase, phaseStartMs]);
  if (phase === 'idle') return null;
  const durationMs = now - phaseStartMs;
  if (phase === 'compressing') {
    const status = compressStatus;
    const before = status?.before ?? 0;
    const after = status?.after;
    const reduction =
      after !== undefined && before > 0
        ? Math.round(((before - after) / before) * 100)
        : null;
    const ratio = `${before.toLocaleString()}${after !== undefined ? ` → ${after.toLocaleString()}` : ''}${reduction !== null ? ` (${reduction}% reduction)` : ''}`;
    return (
      <Box flexDirection="column" marginY={1}>
        <Text>
          <Text color="magenta">⏺ </Text>
          <Text color="magenta">Compressing context: {ratio} tokens</Text>
          <Text dimColor> · {formatDuration(durationMs)}</Text>
        </Text>
      </Box>
    );
  }
  if (phase === 'thinking') {
    const tok = tokens ? ` · ↓ ${tokens.completionTokens} tokens` : '';
    return (
      <Box flexDirection="column" marginY={1}>
        <Text>
          <Text color="cyan">⏺ </Text>
          <Text color="cyan">Thinking for {formatDuration(durationMs)}</Text>
          {tok && <Text dimColor>{tok}</Text>}
        </Text>
      </Box>
    );
  }
  const verb = toolName ? describeTool(toolName) : 'Working';
  return (
    <Box flexDirection="column" marginY={1}>
      <Text>
        <Text color="yellow">⏺ </Text>
        <Text color="yellow">{verb}…</Text>
        <Text dimColor> ({formatDuration(durationMs)})</Text>
      </Text>
    </Box>
  );
}
