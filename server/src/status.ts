import type { AgentStatus } from '@mc/shared'
import { emit } from './events'
import { capturePaneTail, listMcSessions } from './tmux'

// Per-agent status from the rendered pane. Calibrated against Claude 2.1.x:
//   running     → spinner line "<glyph> Gerund…"      (present tense, ellipsis)
//   done/idle   → "<glyph> Gerund for 12s" then "❯ "  (past tense "for Ns")
//   needs-input → a permission / trust dialog
//   exited      → the tmux pane is dead

const POLL_MS = 2000

const NEEDS_INPUT_RE = /Do you want|I trust this folder|❯ 1\.|Allow this|Proceed\?|\(y\/n\)/i
// a Claude status line: glyph + Capitalized gerund + ("…" running | "for Ns" done)
const STATUS_LINE_RE = /(?:^|\n)\s*\S{1,2}\s+[A-Z][a-z]+(…|\s+for\s+\d+s)/g

const classify = (tail: string): AgentStatus => {
  if (NEEDS_INPUT_RE.test(tail)) return 'needs-input'
  let match: RegExpExecArray | null
  let last: string | null = null
  STATUS_LINE_RE.lastIndex = 0
  while ((match = STATUS_LINE_RE.exec(tail)) !== null) last = match[0]
  if (last?.includes('…')) return 'running'
  if (/esc to interrupt/i.test(tail)) return 'running'
  return 'idle'
}

const statuses = new Map<string, AgentStatus>()

export const getStatus = (agent: string): AgentStatus => statuses.get(agent) ?? 'idle'

const tick = async (): Promise<void> => {
  const live = await listMcSessions()
  // drop agents whose session is gone
  for (const agent of statuses.keys()) {
    if (!live.has(`mc-${agent}`)) statuses.delete(agent)
  }
  for (const [session, state] of live) {
    if (!session.startsWith('mc-')) continue
    const agent = session.slice(3)
    const next: AgentStatus = state.dead ? 'exited' : classify(await capturePaneTail(session, 12))
    if (statuses.get(agent) !== next) {
      statuses.set(agent, next)
      emit({ type: 'status', agent, status: next })
    }
  }
}

export const startStatusPolling = (): NodeJS.Timeout => {
  void tick()
  return setInterval(() => void tick(), POLL_MS)
}
