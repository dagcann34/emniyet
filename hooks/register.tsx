// Emniyet — Claude Code için güvenlik ağı.
// Her Bash komutunu sade dille açıklar, riskliyse onay ister, önce yedek alır,
// /emniyet panelinden ya da /emniyet-geri-al ile tek tıkla geri alır.

import { atom, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

import type { Entry, Snap } from '../types'
import { analyze, applyPolicy, describe, RISK_ICON, RISK_LABEL } from './rules'
import type { Analysis, Lang, Policy, Risk } from './rules'

type Dollar = Parameters<Hook<'tool.call'>>[0]

// ───────────── yedek alma ve geri yükleme ─────────────
// • Hedef dosyalar  : tar.gz (~/.emniyet/backups/<id>.tar.gz)
// • Proje klasörü   : gölge git deposu (~/.emniyet/shadow/<hash>.git) — projenin kendi git'ine DOKUNMAZ
// • Git dalı / uzak dal: eski commit kimlikleri kaydedilir

const REGENERABLE = /(^|\/)(node_modules|\.venv|venv|__pycache__|\.next|\.nuxt|\.turbo|\.cache|\.gradle|Pods|DerivedData|target)$/

const SHADOW_EXCLUDE = [
  'node_modules/', '.venv/', 'venv/', '__pycache__/', '.next/', '.nuxt/', '.turbo/', '.cache/',
  '.gradle/', 'Pods/', 'DerivedData/', 'target/', '*.pyc', '.DS_Store',
].join('\n') + '\n'

const GIT_ID = ['-c', 'user.name=Emniyet', '-c', 'user.email=emniyet@localhost', '-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false']

async function run($: Dollar, argv: string[], cwd?: string, timeoutMs = 60_000) {
  try {
    return await $.process.run(argv, { ...(cwd ? { cwd } : {}), timeoutMs })
  } catch (err) {
    return { exitCode: 127, stdout: '', stderr: String(err), isStdoutTruncated: false, isStderrTruncated: false }
  }
}

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
}

let gitAvailable: boolean | undefined
async function hasGit($: Dollar): Promise<boolean> {
  if (gitAvailable === undefined) gitAvailable = (await run($, ['git', '--version'], undefined, 10_000)).exitCode === 0
  return gitAvailable
}

export function newId(now: number): string {
  const r = Math.floor(Math.random() * 46656).toString(36).padStart(3, '0')
  return now.toString(36).slice(-5) + r
}

export type SnapResult = { snap?: Snap; notes: string[]; sizeKB: number }

type T = (tr: string, en: string) => string

/** Projenin yedeğinin anlamlı olduğu bir klasör mü? (ana klasör ya da sistem kökü değil) */
export function projectSnapshotAllowed(cwd: string, home: string): boolean {
  if (cwd === '/' || cwd === home) return false
  const depth = cwd.split('/').filter(Boolean).length
  return depth >= 2 && !/^\/(Users|home|tmp|private|var|System|Volumes)$/.test(cwd)
}

