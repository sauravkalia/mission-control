# Mission Control

**MOCR** — a phosphor-green flight-ops console for a fleet of Claude Code agents.

Every agent is a real `claude` process inside a tmux session, mirrored live into a draggable
console card in one dark web page. Because tmux is the bridge, the browser and your terminal
attach to the *exact same session* — spawn from the UI, finish from Ghostty, no difference.
At the center, **THE PLOT** maps the fleet around a BASE hub and animates real context pulls
between agents (built-in MCP server: `list_agents` / `get_agent_context` / `send_to_agent`).

Status: **planning complete, pre-build.**

- [Plan.md](Plan.md) — architecture, tech stack, milestones M0–M6, 59 verified gotchas
- [Design.md](Design.md) — the MOCR design bible: tokens, window chrome, THE PLOT, motion language

Personal fun project. Local-only (127.0.0.1), single user, no auth by design.
