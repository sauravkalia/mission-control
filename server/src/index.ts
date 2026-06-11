import { createServer } from 'node:http'
import express from 'express'
import { WebSocketServer } from 'ws'
import { attachRelay } from './relay'
import { hasSession } from './tmux'

const PORT = 4711
const HOST = '127.0.0.1'
// M0: single hardcoded session. M1 replaces this with the agent registry.
const ALLOWED_SESSIONS = new Set(['mc-test'])
const TERM_PATH = /^\/ws\/term\/([A-Za-z0-9_-]+)$/
// Browsers do NOT enforce same-origin on WebSockets — without this check any
// website could drive the pty from the user's browser. Vite's proxy forwards
// the browser's real Origin unchanged.
const ALLOWED_ORIGINS = new Set(['http://localhost:5173', 'http://127.0.0.1:5173'])

const app = express()

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

const server = createServer(app)
const wss = new WebSocketServer({ noServer: true })

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
  const session = TERM_PATH.exec(path)?.[1]
  if (!session || !ALLOWED_SESSIONS.has(session)) {
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

server.listen(PORT, HOST, () => {
  console.log(`[mc] uplink on http://${HOST}:${PORT}`)
})
