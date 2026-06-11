# Mission Control — Plan

A phosphor-green flight-ops console (callsign **MOCR**) for the Claude Code fleet: every agent is a real `claude` process inside a tmux session, mirrored live into a draggable console card in one dark web page. Because tmux is the bridge, the browser and Ghostty attach to the *exact same session* — spawn from the UI, finish from the terminal, no difference. At the center, **THE PLOT** renders the fleet as stations on an orbital graticule, with context visibly flowing between agents whenever one reads another's transcript through the built-in MCP server.

Repo: `/Users/Saurav/Documents/GitHub/mission-control`. Solo, fun, local-only. TypeScript strict, functional, named exports, 2-space, pnpm.

---

## 1. Architecture

```
┌──────────────────── browser · MOCR shell (Vite + React 19, :5173) ────────────────────┐
│  CONSOLE cards            THE PLOT                 FILE BAY        telemetry strip    │
│  xterm 6 + react-rnd      canvas: stations,        Monaco (lazy)   + dock + ACTN chip │
│  (1 per agent)            tracers, heat, arcs                                         │
└────┬───────────────────────────▲──────────────────────▲───────────────────────────────┘
     │ WS /ws/term/:agent        │ /ws/events JSON      │ REST /api/files
     │ (↓bin pty · ↑text+resize) │ (status·pulls·beat)  │
┌────▼───────────────────────────┴──────────────────────┴───────────────────────────────┐
│ server · Express 5 + ws · 127.0.0.1:4711                                              │
│   PTY/WS relay · status engine · event bus · transcript reader · file API · MCP /mcp  │
└──┬──────────▲─────────▲──────────────────────────▲─────────────────────▲──────────────┘
   │ node-pty │ capture │ POST /api/hooks          │ tail / fs.watch     │ StreamableHTTP
   │ attach   │ +title  │ (claude hooks via        │ ~/.claude/projects  │ tools/call from
   ▼          │ 2s poll │  --settings)             │ ~/.claude/sessions  │ ANY claude session
┌──────────────────────────────────┐                                     │
│ tmux server (default socket)     │◄── Ghostty: `tmux attach -t mc-…`   │
│  mc-sphere-web → claude          │     (same session, zero ceremony)   │
│  mc-sphere-api → claude          │◄────────────────────────────────────┘
└──────────────────────────────────┘
```

**tmux bridge.** Each agent is a tmux session on the *default socket* named `mc-<agent>`, created detached with claude as the direct-argv session command — no `sh -c` layer anywhere (`execFile('tmux',…)` → tmux 3.4+ executes multi-argument commands directly, without `sh -c`), which means **no `~` expansion either**: every path in spawn argv must be absolute, enforced as a rule in `tmux.ts`. The settings path is built with `path.join(os.homedir(), '.mission-control', 'mc-hooks.json')` — a literal `~/…` would reach claude verbatim and die with "Settings file not found" (same reason the claude binary path is already absolute):
```sh
# first spawn only: server-wide globals chained BEFORE new-session — history-limit
# is captured at pane creation, applying it after leaves agent #1 with 2000 lines
tmux start-server \; set -as terminal-features ',xterm-256color:RGB' \
  \; set -g history-limit 50000 \; set -g window-size latest \; set -g focus-events on \
  \; new-session -d -s mc-<agent> -c <repoDir> -x 220 -y 50 \
  -e MC_AGENT_NAME=<agent> -e MC_PORT=4711 \
  /Users/Saurav/.local/bin/claude --session-id <uuid> \
    --settings /Users/Saurav/.mission-control/mc-hooks.json \
  \; set-option -w -t '=mc-<agent>:' remain-on-exit on \
  \; set-option -t '=mc-<agent>:' status off
```
The trailing `\;` (a lone `;` argv token from execFile) chains `set-option` into the *same* tmux invocation as `new-session`, so `remain-on-exit on` lands atomically — an instantly-crashing claude can't destroy the session before the option arrives. A dead pane then stays visible: EXITED badge via `#{pane_dead}` poll, one-click restart via `respawn-pane -k` *with an explicit fresh command* (new `--session-id` — claude refuses a uuid that already has a transcript) instead of vanishing from `tmux ls`. Spawn also writes `{agent, sessionId, repoDir, spawnedAt}` into `~/.mission-control/agents.json`; on boot the server reloads it and reconciles against `tmux ls -f '#{m:mc-*,#{session_name}}'` — adopting surviving sessions, dropping entries with no session — because `tsx watch` restarts the server on every file save and the sessions outliving the server is the whole point of the architecture. (This re-adopts only mc-prefixed sessions the server itself spawned — *not* the parked attach-everything mode.) After the first spawn (which auto-starts the tmux server — never pre-start it), apply globals once: `set -as terminal-features ',xterm-256color:RGB'`, `set -g history-limit 50000`, `set -g window-size latest` (default since 3.1, set for self-documentation), `set -g focus-events on`. Every targeted command uses exact-match `=mc-<name>` (prefix-matching gotcha). Control plane (`new-session`/`ls`/`kill`/`capture-pane`/`display-message`/buffer injection) is plain `execFile('tmux', [...])` — no PTY needed. Text injection goes through `load-buffer -` + `paste-buffer -p -d` (bracketed paste, immune to semicolons/newlines), then a *separate* `send-keys ... Enter` after ~300ms.

**PTY/WS relay.** One `node-pty` per connected web card runs `tmux attach-session -t =mc-<agent>` with `TERM=xterm-256color`; tmux does the full redraw/snapshot on attach and the relay just pipes bytes: `pty.onData → ws.send(binary)` server→client. Client→server keyboard input rides WS **text** frames — xterm's `onData` already emits complete strings and node-pty's `IPty.write` takes a string; decoding binary frames would corrupt input the day a multibyte sequence split across frames. Binary is therefore server→client *only*; the asymmetry is written down in `shared/src/protocol.ts`. JSON text frames carry control (`{type:'resize',cols,rows}` → `pty.resize()` — never `tmux resize-window`, which permanently flips the window to manual sizing). Resize is debounced ~120ms. Multi-client size is handled by tmux's `window-size latest`: whoever typed last wins, so an idle browser card never shrinks the terminal Saurav is typing in. Because attach replays a full redraw, reconnect is nearly free — from M0, a closed socket greys the card to a plain LINK LOST and retries every 1–2s until the reattach repaints it.

