# 终端 Agent 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个本地运行的 TypeScript 终端 agent,在 REPL 中接收自然语言目标,自动拆解步骤、调用工具(读/写/搜索/抓网页)直到完成,通过 OpenAI 兼容协议接入任意 LLM。

**Architecture:** Ink 写 TUI,手写 ReAct 循环(不依赖 LangChain/AI SDK),`openai` SDK 调 LLM。`agent/loop.ts` 是纯异步函数,与 Ink 解耦,便于单测。安全分三级(safe/confirm/dangerous)+ 沙箱(路径 resolveWithinCwd + 写后缀白名单)+ 错误回灌 LLM。

**Tech Stack:** TypeScript 5.x · Node 20+ · Ink 5 · `openai` SDK · `zod` · `gpt-tokenizer` · `fast-glob` · `vitest`

---

## 文件总览(实施前先建立)

```
src/
├── cli.tsx                # 入口:启动 Ink 渲染 <App/>,parseArgs
├── app.tsx                # 根组件,管理 REPL 状态、AgentEvent → 状态转换
├── config.ts              # 读 env + ~/.agent/config.json
├── components/
│   ├── MessageList.tsx    # 滚动消息流
│   ├── ToolTrace.tsx      # 单个工具调用可视化(参数+结果+确认)
│   └── InputBox.tsx       # 多行输入 + 历史
├── agent/
│   ├── types.ts           # Message / ToolCall / AgentEvent / RunTurnInput/Result
│   ├── loop.ts            # 核心 ReAct 循环(纯异步)
│   ├── context.ts         # 滑动窗口 + 摘要压缩
│   ├── tools.ts           # 工具注册中心(registerTool, getToolDefinitions)
│   └── schema.ts          # zodToJsonSchema(zodSchema) → OpenAI tool 格式
├── tools/
│   ├── read_file.ts
│   ├── write_file.ts
│   ├── edit_file.ts
│   ├── grep.ts
│   ├── glob.ts
│   └── http_fetch.ts
├── safety/
│   ├── sandbox.ts         # resolveWithinCwd, assertWritableExt
│   └── errors.ts          # SandboxError, ToolError
├── llm/
│   ├── client.ts          # createOpenAIClient() 读 env
│   └── stream.ts          # chatCompletionStream(messages, tools) → AsyncIterable<AgentEvent>
└── __tests__/             # 全部 vitest
    ├── sandbox.test.ts
    ├── schema.test.ts
    ├── context.test.ts
    ├── stream.test.ts
    ├── loop.test.ts
    ├── tools/
    │   ├── read_file.test.ts
    │   ├── write_file.test.ts
    │   ├── edit_file.test.ts
    │   ├── grep.test.ts
    │   ├── glob.test.ts
    │   └── http_fetch.test.ts
    └── e2e/
        └── happy_path.test.ts
```

**根目录文件**:`package.json` · `tsconfig.json` · `vitest.config.ts` · `.env.example` · `.gitignore` · `README.md`

---

## Task 1: 项目脚手架 + package.json + tsconfig

**Files:**
- Create: `/Users/eryiya/Documents/AI-info/agent/package.json`
- Create: `/Users/eryiya/Documents/AI-info/agent/tsconfig.json`
- Create: `/Users/eryiya/Documents/AI-info/agent/vitest.config.ts`
- Create: `/Users/eryiya/Documents/AI-info/agent/.gitignore`
- Create: `/Users/eryiya/Documents/AI-info/agent/.env.example`

- [ ] **Step 1: 写 `package.json`**

```json
{
  "name": "agent",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "agent": "./dist/cli.js"
  },
  "scripts": {
    "dev": "tsx src/cli.tsx",
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "openai": "^4.55.0",
    "ink": "^5.0.1",
    "@inkjs/ui": "^2.0.0",
    "ink-text-input": "^6.0.0",
    "zod": "^3.23.8",
    "zod-to-json-schema": "^3.23.2",
    "gpt-tokenizer": "^2.5.0",
    "fast-glob": "^3.3.2",
    "chalk": "^5.3.0",
    "uuid": "^10.0.0",
    "react": "^18.3.1"
  },
  "devDependencies": {
    "@types/node": "^22.5.0",
    "@types/react": "^18.3.5",
    "@types/uuid": "^10.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.5.4",
    "vitest": "^2.1.1"
  }
}
```

- [ ] **Step 2: 写 `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "dist",
    "rootDir": "src",
    "resolveJsonModule": true,
    "isolatedModules": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "src/__tests__/**"]
}
```

- [ ] **Step 3: 写 `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/__tests__/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
});
```

- [ ] **Step 4: 写 `.gitignore`**

```
node_modules/
dist/
.env
.env.local
coverage/
*.log
```

- [ ] **Step 5: 写 `.env.example`**

```
OPENAI_API_KEY=sk-xxx
OPENAI_BASE_URL=https://api.deepseek.com/v1
OPENAI_MODEL=deepseek-chat
AGENT_MAX_CONTEXT_TOKENS=120000
```

- [ ] **Step 6: 安装依赖**

Run: `cd /Users/eryiya/Documents/AI-info/agent && npm install`
Expected: 安装成功,生成 `node_modules/` 和 `package-lock.json`

- [ ] **Step 7: 验证 typecheck 通过**

Run: `cd /Users/eryiya/Documents/AI-info/agent && npx tsc --noEmit`
Expected: 无输出,exit 0(`src/` 还没东西所以必然通过)

- [ ] **Step 8: 提交**

```bash
cd /Users/eryiya/Documents/AI-info/agent
git add package.json tsconfig.json vitest.config.ts .gitignore .env.example package-lock.json
git commit -m "chore: 项目脚手架(包、tsconfig、vitest)"
```

---

## Task 2: 核心类型定义(agent/types.ts)

**Files:**
- Create: `src/agent/types.ts`

- [ ] **Step 1: 写 `src/agent/types.ts`**

```ts
import type { ZodType } from 'zod';

/** LLM API 返回的原始消息角色 */
export type Role = 'system' | 'user' | 'assistant' | 'tool';

/** 工具描述(给 LLM 看) */
export interface ToolDescriptor {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>; // JSON Schema
  };
}

/** 工具定义(开发者写) */
export interface ToolDef<I = unknown, O = unknown> {
  name: string;
  description: string;
  safety: 'safe' | 'confirm' | 'dangerous';
  schema: ZodType<I>;
  execute(input: I, ctx: ToolCtx): Promise<O>;
}

/** 工具执行上下文 */
export interface ToolCtx {
  cwd: string;
  abort: AbortSignal;
  confirmedByUser: boolean;
  /** 可选扩展:由 loop 注入,工具按需读取 */
  writeableExts?: string[];
  allowMutations?: boolean;
}

/** 消息(OpenAI Chat Completions 风格) */
export interface Message {
  role: Role;
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

/** 一次工具调用(LLM 发起) */
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

/** Loop 推给 UI 的事件 */
export type AgentEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_call_start'; toolCall: ToolCall }
  | { type: 'tool_call_end'; toolCallId: string; result: string; error?: string }
  | { type: 'done'; finishReason: 'stop' | 'length' | 'abort' | 'error'; usage?: { promptTokens: number; completionTokens: number } }
  | { type: 'error'; error: string };

/** Loop 输入 */
export interface RunTurnInput {
  messages: Message[];
  tools: ToolDef[];
  cwd: string;
  yolo: boolean;
  onEvent: (e: AgentEvent) => void;
  onConfirm: (toolCall: ToolCall, tool: ToolDef) => Promise<boolean>;
  signal: AbortSignal;
  // 由 cli/loop 注入的实际依赖
  client: import('openai').default;
  model: string;
  maxContextTokens: number;
  /** 透传给 ToolCtx 的额外字段,如 writeableExts / allowMutations */
  extraCtx?: Record<string, unknown>;
}

/** Loop 输出 */
export interface RunTurnResult {
  messages: Message[];
  finishReason: 'stop' | 'length' | 'abort' | 'error';
}
```

- [ ] **Step 2: 验证编译通过**

Run: `cd /Users/eryiya/Documents/AI-info/agent && npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 3: 提交**

```bash
cd /Users/eryiya/Documents/AI-info/agent
git add src/agent/types.ts
git commit -m "feat(agent): 核心类型定义"
```

---

## Task 3: 沙箱与错误类型(TDD)

**Files:**
- Create: `src/safety/errors.ts`
- Create: `src/safety/sandbox.ts`
- Create: `src/__tests__/sandbox.test.ts`

- [ ] **Step 1: 写失败测试 `src/__tests__/sandbox.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { resolveWithinCwd, assertWritableExt } from '../safety/sandbox.js';
import { SandboxError } from '../safety/errors.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

