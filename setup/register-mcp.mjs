#!/usr/bin/env node
// Registers Mission Control's cross-agent MCP server with Claude Code at user
// scope, so every `claude` session can call list_agents / get_agent_context /
// recall_memory. Idempotent — safe to re-run. Run with no claude sessions open
// (claude rewrites ~/.claude.json frequently).
import { execFileSync } from 'node:child_process'

const PORT = process.env.MC_PORT ?? '4711'
const URL = `http://127.0.0.1:${PORT}/mcp`
// literal — Claude Code expands ${MC_AGENT_NAME} per-session at startup, so each
// agent's requests carry its own identity (set via tmux -e at spawn).
const HEADER = 'X-MC-Agent: ${MC_AGENT_NAME:-}'

const tryClaude = (args) => {
  try {
    return { ok: true, out: execFileSync('claude', args, { encoding: 'utf8' }) }
  } catch (e) {
    return { ok: false, out: String(e?.stdout ?? e?.message ?? e) }
  }
}

const list = tryClaude(['mcp', 'list'])
if (!list.ok && /not found|ENOENT/i.test(list.out)) {
  console.error('✗ `claude` CLI not found on PATH. Install Claude Code first: https://claude.com/claude-code')
  process.exit(1)
}
if (list.ok && list.out.includes('mission-control')) {
  console.log('✓ mission-control MCP already registered')
  process.exit(0)
}

const add = tryClaude(['mcp', 'add', 'mission-control', URL, '--transport', 'http', '--scope', 'user', '-H', HEADER])
if (add.ok) {
  console.log(`✓ registered mission-control MCP at ${URL}`)
} else {
  console.error('✗ could not register automatically. Run this yourself:')
  console.error(`  claude mcp add mission-control ${URL} --transport http --scope user -H '${HEADER}'`)
  process.exit(1)
}
