import { useEffect, useState } from 'react'
import { Dock } from './app/Dock'
import { SpawnDialog } from './app/SpawnDialog'
import { TelemetryStrip } from './app/TelemetryStrip'
import { AgentCard } from './cards/AgentCard'
import { ThePlot } from './plot/ThePlot'
import { useAgents } from './stores/agentsStore'
import { useCards } from './stores/cardsStore'
import { useEvents } from './stores/eventsStore'
import { useLinks } from './stores/linksStore'
import './app/app.css'

const AGENTS_POLL_MS = 5000

export const App = () => {
  const agents = useAgents(s => s.agents)
  const loaded = useAgents(s => s.loaded)
  const fetchAgents = useAgents(s => s.fetchAgents)
  const ensureCard = useCards(s => s.ensureCard)
  const reconcile = useCards(s => s.reconcile)
  const clampToViewport = useCards(s => s.clampToViewport)
  const fetchLinks = useLinks(s => s.fetchLinks)
  const connectEvents = useEvents(s => s.connect)
  const [spawnOpen, setSpawnOpen] = useState(false)

  useEffect(() => {
    clampToViewport(window.innerWidth, window.innerHeight)
  }, [clampToViewport])

  useEffect(() => {
    void fetchAgents()
    void fetchLinks()
    const t = window.setInterval(() => void fetchAgents(), AGENTS_POLL_MS)
    return () => window.clearInterval(t)
  }, [fetchAgents, fetchLinks])

  useEffect(() => connectEvents(), [connectEvents])

  useEffect(() => {
    if (!loaded) return // never reconcile against an unfetched (empty) list
    reconcile(agents.map(a => a.agent))
    for (const a of agents) ensureCard(a.agent)
  }, [agents, loaded, reconcile, ensureCard])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'n' && e.target === document.body) setSpawnOpen(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <main className="canvas">
      <TelemetryStrip onNew={() => setSpawnOpen(true)} />
      <ThePlot />
      {agents.map(a => (
        <AgentCard key={a.agent} meta={a} />
      ))}
      {loaded && agents.length === 0 && (
        <div className="empty-state">
          <span className="plot-reticle">⊕</span>
          <p>
            NO STATIONS ON CONSOLE — <strong>N</strong> TO OPEN ONE
          </p>
          <p className="empty-hint">sessions are tmux: attach anytime with `tmux attach -t mc-&lt;callsign&gt;`</p>
        </div>
      )}
      <Dock />
      {spawnOpen && <SpawnDialog onClose={() => setSpawnOpen(false)} />}
    </main>
  )
}
