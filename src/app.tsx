import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import path from 'node:path';
import os from 'node:os';
import { MessageList, type DisplayMessage } from './components/MessageList.js';
import { InputBox } from './components/InputBox.js';
import { ActiveToolLine, type ActiveToolState } from './components/ActiveToolLine.js';
import { DangerousConfirmBox, type ConfirmSeverity } from './components/DangerousConfirmBox.js';
import { buildPreview } from './components/buildPreview.js';
import { HeadStatus, type LoopPhase } from './components/HeadStatus.js';
import { Welcome } from './components/Welcome.js';
import { AskUserDialog } from './components/AskUserDialog.js';
import { TodoList } from './components/TodoList.js';
import { CompactProgressBar } from './components/CompactProgressBar.js';
import { runTurn } from './agent/loop.js';
import { buildSystemPrompt } from './agent/systemPrompt.js';
import { createSessionState, type TodoItem } from './agent/sessionState.js';
import { parseBuiltinCommand, BUILTIN_COMMAND_LIST } from './agent/commands.js';
import { compactMessages, type CompactProgress } from './agent/context.js';
import { fallbackSummary, loadCompactInstructions, summarizeConversation } from './agent/summarizer.js';
import { readFileTool } from './tools/read_file.js';
import { writeFileTool } from './tools/write_file.js';
import { editFileTool } from './tools/edit_file.js';
import { grepTool } from './tools/grep.js';
import { globTool } from './tools/glob.js';
import { httpFetchTool } from './tools/http_fetch.js';
import { deleteFileTool } from './tools/delete_file.js';
import { todoWriteTool } from './tools/todo_write.js';
import { askUserQuestionTool } from './tools/ask_user_question.js';
import { createOpenAIClient } from './llm/client.js';
import { loadConfig, type Config } from './config.js';
import { JsonlFileSink, type AuditSink } from './audit/sink.js';
import type OpenAI from 'openai';
import type { AgentEvent, Message, ToolDef, ToolCall, AskUserRequest, AskUserAnswer } from './agent/types.js';
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
  agentVersion: string;
}

const TOOLS: ToolDef[] = [
  readFileTool, writeFileTool, editFileTool, grepTool, globTool, httpFetchTool, deleteFileTool,
  todoWriteTool, askUserQuestionTool,
];