export async function takeSnapshot(
  $: Dollar,
  a: Pick<Analysis, 'backup' | 'paths' | 'remote' | 'branchRef'>,
  ctx: { cwd: string; home: string; lang: Lang; maxMB: number; command: string; now: number; id: string },
): Promise<SnapResult> {
  const t: T = (tr, en) => (ctx.lang === 'tr' ? tr : en)
  const notes: string[] = []
  const root = `${ctx.home}/.emniyet`
  const snap: Snap = { id: ctx.id, at: ctx.now, cwd: ctx.cwd, command: ctx.command }
  let sizeKB = 0
  let did = false

  // 1) Hedef dosyalar → tar.gz
  if (a.backup.includes('paths') && a.paths.length > 0) {
    const existing: string[] = []
    for (const p of a.paths) {
      if (REGENERABLE.test(p)) { notes.push(t(`“${p.split('/').pop()}” yeniden oluşturulabilir, yedeklenmedi.`, `“${p.split('/').pop()}” is regenerable; not backed up.`)); continue }
      try { if (await $.fs.exists(p)) existing.push(p) } catch { /* yok say */ }
    }
    if (existing.length > 0) {
      const du = await run($, ['du', '-sk', ...existing], undefined, 30_000)
      const kb = du.stdout.split('\n').reduce((s, l) => s + (parseInt(l, 10) || 0), 0)
      if (kb > ctx.maxMB * 1024) {
        notes.push(t(`Hedef çok büyük (${Math.round(kb / 1024)} MB > ${ctx.maxMB} MB sınırı); yedek alınmadı.`, `Target too large (${Math.round(kb / 1024)} MB > ${ctx.maxMB} MB limit); not backed up.`))
      } else {
        await run($, ['mkdir', '-p', `${root}/backups`])
        const file = `${root}/backups/${ctx.id}.tar.gz`
        const r = await run($, ['tar', '-czPf', file, ...existing], undefined, 300_000)
        if (r.exitCode === 0) {
          snap.paths = { file, list: existing }
          sizeKB += kb
          did = true
        } else {
          notes.push(t('Dosya yedeği alınamadı: ', 'File backup failed: ') + r.stderr.trim().slice(0, 160))
        }
      }
    }
  }

  // 2) Proje klasörü → gölge git
  if (a.backup.includes('project')) {
    if (!projectSnapshotAllowed(ctx.cwd, ctx.home)) {
      notes.push(t('Ana klasörde çalışıldığı için proje yedeği atlandı (Claude’u bir proje klasöründe açın).', 'Skipped project backup in the home folder (open Claude in a project folder).'))
    } else if (await hasGit($)) {
      const dir = `${root}/shadow/${await sha256Hex(ctx.cwd)}.git`
      const gd = [`--git-dir=${dir}`, `--work-tree=${ctx.cwd}`]
      if (!(await $.fs.exists(`${dir}/HEAD`))) {
        await run($, ['mkdir', '-p', `${root}/shadow`])
        const init = await run($, ['git', 'init', '-q', '--bare', dir])
        if (init.exitCode === 0) await $.fs.write(`${dir}/info/exclude`, SHADOW_EXCLUDE)
      }
      const add = await run($, ['git', ...GIT_ID, ...gd, 'add', '-A', '--ignore-errors', '.'], ctx.cwd, 180_000)
      const commit = await run($, ['git', ...GIT_ID, ...gd, 'commit', '-q', '--allow-empty', '--no-verify', '-m', `emniyet ${ctx.id}: ${ctx.command.slice(0, 200)}`], ctx.cwd, 120_000)
      const head = await run($, ['git', ...gd, 'rev-parse', 'HEAD'], ctx.cwd)
      if (add.exitCode === 0 && commit.exitCode === 0 && head.exitCode === 0) {
        snap.project = { dir, sha: head.stdout.trim() }
        did = true
      } else {
        notes.push(t('Proje yedeği alınamadı: ', 'Project backup failed: ') + (add.stderr || commit.stderr || head.stderr).trim().slice(0, 160))
      }
    } else {
      notes.push(t('git kurulu olmadığı için proje yedeği alınamadı.', 'git is not installed; project backup skipped.'))
    }
  }

  // 3) Git dalı (HEAD)
  if ((a.backup.includes('gitHead') || a.branchRef) && (await hasGit($))) {
    const top = await run($, ['git', 'rev-parse', '--show-toplevel'], ctx.cwd, 10_000)
    if (top.exitCode === 0) {
      const repo = top.stdout.trim()
      const sha = await run($, ['git', 'rev-parse', 'HEAD'], repo, 10_000)
      const br = await run($, ['git', 'symbolic-ref', '-q', '--short', 'HEAD'], repo, 10_000)
      if (sha.exitCode === 0) {
        snap.gitHead = { repo, sha: sha.stdout.trim(), ...(br.exitCode === 0 ? { branch: br.stdout.trim() } : {}) }
        did = true
      }
      if (a.branchRef) {
        const b = await run($, ['git', 'rev-parse', '--verify', '-q', `refs/heads/${a.branchRef}`], repo, 10_000)
        if (b.exitCode === 0) snap.deletedBranch = { name: a.branchRef, sha: b.stdout.trim() }
      }
    }
  }

  // 4) Uzak dal (force push)
  if (a.backup.includes('remote') && a.remote && (await hasGit($))) {
    let branch = a.remote.branch
    if (!branch) {
      const br = await run($, ['git', 'symbolic-ref', '-q', '--short', 'HEAD'], ctx.cwd, 10_000)
      if (br.exitCode === 0) branch = br.stdout.trim()
    }
    if (branch) {
      const ls = await run($, ['git', 'ls-remote', a.remote.name, `refs/heads/${branch}`], ctx.cwd, 20_000)
      let sha = ls.exitCode === 0 ? ls.stdout.split(/\s/)[0] : undefined
      if (!sha) {
        const local = await run($, ['git', 'rev-parse', '-q', '--verify', `refs/remotes/${a.remote.name}/${branch}`], ctx.cwd, 10_000)
        if (local.exitCode === 0) sha = local.stdout.trim()
      }
      if (sha) {
        snap.remote = { name: a.remote.name, branch, sha }
        did = true
      } else {
        notes.push(t('Uzak dalın eski hâli okunamadı.', 'Couldn’t read the remote branch’s previous state.'))
      }
    }
  }

  return did ? { snap, notes, sizeKB } : { notes, sizeKB }
}

