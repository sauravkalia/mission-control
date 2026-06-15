import { useEffect, useState } from 'react'
import { useServices } from '../stores/servicesStore'

// Per-agent quick actions: run the project's dev server (with an editable command
// for monorepos), and open/close the agent's Playwright browser on the app.
export const CardToolbar = ({ agent }: { agent: string }) => {
  const svc = useServices(s => s.byAgent[agent]) ?? { running: false, url: null, busy: false }
  const command = useServices(s => s.commands[agent] ?? '')
  const pwOpen = useServices(s => s.pwOpen[agent] ?? false)
  const setCommand = useServices(s => s.setCommand)
  const ensureDefaultCommand = useServices(s => s.ensureDefaultCommand)
  const runServer = useServices(s => s.runServer)
  const stopServer = useServices(s => s.stopServer)
  const openPlaywright = useServices(s => s.openPlaywright)
  const closePlaywright = useServices(s => s.closePlaywright)

  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  useEffect(() => {
    void ensureDefaultCommand(agent)
  }, [agent, ensureDefaultCommand])

  const onRun = async () => {
    setError(undefined)
    if (svc.running) return void stopServer(agent)
    const err = await runServer(agent)
    if (err) setError(err)
  }

  const onPlaywright = async () => {
    setError(undefined)
    if (pwOpen) return void closePlaywright(agent)
    const err = await openPlaywright(agent)
    if (err) setError(err)
  }

  return (
    <div className="card-toolbar nodrag">
      <button
        type="button"
        className={`tb-btn ${svc.running ? 'on' : ''}`}
        onClick={() => void onRun()}
        disabled={svc.busy}
        title={svc.running ? 'stop the dev server' : 'run the command below'}
      >
        {svc.busy ? '… starting' : svc.running ? '■ stop app' : '▶ run app'}
      </button>

      {!svc.running && (
        <button
          type="button"
          className="tb-gear"
          onClick={() => setEditing(e => !e)}
          title="edit the run command (for monorepos, point it at the right package)"
        >
          ⚙
        </button>
      )}

      {!svc.running && editing && (
        <input
          className="tb-cmd"
          value={command}
          spellCheck={false}
          placeholder="pnpm --filter web dev"
          onChange={e => setCommand(agent, e.target.value)}
          onKeyDown={e => e.key === 'Enter' && (setEditing(false), void onRun())}
        />
      )}

      {svc.running && svc.url && (
        <button type="button" className="tb-url" onClick={() => window.open(svc.url!, '_blank')} title="open in browser">
          🔗 {svc.url.replace(/^https?:\/\//, '')}
        </button>
      )}
      {svc.running && !svc.url && <span className="tb-detecting">detecting URL…</span>}

      <button
        type="button"
        className={`tb-btn ${pwOpen ? 'on' : ''}`}
        onClick={() => void onPlaywright()}
        title={pwOpen ? 'tell the agent to close the browser' : 'open the app in a browser via Playwright, then wait'}
      >
        {pwOpen ? '■ stop playwright' : '🎭 playwright'}
      </button>

      {error && <span className="tb-error">{error}</span>}
    </div>
  )
}
