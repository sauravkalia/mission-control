import { globSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { agentSessionId } from './agents'
import { capturePaneScrollback } from './tmux'

// Reading another agent's recent work. Claude buffers a LIVE session's turns
// in memory and only flushes them to its transcript later, so the rendered
// tmux pane is the source of truth for what an agent is doing right now; the
// transcript (when flushed) supplies durable metadata: title, branch, files.

const TAIL_BYTES = 400_000
const PROJECTS = join(homedir(), '.claude', 'projects')
const MAX_TURNS = 14
const SNIPPET = 800

export type AgentContext = {
  agent: string
  title: string | null
  gitBranch: string | null
  filesTouched: string[]
  recent: { role: 'user' | 'assistant'; text: string }[]
}

// --- live conversation, parsed from the rendered pane ---

const USER_RE = /^[❯>]\s+(.*)$/
const ASSISTANT_RE = /^[⏺·•]\s+(.*)$/
const BARE_PROMPT_RE = /^[❯>]\s*$/
// whitespace or box-drawing only (full U+2500–U+257F block) — a separator line
const NOISE_RE = /^[\s─-╿]*$/u
// a dialog / input-box body line (starts with a vertical bar) — drop, don't append
const BOX_BODY_RE = /^\s*[│┃]/
// anchored status-line patterns only — must NOT match inside legitimate prose,
// so this is applied per-LINE, never to a whole turn body
const STATUS_LINE_RE = /(^\s*[✻✶✽✳✢*]\s|⏵⏵|auto mode on|shift\+tab|esc to interrupt|to cancel|plan limits|usage credits|ctx:\d|session:\d|tokens\b.*\b(5h|7d)\b)/i

const parsePaneConversation = (lines: string[]): { role: 'user' | 'assistant'; text: string }[] => {
  const turns: { role: 'user' | 'assistant'; text: string }[] = []
  let current: { role: 'user' | 'assistant'; text: string } | null = null

  const flush = () => {
    if (current && current.text.trim()) turns.push({ ...current, text: current.text.trim().slice(0, SNIPPET) })
    current = null
  }

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')
    const user = USER_RE.exec(line)
    const asst = ASSISTANT_RE.exec(line)
    if (user) {
      flush()
      current = { role: 'user', text: user[1] ?? '' }
    } else if (asst) {
      flush()
      current = { role: 'assistant', text: asst[1] ?? '' }
    } else if (BARE_PROMPT_RE.test(line) || NOISE_RE.test(line) || BOX_BODY_RE.test(line) || STATUS_LINE_RE.test(line)) {
      // separator, empty prompt, dialog body, or status line — ends the turn
      flush()
    } else if (current) {
      // continuation of the current turn (wrapped/indented prose)
      const cont = line.replace(/^\s+/, '')
      if (cont) current.text += ` ${cont}`
    }
  }
  flush()
  // NB: no whole-body chrome filter — that dropped legit turns containing words
  // like "tokens". Per-line filtering above is enough.
  return turns.slice(-MAX_TURNS)
}

// --- durable metadata from the transcript (best-effort) ---

const transcriptMeta = (
  sessionId: string,
): { title: string | null; gitBranch: string | null; files: string[] } => {
  const meta = { title: null as string | null, gitBranch: null as string | null, files: [] as string[] }
  const file = globSync(join(PROJECTS, '*', `${sessionId}.jsonl`))[0]
  if (!file) return meta
  const size = statSync(file).size
  const slice = readFileSync(file).subarray(Math.max(0, size - TAIL_BYTES)).toString('utf8')
  const files = new Set<string>()
  for (const line of slice.split('\n')) {
    if (line.trim() === '') continue
    let entry: Record<string, unknown>
    try {
      entry = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }
    if (entry['type'] === 'ai-title' && typeof entry['aiTitle'] === 'string') meta.title = entry['aiTitle']
    if (typeof entry['gitBranch'] === 'string') meta.gitBranch = entry['gitBranch']
    const result = entry['toolUseResult'] as Record<string, unknown> | undefined
    if (result && typeof result['filePath'] === 'string') files.add(result['filePath'])
  }
  meta.files = [...files].slice(-20)
  return meta
}

export const readAgentContext = async (agent: string): Promise<AgentContext | null> => {
  const recent = parsePaneConversation(await capturePaneScrollback(`mc-${agent}`))
  const sessionId = agentSessionId(agent)
  const meta = sessionId ? transcriptMeta(sessionId) : { title: null, gitBranch: null, files: [] }
  // Nothing to share if the pane is empty and the transcript hasn't flushed.
  if (recent.length === 0 && !meta.title) return null
  return {
    agent,
    title: meta.title,
    gitBranch: meta.gitBranch,
    filesTouched: meta.files,
    recent,
  }
}
