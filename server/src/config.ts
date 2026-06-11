import { accessSync, constants, existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { homedir } from 'node:os'

// Everything that varies between machines lives here, so the app is portable:
// resolved from env first, then sensible auto-detection. Nothing is hardcoded
// to one person's filesystem.

export const PORT = Number(process.env['MC_PORT'] ?? 4711)
export const WEB_PORT = Number(process.env['MC_WEB_PORT'] ?? 5173)

// Find an executable on PATH (a tiny cross-platform `which`).
const onPath = (name: string): string | undefined => {
  for (const dir of (process.env['PATH'] ?? '').split(delimiter)) {
    if (!dir) continue
    const candidate = join(dir, name)
    try {
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {
      // keep looking
    }
  }
  return undefined
}

// The `claude` CLI: env override → PATH → the common ~/.local/bin install.
export const resolveClaudeBin = (): string => {
  const fromEnv = process.env['MC_CLAUDE_BIN']
  if (fromEnv && existsSync(fromEnv)) return fromEnv
  const fromPath = onPath('claude')
  if (fromPath) return fromPath
  const local = join(homedir(), '.local', 'bin', 'claude')
  if (existsSync(local)) return local
  throw new Error('claude CLI not found. Install Claude Code, or set MC_CLAUDE_BIN to its path.')
}

// AgentVault is OPTIONAL — it's a separate personal memory index most users
// won't have. Configure with MC_VAULT_CMD (e.g. "python3 -m agentvault.mcp_server"),
// else we auto-detect python3 on PATH and assume the standard module. Returns
// null when no python is available, which disables the DATA CORE gracefully.
export const resolveVaultCommand = (): { command: string; args: string[] } | null => {
  const fromEnv = process.env['MC_VAULT_CMD']
  if (fromEnv) {
    const [command, ...args] = fromEnv.split(' ').filter(Boolean)
    if (command) return { command, args }
  }
  if (process.env['MC_VAULT_DISABLED'] === '1') return null
  const python = onPath('python3') ?? onPath('python')
  if (!python) return null
  return { command: python, args: ['-m', 'agentvault.mcp_server'] }
}
