import { useAgents } from '../stores/agentsStore'

// M1: static placeholder reserving the centerpiece rect (keep-out for
// auto-placement). Stations arrive with M2's status engine.
export const PlotPanel = () => {
  const stations = useAgents(s => s.agents.length)

  return (
    <section className="plot-panel">
      <header className="plot-header">THE PLOT — {String(stations).padStart(2, '0')} STN</header>
      <div className="plot-body">
        <div className="plot-base">
          <span className="plot-reticle">⊕</span>
          <span className="plot-base-label">BASE</span>
        </div>
        <p className="plot-hint">STATIONS COME ALIVE — M2</p>
      </div>
    </section>
  )
}
