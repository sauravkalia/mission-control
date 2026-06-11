import { useState } from 'react'
import { useAgents } from '../stores/agentsStore'

export const SpawnDialog = ({ onClose }: { onClose: () => void }) => {
  const spawnAgent = useAgents(s => s.spawnAgent)
  const [name, setName] = useState('')
  const [repo, setRepo] = useState('~/Documents/GitHub/')
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  const spawn = async () => {
    setBusy(true)
    setError(undefined)
    const failure = await spawnAgent(name.trim().toLowerCase(), repo.trim())
    setBusy(false)
    if (failure) {
      setError(failure)
      return
    }
    onClose()
  }

  return (
    <div className="dialog-scrim" onPointerDown={e => !busy && e.target === e.currentTarget && onClose()}>
      <section className="spawn-dialog">
        <header>OPEN NEW STATION</header>
        <label>
          CALLSIGN
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="sphere-web"
            autoFocus
            spellCheck={false}
          />
        </label>
        <label>
          REPO PATH
          <input
            value={repo}
            onChange={e => setRepo(e.target.value)}
            placeholder="~/Documents/GitHub/sphere-web"
            spellCheck={false}
            onKeyDown={e => e.key === 'Enter' && !busy && void spawn()}
          />
        </label>
        {error && <p className="dialog-error">{error}</p>}
        <footer>
          <button type="button" className="strip-btn" onClick={onClose} disabled={busy}>
            CANCEL
          </button>
          <button type="button" className="strip-btn primary" onClick={() => void spawn()} disabled={busy}>
            {busy ? 'SPAWNING…' : 'SPAWN'}
          </button>
        </footer>
      </section>
    </div>
  )
}
