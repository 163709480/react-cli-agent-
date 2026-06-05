# 添加 `--provider` CLI 标志(显式选择 DeepSeek)

**日期**: 2026-06-05
**关联设计**: `docs/superpowers/specs/2026-06-04-terminal-agent-design.md`

---

## 1. 目标与定位

`agent` 项目当前已隐式支持 DeepSeek(`config.ts` 的 `DEFAULT_BASE_URL` 和 `DEFAULT_MODEL` 都指向 DeepSeek),但用户**没有显式声明 provider 的方式**:

- 切换到其他 OpenAI 兼容服务(Moonshot / Ollama / Groq / …)必须手填 `OPENAI_BASE_URL` + `OPENAI_MODEL` 两个 env 变量,容易配错。
- README / `.env.example` 也没明确说"默认是 DeepSeek",新人 onboarding 不直观。

本次改动**只做一件事**:**新增 `--provider <name>` CLI 标志,通过内置预设表直接选定 provider**。当且仅当用户显式传 `--provider` 时,CLI 覆盖 env / json config。

**非目标**(本次不做):

- 不引入 `--model` flag(以后可加,平行于 `--provider`)
- 不预置 Ollama / Moonshot / OpenAI 等其他 provider(以后加,只往预设表加一行)
- 不改 `~/.agent/config.json` schema
- 不改 streaming / tool call / agent loop 任何逻辑 — DeepSeek 与 OpenAI 协议完全一致,不需要
- 不在 `app.tsx` 顶部 banner 显示当前 provider

---

## 2. 设计

### 2.1 新文件 `src/llm/providers.ts`

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

**职责单一**:只是 name → `{baseUrl, defaultModel}` 的查找表。**不知道** env、json config、API key、OpenAI SDK。

### 2.2 `src/config.ts` 改动

`Config` interface **不变**。`loadConfig` 增加一个可选第二参数:

```ts
export function loadConfig(opts?: { provider?: string }): Config {
  const file = loadJsonConfig();
  if (opts?.provider) {
    const preset = resolveProvider(opts.provider); // 抛错向上传递
    return {
      openaiApiKey: process.env.OPENAI_API_KEY ?? '',
      openaiBaseUrl: preset.baseUrl,
      openaiModel: preset.defaultModel,
      maxContextTokens: parseInt(
        process.env.AGENT_MAX_CONTEXT_TOKENS
          ?? String(file.maxContextTokens ?? DEFAULT_MAX_CONTEXT),
        10,
      ),
      writeableExts: file.writeableExts ?? DEFAULT_EXTS,
    };
  }
  // ...原有逻辑保持不变
}
```

### 2.3 `src/cli.tsx` 改动

`parseArgs` 新增 `--provider`:

```ts
else if (a === '--provider') args.provider = argv[++i];
```

把 `args.provider` 透传给 `loadConfig`。`loadConfig` 抛 `Unknown --provider "..."` 时:

- 当前位置是 `import('node:fs').then(...)` 回调里,直接 `process.stderr.write` + `process.exit(2)`。
- 不走 Ink 渲染(在 render 之前就崩)。

### 2.4 优先级(从高到低)

1. `--provider <name>` CLI 标志 — 覆盖 baseUrl + model,**完全绕过** env 和 json config 中对应的字段
2. `process.env.OPENAI_BASE_URL` / `OPENAI_MODEL`
3. `~/.agent/config.json` 中的 `openaiBaseUrl` / `openaiModel`
4. 模块内 hardcoded 默认值(当前就是 DeepSeek 的)

**API key 不受 `--provider` 影响**,继续走 `OPENAI_API_KEY` env / json config(以后加 Ollama 时再说)。

### 2.5 错误处理

| 场景 | 行为 |
|---|---|
| `--provider ollama`(未知) | `resolveProvider` throw → cli.tsx 顶层 catch → stderr + `exit(2)` |
| `--provider deepseek` 但 API key 空 | `createOpenAIClient` 原有 throw,`app.tsx` `useEffect` 捕获,渲染到消息列表(行为不变) |
| `--provider` 重复传 | 取最后一个(跟现有 `--cwd` 行为一致) |

### 2.6 不动的文件

- `src/llm/client.ts` — OpenAI SDK 构造不依赖 provider 概念
- `src/llm/stream.ts` — streaming 协议与 provider 无关
- `src/app.tsx` — `loadConfig()` 调用方,但签名变化是兼容的(可选第二参数)
- `src/agent/*` / `src/tools/*` — 零相关

---

## 3. 测试

### 3.1 新增 `src/llm/__tests__/providers.test.ts`

- `resolveProvider('deepseek')` 返回 `{ baseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat' }`
- `resolveProvider('不存在')` throw,错误信息含 `'deepseek'`
- `listProviderNames()` 包含 `'deepseek'`

### 3.2 扩展现有 `src/config.test.ts`

- `loadConfig({ provider: 'deepseek' })` 时,即使 env 设了 `OPENAI_BASE_URL=http://evil.com`,结果仍是 deepseek 的 baseUrl
- `loadConfig()` 不传 provider 时,行为完全不变(env → json → default 三级 fallback)

---

## 4. 文档改动

- `.env.example`:顶部加一行注释 `# 默认 provider: deepseek(可被 --provider 覆盖)`
- `README.md` "用法"区,在 `--yolo` 示例之后新增:
  ```bash
  # 显式选择 provider(覆盖 env / json config)
  npm run dev -- --provider deepseek "..."
  ```
- **不改** `docs/PROJECT.md`(历史项目说明,与本次功能无关)
- **不改** `docs/superpowers/specs/2026-06-04-terminal-agent-design.md`(那是设计稿,无需为本次小改动更新)

---

## 5. 范围边界(为什么不做更多)

> 一切只为最小可用的"显式 provider 选择"。

- 不做 `--model`:YAGNI,用户需要时 env 也能配,加 flag 边际价值低
- 不做多 provider 预设表(只 deepseek):YAGNI,Ollama 等以后真要用再加
- 不做 provider 接口抽象 / 工厂模式:DeepSeek 与 OpenAI 协议 100% 兼容,无差异可抽象
- 不做 `app.tsx` 顶部 banner 显示:UI 噪音,与"Ink 简洁"取向冲突
