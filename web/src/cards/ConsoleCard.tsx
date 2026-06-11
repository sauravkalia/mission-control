import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import type { ClientMessage } from '@mc/shared'
import { mocrTermTheme } from '../theme/mocrTermTheme'
import '@xterm/xterm/css/xterm.css'
import './console-card.css'

const RETRY_MS = 1500

type LinkState = 'connecting' | 'up' | 'lost'

type ConsoleCardProps = {
  callsign: string
  session: string
  repoLabel: string
}

export const ConsoleCard = ({ callsign, session, repoLabel }: ConsoleCardProps) => {
  const hostRef = useRef<HTMLDivElement>(null)
  const [link, setLink] = useState<LinkState>('connecting')

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
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      const socket = new WebSocket(`${proto}://${location.host}/ws/term/${session}`)
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

  return (
    <section className={`console-card link-${link}`}>
      <header className="card-titlebar">
        <span className={`annunciator ${link === 'up' ? 'st-go' : 'st-los'}`}>
          {link === 'up' ? 'GO' : 'LOS'}
        </span>
        <span className="callsign">{callsign}</span>
        <span className="repo-label">
          {repoLabel} <span className="session-suffix">· {session}</span>
        </span>
      </header>
      <div className="term-well">
        <div className="term-host" ref={hostRef} />
        {link !== 'up' && (
          <div className="link-overlay">
            {link === 'lost' ? 'LINK LOST — RETRYING' : 'ACQUIRING LINK…'}
          </div>
        )}
      </div>
    </section>
  )
}
