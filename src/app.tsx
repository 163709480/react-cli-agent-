import React, { useEffect, useState, useRef } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import path from 'node:path';
import os from 'node:os';
import { MessageList, type DisplayMessage } from './components/MessageList.js';
import { InputBox } from './components/InputBox.js';
import { ActiveToolLine, type ActiveToolState } from './components/ActiveToolLine.js';
import { DangerousConfirmBox, type ConfirmSeverity } from './components/DangerousConfirmBox.js';
import { buildPreview } from './components/buildPreview.js';
import { HeadStatus, type LoopPhase } from './components/HeadStatus.js';
import { Welcome } from './components/Welcome.js';
import { runTurn } from './agent/loop.js';
import { readFileTool } from './tools/read_file.js';
import { writeFileTool } from './tools/write_file.js';
import { editFileTool } from './tools/edit_file.js';
import { grepTool } from './tools/grep.js';
import { globTool } from './tools/glob.js';
import { httpFetchTool } from './tools/http_fetch.js';
import { deleteFileTool } from './tools/delete_file.js';
import { createOpenAIClient } from './llm/client.js';
import { loadConfig, type Config } from './config.js';
import { JsonlFileSink, type AuditSink } from './audit/sink.js';
import type OpenAI from 'openai';
import type { AgentEvent, Message, ToolDef, ToolCall } from './agent/types.js';
import { v4 as uuid, v4 as uuidv4 } from 'uuid';

const ERROR_DISPLAY_MS = 1500;

interface ActiveTool {
  id: string;
  name: string;
  args: string;
  state: ActiveToolState;
  /** safety 等级(从 ToolDef.safety 透传);safe 工具不弹 DangerousConfirmBox */
  safety?: 'safe' | 'confirm' | 'dangerous';
  /** 解析后的参数(给 DangerousConfirmBox 展示) */
  parsed?: Record<string, unknown>;
  /** 变更预览内容(由 buildPreview 生成) */
  preview?: string;
}

interface AppProps {
  yolo: boolean;
  allowMutations: boolean;
  cwd: string;
  headlessPrompt?: string;
  config?: Config;
  auditMode: 'default' | 'path' | 'off';
  auditPath?: string;
}

const TOOLS: ToolDef[] = [
  readFileTool, writeFileTool, editFileTool, grepTool, globTool, httpFetchTool, deleteFileTool,
];

