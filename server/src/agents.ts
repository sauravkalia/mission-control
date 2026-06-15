import { randomUUID } from 'node:crypto'
import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { Router } from 'express'
import { AGENT_NAME_RE, sessionNameFor, VAULT_ID, type AgentMeta, type SpawnRequest } from '@mc/shared'
import { PORT } from './config'
import { emitLinksChanged } from './events'
import { addLink, listLinks, pruneLinks, removeLink } from './links'
import { hooksFilePath, loadRegistry, saveRegistry, type AgentRecord } from './registry'
import { getActivity } from './status'
import { getService, startService, stopService } from './services'
import {
  capturePaneTail,
  killSession,
  listMcSessions,
  resolveClaudeBin,
  sendToSession,
  spawnAgentSession,
} from './tmux'

const DEATH_CHECK_MS = 1200

let registry: AgentRecord[] = []

export const bootRegistry = async (): Promise<void> => {
  // Adopt only mc-* sessions this server spawned (registry ∩ tmux ls) —
  // attach-everything mode is explicitly parked.
  const live = await listMcSessions()
  const loaded = loadRegistry()
  registry = loaded.filter(r => live.has(sessionNameFor(r.agent)))
  // Unconditional save: repairs a corrupt/truncated agents.json at boot
  saveRegistry(registry)
}

export const isKnownSession = (session: string): boolean =>
  registry.some(r => sessionNameFor(r.agent) === session)

export const isKnownAgent = (agent: string): boolean => registry.some(r => r.agent === agent)

export const listAgentNames = (): string[] => registry.map(r => r.agent)

export const agentSessionId = (agent: string): string | null =>
  registry.find(r => r.agent === agent)?.sessionId ?? null

export const agentRepoDir = (agent: string): string | undefined =>
  registry.find(r => r.agent === agent)?.repoDir

const toMeta = (r: AgentRecord, live: Map<string, { dead: boolean }>): AgentMeta => {
  const dead = live.get(sessionNameFor(r.agent))?.dead ?? true
  const activity = getActivity(r.agent)
  return {
    agent: r.agent,
    repoDir: r.repoDir,
    spawnedAt: r.spawnedAt,
    sessionId: r.sessionId,
    dead,
    status: dead ? 'exited' : activity.status,
    action: dead ? '' : activity.action,
    ctx: dead ? null : activity.ctx,
    service: { running: getService(r.agent).running, url: getService(r.agent).url },
  }
}

const expandHome = (p: string): string => (p.startsWith('~/') ? join(homedir(), p.slice(2)) : p)

