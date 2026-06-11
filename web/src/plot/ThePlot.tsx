import { useEffect, useMemo, useRef, useState } from 'react'
import { useAgents } from '../stores/agentsStore'
import { useEvents } from '../stores/eventsStore'
import { useLinks } from '../stores/linksStore'
import { useCards } from '../stores/cardsStore'
import './plot.css'

const W = 460
const H = 260
const CX = W / 2
const CY = H / 2 + 10
const R = 84
const HIT = 22

type Pos = { agent: string; x: number; y: number; dead: boolean }
type Tracer = { id: number; from: string; to: string }

const pairKey = (a: string, b: string): string => [a, b].sort().join(' ')

export const ThePlot = () => {
  const agents = useAgents(s => s.agents)
  const links = useLinks(s => s.links)
  const createLink = useLinks(s => s.createLink)
  const dropLink = useLinks(s => s.dropLink)
  const baseLive = useEvents(s => s.baseLive)
  const lastPull = useEvents(s => s.lastPull)
  const raise = useCards(s => s.raise)
  const setMinimized = useCards(s => s.setMinimized)

  const svgRef = useRef<SVGSVGElement>(null)
  const [linking, setLinking] = useState<{ from: string; x: number; y: number; moved: boolean } | null>(null)
  const [tracers, setTracers] = useState<Tracer[]>([])
  const [heat, setHeat] = useState<Record<string, number>>({})
  const tracerId = useRef(0)

  const positions = useMemo<Pos[]>(() => {
    const n = agents.length
    return agents.map((a, i) => {
      const angle = (-90 + (i * 360) / Math.max(1, n)) * (Math.PI / 180)
      return { agent: a.agent, x: CX + R * Math.cos(angle), y: CY + R * Math.sin(angle), dead: a.dead }
    })
  }, [agents])

  const posOf = (agent: string): Pos | undefined => positions.find(p => p.agent === agent)

  // pull → tracer + edge heat
  useEffect(() => {
    if (!lastPull) return
    const id = (tracerId.current += 1)
    setTracers(t => [...t, { id, from: lastPull.from, to: lastPull.to }])
    setHeat(h => ({ ...h, [pairKey(lastPull.from, lastPull.to)]: Math.min(0.6, (h[pairKey(lastPull.from, lastPull.to)] ?? 0) + 0.25) }))
    const timer = window.setTimeout(() => setTracers(t => t.filter(x => x.id !== id)), 1000)
    return () => window.clearTimeout(timer)
  }, [lastPull?.at]) // eslint-disable-line react-hooks/exhaustive-deps

  // heat decay
  useEffect(() => {
    const t = window.setInterval(() => {
      setHeat(h => {
        let changed = false
        const next: Record<string, number> = {}
        for (const [k, v] of Object.entries(h)) {
          const nv = v - 0.02
          if (nv > 0.01) {
            next[k] = nv
            changed = true
          } else changed = true
        }
        return changed ? next : h
      })
    }, 1000)
    return () => window.clearInterval(t)
  }, [])

  const toSvg = (clientX: number, clientY: number) => {
    const r = svgRef.current?.getBoundingClientRect()
    if (!r) return { x: 0, y: 0 }
    return { x: ((clientX - r.left) * W) / r.width, y: ((clientY - r.top) * H) / r.height }
  }

  const nearestStation = (x: number, y: number, exclude: string): string | null => {
    for (const p of positions) {
      if (p.agent === exclude) continue
      if (Math.hypot(p.x - x, p.y - y) <= HIT) return p.agent
    }
    return null
  }

  useEffect(() => {
    if (!linking) return
    const onMove = (e: PointerEvent) => {
      const { x, y } = toSvg(e.clientX, e.clientY)
      setLinking(l => (l ? { ...l, x, y, moved: l.moved || Math.hypot(x - (posOf(l.from)?.x ?? x), y - (posOf(l.from)?.y ?? y)) > 6 } : l))
    }
    const onUp = (e: PointerEvent) => {
      const { x, y } = toSvg(e.clientX, e.clientY)
      const target = nearestStation(x, y, linking.from)
      if (linking.moved && target) {
        void createLink(linking.from, target)
      } else if (!linking.moved) {
        // a click (no drag) raises/restores the station's card
        setMinimized(linking.from, false)
        raise(linking.from)
      }
      setLinking(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [linking, positions]) // eslint-disable-line react-hooks/exhaustive-deps

  const pulls = Object.values(heat).length

  return (
    <section className="plot-panel">
      <header className="plot-header">
        THE PLOT — {String(agents.length).padStart(2, '0')} STN · {String(links.length).padStart(2, '0')} LNK
      </header>
      <svg ref={svgRef} className="plot-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
        <circle cx={CX} cy={CY} r={R} className="plot-orbit" />

        {/* standing link wires (click to remove) */}
        {links.map(l => {
          const a = posOf(l.a)
          const b = posOf(l.b)
          if (!a || !b) return null
          const h = heat[pairKey(l.a, l.b)] ?? 0
          return (
            <line
              key={pairKey(l.a, l.b)}
              x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              className="plot-wire"
              style={{ opacity: 0.28 + h }}
              onClick={() => void dropLink(l.a, l.b)}
            >
              <title>click to disconnect {l.a} ─ {l.b}</title>
            </line>
          )
        })}

        {/* rubber-band while drawing a wire */}
        {linking && posOf(linking.from) && (
          <line
            x1={posOf(linking.from)!.x} y1={posOf(linking.from)!.y}
            x2={linking.x} y2={linking.y}
            className="plot-wire drawing"
          />
        )}

        {/* pull tracers: from → BASE → to */}
        {tracers.map(tr => {
          const a = posOf(tr.from)
          const b = posOf(tr.to)
          if (!a || !b) return null
          const path = `M ${a.x} ${a.y} L ${CX} ${CY} L ${b.x} ${b.y}`
          return (
            <circle key={tr.id} r={3.5} className="plot-tracer">
              <animateMotion dur="0.9s" path={path} fill="freeze" />
            </circle>
          )
        })}

        {/* BASE */}
        <g className={`plot-base ${baseLive ? 'live' : 'cold'}`}>
          <circle cx={CX} cy={CY} r={9} className="plot-base-ring" />
          <line x1={CX - 5} y1={CY} x2={CX + 5} y2={CY} className="plot-base-cross" />
          <line x1={CX} y1={CY - 5} x2={CX} y2={CY + 5} className="plot-base-cross" />
          <text x={CX} y={CY + 22} className="plot-base-label">BASE</text>
        </g>

        {/* stations */}
        {positions.map(p => (
          <g
            key={p.agent}
            className={`plot-station ${p.dead ? 'dead' : 'go'} ${linking?.from === p.agent ? 'linking' : ''}`}
            onPointerDown={e => {
              e.preventDefault()
              setLinking({ from: p.agent, x: p.x, y: p.y, moved: false })
            }}
          >
            <circle cx={p.x} cy={p.y} r={13} className="station-halo" />
            <circle cx={p.x} cy={p.y} r={5} className="station-core" />
            <text x={p.x} y={p.y - 18} className="station-label">{p.agent.toUpperCase()}</text>
          </g>
        ))}
      </svg>
      <footer className="plot-foot">
        {agents.length < 2
          ? 'spawn 2+ stations, then drag one onto another to share memory'
          : 'drag a station onto another to wire them · click a wire to cut it'}
        {pulls > 0 && <span className="plot-foot-pulls"> · {pulls} active link{pulls > 1 ? 's' : ''} warm</span>}
      </footer>
    </section>
  )
}
