import type { AgentStatus } from '@mc/shared'
import { emit } from './events'
import { capturePaneScreen, listMcSessions } from './tmux'

// Per-agent status from the rendered pane. The naive "scan the whole tail"
// approach false-positives on prose (a bullet "● Wait… Actually" looks like a
// spinner; stale "esc to interrupt" in scrollback never clears). So we locate
// the ONE live status line — the last meaningful line just above the input box —
// and classify only that, plus the input-box region for permission dialogs.
//
// Calibrated to Claude 2.1.x:
//   running     → spinner line "<spinner-glyph> gerund… (Ns)"  (ellipsis)
//   done/idle   → "<glyph> Gerund for 12s" then "❯ "           (past tense)
//   needs-input → input box shows a numbered menu "❯ 1." / trust dialog
//   exited      → the tmux pane is dead

const POLL_MS = 2000

// Claude's rotating spinner glyphs (NOT the content bullets ● ⏺ ⎿ or prompt ❯).
const SPINNER = '[✻✶✽✳✢✺✹✸✷✦✧✥⋆∗⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⠟⠯⠷⠾⠽⠻]'
// a live spinner line: "<glyph> Gerund… (Ns · ↓ tokens)". The ellipsis is the
// present-tense tell; "<glyph> Gerund for Ns" (done) has no ellipsis.
const SPINNER_RE = new RegExp(`^\\s*${SPINNER}\\s+[A-Za-z][\\w' .,/-]*…`)
const ESC_RE = /esc to interrupt/i
// chrome lines below/around the spinner — skipped when finding the input box
const CHROME_RE = /^\s*$|^\s*[─━│╭╰╮╯┌┐└┘]+\s*$|⏵⏵|auto mode on|ctx:\d|session:\d|^\s*[❯>]\s*$/u
// a selectable numbered option (permission / trust dialog) — anchored, not prose
const DIALOG_RE = /[❯>]\s*1\.\s|I trust this folder|\(y\/n\)/i

// The spinner sits just above the input box, but a transient "Checking for
// updates…" notice can render BELOW it — so we scan the handful of content
// lines above the input box, not just the single last one.
const REGION = 6

const regionAboveInputBox = (lines: string[]): string[] => {
  let i = lines.length - 1
  while (i >= 0 && (lines[i]?.trim() === '' || CHROME_RE.test(lines[i] ?? ''))) i -= 1
  const region: string[] = []
  for (; i >= 0 && region.length < REGION; i -= 1) {
    const line = lines[i] ?? ''
    if (line.trim() !== '') region.push(line)
  }
  return region
}

export const classify = (lines: string[]): AgentStatus => {
  // a permission/trust dialog renders a numbered menu in the bottom region
  if (DIALOG_RE.test(lines.slice(-12).join('\n'))) return 'needs-input'
  const region = regionAboveInputBox(lines)
  // running iff a real spinner (glyph + ellipsis) is in that region; the done
  // marker "Gerund for Ns" and prose bullets (●) never match SPINNER_RE
  if (region.some(l => SPINNER_RE.test(l) || ESC_RE.test(l))) return 'running'
  return 'idle'
}

const statuses = new Map<string, AgentStatus>()

export const getStatus = (agent: string): AgentStatus => statuses.get(agent) ?? 'idle'

let ticking = false

const tick = async (): Promise<void> => {
  if (ticking) return // a slow capture must not let ticks stack
  ticking = true
  try {
    const live = await listMcSessions()
    // a killed session: drop it and tell the UI so the glow clears
    for (const agent of [...statuses.keys()]) {
      if (!live.has(`mc-${agent}`)) {
        statuses.delete(agent)
        emit({ type: 'status', agent, status: 'exited' })
      }
    }
    for (const [session, state] of live) {
      if (!session.startsWith('mc-')) continue
      const agent = session.slice(3)
      const next: AgentStatus = state.dead ? 'exited' : classify(await capturePaneScreen(session))
      if (statuses.get(agent) !== next) {
        statuses.set(agent, next)
        emit({ type: 'status', agent, status: next })
      }
    }
  } finally {
    ticking = false
  }
}

export const startStatusPolling = (): NodeJS.Timeout => {
  void tick()
  return setInterval(() => void tick(), POLL_MS)
}
