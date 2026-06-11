import type { VaultStats } from '@mc/shared'
import type { WebSocket } from 'ws'

// Server → client event channel feeding the canvas: status, links, the hero
// pull animation, and the AgentVault data-core (live stats + ingest).

export type McEvent =
  | { type: 'pull'; from: string; to: string; bytes: number; at: number }
  | { type: 'links-changed' }
  | { type: 'heartbeat'; at: number }
  | { type: 'vault'; stats: VaultStats }
  | { type: 'ingest'; delta: number; at: number }

const clients = new Set<WebSocket>()

export const addEventClient = (ws: WebSocket): void => {
  clients.add(ws)
  ws.on('close', () => clients.delete(ws))
}

export const emit = (event: McEvent): void => {
  const frame = JSON.stringify(event)
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) ws.send(frame)
  }
}

// Seed from wall-clock so `at` keeps rising across server restarts — the client
// keys its tracer animation on it and a reset-to-0 could collide and drop a pull.
let monotonic = Date.now()
const nextAt = (): number => (monotonic += 1)

export const emitPull = (from: string, to: string, bytes: number): void =>
  emit({ type: 'pull', from, to, bytes, at: nextAt() })

export const emitIngest = (delta: number): void => emit({ type: 'ingest', delta, at: nextAt() })

export const emitLinksChanged = (): void => emit({ type: 'links-changed' })

// A 5s heartbeat lets BASE pulse and go honestly cold when the server dies.
export const startHeartbeat = (): NodeJS.Timeout =>
  setInterval(() => emit({ type: 'heartbeat', at: nextAt() }), 5000)
