import { useEffect, useMemo, useRef, useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import { sessionNameFor, VAULT_ID } from '@mc/shared'
import { apiUrl } from '../lib/api'
import { useAgents } from '../stores/agentsStore'
import { useCards } from '../stores/cardsStore'
import { useStatus } from '../stores/statusStore'
import './command-palette.css'

type Cmd = { id: string; label: string; hint: string; run: () => void }

export const CommandPalette = ({ onNew, onClose }: { onNew: () => void; onClose: () => void }) => {
  const agents = useAgents(s => s.agents)
  const killAgent = useAgents(s => s.killAgent)
  const display = useStatus(s => s.display)
  const setMinimized = useCards(s => s.setMinimized)
  const setMaximized = useCards(s => s.setMaximized)
  const { setCenter, getNode } = useReactFlow()
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => inputRef.current?.focus(), [])

  const focus = (id: string) => {
    if (useCards.getState().cards[id]?.minimized) setMinimized(id, false)
    setMaximized(null)
    requestAnimationFrame(() => {
      const node = getNode(id)
      if (node) setCenter(node.position.x + (node.measured?.width ?? 640) / 2, node.position.y + (node.measured?.height ?? 420) / 2, { zoom: 1, duration: 400 })
    })
  }

  const commands = useMemo<Cmd[]>(() => {
    const list: Cmd[] = [
      { id: 'new', label: 'New station', hint: 'spawn an agent', run: () => { onClose(); onNew() } },
      { id: 'vault', label: 'Go to DATA CORE', hint: 'AgentVault', run: () => { onClose(); focus(VAULT_ID) } },
    ]
    for (const a of agents) {
      const st = display(a.agent)
      list.push({ id: `go-${a.agent}`, label: `Go to ${a.agent.toUpperCase()}`, hint: st, run: () => { onClose(); focus(a.agent) } })
      list.push({ id: `max-${a.agent}`, label: `Maximize ${a.agent.toUpperCase()}`, hint: 'fullscreen', run: () => { onClose(); setMaximized(a.agent) } })
      list.push({ id: `kill-${a.agent}`, label: `Kill ${a.agent.toUpperCase()}`, hint: 'end session', run: () => { onClose(); void killAgent(a.agent) } })
    }
    return list
  }, [agents]) // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return commands
    return commands.filter(c => `${c.label} ${c.hint}`.toLowerCase().includes(needle))
  }, [q, commands])

  useEffect(() => setSel(0), [q])

  // typing "<agent> <message>" and pressing Enter sends the message to that agent
  const trySend = (): boolean => {
    const m = /^(\S+)\s+(.+)$/.exec(q.trim())
    if (!m) return false
    const target = agents.find(a => a.agent.toLowerCase() === m[1]?.toLowerCase())
    if (!target || !m[2]) return false
    void fetch(apiUrl(`/api/agents/${encodeURIComponent(target.agent)}/send`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: m[2] }),
    }).catch(() => undefined)
    onClose()
    return true
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') return onClose()
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, filtered.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)) }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (trySend()) return
      filtered[sel]?.run()
    }
  }

  return (
    <div className="cmdk-scrim" onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <div className="cmdk">
        <input
          ref={inputRef}
          className="cmdk-input"
          placeholder="Jump to an agent, or type  &lt;agent&gt; &lt;message&gt;  to send…"
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={onKey}
          spellCheck={false}
        />
        <div className="cmdk-list">
          {filtered.map((c, i) => (
            <button
              key={c.id}
              type="button"
              className={`cmdk-row ${i === sel ? 'sel' : ''}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => c.run()}
            >
              <span className="cmdk-label">{c.label}</span>
              <span className="cmdk-hint">{c.hint}</span>
            </button>
          ))}
          {filtered.length === 0 && <div className="cmdk-empty">no matches</div>}
        </div>
      </div>
    </div>
  )
}