describe('resolveWithinCwd', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-sb-'));

  it('相对路径解析到 cwd', () => {
    expect(resolveWithinCwd('foo.txt', cwd)).toBe(path.join(cwd, 'foo.txt'));
  });

  it('绝对路径在 cwd 内允许', () => {
    const abs = path.join(cwd, 'sub', 'a.ts');
    expect(resolveWithinCwd(abs, cwd)).toBe(abs);
  });

  it('.. 跳出 cwd 抛 SandboxError', () => {
    expect(() => resolveWithinCwd('../escape.txt', cwd)).toThrow(SandboxError);
  });

  it('绝对路径在 cwd 外抛 SandboxError', () => {
    expect(() => resolveWithinCwd('/etc/passwd', cwd)).toThrow(SandboxError);
  });

  it('cwd 本身允许', () => {
    expect(resolveWithinCwd('.', cwd)).toBe(cwd);
  });

  it('符号链接跳出 cwd 抛 SandboxError', () => {
    const target = path.join(cwd, '..', 'outside.txt');
    fs.writeFileSync(target, 'x');
    const link = path.join(cwd, 'link.txt');
    try {
      fs.symlinkSync(target, link);
      expect(() => resolveWithinCwd(link, cwd)).toThrow(SandboxError);
    } finally {
      fs.unlinkSync(target);
    }
  });

  it('空字符串抛 SandboxError', () => {
    expect(() => resolveWithinCwd('', cwd)).toThrow(SandboxError);
  });
});