**Status engine.** Three layers, reconciled in one state machine per agent (`running | needs-input | idle | exited`):
1. *Hooks (primary push, <50ms).* `--settings /Users/Saurav/.mission-control/mc-hooks.json` scopes hooks to mc-spawned sessions only — Saurav's existing 5 hook arrays in `~/.claude/settings.json` are untouched. The server ensures the hooks file exists at boot and treats it as **immutable at runtime**: claude snapshots hook config at session start and *suspends* all settings-file hooks if the file changes mid-session, so the reconciler stats its mtime and raises a "HOOKS STALE — respawn agents" warning in the telemetry strip if it changed while agents are up. Events: SessionStart/Stop→idle, UserPromptSubmit/PreToolUse/PostToolUse→running, Notification(`permission_prompt|idle_prompt`)→needs-input, SessionEnd→exited. Each hook is `curl -fsS -m 2 -X POST http://127.0.0.1:4711/api/hooks --data-binary @- -o /dev/null 2>/dev/null || true` — the `-o /dev/null` and `|| true` are load-bearing (stdout injection / exit-2 blocking). Mapping by `session_id` (server chose the UUID at spawn and persisted it in `agents.json`, so the mapping survives server restarts); `cwd` sanity-checked via `fs.realpathSync`.
2. *pane_title busy bit (polled, not sniffed).* Claude Code sets an OSC 0/2 title whose first codepoint is a braille spinner (U+2800–U+28FF) while busy — but tmux *consumes* that sequence into `#{pane_title}` and re-emits nothing to attached clients (`set-titles` is off by default, and even with it on, clients receive the expanded `set-titles-string`, not the raw title). So the relay can never see it in-stream; instead the 2s reconciler reads `display-message -p -t =mc-<agent> '#{pane_title}'` and applies the braille first-codepoint check there. Pure redundancy — the only thing lost vs in-stream is latency the hooks already cover.
3. *capture-pane reconciler (2s poll).* Covers the three verified hook blind spots: Esc-interrupt fires no Stop, the folder-trust dialog fires no Notification, and process death fires nothing. Regexes (pinned in `markers.ts` with a "verified against claude 2.1.173" comment — "esc to interrupt" is GONE in 2.1.x): `NEEDS_INPUT = /Do you want to|I trust this folder|Esc to cancel/`, `BUSY = /^[·✢✳✶✻✽] |\(\d+m?\d*s · |↓ \d+(\.\d+)?k? tokens|⏺ Running \d+/m`, run only against `capture-pane -p` rendered text. Precedence: exited (`has-session` fail or `pane_dead=1`) > needs-input > running > idle; the poller may downgrade running→idle only after 2 consecutive idle-looking polls so hooks keep winning fast edges. `~/.claude/sessions/<pid>.json` (`busy|shell`→running, `waiting`→needs-input, `idle`→idle, pid liveness via `process.kill(pid,0)`) is a cross-check input. The same tick stats the mc-hooks.json mtime (see layer 1).

**MCP cross-agent server.** `@modelcontextprotocol/sdk` StreamableHTTP mounted at `app.all('/mcp')` on the same Express app — stateful, one transport+McpServer per `Mcp-Session-Id`, unknown session → **404** (not 400) so clients re-initialize after server restarts. DNS-rebinding protection on, `allowedHosts: ['127.0.0.1:4711','localhost:4711']` (exact match including port). No auth — verified Claude sends none and OAuth only triggers on 401/403; just bind 127.0.0.1. Tools (zod input + output schemas, `structuredContent`): `list_agents` (readOnly), `get_agent_context(agent, question?, maxMessages?)` (readOnly; `question` advisory framing only, no LLM pass in v1), `send_to_agent(agent, message, force?)` (destructiveHint; refuses when target is needs-input unless `force` — injected Enter can *accept a permission prompt* — and sniffs capture-pane for dialog markers first; messages prefixed `[mission-control from <caller>]` to break echo loops). Caller identity via user-scope `headersHelper` emitting `{"X-MC-Cwd": "$PWD", "X-MC-Agent": "${MC_AGENT_NAME:-}"}` — verified to inherit the calling session's cwd/env, enables "that's you" self-exclusion and identifies plain-terminal sessions by cwd. A strong `instructions` string (<2KB) is load-bearing: ToolSearch defers MCP tools, instructions drive discovery. Every `get_agent_context` call emits a `pull` event (caller, target, **byte count**) onto the event bus — this is what THE PLOT animates.

**Transcript reader.** Resolves agent → live sessionId via `~/.claude/sessions/<pid>.json` on *every* fetch (never cached — `/clear` mints a new sessionId in place), falls back to globbing `~/.claude/projects/*/<sessionId>.jsonl` (sessionIds are globally unique; dir-name encoding is lossy, never decode it). Tail-reads the last 256–512KB by byte offset (files reach 248MB locally), drops the first partial line, parses with an ignore-unknown-types/fields parser. Keeps: typed user prompts, assistant text deduped by `message.id` (one API message spans multiple JSONL lines), `filesTouched` from `toolUseResult.filePath`, latest `ai-title` (card label), `gitBranch`, latest `isCompactSummary` blob. Drops: thinking, raw tool_results, `attachment`/`deferred_tools_delta` spam, sidechains. Output capped ~16KB and framed explicitly as *quoted transcript data* (untrusted). Transcript byte size also feeds each station's context-window arc; `fs.watch` on the active jsonl gives live tool/file activity without polling full reads.

**File API.** `GET /api/files?root=<agent>` (tree), `GET /api/file?path=`, `PUT /api/file` — path-validated to known agent repo roots only, mtime conflict check on save. Serves FILE BAY; nothing fancier in v1.

**Frontend shell.** Vite 8 + React 19, strict TS. Cards are `react-rnd` windows (`dragHandleClassName="card-titlebar"`, `cancel=".xterm"` so dragging never hijacks terminal selection), zustand store for `{x,y,w,h}`, z-order (`bringToFront` on mousedown, stable React keys so xterm DOM never remounts), statuses — geometry persisted via zustand `persist` middleware to localStorage keyed by agent name and reconciled against live agents on load (drop geometry for agents that no longer exist — pairs with the boot registry reconcile), so a page reload never scatters the room. xterm 6 with WebGL addon by default (loaded after `term.open()`, `onContextLoss → dispose` → DOM-renderer fallback — canvas renderer no longer exists in v6). ResizeObserver + FitAddon, rAF-debounced. Token sheet defines the MOCR palette **plus the full 16-color ANSI xterm theme**, desaturated one notch and tinted toward the room (greens phosphor-leaning, blues/magentas muted) so Claude's output reads native inside the green console — plus the v6 `scrollbarSlider*` keys. Terminal-safety rule: **never animate a mounted xterm** — minimize keeps xterm mounted and the PTY attached, hides the wrapper with an instant `display:none`, and flies a snapshot/ghost div to the dock instead; restore is an instant un-hide (scrollback intact, zero reattach flicker). New cards auto-place into the first free grid slot that intersects neither THE PLOT's rect nor existing cards (cascade fallback). Attention ladder for needs-input (v1 rungs): card badge → telemetry-strip ACTN counter → clickable amber chip naming the waiting agent (when its card is minimized/covered). The amber edge chevron toward offscreen cards and the tab title `(1) MOCR` + amber favicon rungs are M6 polish, not v1-core.

