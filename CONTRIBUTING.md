# Contributing

Thanks for your interest in improving `agent`! This project is licensed under
**AGPL-3.0** — by submitting a contribution (PR, issue, patch) you agree to
license it under the same terms.

## Development setup

```bash
git clone https://github.com/<owner>/agent.git
cd agent
npm install
cp .env.example .env       # set OPENAI_API_KEY for live tests
npm test                   # 123+ tests, all green
npm run typecheck          # tsc --noEmit, must be clean
npm run dev -- "smoke test"
```

Requires **Node.js ≥ 20**.

## Code style

- TypeScript strict mode (already on)
- ESM, `.js` import suffixes (this is Node 20+ ESM — not optional)
- Prefer pure functions; keep React components small and side-effect-free where possible
- Comments in English (the code is read more than written)
- Audit log events: if you add a new `AgentEvent` variant, also update
  `src/audit/sink.ts:agentEventToAuditFields` and add a test in
  `src/__tests__/loop.test.ts`

## Commit messages

We don't enforce a particular style, but try to follow roughly:

```
<scope>: <imperative summary>

<optional body explaining why>
```

Examples seen in this repo:
- `feat(audit): 全链路审计 + 哈希链`
- `feat(safety): delete_file 工具 + 醒目确认框`
- `fix(grep): 兼容 rg 单文件输出格式`

## Adding a new tool

If you want to add a new tool (e.g. `code_search`):

1. Create `src/tools/<name>.ts`. Set `safety` honestly:
   - `safe` — read-only, no side effects (e.g. `read_file`)
   - `confirm` — local side effect, but reversible (e.g. `write_file`)
   - `dangerous` — external / irreversible (e.g. `http_fetch`, `delete_file`)
2. Add change-preview support in `src/components/buildPreview.ts` so
   `DangerousConfirmBox` can show what will happen
3. Add tests in `src/__tests__/tools/<name>.test.ts`
4. Register in `TOOLS` array in `src/app.tsx`
5. Document in `README.md` (English) and `README.zh.md`

## Adding a new LLM provider

Edit `src/llm/providers.ts` and add a `ProviderPreset` entry. No other change
is needed — the OpenAI SDK picks up `baseURL` and `model` automatically.

## Verifying before pushing

```bash
npm run typecheck
npm test
```

Both must pass. The CI workflow runs the same.

## AGPL-3.0 implications

Because this project is AGPL-3.0, any modification you make and **distribute
over a network** (including as a hosted service) must be released under
AGPL-3.0 with the complete corresponding source. Internal use inside a
single organization is unaffected. See [LICENSE](LICENSE) section 13.

## Questions?

Open a discussion / issue. For security issues, see [SECURITY.md](SECURITY.md)
— **do not** file them as public issues.