describe('assertWritableExt', () => {
  const allowed = ['.md', '.ts', '.txt'];

  it('白名单内后缀通过', () => {
    expect(() => assertWritableExt('/a/b/c.ts', allowed)).not.toThrow();
  });

  it('大小写不敏感', () => {
    expect(() => assertWritableExt('/a/b/C.TS', allowed)).not.toThrow();
  });

  it('白名单外后缀抛错', () => {
    expect(() => assertWritableExt('/a/b/c.exe', allowed)).toThrow(SandboxError);
  });

  it('无后缀抛错', () => {
    expect(() => assertWritableExt('/a/b/Makefile', allowed)).toThrow(SandboxError);
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `cd /Users/eryiya/Documents/AI-info/agent && npx vitest run src/__tests__/sandbox.test.ts`
Expected: FAIL("Cannot find module '../safety/sandbox.js'")

- [ ] **Step 3: 写 `src/safety/errors.ts`**

```ts
export class SandboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SandboxError';
  }
}

export class ToolError extends Error {
  constructor(
    public toolName: string,
    message: string,
  ) {
    super(message);
    this.name = 'ToolError';
  }
}
```

- [ ] **Step 4: 写 `src/safety/sandbox.ts`**

```ts
import path from 'node:path';
import fs from 'node:fs';
import { SandboxError } from './errors.js';

/**
 * 把用户提供的路径解析成绝对路径,并断言它在 cwd 内。
 * 解析真实路径(跟随符号链接)后再做边界检查。
 */
export function resolveWithinCwd(p: string, cwd: string): string {
  if (!p || p.trim() === '') {
    throw new SandboxError('path is empty');
  }
  const abs = path.isAbsolute(p) ? p : path.resolve(cwd, p);
  let real: string;
  try {
    real = fs.realpathSync(abs);
  } catch {
    // 路径不存在 —— 用未跟随链接的解析,允许新建文件
    real = path.resolve(abs);
  }
  const rel = path.relative(cwd, real);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new SandboxError(`Path escapes cwd: ${p}`);
  }
  return real;
}

export function assertWritableExt(absPath: string, allowedExts: string[]): void {
  const ext = path.extname(absPath).toLowerCase();
  if (!allowedExts.includes(ext)) {
    throw new SandboxError(`Extension not in write-allowlist: "${ext || '(none)'}"`);
  }
}
```

- [ ] **Step 5: 运行测试,确认通过**

Run: `cd /Users/eryiya/Documents/AI-info/agent && npx vitest run src/__tests__/sandbox.test.ts`
Expected: 11 passed

- [ ] **Step 6: 提交**

```bash
cd /Users/eryiya/Documents/AI-info/agent
git add src/safety/ src/__tests__/sandbox.test.ts
git commit -m "feat(safety): 沙箱路径解析 + 写后缀白名单"
```

---

## Task 4: zod → JSON Schema 转换(TDD)

**Files:**
- Create: `src/agent/schema.ts`
- Create: `src/__tests__/schema.test.ts`

- [ ] **Step 1: 写失败测试 `src/__tests__/schema.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { toolDescriptor, zodToJsonSchema } from '../agent/schema.js';

describe('zodToJsonSchema', () => {
  it('转换 string zod', () => {
    const s = zodToJsonSchema(z.string());
    expect(s).toEqual({ type: 'string' });
  });

  it('转换 object with optional field', () => {
    const s = zodToJsonSchema(
      z.object({
        path: z.string(),
        offset: z.number().int().nonnegative().optional(),
        limit: z.number().int().positive().optional(),
      }),
    );
    expect(s).toMatchObject({
      type: 'object',
      properties: {
        path: { type: 'string' },
        offset: { type: 'number' },
        limit: { type: 'number' },
      },
      required: ['path'],
    });
  });

  it('转换 enum', () => {
    const s = zodToJsonSchema(z.enum(['GET', 'POST']));
    expect(s).toEqual({ type: 'string', enum: ['GET', 'POST'] });
  });

  it('转换 nested object', () => {
    const s = zodToJsonSchema(
      z.object({
        url: z.string().url(),
        headers: z.record(z.string()).optional(),
      }),
    );
    expect(s).toMatchObject({
      type: 'object',
      properties: {
        url: { type: 'string', format: 'uri' },
        headers: { type: 'object', additionalProperties: { type: 'string' } },
      },
      required: ['url'],
    });
  });
});

describe('toolDescriptor', () => {
  it('包装为 OpenAI tool 格式', () => {
    const d = toolDescriptor({
      name: 'read_file',
      description: 'Read a file from disk',
      safety: 'safe',
      schema: z.object({ path: z.string() }),
      execute: async () => '',
    });
    expect(d).toEqual({
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read a file from disk',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      },
    });
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `cd /Users/eryiya/Documents/AI-info/agent && npx vitest run src/__tests__/schema.test.ts`
Expected: FAIL("Cannot find module")

- [ ] **Step 3: 实现 `src/agent/schema.ts`**

```ts
import { zodToJsonSchema as zodToJsonSchemaImpl } from 'zod-to-json-schema';
import type { z, ZodType } from 'zod';
import type { ToolDef, ToolDescriptor } from './types.js';

export function zodToJsonSchema(schema: ZodType): Record<string, unknown> {
  return zodToJsonSchemaImpl(schema) as Record<string, unknown>;
}

export function toolDescriptor<I>(tool: ToolDef<I>): ToolDescriptor {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: zodToJsonSchema(tool.schema),
    },
  };
}

/** 辅助:从 ToolDef 推断入参类型 */
export type InferToolInput<T> = T extends ToolDef<infer I> ? I : never;
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `cd /Users/eryiya/Documents/AI-info/agent && npx vitest run src/__tests__/schema.test.ts`
Expected: 5 passed

- [ ] **Step 5: 提交**

```bash
cd /Users/eryiya/Documents/AI-info/agent
git add src/agent/schema.ts src/__tests__/schema.test.ts
git commit -m "feat(agent): zod → JSON Schema 转换"
```

---

## Task 5: 工具注册中心

**Files:**
- Create: `src/agent/tools.ts`

- [ ] **Step 1: 写 `src/agent/tools.ts`**

```ts
import { toolDescriptor } from './schema.js';
import type { ToolDef, ToolDescriptor } from './types.js';

/** 把一组工具转成 OpenAI 工具描述(发给 LLM) */
export function getToolDescriptors(tools: ToolDef[]): ToolDescriptor[] {
  return tools.map(toolDescriptor);
}

/** 按 name 查工具 */
export function findTool(tools: ToolDef[], name: string): ToolDef | undefined {
  return tools.find((t) => t.name === name);
}
```

- [ ] **Step 2: 验证 typecheck**

Run: `cd /Users/eryiya/Documents/AI-info/agent && npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 3: 提交**

```bash
cd /Users/eryiya/Documents/AI-info/agent
git add src/agent/tools.ts
git commit -m "feat(agent): 工具注册中心"
```

---

## Task 6: 五个 safe/confirm 工具(read_file, write_file, edit_file, grep, glob)

**Files:**
- Create: `src/tools/read_file.ts`
- Create: `src/tools/write_file.ts`
- Create: `src/tools/edit_file.ts`
- Create: `src/tools/grep.ts`
- Create: `src/tools/glob.ts`
- Create: `src/__tests__/tools/read_file.test.ts`
- Create: `src/__tests__/tools/write_file.test.ts`
- Create: `src/__tests__/tools/edit_file.test.ts`
- Create: `src/__tests__/tools/grep.test.ts`
- Create: `src/__tests__/tools/glob.test.ts`

- [ ] **Step 1: 写 `src/tools/read_file.ts`**

```ts
import { z } from 'zod';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveWithinCwd } from '../safety/sandbox.js';
import { ToolError } from '../safety/errors.js';
import type { ToolDef, ToolCtx } from '../agent/types.js';

const MAX_BYTES = 1024 * 1024; // 1MB

const schema = z.object({
  path: z.string().describe('绝对路径或相对 cwd 的路径'),
  offset: z.number().int().nonnegative().optional().describe('起始字节偏移'),
  limit: z.number().int().positive().optional().describe('最大字节数'),
});

async function execute(input: z.infer<typeof schema>, ctx: ToolCtx) {
  const abs = resolveWithinCwd(input.path, ctx.cwd);
  let content: string;
  try {
    content = await fs.readFile(abs, 'utf-8');
  } catch (e) {
    throw new ToolError('read_file', `Cannot read ${input.path}: ${(e as Error).message}`);
  }
  let truncated = false;
  if (content.length > MAX_BYTES) {
    content = content.slice(0, MAX_BYTES);
    truncated = true;
  }
  return { content, truncated, size: content.length, absPath: abs };
}

export const readFileTool: ToolDef<z.infer<typeof schema>> = {
  name: 'read_file',
  description:
    '读取文件内容。>1MB 会被截断。如需分块读取,可传 offset 和 limit(字节)。',
  safety: 'safe',
  schema,
  execute,
};
```

- [ ] **Step 2: 写 `src/tools/write_file.ts`**

```ts
import { z } from 'zod';
import fs from 'node:fs/promises';
import { resolveWithinCwd, assertWritableExt } from '../safety/sandbox.js';
import { ToolError } from '../safety/errors.js';
import type { ToolDef, ToolCtx } from '../agent/types.js';

const schema = z.object({
  path: z.string().describe('写入路径,必须在 cwd 内,且后缀在白名单'),
  content: z.string().describe('完整文件内容'),
});

async function execute(input: z.infer<typeof schema>, ctx: ToolCtx) {
  const abs = resolveWithinCwd(input.path, ctx.cwd);
  assertWritableExt(
    abs,
    (ctx as ToolCtx & { writeableExts?: string[] }).writeableExts ?? [
      '.md',
      '.ts',
      '.tsx',
      '.js',
      '.jsx',
      '.json',
      '.yaml',
      '.yml',
      '.toml',
      '.txt',
    ],
  );
  try {
    await fs.mkdir(require('node:path').dirname(abs), { recursive: true });
    await fs.writeFile(abs, input.content, 'utf-8');
  } catch (e) {
    throw new ToolError('write_file', `Cannot write ${input.path}: ${(e as Error).message}`);
  }
  return { written: input.content.length, absPath: abs };
}

export const writeFileTool: ToolDef<z.infer<typeof schema>> = {
  name: 'write_file',
  description:
    '写入一个新文件,完全覆盖。路径必须在 cwd 内,后缀必须在白名单(.md/.ts/.js/.json/.yaml/.toml/.txt 等)。',
  safety: 'confirm',
  schema,
  execute,
};
```

- [ ] **Step 3: 写 `src/tools/edit_file.ts`**

```ts
import { z } from 'zod';
import fs from 'node:fs/promises';
import { resolveWithinCwd, assertWritableExt } from '../safety/sandbox.js';
import { ToolError } from '../safety/errors.js';
import type { ToolDef, ToolCtx } from '../agent/types.js';

const schema = z.object({
  path: z.string().describe('文件路径'),
  old_string: z.string().describe('要被替换的字符串,必须在文件里唯一匹配'),
  new_string: z.string().describe('替换后的字符串'),
});

async function execute(input: z.infer<typeof schema>, ctx: ToolCtx) {
  const abs = resolveWithinCwd(input.path, ctx.cwd);
  assertWritableExt(
    abs,
    (ctx as ToolCtx & { writeableExts?: string[] }).writeableExts ?? [
      '.md', '.ts', '.tsx', '.js', '.jsx',
      '.json', '.yaml', '.yml', '.toml', '.txt',
    ],
  );
  let original: string;
  try {
    original = await fs.readFile(abs, 'utf-8');
  } catch (e) {
    throw new ToolError('edit_file', `Cannot read ${input.path}: ${(e as Error).message}`);
  }
  const occurrences = original.split(input.old_string).length - 1;
  if (occurrences === 0) {
    throw new ToolError('edit_file', `old_string not found in ${input.path}`);
  }
  if (occurrences > 1) {
    throw new ToolError(
      'edit_file',
      `old_string matches ${occurrences} times in ${input.path}, must be unique`,
    );
  }
  const updated = original.replace(input.old_string, input.new_string);
  try {
    await fs.writeFile(abs, updated, 'utf-8');
  } catch (e) {
    throw new ToolError('edit_file', `Cannot write ${input.path}: ${(e as Error).message}`);
  }
  return { ok: true, absPath: abs };
}

export const editFileTool: ToolDef<z.infer<typeof schema>> = {
  name: 'edit_file',
  description:
    '在文件中替换一段字符串。old_string 必须在文件里唯一匹配,否则报错。',
  safety: 'confirm',
  schema,
  execute,
};
```

- [ ] **Step 4: 写 `src/tools/grep.ts`**

```ts
import { z } from 'zod';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { resolveWithinCwd } from '../safety/sandbox.js';
import { ToolError } from '../safety/errors.js';
import type { ToolDef, ToolCtx } from '../agent/types.js';

const exec = promisify(execFile);

const schema = z.object({
  pattern: z.string().describe('正则表达式'),
  glob: z.string().optional().describe('文件 glob,默认 *'),
  max_results: z.number().int().positive().default(100),
});

async function execute(input: z.infer<typeof schema>, ctx: ToolCtx) {
  // 先用 glob 把范围收敛到 cwd 内
  const fg = await import('fast-glob');
  const files = await fg.default(input.glob ?? '*', {
    cwd: ctx.cwd,
    dot: false,
    onlyFiles: true,
    absolute: true,
  });
  if (files.length === 0) return { matches: [] };
  const regex = new RegExp(input.pattern);
  const matches: Array<{ file: string; line: number; text: string }> = [];
  for (const file of files) {
    let rel: string;
    try {
      rel = path.relative(ctx.cwd, file);
    } catch {
      continue;
    }
    if (rel.startsWith('..')) continue;
    try {
      const { stdout } = await exec('rg', [
        '-n', '--no-heading', '--color=never',
        input.pattern, file,
      ], { cwd: ctx.cwd, signal: ctx.abort });
      for (const line of stdout.split('\n').filter(Boolean)) {
        const m = line.match(/^(.+?):(\d+):(.*)$/);
        if (m) {
          matches.push({ file: m[1], line: parseInt(m[2], 10), text: m[3] });
          if (matches.length >= input.max_results) break;
        }
      }
    } catch (e) {
      const err = e as { code?: string; stderr?: string };
      if (err.code === 'ENOENT') {
        // rg 不在,fallback 到 grep
        try {
          const { stdout } = await exec('grep', ['-rn', '--color=never', input.pattern, file], {
            cwd: ctx.cwd, signal: ctx.abort,
          });
          for (const line of stdout.split('\n').filter(Boolean)) {
            const m = line.match(/^(.+?):(\d+):(.*)$/);
            if (m) {
              matches.push({ file: m[1], line: parseInt(m[2], 10), text: m[3] });
              if (matches.length >= input.max_results) break;
            }
          }
        } catch (ge) {
          if ((ge as { code?: number }).code !== 1) {
            throw new ToolError('grep', `grep failed: ${(ge as Error).message}`);
          }
          // exit 1 = 无匹配
        }
      } else if (err.code !== undefined && (e as { code?: number }).code !== 1) {
        throw new ToolError('grep', `rg failed: ${err.stderr ?? (e as Error).message}`);
      }
    }
    if (matches.length >= input.max_results) break;
  }
  return { matches };
}

export const grepTool: ToolDef<z.infer<typeof schema>> = {
  name: 'grep',
  description:
    '在 cwd 内用 ripgrep(优先)/grep 搜索正则。返回 {file, line, text} 列表。',
  safety: 'safe',
  schema,
  execute,
};
```

- [ ] **Step 5: 写 `src/tools/glob.ts`**

```ts
import { z } from 'zod';
import fg from 'fast-glob';
import path from 'node:path';
import { resolveWithinCwd } from '../safety/sandbox.js';
import type { ToolDef, ToolCtx } from '../agent/types.js';

const schema = z.object({
  pattern: z.string().describe('glob 模式,如 "src/**/*.ts"'),
});

async function execute(input: z.infer<typeof schema>, ctx: ToolCtx) {
  // 模式 base 必须能 resolve 到 cwd 内
  const base = path.dirname(input.pattern).split('*')[0] || '.';
  resolveWithinCwd(base, ctx.cwd);
  const files = await fg(input.pattern, {
    cwd: ctx.cwd,
    dot: false,
    onlyFiles: true,
    absolute: false,
  });
  return { files };
}

export const globTool: ToolDef<z.infer<typeof schema>> = {
  name: 'glob',
  description: '在 cwd 内匹配文件路径,如 "src/**/*.ts"。',
  safety: 'safe',
  schema,
  execute,
};
```

- [ ] **Step 6: 写 `src/__tests__/tools/read_file.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileTool } from '../../tools/read_file.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('read_file', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-rf-'));
  });

  afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it('读取已有文件', async () => {
    await fs.writeFile(path.join(cwd, 'a.txt'), 'hello');
    const r = await readFileTool.execute({ path: 'a.txt' }, { cwd, abort: new AbortController().signal, confirmedByUser: true });
    expect(r.content).toBe('hello');
  });

  it('不存在的文件抛 ToolError', async () => {
    await expect(
      readFileTool.execute({ path: 'missing.txt' }, { cwd, abort: new AbortController().signal, confirmedByUser: true }),
    ).rejects.toThrow(/Cannot read/);
  });

  it('越界路径抛 SandboxError', async () => {
    await expect(
      readFileTool.execute({ path: '../escape.txt' }, { cwd, abort: new AbortController().signal, confirmedByUser: true }),
    ).rejects.toThrow(/escapes cwd/);
  });

  it('safety 等级是 safe', () => {
    expect(readFileTool.safety).toBe('safe');
  });
});
```

- [ ] **Step 7: 写 `src/__tests__/tools/write_file.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileTool } from '../../tools/write_file.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('write_file', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-wf-'));
  });

  afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it('写入新文件', async () => {
    const r = await writeFileTool.execute(
      { path: 'a.ts', content: 'export const x = 1;' },
      { cwd, abort: new AbortController().signal, confirmedByUser: true },
    );
    expect(r.written).toBeGreaterThan(0);
    const got = await fs.readFile(path.join(cwd, 'a.ts'), 'utf-8');
    expect(got).toBe('export const x = 1;');
  });

  it('不在白名单的后缀抛错', async () => {
    await expect(
      writeFileTool.execute(
        { path: 'a.exe', content: 'x' },
        { cwd, abort: new AbortController().signal, confirmedByUser: true },
      ),
    ).rejects.toThrow(/write-allowlist/);
  });

  it('自动创建父目录', async () => {
    await writeFileTool.execute(
      { path: 'sub/dir/a.md', content: 'hi' },
      { cwd, abort: new AbortController().signal, confirmedByUser: true },
    );
    const got = await fs.readFile(path.join(cwd, 'sub/dir/a.md'), 'utf-8');
    expect(got).toBe('hi');
  });

  it('safety 等级是 confirm', () => {
    expect(writeFileTool.safety).toBe('confirm');
  });
});
```

- [ ] **Step 8: 写 `src/__tests__/tools/edit_file.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { editFileTool } from '../../tools/edit_file.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('edit_file', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-ef-'));
  });

  afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it('唯一匹配时替换', async () => {
    await fs.writeFile(path.join(cwd, 'a.ts'), 'const x = 1;\nconst y = 2;');
    await editFileTool.execute(
      { path: 'a.ts', old_string: 'const x = 1;', new_string: 'const x = 99;' },
      { cwd, abort: new AbortController().signal, confirmedByUser: true },
    );
    const got = await fs.readFile(path.join(cwd, 'a.ts'), 'utf-8');
    expect(got).toBe('const x = 99;\nconst y = 2;');
  });

  it('无匹配抛错', async () => {
    await fs.writeFile(path.join(cwd, 'a.ts'), 'foo');
    await expect(
      editFileTool.execute(
        { path: 'a.ts', old_string: 'bar', new_string: 'baz' },
        { cwd, abort: new AbortController().signal, confirmedByUser: true },
      ),
    ).rejects.toThrow(/not found/);
  });

  it('多处匹配抛错', async () => {
    await fs.writeFile(path.join(cwd, 'a.ts'), 'foo foo');
    await expect(
      editFileTool.execute(
        { path: 'a.ts', old_string: 'foo', new_string: 'bar' },
        { cwd, abort: new AbortController().signal, confirmedByUser: true },
      ),
    ).rejects.toThrow(/2 times/);
  });
});
```

- [ ] **Step 9: 写 `src/__tests__/tools/glob.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { globTool } from '../../tools/glob.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('glob', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-gb-'));
    await fs.mkdir(path.join(cwd, 'src'));
    await fs.writeFile(path.join(cwd, 'src/a.ts'), '');
    await fs.writeFile(path.join(cwd, 'src/b.ts'), '');
    await fs.writeFile(path.join(cwd, 'README.md'), '');
  });

  afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it('匹配所有 ts', async () => {
    const r = await globTool.execute(
      { pattern: 'src/*.ts' },
      { cwd, abort: new AbortController().signal, confirmedByUser: true },
    );
    expect(r.files.sort()).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('不匹配时返回空', async () => {
    const r = await globTool.execute(
      { pattern: 'src/*.py' },
      { cwd, abort: new AbortController().signal, confirmedByUser: true },
    );
    expect(r.files).toEqual([]);
  });
});
```

- [ ] **Step 10: 写 `src/__tests__/tools/grep.test.ts`**(只测匹配部分,跳过外部 rg 调用)

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { grepTool } from '../../tools/grep.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('grep', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-gr-'));
    await fs.writeFile(path.join(cwd, 'a.txt'), 'hello world\nfoo bar\nhello again');
  });

  afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it('在文本文件里匹配(无 rg 时回退 grep)', async () => {
    const r = await grepTool.execute(
      { pattern: 'hello', max_results: 10 },
      { cwd, abort: new AbortController().signal, confirmedByUser: true },
    );
    expect(r.matches.length).toBeGreaterThanOrEqual(2);
  });

  it('glob 过滤', async () => {
    const r = await grepTool.execute(
      { pattern: 'hello', glob: '*.ts', max_results: 10 },
      { cwd, abort: new AbortController().signal, confirmedByUser: true },
    );
    expect(r.matches).toEqual([]);
  });
});
```

