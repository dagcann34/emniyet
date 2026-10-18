---
name: safe-work
description: Use BEFORE deleting files, rewriting git history, touching databases, deploying, or handling secrets. Keeps every step reversible, narrowly scoped and explained in plain words. TR - dosya silme, git geçmişi, veritabanı, canlıya yayın veya gizli bilgiye dokunan işlerden önce kullan.
---

# Safe work (Emniyet)

With the Emniyet plugin active, every shell command is shown to the user in plain language before it runs. This skill helps you pick the **safe option from the start**. Talk to the user in their own language.

## Before any risky step

1. **Look before you touch.** Show what will be affected with a read-only command first: `ls`, `git status --short`, `git diff --stat`, `du -sh <target>`.
2. **Narrow the scope.** Use exact paths instead of globs (`*`) or `.`. Never use a variable that might be empty, such as `rm -rf "$DIR"/`.
3. **Prefer the reversible option:**

   | Instead of | Use |
   |---|---|
   | `rm -rf folder` | `trash folder` on macOS, otherwise `mv folder ~/.Trash/` |
   | `git reset --hard` | `git stash push -u -m "backup before reset"`, then reset if still needed |
   | `git push --force` | `git push --force-with-lease` |
   | `git clean -fd` | show the list first with `git clean -nd` |
   | `git checkout -- .` | `git stash push -- <file>` |
   | `DROP TABLE` / `migrate reset` | dump first (`pg_dump`, `sqlite3 .backup`) |
   | bulk `sed -i` | try on one file, show `git diff` |

   Write commit, stash and backup messages in English unless the user writes in another language.
4. **One risky action per command.** Don't bury a destructive step in the middle of an `&&` chain; the user should see exactly what they approve.
5. **Explain it in one sentence:** what will happen, why it is needed, and whether it can be undone.

## Secrets

- Do **not** read, print or upload `.env`, SSH keys (`~/.ssh`), cloud credentials (`~/.aws`, `~/.config/gcloud`), `.npmrc` or `.netrc`. If you need one, ask the user for the variable's **name**, never its value.
- Never put a password on the command line (`mysql -pSECRET`, `curl -u user:pass`). Read it from an environment variable: `-p"$DB_PASSWORD"`.
- Never read a secret file and send it over the network (`curl`, `scp`, `nc`) in the same command. Emniyet treats that as **data exfiltration** and stops it.
- Make sure `.env` is listed in `.gitignore`.

## Persistence and the system

- Don't change `~/.zshrc`, `~/.bashrc`, LaunchAgents, cron or `/etc` unless the user explicitly asked.
- If you need `sudo`, say why first.
- Instead of `curl … | sh`, download the script, show it to the user, then run it.

## Production

Deploys (`vercel --prod`, `fly deploy`, `terraform apply`, `kubectl`) and remote work over `ssh` **cannot be backed up** by Emniyet. Ask for explicit approval first and state the rollback plan.

## If something goes wrong

Point the user to `/emniyet-geri-al` and the `/emniyet` pane right away, and use the `emniyet:recovery` skill for details.
