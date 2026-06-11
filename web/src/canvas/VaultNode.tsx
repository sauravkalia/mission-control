import { memo, useEffect, useRef, useState } from 'react'
import { Handle, Position } from '@xyflow/react'
import { useEvents } from '../stores/eventsStore'
import { useVault } from '../stores/vaultStore'

const SIDES = [
  { id: 't', pos: Position.Top },
  { id: 'r', pos: Position.Right },
  { id: 'b', pos: Position.Bottom },
  { id: 'l', pos: Position.Left },
]

// The AgentVault data core. Live stats stream in over /ws/events; a real ingest
// (the index grew) flashes the core and ticks the chunk counter.
export const VaultNode = memo(() => {
  const stats = useVault(s => s.stats)
  const lastIngest = useEvents(s => s.lastIngest)
  const [flash, setFlash] = useState(false)
  const flashTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (!lastIngest) return
    setFlash(true)
    window.clearTimeout(flashTimer.current)
    flashTimer.current = window.setTimeout(() => setFlash(false), 900)
  }, [lastIngest?.at]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`vault-node ${stats.connected ? 'connected' : 'offline'} ${flash ? 'ingesting' : ''}`}>
      {SIDES.map(s => (
        <Handle key={s.id} id={s.id} type="source" position={s.pos} className="mc-port vault-port" />
      ))}
      <div className="vault-core">
        <span className="vault-glyph">◈</span>
        <span className="vault-title">DATA CORE</span>
        <span className="vault-sub">AGENTVAULT</span>
      </div>
      <div className="vault-stats">
        <div className="vault-stat">
          <span className="vault-num">{stats.chunks.toLocaleString()}</span>
          <span className="vault-label">chunks</span>
        </div>
        <div className="vault-stat">
          <span className="vault-num">{stats.sessions}</span>
          <span className="vault-label">sessions</span>
        </div>
        <div className="vault-stat">
          <span className="vault-num">{stats.projects.length}</span>
          <span className="vault-label">projects</span>
        </div>
      </div>
      <div className="vault-foot">{stats.connected ? `● ${stats.sources.join(' · ')}` : '○ offline'}</div>
    </div>
  )
})

VaultNode.displayName = 'VaultNode'
