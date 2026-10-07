export type Snap = {
  id: string
  at: number
  cwd: string
  command: string
  paths?: { file: string; list: string[] }
  project?: { dir: string; sha: string }
  gitHead?: { repo: string; sha: string; branch?: string }
  deletedBranch?: { name: string; sha: string }
  remote?: { name: string; branch: string; sha: string }
}

export type BackupState = 'saved' | 'none' | 'failed' | 'skipped'

export type Entry = {
  id: string
  at: number
  command: string
  risk: 0 | 1 | 2 | 3 | 4
  explanation: string
  backup: BackupState
  notes: string[]
  outcome: 'running' | 'ok' | 'error' | 'denied' | 'cancelled'
  undone?: 'ok' | 'partial'
  isRestore?: boolean
}

declare module 'claude-code' {
  interface PluginState {
    emniyet: {
      entries: Entry[]
      busy: string | null
    }
  }
}