**Agent-world renderer (THE PLOT).** Hybrid: DOM/SVG station nodes (clickable, CSS status glow) over ONE Canvas-2D rAF particle layer — pixi/three rejected; WebGL contexts are budgeted for terminals. Stations + glow + click ship with M2's status engine; the canvas layer and everything fed by pull events lands in M4. Header shows real counters: `THE PLOT — 4 STATIONS · 3 LINKS · 12 PULLS`. BASE reticle at center pulses on the real `/ws/events` heartbeat and goes honestly cold (desaturate to `--ink-ghost` over ~600ms) when the socket drops. On each context pull: a tracer flies caller→target with tail length scaled `log10(bytes)`, and the station-to-station dotted arc gains **+0.1 opacity (cap 0.6), decaying linearly over ~10 minutes** (the decay constant is a tunable — verified at 10s in dev) — edge heat turns the plot into a map of tonight's collaboration. Tool blips: PreToolUse hook events (tool name + file from `tool_input`) fade under the station label for 3s ("Edit src/routes/user.ts"); jsonl tailing covers richer detail later. A thin partial ring per station sweeps with estimated context usage from raw transcript size (`ctx:NN%` scrape-calibration is parked). Stations are the fleet switcher: click raises/restores the card; hover tooltip shows tmux session name, last activity, transcript size, pulls served/made, and **T+ elapsed since session spawn** (not server uptime). `P` key: full-canvas plot overlay that dims only the graticule and card chrome — never terminal content — dismissed by any keypress or card click.

---

## 2. Tech stack

| Package | Version | Why |
|---|---|---|
| tmux (brew) | 3.6b | The bridge; sessions outlive both UIs. **Not installed yet — step 0** |
| node (nvm) | 22.22.2 | Vite 8 engines `^20.19 \|\| >=22.12`; default 20.5.0 fails. `.nvmrc` = `22` |
| pnpm | 10.14.0 | Workspace; needs `onlyBuiltDependencies: [node-pty]` |
| typescript | 6.0.3 | Strict everywhere (pin `~5.9` only if `@types/*` friction appears) |
| @xterm/xterm | 6.0.0 | Terminal renderer; v6 = ESM build, new scrollbar (theme its `scrollbarSlider*` keys) |
| @xterm/addon-fit | 0.11.0 | v6-paired same-day release; cols/rows fitting |
| @xterm/addon-webgl | 0.19.0 | Default renderer for 4–6 live panes; DOM fallback on context loss |
| node-pty | 1.1.0 | tmux attach PTYs; darwin-arm64 prebuilds in tarball, N-API (no rebuild on Node switch) |
| express | 5.2.1 | HTTP + hook receiver + file API + MCP mount |
| ws | 8.21.0 | Binary pty frames + events channel, `noServer` upgrade routing |
| @modelcontextprotocol/sdk | 1.29.0 | StreamableHTTP MCP at `/mcp`; `registerTool` API (old `.tool()` deprecated) |
| zod | 4.4.3 | Tool schemas (SDK peer `^3.25 \|\| ^4` — 4.4.3 verified at runtime) |
| vite | 8.0.16 | Web dev server/build (rolldown-powered) |
| @vitejs/plugin-react | 6.0.2 | Peers on vite ^8 only |
| react / react-dom | 19.2.7 | UI |
| react-rnd | 10.5.3 | Drag+resize+bounds in one; React-19-safe (react-draggable 4.6.0 dropped findDOMNode) |
| zustand | 5.0.14 | Card geometry, z-order, agent statuses |
| @monaco-editor/react | 4.7.0 | FILE BAY; CDN loader = zero bundle/worker config |
| tsx | 4.22.4 | `tsx watch` server dev runner |
| concurrently | 10.0.3 | One `pnpm dev` for both packages |
| @types/node 22.x · @types/express 5.0.6 · @types/ws 8.18.1 | — | Match runtime |
| motion | 12.40.0 | Optional station entrance springs (sugar only) |
| @xterm/addon-web-links | 0.12.0 | Optional clickable URLs in Claude output |

Do **not** install `@xterm/addon-canvas` (peers on ^5; renderer removed in xterm 6) or `@dnd-kit/*` (no resize concept).

---

## 3. Repo layout & dev workflow

```
mission-control/
  .nvmrc                       # 22
  pnpm-workspace.yaml          # packages: web, server, shared · onlyBuiltDependencies: [node-pty]
  package.json                 # "dev": concurrently -n srv,web 'pnpm --filter server dev' 'pnpm --filter web dev'
  shared/src/
    protocol.ts                # WS frames: binary = server→client pty bytes ONLY; client→server = text (keys) + JSON {resize}; events = {status|plot-event|heartbeat}
    agents.ts                  # AgentStatus, AgentMeta, PullEvent, HookEvent (consumed as TS source via workspace:*)
  server/
    package.json               # postinstall: node scripts/fix-pty.mjs
    scripts/fix-pty.mjs        # chmod +x node-pty prebuilds/*/spawn-helper (locate via require.resolve)
    src/
      index.ts                 # express 5 + http server + ws noServer upgrade on /ws*
      tmux.ts                  # control plane: spawn/ls/kill/capture/inject — execFile, =mc-* targets only, NO `~` in any spawn argv
      registry.ts              # ~/.mission-control/agents.json — written at spawn, reloaded + reconciled vs `tmux ls` on boot
      relay.ts                 # node-pty attach per card; pty→ws binary down, ws text input up, debounced resize
      status/engine.ts         # hooks + pane_title/capture poll reconciler state machine
      status/markers.ts        # TUI regexes — pinned "verified against claude 2.1.173"
      status/hooks.ts          # POST /api/hooks receiver
      transcripts.ts           # registry resolve, byte-offset tail, extractContext, fs.watch
      mcp.ts                   # /mcp StreamableHTTP, list_agents / get_agent_context / send_to_agent
      files.ts                 # /api/files, /api/file (GET/PUT), repo-root scoped
      events.ts                # event bus → /ws/events fanout + 2s heartbeat
  web/src/
    app/                       # shell, telemetry strip, dock, attention ladder, auto-placement
    cards/                     # ConsoleCard (xterm 6 + rnd), zustand store (persist → localStorage)
    plot/                      # ThePlot: stations (M2), canvas layer, tracers, heat, arcs, tooltips, P-overlay (M4)
    filebay/                   # React.lazy Monaco panel
    theme/tokens.css           # MOCR tokens + full 16-color ANSI theme + scrollbarSlider* keys
  setup/
    mc-hooks.json              # hook template — server copies → ~/.mission-control/mc-hooks.json at boot if missing ({} stub fine in M1)
    register-mcp.mjs           # adds mission-control (+headersHelper) to ~/.claude.json — run with NO claude sessions open; writes .bak-mc backup
```