export type RestoreResult = { ok: boolean; notes: string[] }

export async function restoreSnapshot($: Dollar, snap: Snap, lang: Lang): Promise<RestoreResult> {
  const t: T = (tr, en) => (lang === 'tr' ? tr : en)
  const notes: string[] = []
  let ok = true

  // Git dalı önce: dosyalara dokunmadan dal işaretçisini geri al
  if (snap.gitHead) {
    const g = snap.gitHead
    const br = await run($, ['git', 'symbolic-ref', '-q', '--short', 'HEAD'], g.repo, 10_000)
    const cur = br.exitCode === 0 ? br.stdout.trim() : undefined
    if (g.branch && cur !== g.branch) {
      const co = await run($, ['git', 'checkout', '-q', g.branch], g.repo)
      if (co.exitCode === 0) notes.push(t(`“${g.branch}” dalına geri dönüldü.`, `Switched back to “${g.branch}”.`))
      else { ok = false; notes.push(t(`“${g.branch}” dalına dönülemedi: `, `Couldn’t switch back to “${g.branch}”: `) + co.stderr.trim().slice(0, 160)) }
    } else {
      const head = await run($, ['git', 'rev-parse', 'HEAD'], g.repo, 10_000)
      if (head.stdout.trim() !== g.sha) {
        const r = await run($, ['git', 'reset', '-q', '--mixed', g.sha], g.repo)
        if (r.exitCode === 0) notes.push(t(`Git geçmişi ${g.sha.slice(0, 7)} kaydına geri alındı.`, `Git history moved back to ${g.sha.slice(0, 7)}.`))
        else { ok = false; notes.push(t('Git geçmişi geri alınamadı: ', 'Couldn’t restore git history: ') + r.stderr.trim().slice(0, 160)) }
      }
    }
  }

  if (snap.deletedBranch) {
    const d = snap.deletedBranch
    const repo = snap.gitHead?.repo ?? snap.cwd
    const r = await run($, ['git', 'branch', d.name, d.sha], repo, 10_000)
    if (r.exitCode === 0) notes.push(t(`Silinen “${d.name}” dalı geri getirildi.`, `Restored the deleted “${d.name}” branch.`))
    else if (!/already exists/.test(r.stderr)) { ok = false; notes.push(t(`“${d.name}” dalı geri getirilemedi.`, `Couldn’t restore branch “${d.name}”.`)) }
  }

  if (snap.project) {
    const gd = [`--git-dir=${snap.project.dir}`, `--work-tree=${snap.cwd}`]
    const r = await run($, ['git', ...GIT_ID, ...gd, 'checkout', '-f', snap.project.sha, '--', '.'], snap.cwd, 300_000)
    if (r.exitCode === 0) {
      notes.push(t('Proje dosyaları komut öncesindeki hâline döndürüldü.', 'Project files restored to how they were before the command.'))
      const added = await run($, ['git', ...gd, 'ls-files', '--others', '--exclude-standard'], snap.cwd, 60_000)
      const extra = added.stdout.split('\n').filter(Boolean)
      if (extra.length > 0) notes.push(t(`Komuttan sonra eklenen ${extra.length} dosya olduğu gibi bırakıldı.`, `${extra.length} file(s) created after the command were left in place.`))
    } else {
      ok = false
      notes.push(t('Proje dosyaları geri yüklenemedi: ', 'Couldn’t restore project files: ') + r.stderr.trim().slice(0, 160))
    }
  }

  if (snap.paths) {
    const r = await run($, ['tar', '-xzPf', snap.paths.file], undefined, 300_000)
    if (r.exitCode === 0) notes.push(t(`${snap.paths.list.length} dosya/klasör geri yüklendi.`, `Restored ${snap.paths.list.length} file(s)/folder(s).`))
    else { ok = false; notes.push(t('Dosyalar geri yüklenemedi: ', 'Couldn’t restore files: ') + r.stderr.trim().slice(0, 160)) }
  }

  if (snap.remote) {
    const r = snap.remote
    notes.push(t(
      `Sunucudaki dalı da eski hâline döndürmek için şu komutu çalıştırın (başkalarının sonradan gönderdiği değişiklikleri siler):\n  git push --force ${r.name} ${r.sha}:refs/heads/${r.branch}`,
      `To restore the remote branch too, run this (it erases anything others pushed since):\n  git push --force ${r.name} ${r.sha}:refs/heads/${r.branch}`))
  }

  return { ok, notes }
}

