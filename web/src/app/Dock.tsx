import { useAgents } from '../stores/agentsStore'
import { useCards } from '../stores/cardsStore'

export const Dock = () => {
  const agents = useAgents(s => s.agents)
  const cards = useCards(s => s.cards)
  const setMinimized = useCards(s => s.setMinimized)
  const raise = useCards(s => s.raise)

  const minimized = agents.filter(a => cards[a.agent]?.minimized)
  if (minimized.length === 0) return null

  return (
    <footer className="dock">
      <span className="dock-label">DOCK ▸</span>
      {minimized.map(a => (
        <button
          key={a.agent}
          type="button"
          className="dock-tile"
          onClick={() => {
            setMinimized(a.agent, false)
            raise(a.agent)
          }}
        >
          <span className={`dock-dot ${a.dead ? 'st-los' : 'st-go'}`}>●</span>
          {a.agent.toUpperCase()}
        </button>
      ))}
    </footer>
  )
}
