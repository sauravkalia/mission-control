import { useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import { VAULT_ID } from '@mc/shared'
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

const shortenHome = (p: string): string => p.replace(/^\/Users\/[^/]+/, '~')

const StationRow = ({ agent, repo }: { agent: string; repo: string }) => {
  const status = useStatus(s => s.display(agent))
  const cards = useCards(s => s.cards)
  const setMinimized = useCards(s => s.setMinimized)
  const setMaximized = useCards(s => s.setMaximized)
  const { setCenter, getNode } = useReactFlow()

  const focus = () => {
    // restore from dock / maximize so the node exists on the canvas, then pan to it
    if (cards[agent]?.minimized) setMinimized(agent, false)
    setMaximized(null)
    // wait a frame for the node to mount/measure, then center on it
    requestAnimationFrame(() => {
      const node = getNode(agent)
      if (!node) return
      const w = node.measured?.width ?? 640
      const h = node.measured?.height ?? 420
      setCenter(node.position.x + w / 2, node.position.y + h / 2, { zoom: 1, duration: 450 })
    })
  }

  return (
    <button type="button" className="station-row" onClick={focus} title={`go to ${agent}`}>
      <span className={`station-dot ${STATUS_DOT[status]}`} />
      <span className="station-name">{agent.toUpperCase()}</span>
      <span className="station-repo">{shortenHome(repo)}</span>
    </button>
  )
}

export const Sidebar = () => {
  const agents = useAgents(s => s.agents)
  const { setCenter, getNode } = useReactFlow()
  const [collapsed, setCollapsed] = useState(false)

  const focusVault = () => {
    const node = getNode(VAULT_ID)
    if (node) setCenter(node.position.x + 105, node.position.y + 90, { zoom: 1, duration: 450 })
  }

  if (collapsed) {
    return (
      <button type="button" className="sidebar-handle" onClick={() => setCollapsed(false)} title="show stations">
        ▸
      </button>
    )
  }

  return (
    <aside className="sidebar">
      <header className="sidebar-head">
        <span>STATIONS · {String(agents.length).padStart(2, '0')}</span>
        <button type="button" className="sidebar-collapse" onClick={() => setCollapsed(true)} title="hide">
          ◂
        </button>
      </header>
      <div className="sidebar-list">
        {agents.map(a => (
          <StationRow key={a.agent} agent={a.agent} repo={a.repoDir} />
        ))}
        {agents.length === 0 && <div className="sidebar-empty">no stations — press N</div>}
        <button type="button" className="station-row vault-row" onClick={focusVault} title="go to DATA CORE">
          <span className="station-dot dot-vault" />
          <span className="station-name">DATA CORE</span>
          <span className="station-repo">AgentVault</span>
        </button>
      </div>
    </aside>
  )
}
