import { create } from 'zustand'
import type { VaultStats } from '@mc/shared'
import { useLinks } from './linksStore'
import { useVault } from './vaultStore'

export type PullEvent = { from: string; to: string; bytes: number; at: number }
export type IngestEvent = { delta: number; at: number }

type EventsState = {
  baseLive: boolean
  lastPull: PullEvent | null
  lastIngest: IngestEvent | null
  connect: () => () => void
}

const HEARTBEAT_GRACE_MS = 12_000

export const useEvents = create<EventsState>((set) => ({
  baseLive: false,
  lastPull: null,
  lastIngest: null,

  connect: () => {
    let ws: WebSocket | undefined
    let retry: number | undefined
    let beatTimer: number | undefined
    let closed = false

    const markCold = () => set({ baseLive: false })
    const armBeat = () => {
      window.clearTimeout(beatTimer)
      beatTimer = window.setTimeout(markCold, HEARTBEAT_GRACE_MS)
    }

    const open = () => {
      if (closed) return
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      const sock = new WebSocket(`${proto}://${location.host}/ws/events`)
      sock.onmessage = ev => {
        const event = JSON.parse(ev.data as string) as
          | { type: 'pull'; from: string; to: string; bytes: number; at: number }
          | { type: 'links-changed' }
          | { type: 'heartbeat'; at: number }
          | { type: 'vault'; stats: VaultStats }
          | { type: 'ingest'; delta: number; at: number }
        if (event.type === 'heartbeat') {
          set({ baseLive: true })
          armBeat()
        } else if (event.type === 'pull') {
          set({ baseLive: true, lastPull: { from: event.from, to: event.to, bytes: event.bytes, at: event.at } })
          armBeat()
        } else if (event.type === 'links-changed') {
          void useLinks.getState().fetchLinks()
        } else if (event.type === 'vault') {
          useVault.getState().setStats(event.stats)
        } else if (event.type === 'ingest') {
          set({ lastIngest: { delta: event.delta, at: event.at } })
        }
      }
      sock.onclose = () => {
        markCold()
        if (!closed) retry = window.setTimeout(open, 1500)
      }
      ws = sock
    }
    open()

    return () => {
      closed = true
      window.clearTimeout(retry)
      window.clearTimeout(beatTimer)
      ws?.close()
    }
  },
}))
