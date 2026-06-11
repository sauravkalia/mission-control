import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type CardGeom = {
  x: number
  y: number
  w: number
  h: number
  minimized: boolean
}

type CardsState = {
  cards: Record<string, CardGeom>
  maximized: string | null
  ensureCard: (agent: string) => void
  reconcile: (liveAgents: string[]) => void
  move: (agent: string, x: number, y: number) => void
  setSize: (agent: string, w: number, h: number) => void
  setMinimized: (agent: string, minimized: boolean) => void
  setMaximized: (agent: string | null) => void
}

// New nodes cascade across canvas space; React Flow's fitView frames them.
const seedPosition = (taken: number): { x: number; y: number } => ({
  x: 80 + (taken % 4) * 680,
  y: 80 + Math.floor(taken / 4) * 480,
})

export const useCards = create<CardsState>()(
  persist(
    (set, get) => ({
      cards: {},
      maximized: null,

      ensureCard: agent => {
        if (get().cards[agent]) return
        const { x, y } = seedPosition(Object.keys(get().cards).length)
        set(s => ({ cards: { ...s.cards, [agent]: { x, y, w: 640, h: 420, minimized: false } } }))
      },

      // Drop geometry for agents that no longer exist — pairs with the server's
      // boot reconcile, so a reload never resurrects ghost cards.
      reconcile: liveAgents => {
        const live = new Set(liveAgents)
        const stale = Object.keys(get().cards).filter(a => !live.has(a))
        if (stale.length === 0) return
        set(s => {
          const cards = { ...s.cards }
          for (const a of stale) delete cards[a]
          return { cards }
        })
      },

      move: (agent, x, y) =>
        set(s => {
          const c = s.cards[agent]
          return c ? { cards: { ...s.cards, [agent]: { ...c, x, y } } } : s
        }),

      setSize: (agent, w, h) =>
        set(s => {
          const c = s.cards[agent]
          return c ? { cards: { ...s.cards, [agent]: { ...c, w, h } } } : s
        }),

      setMinimized: (agent, minimized) =>
        set(s => {
          const c = s.cards[agent]
          if (!c) return s
          // restoring from the dock also clears any maximize on that agent
          const maximized = minimized && s.maximized === agent ? null : s.maximized
          return { cards: { ...s.cards, [agent]: { ...c, minimized } }, maximized }
        }),

      setMaximized: agent => set({ maximized: agent }),
    }),
    { name: 'mc-layout-v2', partialize: s => ({ cards: s.cards }) },
  ),
)
