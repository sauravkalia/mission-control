import { create } from 'zustand'
import type { AgentMeta } from '@mc/shared'
import { apiUrl } from '../lib/api'
import { useServices } from './servicesStore'
import { useStatus } from './statusStore'

type AgentsState = {
  agents: AgentMeta[]
  loaded: boolean
  linkOk: boolean
  fetchAgents: () => Promise<void>
  spawnAgent: (agent: string, repoDir: string) => Promise<string | undefined>
  killAgent: (agent: string) => Promise<void>
}

export const useAgents = create<AgentsState>((set, get) => ({
  agents: [],
  loaded: false,
  linkOk: true,

  fetchAgents: async () => {
    try {
      const res = await fetch(apiUrl('/api/agents'))
      if (!res.ok) throw new Error(String(res.status))
      const agents = (await res.json()) as AgentMeta[]
      useStatus.getState().seed(agents)
      useServices.getState().seed(agents)
      // Keep the array identity stable across polls — a fresh identity every
      // 5s re-renders every card tree for nothing.
      const same = JSON.stringify(agents) === JSON.stringify(get().agents)
      set(same ? { loaded: true, linkOk: true } : { agents, loaded: true, linkOk: true })
    } catch {
      set({ linkOk: false })
    }
  },

  // Returns an error string for the dialog, or undefined on success.
  spawnAgent: async (agent, repoDir) => {
    try {
      const res = await fetch(apiUrl('/api/agents'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent, repoDir }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        return body.error ?? `spawn failed (${res.status})`
      }
      await get().fetchAgents()
      return undefined
    } catch {
      return 'server unreachable'
    }
  },

  killAgent: async agent => {
    await fetch(apiUrl(`/api/agents/${encodeURIComponent(agent)}`), { method: 'DELETE' }).catch(() => undefined)
    await get().fetchAgents()
  },
}))
