import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Box, Text, useApp, useInput, useStdout, useStdin } from 'ink';
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
import { ApiKeyInput } from './components/ApiKeyInput.js';
import { runTurn } from './agent/loop.js';
import { buildSystemPrompt } from './agent/systemPrompt.js';
import { createSessionState, type TodoItem } from './agent/sessionState.js';
import { parseBuiltinCommand, BUILTIN_COMMAND_LIST, PROVIDER_NAMES } from './agent/commands.js';
import { compactMessages, type CompactProgress } from './agent/context.js';
import { resolveProvider } from './llm/providers.js';
import { applyProviderPreset, saveUserConfig, loadUserConfig, saveApiKey, readApiKeyFromFile, clearApiKey } from './agent/userConfig.js';
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
  // P0.7.4 — /model 或 /config 切到需要 key 的 provider 且 env 没有时,
  // 弹密码输入框让用户输入;输入后写 secrets 文件并完成切换。
  const [pendingApiKey, setPendingApiKey] = useState<{ providerName: string; providerLabel: string } | null>(null);
  // P0.7.6 — paste 队列 ref:useStdin 拦截到 paste 后把纯文本塞这里,
  // InputBox 内部轮询消费插入 cursor。选 ref 而非 callback:避免每 paste
  // 一次就触发父组件 re-render 整个 App 树。
  const pasteQueueRef = useRef<string | null>(null);

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
  // Welcome 实际渲染 19 行(ASCII art 6 + 标题 2 + 状态 3 + 间隔 4 + 边框 2 + 前后 padding 2)。
  // 旧值 6 严重低估,导致 viewport 算成负数,MessageList 把 InputBox 推到屏外。
  const welcomeRows = !started && display.length === 0 ? 19 : 0;
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

  // 拦截 paste(bracketed paste 模式 ESC[200~...ESC[201~)
  //
  // 实现要点:
  // - 必须在 ink 的 `internal_eventEmitter` 的 `input` 事件上监听(而不是
  //   `stdin.on('data', ...)`)。ink 在 raw mode 下用 read() 拉模式消费 stdin,
  //   data 事件在这种情况下根本不 fire。
  // - ink 拿到 chunk 后原样 emit 给 useInput 监听器 — 我们订阅同一个 emitter,
  //   收到 raw chunk,在 InputBox 的 useInput 看到之前剥掉 ESC[200~/ESC[201~ 边界。
  // - 清理后的 paste 文本推 pasteQueueRef,InputBox 内部 setInterval 轮询消费
  //   并 insertAt(cursor)。Ref 避免触发父组件重渲染。
  // - 注意:必须既给 pasteQueueRef 推清洗后的文本,又要"吞掉"原始 chunk,否则
  //   InputBox 的 useInput 收到 `\x1b[200~hello\x1b[201~` 会当普通字符
  //   一个个过 parseKeypress,把 `[200~` 残留进 value。
  const { stdin, internal_eventEmitter } = useStdin();
  useEffect(() => {
    if (!internal_eventEmitter) return;
    const START = '\x1b[200~';
    const END = '\x1b[201~';
    let buf = '';
    let swallowUntil = 0; // 0 = 不吞;> 0 = 还要再吞 N 个 chunk
    const onInput = (chunk: string | Buffer) => {
      const s = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
      // 状态 1: 在 paste 块中 — 全部收集,直到 END
      if (swallowUntil > 0) {
        buf += s;
        const eIdx = buf.indexOf(END);
        if (eIdx >= 0) {
          const pasted = buf.slice(0, eIdx);
          pasteQueueRef.current = (pasteQueueRef.current ?? '') + pasted;
          // END 之后的残余(chunk 末尾可能带新输入,如 paste 完后用户立刻输 X)
          const tail = buf.slice(eIdx + END.length);
          buf = '';
          swallowUntil = 0;
          if (tail) {
            // 残余可能本身就是另一个新输入,或新 paste 起点,递归检查
            processTail(tail);
          }
        }
        return;
      }
      // 状态 2: 正常输入 — 累积到 buf,检查 paste 起点
      buf += s;
      processBuf();
    };
    function processBuf() {
      while (true) {
        const sIdx = buf.indexOf(START);
        if (sIdx < 0) return; // 没看到 START
        const afterStart = sIdx + START.length;
        const eIdx = buf.indexOf(END, afterStart);
        if (eIdx >= 0) {
          // 同一 chunk 内就闭合了
          const pasted = buf.slice(afterStart, eIdx);
          if (pasted) pasteQueueRef.current = (pasteQueueRef.current ?? '') + pasted;
          // 切掉已处理部分(可能一个 chunk 内有多个 paste)
          buf = buf.slice(0, sIdx) + buf.slice(eIdx + END.length);
        } else {
          // 还没收尾:把 START 之前的部分(可能是正常输入)和 START 之后的都
          // 留到 buf,进入 swallow 模式
          // START 之前的部分需要还给 useInput(那是用户的真实键入) — 重新
          // emit 到 emitter 末尾
          const before = buf.slice(0, sIdx);
          buf = buf.slice(sIdx);
          swallowUntil = 1;
          if (before) {
            // 重新 emit,让 useInput 看到 before
            internal_eventEmitter!.emit('input', before);
          }
          return;
        }
      }
    }
    function processTail(s: string) {
      buf = s;
      processBuf();
    }
    internal_eventEmitter.on('input', onInput);
    return () => { internal_eventEmitter.off('input', onInput); };
  }, [internal_eventEmitter]);

  useEffect(() => {
    const cfg = providedConfig ?? loadConfig();
    setConfig(cfg);
    try {
      clientRef.current = createOpenAIClient(cfg);
    } catch (e) {
      // 启动期缺 key → 弹 ApiKeyInput 让用户当场输(P0.7.4 启动路径)
      let preset;
      try { preset = resolveProvider(cfg.providerName); } catch { preset = undefined; }
      if (preset && preset.requiresApiKey) {
        setPendingApiKey({ providerName: preset.id, providerLabel: preset.label });
      } else {
        setDisplay([{ id: uuid(), role: 'assistant', content: (e as Error).message }]);
      }
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
    // P0.7.4: ApiKeyInput 独占输入,App 顶层不抢键
    if (pendingApiKey) {
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
      case 'model': {
        const arg = cmd.args.trim().toLowerCase();
        const cfg = config!;
        if (!arg) {
          // 无参:显示当前 + 列出可切换
          const lines = [
            `当前:`,
            `  provider:  ${cfg.providerName}`,
            `  model:     ${cfg.openaiModel}`,
            `  baseUrl:   ${cfg.openaiBaseUrl}`,
            ``,
            `可用:  /model ${PROVIDER_NAMES.join(' | ')}`,
          ].join('\n');
          setDisplay((d) => [...d, { id: uuid(), role: 'assistant', content: lines }]);
          return;
        }
        await switchProvider(arg);
        return;
      }
      case 'config': {
        const cfg = config!;
        const arg = cmd.args.trim();
        if (!arg) {
          // 无参:列出可用 + 当前
          const lines = [
            `当前 provider: ${cfg.providerName}`,
            `配置: ${loadUserConfig()}`,
            ``,
            `用法:`,
            `  /config --provider ollama`,
            `  /config --provider deepseek`,
            `  /config --provider minimax`,
            `  /config --clear-key <provider>  # 删除已保存的 key,下次切会让你重输`,
            ``,
            `可用: ${PROVIDER_NAMES.join(' | ')}`,
          ].join('\n');
          setDisplay((d) => [...d, { id: uuid(), role: 'assistant', content: lines }]);
          return;
        }
        // 解析 --clear-key X(P0.7.5):清掉 secrets 里的 key,让下次 /model 弹框重输
        const ck = arg.match(/^--clear-key\s+(\S+)$/i);
        if (ck) {
          const name = ck[1].toLowerCase();
          if (!(PROVIDER_NAMES as readonly string[]).includes(name)) {
            setDisplay((d) => [...d, {
              id: uuid(), role: 'assistant',
              content: `[/config] 未知 provider: "${name}"\n可用: ${PROVIDER_NAMES.join(' | ')}`,
            }]);
            return;
          }
          const removed = clearApiKey(name);
          // 如果当前 session 正在用被清掉的 provider,也要清掉 process.env
          // 防止已加载到内存的 client 仍带旧 key
          setDisplay((d) => [...d, {
            id: uuid(), role: 'assistant',
            content: removed
              ? `✓ 已删除 ${name} 的 key。\n下次 /model ${name} 会让你重新输入。`
              : `[/config] ${name} 没有保存的 key,无需删除。`,
          }]);
          return;
        }
        // 解析 --provider X
        const m = arg.match(/^--provider\s+(\S+)$/i);
        if (!m) {
          setDisplay((d) => [...d, {
            id: uuid(), role: 'assistant',
            content: `[/config] 暂只支持 --provider <name> 或 --clear-key <name>\n已知 provider: ${PROVIDER_NAMES.join(', ')}`,
          }]);
          return;
        }
        await switchProvider(m[1].toLowerCase());
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
   * P0.7.1 / P0.7.2 — 切换当前 provider preset 并 reload config + client。
   * 不会动已压缩的 messages(只影响后续 LLM 调用的 model / baseUrl)。
   *
   * P0.7.4 — 如果 target provider 需要 API key 且 env / secrets 文件都没有,
   * 弹 ApiKeyInput 让用户输入(不直接拒绝)。用户取消则保持当前 provider。
   */
  async function switchProvider(name: string) {
    if (!(PROVIDER_NAMES as readonly string[]).includes(name)) {
      setDisplay((d) => [...d, {
        id: uuid(), role: 'assistant',
        content: `[/model] 未知 provider: "${name}"\n可用: ${PROVIDER_NAMES.join(' | ')}`,
      }]);
      return;
    }
    let preset;
    try {
      preset = resolveProvider(name);
    } catch (e) {
      setDisplay((d) => [...d, { id: uuid(), role: 'assistant', content: (e as Error).message }]);
      return;
    }
    // P0.7.4: 需要 key 但没有来源(env + secrets 都没有)→ 弹密码输入框
    // 注意:必须查 secrets 文件(不只是 env),否则第二次 /model 切到同一个 provider
    // 就会绕过 ApiKeyInput(尽管 secrets 里有 key),用户察觉不到。
    const hasKey = !!process.env.OPENAI_API_KEY || !!readApiKeyFromFile(name);
    if (preset.requiresApiKey && !hasKey) {
      // 先持久化 preset 默认 baseUrl/model,这样用户取消也能保留 preset
      const merged = applyProviderPreset(loadUserConfig(), name);
      saveUserConfig(merged);
      setPendingApiKey({ providerName: name, providerLabel: preset.label });
      return;
    }
    finishSwitchProvider(name, preset);
  }

  /**
   * 实际写盘 + reload config + 切 client 的收尾动作。
   * 被 switchProvider 和 ApiKeyInput.onSubmit 共同调用。
   */
  function finishSwitchProvider(
    name: string,
    preset: ReturnType<typeof resolveProvider>,
  ) {
    const merged = applyProviderPreset(loadUserConfig(), name);
    saveUserConfig(merged);
    const newCfg = loadConfig({ provider: name });
    setConfig(newCfg);
    try {
      clientRef.current = createOpenAIClient(newCfg);
    } catch (e) {
      setDisplay((d) => [...d, { id: uuid(), role: 'assistant', content: `client init failed: ${(e as Error).message}` }]);
      return;
    }
    const lines = [
      `✓ 已切换到 ${preset.label}`,
      `  baseUrl: ${preset.baseUrl}`,
      `  model:   ${preset.defaultModel}`,
      `  配置已写入 ~/.agent/config.json`,
    ];
    if (preset.requiresApiKey) {
      lines.push(``, `API key 已保存(下次启动会自动加载)`);
    } else {
      lines.push(``, `本地 provider,使用占位 key`);
    }
    setDisplay((d) => [...d, { id: uuid(), role: 'assistant', content: lines.join('\n') }]);
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
    }
    if (ev.type === 'done') {
      // finishReason 提示:error / limit / length 都要让用户看到
      const fr = ev.finishReason;
      if (fr === 'error' || fr === 'limit' || fr === 'length') {
        const note = fr === 'error'
          ? '\n\n⚠ LLM 调用失败,上一段没有内容即因此。'
          : fr === 'limit'
            ? '\n\n⚠ 达到 tool call 上限,已停止。'
            : '\n\n⚠ 达到 token 上限,回复被截断。';
        setDisplay((d) => {
          const next = [...d];
          const idx = next.findIndex((m) => m.id === assistantId);
          if (idx >= 0) {
            next[idx] = { ...next[idx], content: (next[idx].content ?? '') + note, streaming: false };
          } else {
            next.push({ id: uuid(), role: 'assistant', content: note, streaming: false });
          }
          return next;
        });
      }
      return;
    }
    if (ev.type === 'error') {
      // LLM 调用抛错时(loop 顶部 catch + runTurn 最外层 catch 都会 emit),
      // 把错误文本追加到当前 streaming 消息;找不到就新建一条 assistant。
      setDisplay((d) => {
        const next = [...d];
        const idx = next.findIndex((m) => m.id === assistantId);
        const errText = `\n\n⚠ ${ev.error}`;
        if (idx >= 0) {
          next[idx] = { ...next[idx], content: (next[idx].content ?? '') + errText, streaming: false };
        } else {
          next.push({ id: uuid(), role: 'assistant', content: `⚠ ${ev.error}`, streaming: false });
        }
        return next;
      });
      return;
    }
    // user_confirm / llm_usage / todo_updated / ask_user / ask_user_resolved 仅用于审计/旁路
    if (ev.type === 'user_confirm' || ev.type === 'llm_usage'
        || ev.type === 'todo_updated' || ev.type === 'ask_user' || ev.type === 'ask_user_resolved') {
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
      {pendingApiKey && (
        <ApiKeyInput
          providerLabel={pendingApiKey.providerLabel}
          envVar={resolveProvider(pendingApiKey.providerName).apiKeyEnv ?? 'OPENAI_API_KEY'}
          onSubmit={(key) => {
            const target = pendingApiKey;
            setPendingApiKey(null);
            try {
              saveApiKey(target.providerName, key);
              // key 写盘后,临时注入 env 让本次 reload 也能拿到
              process.env.OPENAI_API_KEY = key;
              const preset = resolveProvider(target.providerName);
              // 启动期 vs 切换期走同一份收尾逻辑:写盘 + reload config + 创建 client。
              // 文案 "已切换" 在启动期也合适(从无到启用 minimax)。
              finishSwitchProvider(target.providerName, preset);
            } catch (e) {
              setDisplay((d) => [...d, { id: uuid(), role: 'assistant', content: `保存 key 失败: ${(e as Error).message}` }]);
            }
          }}
          onCancel={() => {
            const target = pendingApiKey;
            setPendingApiKey(null);
            setDisplay((d) => [...d, {
              id: uuid(), role: 'assistant',
              content: `未输入 key。你可以 /model ${target.providerName} 重新触发,或 export OPENAI_API_KEY 后重启。`,
            }]);
          }}
        />
      )}
      <Box marginTop={1}>
        <InputBox
          onSubmit={handleUserInput}
          disabled={busy}
          externalPasteRef={pasteQueueRef}
        />
      </Box>
    </Box>
  );
}