export function App({ yolo, allowMutations, cwd, headlessPrompt, config: providedConfig, auditMode, auditPath }: AppProps) {
  const { exit } = useApp();
  const [messages, setMessages] = useState<Message[]>([]);
  const [display, setDisplay] = useState<DisplayMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState(false);
  const [activeTool, setActiveTool] = useState<ActiveTool | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  // Head status
  const [phase, setPhase] = useState<LoopPhase>('idle');
  const [phaseStartMs, setPhaseStartMs] = useState<number>(0);
  const [phaseToolName, setPhaseToolName] = useState<string | undefined>(undefined);
  const [currentTokens, setCurrentTokens] = useState<{ promptTokens: number; completionTokens: number } | undefined>(undefined);
  const [compressStatus, setCompressStatus] = useState<{ before: number; after?: number; startedAt: number } | null>(null);

  const clientRef = useRef<OpenAI | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingResolveRef = useRef<((ok: boolean) => void) | null>(null);
  const auditSinkRef = useRef<AuditSink | null>(null);
  const sessionIdRef = useRef<string>('');

  useEffect(() => {
    const cfg = providedConfig ?? loadConfig();
    setConfig(cfg);
    try {
      clientRef.current = createOpenAIClient(cfg);
    } catch (e) {
      setDisplay([{ id: uuid(), role: 'assistant', content: (e as Error).message }]);
    }
    // 审计 sink 创建 + 写 session_start
    if (auditMode !== 'off') {
      sessionIdRef.current = uuidv4();
      const sessionId = sessionIdRef.current;
      const pid = process.pid;
      let sink: AuditSink;
      if (auditMode === 'path' && auditPath) {
        sink = new JsonlFileSink(auditPath, sessionId, pid);
      } else {
        const dir = path.join(os.homedir(), '.agent', 'audit');
        const file = path.join(dir, `${sessionId}.jsonl`);
        sink = new JsonlFileSink(file, sessionId, pid);
      }
      auditSinkRef.current = sink;
      sink.emit({
        type: 'session_start',
        argv: process.argv,
        cwd: process.cwd(),
        model: cfg.openaiModel,
        provider: cfg.providerName,
        yolo,
        allowMutations,
        node: process.version,
        agentVersion: '0.1.0',
      });
      // 把 user 的第一条 prompt 也作为审计事件(后续 turn 里通过 auditSink 透传)
      if (headlessPrompt) {
        sink.emit({ type: 'user_prompt', role: 'user', content: headlessPrompt });
      }
    }
    if (headlessPrompt) {
      void handleUserInput(headlessPrompt);
    }
    return () => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      const sink = auditSinkRef.current;
      if (sink) {
        void sink.close('normal');
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useInput((input, key) => {
    if (busy && abortRef.current && (key.escape || (key.ctrl && input === 'c'))) {
      abortRef.current.abort();
      return;
    }
    if (activeTool?.state === 'pending') {
      if (input === 'y' || input === 'Y') {
        const r = pendingResolveRef.current;
        pendingResolveRef.current = null;
        setActiveTool(null);
        r?.(true);
      } else if (input === 'n' || input === 'N') {
        const r = pendingResolveRef.current;
        pendingResolveRef.current = null;
        setActiveTool(null);
        r?.(false);
      }
    }
  });

  async function handleUserInput(text: string) {
    if (!clientRef.current || !config) return;
    setStarted(true);
    const userMsg: Message = { role: 'user', content: text };
    const newMsgs: Message[] = [...messages, userMsg];
    setMessages(newMsgs);
    const userDisplay: DisplayMessage = { id: uuid(), role: 'user', content: text };
    const assistantId = uuid();
    setDisplay((d) => [...d, userDisplay, { id: assistantId, role: 'assistant', content: '', streaming: true }]);
    setBusy(true);
    const abort = new AbortController();
    abortRef.current = abort;
    // REPL 路径下需要也 emit user_prompt(headless 路径已在 useEffect 里 emit 过)
    if (!headlessPrompt) {
      auditSinkRef.current?.emit({ type: 'user_prompt', role: 'user', content: text });
    }
    try {
      await runTurn({
        messages: newMsgs,
        tools: TOOLS,
        cwd,
        yolo,
        onEvent: (ev) => applyEvent(ev, assistantId),
        onConfirm: (tc, tool) =>
          new Promise<boolean>((resolve) => {
            pendingResolveRef.current = resolve;
            // 解析参数(失败用空对象,让 DangerousConfirmBox 仍能显示原文)
            let parsed: Record<string, unknown> | undefined;
            try { parsed = JSON.parse(tc.function.arguments); } catch { parsed = undefined; }
            // 生成 preview(异步)— 但 useState 同步,先把基础信息 set 进去,
            // preview 在异步完成后再 setState 覆盖
            setActiveTool({
              id: uuid(),
              name: tc.function.name,
              args: tc.function.arguments,
              state: 'pending',
              safety: tool.safety,
              parsed,
            });
            // 对 confirm / dangerous 工具生成变更预览
            if (tool.safety !== 'safe') {
              void buildPreview(tc.function.name, parsed ?? {}, cwd).then((p) => {
                setActiveTool((cur) =>
                  cur && cur.name === tc.function.name && cur.state === 'pending'
                    ? { ...cur, preview: p.preview, parsed: p.parsed ?? parsed }
                    : cur,
                );
              });
            }
          }),
        signal: abort.signal,
        client: clientRef.current,
        model: config.openaiModel,
        maxContextTokens: config.maxContextTokens,
        extraCtx: {
          writeableExts: config.writeableExts,
          allowMutations,
        },
        auditSink: auditSinkRef.current ?? undefined,
        limits: {
          maxTurns: config.maxTurns,
          maxToolCalls: config.maxToolCalls,
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
    if (ev.type === 'text_delta') {
      setDisplay((d) => {
        const next = [...d];
        const idx = next.findIndex((m) => m.id === assistantId);
        if (idx >= 0) {
          next[idx] = { ...next[idx], content: (next[idx].content ?? '') + ev.delta };
        }
        return next;
      });
      // 解析 [context compressed: X → Y] 给 compressStatus(可能在 phase=compressing 中,也可能在收尾 text_delta 里)
      if (ev.delta.includes('[context compressed:')) {
        const m = ev.delta.match(/\[context compressed:\s*(\d+)\s*→\s*(\d+)/);
        if (m) {
          setCompressStatus((cur) =>
            cur ? { ...cur, before: parseInt(m[1], 10), after: parseInt(m[2], 10) } : { before: parseInt(m[1], 10), after: parseInt(m[2], 10), startedAt: Date.now() },
          );
        }
      }
      return;
    }
    if (ev.type === 'tool_call_start') {
      if (errorTimerRef.current) {
        clearTimeout(errorTimerRef.current);
        errorTimerRef.current = null;
      }
      setActiveTool({
        id: ev.toolCall.id,
        name: ev.toolCall.function.name,
        args: ev.toolCall.function.arguments,
        state: 'running',
      });
      return;
    }
    if (ev.type === 'tool_call_end') {
      const isError = (ev.result ?? '').startsWith('Error:');
      setActiveTool((cur) => {
        if (!cur || cur.id !== ev.toolCallId) return cur;
        if (isError) {
          if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
          errorTimerRef.current = setTimeout(() => {
            setActiveTool((c) => (c?.id === ev.toolCallId ? null : c));
            errorTimerRef.current = null;
          }, ERROR_DISPLAY_MS);
          return { ...cur, state: 'error' };
        }
        return null;
      });
      return;
    }
    if (ev.type === 'phase') {
      if (ev.phase === 'thinking') {
        setPhase('thinking');
        setPhaseStartMs(Date.now());
        setPhaseToolName(undefined);
        setCurrentTokens(undefined);
        setCompressStatus(null);
      } else if (ev.phase === 'executing') {
        setPhase('executing');
        setPhaseStartMs(Date.now());
        setPhaseToolName(ev.toolName);
        setCompressStatus(null);
      } else if (ev.phase === 'compressing') {
        setPhase('compressing');
        setPhaseStartMs(Date.now());
        // before 暂估,等 text_delta 里 [context compressed: X → Y] 解析
        setCompressStatus({ before: 0, startedAt: Date.now() });
      } else {
        setPhase('idle');
        setPhaseToolName(undefined);
        setCurrentTokens(undefined);
        setCompressStatus(null);
      }
      return;
    }
    if (ev.type === 'done' && ev.usage) {
      setCurrentTokens(ev.usage);
      return;
    }
    // user_confirm / llm_usage 仅用于审计;UI 不消费
    if (ev.type === 'user_confirm' || ev.type === 'llm_usage') {
      return;
    }
  }

  // 工具子项(⎿ file.md 风格)— 仅对非 error 状态、非待确认状态展示
  const toolChildren = activeTool && activeTool.state === 'running' ? (
    <Text dimColor>  ⎿  {activeTool.args.length > 60 ? activeTool.args.slice(0, 60) + '…' : activeTool.args}</Text>
  ) : null;

  return (
    <Box flexDirection="column">
      {!started && config && (
        <Welcome
          model={config.openaiModel}
          cwd={cwd}
          provider={config.providerName}
        />
      )}
      <Box flexDirection="column" flexGrow={1} overflowY="hidden">
        <MessageList messages={display} />
      </Box>
      {phase !== 'idle' && (
        <HeadStatus
          phase={phase}
          phaseStartMs={phaseStartMs}
          tokens={currentTokens}
          toolName={phaseToolName}
          compressStatus={compressStatus ?? undefined}
        />
      )}
      {activeTool && activeTool.state !== 'pending' && (
        <ActiveToolLine
          name={activeTool.name}
          args={activeTool.args}
          state={activeTool.state}
        >
          {toolChildren}
        </ActiveToolLine>
      )}
      {activeTool && activeTool.state === 'pending' && activeTool.safety && activeTool.safety !== 'safe' && (
        <DangerousConfirmBox
          name={activeTool.name}
          args={activeTool.args}
          severity={activeTool.safety as ConfirmSeverity}
          parsed={activeTool.parsed}
          preview={activeTool.preview}
        />
      )}
      {activeTool && activeTool.state === 'pending' && activeTool.safety === 'safe' && (
        <ActiveToolLine
          name={activeTool.name}
          args={activeTool.args}
          state="pending"
        />
      )}
      <Box marginTop={1}>
        <InputBox onSubmit={handleUserInput} disabled={busy} />
      </Box>
    </Box>
  );
}