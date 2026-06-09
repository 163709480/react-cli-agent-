import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

/**
 * 密码式 API key 输入框 — 用于 /model 或 /config 切换到需要 key 的 provider 时,
 * 当 process.env.OPENAI_API_KEY 未设,弹给用户输入。
 *
 * 设计:
 * - 不回显明文,只显示若干 * 掩码(避免 shoulder-surfing / 屏幕录像泄露)
 * - Enter 提交(空 key 忽略)
 * - Esc 或 Ctrl+C 取消
 * - 父组件负责把 key 写到 ~/.agent/secrets/{provider}.key 或临时 process.env
 */
export interface ApiKeyInputProps {
  providerLabel: string;
  /** env 变量名(展示用,提示用户后续也可以走 env);默认 OPENAI_API_KEY */
  envVar?: string;
  onSubmit: (key: string) => void;
  onCancel: () => void;
}

export function ApiKeyInput({
  providerLabel,
  envVar = 'OPENAI_API_KEY',
  onSubmit,
  onCancel,
}: ApiKeyInputProps) {
  const [value, setValue] = useState('');

  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === 'c')) {
      onCancel();
      return;
    }
    if (key.return) {
      if (value.trim()) onSubmit(value);
      return;
    }
    // 退格
    if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
      return;
    }
    // 普通字符 — 只接受可打印 ASCII,避免终端控制序列乱入
    if (input && /^[\x20-\x7e]+$/.test(input)) {
      setValue((v) => v + input);
    }
  });

  return (
    <Box flexDirection="column" marginY={1}>
      <Text color="yellow">⚠ {providerLabel} 需要 API key</Text>
      <Text dimColor>  环境变量 <Text color="cyan">{envVar}</Text> 未设,或直接粘贴 key 后回车(不会显示明文)。</Text>
      <Box marginTop={1}>
        <Text color="cyan">key: </Text>
        <Text>{'*'.repeat(value.length)}</Text>
        <Text color="cyan">▌</Text>
      </Box>
      <Text dimColor>  Enter 提交 · Esc 取消</Text>
    </Box>
  );
}