const validateSpawn = (body: unknown): SpawnRequest | string => {
  if (typeof body !== 'object' || body === null) return 'invalid request body'
  const { agent, repoDir } = body as Record<string, unknown>
  if (typeof agent !== 'string' || !AGENT_NAME_RE.test(agent)) {
    return 'callsign must be 1-24 chars: lowercase letters, digits, dashes'
  }
  if (typeof repoDir !== 'string' || repoDir.trim() === '') return 'repo path required'
  const dir = expandHome(repoDir.trim())
  if (!isAbsolute(dir)) return 'repo path must be absolute (or start with ~/)'
  try {
    if (!statSync(dir).isDirectory()) return `not a directory: ${dir}`
  } catch {
    return `no such directory: ${dir}`
  }
  if (registry.some(r => r.agent === agent)) return `callsign already on console: ${agent}`
  return { agent, repoDir: dir }
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

export const agentsRouter = (): Router => {
  const router = Router()

  router.get('/agents', async (_req, res) => {
    const live = await listMcSessions()
    // Sessions killed outside the UI (e.g. `tmux kill-session` in Ghostty)
    // drop out of the registry here — free stale cleanup.
    const gone = registry.filter(r => !live.has(sessionNameFor(r.agent)))
    if (gone.length > 0) {
      registry = registry.filter(r => live.has(sessionNameFor(r.agent)))
      saveRegistry(registry)
    }
    pruneLinks(new Set(registry.map(r => r.agent)))
    res.json(registry.map(r => toMeta(r, live)))
  })

  router.get('/links', (_req, res) => {
    res.json(listLinks())
  })

  router.post('/links', (req, res) => {
    const { a, b } = (req.body ?? {}) as { a?: unknown; b?: unknown }
    if (typeof a !== 'string' || typeof b !== 'string' || a === b) {
      res.status(400).json({ error: 'two distinct callsigns required' })
      return
    }
    // an endpoint is valid if it's a live agent or the vault data core
    const valid = (id: string): boolean => id === VAULT_ID || registry.some(r => r.agent === id)
    if (!valid(a) || !valid(b)) {
      res.status(404).json({ error: 'both endpoints must be on console' })
      return
    }
    addLink(a, b)
    emitLinksChanged()
    res.status(201).json(listLinks())
  })

  router.delete('/links', (req, res) => {
    const { a, b } = (req.body ?? {}) as { a?: unknown; b?: unknown }
    if (typeof a !== 'string' || typeof b !== 'string') {
      res.status(400).json({ error: 'two callsigns required' })
      return
    }
    removeLink(a, b)
    emitLinksChanged()
    res.status(200).json(listLinks())
  })

  router.post('/agents', async (req, res) => {
    const valid = validateSpawn(req.body)
    if (typeof valid === 'string') {
      res.status(400).json({ error: valid })
      return
    }

    let claudeBin: string
    try {
      claudeBin = resolveClaudeBin()
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'claude not found' })
      return
    }

    const firstSpawn = (await listMcSessions()).size === 0
    const sessionId = randomUUID()
    const session = sessionNameFor(valid.agent)
    const spawned = await spawnAgentSession({
      agent: valid.agent,
      repoDir: valid.repoDir,
      sessionId,
      claudeBin,
      hooksPath: hooksFilePath(),
      port: PORT,
      withGlobals: firstSpawn,
    })
    if (!spawned.ok) {
      res.status(500).json({ error: `tmux spawn failed: ${spawned.stderr.trim()}` })
      return
    }

    // Instant-death check: remain-on-exit keeps the corpse visible long enough
    // to read its last words, then we clean it up and surface them.
    await sleep(DEATH_CHECK_MS)
    const live = await listMcSessions()
    const state = live.get(session)
    if (!state || state.dead) {
      const tail = await capturePaneTail(session, 5)
      await killSession(session)
      res.status(400).json({ error: `agent died on launch${tail ? `:\n${tail}` : ''}` })
      return
    }

    const record: AgentRecord = {
      agent: valid.agent,
      sessionId,
      repoDir: valid.repoDir,
      spawnedAt: new Date().toISOString(),
    }
    registry = [...registry, record]
    saveRegistry(registry)
    res.status(201).json(toMeta(record, live))
  })

  // "Run app" — start/stop the agent's project dev server
  router.post('/agents/:agent/server', async (req, res) => {
    const record = registry.find(r => r.agent === req.params.agent)
    if (!record) {
      res.status(404).json({ error: `no such agent: ${req.params.agent}` })
      return
    }
    const result = await startService(record.agent, record.repoDir)
    res.status(result.ok ? 201 : 400).json(result)
  })

  router.delete('/agents/:agent/server', async (req, res) => {
    await stopService(req.params.agent)
    res.status(200).json({ ok: true })
  })

  // "Connect Playwright" — tell the agent to open the running app in a browser
  router.post('/agents/:agent/playwright', async (req, res) => {
    const agent = req.params.agent
    if (!registry.some(r => r.agent === agent)) {
      res.status(404).json({ error: `no such agent: ${agent}` })
      return
    }
    const url = getService(agent).url
    const message = url
      ? `Use the Playwright MCP to open ${url} in the browser, walk through the app, and report what you see and any issues you find. Keep the browser visible.`
      : `Use the Playwright MCP to open this project's local dev app in a visible browser (start the dev server first if it isn't running), walk through the app, and report what you see and any issues.`
    const ok = await sendToSession(sessionNameFor(agent), message)
    res.status(ok ? 200 : 500).json({ ok, url })
  })

  router.post('/agents/:agent/send', async (req, res) => {
    const agent = req.params.agent
    const { message } = (req.body ?? {}) as { message?: unknown }
    if (typeof message !== 'string' || message.trim() === '') {
      res.status(400).json({ error: 'message required' })
      return
    }
    if (!registry.some(r => r.agent === agent)) {
      res.status(404).json({ error: `no such agent: ${agent}` })
      return
    }
    const ok = await sendToSession(sessionNameFor(agent), message)
    res.status(ok ? 200 : 500).json({ ok })
  })

  router.delete('/agents/:agent', async (req, res) => {
    const agent = req.params.agent
    const record = registry.find(r => r.agent === agent)
    if (!record) {
      res.status(404).json({ error: `no such agent: ${agent}` })
      return
    }
    await killSession(sessionNameFor(agent))
    await stopService(agent) // tear down its dev server too
    registry = registry.filter(r => r.agent !== agent)
    saveRegistry(registry)
    res.status(204).end()
  })

  return router
}