```sh
# one-time
brew install tmux                       # 3.6b — NOTHING tmux-related testable before this
nvm use 22 && nvm alias default 22      # 22.22.2 already installed
pnpm install                            # prebuilds ship in tarball; postinstall fixes spawn-helper +x
node setup/register-mcp.mjs             # user-scope MCP entry + headersHelper ONLY (hooks file is server-managed)
                                        # run with no claude sessions open — claude rewrites ~/.claude.json constantly

# daily
pnpm dev                                # srv: tsx watch (:4711) · web: vite (:5173, proxies /api + /ws ws:true)
open http://localhost:5173

# from Ghostty, anytime — the whole point
tmux attach -t mc-sphere-web
```

---

## 4. Milestones

### M0 — UPLINK (the spine)
**Goal:** one hardcoded tmux session → node-pty → ws → one xterm card, mirrored in a real terminal.
- `brew install tmux`; nvm 22 + `.nvmrc`; scaffold workspace with `onlyBuiltDependencies` + spawn-helper chmod postinstall.
- Spawn one session by hand: `tmux new-session -d -s mc-test -c ~/Documents/GitHub/sphere-web -x 220 -y 50 /Users/Saurav/.local/bin/claude`; apply the terminal-features RGB / history-limit globals.
- Server: node-pty `tmux attach-session -t =mc-test`, binary frames server→client over `/ws/term/mc-test`, keyboard input as text frames, JSON resize → `pty.resize()`.
- Web: one fixed-position xterm 6 card (WebGL addon after `open()`, `onContextLoss` fallback wired), FitAddon + rAF-debounced ResizeObserver → resize message.
- Dumb WS reconnect from day one: on socket close, grey the card with plain "LINK LOST" text and retry every 1–2s — the tmux reattach redraw repaints the terminal for free. (`tsx watch` restarts the server on every save; without this, M1–M5 dev means frozen cards.) Backoff tuning and the polished state stay in M6.
**Acceptance:** type a prompt in the browser card, Claude answers; `tmux attach -t mc-test` in Ghostty shows the identical screen live; resizing the card resizes the session (`window-size latest`), and typing in Ghostty snaps it back; stop/restart the server → the card greys to LINK LOST, then repaints itself when the socket reopens.
**Demo moment:** the same Claude session alive in two universes at once.

### M1 — CONSOLES (the fleet)
**Goal:** spawn/list/kill agents from the UI; cards become real MOCR windows; the fleet survives server restarts.
- Control-plane API: spawn (locked command incl. `--session-id <uuid>`, absolute `--settings` path, `-e` env tags, `\; set-option remain-on-exit on` + `status off` chained atomically, first-spawn globals chained before new-session), list via `list-panes -a -F '#{session_name}\t#{pane_dead}'` + JS `mc-` filter (substituted for the planned `list-sessions -f` form — one call yields pane_dead too; exit 1 = zero sessions), kill; spawn dialog with repo path + agent name.
- Spawn error path: validate the repo path server-side (`fs.stat`) before spawning; surface tmux's stderr in the spawn dialog on nonzero exit; one post-spawn `has-session` + `pane_dead` poll (~1s) catches instant death → plain "agent died on launch" card state (the full EXITED badge is M2).
- Registry persistence: write `~/.mission-control/agents.json` at spawn (`{agent, sessionId, repoDir, spawnedAt}`); on server boot, reload it and reconcile against `tmux ls -f '#{m:mc-*,#{session_name}}'` — adopt surviving sessions, drop entries with no session (free dead/stale-session cleanup). `tsx watch` restarts the server on every save; without this, live agents become orphans and M2's hook mapping breaks. This is *not* the parked attach-everything mode — only mc-* sessions this server spawned are re-adopted.
- Server boot ensures `~/.mission-control/mc-hooks.json` exists (copied from `setup/mc-hooks.json`, or a `{}` stub until M2 finalizes the template) so the locked `--settings` argv is valid from M1 onward.
- react-rnd cards: title-bar-only drag, `cancel=".xterm"`, zustand geometry/z-order committed on drag/resize-stop, stable keys; layout persisted (zustand `persist` → localStorage keyed by agent name) and reconciled against live agents on load.
- Dock + minimize/restore per the terminal-safety rule: xterm stays mounted and the PTY stays attached; the wrapper hides with an instant `display:none` while a snapshot/ghost div does the fly-to-dock animation. Scrollback survives because the buffer never dies — and restore has zero reattach flicker.
- `theme/tokens.css`: MOCR palette + full desaturated/tinted 16-color ANSI theme + scrollbarSlider keys. Bundle IBM Plex Mono + JetBrains Mono as local woff2 (`@font-face`, `font-display: swap`) — M0 shipped system-font fallbacks only.
- Reserve THE PLOT's panel rect (static graticule placeholder — stations arrive in M2) and implement keep-out auto-placement so new cards never spawn under it.
**Acceptance:** spawn 3 agents in 3 repos from the UI; drag/resize/overlap/minimize/restore without losing scrollback; restart the server while the 3 run → all 3 reappear as agents with correct repos (statuses recover once M2 lands); spawn with a bogus path shows an error in the dialog, not a ghost card; a full page reload restores the card layout; kill removes the session from `tmux ls`; Claude's colored output looks native in the green room.
**Demo moment:** four phosphor consoles overlapping on one dark screen, each a live Claude — and the server can die without the fleet noticing.

