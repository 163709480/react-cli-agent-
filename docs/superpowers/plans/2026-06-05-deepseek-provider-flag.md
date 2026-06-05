# `--provider` CLI 标志(显式选择 DeepSeek)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 `--provider <name>` CLI 标志,用户可在命令行显式选择 provider,无需手填 `OPENAI_BASE_URL` / `OPENAI_MODEL`。本次只预置 `deepseek`。

**Architecture:** 新建独立的 `src/llm/providers.ts` 作为 provider 预设表(name → `{baseUrl, defaultModel}`)。`loadConfig` 增加可选第二参数,`cli.tsx` 透传 `--provider`。Streaming / tool call / agent loop 零改动 — DeepSeek 协议与 OpenAI 100% 兼容,无需抽象。

**Tech Stack:** TypeScript (ESM, strict), vitest, Ink 5, OpenAI SDK 4

**Spec:** `docs/superpowers/specs/2026-06-05-deepseek-provider-flag-design.md`

---

### 重要发现(影响实现细节,不同于 spec 草稿)

执行期核查:`vitest.config.ts` 的 `include` 是 `src/__tests__/**/*.test.ts`(`__tests__` 必须直接在 `src/` 下),且 `tsconfig.json` 排除了 `src/__tests__/**`。因此:

- 新测试文件 `src/__tests__/providers.test.ts`(不是 spec 草稿里的 `src/llm/__tests__/providers.test.ts`)
- 新测试文件 `src/__tests__/config.test.ts`(原 spec 误以为"已有",实际没有,本计划新建)

spec 里的覆盖意图(测 `resolveProvider` + 测 `loadConfig` 的 provider 覆盖)完全保留,只是路径与 spec 草稿有差异。

---

## Task 1: 新建 `src/llm/providers.ts` + 测试

**Files:**
- Create: `src/llm/providers.ts`
- Create: `src/__tests__/providers.test.ts`

- [ ] **Step 1: 写失败的测试**

`src/__tests__/providers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { listProviderNames, resolveProvider } from '../llm/providers.js';

describe('listProviderNames', () => {
  it('包含 deepseek', () => {
    expect(listProviderNames()).toContain('deepseek');
  });
});

describe('resolveProvider', () => {
  it('deepseek 返回正确的 baseUrl + defaultModel', () => {
    const p = resolveProvider('deepseek');
    expect(p.baseUrl).toBe('https://api.deepseek.com/v1');
    expect(p.defaultModel).toBe('deepseek-chat');
  });

  it('未知 provider 抛错,错误信息含可用名单', () => {
    expect(() => resolveProvider('ollama')).toThrow(/deepseek/);
    expect(() => resolveProvider('ollama')).toThrow(/Available/);
  });
});
```

- [ ] **Step 2: 跑测试,确认它失败**

Run: `npx vitest run src/__tests__/providers.test.ts`
Expected: FAIL — `Cannot find module '../llm/providers.js'`(或类似 module not found)

- [ ] **Step 3: 写最小实现**

`src/llm/providers.ts`:

```ts
export interface ProviderPreset {
  baseUrl: string;
  defaultModel: string;
}

const PROVIDERS: Record<string, ProviderPreset> = {
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat' },
};

export function listProviderNames(): string[] {
  return Object.keys(PROVIDERS);
}

export function resolveProvider(name: string): ProviderPreset {
  const p = PROVIDERS[name];
  if (!p) {
    throw new Error(
      `Unknown --provider "${name}". Available: ${listProviderNames().join(', ')}`,
    );
  }
  return p;
}
```

- [ ] **Step 4: 跑测试,确认通过**

Run: `npx vitest run src/__tests__/providers.test.ts`
Expected: 3 tests passed

- [ ] **Step 5: typecheck**

Run: `npm run typecheck`
Expected: 0 errors

- [ ] **Step 6: 提交**

```bash
git add src/llm/providers.ts src/__tests__/providers.test.ts
git commit -m "feat(llm): 新增 provider 预设表(resolveProvider / listProviderNames)"
```

