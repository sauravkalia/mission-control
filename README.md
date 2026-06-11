# Mission Control

A local, n8n-style canvas for running and orchestrating a fleet of **Claude Code agents**. Each agent is a real `claude` session living in its own tmux window, mirrored into a draggable terminal node on an infinite canvas. Wire agents together to share memory, watch tasks run and finish at a glance, and connect them to a shared memory **DATA CORE**.

> **Local-first.** Mission Control drives *your* machine — it spawns real `claude` processes, reads your `~/.claude` files, and runs agents in your repos. It is not a hosted service; each person runs their own copy. It binds to `127.0.0.1` only and has no login, because the API can launch code on your machine. **Do not expose it beyond localhost without adding authentication.**

## What it does

- **Spawn agents** — open a new station, pick a repo, and a real `claude` boots in a tmux session you can also `tmux attach` to from any terminal.
- **One canvas** — pan/zoom an infinite workspace; every agent is a live terminal node. Maximize one to full screen, minimize to the dock.
- **At-a-glance status** — each window glows by what it's doing: **running** (pulsing green + spinner), **needs you** (pulsing amber), **done** (green flash), **idle** (dim) — readable even zoomed out.
- **Share memory between agents** — drag a wire from one card to another (n8n-style). A linked agent can read the other's live work via the built-in MCP tool, and you watch the context fly across the wire.
- **AgentVault DATA CORE** *(optional)* — wire an agent to the core to let it recall from your indexed history of past sessions; every conversation feeds the core, shown live.

## Prerequisites

| Need | Why | Install |
|---|---|---|
| **macOS or Linux** | tmux + PTY | — |
| **tmux** | the session bridge | `brew install tmux` / `apt install tmux` |
| **Node 22+** | server + Vite 8 | `nvm install 22` |
| **pnpm 10+** | workspace | `npm i -g pnpm` |
| **Claude Code** | the agents themselves | https://claude.com/claude-code (logged in) |
| AgentVault *(optional)* | the DATA CORE / memory recall | your own memory index; the core is offline without it |

## Quick start

```bash
git clone <this-repo> mission-control && cd mission-control
./setup.sh          # checks prereqs, installs deps, registers the MCP server
pnpm dev            # starts the server (:4711) + web UI (:5173)
open http://localhost:5173
```

Then: hit **N** (or **NEW STATION**), pick a repo, and your first agent boots. Drag a port on one card's edge onto another to wire them.

## Using it

- **New agent** — `N` or the **NEW STATION** button → callsign + repo path.
- **Wire two agents** — drag from a port (○) on one card's edge onto another card. In the source agent, ask it to read its partner (e.g. *"use mission-control to read what api-core changed"*).
- **Recall past memory** *(needs AgentVault)* — wire a card to the **DATA CORE**, then ask the agent to `recall_memory` about earlier work.
- **Maximize** — the `□` button (or double-click the title bar). **Kill** — hold the `×` for ~0.6s.
- **From a terminal** — `tmux attach -t mc-<callsign>` drops you into the exact same session.

## Configuration

All optional — sensible defaults are auto-detected. Copy `.env.example` to `server/.env` or export before `pnpm dev`:

| Variable | Default | Purpose |
|---|---|---|
| `MC_PORT` | `4711` | server / API / MCP port |
| `MC_WEB_PORT` | `5173` | Vite dev UI port |
| `MC_CLAUDE_BIN` | auto (PATH) | path to the `claude` CLI if not on PATH |
| `MC_VAULT_CMD` | auto (`python3 -m agentvault.mcp_server`) | how to launch AgentVault |
| `MC_VAULT_DISABLED` | — | set `1` to hide the DATA CORE entirely |

## How it works

```
browser (React + React Flow)
  │  WS /ws/term/<agent>  (xterm ⇆ pty bytes)
  │  WS /ws/events        (status · pulls · vault)
  │  REST /api/*  ·  MCP /mcp
server (Express + ws + node-pty)
  │  node-pty → tmux attach        ← terminals
  │  capture-pane poll             ← live status
  │  MCP server                    ← cross-agent context + recall
  │  stdio client → AgentVault     ← the DATA CORE (optional)
tmux sessions: mc-<agent> → claude   ← your terminal can attach too
```

tmux is the bridge: the browser and your terminal are just two clients on the same session, so spawning from the UI and finishing from the terminal are the same thing.

See [Plan.md](Plan.md) for the full architecture and [Design.md](Design.md) for the design system.

## License

MIT — see [LICENSE](LICENSE).
