---
name: security-scan
description: Use when the user wants to check a project's security ("security scan", "any leaked keys?", "check before I publish", "secrets audit"). READ-ONLY scan for leaked keys, secret files committed to git, open permissions and risky dependencies; never prints secret values. TR - "güvenlik taraması", "sızan anahtar var mı" dendiğinde kullan.
---

# Security scan (Emniyet)

This scan **only reads**: it deletes nothing, changes nothing and sends nothing to the internet. **Never print a secret value you find**; report only the file, line number and kind (for example `config.js:12 — GitHub token`). Talk to the user in their own language.

## Steps

### 1. Secret files committed to git
```bash
git ls-files | grep -Ei '(^|/)\.env($|\.)|id_rsa|id_ed25519|\.pem$|\.p12$|credentials|\.npmrc$|\.netrc$|secret' | grep -Ev '\.(example|sample|template)$'
```
If anything shows up: suggest adding it to `.gitignore` **and rotating the key**. Removing it from history alone is not enough.

### 2. Keys inside the code
```bash
git grep -nIE '(AKIA|ASIA)[0-9A-Z]{16}|sk-(ant-|proj-|live_)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_|xox[abposr]-|AIza[0-9A-Za-z_-]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----' -- . ':!*.lock' | cut -d: -f1,2
```
`cut` keeps only file:line; **do not show** the matched value.

### 3. Keys in git history
```bash
git log --all -p -G'(AKIA|ASIA)[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|PRIVATE KEY-----' --format='%h %ad %s' --date=short | grep -E '^[0-9a-f]{7,} ' | head -20
```

### 4. .gitignore
Check that `.env`, `*.pem`, `node_modules/`, `.DS_Store` and build folders are ignored.

### 5. Permissions
```bash
find . -path ./node_modules -prune -o -path ./.git -prune -o -type f -perm -o+w -print | head
ls -la ~/.ssh 2>/dev/null | awk 'NR>1 && $1 !~ /^-rw-------|^d|^-rw-r--r--.*\.pub$/'
```
World-writable files and private keys that are not `600` are warnings.

### 6. Dependencies (report only)
- Node: `npm audit --omit=dev --json 2>/dev/null | head -c 4000`
- Python: run `pip-audit` if installed; if not, suggest installing it. Don't install it yourself.

### 7. Risky scripts
List `preinstall` / `postinstall` scripts in `package.json` and any files containing `curl … | sh`.

## Report format

Give the user a short table: **Finding · File · Severity (high / medium / low) · What to do**. Put the most critical finding first. If nothing was found, say so clearly and list which checks ran.
