// In dev, the Vite proxy forwards /api and /ws to the server, so relative URLs
// work. In a packaged build (Tauri) the UI is static and must reach the server
// directly on its port. import.meta.env.DEV distinguishes the two.

const SERVER_PORT = 4711

const HTTP_BASE = import.meta.env.DEV ? '' : `http://127.0.0.1:${SERVER_PORT}`
const WS_BASE = import.meta.env.DEV
  ? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`
  : `ws://127.0.0.1:${SERVER_PORT}`

export const apiUrl = (path: string): string => `${HTTP_BASE}${path}`
export const wsUrl = (path: string): string => `${WS_BASE}${path}`