- [ ] **Step 11: 运行所有工具测试**

Run: `cd /Users/eryiya/Documents/AI-info/agent && npx vitest run src/__tests__/tools/`
Expected: 全部 passed(若 rg/grep 都不在,grep 测试用 fallback 路径,能通过)

- [ ] **Step 12: 提交**

```bash
cd /Users/eryiya/Documents/AI-info/agent
git add src/tools/ src/__tests__/tools/
git commit -m "feat(tools): 五个 safe/confirm 工具 + 测试"
```

---

## Task 7: http_fetch 工具(dangerous)

**Files:**
- Create: `src/tools/http_fetch.ts`
- Create: `src/__tests__/tools/http_fetch.test.ts`

- [ ] **Step 1: 写 `src/tools/http_fetch.ts`**

```ts
import { z } from 'zod';
import type { ToolDef, ToolCtx } from '../agent/types.js';

const schema = z.object({
  url: z.string().url(),
  method: z.enum(['GET', 'POST']).default('GET'),
  body: z.string().optional().describe('POST 请求体,字符串'),
  headers: z.record(z.string()).optional(),
});

async function execute(input: z.infer<typeof schema>, ctx: ToolCtx) {
  const { url, method = 'GET', body, headers = {} } = input;
  // ctx 携带 allowMutations 标志(ctx 由 loop 注入)
  if (method !== 'GET' && !(ctx as ToolCtx & { allowMutations?: boolean }).allowMutations) {
    throw new Error(
      'http_fetch: non-GET method requires --allow-mutations flag',
    );
  }
  const res = await fetch(url, {
    method,
    body: method === 'POST' ? body : undefined,
    headers,
    signal: ctx.abort,
  });
  const text = await res.text();
  // 截断响应防止上下文爆炸
  const MAX = 100_000;
  return {
    status: res.status,
    statusText: res.statusText,
    body: text.length > MAX ? text.slice(0, MAX) + '\n[...truncated...]' : text,
  };
}

export const httpFetchTool: ToolDef<z.infer<typeof schema>> = {
  name: 'http_fetch',
  description:
    'HTTP 请求,默认只 GET。POST 需要 --allow-mutations flag。响应截断 100KB。',
  safety: 'dangerous',
  schema,
  execute,
};
```

- [ ] **Step 2: 写 `src/__tests__/tools/http_fetch.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { httpFetchTool } from '../../tools/http_fetch.js';

describe('http_fetch', () => {
  it('safety 等级是 dangerous', () => {
    expect(httpFetchTool.safety).toBe('dangerous');
  });

  it('POST 无 allowMutations 抛错', async () => {
    await expect(
      httpFetchTool.execute(
        { url: 'https://example.com', method: 'POST', body: '{}' },
        { cwd: '/tmp', abort: new AbortController().signal, confirmedByUser: true },
      ),
    ).rejects.toThrow(/--allow-mutations/);
  });
});
```

- [ ] **Step 3: 运行**

