import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react'

export type PulseEdgeData = {
  heat: number
  pulseNonce: number
  reverse: boolean
}

// A standing link wire. On each memory pull a glowing packet travels along it
// (from puller → pulled), and the wire warms with accumulated heat.
export const PulseEdge = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps) => {
  const [path] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })
  const d = (data ?? {}) as PulseEdgeData
  const heat = d.heat ?? 0

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{ stroke: 'var(--phos-green)', strokeWidth: 1.5, strokeDasharray: '4 4', opacity: 0.3 + heat }}
      />
      {d.pulseNonce > 0 && (
        <circle key={d.pulseNonce} r={4} className="mc-pulse">
          <animateMotion
            dur="0.9s"
            path={path}
            fill="freeze"
            keyPoints={d.reverse ? '1;0' : '0;1'}
            keyTimes="0;1"
            calcMode="linear"
          />
        </circle>
      )}
    </>
  )
}
