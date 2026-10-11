export type Snap = {
  id: string
  at: number
  cwd: string
  command: string
  paths?: { file: string; list: string[]; sha?: string }
  project?: { dir: string; sha: string }
  gitHead?: { repo: string; sha: string; branch?: string }
  deletedBranch?: { name: string; sha: string }
  remote?: { name: string; branch: string; sha: string }
}

export type LimitWindow = { kind: string; percentUsed: number; resetsAt?: string }
export type Limits = { windows: LimitWindow[]; at: number }
export type Spend = { day: string; dayUsd: number; month: string; monthUsd: number }

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
      limits: Limits | null
      spend: Spend | null
      lastCost: number | null
      offUntil: number
      bandHidden: boolean
    }
  }
}
