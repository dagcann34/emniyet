---
name: kurtarma
description: Kullanıcı kaybolan, silinen ya da bozulan bir dosyayı, kaydedilmemiş değişikliği, git dalını veya commit'i geri istediğinde kullan ("sildim", "kayboldu", "geri getir", "reset attım", "force push yaptım"). Emniyet yedeklerinden ve git'in kendi kayıtlarından adım adım kurtarır. Use when the user lost files, changes, branches or commits.
---

# Kurtarma (Emniyet)

Amaç, **hiçbir şeyi daha da bozmadan** kaybolanı geri getirmek. Her adımda önce oku, sonra yaz.

## 0. Önce dur

- Kullanıcıdan, kayıp olan yerde yeni bir şey yazmamasını iste.
- Ne kaybolduğunu tek cümleyle netleştir: hangi dosya/klasör, yaklaşık ne zaman, hangi komuttan sonra.

## 1. Emniyet yedeği var mı?

1. `/emniyet-rapor` ya da `/emniyet` paneli: riskli komutlar ve yedek durumu (`yedek ✓`).
2. Yedeği olan komut için kullanıcıya şunu önerin: **`/emniyet-geri-al`** (son komut) ya da `/emniyet-geri-al <id>`. Bunu **kullanıcı yazar**; geri alma her zaman onay ister.
3. Geri almanın kendisi de yedeklenir; yanlış olursa paneldeki "Geri almayı geri al" düğmesi kullanılabilir.

Yedekler yalnızca bu bilgisayarda, `~/.emniyet/` altındadır:
- `backups/<id>.tar.gz`: silinen/üzerine yazılan dosyalar (bütünlük özetiyle korunur)
- `shadow/<özet>.git`: proje klasörünün komut öncesi görüntüleri

Bu dosyaları **elle değiştirme**. Emniyet, değiştirilmiş bir yedeği güvenlik nedeniyle geri yüklemez.

## 2. Emniyet yedeği yoksa: git'in kendi kayıtları

Salt okunur komutlarla bak, bulduğunu kullanıcıya göster:

| Kayıp | Bak | Geri getir (kullanıcı onayıyla) |
|---|---|---|
| `reset --hard` ile kaybolan commit | `git reflog -n 30` | `git branch kurtarma <sha>` |
| Silinen dal | `git reflog \| grep <dal>` | `git branch <dal> <sha>` |
| Atılan stash | `git fsck --no-reflog \| grep commit` | `git stash apply <sha>` |
| Git'e eklenmiş ama commit'lenmemiş dosya | `git fsck --lost-found` | `.git/lost-found/` içinden kopyala |
| Force push sonrası uzak dal | Emniyet panelindeki not ya da ekip arkadaşının kopyası | `git push --force-with-lease origin <sha>:<dal>` |

Kurtarırken her zaman **yeni bir dal** aç (`git branch kurtarma-...`), mevcut dalın üzerine yazma.

## 3. Git dışı dosyalar

- macOS: Çöp Kutusu, **Time Machine**, iCloud Drive'ın "Son silinenler" klasörü.
- Düzenleyici geçmişi: VS Code "Local History" ya da JetBrains "Local History".
- Bulut senkronu: Dropbox / Google Drive sürüm geçmişi.

## 4. Sonrası

- Neyin geri geldiğini `git status` ve `ls` ile birlikte doğrula.
- Bir dahaki sefere aynı kaybı önleyecek tek bir öneri ver (örneğin "Emniyet'i kapatmayın", "düzenli commit", `emniyet:guvenli-calisma`).
