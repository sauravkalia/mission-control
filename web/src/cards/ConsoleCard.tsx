import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import type { ClientMessage } from '@mc/shared'
import { wsUrl } from '../lib/api'
import type { DisplayStatus } from '../stores/statusStore'
import { mocrTermTheme } from '../theme/mocrTermTheme'
import { CardToolbar } from './CardToolbar'
import '@xterm/xterm/css/xterm.css'
import './console-card.css'

const RETRY_MS = 1500
const COPY_FLASH_MS = 1200

type LinkState = 'connecting' | 'up' | 'lost'

type ConsoleCardProps = {
  agent: string
  callsign: string
  session: string
  repoLabel: string
  dead: boolean
  status: DisplayStatus
  onMinimize: () => void
  onKill: () => void
  maximized?: boolean
  onToggleMaximize?: () => void
}

const ANNUNCIATOR: Record<DisplayStatus, { label: string; cls: string }> = {
  running: { label: 'RUN', cls: 'st-run' },
  'needs-input': { label: 'ACTN', cls: 'st-actn' },
  completed: { label: 'DONE', cls: 'st-done' },
  idle: { label: 'IDLE', cls: 'st-idle' },
  exited: { label: 'LOS', cls: 'st-los' },
}

const KILL_HOLD_MS = 600

// Killing terminates a real tmux session — the button arms like a switch:
// hold 600ms while it fills, release early to cancel.
const KillButton = ({ onKill }: { onKill: () => void }) => {
  const timer = useRef<number | undefined>(undefined)
  const [arming, setArming] = useState(false)

  const start = () => {
    setArming(true)
    timer.current = window.setTimeout(onKill, KILL_HOLD_MS)
  }
  const cancel = () => {
    setArming(false)
    window.clearTimeout(timer.current)
  }

  return (
    <button
      type="button"
      className={`card-btn kill-btn${arming ? ' arming' : ''}`}
      title="hold to kill session"
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
    >
      ×
    </button>
  )
}

export const ConsoleCard = ({
  agent,
  callsign,
  session,
  repoLabel,
  dead,
  status,
  onMinimize,
  onKill,
  maximized,
  onToggleMaximize,
}: ConsoleCardProps) => {
  const hostRef = useRef<HTMLDivElement>(null)
  const [link, setLink] = useState<LinkState>('connecting')
  const [copied, setCopied] = useState(false)

  const copyAttach = () => {
    void navigator.clipboard.writeText(`tmux attach -t ${session}`).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), COPY_FLASH_MS)
    })
  }

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const term = new Terminal({
      theme: mocrTermTheme,
      fontFamily: '"JetBrains Mono", "SF Mono", Menlo, monospace',
      fontSize: 13,
      lineHeight: 1.35,
      cursorBlink: true,
      scrollback: 5000,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    try {
      const webgl = new WebglAddon()
      term.loadAddon(webgl)
      webgl.onContextLoss(() => {
        webgl.dispose() // xterm falls back to the DOM renderer
      })
    } catch {
      // WebGL unavailable — DOM renderer fallback
    }
    fit.fit()

    let ws: WebSocket | undefined
    let retryTimer: number | undefined
    let raf = 0
    let disposed = false

    const send = (msg: ClientMessage) => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
    }

    const connect = () => {
      if (disposed) return
      const socket = new WebSocket(wsUrl(`/ws/term/${session}`))
      socket.binaryType = 'arraybuffer'
      socket.onopen = () => {
        setLink('up')
        fit.fit()
        send({ type: 'resize', cols: term.cols, rows: term.rows })
      }
      socket.onmessage = event => {
        if (event.data instanceof ArrayBuffer) term.write(new Uint8Array(event.data))
      }
      socket.onclose = () => {
        if (disposed) return
        setLink('lost')
        // tmux replays a full redraw on reattach — reconnect repaints for free
        retryTimer = window.setTimeout(connect, RETRY_MS)
      }
      ws = socket
    }
    connect()

    const inputSub = term.onData(data => {
      send({ type: 'input', data })
    })

    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        // display:none while minimized — fitting a zero-size host computes garbage
        if (host.clientWidth === 0 || host.clientHeight === 0) return
        fit.fit()
        send({ type: 'resize', cols: term.cols, rows: term.rows })
      })
    })
    ro.observe(host)

    return () => {
      disposed = true
      if (retryTimer !== undefined) window.clearTimeout(retryTimer)
      cancelAnimationFrame(raf)
      ro.disconnect()
      inputSub.dispose()
      ws?.close()
      term.dispose()
    }
  }, [session])

  // the socket-lost state still overrides to LOS regardless of agent status
  const effective: DisplayStatus = dead ? 'exited' : status
  const ann = ANNUNCIATOR[effective]

  return (
    <section className={`console-card link-${link} status-${effective}`}>
      <header
        className="card-titlebar"
        onDoubleClick={() => onToggleMaximize?.()}
        title={onToggleMaximize ? 'double-click to maximize' : undefined}
      >
        <span className={`annunciator ${ann.cls}`}>
          {effective === 'running' && <span className="ann-spinner" />}
          {ann.label}
        </span>
        <span className="callsign">{callsign}</span>
        <span className="repo-label">
          <span className="repo-path">{repoLabel}</span>
          <span className="session-suffix">· {session}</span>
        </span>
        <span className="card-actions nodrag">
          <button type="button" className="card-btn" title="copy tmux attach command" onClick={copyAttach}>
            {copied ? '✓' : '⧉'}
          </button>
          {!maximized && (
            <button type="button" className="card-btn" title="minimize to dock" onClick={onMinimize}>
              –
            </button>
          )}
          {onToggleMaximize && (
            <button
              type="button"
              className="card-btn maximize-btn"
              title={maximized ? 'restore to canvas' : 'maximize'}
              onClick={onToggleMaximize}
            >
              {maximized ? '❐' : '□'}
            </button>
          )}
          <KillButton onKill={onKill} />
        </span>
      </header>
      <CardToolbar agent={agent} />
      <div className="term-well nodrag nowheel">
        <div className="term-host" ref={hostRef} />
        {copied && <div className="copy-toast">COPIED — ATTACH FROM ANY TERMINAL</div>}
        {link !== 'up' && (
          <div className="link-overlay">
            {link === 'lost' ? 'LINK LOST — RETRYING' : 'ACQUIRING LINK…'}
          </div>
        )}
      </div>
    </section>
  )
}
