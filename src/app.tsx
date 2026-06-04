import React, { useEffect, useState, useRef } from 'react';
import { Box, useApp, useInput } from 'ink';
import { MessageList, type DisplayMessage } from './components/MessageList.js';
import { InputBox } from './components/InputBox.js';
import { ToolTrace } from './components/ToolTrace.js';
import { runTurn } from './agent/loop.js';
import { readFileTool } from './tools/read_file.js';
import { writeFileTool } from './tools/write_file.js';
import { editFileTool } from './tools/edit_file.js';
import { grepTool } from './tools/grep.js';
import { globTool } from './tools/glob.js';
import { httpFetchTool } from './tools/http_fetch.js';
import { createOpenAIClient } from './llm/client.js';
import { loadConfig } from './config.js';
import type OpenAI from 'openai';
import type { AgentEvent, Message, ToolDef, ToolCall } from './agent/types.js';
import { v4 as uuid } from 'uuid';

interface AppProps {
  yolo: boolean;
  allowMutations: boolean;
  cwd: string;
  headlessPrompt?: string;
}

const TOOLS: ToolDef[] = [
  readFileTool, writeFileTool, editFileTool, grepTool, globTool, httpFetchTool,
];

export function App({ yolo, allowMutations, cwd, headlessPrompt }: AppProps) {
  const { exit } = useApp();
  const [messages, setMessages] = useState<Message[]>([]);
  const [display, setDisplay] = useState<DisplayMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const clientRef = useRef<OpenAI | null>(null);
  const configRef = useRef<ReturnType<typeof loadConfig> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const confirmResolversRef = useRef<Map<string, (ok: boolean) => void>>(new Map());
  const [pending, setPending] = useState<DisplayMessage | null>(null);

  useEffect(() => {
    const cfg = loadConfig();
    configRef.current = cfg;
    try {
      clientRef.current = createOpenAIClient(cfg);
    } catch (e) {
      setDisplay([{ id: uuid(), role: 'assistant', content: (e as Error).message }]);
    }
    if (headlessPrompt) {
      void handleUserInput(headlessPrompt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useInput((input, key) => {
    if (key.ctrl && input === 'c' && busy && abortRef.current) {
      abortRef.current.abort();
      return;
    }
    if (pending) {
      if (input === 'y' || input === 'Y') {
        const r = confirmResolversRef.current.get(pending.id);
        if (r) r(true);
        confirmResolversRef.current.delete(pending.id);
        setPending(null);
      } else if (input === 'n' || input === 'N') {
        const r = confirmResolversRef.current.get(pending.id);
        if (r) r(false);
        confirmResolversRef.current.delete(pending.id);
        setPending(null);
      }
    }
  });

  async function handleUserInput(text: string) {
    if (!clientRef.current || !configRef.current) return;
    const userMsg: Message = { role: 'user', content: text };
    const newMsgs: Message[] = [...messages, userMsg];
    setMessages(newMsgs);
    const userDisplay: DisplayMessage = { id: uuid(), role: 'user', content: text };
    const assistantId = uuid();
    setDisplay((d) => [...d, userDisplay, { id: assistantId, role: 'assistant', content: '', streaming: true }]);
    setBusy(true);
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      await runTurn({
        messages: newMsgs,
        tools: TOOLS,
        cwd,
        yolo,
        onEvent: (ev) => applyEvent(ev, assistantId),
        onConfirm: (tc) =>
          new Promise<boolean>((resolve) => {
            if (yolo) {
              // yolo 模式:跳过 confirm,但 dangerous 也跳过(用户已知风险)
              resolve(true);
              return;
            }
            const id = uuid();
            confirmResolversRef.current.set(id, resolve);
            setPending({
              id,
              role: 'tool',
              toolName: tc.function.name,
              toolResult: `[pending y/n] ${tc.function.arguments}`,
            });
          }),
        signal: abort.signal,
        client: clientRef.current,
        model: configRef.current.openaiModel,
        maxContextTokens: configRef.current.maxContextTokens,
        extraCtx: {
          writeableExts: configRef.current.writeableExts,
          allowMutations,
        },
      });
    } finally {
      setBusy(false);
      abortRef.current = null;
      setDisplay((d) =>
        d.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m)),
      );
      if (headlessPrompt) exit();
    }
  }

  function applyEvent(ev: AgentEvent, assistantId: string) {
    setDisplay((d) => {
      const next = [...d];
      if (ev.type === 'text_delta') {
        const idx = next.findIndex((m) => m.id === assistantId);
        if (idx >= 0) {
          next[idx] = { ...next[idx], content: (next[idx].content ?? '') + ev.delta };
        }
        return next;
      }
      if (ev.type === 'tool_call_start') {
        const newTool: DisplayMessage = {
          id: uuid(), role: 'tool', toolName: ev.toolCall.function.name, toolResult: '...',
        };
        return [...next, newTool];
      }
      if (ev.type === 'tool_call_end') {
        for (let i = next.length - 1; i >= 0; i--) {
          if (next[i].role === 'tool' && next[i].toolResult === '...') {
            next[i] = { ...next[i], toolResult: ev.result };
            break;
          }
        }
        return next;
      }
      return next;
    });
  }

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" flexGrow={1}>
        <MessageList messages={display} />
      </Box>
      {pending && <ToolTrace name={pending.toolName ?? '?'} args={pending.toolResult} pending onConfirm={() => {}} />}
      <Box marginTop={1}>
        <InputBox onSubmit={handleUserInput} disabled={busy} />
      </Box>
    </Box>
  );
}
