import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { emit } from './events'
import { capturePaneScreen, hasSession, killSession, startServiceSession } from './tmux'

// Per-agent project dev server ("Run app"). Runs the repo's dev script in its
// own tmux session (mcsvc-<agent> — the `mc-` prefix is deliberately avoided so
// the status engine doesn't mistake it for an agent), and scrapes the printed
// localhost URL so Playwright knows where to point.

const POLL_MS = 1500
const svcName = (agent: string): string => `mcsvc-${agent}`

export type ServiceState = { running: boolean; url: string | null; command: string | null }

const services = new Map<string, ServiceState>()

export const getService = (agent: string): ServiceState =>
  services.get(agent) ?? { running: false, url: null, command: null }

const emitService = (agent: string): void => {
  const s = getService(agent)
  emit({ type: 'service', agent, running: s.running, url: s.url })
}

const detectCommand = (repoDir: string): string | null => {
  try {
    const pkg = JSON.parse(readFileSync(join(repoDir, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>
    }
    const scripts = pkg.scripts ?? {}
    const script = ['dev', 'start', 'serve', 'develop'].find(s => scripts[s])
    if (!script) return null
    const pm = existsSync(join(repoDir, 'pnpm-lock.yaml'))
      ? 'pnpm'
      : existsSync(join(repoDir, 'yarn.lock'))
        ? 'yarn'
        : existsSync(join(repoDir, 'bun.lockb'))
          ? 'bun'
          : 'npm'
    return `${pm} run ${script}`
  } catch {
    return null
  }
}

export const startService = async (agent: string, repoDir: string): Promise<{ ok: boolean; error?: string }> => {
  const command = detectCommand(repoDir)
  if (!command) return { ok: false, error: 'no dev/start/serve script in package.json' }
  await killSession(svcName(agent)) // restart cleanly if already up
  if (!(await startServiceSession(svcName(agent), repoDir, command))) {
    return { ok: false, error: 'failed to start the dev server' }
  }
  services.set(agent, { running: true, url: null, command })
  emitService(agent)
  return { ok: true }
}

export const stopService = async (agent: string): Promise<void> => {
  await killSession(svcName(agent))
  if (services.get(agent)?.running) {
    services.set(agent, { running: false, url: null, command: services.get(agent)?.command ?? null })
    emitService(agent)
  }
}

const URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d{2,5}/

const tick = async (): Promise<void> => {
  for (const [agent, s] of services) {
    if (!s.running) continue
    if (!(await hasSession(svcName(agent)))) {
      services.set(agent, { ...s, running: false, url: null })
      emitService(agent)
      continue
    }
    if (!s.url) {
      const url = URL_RE.exec((await capturePaneScreen(svcName(agent))).join('\n'))?.[0]
      if (url) {
        services.set(agent, { ...s, url })
        emitService(agent)
      }
    }
  }
}

export const startServicePolling = (): NodeJS.Timeout => setInterval(() => void tick(), POLL_MS)