### M2 — GO / NO-GO (status engine + the fleet goes on the map)
**Goal:** trustworthy live badges, an attention system that never lets a waiting agent hide, and THE PLOT's first life.
- Finalize `~/.mission-control/mc-hooks.json` (curl pattern with `-m 2 -o /dev/null || true`) — the stub has existed since M1 and spawns already pass `--settings`; `POST /api/hooks` maps `session_id`→agent via the persisted registry (realpath cwd sanity check). The file is immutable at runtime: the reconciler stats its mtime and shows "HOOKS STALE — respawn agents" in the telemetry strip if it changed while agents are up (claude suspends settings-file hooks mid-session otherwise — silently).
- 2s reconciler: capture-pane regexes from `markers.ts`, `pane_dead`/`has-session`, `~/.claude/sessions/<pid>.json` cross-check, **and the `#{pane_title}` braille first-codepoint check** via `display-message -p -t =mc-<agent> '#{pane_title}'` — tmux eats the OSC 0/2 title and re-emits nothing to attached clients with `set-titles` off, so the busy bit is polled here, never sniffed in the relay stream; precedence + 2-poll running→idle downgrade.
- Badges on cards + statuses to `/ws/events`; EXITED state + restart button: `respawn-pane -k -t =mc-<agent>` with an **explicit fresh command** (new `--session-id <uuid>`, same absolute `--settings`) — never the bare form, which replays the original argv and a uuid that already has a transcript (claude refuses, and the hook mapping would point at the dead session); update `agents.json` + the hook mapping to the new uuid.
- THE PLOT, first life: DOM/SVG station nodes appear for live agents with status-colored CSS glow; clicking a station raises/restores its card. Cheap (DOM + CSS, no canvas) and a second consumer of `/ws/events` that hardens the status work. Tracers/heat/counters need M3's pull events → M4.
- Attention ladder (v1 rungs only): strip ACTN counter + clickable amber chip naming the waiting agent when its card is buried/minimized. Edge chevron and tab-title/favicon rungs move to M6 polish.
**Acceptance:** permission prompt flips the badge visibly instantly — before the permission dialog finishes rendering, vs the ~4s poller path (hook-received→broadcast latency logged server-side to confirm the <300ms budget); Esc-interrupt downgrades to idle within ~4s (poller); `kill -9` the claude → EXITED badge; the restart button respawns with a fresh session id and the restarted agent's badge goes running on its next prompt (proves the new mapping); stations appear/disappear with spawn/kill, glows track the badges, and clicking a station raises its card; with the waiting card minimized, the ACTN counter + chip fire and clicking the chip surfaces the card.
**Demo moment:** the center of the room shows the fleet glowing with live status — glance at it and know exactly who needs you.

### M3 — CROSSLINK (cross-agent context)
**Goal:** any Claude session on the machine can read any agent's mind and message it.
- Mount `/mcp` (stateful transport map, 404 on unknown session id, DNS-rebinding protection, instructions string).
- `transcripts.ts`: registry resolution (re-resolve every call), sessionId glob fallback, byte-offset tail, ignore-unknown parser, `message.id` dedupe, context shape (prompts, assistant text, filesTouched, ai-title, gitBranch, compactSummary, optional projectMemory), ~16KB cap, quoted-data framing.
- Tools: `list_agents`, `get_agent_context` (self-exclusion via X-MC-Cwd/X-MC-Agent), `send_to_agent` (status gate + dialog sniff + `force`, loop-marker prefix, buffer-paste path).
- `setup/register-mcp.mjs`: user-scope entry + headersHelper into `~/.claude.json` — claude rewrites that file constantly, so the script prints "run with no claude sessions open", does a tight read-modify-write, and saves a timestamped backup (`~/.claude.json.bak-mc`) first (verify with a dotted repo path that dir-encoding matches).
- `@agent` UI sugar: typing `@sphere-web …` in a card injects via `load-buffer`/`paste-buffer -p -d`, then `send-keys Enter` after a tunable ~300ms constant.
- Every `get_agent_context` emits a pull event with byte count to the event bus.
**Acceptance:** from a *plain Ghostty* claude session in an unrelated repo, `mcp__mission-control__get_agent_context("sphere-web")` returns a real excerpt naming files the agent actually touched; calling it from sphere-web itself returns "that's you"; `@sphere-api fix the failing test` lands as a bracketed paste and submits; `send_to_agent` refuses while the target shows a permission dialog; the `mcpServers` entry survives the next claude launch (no lost update).
**Demo moment:** one agent quotes another agent's work back to you, unprompted plumbing invisible.

### M4 — THE PLOT (the centerpiece comes alive)
**Goal:** the stations (live since M2) become a real map of tonight's collaboration — canvas, tracers, heat, telemetry.
- Canvas-2D rAF particle layer slides under the M2 station nodes; stations reposition around the BASE reticle.
- BASE heartbeat: pulse on real `/ws/events` heartbeat; on 2 missed beats desaturate to `--ink-ghost` over ~600ms (and recover on reconnect).
- Pull tracers (quadratic bezier, additive `lighter` compositing) with tail length ∝ `log10(bytes)`; edge heat +0.1 opacity per pull, cap 0.6, linear decay — the decay constant is a tunable (env var / dev-only query param), default ~10min.
- Tool blips from PreToolUse events, 3s fade under station labels; context-window arc per station from raw transcript size (`ctx:NN%` scrape-calibration is parked).
- Header counters (STATIONS · LINKS · PULLS — all real); hover tooltip (tmux name, last activity, transcript size, pulls served/made, T+ since spawn) — stations are already clickable from M2.
- `P` full-canvas overlay (dims graticule + card chrome only, never terminal content; any key/card click dismisses).
**Acceptance:** trigger a context pull between two agents → tracer flies, edge heats, PULLS increments; with decay tuned to 10s the idle edge visibly cools (ship default stays ~10min); kill the server → BASE goes cold honestly; tooltips show real telemetry.
**Demo moment:** after an evening's work, THE PLOT *is* the story of which agents talked to whom.

### M5 — FILE BAY (Monaco)
**Goal:** read and patch files without leaving the room.
- `files.ts` endpoints, strictly scoped to spawned agents' repo roots; file tree per selected agent.
- `React.lazy` Monaco panel (CDN loader — zero bundle/worker config), theme derived from the token sheet, mtime conflict check on save.
**Acceptance:** open a file an agent just edited (from its filesTouched), tweak it, save; the agent's next read sees the change; the panel costs 0 bytes until opened.
**Demo moment:** fix the typo yourself while the agent keeps flying.

