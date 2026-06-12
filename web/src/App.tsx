import { useEffect, useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { Canvas } from './canvas/Canvas'
import { CommandPalette } from './app/CommandPalette'
import { Dock } from './app/Dock'
import { MaximizedView } from './app/MaximizedView'
import { Sidebar } from './app/Sidebar'
import { SpawnDialog } from './app/SpawnDialog'
import { TelemetryStrip } from './app/TelemetryStrip'
import { useAgents } from './stores/agentsStore'
import { useEvents } from './stores/eventsStore'
import { useLinks } from './stores/linksStore'
import { useVault } from './stores/vaultStore'
import './app/app.css'

const AGENTS_POLL_MS = 5000

export const App = () => {
  const agents = useAgents(s => s.agents)
  const loaded = useAgents(s => s.loaded)
  const fetchAgents = useAgents(s => s.fetchAgents)
  const fetchLinks = useLinks(s => s.fetchLinks)
  const fetchVault = useVault(s => s.fetchVault)
  const connectEvents = useEvents(s => s.connect)
  const [spawnOpen, setSpawnOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)

  useEffect(() => {
    void fetchAgents()
    void fetchLinks()
    void fetchVault()
    const t = window.setInterval(() => void fetchAgents(), AGENTS_POLL_MS)
    return () => window.clearInterval(t)
  }, [fetchAgents, fetchLinks, fetchVault])

  useEffect(() => connectEvents(), [connectEvents])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen(o => !o)
        return
      }
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
        <Sidebar />
        {paletteOpen && (
          <CommandPalette onNew={() => setSpawnOpen(true)} onClose={() => setPaletteOpen(false)} />
        )}
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
