// WS frame asymmetry (locked decision — see Plan.md):
//   server → client: BINARY frames only — raw pty bytes, written straight into xterm.
//   client → server: TEXT frames only — JSON-encoded ClientMessage. Keyboard input
//   stays a string end-to-end (xterm onData → JSON → IPty.write); binary input frames
//   could split a multibyte sequence across frames and corrupt it.

export type ClientMessage =
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number }

const MAX_COLS = 500
const MAX_ROWS = 300

export const parseClientMessage = (raw: string): ClientMessage | undefined => {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null) return undefined
  const msg = value as Record<string, unknown>

  if (msg['type'] === 'input' && typeof msg['data'] === 'string') {
    return { type: 'input', data: msg['data'] }
  }
  if (msg['type'] === 'resize' && typeof msg['cols'] === 'number' && typeof msg['rows'] === 'number') {
    const cols = Math.floor(msg['cols'])
    const rows = Math.floor(msg['rows'])
    if (cols >= 2 && cols <= MAX_COLS && rows >= 2 && rows <= MAX_ROWS) {
      return { type: 'resize', cols, rows }
    }
  }
  return undefined
}