const PANE = 'emniyet'
const MAX_ENTRIES = 100
const MAX_SNAPS = 50

const entriesA = atom({ plugin: 'emniyet', key: 'entries' } as const, [] as Entry[])
const busyA = atom({ plugin: 'emniyet', key: 'busy' } as const, null as string | null)

type Stats = { commands: number; risky: number; backups: number; undos: number; blocked: number }
const ZERO: Stats = { commands: 0, risky: 0, backups: 0, undos: 0, blocked: 0 }

type Cfg = { lang: Lang; confirmFrom: Risk | 99; aiExplain: boolean; maxMB: number }
let cfg: Cfg = { lang: 'tr', confirmFrom: 3, aiExplain: true, maxMB: 1024 }
const aiCache = new Map<string, { text: string; risk: Risk }>()
/** Emniyet'in kendi diyaloğunda onaylanan çağrılar: motorun ikinci bir izin sorusu açmasına gerek yok. */
const approved = new Set<string>()

function t(tr: string, en: string): string {
  return cfg.lang === 'tr' ? tr : en
}

// ───────────── yardımcılar ─────────────

async function ctxOf($: Dollar) {
  const cwd = await $.session.cwd()
  const home = (await $.env.get('HOME')) ?? '/'
  return { cwd, home, lang: cfg.lang }
}

async function bump($: Dollar, k: keyof Stats, n = 1) {
  const s = { ...ZERO, ...((await $.store.get('stats')) as Partial<Stats> | undefined) }
  s[k] += n
  await $.store.set('stats', s)
}

async function addEntry($: Dollar, e: Entry) {
  await update($, entriesA, list => [...list, e].slice(-MAX_ENTRIES))
}
async function patchEntry($: Dollar, id: string, patch: Partial<Entry>) {
  await update($, entriesA, list => list.map(x => (x.id === id ? { ...x, ...patch } : x)))
}

async function loadSnaps($: Dollar): Promise<Snap[]> {
  return ((await $.store.get('snaps')) as Snap[] | undefined) ?? []
}
async function saveSnap($: Dollar, s: Snap) {
  const list = await loadSnaps($)
  await $.store.set('snaps', [...list.filter(x => x.id !== s.id), s].slice(-MAX_SNAPS))
}

async function readPolicy($: Dollar, cwd: string): Promise<Policy | undefined> {
  const file = `${cwd}/.emniyet.json`
  try {
    if (!(await $.fs.exists(file))) return undefined
    return JSON.parse(await $.fs.read(file)) as Policy
  } catch {
    return undefined
  }
}

async function audit($: Dollar, home: string, row: Record<string, unknown>) {
  const file = `${home}/.emniyet/audit.jsonl`
  try {
    let prev = ''
    if (await $.fs.exists(file)) prev = await $.fs.read(file)
    if (prev.length > 3_000_000) prev = prev.slice(prev.indexOf('\n', prev.length - 2_000_000) + 1)
    else if (prev === '') await $.process.run(['mkdir', '-p', `${home}/.emniyet`])
    await $.fs.write(file, prev + JSON.stringify(row) + '\n')
  } catch { /* denetim günlüğü işi durdurmaz */ }
}

async function aiDescribe($: Dollar, command: string): Promise<{ text: string; risk: Risk } | undefined> {
  const hit = aiCache.get(command)
  if (hit) return hit
  const r = await $.model.complete({
    model: 'haiku',
    maxTokens: 160,
    timeoutMs: 8000,
    system: t(
      'Sen kod bilmeyen birine terminal komutlarını açıklayan bir asistansın. Yanıtın TEK satır olsun: önce "RISK:<0-4>" (0 sadece okur, 1 zararsız, 2 dosya değiştirir, 3 veri silebilir, 4 geri dönülmez büyük hasar), sonra " | " ve komutun ne yapacağını anlatan en fazla 25 kelimelik sade bir Türkçe cümle. Teknik terim kullanma.',
      'You explain terminal commands to someone who cannot code. Reply with ONE line: first "RISK:<0-4>" (0 read-only, 1 harmless, 2 changes files, 3 may delete data, 4 irreversible major damage), then " | " and one plain sentence of at most 25 words about what the command will do. No jargon.'),
    prompt: command.slice(0, 2000),
  })
  if (!r.isAnswered) return undefined
  const m = /RISK:\s*([0-4])\s*\|\s*(.+)/s.exec(r.text.trim())
  if (!m) return undefined
  const out = { risk: Math.min(3, Number(m[1])) as Risk, text: m[2]!.trim().split('\n')[0]! }
  aiCache.set(command, out)
  return out
}

