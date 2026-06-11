import { useRef } from 'react'
import { Rnd } from 'react-rnd'
import { sessionNameFor, type AgentMeta } from '@mc/shared'
import { useAgents } from '../stores/agentsStore'
import { useCards } from '../stores/cardsStore'
import { ConsoleCard } from './ConsoleCard'

const MIN_W = 320
const MIN_H = 220
const GHOST_MS = 320

const shortenHome = (p: string): string => p.replace(/^\/Users\/[^/]+/, '~')

// Terminal-safety rule: never animate a mounted xterm. Minimize hides the card
// instantly (xterm stays mounted, PTY attached) and flies a ghost div to the
// dock instead; restore is an instant un-hide with scrollback intact.
const flyGhostToDock = (from: DOMRect, callsign: string) => {
  const ghost = document.createElement('div')
  ghost.className = 'minimize-ghost'
  ghost.textContent = callsign
  Object.assign(ghost.style, {
    left: `${from.left}px`,
    top: `${from.top}px`,
    width: `${from.width}px`,
    height: `${from.height}px`,
  })
  document.body.appendChild(ghost)
  const toX = window.innerWidth / 2 - from.left - from.width / 2
  const toY = window.innerHeight - 40 - from.top
  ghost
    .animate(
      [
        { transform: 'translate(0, 0) scale(1)', opacity: 0.9 },
        { transform: `translate(${toX}px, ${toY}px) scale(0.12)`, opacity: 0 },
      ],
      { duration: GHOST_MS, easing: 'cubic-bezier(0.4, 0, 1, 1)' },
    )
    .finished.finally(() => ghost.remove())
}

export const AgentCard = ({ meta }: { meta: AgentMeta }) => {
  const geom = useCards(s => s.cards[meta.agent])
  const move = useCards(s => s.move)
  const resize = useCards(s => s.resize)
  const raise = useCards(s => s.raise)
  const setMinimized = useCards(s => s.setMinimized)
  const killAgent = useAgents(s => s.killAgent)
  const innerRef = useRef<HTMLDivElement>(null)

  if (!geom) return null
  const session = sessionNameFor(meta.agent)

  const minimize = () => {
    const rect = innerRef.current?.getBoundingClientRect()
    if (rect) flyGhostToDock(rect, meta.agent.toUpperCase())
    setMinimized(meta.agent, true)
  }

  return (
    <Rnd
      size={{ width: geom.w, height: geom.h }}
      position={{ x: geom.x, y: geom.y }}
      style={{ zIndex: geom.z, display: geom.minimized ? 'none' : undefined }}
      minWidth={MIN_W}
      minHeight={MIN_H}
      bounds="parent"
      dragHandleClassName="card-titlebar"
      cancel=".xterm, .card-btn"
      onMouseDown={() => raise(meta.agent)}
      onDragStop={(_e, d) => move(meta.agent, d.x, d.y)}
      onResizeStop={(_e, _dir, ref, _delta, pos) =>
        resize(meta.agent, ref.offsetWidth, ref.offsetHeight, pos.x, pos.y)
      }
    >
      <div ref={innerRef} className="card-fill">
        <ConsoleCard
          callsign={meta.agent.toUpperCase()}
          session={session}
          repoLabel={shortenHome(meta.repoDir)}
          dead={meta.dead}
          onMinimize={minimize}
          onKill={() => void killAgent(meta.agent)}
        />
      </div>
    </Rnd>
  )
}
