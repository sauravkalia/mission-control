#!/usr/bin/env bash
# One-shot setup for Mission Control. Checks prerequisites, installs deps, and
# registers the cross-agent MCP server. Re-runnable.
set -euo pipefail

say() { printf '\033[0;32m%s\033[0m\n' "$1"; }
warn() { printf '\033[0;33m%s\033[0m\n' "$1"; }
die() { printf '\033[0;31m%s\033[0m\n' "$1" >&2; exit 1; }

cd "$(dirname "$0")"

say "Mission Control — setup"

# ── prerequisites ───────────────────────────────────────────────────────────
command -v tmux >/dev/null 2>&1 || die "tmux not found. Install it: brew install tmux (macOS) / apt install tmux (Linux)"
command -v claude >/dev/null 2>&1 || warn "claude CLI not on PATH — install Claude Code (https://claude.com/claude-code) or set MC_CLAUDE_BIN"
command -v pnpm >/dev/null 2>&1 || die "pnpm not found. Install it: npm i -g pnpm"

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
[ "$NODE_MAJOR" -ge 22 ] || die "Node 22+ required (found $(node -v 2>/dev/null || echo none)). Use: nvm use 22"

if command -v python3 >/dev/null 2>&1 && python3 -c 'import agentvault' >/dev/null 2>&1; then
  say "✓ AgentVault detected — the DATA CORE will be live"
else
  warn "AgentVault not detected — the DATA CORE will show offline (optional; install agentvault to enable memory recall)"
fi

# ── install + register ──────────────────────────────────────────────────────
say "Installing dependencies…"
pnpm install

say "Registering the cross-agent MCP server with Claude Code…"
node setup/register-mcp.mjs || warn "MCP registration skipped — you can run it later: node setup/register-mcp.mjs"

say ""
say "Done. Start it with:  pnpm dev"
say "Then open http://localhost:${MC_WEB_PORT:-5173}"
