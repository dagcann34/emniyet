// Emniyet — kural motoru.
// Bir Bash komutunu parçalara ayırır, her parçayı sade dille açıklar,
// risk seviyesini ve hangi yedeğin alınabileceğini belirler.
// Saf fonksiyonlar: $ kullanmaz, testte doğrudan çağrılır.

export type Lang = 'tr' | 'en'

/** 0 güvenli (sadece okur) · 1 düşük · 2 orta · 3 yüksek · 4 kritik */
export type Risk = 0 | 1 | 2 | 3 | 4

/**
 * paths   : hedef dosya/klasörleri arşivle (rm, mv, …)
 * project : proje klasörünün gölge anlık görüntüsü (git reset, find -delete, …)
 * gitHead : git dalının (HEAD) eski yerini kaydet
 * remote  : uzak dalın eski commit'ini kaydet (git push --force)
 */
export type BackupKind = 'paths' | 'project' | 'gitHead' | 'remote'

export type Analysis = {
  risk: Risk
  /** Sade dilde, her parça için bir satır. */
  lines: string[]
  backup: BackupKind[]
  /** Arşivlenecek mutlak yollar (paths). */
  paths: string[]
  /** Glob (*) gibi çözülemeyen hedefler varsa proje görüntüsüne düşülür. */
  hasGlob: boolean
  /** Hiçbir yedekle geri alınamayan işlemler (veritabanı, bulut, yayın). */
  irreversible: string[]
  /** git push --force için uzak ve dal. */
  remote?: { name: string; branch?: string }
  /** git branch -D ile silinen dal adı. */
  branchRef?: string
  /** Kurallarla tanınmayan parçalar (isteğe bağlı yapay zekâ açıklaması için). */
  unknown: string[]
}

export type Ctx = { cwd: string; home: string; lang: Lang; depth: number }

export const RISK_LABEL: Record<Lang, readonly string[]> = {
  tr: ['güvenli', 'düşük risk', 'orta risk', 'yüksek risk', 'KRİTİK'],
  en: ['safe', 'low risk', 'medium risk', 'high risk', 'CRITICAL'],
}
export const RISK_ICON = ['🟢', '🟢', '🟡', '🟠', '🔴'] as const

// ───────────────────────── kabuk ayrıştırma ─────────────────────────

/** Komutu `&&`, `||`, `;`, `|`, yeni satır üzerinden parçalara böler (tırnaklara saygılı). */
export function splitSegments(command: string): { text: string; pipedFrom?: string }[] {
  const out: { text: string; pipedFrom?: string }[] = []
  let cur = ''
  let q: string | null = null
  let prevPiped: string | undefined
  const push = (piped: boolean) => {
    const text = cur.trim()
    if (text) out.push(prevPiped !== undefined ? { text, pipedFrom: prevPiped } : { text })
    prevPiped = piped ? text : undefined
    cur = ''
  }
  for (let i = 0; i < command.length; i++) {
    const c = command[i]!
    if (q) {
      if (c === '\\' && q === '"' && i + 1 < command.length) { cur += c + command[++i]; continue }
      if (c === q) q = null
      cur += c
      continue
    }
    if (c === "'" || c === '"') { q = c; cur += c; continue }
    if (c === '\\' && i + 1 < command.length) { cur += c + command[++i]; continue }
    const two = command.slice(i, i + 2)
    if (two === '&&' || two === '||') { push(false); i++; continue }
    if (c === ';' || c === '\n') { push(false); continue }
    if (c === '|') { push(true); continue }
    if (c === '&' && command[i + 1] !== '>' && command[i - 1] !== '>') { push(false); continue }
    cur += c
  }
  push(false)
  return out
}

/** Bir parçayı kelimelere ayırır; tırnakları kaldırır. Yönlendirmeleri ayrı döndürür. */
export function tokenize(segment: string): { words: string[]; redirects: { op: string; target: string }[] } {
  const words: string[] = []
  const redirects: { op: string; target: string }[] = []
  let cur = ''
  let has = false
  let q: string | null = null
  let pendingOp: string | null = null
  const flush = () => {
    if (!has) return
    if (pendingOp) { redirects.push({ op: pendingOp, target: cur }); pendingOp = null }
    else words.push(cur)
    cur = ''
    has = false
  }
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i]!
    if (q) {
      if (c === q) { q = null; continue }
      if (c === '\\' && q === '"' && i + 1 < segment.length) { cur += segment[++i]; continue }
      cur += c
      continue
    }
    if (c === "'" || c === '"') { q = c; has = true; continue }
    if (c === '\\' && i + 1 < segment.length) { cur += segment[++i]; has = true; continue }
    if (c === ' ' || c === '\t') { flush(); continue }
    if (c === '>' || (c === '<' && segment[i + 1] !== '<')) {
      // 2>&1, &>, >>, >| … ; önündeki sayı (2>) yönlendirmenin parçası
      if (/^\d+$/.test(cur) && has) { cur = ''; has = false } else flush()
      let op = c
      while (segment[i + 1] === '>' || segment[i + 1] === '|' || segment[i + 1] === '&') op += segment[++i]
      if (op.endsWith('&')) {
        // >&1, 2>&1: dosyaya değil, başka bir akışa
        while (/\d/.test(segment[i + 1] ?? '')) i++
        continue
      }
      pendingOp = op
      continue
    }
    cur += c
    has = true
  }
  flush()
  return { words, redirects }
}

const WRAPPERS = new Set(['sudo', 'doas', 'time', 'nohup', 'nice', 'command', 'exec', 'env', 'caffeinate', 'xargs'])

function stripWrappers(words: string[]): { words: string[]; sudo: boolean } {
  let sudo = false
  let i = 0
  while (i < words.length) {
    const w = words[i]!
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) { i++; continue }
    if (WRAPPERS.has(w)) {
      if (w === 'sudo' || w === 'doas') sudo = true
      i++
      // sudo -u kullanıcı, nice -n 10 gibi bayrakları atla
      while (i < words.length && words[i]!.startsWith('-')) {
        const f = words[i]!
        i++
        if ((f === '-u' || f === '-n' || f === '-g') && i < words.length) i++
      }
      continue
    }
    break
  }
  return { words: words.slice(i), sudo }
}

const base = (p: string) => p.split('/').pop() ?? p

