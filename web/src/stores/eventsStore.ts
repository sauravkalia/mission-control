import { create } from 'zustand'
import type { AgentStatus, VaultStats } from '@mc/shared'
import { wsUrl } from '../lib/api'
import { notify } from '../lib/notify'
import { useLinks } from './linksStore'
import { useStatus } from './statusStore'
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
      const sock = new WebSocket(wsUrl('/ws/events'))
      sock.onmessage = ev => {
        const event = JSON.parse(ev.data as string) as
          | { type: 'pull'; from: string; to: string; bytes: number; at: number }
          | { type: 'links-changed' }
          | { type: 'heartbeat'; at: number }
          | { type: 'vault'; stats: VaultStats }
          | { type: 'ingest'; delta: number; at: number }
          | { type: 'status'; agent: string; status: AgentStatus; action: string; ctx: number | null }
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
        } else if (event.type === 'status') {
          // ping the desktop when an agent newly needs you
          const was = useStatus.getState().byAgent[event.agent]?.status
          if (event.status === 'needs-input' && was !== 'needs-input') {
            notify('Agent needs you', `${event.agent.toUpperCase()} is waiting for your input`)
          }
          useStatus.getState().set(event.agent, event.status, event.action, event.ctx)
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
