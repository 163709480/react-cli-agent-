---
name: Bug report
about: Report something broken
title: "[bug] "
labels: bug
assignees: ''
---

## Describe the bug

A clear and concise description of what the bug is.

## To reproduce

```bash
# Commands you ran
npm run dev -- "..."
```

## Expected behavior

What you expected to happen.

## Actual behavior

What actually happened. Include the exact error message if any.

## Environment

- OS: [e.g. macOS 14, Ubuntu 22.04, Windows 11]
- Node version: [output of `node -v`]
- agent version: [output of `npm run dev -- --version` if available, else commit SHA]
- LLM provider / model: [e.g. DeepSeek deepseek-chat]
- Audit log enabled? [yes / no]

## Audit log excerpt

If the bug involves a tool call or audit, please attach the relevant lines from
`~/.agent/audit/<sessionId>.jsonl` (or `--audit-log` path). Use
`jq -c 'select(.type=="...")'` to filter.

## Additional context

Anything else that might help.