export function resolvePath(p: string, ctx: Ctx): string {
  let x = p
  if (x === '~') x = ctx.home
  else if (x.startsWith('~/')) x = ctx.home + x.slice(1)
  else if (x.startsWith('$HOME')) x = ctx.home + x.slice(5)
  if (!x.startsWith('/')) x = ctx.cwd.replace(/\/$/, '') + '/' + x
  const parts: string[] = []
  for (const s of x.split('/')) {
    if (s === '' || s === '.') continue
    if (s === '..') parts.pop()
    else parts.push(s)
  }
  return '/' + parts.join('/')
}

const isGlob = (p: string) => /[*?[\]{}$`]/.test(p)

/** Bayrak olmayan argümanlar (`--` sonrası her şey argümandır). */
function operands(args: string[]): string[] {
  const out: string[] = []
  let end = false
  for (const a of args) {
    if (!end && a === '--') { end = true; continue }
    if (!end && a.startsWith('-') && a !== '-') continue
    out.push(a)
  }
  return out
}

function hasFlag(args: string[], short: string, long?: string): boolean {
  return args.some(a =>
    (long !== undefined && a === long) ||
    (a.startsWith('-') && !a.startsWith('--') && a.slice(1).includes(short)))
}

// ───────────────────────── metin yardımcıları ─────────────────────────

function L(ctx: Ctx, tr: string, en: string) { return ctx.lang === 'tr' ? tr : en }

function showPaths(ps: string[], ctx: Ctx): string {
  const nice = ps.map(p => {
    if (p === ctx.home) return '~'
    if (p.startsWith(ctx.home + '/')) return '~' + p.slice(ctx.home.length)
    return p
  })
  if (nice.length <= 3) return nice.map(n => `“${n}”`).join(', ')
  return nice.slice(0, 3).map(n => `“${n}”`).join(', ') + L(ctx, ` ve ${nice.length - 3} öğe daha`, ` and ${nice.length - 3} more`)
}

// ───────────────────────── kural tablosu ─────────────────────────

type SegResult = {
  risk: Risk
  line: string
  backup?: BackupKind[]
  targets?: string[]
  irreversible?: string
  remote?: { name: string; branch?: string }
  branchRef?: string
  unknown?: boolean
  secret?: boolean
}

const SENSITIVE = /(\.ssh\/(id_|.*_key|authorized_keys|config)|\bid_(rsa|ed25519|ecdsa|dsa)\b|\.aws\/credentials|\.config\/gcloud|\.azure\/|\.kube\/config|\.docker\/config\.json|\.netrc|\.npmrc|\.pypirc|\.git-credentials|(^|[\s/'"=])\.env(?!\.(example|sample|template|dist))(\.[\w-]+)?(?![\w.-])|\.pem\b|\.p12\b|\.keystore\b|\/etc\/(shadow|sudoers)|security\s+(find|dump)-(generic|internet)-password|security\s+dump-keychain|Keychains\/|Login Data|Cookies\b|wallet\.dat|\.gnupg\/)/i
const PERSIST = /(\.(bashrc|bash_profile|zshrc|zprofile|zshenv|profile|config\/fish\/config\.fish)\b|LaunchAgents|LaunchDaemons|\/etc\/(cron|systemd|rc\.local|profile)|\.config\/autostart|crontab\s+-(?!l|r))/i
/** Read/Edit/Write için: dosya yolu gizli bilgi içeriyor mu? */
export function isSensitivePath(p: string): boolean {
  return SENSITIVE.test(p) && !/\.(example|sample|template|dist)$/i.test(p)
}
/** Dosya her açılışta otomatik çalışan bir yerde mi (kabuk başlangıç dosyaları, LaunchAgents, cron)? */
export function isPersistPath(p: string): boolean {
  return PERSIST.test(p)
}

const NETWORK = /\b(curl|wget|nc|ncat|netcat|scp|sftp|ftp|rsync\s+.*\S+:|ssh|telnet|socat|http(ie)?|Invoke-WebRequest)\b|\/dev\/tcp\//

const SQL_DANGER = /\b(drop\s+(table|database|schema)|truncate\s+table|truncate\s+\w|delete\s+from\s+\w+(?![\s\S]*\bwhere\b))/i

const DB_CLIENTS = new Set(['psql', 'mysql', 'mariadb', 'mongosh', 'mongo', 'sqlcmd', 'clickhouse-client', 'cockroach'])

const READONLY: Record<string, [string, string]> = {
  ls: ['Klasördeki dosyaları listeler.', 'Lists the files in a folder.'],
  ll: ['Klasördeki dosyaları listeler.', 'Lists the files in a folder.'],
  pwd: ['Hangi klasörde olduğunu gösterir.', 'Shows the current folder.'],
  cd: ['Başka bir klasöre geçer.', 'Changes to another folder.'],
  cat: ['Bir dosyanın içeriğini ekrana yazar.', 'Prints a file’s contents.'],
  less: ['Bir dosyayı okumak için açar.', 'Opens a file for reading.'],
  head: ['Bir dosyanın ilk satırlarını gösterir.', 'Shows the first lines of a file.'],
  tail: ['Bir dosyanın son satırlarını gösterir.', 'Shows the last lines of a file.'],
  grep: ['Dosyalarda metin arar.', 'Searches files for text.'],
  rg: ['Dosyalarda metin arar.', 'Searches files for text.'],
  find: ['Dosya arar.', 'Searches for files.'],
  wc: ['Satır/kelime sayar.', 'Counts lines/words.'],
  echo: ['Ekrana bir metin yazar.', 'Prints some text.'],
  export: ['Bir ortam değişkeni ayarlar (yalnızca bu terminal için).', 'Sets an environment variable (this terminal only).'],
  unset: ['Bir ortam değişkenini kaldırır.', 'Removes an environment variable.'],
  set: ['Kabuk ayarlarını değiştirir.', 'Changes shell options.'],
  printf: ['Ekrana bir metin yazar.', 'Prints some text.'],
  which: ['Bir programın nerede kurulu olduğunu bulur.', 'Finds where a program is installed.'],
  whoami: ['Hangi kullanıcı olduğunu gösterir.', 'Shows the current user.'],
  date: ['Tarihi ve saati gösterir.', 'Shows the date and time.'],
  du: ['Dosyaların ne kadar yer kapladığını hesaplar.', 'Measures disk usage.'],
  df: ['Diskte ne kadar boş yer kaldığını gösterir.', 'Shows free disk space.'],
  stat: ['Bir dosyanın bilgilerini gösterir.', 'Shows file details.'],
  file: ['Bir dosyanın türünü söyler.', 'Tells a file’s type.'],
  tree: ['Klasör ağacını gösterir.', 'Shows the folder tree.'],
  diff: ['İki dosyayı karşılaştırır.', 'Compares two files.'],
  ps: ['Çalışan programları listeler.', 'Lists running programs.'],
  top: ['Çalışan programları canlı gösterir.', 'Shows running programs live.'],
  env: ['Ortam değişkenlerini listeler.', 'Lists environment variables.'],
  uname: ['Sistem bilgisini gösterir.', 'Shows system info.'],
  sort: ['Satırları sıralar.', 'Sorts lines.'],
  uniq: ['Tekrarlanan satırları ayıklar.', 'Filters repeated lines.'],
  jq: ['JSON verisini okur/süzer.', 'Reads/filters JSON.'],
  sleep: ['Bir süre bekler.', 'Waits for a while.'],
  true: ['Hiçbir şey yapmaz.', 'Does nothing.'],
  test: ['Bir koşulu kontrol eder.', 'Checks a condition.'],
  open: ['Bir dosyayı/uygulamayı açar.', 'Opens a file/app.'],
  basename: ['Dosya adını ayıklar.', 'Extracts a file name.'],
  dirname: ['Klasör adını ayıklar.', 'Extracts a folder name.'],
  realpath: ['Dosyanın tam yolunu gösterir.', 'Shows a file’s full path.'],
  history: ['Komut geçmişini gösterir.', 'Shows command history.'],
  man: ['Bir komutun kılavuzunu açar.', 'Opens a command’s manual.'],
  lsof: ['Açık dosyaları/portları listeler.', 'Lists open files/ports.'],
  ping: ['Bir sunucuya erişilebildiğini dener.', 'Checks a server is reachable.'],
  'git-status': ['', ''],
}

function analyzeSegment(seg: { text: string; pipedFrom?: string }, ctx: Ctx): SegResult {
  const { words: raw, redirects } = tokenize(seg.text)
  const { words, sudo } = stripWrappers(raw)
  const result = analyzeWords(words, seg, ctx)

  // Gizli bilgiler: SSH anahtarları, bulut kimlikleri, .env, parola kasaları
  const firstWord = base(words[0] ?? '')
  if (SENSITIVE.test(seg.text) && firstWord !== 'echo' && firstWord !== 'printf') {
    result.secret = true
    result.risk = Math.max(result.risk, 3) as Risk
    result.line += L(ctx, ' 🔑 Gizli bilgilerinize (anahtar, parola, .env) erişir.', ' 🔑 Touches your secrets (keys, passwords, .env).')
    result.unknown = false
  }
  // Kalıcılık: her açılışta kendiliğinden çalışacak değişiklikler
  if (PERSIST.test(seg.text) && (redirects.some(r => r.op.startsWith('>')) || /\b(tee|cp|mv|ln|install|launchctl|systemctl\s+enable|crontab\s+-(?!l|r))\b/.test(seg.text))) {
    result.risk = Math.max(result.risk, 3) as Risk
    result.line += L(ctx, ' 🔁 Bilgisayar her açıldığında ya da terminal her başladığında otomatik çalışacak bir değişiklik yapar.', ' 🔁 Adds something that runs automatically at every login or new terminal.')
    result.backup = [...new Set([...(result.backup ?? []), 'paths' as const])]
    result.unknown = false
  }
  // İçinde başka komutun çıktısı: $(…) veya `…`
  for (const m of seg.text.matchAll(/\$\(([^()]*)\)|`([^`]*)`/g)) {
    const inner = (m[1] ?? m[2] ?? '').trim()
    if (!inner || ctx.depth >= 3) continue
    const sub = analyze(inner, { ...ctx, depth: ctx.depth + 1 })
    if (sub.risk >= 2) {
      result.risk = Math.max(result.risk, sub.risk) as Risk
      result.line += L(ctx, ' İçinde çalışan komut: ', ' Inner command: ') + sub.lines.join(' ')
    }
  }

  // Dosyanın üzerine yazan yönlendirme: komut > dosya
  const overwrite = redirects.filter(r => (r.op === '>' || r.op === '>|' || r.op === '&>') && r.target !== '/dev/null' && !/^\/dev\/(stdout|stderr|tty)/.test(r.target))
  if (overwrite.length > 0) {
    const targets = overwrite.map(r => resolvePath(r.target, ctx))
    const line = L(ctx,
      ` Çıktı ${showPaths(targets, ctx)} dosyasına yazılır; dosya varsa eski içeriği silinir.`,
      ` Output is written to ${showPaths(targets, ctx)}; any existing content is replaced.`)
    result.line += line
    result.risk = Math.max(result.risk, 2) as Risk
    result.backup = [...new Set([...(result.backup ?? []), 'paths' as const])]
    result.targets = [...(result.targets ?? []), ...targets]
    result.unknown = false
  }

  if (sudo) {
    result.line = L(ctx, '[Yönetici yetkisiyle] ', '[As administrator] ') + result.line +
      L(ctx, ' Yönetici yetkisi, bilgisayarın tamamını etkileyebilir.', ' Admin rights can affect the whole computer.')
    result.risk = Math.min(4, Math.max(result.risk + 1, 2)) as Risk
  }
  return result
}

