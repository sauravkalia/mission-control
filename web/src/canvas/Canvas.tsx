import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { VAULT_ID } from '@mc/shared'
import { useAgents } from '../stores/agentsStore'
import { useCards } from '../stores/cardsStore'
import { useEvents } from '../stores/eventsStore'
import { useLinks } from '../stores/linksStore'
import { ConsoleNode } from './ConsoleNode'
import { PulseEdge } from './PulseEdge'
import { VaultNode } from './VaultNode'
import './canvas.css'

const nodeTypes = { console: ConsoleNode, vault: VaultNode }
const edgeTypes = { pulse: PulseEdge }
const pairKey = (a: string, b: string): string => [a, b].sort().join(' ')

type EdgeFx = { heat: number; pulseNonce: number; from: string }

export const Canvas = () => {
  const agents = useAgents(s => s.agents)
  const cards = useCards(s => s.cards)
  const maximized = useCards(s => s.maximized)
  const ensureCard = useCards(s => s.ensureCard)
  const reconcile = useCards(s => s.reconcile)
  const move = useCards(s => s.move)
  const setSize = useCards(s => s.setSize)
  const links = useLinks(s => s.links)
  const createLink = useLinks(s => s.createLink)
  const dropLink = useLinks(s => s.dropLink)
  const lastPull = useEvents(s => s.lastPull)
  const lastIngest = useEvents(s => s.lastIngest)

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges] = useEdgesState<Edge>([])
  const [fx, setFx] = useState<Record<string, EdgeFx>>({})
  const pulseSeq = useRef(0)

  // keep a card record + node for every live, non-minimized agent (+ the vault)
  useEffect(() => {
    ensureCard(VAULT_ID)
    if (!useAgents.getState().loaded) return
    reconcile(agents.map(a => a.agent))
    for (const a of agents) ensureCard(a.agent)
  }, [agents, ensureCard, reconcile])

  useEffect(() => {
    setNodes(prev => {
      const byId = new Map(prev.map(n => [n.id, n]))
      const agentNodes = agents
        .filter(a => !cards[a.agent]?.minimized && a.agent !== maximized)
        .map(a => {
          const geom = cards[a.agent]
          const existing = byId.get(a.agent)
          if (existing) return { ...existing, data: { meta: a } }
          return {
            id: a.agent,
            type: 'console',
            position: { x: geom?.x ?? 80, y: geom?.y ?? 80 },
            style: { width: geom?.w ?? 640, height: geom?.h ?? 420 },
            dragHandle: '.card-titlebar',
            data: { meta: a },
          } satisfies Node
        })
      // the AgentVault data core — always present
      const vg = cards[VAULT_ID]
      const vaultExisting = byId.get(VAULT_ID)
      const vaultNode: Node = vaultExisting ?? {
        id: VAULT_ID,
        type: 'vault',
        position: { x: vg?.x ?? 80, y: vg?.y ?? 80 },
        data: {},
      }
      return [vaultNode, ...agentNodes]
    })
  }, [agents, cards, maximized, setNodes])

  // edges from links, decorated with live heat + pulse
  useEffect(() => {
    setEdges(
      links.map(l => {
        const id = pairKey(l.a, l.b)
        const f = fx[id]
        return {
          id,
          source: l.a,
          target: l.b,
          type: 'pulse',
          data: {
            heat: f?.heat ?? 0,
            pulseNonce: f?.pulseNonce ?? 0,
            reverse: f ? f.from !== l.a : false,
            vault: l.a === VAULT_ID || l.b === VAULT_ID,
          },
        } satisfies Edge
      }),
    )
  }, [links, fx, setEdges])

  // a pull (or recall, from the vault) → bump the matching edge + pulse packet
  useEffect(() => {
    if (!lastPull) return
    const id = pairKey(lastPull.from, lastPull.to)
    const nonce = (pulseSeq.current += 1)
    setFx(prev => ({
      ...prev,
      [id]: { heat: Math.min(0.6, (prev[id]?.heat ?? 0) + 0.25), pulseNonce: nonce, from: lastPull.from },
    }))
  }, [lastPull?.at]) // eslint-disable-line react-hooks/exhaustive-deps

  // a real ingest (the vault index grew) → flow every wired agent INTO the core
  useEffect(() => {
    if (!lastIngest) return
    setFx(prev => {
      const next = { ...prev }
      for (const l of links) {
        const agent = l.a === VAULT_ID ? l.b : l.b === VAULT_ID ? l.a : null
        if (!agent) continue
        const id = pairKey(l.a, l.b)
        next[id] = { heat: Math.min(0.6, (next[id]?.heat ?? 0) + 0.2), pulseNonce: (pulseSeq.current += 1), from: agent }
      }
      return next
    })
  }, [lastIngest?.at]) // eslint-disable-line react-hooks/exhaustive-deps

  // heat decay
  useEffect(() => {
    const t = window.setInterval(() => {
      setFx(prev => {
        let changed = false
        const next: Record<string, EdgeFx> = {}
        for (const [k, v] of Object.entries(prev)) {
          const h = v.heat - 0.02
          next[k] = { ...v, heat: Math.max(0, h) }
          if (h !== v.heat) changed = true
        }
        return changed ? next : prev
      })
    }, 1000)
    return () => window.clearInterval(t)
  }, [])

  const onConnect = useCallback(
    (c: Connection) => {
      if (c.source && c.target && c.source !== c.target) void createLink(c.source, c.target)
    },
    [createLink],
  )

  const handleNodesChange = useCallback(
    (changes: NodeChange<Node>[]) => {
      onNodesChange(changes)
      for (const ch of changes) {
        if (ch.type === 'position' && ch.position && ch.dragging === false) move(ch.id, ch.position.x, ch.position.y)
        if (ch.type === 'dimensions' && ch.dimensions && ch.resizing === false) {
          setSize(ch.id, ch.dimensions.width, ch.dimensions.height)
        }
      }
    },
    [onNodesChange, move, setSize],
  )

  const onEdgeClick = useCallback(
    (_e: React.MouseEvent, edge: Edge) => void dropLink(edge.source, edge.target),
    [dropLink],
  )

  const defaultEdgeOptions = useMemo(() => ({ type: 'pulse' }), [])

  return (
    <div className="mc-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onConnect={onConnect}
        onEdgeClick={onEdgeClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        connectionMode={ConnectionMode.Loose}
        minZoom={0.15}
        maxZoom={2}
        fitView
        proOptions={{ hideAttribution: true }}
        deleteKeyCode={null}
      >
        <Background variant={BackgroundVariant.Dots} gap={28} size={1} color="rgba(81,240,138,0.12)" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}
