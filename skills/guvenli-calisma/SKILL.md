---
name: guvenli-calisma
description: Dosya silme, git geçmişini değiştirme, veritabanı, canlıya yayın ya da gizli bilgilere dokunan herhangi bir işten ÖNCE kullan. Geri alınabilir, dar kapsamlı ve kullanıcıya sade dille anlatılmış adımlarla çalışmayı sağlar. Use before destructive, history-rewriting, deploy, database or secret-touching work.
---

# Güvenli çalışma (Emniyet)

Emniyet eklentisi açıkken her kabuk komutu kullanıcıya sade dille gösterilir. Bu skill, komutları **daha baştan güvenli** seçmen içindir.

## Her riskli işten önce

1. **Önce bak, sonra dokun.** Silmeden ya da sıfırlamadan önce neyin etkileneceğini salt okunur bir komutla göster: `ls`, `git status --short`, `git diff --stat`, `du -sh <hedef>`.
2. **Kapsamı daralt.** Glob (`*`) ve `.` yerine tam yolları yaz. `rm -rf "$DEGISKEN"/` gibi boş kalabilecek değişkenleri asla kullanma.
3. **Geri alınabilir yolu seç:**

   | Yerine | Bunu kullan |
   |---|---|
   | `rm -rf klasor` | macOS'te `trash klasor`, yoksa `mv klasor ~/.Trash/` |
   | `git reset --hard` | `git stash push -u -m "yedek"`, sonra gerekiyorsa reset |
   | `git push --force` | `git push --force-with-lease` |
   | `git clean -fd` | önce `git clean -nd` ile listeyi göster |
   | `git checkout -- .` | `git stash push -- <dosya>` |
   | `DROP TABLE` / `migrate reset` | önce dökümünü al (`pg_dump`, `sqlite3 .backup`) |
   | `sed -i` ile toplu değişiklik | önce tek dosyada dene, `git diff` ile göster |

4. **Tek iş, tek komut.** Riskli bir adımı `&&` zincirinin ortasına gömme; kullanıcı neyi onayladığını görebilsin.
5. **Kullanıcıya bir cümleyle anlat:** ne olacak, neden gerekli, geri alınabilir mi?

## Gizli bilgiler

- `.env`, SSH anahtarları (`~/.ssh`), bulut kimlikleri (`~/.aws`, `~/.config/gcloud`), `.npmrc`, `.netrc` dosyalarını **okuma, yazdırma, yükleme**. Gerekiyorsa kullanıcıdan değişkenin **adını** iste, değerini değil.
- Parolayı komut satırına yazma (`mysql -pSIFRE`, `curl -u kullanici:sifre`). Ortam değişkeninden okut: `-p"$DB_PASSWORD"`.
- Gizli bir dosyayı okuyup aynı komutta ağa (`curl`, `scp`, `nc`) gönderme. Emniyet bunu **veri sızdırma** olarak işaretler ve durdurur.
- `.env` dosyasının `.gitignore` içinde olduğundan emin ol.

## Kalıcılık ve sistem

- `~/.zshrc`, `~/.bashrc`, LaunchAgents, cron ve `/etc` dosyalarını kullanıcı açıkça istemedikçe değiştirme.
- `sudo` gerekiyorsa nedenini önce söyle.
- `curl … | sh` yerine betiği önce indir, kullanıcıya göster, sonra çalıştır.

## Canlı ortam

Canlıya yayın (`vercel --prod`, `fly deploy`, `terraform apply`, `kubectl`) ve uzak sunucu (`ssh`) işlemleri Emniyet tarafından **yedeklenemez**. Bunlardan önce açıkça onay iste ve geri dönüş planını söyle.

## İşler ters giderse

Kullanıcıya hemen `/emniyet-geri-al` komutunu ve `/emniyet` panelini hatırlat; ayrıntılar için `emniyet:kurtarma` skill'ini kullan.