### M6 — FLIGHT QUAL (hardening + polish)
**Goal:** cold-start-proof, pleasant, documented.
- Reconnect, polished: backoff tuning + events-channel edge cases + styled LINK LOST card state (the dumb 1–2s retry has shipped since M0); server kept long-running (MCP clients only auto-reconnect mid-session — a session that *started* with the server down needs manual `/mcp` retry; document this).
- Attention-ladder upper rungs: amber edge chevron pointing at offscreen cards; tab title `(1) MOCR` + amber favicon when the browser tab is unfocused.
- Marker-calibration note + quick recipe for re-verifying `markers.ts` against new claude versions; right beside it, document the mc-hooks.json-is-immutable rule and the "HOOKS STALE — respawn agents" warning; tune the Enter-delay constant live.
- Auto-placement edge cases, dock overflow, motion pass under design tokens; **stretch:** FILM scanline toggle (one div, off by default — first thing cut if time is tight).
- README (setup, the tmux promise, hook/MCP wiring), `setup/` idempotency (re-runs don't duplicate `~/.claude.json` entries), `pnpm -r typecheck` + build verified.
**Acceptance:** from zero (no tmux server running, fresh clone): `brew install tmux && pnpm install && node setup/register-mcp.mjs && pnpm dev` → spawn a fleet → every M0–M5 acceptance still passes; `kill -9` + restart-from-card works.
**Demo moment:** it stops feeling like a project and starts feeling like a console you own.

### Parked (v2 — explicitly not now)
- **Attach-everything mode**: adopting non-mc tmux/claude sessions as stations (registry + headersHelper already make it feasible; M1's boot reconcile deliberately re-adopts only mc-* sessions the server itself spawned).
- Remote access (Tailscale etc.) and any auth — v1 is 127.0.0.1-only by design.
- LLM summarization in `get_agent_context` (`summarize: true` via `claude -p --model haiku`; remember sdk-cli transcript self-pollution → filter `entrypoint === "cli"`).
- Read-only spectate attach (`tmux attach -r`).
- Monaco fully-offline bundling (`loader.config({ monaco })` + `?worker` setup).
- Subagent visualization on THE PLOT (SubagentStart/Stop hooks already carry the data).
- `~/.claude/history.jsonl` quick "recent prompts per repo" feed.
- `prefers-reduced-motion` variant (instant edge flashes, steady-amber pings, ticker lines) — cut unless that OS setting is actually in use.
- `ctx:NN%` scrape-calibration of the context-window arc (v1 ships the raw transcript-size estimate).
- FILM scanline toggle, if cut from M6.

---

## 5. Risks & gotchas (merged, deduped)

| # | Gotcha | Mitigation |
|---|---|---|
| **Environment** | | |
| 1 | tmux NOT installed; nothing tmux-related smoke-testable until then | `brew install tmux` (3.6b) is literally step 0 of M0 |
| 2 | Node 20.5.0 fails Vite 8 engines | `nvm use 22` (22.22.2 installed), `.nvmrc`, `nvm alias default 22` |
| 3 | pnpm 10 blocks dependency lifecycle scripts → cryptic node-pty failures | `onlyBuiltDependencies: [node-pty]` in pnpm-workspace.yaml |
| 4 | node-pty 1.1.0 darwin-arm64 `spawn-helper` installs mode 644 → `posix_spawnp failed` (verified) | postinstall `fix-pty.mjs`: chmod +x, path via `require.resolve` (dodges `.pnpm` layout) |
| **tmux** | | |
| 5 | `-t mc-sphere` prefix-matches `mc-sphere-web`; AND bare `=mc-<name>` fails on *pane/window*-target commands (`capture-pane`, `display-message`, `send-keys`, `respawn-pane`) with "can't find pane" — verified live on tmux 3.6b | session-target commands (`has-session`, `attach-session`, `kill-session`) use `=mc-<name>`; pane/window-target commands use `=mc-<name>:` (trailing colon = exact session, default window.pane); enforced in `tmux.ts`. Bonus: quote `=mc-…` in any zsh examples — unquoted `=word` is zsh filename expansion |
| 6 | `resize-window` permanently flips the window to `window-size manual` | size flows only through `pty.resize()` (normal client SIGWINCH) |
| 7 | Arg that is/ends with `;` splits into a second tmux command — even via execFile | inject text via `load-buffer -` + `paste-buffer -p -d`; never interpolate into send-keys (the spawn command *exploits* this deliberately: a lone `;` token chains `set-option` onto `new-session`) |
| 8 | Enter in the same burst as text becomes a newline inside Claude's input box | separate `send-keys Enter` after a tunable ~300ms constant |
| 9 | Session dies the instant claude exits → crashed agents vanish from `ls`; applying `remain-on-exit` in a *second* tmux command loses the race against instant exits | `remain-on-exit on` chained via `\;` into the same invocation as `new-session`; poll `pane_dead`/`pane_dead_status`; restart via `respawn-pane -k` with explicit fresh argv |
| 10 | `tmux ls` exits 1 when no server is running | treat nonzero as zero sessions; never pre-start — first `new-session -d` auto-starts |
| 11 | tmux server inherits env from its first client; PATH is a gamble | absolute `/Users/Saurav/.local/bin/claude` in new-session; per-agent env via `-e` |
| 12 | No shell anywhere in the spawn chain — `execFile` + tmux 3.4+ run multi-arg commands directly (no `sh -c`) — so `~` reaches claude literally and `--settings ~/…` dies loudly ("Settings file not found") or kills hooks silently | `tmux.ts` rule: **no `~` in any spawn argv**; settings path built with `path.join(os.homedir(), '.mission-control', 'mc-hooks.json')` |
| 13 | Bare `respawn-pane -k` reruns the pane's *original* argv — a `--session-id` that already has a transcript, which claude refuses (and the hook mapping would point at the dead session) | restart passes an explicit fresh command with a NEW `--session-id <uuid>`; update `agents.json` + hook mapping |
| 14 | tmux consumes the inner program's OSC 0/2 title into `#{pane_title}` and re-emits nothing to attached clients (`set-titles` off by default; even on, clients get the expanded `set-titles-string`) | never sniff titles in the relay byte stream; the 2s reconciler polls `display-message -p '#{pane_title}'` and does the braille check there |
| 15 | node-pty clients (`TERM=xterm-256color`) get no truecolor by default | `tmux set -as terminal-features ',xterm-256color:RGB'` at first spawn |
| 16 | Two attached clients fight over size; redraw byte-storms on flips | `window-size latest` (most-recent-activity client wins); xterm absorbs redraws fine |
| **Status** | | |
| 17 | "esc to interrupt" appears ZERO times in claude 2.1.173 — classic recipes dead; markers WILL drift | current spinner/dialog regexes pinned in `markers.ts` with version comment; hooks are primary so drift degrades gracefully; recalibrate per claude upgrade |
| 18 | Stop hooks don't fire on Esc-interrupt → stuck "running" | poller downgrades running→idle after 2 consecutive idle-looking polls |
| 19 | First-run folder-trust dialog fires NO Notification hook | poller's `I trust this folder` regex catches it |
| 20 | UserPromptSubmit hook stdout is injected into Claude's context; nonzero exits print stderr into the transcript; exit 2 blocks | every hook ends `-o /dev/null 2>/dev/null \|\| true`; `-m 2` curl timeout |
| 21 | Hook `timeout` field is SECONDS (default 600) | never set millisecond-looking values |
| 22 | Hook `cwd` arrives realpath-resolved (`/tmp`→`/private/tmp`) | compare against `fs.realpathSync(repoDir)` |
| 23 | Saurav's `~/.claude/settings.json` already has 5 hook arrays | never touch it — `--settings /Users/Saurav/.mission-control/mc-hooks.json` scopes hooks per spawn (flag verified working) |
| 24 | Stop payload field is `last_assistant_message`, not docs' `assistant_message` | code to the observed name |
| 25 | `❯` stays visible while busy; raw pty bytes interleave escapes mid-word | idle = absence of spinner AND dialog; regex only `capture-pane -p` rendered text; the busy-spinner title comes from the `#{pane_title}` poll, never from raw bytes |
| 26 | `PermissionRequest` doesn't fire in `-p` mode | don't unit-test needs-input with headless claude |
| 27 | claude snapshots hook config at session start; editing mc-hooks.json while agents run suspends ALL settings-file hooks for those sessions ("Hooks from settings files are suspended…") — silent poller-only degradation | treat mc-hooks.json as immutable at runtime; reconciler stats its mtime → "HOOKS STALE — respawn agents" in the telemetry strip; documented in the M6 README beside the marker recipe |
| 28 | `tsx watch` restarts the server on EVERY server-file save; an in-memory-only registry orphans live mc-* sessions and breaks `session_id`→agent mapping mid-evening | `~/.mission-control/agents.json` written at spawn; boot reload + reconcile vs `tmux ls` (adopt survivors, drop dead entries — free stale-session cleanup); dumb WS reconnect from M0 |
| **Transcripts** | | |
| 29 | Dir-name encoding is lossy (hyphen collision); `.`/`_` munging was only verified empirically | never decode dir names; encode + exact-match, or glob `*/<sessionId>.jsonl` (bulletproof); re-verify with a dotted repo path in M3 |
| 30 | Transcripts reach 248MB locally | tail-read last 256–512KB by byte offset; `fs.watch` for live updates; never readFile whole |
| 31 | `~/.claude/sessions/<pid>.json` goes stale after SIGKILL | verify liveness with `process.kill(pid, 0)` before trusting |
| 32 | `/clear` / `--resume` mints a NEW sessionId in the same PID | re-resolve sessionId from the registry on every fetch; never cache |
| 33 | `lsof` can't find the active transcript (open/append/close per write) | don't try; use registry + glob |
| 34 | Sessions started in repo subdirs land in different project dirs | prefix-match `encode(repoPath)` for historical scans |
| 35 | One assistant message spans multiple JSONL lines | dedupe by `message.id` |
| 36 | `attachment`/`deferred_tools_delta` lines are huge | skip in the parser or the 16KB budget dies |
| 37 | Schema is internal/unversioned (fields added 2.1.143→2.1.173) | ignore-unknown-types/fields parser, tolerate unparseable lines |
| 38 | ~30-day default transcript cleanup | no features assume long history; heat/arcs use live data only |
| 39 | Transcript content is untrusted (injection-looking text observed) | `get_agent_context` frames output explicitly as quoted transcript data |
| 40 | MC's own future `claude -p` calls would write sdk-cli transcripts into the same dirs | v1 has no LLM pass; if added, filter `entrypoint === "cli"` / registry `kind === "interactive"` |
| **MCP** | | |
| 41 | `send_to_agent` keystrokes can ACCEPT a permission prompt | refuse when status = needs-input unless `force:true`; sniff capture-pane for dialog markers first |
| 42 | Server down at *session start* → that session marks MCP failed; only mid-session drops auto-reconnect | keep the server long-running; document manual `/mcp` retry; restart rarely |
| 43 | After server restart, clients send stale `Mcp-Session-Id` | return **404** (not 400) so the StreamableHTTP client re-initializes |
| 44 | Unset `${VAR}` without default passes through as the literal string | always `${VAR:-default}` in config/headers |
| 45 | `claude mcp add` has no headersHelper flag; `~/.claude.json` is claude's main mutable state file, rewritten constantly — concurrent edits lose updates in either direction | `register-mcp.mjs` edits `mcpServers` directly: prints "run with no claude sessions open", tight read-modify-write, timestamped `~/.claude.json.bak-mc` backup, idempotent; re-verify the entry after the next claude launch |
| 46 | `allowedHosts` is exact-string match including port; Claude sends `Host: 127.0.0.1:4711` | list both `127.0.0.1:4711` and `localhost:4711` |
| 47 | ToolSearch defers MCP tools — undiscovered without strong instructions | load-bearing `instructions` string (<2KB) + crisp tool descriptions; (Haiku has no tool search) |
| 48 | Project-scope `.mcp.json` sits at "Pending approval" per repo | user scope only |
| 49 | Cross-agent echo loops (A tells B "reply to A"…) | `[mission-control from <agent>]` prefix + loop warning in tool description |
| **Frontend** | | |
| 50 | xterm 6 removed the canvas renderer; `addon-canvas` peers on ^5; scrollbar rewritten | WebGL default → `onContextLoss → dispose` → DOM fallback; never install addon-canvas; set `scrollbarSlider*` theme keys; distrust 5.x blog snippets |
| 51 | Dragging can hijack terminal selection/scroll; z-reorder can remount xterm | `dragHandleClassName="card-titlebar"` + `cancel=".xterm"`; commit geometry on stop only; stable keys |
| 52 | Animating a mounted xterm during minimize corrupts/charges the renderer; unmount-and-reattach empties xterm's scrollback (tmux only holds it for copy-mode, not the card's scroll wheel) | never animate the live card: minimize hides it with instant `display:none` (xterm stays mounted, PTY attached) and animates a snapshot/ghost div to the dock; restore is an instant un-hide — buffer intact, no flicker |
| 53 | node-pty `IPty.write` takes a string — decoding WS *binary* keyboard frames with `Buffer.toString('utf8')` corrupts input if a multibyte sequence splits across frames | keyboard input client→server rides WS **text** frames (xterm `onData` is already a string); binary frames are server→client pty bytes only; asymmetry documented in `shared/src/protocol.ts` |
| 54 | Express 5 / path-to-regexp v8: bare `*` routes throw; `req.query` read-only | `'/*splat'` catch-alls; ws via `noServer` + manual upgrade routing |
| 55 | ResizeObserver fires per-frame during drag → pty.resize/redraw storms | rAF-debounce fit + ~120ms server-side resize debounce |
| 56 | Monaco CDN loader needs internet | acceptable for v1; offline bundling parked |
| 57 | Vite proxy silently drops WS without `ws: true` | `'/ws': { target, ws: true }` in vite.config |
| 58 | WebGL context budget (~16/page) | 4–6 terminal contexts fine; PLOT uses Canvas-2D, not WebGL |
| 59 | MCP server name `workspace` is reserved | name is `mission-control` (verified free in `~/.claude.json`) |

---

## 6. Decisions log

| Decision | Why |
|---|---|
| tmux as the session substrate, default socket | `tmux attach -t mc-<name>` from bare Ghostty with zero flags is the core promise |
| Plain `attach-session` inside node-pty, one PTY per web card | tmux does redraw/snapshot, xterm renders bytes; `-CC` would mean reimplementing a renderer, `pipe-pane` has no input/redraw |
| claude as direct-argv session command + `remain-on-exit on` chained via `\;` | no `sh -c` quoting layer — which also means **no `~` expansion; every spawn path is absolute** (tmux.ts rule); remain-on-exit lands atomically with new-session, so even instant crashes leave a visible pane for the EXITED badge + fresh-argv `respawn-pane -k` restart |
| Server-generated `--session-id <uuid>` at spawn, persisted to `~/.mission-control/agents.json` | deterministic transcript path and hook `session_id`→agent mapping; no mtime guessing; boot reload + `tmux ls` reconcile means `tsx watch` restarts never orphan live sessions |
| Hooks via `claude --settings /Users/Saurav/.mission-control/mc-hooks.json` (absolute, server-ensured at boot, immutable at runtime) | scopes status events to mc sessions only; zero contact with Saurav's existing 5 user-scope hook arrays (flag verified live); claude snapshots hook config at start, so runtime edits silently suspend hooks — hence the mtime watch + "HOOKS STALE" warning |
| Status = hooks primary, capture-pane + `#{pane_title}` poll as reconciler | hooks are instant + structured; tmux consumes OSC 0/2 titles into `#{pane_title}` and re-emits nothing with `set-titles` off, so the braille busy bit is *polled* via `display-message`, never sniffed in-stream; poller covers the 3 verified hook blind spots (Esc-interrupt, trust dialog, death) |
| Poller may downgrade running→idle only after 2 idle polls | hooks keep winning fast edges; no flicker |
| Size via `window-size latest` + `pty.resize()` only | most-recently-active client wins; `resize-window` silently breaks it forever |
| Injection via `load-buffer -` + `paste-buffer -p -d`, Enter ~300ms later | immune to semicolon/quoting footguns; correct with the TUI's bracketed paste; Enter-in-burst gets swallowed |
| WS asymmetry: binary = server→client pty bytes only; keyboard input = text frames | `IPty.write` takes a string; binary input frames could split a multibyte sequence — the xterm-onData-is-a-string invariant is now written down in protocol.ts |
| Dumb WS reconnect (grey card, 1–2s retry) ships in M0, polish in M6 | tmux attach replays a full redraw, so reconnect is nearly free; `tsx watch` kills every socket on every save — without it, months of frozen-card evenings |
| MCP = SDK 1.29.0 StreamableHTTP at `/mcp` on the same Express app, stateful, 404 on unknown session | exact pattern ran end-to-end against a real Claude client during research; 404 makes clients re-init after restarts |
| Caller identity via user-scope `headersHelper` (X-MC-Cwd, X-MC-Agent) | verified to inherit caller cwd/env; enables self-exclusion and identifies non-mc terminal sessions |
| No auth on localhost MCP; bind 127.0.0.1 + DNS-rebinding protection | verified Claude sends no credentials; OAuth only triggers on 401/403; rebinding is the whole local threat model |
| `get_agent_context` returns structured raw tail, no LLM pass | the consumer is a Claude session — it summarizes better itself; deterministic, free, instant |
| Live-session resolution via `~/.claude/sessions/<pid>.json`, re-resolved every call | verified registry; `/clear` mints new sessionIds, caching would serve stale transcripts |
| xterm 6 + WebGL default, DOM fallback | canvas renderer no longer exists in v6; Nocturne's position adopted: WebGL is the default for 4 live panes |
| Full 16-color ANSI theme in the token sheet, desaturated + room-tinted | MOCR's biggest hierarchy risk — Claude output must look native inside the green console |
| react-rnd 10.5.3 + zustand 5.0.14 for windows, layout persisted to localStorage | verified React-19-safe; dnd-kit has no resize; hand-rolled kept as fallback only; persistence means reloads never scatter the room |
| THE PLOT = DOM/SVG stations + one Canvas-2D rAF layer; **stations ship in M2, canvas in M4** | WebGL contexts are budgeted for terminals; pixi/three overkill; station nodes need only M2's status engine (DOM + CSS glow, cheap) and double as a second `/ws/events` consumer — the visual centerpiece is alive from M2, not five milestones in; tracers/heat genuinely need M3's pull events |
| Edge heat (+0.1/pull, cap 0.6, ~10min decay, constant tunable) over 30s residual edges | 30s is too ephemeral; heat makes THE PLOT a real map of tonight's collaboration; tunable decay so the acceptance check is verifiable at 10s |
| Tracer tail ∝ log10(bytes) | the MCP server already knows payload size; big pulls should visibly carry more |
| Tool blips from PreToolUse hooks (jsonl tail as later fallback) | hook payload already carries tool_name + tool_input on the existing channel; highest-value real-state signal on the plot |
| Per-station T+ since spawn (not server-uptime MET) | mission-elapsed-time per agent is meaningful telemetry; server uptime is not |
| Never animate a mounted xterm (ghost-div minimize, instant `display:none`); honest BASE heartbeat; PLOT keep-out placement; clickable stations from M2 | grafted terminal-safety and honesty rungs that complete MOCR's design — and minimize keeps the live buffer, so scrollback survives for real |
| Attention ladder v1 = badge + ACTN counter + chip; chevron/favicon/tab-title → M6; reduced-motion variant + `ctx:NN%` calibration → parked | single-user localhost app — delight matters, enterprise rigor does not |
| v1 = consoles + status + crosslink + plot + file bay; everything else parked | keep it honest and shippable; delight over enterprise rigor |

