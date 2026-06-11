import { memo } from 'react'
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react'
import { sessionNameFor, type AgentMeta } from '@mc/shared'
import { useAgents } from '../stores/agentsStore'
import { useCards } from '../stores/cardsStore'
import { ConsoleCard } from '../cards/ConsoleCard'

export type ConsoleNodeData = { meta: AgentMeta }

const SIDES = [
  { id: 't', pos: Position.Top },
  { id: 'r', pos: Position.Right },
  { id: 'b', pos: Position.Bottom },
  { id: 'l', pos: Position.Left },
]

const shortenHome = (p: string): string => p.replace(/^\/Users\/[^/]+/, '~')

export const ConsoleNode = memo(({ id, data, selected }: NodeProps) => {
  const meta = (data as ConsoleNodeData).meta
  const killAgent = useAgents(s => s.killAgent)
  const setMinimized = useCards(s => s.setMinimized)
  const setMaximized = useCards(s => s.setMaximized)

  return (
    <div className="console-node">
      <NodeResizer minWidth={320} minHeight={220} isVisible={selected} color="var(--phos-green-dim)" />
      {/* a connection port on every side — drag from any port to another card */}
      {SIDES.map(s => (
        <Handle key={s.id} id={s.id} type="source" position={s.pos} className="mc-port" />
      ))}
      <ConsoleCard
        callsign={meta.agent.toUpperCase()}
        session={sessionNameFor(meta.agent)}
        repoLabel={shortenHome(meta.repoDir)}
        dead={meta.dead}
        onMinimize={() => setMinimized(id, true)}
        onKill={() => void killAgent(id)}
        onToggleMaximize={() => setMaximized(id)}
      />
    </div>
  )
})

ConsoleNode.displayName = 'ConsoleNode'
