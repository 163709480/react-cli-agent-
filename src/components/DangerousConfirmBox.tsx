import React from 'react';
import { Box, Text } from 'ink';

/**
 * 醒目确认框 —— 用于 safety='dangerous' 或 safety='confirm' 的破坏性工具。
 * 视觉差异:
 *   - 双线红框(对所有 confirm/dangerous 工具都展示)
 *   - dangerous 顶部加 ⚠ DANGEROUS 红字标
 *   - 变更预览:写文件 / 编辑 / 删除 / 外部请求 → 展示将发生什么
 *   - 必须输入 y 字母才确认(回车无效)
 */
export type ConfirmSeverity = 'confirm' | 'dangerous';

export interface DangerousConfirmBoxProps {
  /** 工具名,如 'write_file' */
  name: string;
  /** 工具原始参数(已经是 JSON 字符串) */
  args: string;
  /** confirm / dangerous,影响顶部标 */
  severity: ConfirmSeverity;
  /** 解析后的参数(由调用方提供,这里只展示) */
  parsed?: Record<string, unknown>;
  /** preview 内容(变更预览,可能多行) */
  preview?: string;
}

const RED = 'red';
const YELLOW = 'yellow';
const DIM = 'gray';

export function DangerousConfirmBox({ name, args, severity, parsed, preview }: DangerousConfirmBoxProps) {
  const borderColor = severity === 'dangerous' ? RED : YELLOW;
  const headerText = severity === 'dangerous'
    ? `⚠ DANGEROUS ACTION — ${name}`
    : `Confirm — ${name}`;

  return (
    <Box flexDirection="column" marginY={1} borderStyle="double" borderColor={borderColor} paddingX={1}>
      <Text color={borderColor} bold>{headerText}</Text>
      <Box marginTop={1} flexDirection="column">
        <Text>
          <Text color={DIM}>args:  </Text>
          {args}
        </Text>
        {preview ? (
          <Box marginTop={1} flexDirection="column">
            <Text color={DIM}>preview:</Text>
            {preview.split('\n').map((line, i) => (
              <Text key={i}>{line}</Text>
            ))}
          </Box>
        ) : null}
        {parsed && Object.keys(parsed).length > 0 ? (
          <Box marginTop={1} flexDirection="column">
            {Object.entries(parsed).map(([k, v]) => (
              <Text key={k}>
                <Text color={DIM}>{k}: </Text>
                {typeof v === 'string' ? v : JSON.stringify(v)}
              </Text>
            ))}
          </Box>
        ) : null}
      </Box>
      <Box marginTop={1}>
        <Text color={borderColor} bold>
          Press Y to confirm, N to cancel.
        </Text>
        <Text color={DIM}> (Enter alone is ignored.)</Text>
      </Box>
    </Box>
  );
}
