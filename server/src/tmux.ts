import { execFile } from 'node:child_process'

// Every target uses exact-match `=name` — bare `-t mc-sphere` would
// prefix-match `mc-sphere-web`. No `~` in any argv: there is no shell
// anywhere in this chain, so nothing expands it.
//
// Target syntax (verified on tmux 3.6b): session-target commands
// (has-session, attach-session, kill-session) take `=name`; pane/window-target
// commands (capture-pane, display-message, send-keys, respawn-pane) need
// `=name:` — bare `=name` fails there with "can't find pane".

export const hasSession = (name: string): Promise<boolean> =>
  new Promise(resolve => {
    execFile('tmux', ['has-session', '-t', `=${name}`], error => {
      resolve(error === null)
    })
  })
