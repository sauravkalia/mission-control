export type AgentMeta = {
  agent: string
  repoDir: string
  spawnedAt: string
  sessionId: string | null
  dead: boolean
}

export type SpawnRequest = {
  agent: string
  repoDir: string
}

// Callsigns become tmux session names (mc-<agent>) and WS paths — keep them tame.
export const AGENT_NAME_RE = /^[a-z0-9][a-z0-9-]{0,23}$/

export const sessionNameFor = (agent: string): string => `mc-${agent}`