Run: `cd /Users/eryiya/Documents/AI-info/agent && npx vitest run src/__tests__/tools/http_fetch.test.ts`
Expected: 2 passed

- [ ] **Step 4: 提交**

```bash
cd /Users/eryiya/Documents/AI-info/agent
git add src/tools/http_fetch.ts src/__tests__/tools/http_fetch.test.ts
git commit -m "feat(tools): http_fetch 工具(dangerous 级别)"
```

---

## Task 8: LLM 客户端 + 流式封装

**Files:**
- Create: `src/config.ts`
- Create: `src/llm/client.ts`
- Create: `src/llm/stream.ts`
- Create: `src/__tests__/stream.test.ts`

- [ ] **Step 1: 写 `src/config.ts`**

```ts
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface Config {
  openaiApiKey: string;
  openaiBaseUrl: string;
  openaiModel: string;
  maxContextTokens: number;
  writeableExts: string[];
}

const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1';
const DEFAULT_MODEL = 'deepseek-chat';
const DEFAULT_MAX_CONTEXT = 120000;
const DEFAULT_EXTS = ['.md', '.ts', '.tsx', '.js', '.jsx', '.json', '.yaml', '.yml', '.toml', '.txt'];

function loadJsonConfig(): Partial<Config> {
  const p = path.join(os.homedir(), '.agent', 'config.json');
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return {};
  }
}

export function loadConfig(): Config {
  const file = loadJsonConfig();
  return {
    openaiApiKey: process.env.OPENAI_API_KEY ?? '',
    openaiBaseUrl: process.env.OPENAI_BASE_URL ?? file.openaiBaseUrl ?? DEFAULT_BASE_URL,
    openaiModel: process.env.OPENAI_MODEL ?? file.openaiModel ?? DEFAULT_MODEL,
    maxContextTokens: parseInt(
      process.env.AGENT_MAX_CONTEXT_TOKENS ?? String(file.maxContextTokens ?? DEFAULT_MAX_CONTEXT),
      10,
    ),
    writeableExts: file.writeableExts ?? DEFAULT_EXTS,
  };
}
```

- [ ] **Step 2: 写 `src/llm/client.ts`**

```ts
import OpenAI from 'openai';
import type { Config } from '../config.js';

export function createOpenAIClient(cfg: Config): OpenAI {
  if (!cfg.openaiApiKey) {
    throw new Error('OPENAI_API_KEY is not set. Please set it in .env or env.');
  }
  return new OpenAI({
    apiKey: cfg.openaiApiKey,
    baseURL: cfg.openaiBaseUrl,
  });
}
```

- [ ] **Step 3: 写 `src/llm/stream.ts`**

```ts
import type OpenAI from 'openai';
import type { ChatCompletionTool, ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';
import type { AgentEvent, Message } from '../agent/types.js';

interface StreamInput {
  client: OpenAI;
  model: string;
  messages: Message[];
  tools: ChatCompletionTool[];
  signal: AbortSignal;
}

/**
 * 把 OpenAI stream 包装成 AsyncIterable<AgentEvent>。
 * 处理:
 *   - text_delta 增量
 *   - tool_calls 增量拼接(同一个 index 的 args 增量追加)
 *   - finish_reason
 *   - usage(若有)
 */
export async function* chatCompletionStream(input: StreamInput): AsyncGenerator<AgentEvent> {
  const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
    model: input.model,
    messages: input.messages as ChatCompletionMessageParam[],
    stream: true,
    tools: input.tools.length > 0 ? input.tools : undefined,
  };
  let stream;
  try {
    stream = await input.client.chat.completions.create(params, { signal: input.signal });
  } catch (e) {
    yield { type: 'error', error: (e as Error).message };
    return;
  }

  // 按 tool_call index 累积 args
  const argsBuffer = new Map<number, string>();
  const callIds = new Map<number, string>();
  const callNames = new Map<number, string>();
  const flushed = new Set<number>();

  for await (const chunk of stream) {
    if (input.signal.aborted) {
      yield { type: 'done', finishReason: 'abort' };
      return;
    }
    const choice = chunk.choices?.[0];
    if (!choice) continue;
    const delta = choice.delta;

    if (delta.content) {
      yield { type: 'text_delta', delta: delta.content };
    }

    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        if (tc.id) callIds.set(tc.index, tc.id);
        if (tc.function?.name) callNames.set(tc.index, tc.function.name);
        if (tc.function?.arguments) {
          argsBuffer.set(tc.index, (argsBuffer.get(tc.index) ?? '') + tc.function.arguments);
        }
      }
    }

    if (choice.finish_reason) {
      // 在 finish 时把所有累积的 tool_call 推给 UI
      for (const [idx, id] of callIds) {
        if (flushed.has(idx)) continue;
        flushed.add(idx);
        const name = callNames.get(idx) ?? '';
        const args = argsBuffer.get(idx) ?? '';
        yield {
          type: 'tool_call_start',
          toolCall: {
            id,
            type: 'function',
            function: { name, arguments: args },
          },
        };
      }
      const finish: 'stop' | 'length' = choice.finish_reason === 'length' ? 'length' : 'stop';
      const usage = chunk.usage
        ? { promptTokens: chunk.usage.prompt_tokens, completionTokens: chunk.usage.completion_tokens }
        : undefined;
      yield { type: 'done', finishReason: finish, usage };
    }
  }
}
```

- [ ] **Step 4: 写 `src/__tests__/stream.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { zodToJsonSchema } from '../agent/schema.js';

// 测试 zod → JSON Schema 在嵌套/可选下的行为,这是 stream 之前最常踩坑的地方
describe('schema edge cases for stream input', () => {
  it('array 类型', () => {
    const s = zodToJsonSchema(z.array(z.string()));
    expect(s).toMatchObject({ type: 'array', items: { type: 'string' } });
  });

  it('union(实际为 anyOf)', () => {
    const s = zodToJsonSchema(z.union([z.string(), z.number()]));
    expect(s).toMatchObject({ anyOf: [{ type: 'string' }, { type: 'number' }] });
  });

  it('literal', () => {
    const s = zodToJsonSchema(z.literal('on'));
    expect(s).toMatchObject({ const: 'on' });
  });
});
```

- [ ] **Step 5: 运行测试**

Run: `cd /Users/eryiya/Documents/AI-info/agent && npx vitest run src/__tests__/stream.test.ts`
Expected: 3 passed

- [ ] **Step 6: 提交**

```bash
cd /Users/eryiya/Documents/AI-info/agent
git add src/config.ts src/llm/ src/__tests__/stream.test.ts
git commit -m "feat(llm): OpenAI 客户端 + 流式封装 + config 加载"
```

---

## Task 9: 滑动窗口 + 摘要压缩(TDD)

**Files:**
- Create: `src/agent/context.ts`
- Create: `src/__tests__/context.test.ts`

- [ ] **Step 1: 写失败测试 `src/__tests__/context.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { estimateTokens, shouldCompress, compress } from '../agent/context.js';
import type { Message } from '../agent/types.js';

describe('estimateTokens', () => {
  it('空 messages 估 0', () => {
    expect(estimateTokens([])).toBe(0);
  });

  it('字符串 content 估 token', () => {
    const tokens = estimateTokens([{ role: 'user', content: 'hello world' }]);
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThan(10);
  });
});

describe('shouldCompress', () => {
  it('低于阈值不压缩', () => {
    const msgs: Message[] = [
      { role: 'system', content: 'short' },
      { role: 'user', content: 'hi' },
    ];
    expect(shouldCompress(msgs, 1000)).toBe(false);
  });

  it('超过阈值压缩', () => {
    const long = 'x'.repeat(5000);
    const msgs: Message[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: long },
      { role: 'assistant', content: long },
    ];
    // max 1000 * 0.7 = 700
    expect(shouldCompress(msgs, 1000)).toBe(true);
  });
});

describe('compress', () => {
  it('保留 system 和最近 6 条,中间折成 summary', async () => {
    const msgs: Message[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'old1' },
      { role: 'assistant', content: 'old2' },
      { role: 'user', content: 'old3' },
      { role: 'assistant', content: 'old4' },
      { role: 'user', content: 'recent1' },
      { role: 'assistant', content: 'recent2' },
      { role: 'user', content: 'recent3' },
    ];
    // 注入假 summarizer
    const out = await compress(msgs, async () => '<<SUMMARY>>');
    // system 保留
    expect(out[0]).toEqual({ role: 'system', content: 'sys' });
    // 中间有 summary
    const summary = out.find((m) => m.content === '<<SUMMARY>>');
    expect(summary).toBeDefined();
    // 最后 6 条保留
    expect(out[out.length - 1].content).toBe('recent3');
    // 总数 = 1 system + 1 summary + 6 recent = 8
    expect(out.length).toBe(8);
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `cd /Users/eryiya/Documents/AI-info/agent && npx vitest run src/__tests__/context.test.ts`
Expected: FAIL("Cannot find module")

- [ ] **Step 3: 实现 `src/agent/context.ts`**

```ts
import { encode } from 'gpt-tokenizer';
import type { Message } from './types.js';

