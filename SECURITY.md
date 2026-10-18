# Security

**English** · [Türkçe](SECURITY.tr.md)

## Reporting a vulnerability

If you find a security issue in Emniyet, please don't open a public issue. Use **Security → Report a vulnerability** (private reporting) on GitHub. We aim to reply within 7 days.

## Threat model

Emniyet is a safety net for the commands Claude Code runs **on your computer**. It is not an antivirus or a sandbox.

| Threat | What Emniyet does |
|---|---|
| Accidental deletion, `git reset --hard`, `git push --force` | Explains, asks, backs up first, undoes with one command |
| Reading secrets (`.env`, SSH keys, cloud credentials) | Asks before reading; critical if the same command sends data over the network |
| Obfuscated commands (`base64 -d \| sh`, `eval "$(curl …)"`) | Unpacks and inspects them; treats them as critical |
| Persistence (`~/.zshrc`, LaunchAgents, cron) | Flags as high risk and backs up |
| Passwords and tokens in commands | Masked on screen, in logs and in text sent to the AI |
| Malicious repository (`.emniyet.json`, git config) | Project policy can't loosen protection; git hooks and fsmonitor are disabled |
| Tampered backups | SHA-256 check; a modified backup or one pointing elsewhere is never restored |
| Fooling the screen with terminal escape sequences | Command text is sanitized before display |
| Silently turning protection off | Only by a command the person types, at most 60 min, then it turns back on |
| A bug in Emniyet itself | Critical commands are stopped (fail-closed); others run |

## Limits

- Command recognition relies on rules and an optional small model. A determined attacker may find a method it doesn't recognize.
- Remote databases, cloud resources, deploys and anything done over `ssh` can't be backed up.
- Backups exist only on this computer. They don't replace your disk or account backups; keep using real backups (Time Machine etc.).
- Emniyet is an extra layer on top of Claude Code's own permission system, not a replacement for it.
