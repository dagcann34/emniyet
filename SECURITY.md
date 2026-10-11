# Güvenlik / Security

## Açık bildirme

Emniyet'te bir güvenlik açığı bulursanız lütfen herkese açık bir issue açmayın. GitHub'daki **Security → Report a vulnerability** (özel bildirim) bölümünü kullanın. 7 gün içinde yanıt vermeye çalışıyoruz.

## Tehdit modeli

Emniyet, Claude Code'un **sizin bilgisayarınızda** çalıştırdığı komutlara karşı bir güvenlik ağıdır. Bir antivirüs ya da sanal alan (sandbox) değildir.

| Tehdit | Emniyet ne yapar |
|---|---|
| Yanlışlıkla silme, `git reset --hard`, `git push --force` | Açıklar, sorar, önce yedekler, tek komutla geri alır |
| Gizli bilgilerin (`.env`, SSH anahtarı, bulut kimliği) okunması | Okumadan önce sorar; aynı komutta ağa gönderiliyorsa kritik sayar |
| Gizlenmiş komutlar (`base64 -d \| sh`, `eval "$(curl …)"`) | İçini açıp inceler, kritik sayar |
| Kalıcılık (`~/.zshrc`, LaunchAgents, cron) | Yüksek risk olarak işaretler, yedekler |
| Komutlarda parola ve jeton | Ekranda, günlükte ve yapay zekâya giden metinde maskeler |
| Kötü niyetli depo (`.emniyet.json`, git ayarları) | Proje politikası korumayı gevşetemez; git kancaları ve fsmonitor kapalı |
| Yedeklerin değiştirilmesi | SHA-256 kontrolü; değişmiş ya da başka yeri gösteren yedek geri yüklenmez |
| Terminal kaçış dizisiyle ekranı kandırma | Komut metinleri temizlenerek gösterilir |
| Korumanın sessizce kapatılması | Yalnızca kişinin yazdığı komutla, en fazla 60 dk; süre dolunca kendiliğinden açılır |
| Emniyet'in kendi hatası | Kritik komutlar durdurulur (fail-closed), diğerleri çalışır |

## Sınırlar

- Komut tanıma, kurallara ve isteğe bağlı küçük bir modele dayanır. Kararlı bir saldırgan tanınmayan bir yöntem bulabilir.
- Sunucudaki veritabanları, bulut kaynakları, canlıya yayınlar ve `ssh` ile uzak sunucuda yapılanlar yedeklenemez.
- Yedekler yalnızca bu bilgisayardadır. Diskinizin ya da hesabınızın yerine geçmez; gerçek yedeklerinizi (Time Machine vb.) kullanmaya devam edin.
- Emniyet, Claude Code'un kendi izin sistemine ek bir katmandır, onun yerine geçmez.
