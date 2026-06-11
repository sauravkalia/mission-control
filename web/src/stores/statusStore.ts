import { create } from 'zustand'
import type { AgentMeta, AgentStatus } from '@mc/shared'

// What the card paints. 'completed' is a transient the client derives from a
// running → idle transition, so a finished agent flashes DONE before settling.
export type DisplayStatus = 'running' | 'needs-input' | 'completed' | 'idle' | 'exited'

const COMPLETED_MS = 6000

type Entry = { status: AgentStatus; completedAt: number | null }

type StatusState = {
  byAgent: Record<string, Entry>
  set: (agent: string, status: AgentStatus) => void
  seed: (metas: AgentMeta[]) => void
  display: (agent: string) => DisplayStatus
}

const timers = new Map<string, number>()

export const useStatus = create<StatusState>((set, get) => ({
  byAgent: {},

  set: (agent, status) => {
    const prev = get().byAgent[agent]
    const justFinished = prev?.status === 'running' && status === 'idle'
    const completedAt = justFinished ? Date.now() : status === 'idle' ? (prev?.completedAt ?? null) : null
    set(s => ({ byAgent: { ...s.byAgent, [agent]: { status, completedAt } } }))

    window.clearTimeout(timers.get(agent))
    if (completedAt) {
      // clear the DONE flash after the window, forcing a re-render to idle
      timers.set(
        agent,
        window.setTimeout(() => {
          set(s => {
            const e = s.byAgent[agent]
            if (!e || e.completedAt !== completedAt) return s
            return { byAgent: { ...s.byAgent, [agent]: { ...e, completedAt: null } } }
          })
        }, COMPLETED_MS),
      )
    }
  },

  // The 5s REST poll owns the live agent SET. We never clobber an existing
  // entry's status — the WS 'set' path owns transitions, and meta can lag a
  // WS event (stale 'idle' over a live 'running'). But we DO drop agents that
  // no longer exist, so a reused agent name starts from its fresh meta status
  // instead of inheriting the dead agent's stale entry — and entries/timers
  // don't grow unbounded.
  seed: metas => {
    const live = new Set(metas.map(m => m.agent))

    for (const agent of [...timers.keys()]) {
      if (!live.has(agent)) {
        window.clearTimeout(timers.get(agent))
        timers.delete(agent)
      }
    }

    set(s => {
      const byAgent: Record<string, Entry> = {}
      let changed = Object.keys(s.byAgent).length !== metas.length // a prune happened
      for (const m of metas) {
        const prev = s.byAgent[m.agent]
        if (prev) byAgent[m.agent] = prev
        else {
          byAgent[m.agent] = { status: m.status, completedAt: null }
          changed = true
        }
      }
      return changed ? { byAgent } : s
    })
  },

  display: agent => {
    const e = get().byAgent[agent]
    if (!e) return 'idle'
    if (e.status === 'running') return 'running'
    if (e.status === 'needs-input') return 'needs-input'
    if (e.status === 'exited') return 'exited'
    if (e.completedAt && Date.now() - e.completedAt < COMPLETED_MS) return 'completed'
    return 'idle'
  },
}))
