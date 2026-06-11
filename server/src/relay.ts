import { spawn, type IPty } from 'node-pty'
import type { WebSocket } from 'ws'
import { parseClientMessage } from '@mc/shared'

const RESIZE_DEBOUNCE_MS = 120
const DEFAULT_COLS = 120
const DEFAULT_ROWS = 32

// One pty per connected card, each running its own `tmux attach`. tmux replays
// a full screen redraw on every attach, so reconnects repaint themselves.
export const attachRelay = (ws: WebSocket, session: string): void => {
  let pty: IPty
  try {
    pty = spawn('tmux', ['attach-session', '-t', `=${session}`], {
      name: 'xterm-256color',
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      cwd: process.env['HOME'] ?? '/',
      env: process.env as Record<string, string>,
    })
  } catch {
    // fork failure (tmux missing, spawn-helper exec bit) throws synchronously
    ws.close(1011, 'pty spawn failed')
    return
  }

  let resizeTimer: NodeJS.Timeout | undefined
  let pendingResize: { cols: number; rows: number } | undefined
  let closed = false

  const dataSub = pty.onData(data => {
    if (ws.readyState === ws.OPEN) ws.send(Buffer.from(data, 'utf8'), { binary: true })
  })

  const exitSub = pty.onExit(() => {
    if (!closed) ws.close(1000, 'pty exited')
  })

  ws.on('message', (raw, isBinary) => {
    // Protocol asymmetry: client→server frames are TEXT only (see shared/src/protocol.ts)
    if (isBinary) return
    const msg = parseClientMessage(raw.toString('utf8'))
    if (!msg) return

    if (msg.type === 'input') {
      pty.write(msg.data)
      return
    }

    // Resize via pty (normal client SIGWINCH + tmux `window-size latest`) —
    // never `tmux resize-window`, which flips the window to manual sizing.
    pendingResize = { cols: msg.cols, rows: msg.rows }
    resizeTimer ??= setTimeout(() => {
      resizeTimer = undefined
      if (closed || !pendingResize) return
      try {
        pty.resize(pendingResize.cols, pendingResize.rows)
      } catch {
        // pty already dead — close handler does the cleanup
      }
    }, RESIZE_DEBOUNCE_MS)
  })

  ws.on('close', () => {
    closed = true
    if (resizeTimer !== undefined) clearTimeout(resizeTimer)
    dataSub.dispose()
    exitSub.dispose()
    pty.kill()
  })
}