/** 估算 messages 数组的总 token 数(粗略) */
export function estimateTokens(messages: Message[]): number {
  let total = 0;
  for (const m of messages) {
    const text = typeof m.content === 'string' ? m.content : '';
    // 加 4 token 估算 role/分隔符
    total += encode(text).length + 4;
  }
  return total;
}

/** 是否需要压缩? */
export function shouldCompress(messages: Message[], maxContextTokens: number): boolean {
  return estimateTokens(messages) > maxContextTokens * 0.7;
}

/**
 * 压缩策略:
 *   保留:system + 最近 6 条
 *   中间:折成一条 summary 消息(由 summarizer LLM 生成)
 *   头尾:角色对齐
 */
export async function compress(
  messages: Message[],
  summarizer: (text: string) => Promise<string>,
): Promise<Message[]> {
  if (messages.length <= 7) return messages; // 不够折的,不动

  const system = messages.find((m) => m.role === 'system');
  const tail = messages.slice(-6);
  const middle = messages
    .filter((m) => m !== system && !tail.includes(m))
    .map((m) => `[${m.role}] ${m.content ?? ''}`)
    .join('\n');

  const summary = await summarizer(middle);
  const summaryMsg: Message = {
    role: 'user',
    content: `[Summary of earlier conversation]\n${summary}`,
  };

  const result: Message[] = [];
  if (system) result.push(system);
  result.push(summaryMsg);
  result.push(...tail);
  return result;
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `cd /Users/eryiya/Documents/AI-info/agent && npx vitest run src/__tests__/context.test.ts`
Expected: 4 passed

- [ ] **Step 5: 提交**

```bash
cd /Users/eryiya/Documents/AI-info/agent
git add src/agent/context.ts src/__tests__/context.test.ts
git commit -m "feat(agent): 滑动窗口 + 摘要压缩"
```

---

## Task 10: ReAct 循环主逻辑(纯异步、不依赖 Ink)

**Files:**
- Create: `src/agent/loop.ts`
- Create: `src/__tests__/loop.test.ts`

- [ ] **Step 1: 写失败测试 `src/__tests__/loop.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';

// 用 vi.mock 替换 chatCompletionStream
const fakeStream = vi.hoisted(() => vi.fn());
vi.mock('../llm/stream.js', () => ({
  chatCompletionStream: fakeStream,
}));

import { runTurn } from '../agent/loop.js';
import { readFileTool } from '../tools/read_file.js';
import { SandboxError } from '../safety/errors.js';
import type { ToolDef, Message } from '../agent/types.js';

function asyncIterFromArray<T>(arr: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        next: async () => {
          if (i >= arr.length) return { value: undefined, done: true };
          return { value: arr[i++], done: false };
        },
      };
    },
  };
}

const fakeClient = {} as never; // stream 被 mock 掉,不直接用

describe('runTurn', () => {
  it('LLM 只返回文本时,自然停止', async () => {
    fakeStream.mockReturnValueOnce(
      asyncIterFromArray([
        { type: 'text_delta', delta: '你好' },
        { type: 'text_delta', delta: '世界' },
        { type: 'done', finishReason: 'stop' },
      ]),
    );
    const events: unknown[] = [];
    const r = await runTurn({
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      cwd: process.cwd(),
      yolo: false,
      onEvent: (e) => events.push(e),
      onConfirm: async () => false,
      signal: new AbortController().signal,
      client: fakeClient,
      model: 'fake',
      maxContextTokens: 120000,
    });
    expect(r.finishReason).toBe('stop');
    // 末尾应有一个 done
    expect(events[events.length - 1]).toMatchObject({ type: 'done', finishReason: 'stop' });
    // 新的 messages 应包含 user + assistant
    const assistant = r.messages.find((m) => m.role === 'assistant');
    expect(assistant?.content).toBe('你好世界');
  });

  it('LLM 调工具后,执行并把结果回灌', async () => {
    // 第一次:assistant 返回 tool_call
    fakeStream.mockReturnValueOnce(
      asyncIterFromArray([
        {
          type: 'tool_call_start',
          toolCall: {
            id: 'call_1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"a.txt"}' },
          },
        },
        { type: 'done', finishReason: 'tool_calls' as never }, // stream 内部归一为 stop
      ]),
    );
    // 第二次:assistant 返回自然结束
    fakeStream.mockReturnValueOnce(
      asyncIterFromArray([
        { type: 'text_delta', delta: 'done' },
        { type: 'done', finishReason: 'stop' },
      ]),
    );

    const tmpCwd = await import('node:fs/promises').then((m) =>
      m.mkdtemp('/tmp/agent-loop-'),
    );
    await import('node:fs/promises').then((m) =>
      m.writeFile(`${tmpCwd}/a.txt`, 'hello'),
    );

    const events: unknown[] = [];
    const r = await runTurn({
      messages: [{ role: 'user', content: 'read a.txt' }],
      tools: [readFileTool],
      cwd: tmpCwd,
      yolo: false,
      onEvent: (e) => events.push(e),
      onConfirm: async () => true,
      signal: new AbortController().signal,
      client: fakeClient,
      model: 'fake',
      maxContextTokens: 120000,
    });

    // 应有 tool_call_end 事件
    const tcEnd = events.find((e) => (e as { type: string }).type === 'tool_call_end');
    expect(tcEnd).toBeDefined();
    // messages 应包含 tool 消息
    const toolMsg = r.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toContain('hello');
    // 第二次 stream 调用
    expect(fakeStream).toHaveBeenCalledTimes(2);
  });

  it('用户拒绝确认时,工具结果写 "User declined"', async () => {
    fakeStream.mockReturnValueOnce(
      asyncIterFromArray([
        {
          type: 'tool_call_start',
          toolCall: {
            id: 'call_1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"a.txt"}' },
          },
        },
        { type: 'done', finishReason: 'stop' },
      ]),
    );
    fakeStream.mockReturnValueOnce(
      asyncIterFromArray([
        { type: 'text_delta', delta: 'ok' },
        { type: 'done', finishReason: 'stop' },
      ]),
    );
    const tmpCwd = await import('node:fs/promises').then((m) =>
      m.mkdtemp('/tmp/agent-loop-'),
    );
    const r = await runTurn({
      messages: [{ role: 'user', content: 'read' }],
      tools: [readFileTool],
      cwd: tmpCwd,
      yolo: false,
      onEvent: () => {},
      onConfirm: async () => false,
      signal: new AbortController().signal,
      client: fakeClient,
      model: 'fake',
      maxContextTokens: 120000,
    });
    const toolMsg = r.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toMatch(/declined/i);
  });

  it('工具抛 SandboxError 时,错误回灌 LLM', async () => {
    fakeStream.mockReturnValueOnce(
      asyncIterFromArray([
        {
          type: 'tool_call_start',
          toolCall: {
            id: 'call_1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"../escape"}' },
          },
        },
        { type: 'done', finishReason: 'stop' },
      ]),
    );
    fakeStream.mockReturnValueOnce(
      asyncIterFromArray([
        { type: 'text_delta', delta: 'blocked' },
        { type: 'done', finishReason: 'stop' },
      ]),
    );
    const tmpCwd = await import('node:fs/promises').then((m) =>
      m.mkdtemp('/tmp/agent-loop-'),
    );
    const r = await runTurn({
      messages: [{ role: 'user', content: 'escape' }],
      tools: [readFileTool],
      cwd: tmpCwd,
      yolo: false,
      onEvent: () => {},
      onConfirm: async () => true,
      signal: new AbortController().signal,
      client: fakeClient,
      model: 'fake',
      maxContextTokens: 120000,
    });
    const toolMsg = r.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toMatch(/escapes cwd/);
  });

  it('--yolo 跳过 confirm 类工具的确认', async () => {
    const stub: ToolDef = {
      name: 'noop_write',
      description: 'test',
      safety: 'confirm',
      schema: { safeParse: (x: unknown) => ({ success: true, data: x }) } as never,
      execute: async () => 'wrote',
    };
    const onConfirm = vi.fn();
    fakeStream.mockReturnValueOnce(
      asyncIterFromArray([
        {
          type: 'tool_call_start',
          toolCall: {
            id: 'call_1',
            type: 'function',
            function: { name: 'noop_write', arguments: '{}' },
          },
        },
        { type: 'done', finishReason: 'stop' },
      ]),
    );
    fakeStream.mockReturnValueOnce(
      asyncIterFromArray([
        { type: 'done', finishReason: 'stop' },
      ]),
    );
    const r = await runTurn({
      messages: [{ role: 'user', content: 'x' }],
      tools: [stub],
      cwd: '/tmp',
      yolo: true,
      onEvent: () => {},
      onConfirm,
      signal: new AbortController().signal,
      client: fakeClient,
      model: 'fake',
      maxContextTokens: 120000,
    });
    expect(onConfirm).not.toHaveBeenCalled();
    const toolMsg = r.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toBe('wrote');
  });
});
```

- [ ] **Step 2: 运行,确认失败**

Run: `cd /Users/eryiya/Documents/AI-info/agent && npx vitest run src/__tests__/loop.test.ts`
Expected: FAIL(`Cannot find module '../agent/loop.js'`)

- [ ] **Step 3: 实现 `src/agent/loop.ts`**

```ts
import { chatCompletionStream } from '../llm/stream.js';
import { findTool, getToolDescriptors } from './tools.js';
import { shouldCompress, compress } from './context.js';
import { SandboxError, ToolError } from '../safety/errors.js';
import type {
  Message,
  RunTurnInput,
  RunTurnResult,
} from './types.js';
import type { ChatCompletionTool } from 'openai/resources/chat/completions.js';

function stringifyResult(v: unknown): string {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function errorAsToolResult(toolName: string, err: unknown): string {
  if (err instanceof SandboxError) return `Error: ${err.message}`;
  if (err instanceof ToolError) return `Error: ${err.message}`;
  return `Error in ${toolName}: ${(err as Error).message ?? String(err)}`;
}

const RETRY_DELAYS = [500, 2000, 8000];

async function withRetry<T>(fn: () => Promise<T>, signal: AbortSignal, max = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < max; i++) {
    if (signal.aborted) throw new Error('aborted');
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (signal.aborted) throw e;
      await new Promise((r) => setTimeout(r, RETRY_DELAYS[i] ?? 8000));
    }
  }
  throw lastErr;
}

/**
 * 一次 ReAct 循环:处理一轮用户输入,可能产生多个 LLM ↔ tool 往返。
 */
export async function runTurn(input: RunTurnInput): Promise<RunTurnResult> {
  const {
    messages: initialMessages, tools, cwd, yolo,
    onEvent, onConfirm, signal, client, model, maxContextTokens, extraCtx,
  } = input;

  const messages: Message[] = [...initialMessages];
  const descriptors: ChatCompletionTool[] = getToolDescriptors(tools) as unknown as ChatCompletionTool[];

  if (shouldCompress(messages, maxContextTokens)) {
    onEvent({ type: 'text_delta', delta: '[context compressed]\n' });
    const compressed = await compress(messages, async (text) => text.slice(0, 200) + '...');
    messages.length = 0;
    messages.push(...compressed);
  }

  let finishReason: 'stop' | 'length' | 'abort' | 'error' = 'stop';

  try {
    let continueLoop = true;
    while (continueLoop) {
      if (signal.aborted) { finishReason = 'abort'; break; }

      // 调一次 LLM
      let textBuf = '';
      const toolCalls: NonNullable<Message['tool_calls']> = [];
      let sawFinish = false;

      await withRetry(async () => {
        textBuf = '';
        toolCalls.length = 0;
        sawFinish = false;
        const gen = chatCompletionStream({ client, model, messages, tools: descriptors, signal });
        for await (const ev of gen) {
          if (ev.type === 'text_delta') {
            textBuf += ev.delta;
            onEvent(ev);
          } else if (ev.type === 'tool_call_start') {
            toolCalls.push(ev.toolCall);
            onEvent(ev);
          } else if (ev.type === 'done') {
            sawFinish = true;
            finishReason = ev.finishReason === 'length' ? 'length' : 'stop';
          } else if (ev.type === 'error') {
            throw new Error(ev.error);
          }
        }
        if (!sawFinish) finishReason = 'stop';
      }, signal);

      const assistantMsg: Message = {
        role: 'assistant',
        content: textBuf || null,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      };
      messages.push(assistantMsg);

      if (toolCalls.length === 0) {
        continueLoop = false;
        break;
      }

      // 执行 tool_calls
      for (const tc of toolCalls) {
        const tool = findTool(tools, tc.function.name);
        let resultStr: string;
        if (!tool) {
          resultStr = `Error: unknown tool "${tc.function.name}"`;
        } else {
          const effectiveSafety = yolo && tool.safety !== 'dangerous' ? 'safe' : tool.safety;
          let confirmed = true;
          if (effectiveSafety === 'confirm' || effectiveSafety === 'dangerous') {
            confirmed = await onConfirm(tc, tool);
          }
          if (!confirmed) {
            resultStr = 'User declined this action. Please try a different approach.';
          } else {
            let parsed: unknown;
            try { parsed = JSON.parse(tc.function.arguments); }
            catch (e) { resultStr = `Error: invalid JSON arguments: ${(e as Error).message}`; continue; }
            const v = tool.schema.safeParse(parsed);
            if (!v.success) {
              resultStr = `Error: invalid arguments: ${v.error.message}`;
            } else {
              try {
                const out = await tool.execute(v.data, {
                  cwd, abort: signal, confirmedByUser: true,
                  ...(extraCtx ?? {}),
                } as never);
                resultStr = stringifyResult(out);
              } catch (e) {
                resultStr = errorAsToolResult(tool.name, e);
              }
            }
          }
        }
        messages.push({ role: 'tool', tool_call_id: tc.id, content: resultStr });
        onEvent({ type: 'tool_call_end', toolCallId: tc.id, result: resultStr });
      }
    }
  } catch (e) {
    if (signal.aborted) finishReason = 'abort';
    else {
      finishReason = 'error';
      onEvent({ type: 'error', error: (e as Error).message });
    }
  }

  onEvent({ type: 'done', finishReason });
  return { messages, finishReason };
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `cd /Users/eryiya/Documents/AI-info/agent && npx vitest run src/__tests__/loop.test.ts`
Expected: 5 passed

- [ ] **Step 5: 全量回归**

Run: `cd /Users/eryiya/Documents/AI-info/agent && npx vitest run`
Expected: 所有测试 passed

- [ ] **Step 6: 提交**

```bash
cd /Users/eryiya/Documents/AI-info/agent
git add src/agent/loop.ts src/__tests__/loop.test.ts
git commit -m "feat(agent): ReAct 主循环 + 集成测试"
```

---

## Task 11: Ink 三个 UI 组件

**Files:**
- Create: `src/components/MessageList.tsx`
- Create: `src/components/ToolTrace.tsx`
- Create: `src/components/InputBox.tsx`

- [ ] **Step 1: 写 `src/components/MessageList.tsx`**

```tsx
import React from 'react';
import { Box, Text } from 'ink';
import { ToolTrace } from './ToolTrace.js';

export interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content?: string | null;
  toolName?: string;
  toolResult?: string;
  streaming?: boolean;
}

