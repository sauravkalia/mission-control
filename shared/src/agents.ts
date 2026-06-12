export type AgentStatus = 'running' | 'needs-input' | 'idle' | 'exited'

// What an agent is currently doing + how full its context window is, read live
// from the rendered pane.
export type AgentActivity = {
  status: AgentStatus
  action: string // e.g. "Edit src/cart.ts", "Thinking…", "" when idle
  ctx: number | null // context-window % (0–100), or null if unknown
}

export type AgentMeta = {
  agent: string
  repoDir: string
  spawnedAt: string
  sessionId: string | null
  dead: boolean
  status: AgentStatus
  action: string
  ctx: number | null
}

export type SpawnRequest = {
  agent: string
  repoDir: string
}

// Callsigns become tmux session names (mc-<agent>) and WS paths — keep them tame.
export const AGENT_NAME_RE = /^[a-z0-9][a-z0-9-]{0,23}$/

export const sessionNameFor = (agent: string): string => `mc-${agent}`

// The AgentVault data core — a reserved link/node endpoint that is not an agent.
export const VAULT_ID = '__vault__'

export type VaultStats = {
  connected: boolean
  chunks: number
  sessions: number
  projects: string[]
  sources: string[]
}