export function App({ yolo, allowMutations, cwd, headlessPrompt, config: providedConfig, auditMode, auditPath, agentVersion }: AppProps) {
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
  // P0.6: 手动 /compact 进度状态(可观测的阶段事件)
  const [compactProgress, setCompactProgress] = useState<CompactProgress | null>(null);

  const clientRef = useRef<OpenAI | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingResolveRef = useRef<((ok: boolean) => void) | null>(null);
  const auditSinkRef = useRef<AuditSink | null>(null);
  const sessionIdRef = useRef<string>('');

  // v0.4 — Session state (todos) + AskUserQuestion 交互桥
  const sessionState = React.useMemo(() => createSessionState(), []);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [pendingQuestion, setPendingQuestion] = useState<AskUserRequest | null>(null);
  const pendingAskResolveRef = useRef<((a: AskUserAnswer | '__canceled__') => void) | null>(null);

  // 终端高度 — 用来给 conversation viewport 算固定高度,避免长对话把 prompt 推到屏幕外
  const { stdout } = useStdout();
  const [terminalRows, setTerminalRows] = useState<number>(stdout?.rows ?? 24);
  useEffect(() => {
    if (!stdout) return;
    const onResize = () => setTerminalRows(stdout.rows ?? 24);
    stdout.on('resize', onResize);
    onResize();
    return () => { stdout.off('resize', onResize); };
  }, [stdout]);

  // 非消息区固定行数预算:
  //   HeadStatus ≈ 2 行,ActiveToolLine ≈ 2 行,Confirm/Question 弹窗 ≈ 5 行,
  //   InputBox+margin ≈ 3 行,padding ≈ 2 行,TodoList 按 todos 数动态追加。
  const FIXED_NON_MSG = 14;
  // Welcome 只在首屏显示若干行,首屏后空出空间
  const todoRows = todos.length > 0 ? todos.length + 3 : 0;
  const welcomeRows = !started && display.length === 0 ? 6 : 0;
  const viewportRows = Math.max(
    3,
    terminalRows - FIXED_NON_MSG - todoRows - welcomeRows,
  );
  // 每条消息估 3 行(marginY 上下 + 1 行内容);长回复会占更多行,
  // 这里只控制"消息条数",内容超出靠 MessageList 内部 overflow="hidden" 裁剪
  const maxMessages = Math.max(2, Math.floor(viewportRows / 3));

  useEffect(() => {
    sessionState.onChange = (next) => setTodos(next);
    return () => { sessionState.onChange = undefined; };
  }, [sessionState]);

  const onAskUser = useCallback((req: AskUserRequest): Promise<AskUserAnswer> => {
    return new Promise((resolve) => {
      pendingAskResolveRef.current = resolve as (a: AskUserAnswer | '__canceled__') => void;
      setPendingQuestion(req);
    });
  }, []);

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
        agentVersion,
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
    // 优先级最高:question dialog 路由(独占)
    // AskUserDialog 内部 useInput 已经处理方向键/空格/回车/Esc,
    // 这里只需要让出 input 事件给子组件(ink 会自动路由)
    if (pendingQuestion) {
      return;
    }
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

  /**
   * 执行一个内置 slash command(P0.5)。
   * 不会调用 chatCompletionStream,只操作本地 state / display。
   */
  async function executeBuiltinCommand(cmd: ReturnType<typeof parseBuiltinCommand>) {
    if (!cmd) return;
    const id = uuid();
    const echo: DisplayMessage = { id, role: 'user', content: `/${cmd.type === 'unknown' ? cmd.name : cmd.type}` };
    setDisplay((d) => [...d, echo]);

    switch (cmd.type) {
      case 'help': {
        const lines = BUILTIN_COMMAND_LIST.map((c) => `  /${c.name.padEnd(8)} ${c.description}`).join('\n');
        setDisplay((d) => [...d, { id: uuid(), role: 'assistant', content: `内置命令:\n${lines}` }]);
        return;
      }
      case 'clear': {
        // 清空显示,但保留真实 messages / audit log
        setDisplay([]);
        return;
      }
      case 'reset': {
        // 清空 session 状态:下一轮会重新注入 system prompt
        setMessages([]);
        setDisplay([]);
        sessionState.reset?.();
        return;
      }
      case 'status': {
        const cfg = config!;
        const lines = [
          `model:      ${cfg.openaiModel}`,
          `provider:   ${cfg.providerName}`,
          `baseUrl:    ${cfg.openaiBaseUrl}`,
          `cwd:        ${cwd}`,
          `messages:   ${messages.length}`,
          `todos:      ${todos.length}`,
          `agent ver:  ${agentVersion}`,
        ].join('\n');
        setDisplay((d) => [...d, { id: uuid(), role: 'assistant', content: lines }]);
        return;
      }
      case 'compact': {
        // 手动 /compact — 复用 summarizer + fallback,带阶段进度反馈
        await runManualCompact();
        return;
      }
      case 'unknown': {
        setDisplay((d) => [...d, { id: uuid(), role: 'assistant', content: `未知命令: /${cmd.name}\n输入 /help 查看支持列表。` }]);
        return;
      }
    }
  }

  /**
   * P0.6 手动 /compact 实现:
   * - 调 compactMessages(),通过 onProgress 推 compactProgress state
   * - 完成后用 setMessages 替换 messages,效果与 runTurn 内自动压缩一致
   * - 不调用 chatCompletionStream(summarizer 内部不算 — 它走的是和 runTurn 一样的 LLM)
   */
  async function runManualCompact() {
    if (busy) {
      setDisplay((d) => [...d, { id: uuid(), role: 'assistant', content: '[/compact] 当前正在执行,忽略' }]);
      return;
    }
    if (messages.length === 0) {
      setDisplay((d) => [...d, { id: uuid(), role: 'assistant', content: '[/compact] 没有消息可压缩' }]);
      return;
    }
    setBusy(true);
    const client = clientRef.current;
    if (!client || !config) {
      setBusy(false);
      return;
    }
    try {
      const r = await compactMessages(messages, {
        summarizer: async (text) => {
          const compactInstructions = await loadCompactInstructions(cwd);
          return await summarizeConversation({
            client, model: config.openaiModel, text,
            signal: new AbortController().signal,
            compactInstructions,
            focus: 'Manual /compact triggered by user.',
          });
        },
        fallback: (text) => fallbackSummary(text),
        loadInstructions: async () => loadCompactInstructions(cwd),
        onProgress: (ev) => setCompactProgress(ev),
      });
      if (r.nothing) {
        // nothing_to_compact 阶段已经覆盖了"消息太少"
        return;
      }
      if (r.fallback) {
        setDisplay((d) => [...d, { id: uuid(), role: 'assistant', content: '[/compact] 完成(走 fallback,summarizer 失败)' }]);
      } else {
        setDisplay((d) => [...d, { id: uuid(), role: 'assistant', content: '[/compact] 完成' }]);
      }
      // 用压缩后的 messages 替换 state
      setMessages(r.messages);
    } catch (e) {
      setDisplay((d) => [...d, { id: uuid(), role: 'assistant', content: `[/compact] 失败: ${(e as Error).message}` }]);
      setCompactProgress({ phase: 'error', percent: 100, error: (e as Error).message });
    } finally {
      setBusy(false);
      // 进度条保留 5 秒后清掉,给用户看完成状态
      setTimeout(() => setCompactProgress(null), 5000);
    }
  }

  async function handleUserInput(text: string) {
    if (!clientRef.current || !config) return;
    // 内置 slash command 分流(P0.5):
    // 确定性本地操作不进 LLM,直接由 App 处理。
    const builtin = parseBuiltinCommand(text);
    if (builtin) {
      await executeBuiltinCommand(builtin);
      return;
    }
    setStarted(true);
    const userMsg: Message = { role: 'user', content: text };
    const sysMsg: Message = { role: 'system', content: buildSystemPrompt() };
    // 只在第一轮注入(没 assistant 消息时);后续轮不重复
    const baseMsgs = messages.length === 0 || messages.every((m) => m.role !== 'assistant')
      ? [sysMsg, ...messages]
      : messages;
    const newMsgs: Message[] = [...baseMsgs, userMsg];
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
        sessionState,
        onAskUser,
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
      <TodoList todos={todos} />
      <Box flexDirection="column" flexGrow={1} overflowY="hidden" overflowX="hidden" height={viewportRows}>
        <MessageList messages={display} maxMessages={maxMessages} />
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
      {compactProgress && <CompactProgressBar event={compactProgress} />}
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
      {pendingQuestion && (
        <AskUserDialog
          question={pendingQuestion.question}
          options={pendingQuestion.options}
          multiSelect={pendingQuestion.multiSelect}
          onResolve={(ans) => {
            setPendingQuestion(null);
            if (ans === '__canceled__') {
              pendingAskResolveRef.current?.('__canceled__');
            } else {
              pendingAskResolveRef.current?.(ans as AskUserAnswer);
            }
            pendingAskResolveRef.current = null;
          }}
        />
      )}
      <Box marginTop={1}>
        <InputBox onSubmit={handleUserInput} disabled={busy} />
      </Box>
    </Box>
  );
}