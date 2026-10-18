---
name: recovery
description: Use when the user lost, deleted or broke a file, uncommitted change, git branch or commit ("I deleted", "it's gone", "bring it back", "I ran reset --hard", "I force pushed"). Recovers step by step from Emniyet backups and git's own records. TR - "sildim", "kayboldu", "geri getir", "reset attım" dendiğinde kullan.
---

# Recovery (Emniyet)

The goal is to bring back what was lost **without making anything worse**. At every step, read first, write later. Talk to the user in their own language.

## 0. Stop first

- Ask the user not to write anything new where the loss happened.
- Pin down in one sentence what is missing: which file or folder, roughly when, after which command.

## 1. Is there an Emniyet backup?

1. Check `/emniyet-rapor` or the `/emniyet` pane: risky commands and their backup status (`backup ✓`).
2. For a command with a backup, suggest **`/emniyet-geri-al`** (the latest one in this project) or `/emniyet-geri-al <id>`. **The user types it**; undo always asks for confirmation.
3. The undo is backed up too; if it was wrong, the pane's "Revert undo" button brings things back.

Backups live only on this computer, under `~/.emniyet/`:
- `backups/<id>.tar.gz`: deleted or overwritten files (protected by an integrity hash)
- `shadow/<hash>.git`: snapshots of the project folder taken before commands

**Never edit these files by hand.** Emniyet refuses to restore a backup that was modified.

## 2. No Emniyet backup: git's own records

Look with read-only commands and show the user what you find:

| Lost | Look | Bring back (with the user's approval) |
|---|---|---|
| Commit lost with `reset --hard` | `git reflog -n 30` | `git branch recovery <sha>` |
| Deleted branch | `git reflog \| grep <branch>` | `git branch <branch> <sha>` |
| Dropped stash | `git fsck --no-reflog \| grep commit` | `git stash apply <sha>` |
| File added to git but never committed | `git fsck --lost-found` | copy from `.git/lost-found/` |
| Remote branch after a force push | the note in the Emniyet pane, or a teammate's copy | `git push --force-with-lease origin <sha>:<branch>` |

Always recover onto a **new branch** (`git branch recovery-...`); don't overwrite the current one.

## 3. Files outside git

- macOS: Trash, **Time Machine**, iCloud Drive's "Recently Deleted".
- Editor history: VS Code "Local History", JetBrains "Local History".
- Cloud sync: Dropbox / Google Drive / OneDrive version history.

## 4. Afterwards

- Confirm what came back with `git status` and `ls` together with the user.
- Give one suggestion that would prevent the same loss next time (keep Emniyet on, commit often, the `emniyet:safe-work` skill).
