# agent

本地终端 ReAct agent,接入任意 OpenAI 兼容 LLM(DeepSeek / Moonshot / Ollama 等)。

## 用法

```bash
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

# 显式选择 provider(覆盖 env / json config)
# 当前仅支持 deepseek(也是默认值)
npm run dev -- --provider deepseek "列出 src 下的 TypeScript 文件"

# 未知 provider 会立即报错并 exit 2
npm run dev -- --provider ollama
```

## 工具

- read_file / write_file / edit_file / grep / glob / http_fetch
- 路径必须在 cwd 内,后缀必须在白名单

## 测试

```bash
npm test
npm run typecheck
```

## 设计文档

- `docs/superpowers/specs/2026-06-04-terminal-agent-design.md`
- `docs/superpowers/plans/2026-06-04-terminal-agent.md`