---

## Task 2: 改 `src/config.ts` 支持可选 provider 参数 + 测试

**Files:**
- Modify: `src/config.ts`(整个文件改写,文件小,改完更清晰)
- Create: `src/__tests__/config.test.ts`

- [ ] **Step 1: 写失败的测试**

`src/__tests__/config.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../config.js';

describe('loadConfig', () => {
  const savedEnv: Record<string, string | undefined> = {};
  const envKeys = ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL', 'AGENT_MAX_CONTEXT_TOKENS'];

  beforeEach(() => {
    for (const k of envKeys) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of envKeys) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it('不传 provider 时,行为完全不变(env → default fallback)', () => {
    process.env.OPENAI_BASE_URL = 'https://example.com/v1';
    process.env.OPENAI_MODEL = 'some-model';
    const cfg = loadConfig();
    expect(cfg.openaiBaseUrl).toBe('https://example.com/v1');
    expect(cfg.openaiModel).toBe('some-model');
  });

  it('不传 provider 且无 env,使用 hardcoded 默认(deepseek)', () => {
    const cfg = loadConfig();
    expect(cfg.openaiBaseUrl).toBe('https://api.deepseek.com/v1');
    expect(cfg.openaiModel).toBe('deepseek-chat');
  });

  it('传 provider 时,完全覆盖 env 中的 BASE_URL 和 MODEL', () => {
    process.env.OPENAI_BASE_URL = 'http://evil.com/v1';
    process.env.OPENAI_MODEL = 'evil-model';
    const cfg = loadConfig({ provider: 'deepseek' });
    expect(cfg.openaiBaseUrl).toBe('https://api.deepseek.com/v1');
    expect(cfg.openaiModel).toBe('deepseek-chat');
  });

  it('传未知 provider 时抛错(透传自 resolveProvider)', () => {
    expect(() => loadConfig({ provider: 'ollama' })).toThrow(/Unknown --provider/);
  });

  it('传 provider 时,API key 仍从 env 读取', () => {
    process.env.OPENAI_API_KEY = 'sk-test-123';
    const cfg = loadConfig({ provider: 'deepseek' });
    expect(cfg.openaiApiKey).toBe('sk-test-123');
  });
});
```

- [ ] **Step 2: 跑测试,确认相关 case 失败**

Run: `npx vitest run src/__tests__/config.test.ts`
Expected: 至少"传 provider 时,完全覆盖 env"和"传未知 provider 时抛错"两个 case 失败(loadConfig 当前不接受第二参数)

- [ ] **Step 3: 改 `src/config.ts`**

把 `src/config.ts` 整个替换为:

```ts
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { resolveProvider } from './llm/providers.js';

export interface Config {
  openaiApiKey: string;
  openaiBaseUrl: string;
  openaiModel: string;
  maxContextTokens: number;
  writeableExts: string[];
}

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

export interface LoadConfigOptions {
  provider?: string;
}

export function loadConfig(opts: LoadConfigOptions = {}): Config {
  const file = loadJsonConfig();
  const apiKey = process.env.OPENAI_API_KEY ?? '';

  // --provider 显式指定时,完全覆盖 env / json 中的 baseUrl + model
  if (opts.provider) {
    const preset = resolveProvider(opts.provider);
    return {
      openaiApiKey: apiKey,
      openaiBaseUrl: preset.baseUrl,
      openaiModel: preset.defaultModel,
      maxContextTokens: parseInt(
        process.env.AGENT_MAX_CONTEXT_TOKENS ?? String(file.maxContextTokens ?? DEFAULT_MAX_CONTEXT),
        10,
      ),
      writeableExts: file.writeableExts ?? DEFAULT_EXTS,
    };
  }

  return {
    openaiApiKey: apiKey,
    openaiBaseUrl: process.env.OPENAI_BASE_URL ?? file.openaiBaseUrl ?? presetFallbackBaseUrl(),
    openaiModel: process.env.OPENAI_MODEL ?? file.openaiModel ?? presetFallbackModel(),
    maxContextTokens: parseInt(
      process.env.AGENT_MAX_CONTEXT_TOKENS ?? String(file.maxContextTokens ?? DEFAULT_MAX_CONTEXT),
      10,
    ),
    writeableExts: file.writeableExts ?? DEFAULT_EXTS,
  };
}

// 把"默认 = deepseek"集中到这里,避免在两处写字符串。
// 之所以不直接从 providers.ts 拿 'deepseek',是为了不耦合具体的 provider key;
// 未来想改默认 provider 时,改这一行 + providers.PROVIDERS 的顺序即可。
function presetFallbackBaseUrl(): string {
  return resolveProvider('deepseek').baseUrl;
}
function presetFallbackModel(): string {
  return resolveProvider('deepseek').defaultModel;
}
```

