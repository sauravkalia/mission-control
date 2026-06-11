import { useEffect, useRef, useState } from 'react'
import { apiUrl } from '../lib/api'

type McpInfo = { name: string; type: string; detail: string }
type SkillInfo = { name: string; description: string }
type Environment = { mcp: McpInfo[]; skills: SkillInfo[] }

type Panel = 'mcp' | 'skills' | null

export const EnvInfo = () => {
  const [env, setEnv] = useState<Environment>({ mcp: [], skills: [] })
  const [open, setOpen] = useState<Panel>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void fetch(apiUrl('/api/environment'))
      .then(r => (r.ok ? (r.json() as Promise<Environment>) : null))
      .then(e => e && setEnv(e))
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [])

  const toggle = (p: Panel) => setOpen(cur => (cur === p ? null : p))

  return (
    <div className="env-info" ref={ref}>
      <button type="button" className={`env-chip ${open === 'mcp' ? 'active' : ''}`} onClick={() => toggle('mcp')}>
        ⚙ {env.mcp.length} MCP
      </button>
      <button type="button" className={`env-chip ${open === 'skills' ? 'active' : ''}`} onClick={() => toggle('skills')}>
        ✦ {env.skills.length} SKILLS
      </button>

      {open === 'mcp' && (
        <div className="env-panel">
          <div className="env-panel-head">MCP SERVERS · USER SCOPE</div>
          {env.mcp.map(m => (
            <div key={m.name} className="env-row">
              <span className="env-name">{m.name}</span>
              <span className="env-tag">{m.type}</span>
            </div>
          ))}
          {env.mcp.length === 0 && <div className="env-empty">none</div>}
        </div>
      )}

      {open === 'skills' && (
        <div className="env-panel wide">
          <div className="env-panel-head">SKILLS · {env.skills.length}</div>
          <div className="env-scroll">
            {env.skills.map(s => (
              <div key={s.name} className="env-row col" title={s.description}>
                <span className="env-name">{s.name}</span>
                {s.description && <span className="env-desc">{s.description}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
