import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// Spawned agents persist here so `tsx watch` restarts (every server-file save)
// never orphan live tmux sessions — the sessions outliving the server is the
// whole point of the architecture.

export type AgentRecord = {
  agent: string
  sessionId: string | null
  repoDir: string
  spawnedAt: string
}

const MC_DIR = join(homedir(), '.mission-control')
const AGENTS_FILE = join(MC_DIR, 'agents.json')
const HOOKS_FILE = join(MC_DIR, 'mc-hooks.json')

export const hooksFilePath = (): string => HOOKS_FILE

// claude snapshots hook config at session start — the file must exist before
// the first spawn passes --settings, and stays immutable at runtime (M2).
export const ensureMcDir = (): void => {
  mkdirSync(MC_DIR, { recursive: true })
  if (!existsSync(HOOKS_FILE)) writeFileSync(HOOKS_FILE, '{}\n')
}

export const loadRegistry = (): AgentRecord[] => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(AGENTS_FILE, 'utf8'))
    if (!Array.isArray(parsed)) return []
    return parsed.filter((r): r is AgentRecord => {
      if (typeof r !== 'object' || r === null) return false
      const rec = r as Record<string, unknown>
      return (
        typeof rec['agent'] === 'string' &&
        typeof rec['repoDir'] === 'string' &&
        typeof rec['spawnedAt'] === 'string' &&
        (typeof rec['sessionId'] === 'string' || rec['sessionId'] === null)
      )
    })
  } catch {
    return []
  }
}

export const saveRegistry = (records: AgentRecord[]): void => {
  // Atomic: a process death mid-write must never leave a truncated file —
  // a corrupt registry orphans every live session on the next boot.
  const tmp = `${AGENTS_FILE}.tmp`
  writeFileSync(tmp, `${JSON.stringify(records, null, 2)}\n`)
  renameSync(tmp, AGENTS_FILE)
}
