import { randomUUID } from 'node:crypto'
import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { Router } from 'express'
import { AGENT_NAME_RE, sessionNameFor, type AgentMeta, type SpawnRequest } from '@mc/shared'
import { hooksFilePath, loadRegistry, saveRegistry, type AgentRecord } from './registry'
import {
  capturePaneTail,
  killSession,
  listMcSessions,
  resolveClaudeBin,
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

const toMeta = (r: AgentRecord, live: Map<string, { dead: boolean }>): AgentMeta => ({
  agent: r.agent,
  repoDir: r.repoDir,
  spawnedAt: r.spawnedAt,
  sessionId: r.sessionId,
  dead: live.get(sessionNameFor(r.agent))?.dead ?? true,
})

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
    res.json(registry.map(r => toMeta(r, live)))
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
      port: 4711,
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

  router.delete('/agents/:agent', async (req, res) => {
    const agent = req.params.agent
    const record = registry.find(r => r.agent === agent)
    if (!record) {
      res.status(404).json({ error: `no such agent: ${agent}` })
      return
    }
    await killSession(sessionNameFor(agent))
    registry = registry.filter(r => r.agent !== agent)
    saveRegistry(registry)
    res.status(204).end()
  })

  return router
}
