import { useState } from 'react'
import { useServices } from '../stores/servicesStore'

// Per-agent quick actions: run the project's dev server, and point the agent's
// Playwright MCP at the running app — so you don't retype the setup each time.
export const CardToolbar = ({ agent }: { agent: string }) => {
  const svc = useServices(s => s.byAgent[agent]) ?? { running: false, url: null, busy: false }
  const runServer = useServices(s => s.runServer)
  const stopServer = useServices(s => s.stopServer)
  const runPlaywright = useServices(s => s.runPlaywright)
  const [error, setError] = useState<string | undefined>(undefined)
  const [pwSent, setPwSent] = useState(false)

  const onRun = async () => {
    setError(undefined)
    const err = svc.running ? (await stopServer(agent), undefined) : await runServer(agent)
    if (err) setError(err)
  }

  const onPlaywright = async () => {
    setError(undefined)
    const err = await runPlaywright(agent)
    if (err) setError(err)
    else {
      setPwSent(true)
      window.setTimeout(() => setPwSent(false), 1500)
    }
  }

  return (
    <div className="card-toolbar nodrag">
      <button
        type="button"
        className={`tb-btn ${svc.running ? 'on' : ''}`}
        onClick={() => void onRun()}
        disabled={svc.busy}
        title={svc.running ? 'stop the dev server' : "start the project's dev server"}
      >
        {svc.busy ? '… starting' : svc.running ? '■ stop app' : '▶ run app'}
      </button>

      {svc.running && svc.url && (
        <button type="button" className="tb-url" onClick={() => window.open(svc.url!, '_blank')} title="open in browser">
          🔗 {svc.url.replace(/^https?:\/\//, '')}
        </button>
      )}
      {svc.running && !svc.url && <span className="tb-detecting">detecting URL…</span>}

      <button type="button" className="tb-btn" onClick={() => void onPlaywright()} title="have this agent open the app in a browser via Playwright">
        {pwSent ? '✓ sent' : '🎭 playwright'}
      </button>

      {error && <span className="tb-error">{error}</span>}
    </div>
  )
}