function analyzeWords(words: string[], seg: { text: string; pipedFrom?: string }, ctx: Ctx): SegResult {
  if (words.length === 0) return { risk: 0, line: '' }
  const cmd = base(words[0]!)
  const args = words.slice(1)
  const ops = operands(args)
  const sub = ops[0] ?? ''
  const t = (tr: string, en: string) => L(ctx, tr, en)

  // Gizlenmiş komut: base64/xxd/openssl ile çözülüp kabuğa verilen içerik
  if (seg.pipedFrom && /^(ba|z|da|fi)?sh$|^python3?$|^node$|^perl$|^ruby$/.test(cmd) && /\b(base64\s+(-d|-D|--decode)|xxd\s+-r|openssl\s+\S*\s*.*-d\b|rev\b|tr\s)/.test(seg.pipedFrom)) {
    return {
      risk: 4,
      line: t('Gizlenmiş (şifrelenmiş) bir komutu çözüp çalıştırır. Ne yapacağı görünmüyor; kötü amaçlı yazılımların sık kullandığı bir yöntemdir.',
        'Decodes and runs a hidden (encoded) command. What it does is not visible; a common malware technique.'),
      irreversible: t('gizlenmiş komut', 'hidden command'),
    }
  }

  // eval "$(curl …)", bash <(curl …), sh -c "$(wget …)": internetten gelen kodu görmeden çalıştırmak
  if (/^(eval|(ba|z|da|fi)?sh|source|\.)$/.test(cmd) && /(\$\(|<\(|`)\s*(curl|wget|fetch|iwr)\b/.test(seg.text)) {
    return {
      risk: 4,
      line: t('İnternetten indirilen kodu, içeriği görülmeden doğrudan çalıştırır. Kod bilgisayarda her şeyi yapabilir.', 'Runs code downloaded from the internet without showing it. It can do anything on this computer.'),
      irreversible: t('internetten indirilen kod', 'downloaded code'),
    }
  }

  // eval / sh -c "…": içteki komutu ayrıca incele
  if ((cmd === 'eval' || (/^(ba|z|da)?sh$/.test(cmd) && args[0] === '-c')) && ctx.depth < 3) {
    const inner = cmd === 'eval' ? args.join(' ') : (args[1] ?? '')
    if (inner) {
      const sub = analyze(inner, { ...ctx, depth: ctx.depth + 1 })
      return {
        risk: Math.max(2, sub.risk) as Risk,
        line: t('Bir metni komut olarak çalıştırır: ', 'Runs a text as a command: ') + sub.lines.join(' '),
        backup: sub.backup, targets: sub.paths,
        ...(sub.irreversible[0] ? { irreversible: sub.irreversible[0] } : {}),
        ...(sub.remote ? { remote: sub.remote } : {}),
      }
    }
  }

  // İnternetten indirilen betiği doğrudan çalıştırmak: curl … | sh
  if (seg.pipedFrom && /^(ba|z|da|fi)?sh$|^python3?$|^node$|^ruby$|^perl$/.test(cmd) && /\b(curl|wget)\b/.test(seg.pipedFrom)) {
    return {
      risk: 3,
      line: t('İnternetten indirilen bir kurulum betiğini, içeriği görülmeden doğrudan çalıştırır. Betik bilgisayarda her şeyi yapabilir; kaynağına güveniyorsanız onaylayın.',
        'Runs a script downloaded from the internet without showing it first. It can do anything on this computer — only approve if you trust the source.'),
      irreversible: t('internetten indirilen betik', 'downloaded script'),
    }
  }

  // ── Silme ──
  if (cmd === 'rm' || cmd === 'unlink' || cmd === 'rmdir' || cmd === 'trash' || cmd === 'srm') {
    const recursive = hasFlag(args, 'r', '--recursive') || hasFlag(args, 'R')
    const force = hasFlag(args, 'f', '--force')
    const targets = ops.map(p => resolvePath(p, ctx))
    const glob = ops.some(isGlob)
    if (cmd === 'trash') {
      return { risk: 1, line: t(`${showPaths(targets, ctx)} çöp kutusuna taşınır (oradan geri alınabilir).`, `Moves ${showPaths(targets, ctx)} to the Trash (recoverable there).`) }
    }
    const catastrophic = targets.some(p => p === '/' || p === ctx.home || p === '/Users' || p === '/home' || /^\/(System|usr|bin|etc|var|Library|Applications)(\/|$)/.test(p)) ||
      ops.some(p => p === '*' || p === '/*' || p === '~/*' || p === '.' || p === './*')
    let risk: Risk = recursive || force ? 3 : 2
    if (catastrophic) risk = 4
    const what = recursive ? t('klasörler ve içindeki her şey', 'folders and everything inside them') : t('dosyalar', 'files')
    let line = t(
      `${showPaths(targets, ctx)} kalıcı olarak silinir (${what}). Çöp kutusuna GİTMEZ.`,
      `Permanently deletes ${showPaths(targets, ctx)} (${what}). It does NOT go to the Trash.`)
    if (catastrophic) line += t(' ⚠️ Bu hedef sistemin ya da ana klasörünüzün tamamı olabilir!', ' ⚠️ This target may be your whole home folder or system!')
    return { risk, line, backup: glob ? ['project', 'paths'] : ['paths'], targets: targets.filter(p => !isGlob(p)) }
  }

  if (cmd === 'shred') {
    const targets = ops.map(p => resolvePath(p, ctx))
    return { risk: 4, line: t(`${showPaths(targets, ctx)} kurtarılamayacak şekilde üzerine yazılarak yok edilir.`, `Destroys ${showPaths(targets, ctx)} beyond recovery by overwriting.`), backup: ['paths'], targets }
  }

  if (cmd === 'truncate') {
    const targets = ops.filter(o => !/^\d+[KMG]?$/.test(o)).map(p => resolvePath(p, ctx))
    return { risk: 2, line: t(`${showPaths(targets, ctx)} dosyasının içeriği kısaltılır/boşaltılır.`, `Shrinks/empties ${showPaths(targets, ctx)}.`), backup: ['paths'], targets }
  }

  if (cmd === 'mv') {
    const targets = ops.map(p => resolvePath(p, ctx))
    const dest = targets[targets.length - 1]
    const srcs = targets.slice(0, -1)
    return {
      risk: hasFlag(args, 'f') ? 3 : 2,
      line: t(`${showPaths(srcs, ctx)} → ${showPaths(dest ? [dest] : [], ctx)} konumuna taşınır/yeniden adlandırılır. Hedefte aynı adlı dosya varsa üzerine yazılır.`,
        `Moves/renames ${showPaths(srcs, ctx)} → ${showPaths(dest ? [dest] : [], ctx)}. A file with the same name there is overwritten.`),
      backup: ops.some(isGlob) ? ['project', 'paths'] : ['paths'],
      targets: targets.filter(p => !isGlob(p)),
    }
  }

  if (cmd === 'cp' || cmd === 'rsync') {
    const targets = ops.filter(o => !o.includes(':')).map(p => resolvePath(p, ctx))
    const dest = targets[targets.length - 1]
    const del = args.some(a => a.startsWith('--delete'))
    return {
      risk: del ? 3 : 1,
      line: t(`Dosyalar “${dest ?? ''}” konumuna kopyalanır; aynı adlı dosyalar varsa üzerine yazılır.`, `Copies files to “${dest ?? ''}”; same-named files are overwritten.`) +
        (del ? t(' --delete: hedefte kaynakta olmayan dosyalar SİLİNİR.', ' --delete: files missing from the source are DELETED at the target.') : ''),
      backup: dest ? ['paths'] : [],
      targets: dest ? [dest] : [],
    }
  }

  if (cmd === 'find' && (args.includes('-delete') || (args.includes('-exec') && args.some(a => a === 'rm')))) {
    return { risk: 3, line: t('Belirli koşullara uyan TÜM dosyaları bulup kalıcı olarak siler.', 'Finds ALL files matching the conditions and permanently deletes them.'), backup: ['project'] }
  }

  if (cmd === 'chmod' || cmd === 'chown' || cmd === 'chgrp') {
    const rec = hasFlag(args, 'R')
    const targets = ops.slice(1).map(p => resolvePath(p, ctx))
    return {
      risk: rec ? 3 : 1,
      line: t(`${showPaths(targets, ctx)} için ${cmd === 'chmod' ? 'erişim izinleri' : 'sahiplik'} değiştirilir${rec ? ' (içindeki her şey dahil)' : ''}.`,
        `Changes ${cmd === 'chmod' ? 'permissions' : 'ownership'} of ${showPaths(targets, ctx)}${rec ? ' (and everything inside)' : ''}.`),
    }
  }

  if (cmd === 'dd' || cmd === 'mkfs' || cmd.startsWith('mkfs.') || (cmd === 'diskutil' && /erase|partition|format/i.test(sub)) || cmd === 'fdisk' || cmd === 'parted' || cmd === 'wipefs') {
    return { risk: 4, line: t('Diske doğrudan yazar ya da diski biçimlendirir. Yanlış diskte tüm veriler kaybolur.', 'Writes directly to a disk or formats it. On the wrong disk, all data is lost.'), irreversible: t('disk işlemi', 'disk operation') }
  }

  // ── Git ──
  if (cmd === 'git') {
    return analyzeGit(args, ctx)
  }

  // ── Veritabanları ──
  if (DB_CLIENTS.has(cmd) || cmd === 'sqlite3') {
    const sql = seg.text
    if (SQL_DANGER.test(sql)) {
      if (cmd === 'sqlite3') {
        const file = ops[0] ? resolvePath(ops[0], ctx) : undefined
        return { risk: 3, line: t('Veritabanından tablo/kayıt SİLEN bir SQL komutu çalıştırır.', 'Runs SQL that DELETES tables/rows from the database.'), backup: file ? ['paths'] : [], targets: file ? [file] : [] }
      }
      return { risk: 4, line: t('Veritabanından tablo veya kayıtları SİLEN bir SQL komutu çalıştırır. Sunucudaki veritabanı buradan yedeklenemez.', 'Runs SQL that DELETES tables or rows. A server database cannot be backed up from here.'), irreversible: t('veritabanı', 'database') }
    }
    return { risk: 2, line: t('Veritabanına bağlanıp komut çalıştırır.', 'Connects to a database and runs commands.') }
  }
  if (cmd === 'dropdb' || (cmd === 'redis-cli' && /flushall|flushdb/i.test(seg.text)) ||
    (/^(npx|pnpm|yarn|bunx|bun)$/.test(cmd) && /prisma\s+(migrate\s+reset|db\s+push\s+.*--force-reset)/.test(seg.text)) ||
    (cmd === 'prisma' && /migrate\s+reset|--force-reset/.test(seg.text)) ||
    (/^(rails|rake|bin\/rails)$/.test(cmd) && /db:(drop|reset|schema:load)/.test(seg.text)) ||
    (cmd === 'supabase' && /db\s+reset/.test(seg.text)) ||
    (/^(php|artisan)$/.test(cmd) && /migrate:(fresh|reset)/.test(seg.text)) ||
    (/^python3?$/.test(cmd) && /manage\.py\s+flush/.test(seg.text))) {
    return { risk: 4, line: t('Veritabanını SİLER ya da sıfırlar — içindeki tüm kayıtlar gider.', 'DELETES or resets the database — every record in it is lost.'), irreversible: t('veritabanı', 'database') }
  }

  // ── Bulut / sunucu / yayın ──
  if (cmd === 'kubectl' && /^(delete|drain|replace)$/.test(sub)) {
    return { risk: 4, line: t('Canlı sunucu kümesinden (Kubernetes) kaynak siler/değiştirir.', 'Deletes/replaces resources in a live Kubernetes cluster.'), irreversible: 'Kubernetes' }
  }
  if (cmd === 'terraform' || cmd === 'tofu' || cmd === 'pulumi') {
    if (/^(destroy|down)$/.test(sub)) return { risk: 4, line: t('Buluttaki altyapının TAMAMINI siler (sunucular, veritabanları…).', 'DESTROYS the cloud infrastructure (servers, databases…).'), irreversible: t('bulut altyapısı', 'cloud infrastructure') }
    if (/^(apply|up)$/.test(sub)) return { risk: 3, line: t('Buluttaki altyapıda gerçek değişiklikler yapar (bazı kaynaklar silinebilir).', 'Makes real changes to cloud infrastructure (some resources may be deleted).'), irreversible: t('bulut altyapısı', 'cloud infrastructure') }
    return { risk: 1, line: t('Altyapı planını inceler.', 'Inspects the infrastructure plan.') }
  }
  if (cmd === 'aws' && /\b(rm|delete|terminate|rb)\b/.test(seg.text)) {
    return { risk: 4, line: t('AWS üzerinde dosya/sunucu/kaynak siler.', 'Deletes files/servers/resources on AWS.'), irreversible: 'AWS' }
  }
  if ((cmd === 'gcloud' || cmd === 'az' || cmd === 'doctl' || cmd === 'heroku' || cmd === 'flyctl' || cmd === 'fly') && /\b(delete|destroy|remove)\b/.test(seg.text)) {
    return { risk: 4, line: t('Bulutta bir kaynağı (sunucu, uygulama, veritabanı) siler.', 'Deletes a cloud resource (server, app, database).'), irreversible: t('bulut', 'cloud') }
  }
  if ((cmd === 'vercel' && (args.includes('--prod') || sub === 'deploy')) || (cmd === 'netlify' && sub === 'deploy') ||
    ((cmd === 'fly' || cmd === 'flyctl') && sub === 'deploy') || (cmd === 'firebase' && sub === 'deploy') ||
    (cmd === 'wrangler' && (sub === 'deploy' || sub === 'publish')) || (cmd === 'eas' && sub === 'submit')) {
    return { risk: 3, line: t('Uygulamayı/siteyi canlıya yayınlar — kullanıcılar hemen yeni sürümü görür.', 'Publishes the app/site live — users see the new version immediately.'), irreversible: t('canlı yayın', 'live deploy') }
  }
  if (cmd === 'docker' || cmd === 'podman') {
    if (/(system|volume|image|container)\s+prune|volume\s+rm|\brm\b.*-f|\brmi\b/.test(seg.text)) {
      return { risk: 3, line: t('Docker kapsayıcılarını/disklerini (volume) siler — içindeki veriler gider.', 'Deletes Docker containers/volumes — data inside them is lost.'), irreversible: 'Docker' }
    }
    return { risk: 1, line: t('Docker ile kapsayıcı çalıştırır/yönetir.', 'Runs/manages Docker containers.') }
  }

  // ── Paket yöneticileri ──
  if (/^(npm|pnpm|yarn|bun)$/.test(cmd)) {
    if (sub === 'publish') return { risk: 3, line: t('Paketi herkese açık olarak yayınlar. Yayınlanan sürüm geri çekilse bile o sürüm numarası bir daha kullanılamaz.', 'Publishes the package publicly. Even if unpublished, that version number can never be reused.'), irreversible: t('paket yayını', 'package publish') }
    if (/^(install|i|add|ci)$/.test(sub) || (cmd !== 'npm' && ops.length === 0)) return { risk: 1, line: t('Projenin ihtiyaç duyduğu paketleri internetten indirip kurar.', 'Downloads and installs the packages the project needs.') }
    if (/^(uninstall|remove|rm|un)$/.test(sub)) return { risk: 1, line: t(`${ops.slice(1).join(', ')} paketini projeden kaldırır.`, `Removes the ${ops.slice(1).join(', ')} package.`) }
    if (sub === 'run' || sub === 'test' || sub === 'start' || sub === 'build' || sub === 'dev' || sub === 'exec' || sub === 'x') {
      return { risk: 1, line: t(`Projenin “${ops[1] ?? sub}” betiğini çalıştırır.`, `Runs the project’s “${ops[1] ?? sub}” script.`) }
    }
    return { risk: 1, line: t(`${cmd} paket yöneticisini çalıştırır.`, `Runs the ${cmd} package manager.`) }
  }
  if (cmd === 'npx' || cmd === 'bunx' || cmd === 'pnpx') return { risk: 2, line: t(`İnternetten “${sub}” aracını indirip çalıştırır.`, `Downloads and runs the “${sub}” tool.`) }
  if (/^pip3?$/.test(cmd) || cmd === 'uv' || cmd === 'poetry' || cmd === 'pipx') {
    if (/^(uninstall|remove)$/.test(sub)) return { risk: 1, line: t('Python paketini kaldırır.', 'Uninstalls a Python package.') }
    return { risk: 1, line: t('Python paketlerini indirip kurar.', 'Downloads and installs Python packages.') }
  }
  if (cmd === 'brew' || cmd === 'apt' || cmd === 'apt-get' || cmd === 'dnf' || cmd === 'yum' || cmd === 'pacman' || cmd === 'port') {
    if (/^(remove|uninstall|purge|autoremove)$/.test(sub)) return { risk: 2, line: t('Bilgisayardan program kaldırır.', 'Uninstalls software from the computer.') }
    return { risk: 1, line: t('Bilgisayara program kurar/günceller.', 'Installs/updates software on the computer.') }
  }

  // ── Süreçler, sistem ──
  if (cmd === 'kill' || cmd === 'pkill' || cmd === 'killall') {
    return { risk: 2, line: t('Çalışan bir programı zorla kapatır; kaydedilmemiş işler kaybolabilir.', 'Force-quits a running program; unsaved work may be lost.') }
  }
  if (cmd === 'shutdown' || cmd === 'reboot' || cmd === 'halt') {
    return { risk: 3, line: t('Bilgisayarı kapatır/yeniden başlatır.', 'Shuts down/restarts the computer.'), irreversible: t('kapatma', 'shutdown') }
  }
  if (cmd === 'crontab' && args.includes('-r')) {
    return { risk: 3, line: t('Tüm zamanlanmış görevleri (cron) siler.', 'Deletes all scheduled (cron) jobs.'), irreversible: 'crontab' }
  }
  if (cmd === 'ssh' || cmd === 'scp' || cmd === 'sftp') {
    return { risk: 2, line: t('Uzaktaki bir sunucuya bağlanır; orada yapılanlar buradan yedeklenemez.', 'Connects to a remote server; changes made there cannot be backed up from here.') }
  }
  if (cmd === 'curl' || cmd === 'wget') {
    const posting = /\s-X\s*(POST|PUT|DELETE|PATCH)|\s(-d|--data|-F|--form)\b/i.test(seg.text)
    if (posting) return { risk: 2, line: t('İnternetteki bir servise veri gönderir/değiştirir.', 'Sends or changes data on an internet service.') }
    return { risk: 1, line: t('İnternetten bir sayfa veya dosya indirir.', 'Downloads a page or file from the internet.') }
  }
  if (cmd === 'mkdir') return { risk: 1, line: t(`${showPaths(ops.map(p => resolvePath(p, ctx)), ctx)} klasörünü oluşturur.`, `Creates the folder ${showPaths(ops.map(p => resolvePath(p, ctx)), ctx)}.`) }
  if (cmd === 'touch') return { risk: 1, line: t('Boş bir dosya oluşturur ya da tarihini günceller.', 'Creates an empty file or updates its date.') }
  if (cmd === 'sed' && (hasFlag(args, 'i') || args.some(a => a.startsWith('--in-place')))) {
    const files = ops.slice(1).map(p => resolvePath(p, ctx))
    return { risk: 2, line: t(`${showPaths(files, ctx)} dosyasının içinde bul-değiştir yapar (dosya doğrudan değişir).`, `Find-and-replaces inside ${showPaths(files, ctx)} (edits the file in place).`), backup: ['paths'], targets: files.filter(f => !isGlob(f)) }
  }
  if (cmd === 'tar' || cmd === 'zip' || cmd === 'unzip' || cmd === 'gzip' || cmd === 'gunzip') {
    return { risk: 1, line: t('Dosyaları sıkıştırır ya da arşivden çıkarır (aynı adlı dosyaların üzerine yazabilir).', 'Compresses or extracts files (may overwrite same-named files).'), backup: ['project'] }
  }
  if (/^(python3?|node|ruby|perl|bash|sh|zsh|deno|tsx|ts-node|go|cargo|make|java|php)$/.test(cmd)) {
    const target = ops[0] ?? ''
    if (cmd === 'go' || cmd === 'cargo') return { risk: 1, line: t(`Projeyi derler/çalıştırır (${sub}).`, `Builds/runs the project (${sub}).`) }
    if (cmd === 'make') return { risk: 1, line: t(`Projenin “${sub || 'varsayılan'}” görevini çalıştırır.`, `Runs the project’s “${sub || 'default'}” task.`) }
    if (args.includes('-c') || args.includes('-e')) return { risk: 2, line: t(`${cmd} ile satır içi bir kod parçası çalıştırır.`, `Runs an inline ${cmd} snippet.`), unknown: true }
    if (/(^|\/)(manage\.py)$/.test(target) && /\b(runserver|test|shell|showmigrations)\b/.test(seg.text)) return { risk: 1, line: t('Django projesini çalıştırır.', 'Runs the Django project.') }
    return { risk: 1, line: t(`“${target || cmd}” betiğini çalıştırır; ne yapacağı betiğin içeriğine bağlıdır.`, `Runs the “${target || cmd}” script; what it does depends on its contents.`) }
  }

  const ro = READONLY[cmd]
  if (ro) return { risk: 0, line: ctx.lang === 'tr' ? ro[0] : ro[1] }

  return { risk: 1, line: t(`“${cmd}” programını çalıştırır.`, `Runs the “${cmd}” program.`), unknown: true }
}

function analyzeGit(args: string[], ctx: Ctx): SegResult {
  const t = (tr: string, en: string) => L(ctx, tr, en)
  // git -C dir, git -c k=v gibi genel bayrakları atla
  let i = 0
  while (i < args.length && args[i]!.startsWith('-')) { i += args[i] === '-C' || args[i] === '-c' ? 2 : 1 }
  const sub = args[i] ?? ''
  const rest = args.slice(i + 1)
  const ops = operands(rest)

  switch (sub) {
    case 'status': case 'log': case 'diff': case 'show': case 'blame': case 'fetch': case 'remote': case 'config': case 'rev-parse': case 'ls-files': case 'describe': case 'shortlog': case 'reflog':
      return { risk: 0, line: t('Git geçmişini/durumunu okur, hiçbir şeyi değiştirmez.', 'Reads git history/status; changes nothing.') }
    case 'add':
      return { risk: 0, line: t('Değişiklikleri bir sonraki kayda (commit) hazırlar.', 'Stages changes for the next commit.') }
    case 'commit':
      if (rest.includes('--amend')) return { risk: 2, line: t('Son kaydı (commit) değiştirir; eski hâli kaybolabilir.', 'Rewrites the last commit; its old version may be lost.'), backup: ['gitHead'] }
      return { risk: 1, line: t('Değişiklikleri git geçmişine kaydeder (commit).', 'Saves changes into git history (commit).') }
    case 'push': {
      const force = rest.some(a => a === '--force' || a === '-f' || a.startsWith('--force-with-lease') || /^\+/.test(a) || (/^-[a-zA-Z]+$/.test(a) && a.includes('f')))
      const remote = ops[0] ?? 'origin'
      const ref = ops[1]
      const branch = ref ? ref.replace(/^\+/, '').split(':').pop() : undefined
      if (force) {
        return {
          risk: 4,
          line: t(`ZORLA gönderir (force push): “${remote}” sunucusundaki dalın geçmişi, buradakiyle DEĞİŞTİRİLİR. Başkalarının oradaki çalışması silinebilir.`,
            `FORCE pushes: the branch history on “${remote}” is REPLACED with this one. Other people’s work there can be erased.`),
          backup: ['remote'], remote: branch !== undefined ? { name: remote, branch } : { name: remote },
        }
      }
      return { risk: 2, line: t(`Kayıtları “${remote}” sunucusuna gönderir (başkaları görebilir).`, `Uploads commits to “${remote}” (others can see them).`) }
    }
    case 'reset':
      if (rest.includes('--hard')) return { risk: 3, line: t('Kaydedilmemiş TÜM değişiklikleri siler ve projeyi eski bir kayda döndürür.', 'Discards ALL uncommitted changes and moves the project back to an older commit.'), backup: ['project', 'gitHead'] }
      return { risk: 1, line: t('Hazırlanan değişiklikleri geri çeker (dosyalar değişmez).', 'Unstages changes (files stay as they are).'), backup: ['gitHead'] }
    case 'clean':
      return { risk: hasFlag(rest, 'f') ? 3 : 1, line: t('Git’in takip etmediği (hiç kaydedilmemiş) dosyaları kalıcı olarak siler.', 'Permanently deletes files git doesn’t track (never committed).'), backup: ['project'] }
    case 'checkout': case 'restore': case 'switch':
      if (rest.includes('--') || sub === 'restore' || rest.includes('.') || rest.includes('-f') || rest.includes('--force')) {
        return { risk: 3, line: t('Dosyalardaki kaydedilmemiş değişiklikleri siler, son kayıttaki hâline döndürür.', 'Throws away uncommitted edits, restoring files to the last commit.'), backup: ['project'] }
      }
      return { risk: 1, line: t(`“${ops[0] ?? ''}” dalına geçer.`, `Switches to the “${ops[0] ?? ''}” branch.`), backup: ['gitHead'] }
    case 'branch':
      if (rest.some(a => a === '-D' || a === '-d' || a === '--delete')) {
        const r: SegResult = { risk: rest.includes('-D') ? 3 : 2, line: t(`“${ops[0] ?? ''}” dalını siler.`, `Deletes the “${ops[0] ?? ''}” branch.`), backup: ['gitHead'] }
        if (ops[0]) r.branchRef = ops[0]
        return r
      }
      return { risk: 0, line: t('Dalları listeler ya da yeni dal açar.', 'Lists or creates branches.') }
    case 'rebase':
      return { risk: 2, line: t('Kayıt geçmişini yeniden yazar (rebase). Çakışma olursa yarım kalabilir.', 'Rewrites commit history (rebase). May stop halfway on conflicts.'), backup: ['project', 'gitHead'] }
    case 'merge': case 'pull':
      return { risk: 2, line: t('Başka bir daldaki/sunucudaki değişiklikleri buradakilerle birleştirir.', 'Merges changes from another branch/server into this one.'), backup: ['project', 'gitHead'] }
    case 'stash':
      if (/^(drop|clear)$/.test(ops[0] ?? '')) return { risk: 3, line: t('Kenara ayrılmış (stash) değişiklikleri kalıcı olarak siler.', 'Permanently deletes stashed changes.') }
      return { risk: 1, line: t('Değişiklikleri geçici olarak kenara ayırır/geri getirir.', 'Temporarily shelves/restores changes.'), backup: ['project'] }
    case 'rm':
      return { risk: 2, line: t('Dosyaları hem projeden hem git’ten siler.', 'Deletes files from the project and from git.'), backup: ['project'] }
    case 'filter-branch': case 'filter-repo':
      return { risk: 4, line: t('Tüm git geçmişini yeniden yazar.', 'Rewrites the entire git history.'), backup: ['project', 'gitHead'] }
    case 'clone': case 'init':
      return { risk: 1, line: t('Yeni bir git deposu oluşturur/indirir.', 'Creates/downloads a git repository.') }
    case 'tag':
      return { risk: 1, line: t('Sürüm etiketi ekler/listeler.', 'Adds/lists version tags.') }
    default:
      return { risk: 1, line: t(`git ${sub} komutunu çalıştırır.`, `Runs git ${sub}.`), unknown: true }
  }
}

// ───────────────────────── dışa açık ─────────────────────────

export function analyze(command: string, ctxIn: Omit<Ctx, 'depth'> & { depth?: number }): Analysis {
  const ctx: Ctx = { ...ctxIn, depth: ctxIn.depth ?? 0 }
  const segs = splitSegments(command.length > 20_000 ? command.slice(0, 20_000) : command)
  const out: Analysis = { risk: 0, lines: [], backup: [], paths: [], hasGlob: false, irreversible: [], unknown: [] }
  let secret = false
  for (const seg of segs) {
    const r = analyzeSegment(seg, ctx)
    if (r.secret) secret = true
    if (!r.line) continue
    out.risk = Math.max(out.risk, r.risk) as Risk
    if (!out.lines.includes(r.line.trim())) out.lines.push(r.line.trim())
    for (const b of r.backup ?? []) if (!out.backup.includes(b)) out.backup.push(b)
    for (const p of r.targets ?? []) if (!out.paths.includes(p)) out.paths.push(p)
    if (r.irreversible) out.irreversible.push(r.irreversible)
    if (r.remote) out.remote = r.remote
    if (r.branchRef) out.branchRef = r.branchRef
    if (r.unknown) out.unknown.push(seg.text)
  }
  // Gizli bilgi okunup aynı komutta ağa gönderiliyorsa: sızdırma
  if (secret && NETWORK.test(command)) {
    out.risk = 4
    out.lines.push(L(ctx, '🚨 Gizli bilgilerinizi okuyup internete/başka bir bilgisayara gönderebilir (veri sızdırma)!', '🚨 May read your secrets and send them over the network (exfiltration)!'))
    out.irreversible.push(L(ctx, 'veri sızdırma', 'data exfiltration'))
  }
  out.hasGlob = out.backup.includes('project')
  if (out.lines.length === 0) out.lines.push(L(ctx, 'Komut çalıştırır.', 'Runs a command.'))
  return out
}

/** Diyalogda ve panelde gösterilen tek parça açıklama. */
export function describe(a: Analysis, lang: Lang): string {
  const head = `${RISK_ICON[a.risk]} ${RISK_LABEL[lang][a.risk]}`
  const body = a.lines.length === 1 ? a.lines[0]! : a.lines.map(l => `• ${l}`).join('\n')
  const irr = a.irreversible.length
    ? (lang === 'tr'
      ? `\n⛔ Geri alınamaz: ${[...new Set(a.irreversible)].join(', ')} — Emniyet bunu yedekleyemez.`
      : `\n⛔ Not undoable: ${[...new Set(a.irreversible)].join(', ')} — Emniyet can’t back this up.`)
    : ''
  return `${head} — ${body}${irr}`
}

/** Politika dosyaları: kullanıcının ~/.emniyet/policy.json'u ve projenin .emniyet.json'u. */
export type Policy = { block?: string[]; confirm?: string[]; allow?: string[]; note?: string }

function policyHit(command: string, list: unknown): boolean {
  if (!Array.isArray(list)) return false
  const subject = command.slice(0, 4000)
  return list.slice(0, 200).some(p => {
    if (typeof p !== 'string' || p.length === 0 || p.length > 200) return false
    try { return new RegExp(p, 'i').test(subject) } catch { return subject.includes(p) }
  })
}

/**
 * Kullanıcı politikası her şeyi yapabilir; proje politikası (indirdiğiniz bir depodan gelebilir)
 * yalnızca SIKILAŞTIRIR: "allow" kuralları yok sayılır, böylece kötü niyetli bir depo korumayı kapatamaz.
 */
export function applyPolicy(command: string, user: Policy | undefined, project?: Policy | undefined): 'block' | 'confirm' | 'allow' | undefined {
  if (policyHit(command, user?.block) || policyHit(command, project?.block)) return 'block'
  if (policyHit(command, user?.allow)) return 'allow'
  if (policyHit(command, user?.confirm) || policyHit(command, project?.confirm)) return 'confirm'
  return undefined
}

// ───────────────────────── gizli bilgi maskeleme ─────────────────────────

const SECRET_PATTERNS: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[ÖZEL ANAHTAR]'],
  [/\b(AKIA|ASIA)[0-9A-Z]{16}\b/g, '[AWS-ANAHTARI]'],
  [/\bsk-(ant-|proj-|live_|test_)?[A-Za-z0-9_-]{16,}/g, 'sk-•••'],
  [/\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g, 'gh_•••'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, 'github_pat_•••'],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, 'xox-•••'],
  [/\bglpat-[A-Za-z0-9_-]{16,}/g, 'glpat-•••'],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, 'AIza•••'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[JWT]'],
  [/(\bBearer\s+)[A-Za-z0-9._~+\/=-]{8,}/gi, '$1•••'],
  [/(\/\/[^\s:\/@]+:)[^\s@\/]+(@)/g, '$1•••$2'],
  [/(\b[A-Za-z0-9_]*(PASS(WORD|WD)?|SECRET|TOKEN|API_?KEY|PRIVATE_?KEY|ACCESS_?KEY|CREDENTIALS?|AUTH)[A-Za-z0-9_]*\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s'";&|]+)/gi, '$1•••'],
  [/((?:^|\s)--?(password|passwd|pass|token|secret|api-key|apikey)(?:=|\s+))("[^"]*"|'[^']*'|\S+)/gi, '$1•••'],
  [/(\bmysql\b[^|;&]*\s-p)(\S+)/g, '$1•••'],
]

/** Komut metnindeki parola/anahtar/jetonları maskeler (günlük, panel ve yapay zekâya gitmeden önce). */
export function redact(text: string): string {
  let out = text
  for (const [re, rep] of SECRET_PATTERNS) out = out.replace(re, rep)
  return out
}

/** Terminal kaçış dizilerini ve kontrol karakterlerini temizler (ekranı bozma/kandırma saldırılarına karşı). */
export function sanitize(text: string): string {
  return text
    .replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, '')
}
