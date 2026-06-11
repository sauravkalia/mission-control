import { createServer } from 'node:http'
import express, { type RequestHandler } from 'express'
import { WebSocketServer } from 'ws'
import { agentsRouter, bootRegistry, isKnownSession } from './agents'
import { PORT, WEB_PORT } from './config'
import { readEnvironment } from './environment'
import { addEventClient, startHeartbeat } from './events'
import { handleMcp } from './mcp'
import { startStatusPolling } from './status'
import { closeVault, startVaultPolling, vaultStats } from './vault'
import { attachRelay } from './relay'
import { ensureMcDir } from './registry'
import { hasSession } from './tmux'

const HOST = '127.0.0.1'
const TERM_PATH = /^\/ws\/term\/([A-Za-z0-9_-]+)$/
const EVENTS_PATH = '/ws/events'
// Browsers do NOT enforce same-origin on WebSockets — without this check any
// website could drive the pty from the user's browser. Vite's proxy forwards
// the browser's real Origin unchanged.
// tauri://localhost (macOS/Linux) and http://tauri.localhost (Windows) are the
// packaged-app webview origins.
const ALLOWED_ORIGINS = new Set([
  `http://localhost:${WEB_PORT}`,
  `http://127.0.0.1:${WEB_PORT}`,
  'tauri://localhost',
  'http://tauri.localhost',
])

// POST /api/agents launches claude in an arbitrary directory — it must never
// be reachable from a hostile web page. Host check closes DNS rebinding
// (rebound requests carry Host: evil.com:4711); Origin check closes CSRF from
// loopback origins. Browsers always send Origin on POST/DELETE; absent Origin
// means curl/scripts run by the local user, which are in-trust.
const LOOPBACK_HOSTS = new Set([
  `127.0.0.1:${PORT}`, `localhost:${PORT}`, `127.0.0.1:${WEB_PORT}`, `localhost:${WEB_PORT}`,
])

const apiGuard: RequestHandler = (req, res, next) => {
  if (!LOOPBACK_HOSTS.has(req.headers.host ?? '')) {
    res.status(403).json({ error: 'forbidden host' })
    return
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const origin = req.headers.origin
    if (typeof origin === 'string' && !ALLOWED_ORIGINS.has(origin)) {
      res.status(403).json({ error: 'forbidden origin' })
      return
    }
  }
  next()
}

// The MCP endpoint is reached by claude (not a browser, sends no Origin), so it
// gets a Host-only guard against DNS rebinding rather than the Origin check.
const mcpGuard: RequestHandler = (req, res, next) => {
  if (!LOOPBACK_HOSTS.has(req.headers.host ?? '')) {
    res.status(403).json({ error: 'forbidden host' })
    return
  }
  next()
}

ensureMcDir()
await bootRegistry()

const app = express()
app.use('/api', apiGuard)
app.use(express.json())

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})
app.get('/api/environment', (_req, res) => {
  res.json(readEnvironment())
})
app.get('/api/vault', (_req, res) => {
  res.json(vaultStats())
})
app.use('/api', agentsRouter())
app.all('/mcp', mcpGuard, handleMcp)

const server = createServer(app)
const wss = new WebSocketServer({ noServer: true })
const eventsWss = new WebSocketServer({ noServer: true })

server.on('upgrade', (req, socket, head) => {
  // The http server detaches its own error listener before emitting 'upgrade';
  // without this, an RST during the async gap below crashes the process.
  socket.on('error', () => socket.destroy())

  const origin = req.headers.origin
  if (typeof origin !== 'string' || !ALLOWED_ORIGINS.has(origin)) {
    socket.destroy()
    return
  }
  // No `new URL` here — a crafted request-target like `//::` makes it throw.
  const path = (req.url ?? '').split('?')[0] ?? ''

  if (path === EVENTS_PATH) {
    eventsWss.handleUpgrade(req, socket, head, ws => addEventClient(ws))
    return
  }

  const session = TERM_PATH.exec(path)?.[1]
  if (!session || !isKnownSession(session)) {
    socket.destroy()
    return
  }
  void hasSession(session).then(alive => {
    if (!alive) {
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, ws => {
      attachRelay(ws, session)
    })
  })
})

startHeartbeat()
const vaultPoll = startVaultPolling()
const statusPoll = startStatusPolling()

// Reap the spawned AgentVault python on shutdown / tsx-watch restart, instead of
// orphaning it (its child isn't in our process group, so SIGTERM won't reach it).
let shuttingDown = false
const shutdown = () => {
  if (shuttingDown) return
  shuttingDown = true
  if (vaultPoll) clearInterval(vaultPoll)
  clearInterval(statusPoll)
  void closeVault().finally(() => process.exit(0))
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

server.listen(PORT, HOST, () => {
  console.log(`[mc] uplink on http://${HOST}:${PORT}`)
})