注意:`DEFAULT_BASE_URL` / `DEFAULT_MODEL` 常量在原文件里是写死的,本任务把它们替换成"从 `resolveProvider('deepseek')` 读"。这样 `providers.ts` 仍是 baseUrl/model 的唯一来源(`single source of truth`),`config.ts` 不再持有重复的字符串字面量。

- [ ] **Step 4: 跑测试,确认通过**

Run: `npx vitest run src/__tests__/config.test.ts`
Expected: 5 tests passed

- [ ] **Step 5: 跑全部测试,确保无回归**

Run: `npm test`
Expected: 所有原有测试 + 新增 8 个测试全部通过(0 failed)

- [ ] **Step 6: typecheck**

Run: `npm run typecheck`
Expected: 0 errors

- [ ] **Step 7: 提交**

```bash
git add src/config.ts src/__tests__/config.test.ts
git commit -m "feat(config): loadConfig 支持 --provider 参数(覆盖 env / json)"
```

---

## Task 3: 改 `src/cli.tsx` 透传 `--provider` + 启动期错误处理

**Files:**
- Modify: `src/cli.tsx`(整个文件改写,文件小,改完更清晰)

- [ ] **Step 1: 改写 `src/cli.tsx`**

把 `src/cli.tsx` 整个替换为:

```tsx
#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { App } from './app.js';
import { loadConfig } from './config.js';

interface Args {
  yolo: boolean;
  allowMutations: boolean;
  cwd: string;
  provider?: string;
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
    else if (a === '--provider') args.provider = argv[++i];
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

  // 在 render 之前解析 provider -- 出错直接退,不走 Ink 渲染
  let config;
  try {
    config = loadConfig({ provider: args.provider });
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    process.exit(2);
  }

  render(
    <App
      yolo={args.yolo}
      allowMutations={args.allowMutations}
      cwd={args.cwd}
      headlessPrompt={args.headlessPrompt}
      config={config}
    />,
  );
});
```

⚠️ **注意**:这步会引入一个新 prop `config: Config` 给 `App`。但 `App` 当前**不接受** `config` prop — 它在 `useEffect` 里自己调 `loadConfig()`。

修正方式:把 `config` 透传给 `App` 是必要的(否则 cli 算出的 provider 不会生效,App 内部会再算一次)。所以这一步**必须**同时改 `App` 接收 `config` prop,但**只在 `loadConfig` 已经传过 provider 时跳过内部的 `loadConfig()`**。见下一步。

- [ ] **Step 2: 改 `src/app.tsx` 接收 config prop**

`src/app.tsx`,两处修改:

**(a)** interface 增加可选 `config?: Config`:

```tsx
import { loadConfig, type Config } from './config.js';
// ...

interface AppProps {
  yolo: boolean;
  allowMutations: boolean;
  cwd: string;
  headlessPrompt?: string;
  config?: Config;  // 新增:如果传入(cli 已算过),内部跳过 loadConfig
}
```

**(b)** `App` 函数签名加参数:

```tsx
export function App({ yolo, allowMutations, cwd, headlessPrompt, config: providedConfig }: AppProps) {
```

**(c)** `useEffect` 里:有 `providedConfig` 就用它,没有再调 `loadConfig()`:

