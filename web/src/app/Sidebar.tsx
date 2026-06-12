import { useEffect, useMemo, useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import { VAULT_ID, type AgentMeta } from '@mc/shared'
import { ensureNotifyPermission } from '../lib/notify'
import { useAgents } from '../stores/agentsStore'
import { useCards } from '../stores/cardsStore'
import { useStatus, type DisplayStatus } from '../stores/statusStore'
import './sidebar.css'

const STATUS_DOT: Record<DisplayStatus, string> = {
  running: 'dot-run',
  'needs-input': 'dot-actn',
  completed: 'dot-done',
  idle: 'dot-idle',
  exited: 'dot-los',
}
const PRIORITY: Record<DisplayStatus, number> = { 'needs-input': 0, running: 1, completed: 2, idle: 3, exited: 4 }

const shortenHome = (p: string): string => p.replace(/^\/Users\/[^/]+/, '~')

const useFocus = () => {
  const cards = useCards(s => s.cards)
  const setMinimized = useCards(s => s.setMinimized)
  const setMaximized = useCards(s => s.setMaximized)
  const { setCenter, getNode } = useReactFlow()
  return (id: string, halfW = 320, halfH = 210) => {
    if (cards[id]?.minimized) setMinimized(id, false)
    setMaximized(null)
    requestAnimationFrame(() => {
      const node = getNode(id)
      if (!node) return
      setCenter(node.position.x + (node.measured?.width ?? halfW * 2) / 2, node.position.y + (node.measured?.height ?? halfH * 2) / 2, { zoom: 1, duration: 450 })
    })
  }
}

const StationRow = ({ meta, onFocus }: { meta: AgentMeta; onFocus: () => void }) => {
  const entry = useStatus(s => s.byAgent[meta.agent])
  const status = useStatus(s => s.display(meta.agent))
  const action = entry?.action ?? ''
  const ctx = entry?.ctx ?? null
  const sub = action || shortenHome(meta.repoDir)

  return (
    <button type="button" className={`station-row status-${status}`} onClick={onFocus} title={`go to ${meta.agent}`}>
      <span className={`station-dot ${STATUS_DOT[status]}`} />
      <span className="station-name">{meta.agent.toUpperCase()}</span>
      <span className="station-sub">{sub}</span>
      {ctx !== null && (
        <span className="station-ctx" title={`context ${ctx}% full`}>
          <span className={`station-ctx-fill ${ctx >= 80 ? 'hot' : ''}`} style={{ width: `${ctx}%` }} />
        </span>
      )}
    </button>
  )
}

export const Sidebar = () => {
  const agents = useAgents(s => s.agents)
  const byAgent = useStatus(s => s.byAgent)
  const display = useStatus(s => s.display)
  const focus = useFocus()
  const [collapsed, setCollapsed] = useState(false)

  useEffect(ensureNotifyPermission, [])

  const ordered = useMemo(
    () => [...agents].sort((a, b) => PRIORITY[display(a.agent)] - PRIORITY[display(b.agent)]),
    [agents, byAgent], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const needsYou = agents.filter(a => display(a.agent) === 'needs-input').length

  if (collapsed) {
    return (
      <button type="button" className={`sidebar-handle ${needsYou ? 'alert' : ''}`} onClick={() => setCollapsed(false)} title="show stations">
        {needsYou ? `▸ ${needsYou}` : '▸'}
      </button>
    )
  }

  return (
    <aside className="sidebar">
      <header className="sidebar-head">
        <span>STATIONS · {String(agents.length).padStart(2, '0')}</span>
        {needsYou > 0 && <span className="sidebar-needs">⚠ {needsYou} NEED YOU</span>}
        <button type="button" className="sidebar-collapse" onClick={() => setCollapsed(true)} title="hide">
          ◂
        </button>
      </header>
      <div className="sidebar-list">
        {ordered.map(a => (
          <StationRow key={a.agent} meta={a} onFocus={() => focus(a.agent)} />
        ))}
        {agents.length === 0 && <div className="sidebar-empty">no stations — press N</div>}
        <button type="button" className="station-row vault-row" onClick={() => focus(VAULT_ID, 105, 90)} title="go to DATA CORE">
          <span className="station-dot dot-vault" />
          <span className="station-name">DATA CORE</span>
          <span className="station-sub">AgentVault</span>
        </button>
      </div>
    </aside>
  )
}
