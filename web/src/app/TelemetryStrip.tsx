import { useEffect, useState } from 'react'
import { useAgents } from '../stores/agentsStore'

const gmtNow = (): string => `${new Date().toISOString().slice(11, 19)}Z`

export const TelemetryStrip = ({ onNew }: { onNew: () => void }) => {
  const stations = useAgents(s => s.agents.length)
  const linkOk = useAgents(s => s.linkOk)
  const [gmt, setGmt] = useState(gmtNow)

  useEffect(() => {
    const t = window.setInterval(() => setGmt(gmtNow()), 250)
    return () => window.clearInterval(t)
  }, [])

  return (
    <header className="telemetry-strip">
      <span className="strip-title">MOCR · MISSION OPERATIONS CONTROL</span>
      <span className="strip-clock">GMT {gmt}</span>
      <span className="strip-item">STATIONS {String(stations).padStart(2, '0')}</span>
      <span className={`strip-item ${linkOk ? 'link-go' : 'link-los'}`}>
        LINK {linkOk ? '●GO' : '●LOS'}
      </span>
      <span className="strip-spacer" />
      <button type="button" className="strip-btn" onClick={onNew}>
        N NEW STATION
      </button>
    </header>
  )
}
