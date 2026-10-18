# Contributing to Emniyet

Thanks for helping make AI agents safer to use! Issues and pull requests are welcome in **English or Turkish**.

## Getting started

```bash
git clone https://github.com/dagcann34/emniyet
claude --plugin-dir ./emniyet       # try your changes in a real session
claude plugin validate ./emniyet    # must pass
claude plugin test ./emniyet        # all tests must pass
```

## Where things live

| Path | What |
|---|---|
| `hooks/rules.ts` | Command analysis: risk levels, plain-language explanations (TR + EN), secret masking, policies |
| `hooks/register.tsx` | Hooks: confirmation dialog, backups, undo, limits band, pane, commands |
| `skills/` | `safe-work`, `recovery`, `security-scan` skills |
| `tests/` | Tests run with `claude plugin test` |

## Good first contributions

- **New command rules** in `hooks/rules.ts` (a package manager, a cloud CLI, a database tool you use). Every explanation needs both Turkish and English text.
- **A test** for any rule or behaviour you add or fix.
- **Translations / wording**: clearer plain-language explanations for non-coders.

## Rules for security-sensitive changes

- Protection may only get **stricter** from a project file; never add a way for a repo to loosen it.
- Never print or log secret values; use `redact()`.
- When analysis fails, critical commands must stay blocked (fail-closed).
- Report vulnerabilities privately — see [SECURITY.md](SECURITY.md).

By contributing you agree your work is released under the MIT license.