```tsx
useEffect(() => {
  const cfg = providedConfig ?? loadConfig();
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
```

为什么不直接删 `loadConfig` 的内部调用:headless 模式(`App` 被别处直接 import 而不经过 `cli.tsx`,例如将来的测试或脚本)仍需要默认行为。保留 `loadConfig()` fallback,行为完全向后兼容。

- [ ] **Step 3: 跑全部测试,确认无回归**

Run: `npm test`
Expected: 所有测试通过(改动 app.tsx 不应影响任何已有测试)

- [ ] **Step 4: typecheck**

Run: `npm run typecheck`
Expected: 0 errors

- [ ] **Step 5: 手动 smoke 测 `--provider deepseek`**

Run: `OPENAI_API_KEY=sk-fake npm run dev -- --provider deepseek "hi"`

Expected:
- 程序启动并尝试请求(会因为 fake key 报错,但**不应该**报 `Unknown --provider` 错)
- 报错信息提示 OPENAI_API_KEY 无效(从 OpenAI SDK 抛出的 401 类信息)

如果出现 `Unknown --provider "deepseek"`,说明 cli 没把 `--provider` 传对,回去看 Step 1。

- [ ] **Step 6: 手动 smoke 测未知 `--provider`**

Run: `npm run dev -- --provider ollama "hi"`

Expected:
- 进程立即退出(无 Ink 渲染)
- stderr 输出:`Unknown --provider "ollama". Available: deepseek`
- exit code 为 2

Run: `echo $?`(在上一条命令后)
Expected: `2`

- [ ] **Step 7: 提交**

```bash
git add src/cli.tsx src/app.tsx
git commit -m "feat(cli): --provider CLI 标志,启动期校验未知 provider"
```

---

## Task 4: 文档更新

**Files:**
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: 改 `.env.example`**

在 `.env.example` **顶部**(在第一个 env 变量之前)加一行注释:

```bash
# 默认 provider: deepseek(可被命令行 --provider 覆盖)
# 切换 provider 无需再手填 BASE_URL / MODEL
```

- [ ] **Step 2: 改 `README.md`**

在 README.md 的 "## 用法" 区,`--yolo` 那个示例之后,新增一段:

```markdown
# 显式选择 provider(覆盖 env / json config)
# 当前仅支持 deepseek(也是默认值)
npm run dev -- --provider deepseek "..."

# 未知 provider 会立即报错并 exit 2
npm run dev -- --provider ollama  # Unknown --provider "ollama". Available: deepseek
```

- [ ] **Step 3: 检查 diff**

Run: `git diff .env.example README.md`
Expected: 仅有你刚加的那几行,无意外改动

- [ ] **Step 4: 提交**

```bash
git add .env.example README.md
git commit -m "docs: --provider CLI 标志用法(README + .env.example)"
```

---

## Task 5: 最终全量验证

- [ ] **Step 1: 跑全部测试**

Run: `npm test`
Expected: 全部通过,无 regression

- [ ] **Step 2: typecheck**

Run: `npm run typecheck`
Expected: 0 errors

- [ ] **Step 3: 看一眼 git log**

Run: `git log --oneline -10`
Expected: 应包含 4 个新提交(T1 / T2 / T3 / T4),加上先前的 spec 提交 `70f322f`,顺序如下:
1. `docs(spec): --provider CLI 标志(显式选择 DeepSeek)设计稿`
2. `feat(llm): 新增 provider 预设表(resolveProvider / listProviderNames)`
3. `feat(config): loadConfig 支持 --provider 参数(覆盖 env / json)`
4. `feat(cli): --provider CLI 标志,启动期校验未知 provider`
5. `docs: --provider CLI 标志用法(README + .env.example)`

- [ ] **Step 4: 报告完成**

向用户报告本次实现的:
- 4 个功能 / 文档提交
- 8 个新增测试(config 5 + providers 3)
- 0 个回归
- 手动 smoke 验证结果(2 个 case:已知 / 未知 provider)
