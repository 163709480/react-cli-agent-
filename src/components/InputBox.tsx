import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';

export function InputBox({ onSubmit, disabled }: { onSubmit: (v: string) => void; disabled: boolean }) {
  const [value, setValue] = useState('');
  if (disabled) {
    return <Text dimColor>  (agent 工作中,按 Ctrl+C 中断)</Text>;
  }
  return (
    <Box>
      <Text color="cyan">❯ </Text>
      <TextInput
        value={value}
        onChange={setValue}
        onSubmit={(v) => { if (v.trim()) { onSubmit(v); setValue(''); } }}
      />
    </Box>
  );
}
