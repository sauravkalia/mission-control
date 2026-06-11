import { useEffect } from 'react'
import { sessionNameFor } from '@mc/shared'
import { useAgents } from '../stores/agentsStore'
import { useCards } from '../stores/cardsStore'
import { ConsoleCard } from '../cards/ConsoleCard'

const shortenHome = (p: string): string => p.replace(/^\/Users\/[^/]+/, '~')

// A maximized agent fills the viewport below the strip. It is filtered out of
// the canvas while maximized, so only this one xterm exists for the session.
export const MaximizedView = () => {
  const maximized = useCards(s => s.maximized)
  const setMaximized = useCards(s => s.setMaximized)
  const killAgent = useAgents(s => s.killAgent)
  const meta = useAgents(s => s.agents.find(a => a.agent === maximized))

  useEffect(() => {
    if (!maximized) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMaximized(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [maximized, setMaximized])

  if (!maximized || !meta) return null

  return (
    <div className="maximized-view">
      <ConsoleCard
        callsign={meta.agent.toUpperCase()}
        session={sessionNameFor(meta.agent)}
        repoLabel={shortenHome(meta.repoDir)}
        dead={meta.dead}
        onMinimize={() => setMaximized(null)}
        onKill={() => {
          setMaximized(null)
          void killAgent(meta.agent)
        }}
        maximized
        onToggleMaximize={() => setMaximized(null)}
      />
    </div>
  )
}
