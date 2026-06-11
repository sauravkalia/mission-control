import { useEffect, useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { Canvas } from './canvas/Canvas'
import { Dock } from './app/Dock'
import { MaximizedView } from './app/MaximizedView'
import { SpawnDialog } from './app/SpawnDialog'
import { TelemetryStrip } from './app/TelemetryStrip'
import { useAgents } from './stores/agentsStore'
import { useEvents } from './stores/eventsStore'
import { useLinks } from './stores/linksStore'
import './app/app.css'

const AGENTS_POLL_MS = 5000

export const App = () => {
  const agents = useAgents(s => s.agents)
  const loaded = useAgents(s => s.loaded)
  const fetchAgents = useAgents(s => s.fetchAgents)
  const fetchLinks = useLinks(s => s.fetchLinks)
  const connectEvents = useEvents(s => s.connect)
  const [spawnOpen, setSpawnOpen] = useState(false)

  useEffect(() => {
    void fetchAgents()
    void fetchLinks()
    const t = window.setInterval(() => void fetchAgents(), AGENTS_POLL_MS)
    return () => window.clearInterval(t)
  }, [fetchAgents, fetchLinks])

  useEffect(() => connectEvents(), [connectEvents])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'n' && e.target === document.body) setSpawnOpen(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <main className="canvas-shell">
      <TelemetryStrip onNew={() => setSpawnOpen(true)} />
      <ReactFlowProvider>
        <Canvas />
      </ReactFlowProvider>
      {loaded && agents.length === 0 && (
        <div className="empty-state">
          <p>
            NO STATIONS ON CONSOLE — <strong>N</strong> TO OPEN ONE
          </p>
          <p className="empty-hint">drag a port on one card's edge onto another to wire them</p>
        </div>
      )}
      <MaximizedView />
      <Dock />
      {spawnOpen && <SpawnDialog onClose={() => setSpawnOpen(false)} />}
    </main>
  )
}
