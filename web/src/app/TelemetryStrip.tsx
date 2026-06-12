import { useEffect, useState } from 'react'
import { useAgents } from '../stores/agentsStore'
import { useEvents } from '../stores/eventsStore'
import { useStatus } from '../stores/statusStore'
import { EnvInfo } from './EnvInfo'

const gmtNow = (): string => `${new Date().toISOString().slice(11, 19)}Z`

export const TelemetryStrip = ({ onNew }: { onNew: () => void }) => {
  const agents = useAgents(s => s.agents)
  const linkOk = useEvents(s => s.baseLive)
  const display = useStatus(s => s.display)
  useStatus(s => s.byAgent) // re-render on status change
  const [gmt, setGmt] = useState(gmtNow)

  useEffect(() => {
    const t = window.setInterval(() => setGmt(gmtNow()), 250)
    return () => window.clearInterval(t)
  }, [])

  const running = agents.filter(a => display(a.agent) === 'running').length
  const needsYou = agents.filter(a => display(a.agent) === 'needs-input').length

  return (
    <header className="telemetry-strip">
      <span className="strip-title">MOCR · MISSION OPERATIONS CONTROL</span>
      <span className="strip-clock">GMT {gmt}</span>
      <span className="strip-item">STATIONS {String(agents.length).padStart(2, '0')}</span>
      {running > 0 && <span className="strip-item strip-running">▶ {running} RUN</span>}
      {needsYou > 0 && <span className="strip-item strip-needs">⚠ {needsYou} NEED YOU</span>}
      <span className={`strip-item ${linkOk ? 'link-go' : 'link-los'}`}>
        LINK {linkOk ? '●GO' : '●LOS'}
      </span>
      <EnvInfo />
      <span className="strip-spacer" />
      <button type="button" className="strip-btn" onClick={onNew}>
        N NEW STATION
      </button>
    </header>
  )
}
