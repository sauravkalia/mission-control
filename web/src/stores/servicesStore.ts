import { create } from 'zustand'
import type { AgentMeta } from '@mc/shared'
import { apiUrl } from '../lib/api'

type Svc = { running: boolean; url: string | null; busy: boolean }
const EMPTY: Svc = { running: false, url: null, busy: false }

type ServicesState = {
  byAgent: Record<string, Svc>
  of: (agent: string) => Svc
  setService: (agent: string, running: boolean, url: string | null) => void
  seed: (metas: AgentMeta[]) => void
  runServer: (agent: string) => Promise<string | undefined>
  stopServer: (agent: string) => Promise<void>
  runPlaywright: (agent: string) => Promise<string | undefined>
}

export const useServices = create<ServicesState>((set, get) => ({
  byAgent: {},
  of: agent => get().byAgent[agent] ?? EMPTY,

  setService: (agent, running, url) =>
    set(s => ({ byAgent: { ...s.byAgent, [agent]: { running, url, busy: false } } })),

  seed: metas =>
    set(s => {
      const byAgent = { ...s.byAgent }
      let changed = false
      for (const m of metas) {
        const prev = byAgent[m.agent]
        if (!prev || prev.running !== m.service.running || prev.url !== m.service.url) {
          if (!prev?.busy) {
            byAgent[m.agent] = { running: m.service.running, url: m.service.url, busy: false }
            changed = true
          }
        }
      }
      return changed ? { byAgent } : s
    }),

  runServer: async agent => {
    set(s => ({ byAgent: { ...s.byAgent, [agent]: { ...get().of(agent), busy: true } } }))
    const res = await fetch(apiUrl(`/api/agents/${encodeURIComponent(agent)}/server`), { method: 'POST' }).catch(() => undefined)
    if (!res?.ok) {
      set(s => ({ byAgent: { ...s.byAgent, [agent]: { ...get().of(agent), busy: false } } }))
      const body = (await res?.json().catch(() => ({}))) as { error?: string }
      return body?.error ?? 'could not start the dev server'
    }
    set(s => ({ byAgent: { ...s.byAgent, [agent]: { running: true, url: null, busy: false } } }))
    return undefined
  },

  stopServer: async agent => {
    set(s => ({ byAgent: { ...s.byAgent, [agent]: { running: false, url: null, busy: false } } }))
    await fetch(apiUrl(`/api/agents/${encodeURIComponent(agent)}/server`), { method: 'DELETE' }).catch(() => undefined)
  },

  runPlaywright: async agent => {
    const res = await fetch(apiUrl(`/api/agents/${encodeURIComponent(agent)}/playwright`), { method: 'POST' }).catch(() => undefined)
    if (!res?.ok) return 'could not reach the agent'
    return undefined
  },
}))
