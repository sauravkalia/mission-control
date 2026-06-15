import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AgentMeta } from '@mc/shared'
import { apiUrl } from '../lib/api'

type Svc = { running: boolean; url: string | null; busy: boolean }
const EMPTY: Svc = { running: false, url: null, busy: false }

type ServicesState = {
  byAgent: Record<string, Svc>
  commands: Record<string, string> // persisted run command per agent (monorepo-friendly)
  pwOpen: Record<string, boolean> // best-effort: is this agent's Playwright browser open
  of: (agent: string) => Svc
  setService: (agent: string, running: boolean, url: string | null) => void
  seed: (metas: AgentMeta[]) => void
  setCommand: (agent: string, command: string) => void
  ensureDefaultCommand: (agent: string) => Promise<void>
  runServer: (agent: string) => Promise<string | undefined>
  stopServer: (agent: string) => Promise<void>
  openPlaywright: (agent: string) => Promise<string | undefined>
  closePlaywright: (agent: string) => Promise<void>
}

export const useServices = create<ServicesState>()(
  persist(
    (set, get) => ({
      byAgent: {},
      commands: {},
      pwOpen: {},
      of: agent => get().byAgent[agent] ?? EMPTY,

      setService: (agent, running, url) =>
        set(s => ({ byAgent: { ...s.byAgent, [agent]: { running, url, busy: false } } })),

      seed: metas =>
        set(s => {
          const byAgent = { ...s.byAgent }
          let changed = false
          for (const m of metas) {
            const prev = byAgent[m.agent]
            if ((!prev || prev.running !== m.service.running || prev.url !== m.service.url) && !prev?.busy) {
              byAgent[m.agent] = { running: m.service.running, url: m.service.url, busy: false }
              changed = true
            }
          }
          return changed ? { byAgent } : s
        }),

      setCommand: (agent, command) => set(s => ({ commands: { ...s.commands, [agent]: command } })),

      // prefill the editable command with the server's auto-detected default
      ensureDefaultCommand: async agent => {
        if (get().commands[agent]) return
        const res = await fetch(apiUrl(`/api/agents/${encodeURIComponent(agent)}/run-command`)).catch(() => undefined)
        const body = (await res?.json().catch(() => ({}))) as { command?: string }
        if (body?.command) set(s => (s.commands[agent] ? s : { commands: { ...s.commands, [agent]: body.command! } }))
      },

      runServer: async agent => {
        set(s => ({ byAgent: { ...s.byAgent, [agent]: { ...get().of(agent), busy: true } } }))
        const res = await fetch(apiUrl(`/api/agents/${encodeURIComponent(agent)}/server`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: get().commands[agent] ?? '' }),
        }).catch(() => undefined)
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

      openPlaywright: async agent => {
        const res = await fetch(apiUrl(`/api/agents/${encodeURIComponent(agent)}/playwright`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'open' }),
        }).catch(() => undefined)
        if (!res?.ok) return 'could not reach the agent'
        set(s => ({ pwOpen: { ...s.pwOpen, [agent]: true } }))
        return undefined
      },

      closePlaywright: async agent => {
        set(s => ({ pwOpen: { ...s.pwOpen, [agent]: false } }))
        await fetch(apiUrl(`/api/agents/${encodeURIComponent(agent)}/playwright`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'close' }),
        }).catch(() => undefined)
      },
    }),
    { name: 'mc-services-v1', partialize: s => ({ commands: s.commands }) },
  ),
)
