## Summary

One or two sentences describing what this PR does and why.

## Linked issue

Closes #<number> (if applicable).

## Type of change

- [ ] Bug fix (non-breaking)
- [ ] New feature (non-breaking, but adds a new tool / flag / behavior)
- [ ] Breaking change (existing behavior changes — call this out clearly)
- [ ] Documentation only

## How to test

```bash
# Exact commands a reviewer should run
npm test
npm run typecheck
npm run dev -- "..."
```

## Checklist

- [ ] `npm test` passes locally (123+ tests)
- [ ] `npm run typecheck` is clean
- [ ] New code has tests where applicable
- [ ] `DangerousConfirmBox` updated if the change touches a destructive tool
- [ ] Audit log events updated if a new event type is added
- [ ] `README.md` / `README.en.md` updated for user-facing changes

## AGPL-3.0

By submitting this PR, you agree to license your contribution under
[AGPL-3.0](LICENSE).
