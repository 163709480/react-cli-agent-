# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| `0.1.x` (current) | ✅ |
| older | ❌ |

## Reporting a vulnerability

**Please do not file public GitHub issues for security vulnerabilities.**

Instead, email a minimal repro and impact description to the maintainers
(see git log for current contact). You should receive a response within
72 hours. We will work with you on coordinated disclosure.

Please **do not** open a public issue, PR, or discussion until the
vulnerability is fixed and a release is out (or 90 days have passed,
whichever comes first).

## What counts as a vulnerability here

Given the nature of this project (a local terminal agent that can read /
modify files and make HTTP requests), the high-impact issues are:

- **Sandbox escape** — `resolveWithinCwd` or `assertWritableExt` being
  bypassable. Examples:
  - Path-traversal sequences we don't reject (e.g. null bytes, weird Unicode
    normalization)
  - Symlink attacks across the cwd boundary
  - TOCTOU races between resolve and write
- **Audit log forgery** — anything that lets an attacker write to the
  JSONL file without breaking the hash chain, or that allows replay /
  reorder of events
- **Confirmation bypass** — ways to get `yolo` or `--allow-mutations`
  to skip the `DangerousConfirmBox` for `dangerous` tools
- **Arbitrary code execution** via crafted LLM response — e.g. the
  `tool_call_start` parser misinterpreting `function.arguments`
- **HTTP smuggling** through `http_fetch` (chunked encoding tricks,
  header injection)

Lower-impact issues (UX bugs, error message hygiene, etc.) belong in
regular bug reports.

## Acknowledgement

We will credit the reporter (unless you ask to stay anonymous) in the
fix commit.