async function undo($: Dollar, id: string | undefined, interactive: boolean): Promise<string> {
  const snaps = await loadSnaps($)
  const snap = id ? snaps.find(s => s.id === id) : [...snaps].reverse().find(s => !s.command.startsWith('⟲'))
  if (!snap) return t('Geri alınacak bir yedek bulunamadı.', 'No backup found to undo.')
  if (interactive) {
    let answer: string
    try {
      answer = await $.ui.ask(
        t(`“${snap.command.slice(0, 80)}” komutundan önceki hâle dönülsün mü?`, `Restore to before “${snap.command.slice(0, 80)}”?`),
        { header: 'Emniyet', options: [t('Evet, geri al', 'Yes, undo'), t('Vazgeç', 'Cancel')] })
    } catch {
      return t('Geri alma iptal edildi.', 'Undo cancelled.')
    }
    if (answer !== t('Evet, geri al', 'Yes, undo')) return t('Geri alma iptal edildi.', 'Undo cancelled.')
  }
  await update($, busyA, () => snap.id)
  try {
    const ctx = await ctxOf($)
    const now = await $.clock.now()
    // Geri almayı da geri alınabilir yap: önce şimdiki hâlin yedeği
    const preId = newId(now)
    const pre = await takeSnapshot($, {
      backup: [...(snap.paths ? ['paths' as const] : []), ...(snap.project ? ['project' as const] : [])],
      paths: snap.paths?.list ?? [],
    }, { ...ctx, cwd: snap.cwd, maxMB: cfg.maxMB, command: `⟲ ${snap.command}`, now, id: preId })
    if (pre.snap) await saveSnap($, pre.snap)

    const res = await restoreSnapshot($, snap, cfg.lang)
    await update($, entriesA, list => list.map(x => (x.id === snap.id ? { ...x, undone: res.ok ? 'ok' : 'partial' } : x)))
    await addEntry($, {
      id: preId, at: now, command: `⟲ ${snap.command}`, risk: 1, isRestore: true,
      explanation: t('Geri alma yapıldı. Bu satırdaki “Geri al”, geri almayı da geri alır.', 'Undo performed. “Undo” on this row reverts the undo.'),
      backup: pre.snap ? 'saved' : 'none', notes: res.notes, outcome: res.ok ? 'ok' : 'error',
    })
    await bump($, 'undos')
    await audit($, ctx.home, { at: new Date(now).toISOString(), type: 'undo', id: snap.id, ok: res.ok, cwd: snap.cwd })
    $.ui.toast(res.ok ? t('✅ Geri alındı', '✅ Undone') : t('⚠️ Kısmen geri alındı — ayrıntılar /emniyet panelinde', '⚠️ Partially undone — see /emniyet'))
    return (res.ok ? t('✅ Geri alındı.\n', '✅ Undone.\n') : t('⚠️ Kısmen geri alındı.\n', '⚠️ Partially undone.\n')) + res.notes.map(n => `• ${n}`).join('\n')
  } finally {
    await update($, busyA, () => null)
  }
}

