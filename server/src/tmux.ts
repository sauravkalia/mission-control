import { execFile } from 'node:child_process'
import { sessionNameFor } from '@mc/shared'

export { resolveClaudeBin } from './config'

// Every target uses exact-match `=name` — bare `-t mc-sphere` would
// prefix-match `mc-sphere-web`. No `~` in any argv: there is no shell
// anywhere in this chain, so nothing expands it.
//
// Target syntax (verified on tmux 3.6b): session-target commands
// (has-session, attach-session, kill-session) take `=name`; pane/window-target
// commands (capture-pane, display-message, send-keys, respawn-pane, set-option)
// need `=name:` — bare `=name` fails there with "can't find pane".

const tmux = (args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> =>
  new Promise(resolve => {
    execFile('tmux', args, (error, stdout, stderr) => {
      resolve({ ok: error === null, stdout, stderr })
    })
  })

export const hasSession = (name: string): Promise<boolean> =>
  tmux(['has-session', '-t', `=${name}`]).then(r => r.ok)

type SpawnArgs = {
  agent: string
  repoDir: string
  sessionId: string
  claudeBin: string
  hooksPath: string
  port: number
  withGlobals: boolean
}

// Locked argv (Plan.md): absolute paths only, server-chosen --session-id,
// remain-on-exit chained atomically so an instantly-crashing claude still
// leaves a visible dead pane instead of vanishing from `tmux ls`.
// On the first spawn the server-wide globals are chained BEFORE new-session
// (history-limit is captured at pane creation — applying it after the first
// spawn would leave the first agent with the 2000-line default).
export const spawnAgentSession = ({ agent, repoDir, sessionId, claudeBin, hooksPath, port, withGlobals }: SpawnArgs) => {
  const session = sessionNameFor(agent)
  const globals = withGlobals
    ? [
        'start-server', ';',
        'set', '-as', 'terminal-features', ',xterm-256color:RGB', ';',
        'set', '-g', 'history-limit', '50000', ';',
        'set', '-g', 'window-size', 'latest', ';',
        'set', '-g', 'focus-events', 'on', ';',
      ]
    : []
  return tmux([
    ...globals,
    'new-session', '-d', '-s', session, '-c', repoDir, '-x', '220', '-y', '50',
    '-e', `MC_AGENT_NAME=${agent}`, '-e', `MC_PORT=${String(port)}`,
    claudeBin, '--session-id', sessionId, '--settings', hooksPath,
    ';',
    'set-option', '-w', '-t', `=${session}:`, 'remain-on-exit', 'on',
    ';',
    'set-option', '-t', `=${session}:`, 'status', 'off',
  ])
}

export const killSession = (name: string): Promise<boolean> =>
  tmux(['kill-session', '-t', `=${name}`]).then(r => r.ok)

// session name → pane_dead, for every live mc-* session.
// `tmux list-panes` exits 1 when no tmux server runs — that just means zero sessions.
export const listMcSessions = async (): Promise<Map<string, { dead: boolean }>> => {
  const result = await tmux(['list-panes', '-a', '-F', '#{session_name}\t#{pane_dead}'])
  const map = new Map<string, { dead: boolean }>()
  if (!result.ok) return map
  for (const line of result.stdout.split('\n')) {
    const [name, dead] = line.split('\t')
    if (name?.startsWith('mc-')) map.set(name, { dead: dead === '1' })
  }
  return map
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

// Inject a message into a session's prompt and submit it. set-buffer takes the
// text as an argv (no shell, semicolon/newline-safe); paste-buffer -p uses
// bracketed paste; Enter goes separately after a beat (Enter-in-burst with the
// text gets swallowed as a newline inside the TUI input box).
export const sendToSession = async (name: string, message: string): Promise<boolean> => {
  if (!(await tmux(['set-buffer', '--', message])).ok) return false
  if (!(await tmux(['paste-buffer', '-p', '-d', '-t', `=${name}:`])).ok) return false
  await sleep(300)
  return (await tmux(['send-keys', '-t', `=${name}:`, 'Enter'])).ok
}

export const capturePaneTail = async (name: string, lines = 15): Promise<string> => {
  const result = await tmux(['capture-pane', '-p', '-t', `=${name}:`])
  if (!result.ok) return ''
  return result.stdout
    .split('\n')
    .filter(l => l.trim() !== '')
    .slice(-lines)
    .join('\n')
}

// Rendered pane incl. scrollback — the LIVE conversation, since Claude buffers
// a running session's turns in memory and doesn't flush them to the transcript.
export const capturePaneScrollback = async (name: string, scrollback = 220): Promise<string[]> => {
  const result = await tmux(['capture-pane', '-p', '-S', `-${String(scrollback)}`, '-t', `=${name}:`])
  if (!result.ok) return []
  return result.stdout.split('\n')
}

// Just the visible screen, structure preserved (blank lines kept) — needed to
// locate the live status line relative to the input box for status detection.
export const capturePaneScreen = async (name: string): Promise<string[]> => {
  const result = await tmux(['capture-pane', '-p', '-t', `=${name}:`])
  if (!result.ok) return []
  return result.stdout.split('\n')
}
