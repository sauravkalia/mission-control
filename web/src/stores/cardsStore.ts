import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { placeCard, type Rect } from '../layout/autoPlace'

export type CardGeom = {
  x: number
  y: number
  w: number
  h: number
  z: number
  minimized: boolean
}

type CardsState = {
  cards: Record<string, CardGeom>
  nextZ: number
  ensureCard: (agent: string) => void
  reconcile: (liveAgents: string[]) => void
  clampToViewport: (vw: number, vh: number) => void
  move: (agent: string, x: number, y: number) => void
  resize: (agent: string, w: number, h: number, x: number, y: number) => void
  raise: (agent: string) => void
  setMinimized: (agent: string, minimized: boolean) => void
}

const STRIP_H = 36
const MIN_VISIBLE = 160

export const useCards = create<CardsState>()(
  persist(
    (set, get) => ({
      cards: {},
      nextZ: 1,

      ensureCard: agent => {
        if (get().cards[agent]) return
        const visible: Rect[] = Object.values(get().cards).filter(c => !c.minimized)
        const { x, y } = placeCard(visible, { w: window.innerWidth, h: window.innerHeight })
        set(s => ({
          cards: { ...s.cards, [agent]: { x, y, w: 720, h: 460, z: s.nextZ, minimized: false } },
          nextZ: s.nextZ + 1,
        }))
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

      // Geometry persisted on a big external monitor can sit fully off-screen
      // on the laptop — bounds="parent" only constrains live drags.
      clampToViewport: (vw, vh) =>
        set(s => {
          let changed = false
          const cards = { ...s.cards }
          for (const [agent, c] of Object.entries(cards)) {
            const x = Math.max(Math.min(c.x, vw - MIN_VISIBLE), MIN_VISIBLE - c.w)
            const y = Math.max(Math.min(c.y, vh - 80), STRIP_H)
            if (x !== c.x || y !== c.y) {
              cards[agent] = { ...c, x, y }
              changed = true
            }
          }
          return changed ? { cards } : s
        }),

      move: (agent, x, y) =>
        set(s => {
          const c = s.cards[agent]
          return c ? { cards: { ...s.cards, [agent]: { ...c, x, y } } } : s
        }),

      resize: (agent, w, h, x, y) =>
        set(s => {
          const c = s.cards[agent]
          return c ? { cards: { ...s.cards, [agent]: { ...c, w, h, x, y } } } : s
        }),

      raise: agent =>
        set(s => {
          const c = s.cards[agent]
          if (!c || c.z === s.nextZ - 1) return s
          return { cards: { ...s.cards, [agent]: { ...c, z: s.nextZ } }, nextZ: s.nextZ + 1 }
        }),

      setMinimized: (agent, minimized) =>
        set(s => {
          const c = s.cards[agent]
          return c ? { cards: { ...s.cards, [agent]: { ...c, minimized } } } : s
        }),
    }),
    { name: 'mc-layout-v1' },
  ),
)
