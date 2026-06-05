import React from 'react';
import { Box, Text } from 'ink';

export interface WelcomeProps {
  model: string;
  cwd: string;
  provider: string;
}

const ART = [
  '   🌹        🌹        🌹   ',
  '  🌹🌹      🌹🌹      🌹🌹  ',
  ' 🌹🌹🌹    🌹🌹🌹    🌹🌹🌹 ',
  '  🌹🌹      🌹🌹      🌹🌹  ',
  '   |🌿       |🌿       |🌿   ',
  '   |          |          |   ',
];

/**
 * 启动时的欢迎信息。顶部 ASCII art 玫瑰 + 模型/cwd/provider 状态行,只展示一次。
 */
export function Welcome({ model, cwd, provider }: WelcomeProps) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginY={1}>
      {ART.map((line, i) => (
        <Text key={i} color="magenta">{line}</Text>
      ))}
      <Text> </Text>
      <Text color="cyan" bold>  ✦ agent</Text>
      <Text dimColor>  本地 ReAct coding agent · OpenAI 兼容 API</Text>
      <Text> </Text>
      <Text>
        <Text dimColor>  model    </Text>
        <Text color="green">{model}</Text>
      </Text>
      <Text>
        <Text dimColor>  provider </Text>
        <Text color="green">{provider}</Text>
      </Text>
      <Text>
        <Text dimColor>  cwd      </Text>
        <Text color="green">{cwd}</Text>
      </Text>
      <Text> </Text>
      <Text dimColor>  输入任务开始 · Ctrl+C 中断</Text>
    </Box>
  );
}