export const register: Register = (on, options) => {
  cfg = {
    lang: options.language === 'en' ? 'en' : 'tr',
    confirmFrom: options.confirmFrom === 'never' ? 99 : options.confirmFrom === 'critical' ? 4 : 3,
    aiExplain: options.aiExplain !== false,
    maxMB: typeof options.maxBackupMB === 'number' && options.maxBackupMB > 0 ? options.maxBackupMB : 1024,
  }
  const lang = cfg.lang
  const confirmFrom = cfg.confirmFrom
  const aiExplain = cfg.aiExplain

  // ───────────── oturum başlangıcı ─────────────

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'emniyet', description: t('Emniyet panelini aç: komutlar, riskler, yedekler, geri alma', 'Open the Emniyet pane: commands, risks, backups, undo') })
    await $.command.register({ name: 'emniyet-geri-al', description: t('Son riskli komutu (ya da verilen kimliği) geri al', 'Undo the last risky command (or a given id)'), argumentHint: '[id] [-y]' })
    await $.command.register({ name: 'emniyet-rapor', description: t('Emniyet’in seni kaç kez koruduğunu ve son kayıtları göster', 'Show how often Emniyet protected you and recent records') })
    $.ui.status(t('🛡 Emniyet açık · /emniyet', '🛡 Emniyet on · /emniyet'))
    return next(e)
  })

  // ───────────── komutlar ─────────────

  on('command.run', { command: 'emniyet' }, async $ => {
    await $.ui.open({ id: PANE, title: '🛡 Emniyet' })
    return { text: t('Emniyet paneli açıldı.', 'Emniyet pane opened.') }
  })

  on('command.run', { command: 'emniyet-geri-al' }, async ($, e) => {
    // /emniyet-geri-al [id] [-y]  — -y: onay sormadan (betikler ve claude -p için)
    const parts = e.args.trim().split(/\s+/).filter(Boolean)
    const yes = parts.some(p => p === '-y' || p === '--evet' || p === '--yes')
    const id = parts.find(p => !p.startsWith('-'))
    return { text: await undo($, id, !yes) }
  })

  on('command.run', { command: 'emniyet-rapor' }, async $ => {
    const s = { ...ZERO, ...((await $.store.get('stats')) as Partial<Stats> | undefined) }
    const list = await read($, entriesA)
    const recent = list.filter(x => x.risk >= 2).slice(-10).reverse()
    const home = (await $.env.get('HOME')) ?? '~'
    const lines = [
      t('## 🛡 Emniyet raporu', '## 🛡 Emniyet report'),
      t(`- İncelenen komut: **${s.commands}**`, `- Commands reviewed: **${s.commands}**`),
      t(`- Riskli komut: **${s.risky}**`, `- Risky commands: **${s.risky}**`),
      t(`- Alınan yedek: **${s.backups}**`, `- Backups taken: **${s.backups}**`),
      t(`- Geri alma: **${s.undos}**`, `- Undos: **${s.undos}**`),
      t(`- Durdurulan komut: **${s.blocked}**`, `- Commands stopped: **${s.blocked}**`),
      '',
      recent.length ? t('### Bu oturumdaki riskli komutlar', '### Risky commands this session') : '',
      ...recent.map(x => `- ${RISK_ICON[x.risk]} \`${x.command.slice(0, 80)}\` — ${x.backup === 'saved' ? t('yedekli', 'backed up') : t('yedek yok', 'no backup')}${x.undone ? t(' · geri alındı', ' · undone') : ''}`),
      '',
      t(`Kayıt günlüğü: ${home}/.emniyet/audit.jsonl`, `Audit log: ${home}/.emniyet/audit.jsonl`),
    ]
    return { text: lines.filter((l, i) => l !== '' || i > 0).join('\n') }
  })

  // ───────────── izin diyaloğuna sade açıklama ─────────────

  on('tool.check', { tool: 'Bash' }, async ($, e, next) => {
    const res = await next(e)
    if (res.decision === 'deny') return res
    if (e.tool_use_id && approved.has(e.tool_use_id)) {
      approved.delete(e.tool_use_id)
      return { decision: 'allow', reason: t('Emniyet diyaloğunda onaylandı.', 'Approved in the Emniyet dialog.') }
    }
    if (res.decision !== 'ask') return res
    const command = (e.input as { command?: unknown } | undefined)?.command
    if (typeof command !== 'string') return res
    const a = analyze(command, await ctxOf($))
    return { ...res, reason: `🛡 Emniyet: ${describe(a, lang)}` }
  }).catch(($, e, next) => next(e))

  // ───────────── asıl koruma: her Bash komutu ─────────────

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const command = e.command
    const ctx = await ctxOf($)
    const now = await $.clock.now()
    const a: Analysis = analyze(command, ctx)

    // Tanınmayan komutlar için kısa yapay zekâ açıklaması
    if (aiExplain && a.unknown.length > 0 && a.unknown.length === a.lines.length) {
      const ai = await aiDescribe($, command)
      if (ai) {
        a.lines = [`🤖 ${ai.text}`]
        a.risk = Math.max(a.risk, ai.risk) as Risk
      }
    }

    const explanation = describe(a, lang)
    const id = newId(now)
    await bump($, 'commands')
    if (a.risk >= 2) await bump($, 'risky')

    // Ekip politikası (.emniyet.json)
    const policy = await readPolicy($, ctx.cwd)
    const verdict = applyPolicy(command, policy)
    if (verdict === 'block') {
      await bump($, 'blocked')
      await addEntry($, { id, at: now, command, risk: a.risk, explanation, backup: 'none', notes: [t('Ekip politikası engelledi (.emniyet.json).', 'Blocked by team policy (.emniyet.json).')], outcome: 'denied' })
      await audit($, ctx.home, { at: new Date(now).toISOString(), type: 'blocked', command, cwd: ctx.cwd, risk: a.risk })
      return { deny: t(`Bu komut ekibin Emniyet politikası (.emniyet.json) tarafından engellendi${policy?.note ? `: ${policy.note}` : ''}. Başka bir yol önerin.`, `This command is blocked by the team’s Emniyet policy (.emniyet.json)${policy?.note ? `: ${policy.note}` : ''}. Suggest another way.`) }
    }

    // Onay. Motor bu komut için zaten izin soracaksa (orta risk ve üstü) onun yerine
    // Emniyet'in açıklamalı diyaloğu gösterilir; evet denirse motor ikinci kez sormaz.
    let engineAsks = false
    try { engineAsks = (await $.tool.check({ tool: 'Bash', input: e })).decision === 'ask' } catch { /* sorgu olmazsa sormuş sayma */ }
    const needsConfirm = verdict === 'confirm' || (verdict !== 'allow' && (a.risk >= confirmFrom || (engineAsks && a.risk >= 2)))
    if (needsConfirm) {
      const yes = t('Evet, çalıştır', 'Yes, run it')
      const backupLine = a.risk >= 2 && a.backup.length > 0
        ? t('💾 Çalıştırmadan önce yedek alınacak; /emniyet-geri-al ile geri alabilirsiniz.', '💾 A backup is taken first; undo with /emniyet-geri-al.')
        : a.irreversible.length ? '' : t('ℹ️ Bu komut için yedek gerekmiyor.', 'ℹ️ No backup needed for this command.')
      let answer = ''
      try {
        answer = await $.ui.ask(
          `🛡 ${explanation}${backupLine ? `\n${backupLine}` : ''}\n\n$ ${command.length > 300 ? command.slice(0, 300) + '…' : command}\n\n${t('Bu komut çalıştırılsın mı?', 'Run this command?')}`,
          { header: 'Emniyet', options: [yes, t('Hayır, durdur', 'No, stop')] })
      } catch {
        answer = ''
      }
      if (answer !== yes) {
        await bump($, 'blocked')
        await addEntry($, { id, at: now, command, risk: a.risk, explanation, backup: 'none', notes: [t('Kullanıcı durdurdu.', 'Stopped by the user.')], outcome: 'cancelled' })
        return { deny: t(`Kullanıcı Emniyet uyarısından sonra bu komutu durdurdu (${RISK_LABEL.tr[a.risk]}). Ne yapmak istediğinizi açıklayın ve daha güvenli bir yol önerin.`, `The user stopped this command after an Emniyet warning (${RISK_LABEL.en[a.risk]}). Explain what you intended and suggest a safer way.`) }
      }
      if (e.tool_use_id) approved.add(e.tool_use_id)
    }

    // Yedek
    let backup: Entry['backup'] = 'none'
    const notes: string[] = []
    const wantsBackup = a.risk >= 2 && a.backup.length > 0
    if (wantsBackup) {
      $.ui.status(t('🛡 Emniyet · yedek alınıyor…', '🛡 Emniyet · backing up…'))
      const r = await takeSnapshot($, a, { ...ctx, maxMB: cfg.maxMB, command, now, id })
      notes.push(...r.notes)
      if (r.snap) {
        await saveSnap($, r.snap)
        await bump($, 'backups')
        backup = 'saved'
      } else {
        backup = r.notes.length ? 'skipped' : 'failed'
        // Fail closed: do not run a destructive command without its required backup.
        await bump($, 'blocked')
        const reason = t(
          'Gerekli yedek alınamadığı için komut güvenlik amacıyla çalıştırılmadı.',
          'The command was blocked because its required backup could not be created.',
        )
        await addEntry($, { id, at: now, command, risk: a.risk, explanation, backup, notes: [...notes, reason], outcome: 'denied' })
        await audit($, ctx.home, { at: new Date(now).toISOString(), type: 'blocked', id, command, cwd: ctx.cwd, risk: a.risk, backup, reason })
        return { deny: reason }
      }
    }

    await addEntry($, { id, at: now, command, risk: a.risk, explanation, backup, notes, outcome: 'running' })
    const short = a.lines.join(' ').replace(/\s+/g, ' ')
    $.ui.status(`🛡 ${RISK_ICON[a.risk]} ${short.length > 90 ? short.slice(0, 89) + '…' : short}${backup === 'saved' ? t(' · yedek ✓', ' · backup ✓') : ''}`)
    if (a.risk >= 3) {
      $.ui.toast(backup === 'saved'
        ? t(`${RISK_ICON[a.risk]} Riskli komut — yedek alındı. Geri almak için /emniyet-geri-al`, `${RISK_ICON[a.risk]} Risky command — backed up. Undo with /emniyet-geri-al`)
        : `${RISK_ICON[a.risk]} ${RISK_LABEL[lang][a.risk]}`)
    }

    const ran = await next(e)
    const outcome: Entry['outcome'] = ran.deny !== undefined ? 'denied' : ran.isError ? 'error' : 'ok'
    await patchEntry($, id, { outcome })
    if (a.risk >= 2) {
      await audit($, ctx.home, { at: new Date(now).toISOString(), type: 'command', id, command, cwd: ctx.cwd, risk: a.risk, backup, outcome })
    }
    return ran
  }).catch(($, e, next) => next(e))

  // ───────────── panel ─────────────

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, entriesA)
    const busy = await read($, busyA)
    const width = Math.max(30, e.props.bodyColumns ?? 60)
    const shown = list.filter(x => x.risk >= 1 || x.isRestore).slice(-25).reverse()
    const clock = (ms: number) => new Date(ms).toTimeString().slice(0, 5)
    const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
    const color = (r: number) => (r >= 4 ? 'red' : r === 3 ? 'redBright' : r === 2 ? 'yellow' : 'green')

    return (
      <Box flexDirection="column" width={width}>
        <Box justifyContent="space-between">
          <Text bold>🛡 Emniyet</Text>
          <Text dimColor>{t('ücretsiz · açık kaynak', 'free · open source')}</Text>
        </Box>
        {busy !== null && <Text color="cyan">{t('⏳ Geri alınıyor…', '⏳ Undoing…')}</Text>}
        {shown.length === 0 && (
          <Text dimColor wrap="wrap">{t('Henüz bir komut yok. Claude bir komut çalıştırdığında burada ne yaptığını sade dille göreceksiniz.', 'No commands yet. When Claude runs one, you’ll see what it does here in plain words.')}</Text>
        )}
        {shown.map(x => (
          <Box key={`row-${x.id}`} flexDirection="column" marginTop={1}>
            <Text wrap="truncate-end">
              <Text color={color(x.risk)}>{x.isRestore ? '⟲' : RISK_ICON[x.risk]}</Text>
              <Text dimColor> {clock(x.at)} </Text>
              <Text bold>{cut(x.command.replace(/\s+/g, ' '), width - 10)}</Text>
            </Text>
            <Text wrap="wrap">{x.explanation.replace(/^\S+ [^—]+— /, '')}</Text>
            {x.notes.map((n, i) => <Text key={`n-${x.id}-${i}`} dimColor wrap="wrap">  {n}</Text>)}
            <Box gap={1}>
              <Text dimColor>
                {x.outcome === 'running' ? t('çalışıyor…', 'running…') : x.outcome === 'ok' ? t('tamamlandı', 'done') : x.outcome === 'error' ? t('hata verdi', 'failed') : x.outcome === 'cancelled' ? t('durduruldu', 'stopped') : t('reddedildi', 'denied')}
                {' · '}
                {x.backup === 'saved' ? t('yedek ✓', 'backup ✓') : x.backup === 'skipped' || x.backup === 'failed' ? t('yedek alınamadı', 'no backup') : t('yedek gerekmedi', 'no backup needed')}
                {x.undone ? (x.undone === 'ok' ? t(' · geri alındı ✓', ' · undone ✓') : t(' · kısmen geri alındı', ' · partly undone')) : ''}
              </Text>
              {x.backup === 'saved' && !x.undone && busy === null && (
                <Button
                  key={`undo-${x.id}`}
                  label={x.isRestore ? t('Geri almayı geri al', 'Revert undo') : t('Geri al', 'Undo')}
                  variant="primary"
                  onPress={() => { void undo($, x.id, true) }}
                />
              )}
            </Box>
          </Box>
        ))}
        <Box marginTop={1}>
          <Text dimColor wrap="wrap">{t('/emniyet-geri-al · /emniyet-rapor', '/emniyet-geri-al · /emniyet-rapor')}</Text>
        </Box>
      </Box>
    )
  })
}
