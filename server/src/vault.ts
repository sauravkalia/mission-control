import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { VaultStats } from '@mc/shared'
import { emit, emitIngest } from './events'

// Mission Control's own connection to AgentVault (the data core). The Node
// server spawns a second agentvault MCP instance over stdio — verified safe to
// run concurrently with Claude Code's (SQLite reads). Used for live stats,
// ingest detection, and proxying recall from wired agents.

const COMMAND = '/opt/anaconda3/bin/python3'
const ARGS = ['-m', 'agentvault.mcp_server']
const POLL_MS = 10_000

let client: Client | null = null
let connecting: Promise<Client | null> | null = null
let stats: VaultStats = { connected: false, chunks: 0, sessions: 0, projects: [], sources: [] }

const textOf = (result: unknown): string => {
  const content = (result as { content?: unknown }).content
  if (!Array.isArray(content)) return ''
  for (const block of content) {
    if (block && typeof block === 'object' && (block as { type?: string }).type === 'text') {
      const text = (block as { text?: unknown }).text
      if (typeof text === 'string') return text
    }
  }
  return ''
}

const connect = async (): Promise<Client | null> => {
  if (client) return client
  if (connecting) return connecting
  connecting = (async () => {
    try {
      const transport = new StdioClientTransport({ command: COMMAND, args: ARGS, env: { ...process.env } as Record<string, string> })
      const c = new Client({ name: 'mission-control', version: '0.1.0' })
      await c.connect(transport)
      c.onclose = () => {
        client = null
        stats = { ...stats, connected: false }
      }
      client = c
      return c
    } catch {
      client = null
      return null
    } finally {
      connecting = null
    }
  })()
  return connecting
}

const parseStatus = (text: string): Pick<VaultStats, 'chunks' | 'projects' | 'sources'> => {
  const chunks = Number(/Total chunks:\s*(\d+)/.exec(text)?.[1] ?? 0)
  const projects = (/Projects:\s*(.+)/.exec(text)?.[1] ?? '').split(',').map(s => s.trim()).filter(Boolean)
  const sources = (/Sources:\s*(.+)/.exec(text)?.[1] ?? '').split(',').map(s => s.trim()).filter(Boolean)
  return { chunks, projects, sources }
}

const parseSessions = (text: string): number => Number(/(\d+)\s+sessions/.exec(text)?.[1] ?? 0)

const refresh = async (): Promise<void> => {
  const c = await connect()
  if (!c) {
    if (stats.connected) stats = { ...stats, connected: false }
    return
  }
  try {
    const status = parseStatus(textOf(await c.callTool({ name: 'vault_status', arguments: {} })))
    const sessions = parseSessions(textOf(await c.callTool({ name: 'vault_wake_up', arguments: {} })))
    const prevChunks = stats.chunks
    stats = { connected: true, ...status, sessions }
    emit({ type: 'vault', stats })
    // a real ingest event: the index grew since the last poll
    if (prevChunks > 0 && status.chunks > prevChunks) emitIngest(status.chunks - prevChunks)
  } catch {
    client = null
    stats = { ...stats, connected: false }
  }
}

export const vaultStats = (): VaultStats => stats

export const startVaultPolling = (): NodeJS.Timeout => {
  void refresh()
  return setInterval(() => void refresh(), POLL_MS)
}

export type VaultSearchResult = { ok: boolean; text: string }

export const vaultSearch = async (query: string): Promise<VaultSearchResult> => {
  const c = await connect()
  if (!c) return { ok: false, text: 'AgentVault is not reachable.' }
  try {
    const res = await c.callTool({ name: 'vault_search_lite', arguments: { query, top_k: 6 } })
    return { ok: true, text: textOf(res) }
  } catch {
    return { ok: false, text: 'AgentVault search failed.' }
  }
}
