---
name: guvenlik-taramasi
description: Kullanıcı projesinin güvenliğini kontrol etmek istediğinde kullan ("güvenlik taraması", "sızan anahtar var mı", "yayınlamadan önce kontrol et", "secrets audit"). Sızmış anahtarları, git'e girmiş gizli dosyaları, açık izinleri ve riskli bağımlılıkları SADECE OKUYARAK tarar; değerleri asla göstermez. Use for read-only project security audits.
---

# Güvenlik taraması (Emniyet)

Bu tarama **yalnızca okur**: dosya silmez, değiştirmez, internete hiçbir şey göndermez. Bulunan gizli değerleri **asla ekrana yazma**; yalnızca dosya adını, satır numarasını ve türünü söyle (örneğin `config.js:12 — GitHub jetonu`).

## Adımlar

### 1. Git'e girmiş gizli dosyalar
```bash
git ls-files | grep -Ei '(^|/)\.env($|\.)|id_rsa|id_ed25519|\.pem$|\.p12$|credentials|\.npmrc$|\.netrc$|secret' | grep -Ev '\.(example|sample|template)$'
```
Bulunursa: dosyanın `.gitignore`'a eklenmesini ve **anahtarın değiştirilmesini** (rotate) öner. Geçmişten silmek tek başına yetmez.

### 2. Kodun içindeki anahtarlar
```bash
git grep -nIE '(AKIA|ASIA)[0-9A-Z]{16}|sk-(ant-|proj-|live_)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_|xox[abposr]-|AIza[0-9A-Za-z_-]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----' -- . ':!*.lock' | cut -d: -f1,2
```
`cut` ile yalnızca dosya:satır göster; eşleşen değeri **gösterme**.

### 3. Git geçmişindeki anahtarlar
```bash
git log --all -p -G'(AKIA|ASIA)[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|PRIVATE KEY-----' --format='%h %ad %s' --date=short | grep -E '^[0-9a-f]{7,} ' | head -20
```

### 4. .gitignore kontrolü
`.env`, `*.pem`, `node_modules/`, `.DS_Store` ve derleme klasörlerinin `.gitignore`'da olduğunu kontrol et.

### 5. İzinler
```bash
find . -path ./node_modules -prune -o -path ./.git -prune -o -type f -perm -o+w -print | head
ls -la ~/.ssh 2>/dev/null | awk 'NR>1 && $1 !~ /^-rw-------|^d|^-rw-r--r--.*\.pub$/'
```
Herkesin yazabildiği dosyalar ve `600` olmayan özel anahtarlar uyarıdır.

### 6. Bağımlılıklar (varsa, yalnızca rapor)
- Node: `npm audit --omit=dev --json 2>/dev/null | head -c 4000`
- Python: `pip-audit` kuruluysa çalıştır; kurulu değilse kurmayı öner, kendiliğinden kurma.

### 7. Riskli betikler
`package.json` içindeki `preinstall`/`postinstall` betiklerini ve `curl … | sh` içeren dosyaları listele.

## Rapor biçimi

Kullanıcıya kısa bir tablo ver: **Bulgu · Dosya · Önem (🔴/🟠/🟡) · Ne yapmalı**. En kritik bulguyu en üste koy. Hiç bulgu yoksa bunu açıkça söyle ve hangi kontrollerin yapıldığını listele.
