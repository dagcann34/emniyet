import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const NOW = Date.UTC(2026, 9, 7, 12)

async function paneHas($: any, re: RegExp, surface: 'terminal' | 'desktop' = 'terminal'): Promise<boolean> {
  const ui = await $.ui.mount({
    plugin: 'emniyet', surface, component: 'Pane', requestId: 'emniyet',
    props: { title: 'Emniyet', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 } },
  })
  const found = await ui.find({ type: 'Text', text: re })
  await ui.unmount()
  return found !== undefined
}

type World = { runs: string[][]; asked: string[]; ran: string[] }

function world(on: On, opts: { firstRun?: number; verdict?: 'allow' | 'ask'; answer?: 'yes' | 'no'; store?: Record<string, unknown> } = {}): World {
  const w: World = { runs: [], asked: [], ran: [] }
  mock.clock(on, { now: NOW })
  mock.store(on, { firstRun: opts.firstRun ?? NOW, ...(opts.store ?? {}) })
  mock.env(on, { HOME: '/Users/ali' })
  on('session.cwd', () => ({ value: '/Users/ali/proje' }))
  on('fs.exists', ($, e) => ({ value: /\.(txt|json)$|dist$|\/HEAD$/.test(e.path) && !e.path.endsWith('.emniyet.json') }))
  on('fs.write', () => ({ value: undefined }))
  on('fs.read', () => ({ value: '' }))
  on('process.run', ($, e) => {
    w.runs.push([...e.argv])
    const out = e.argv[0] === 'du' ? '12\t/x\n' : e.argv.includes('rev-parse') ? 'abc1234\n' : e.argv.includes('symbolic-ref') ? 'main\n' : ''
    return { value: { exitCode: 0, stdout: out, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('tool.check', () => ({ decision: opts.verdict ?? 'allow' }))
  on('tool.call', { tool: 'AskUserQuestion' }, ($, e) => {
    const q = e.questions[0]!
    w.asked.push(q.question)
    const label = opts.answer === 'yes' ? q.options[0]!.label : q.options[1]!.label
    return { result: { questions: e.questions, answers: { [q.question]: label } } }
  })
  on('tool.call', { tool: 'Bash' }, ($, e) => {
    w.ran.push(e.command)
    return { result: { stdout: 'ok', stderr: '', interrupted: false } }
  })
  on('model.complete', () => ({ value: { isAnswered: false, reason: 'empty-reply', usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }))
  return w
}

test('rm öncesi hedef dosya arşivlenir', async ($, on) => {
  const w = world(on)
  const r = await $.tool.call({ tool: 'Bash', command: 'rm notlar.txt' })
  expect(r.deny).toBeUndefined()
  expect(w.ran).toEqual(['rm notlar.txt'])
  const tar = w.runs.find(a => a[0] === 'tar')
  expect(tar).toBeDefined()
  expect(tar).toContain('/Users/ali/proje/notlar.txt')
  expect(await paneHas($, /yedek ✓/)).toBe(true)
  expect(await paneHas($, /kalıcı olarak silinir/)).toBe(true)
})

test('kritik komutta onay sorulur; hayır denirse çalışmaz', async ($, on) => {
  const w = world(on, { answer: 'no' })
  const r = await $.tool.call({ tool: 'Bash', command: 'git push --force origin main' })
  expect(w.asked.length).toBe(1)
  expect(w.asked[0]).toContain('ZORLA')
  expect(r.deny).toBeDefined()
  expect(w.ran.length).toBe(0)
})

test('kritik komutta evet denirse uzak dalın eski hâli kaydedilip çalışır', async ($, on) => {
  const w = world(on, { answer: 'yes' })
  const r = await $.tool.call({ tool: 'Bash', command: 'git push --force origin main' })
  expect(r.deny).toBeUndefined()
  expect(w.ran).toEqual(['git push --force origin main'])
  expect(w.runs.some(a => a.includes('ls-remote'))).toBe(true)
})

test('motor izin soracaksa onun yerine Emniyet’in açıklamalı diyaloğu çıkar', async ($, on) => {
  const w = world(on, { verdict: 'ask', answer: 'yes' })
  const check = await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf dist' } })
  expect(check.decision).toBe('ask')
  expect(check.reason).toContain('Emniyet')
  await $.tool.call({ tool: 'Bash', command: 'rm -rf dist' })
  expect(w.asked.length).toBe(1)
  expect(w.asked[0]).toContain('yedek alınacak')
  expect(w.ran).toEqual(['rm -rf dist'])
})

test('orta riskte motor sormuyorsa Emniyet de sormaz', async ($, on) => {
  const w = world(on, { verdict: 'allow' })
  await $.tool.call({ tool: 'Bash', command: 'rm notlar.txt' })
  expect(w.asked.length).toBe(0)
  expect(w.ran).toEqual(['rm notlar.txt'])
})

test('güvenli komutta hiçbir şey sorulmaz, yedek alınmaz', async ($, on) => {
  const w = world(on)
  await $.tool.call({ tool: 'Bash', command: 'ls -la && git status' })
  expect(w.asked.length).toBe(0)
  expect(w.runs.some(a => a[0] === 'tar' || a.includes('add'))).toBe(false)
})

test('İngilizce seçeneği açıklamaları İngilizce yapar', { options: { language: 'en' } }, async ($, on) => {
  world(on)
  await $.tool.call({ tool: 'Bash', command: 'rm notlar.txt' })
  expect(await paneHas($, /Permanently deletes/)).toBe(true)
})

test('panel her yüzeyde çizilir', async ($, on) => {
  world(on)
  await $.tool.call({ tool: 'Bash', command: 'rm notlar.txt' })
  for (const surface of ['terminal', 'desktop'] as const) {
    expect(await paneHas($, /notlar\.txt/, surface)).toBe(true)
  }
})
