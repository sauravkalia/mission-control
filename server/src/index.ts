import { createServer } from 'node:http'
import express, { type RequestHandler } from 'express'
import { WebSocketServer } from 'ws'
import { agentsRouter, bootRegistry, isKnownSession } from './agents'
import { readEnvironment } from './environment'
import { addEventClient, startHeartbeat } from './events'
import { handleMcp } from './mcp'
import { attachRelay } from './relay'
import { ensureMcDir } from './registry'
import { hasSession } from './tmux'

const PORT = 4711
const HOST = '127.0.0.1'
const TERM_PATH = /^\/ws\/term\/([A-Za-z0-9_-]+)$/
const EVENTS_PATH = '/ws/events'
// Browsers do NOT enforce same-origin on WebSockets — without this check any
// website could drive the pty from the user's browser. Vite's proxy forwards
// the browser's real Origin unchanged.
const ALLOWED_ORIGINS = new Set(['http://localhost:5173', 'http://127.0.0.1:5173'])

// POST /api/agents launches claude in an arbitrary directory — it must never
// be reachable from a hostile web page. Host check closes DNS rebinding
// (rebound requests carry Host: evil.com:4711); Origin check closes CSRF from
// loopback origins. Browsers always send Origin on POST/DELETE; absent Origin
// means curl/scripts run by the local user, which are in-trust.
const LOOPBACK_HOSTS = new Set(['127.0.0.1:4711', 'localhost:4711', '127.0.0.1:5173', 'localhost:5173'])

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

server.listen(PORT, HOST, () => {
  console.log(`[mc] uplink on http://${HOST}:${PORT}`)
})
