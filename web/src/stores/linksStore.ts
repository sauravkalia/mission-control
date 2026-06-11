import { create } from 'zustand'

export type Link = { a: string; b: string }

const key = (x: string, y: string): string => [x, y].sort().join(' ')

type LinksState = {
  links: Link[]
  fetchLinks: () => Promise<void>
  isLinked: (a: string, b: string) => boolean
  createLink: (a: string, b: string) => Promise<void>
  dropLink: (a: string, b: string) => Promise<void>
  setLinks: (links: Link[]) => void
}

export const useLinks = create<LinksState>((set, get) => ({
  links: [],

  fetchLinks: async () => {
    try {
      const res = await fetch('/api/links')
      if (res.ok) set({ links: (await res.json()) as Link[] })
    } catch {
      // server unreachable — strip stays LOS via the events store
    }
  },

  isLinked: (a, b) => get().links.some(l => key(l.a, l.b) === key(a, b)),

  createLink: async (a, b) => {
    if (a === b || get().isLinked(a, b)) return
    const res = await fetch('/api/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ a, b }),
    }).catch(() => undefined)
    if (res?.ok) set({ links: (await res.json()) as Link[] })
  },

  dropLink: async (a, b) => {
    const res = await fetch('/api/links', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ a, b }),
    }).catch(() => undefined)
    if (res?.ok) set({ links: (await res.json()) as Link[] })
  },

  setLinks: links => set({ links }),
}))
