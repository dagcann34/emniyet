# Changelog

## 0.3.0 — 2026-10-18

- 🌍 **English-first, global release.** The interface follows your system language automatically (`language: auto`); Turkish and English are both fully supported.
- ⌨️ **English command names**: `/emniyet-undo`, `/emniyet-limits`, `/emniyet-report`, `/emniyet off|on`. Turkish names keep working.
- ⟲ **Undo is scoped to the current project.** `/emniyet-undo` without an id never restores a backup from another folder; restoring another folder's backup by id shows an extra warning.
- 🧠 Skills renamed and rewritten in English: `emniyet:safe-work`, `emniyet:recovery`, `emniyet:security-scan` (they answer in the user's language).
- Percentages and layout fixed for English (`80%`), clearer explanation when output goes to a variable path.
- English README, SECURITY, CONTRIBUTING and screenshots.

## 0.2.1

- If a backup genuinely fails, Emniyet asks “Backup failed — run it anyway?” instead of running blindly. Idea by [@didemkastan](https://github.com/didemkastan) (#1).

## 0.2.0

- Security hardening (secret guard, exfiltration detection, obfuscation unpacking, SHA-256 verified backups, fail-closed), usage-limit band with the cat, `/emniyet off`, team policies, skills.

## 0.1.0

- First release: plain-language explanations, backups before risky commands, one-command undo.
