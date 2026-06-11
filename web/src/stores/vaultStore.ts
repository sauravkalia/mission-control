import { create } from 'zustand'
import { apiUrl } from '../lib/api'
import type { VaultStats } from '@mc/shared'

const EMPTY: VaultStats = { connected: false, chunks: 0, sessions: 0, projects: [], sources: [] }

type VaultState = {
  stats: VaultStats
  fetchVault: () => Promise<void>
  setStats: (stats: VaultStats) => void
}

export const useVault = create<VaultState>(set => ({
  stats: EMPTY,
  fetchVault: async () => {
    try {
      const res = await fetch(apiUrl('/api/vault'))
      if (res.ok) set({ stats: (await res.json()) as VaultStats })
    } catch {
      set({ stats: EMPTY })
    }
  },
  setStats: stats => set({ stats }),
}))