export function MessageList({ messages }: { messages: DisplayMessage[] }) {
  return (
    <Box flexDirection="column">
      {messages.map((m) => {
        if (m.role === 'user') {
          return (
            <Box key={m.id} marginY={1}>
              <Text color="cyan">❯ </Text>
              <Text>{m.content}</Text>
            </Box>
          );
        }
        if (m.role === 'assistant') {
          return (
            <Box key={m.id} marginY={1} flexDirection="column">
              {m.content && <Text color="green">{m.content}{m.streaming ? '▍' : ''}</Text>}
            </Box>
          );
        }
        return (
          <Box key={m.id} marginY={1}>
            <ToolTrace name={m.toolName ?? '?'} result={m.toolResult ?? ''} />
          </Box>
        );
      })}
    </Box>
  );
}
```

- [ ] **Step 2: 写 `src/components/ToolTrace.tsx`**

```tsx
import React from 'react';
import { Box, Text } from 'ink';

export function ToolTrace({ name, result }: { name: string; result: string }) {
  const isError = result.startsWith('Error:');
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={isError ? 'red' : 'gray'} paddingX={1}>
      <Text color="yellow">⚙ {name}</Text>
      <Text color={isError ? 'red' : 'gray'}>{result.slice(0, 500)}{result.length > 500 ? '…' : ''}</Text>
    </Box>
  );
}
```

- [ ] **Step 3: 写 `src/components/InputBox.tsx`**

```tsx
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
```

- [ ] **Step 4: 验证 typecheck**

Run: `cd /Users/eryiya/Documents/AI-info/agent && npx tsc --noEmit`
Expected: exit 0(若 JSX 报错,确认 `tsconfig.json` 含 `"jsx": "react"`)

- [ ] **Step 5: 提交**

```bash
cd /Users/eryiya/Documents/AI-info/agent
git add src/components/
git commit -m "feat(ui): Ink 三个 UI 组件"
```

---

## Task 12: 根组件 App + CLI 入口(整合一切)

**Files:**
- Create: `src/app.tsx`
- Create: `src/cli.tsx`

- [ ] **Step 1: 写 `src/app.tsx`**

```tsx
import React, { useEffect, useState, useRef } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { MessageList, type DisplayMessage } from './components/MessageList.js';
import { InputBox } from './components/InputBox.js';
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

  useEffect(() => {
    const cfg = loadConfig();
    configRef.current = cfg;
    try {
      clientRef.current = createOpenAIClient(cfg);
    } catch (e) {
      // 在 headless 模式下 headlessPrompt 也不该启动
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
        onConfirm: async (tc) => {
          // 简化:CLI 模式下默认 yolo 跳过 confirm,否则总是同意
          // 真正的"y/n 询问"留给前端组件(此处用 yolo 控制)
          if (yolo) return true;
          return true; // TODO: 在 Task 13 加真正的 y/n 询问
        },
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
        // 找最后一个 tool 消息更新
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
      <Box marginTop={1}>
        <InputBox onSubmit={handleUserInput} disabled={busy} />
      </Box>
    </Box>
  );
}
```

- [ ] **Step 2: 写 `src/cli.tsx`**

```tsx
#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { App } from './app.js';

interface Args {
  yolo: boolean;
  allowMutations: boolean;
  cwd: string;
  headlessPrompt?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    yolo: false,
    allowMutations: false,
    cwd: process.cwd(),
  };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--yolo') args.yolo = true;
    else if (a === '--allow-mutations') args.allowMutations = true;
    else if (a === '--cwd') args.cwd = argv[++i] ?? args.cwd;
    else if (!a.startsWith('--')) positional.push(a);
  }
  if (positional.length > 0) args.headlessPrompt = positional.join(' ');
  return args;
}

const args = parseArgs(process.argv.slice(2));

// 加载 .env(开发期)
import('node:fs').then(async ({ existsSync, readFileSync }) => {
  if (existsSync('.env')) {
    for (const line of readFileSync('.env', 'utf-8').split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  }
  render(<App yolo={args.yolo} allowMutations={args.allowMutations} cwd={args.cwd} headlessPrompt={args.headlessPrompt} />);
});
```

- [ ] **Step 3: typecheck**

Run: `cd /Users/eryiya/Documents/AI-info/agent && npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 4: 手动冒烟(无 LLM 也能跑通 CLI 启动)**

Run: `cd /tmp && cp -r /Users/eryiya/Documents/AI-info/agent ./agent && cd ./agent && OPENAI_API_KEY=sk-fake npx tsx src/cli.tsx "列出当前目录" 2>&1 | head -20`
Expected: 启动 Ink(可能因缺真 key 报错),但**不报 JSX/import 错误**

- [ ] **Step 5: 提交**

```bash
cd /Users/eryiya/Documents/AI-info/agent
git add src/app.tsx src/cli.tsx
git commit -m "feat: 根组件 + CLI 入口"
```

---

## Task 13: 真实 y/n 确认 UI(替换 Task 12 的 TODO)

**Files:**
- Modify: `src/components/ToolTrace.tsx`(加 pending 状态)
- Modify: `src/app.tsx`(接入确认队列)

- [ ] **Step 1: 改 `src/components/ToolTrace.tsx` 接受 onConfirm prop**

```tsx
import React from 'react';
import { Box, Text } from 'ink';

export interface ToolTraceProps {
  name: string;
  args?: string;
  result?: string;
  pending?: boolean;
  onConfirm?: (ok: boolean) => void;
}

export function ToolTrace({ name, args, result, pending, onConfirm }: ToolTraceProps) {
  if (pending) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
        <Text color="yellow">⚙ {name} 申请执行</Text>
        {args && <Text color="gray">  args: {args.slice(0, 300)}</Text>}
        <Text color="cyan">  [y] 同意  [n] 拒绝  →</Text>
      </Box>
    );
  }
  const isError = (result ?? '').startsWith('Error:');
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={isError ? 'red' : 'gray'} paddingX={1}>
      <Text color="yellow">⚙ {name}</Text>
      <Text color={isError ? 'red' : 'gray'}>{(result ?? '').slice(0, 500)}{(result ?? '').length > 500 ? '…' : ''}</Text>
    </Box>
  );
}
```

- [ ] **Step 2: 改 `src/app.tsx` 接入确认队列**

替换 `onConfirm` 那段为:

```tsx
// 加在 App 函数顶部
const confirmResolversRef = useRef<Map<string, (ok: boolean) => void>>(new Map());
const [pending, setPending] = useState<DisplayMessage | null>(null);

useInput((input, key) => {
  if (key.ctrl && input === 'c' && busy && abortRef.current) {
    abortRef.current.abort();
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

// 替换 onConfirm:
onConfirm: (tc) =>
  new Promise<boolean>((resolve) => {
    if (yolo) {
      // 跳过 confirm,但 dangerous 仍确认
      // 简化:危险工具 yolo 也跳过(用户已知)
      resolve(true);
      return;
    }
    const id = uuid();
    confirmResolversRef.current.set(id, resolve);
    setPending({ id, role: 'tool', toolName: tc.function.name, toolResult: `[pending y/n] ${tc.function.arguments}` });
  },
```

并在 JSX 顶部加一行:

```tsx
{pending && <ToolTrace name={pending.toolName ?? '?'} args={pending.toolResult} pending onConfirm={() => {}} />}
```

- [ ] **Step 3: typecheck**

Run: `cd /Users/eryiya/Documents/AI-info/agent && npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 4: 提交**

```bash
cd /Users/eryiya/Documents/AI-info/agent
git add src/components/ToolTrace.tsx src/app.tsx
git commit -m "feat(ui): 工具调用 y/n 确认交互"
```

---

## Task 14: README + .env.example 完善 + 收尾

**Files:**
- Modify: `README.md`(新建)
- Modify: `.env.example`(加注释)

- [ ] **Step 1: 写 `README.md`**

```markdown
# agent

本地终端 ReAct agent,接入任意 OpenAI 兼容 LLM(DeepSeek / Moonshot / Ollama 等)。

## 用法

\`\`\`bash
# 装依赖
npm install

# 配 .env(参考 .env.example)
cp .env.example .env
$EDITOR .env

# 启动 REPL
npm run dev

# 单次 headless
npm run dev -- "修复 foo.ts 里的拼写错误"

# 跳过所有确认(脚本场景)
npm run dev -- --yolo "重命名所有 *.js 为 *.ts"
\`\`\`

## 工具

- read_file / write_file / edit_file / grep / glob / http_fetch
- 路径必须在 cwd 内,后缀必须在白名单

## 测试

\`\`\`bash
npm test
npm run typecheck
\`\`\`

## 设计文档

- `docs/superpowers/specs/2026-06-04-terminal-agent-design.md`
- `docs/superpowers/plans/2026-06-04-terminal-agent.md`
\`\`\`
```

- [ ] **Step 2: 改 `.env.example` 加注释**

```
# OpenAI 兼容协议的 API key
OPENAI_API_KEY=sk-xxx

# 默认: https://api.deepseek.com/v1
# 本地 Ollama: http://localhost:11434/v1
# Moonshot: https://api.moonshot.cn/v1
OPENAI_BASE_URL=https://api.deepseek.com/v1

# 默认: deepseek-chat
# Ollama: qwen2.5-coder:7b
OPENAI_MODEL=deepseek-chat

# 上下文压缩阈值(tokens),默认 120000
AGENT_MAX_CONTEXT_TOKENS=120000
```

- [ ] **Step 3: 最终回归**

Run: `cd /Users/eryiya/Documents/AI-info/agent && npx tsc --noEmit && npx vitest run`
Expected: 全过

- [ ] **Step 4: 提交**

```bash
cd /Users/eryiya/Documents/AI-info/agent
git add README.md .env.example
git commit -m "docs: README + .env.example 注释"
```

---

## 自检

**1. Spec 覆盖检查**:

| Spec 节 | 对应 Task |
|---|---|
| §2 形态与交互(REPL、streaming、headless) | T12, T11 |
| §3 工具集(6 个) | T6, T7 |
| §4 安全模型(三级、确认、沙箱) | T3, T6, T7, T13 |
| §5 上下文管理(滑动窗口+压缩) | T9, T10 |
| §6 架构(目录) | T1 起所有 |
| §7 错误处理(回灌、重试、abort) | T10 |
| §8 测试(单元+集成) | T3, T4, T6, T7, T9, T10 |
| §9 配置(env+flag) | T1 (.env.example), T8 (config.ts), T12 (parseArgs) |
| §11 里程碑 1-7 | T1-14 一一对应 |

无遗漏。

**2. Placeholder 扫描**:

✅ 无 TBD/TODO 残留(原 Task 10 的 TODO 已被 Task 13 替换)

**3. 类型一致性**:

- `RunTurnInput` 在 Task 2 定义,`runTurn` 在 Task 10 使用,字段完全对齐
- `ToolDef` / `ToolCtx` / `ToolCall` / `Message` / `AgentEvent` 在 Task 2 定义,后续一致使用
- 工具 `execute` 签名 `(input, ctx) => Promise<O>`,所有 6 个工具一致
- `onConfirm` 签名 `(tc, tool) => Promise<boolean>`,loop 与 app 一致

自检通过。

---