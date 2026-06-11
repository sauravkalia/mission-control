# Mission Control — Design

**MOCR** (pronounced "mocker") — the room at JSC where Apollo was flown. You open one dark browser tab and you are FLIGHT. Four agents are four console stations, each with a callsign in steady phosphor green: `SPHERE-WEB`, `API-CORE`, `DOCS-BOT`, `TEST-RIG`. Each station is a real `claude` process inside a real tmux session — drag it, resize it, or `tmux attach` from iTerm and it's the *same* console. Between the windows sits THE PLOT: a ground-track display where your agents orbit a central BASE hub, and when one agent pulls context from another you *see* it — a phosphor tracer arcs across the plot, the hub pulses, the receiving station flashes, and the edge between them gets warmer. Nothing here is decorative theater: every light is a status, every arc is real bytes, every edge is a real MCP call, every blip is a real `tool_use`. When an agent needs you, an amber annunciator pulses calmly and goes quiet the moment you click in, like acknowledging a master alarm. Four missions at once from a quiet, competent room in 1969, except the spacecraft are repos.

---

## 1. Design tokens

### Palette

| Token | Hex | Use |
|---|---|---|
| `--bg-void` | `#050807` | Canvas base (near-black, faint green cast) |
| `--bg-panel` | `#0A0F0C` | Docked panels, THE PLOT, dock strip |
| `--bg-card` | `#0C1310` | Window body |
| `--bg-titlebar` | `#101814` | Title bars, telemetry strip |
| `--bg-raised` | `#141D18` | Buttons, hover surfaces |
| `--bg-term` | `#040605` | xterm background (darkest thing on screen) |
| `--line-dim` | `#1B2520` | Hairlines, dividers |
| `--line` | `#28342D` | Default card border |
| `--line-bright` | `#3D4F45` | Hover border |
| `--ink-hi` | `#D9E5DC` | Primary text (phosphor white) |
| `--ink-mid` | `#93A89B` | Secondary text, repo paths, live readouts |
| `--ink-low` | `#5B6E62` | Tertiary, timestamps, session suffixes |
| `--ink-ghost` | `#38463E` | Disabled, grid labels, resize ticks, cold BASE — decoration only, never text you read |
| `--phos-green` | `#51F08A` | Primary accent, focus, GO, tracers |
| `--phos-green-dim` | `#2E8F55` | BASE hub, orbit rings, quiet green |
| `--phos-amber` | `#FFB000` | Attention, ACTN, @-mention tracers |
| `--flash-white` | `#BFFFD6` | 120ms arrival flashes only |

### Status colors (annunciator system)

| Status | Token | Label | Hex | Meaning |
|---|---|---|---|---|
| running | `--st-go` | `GO` | `#51F08A` | Output flowing (see §5 detection) |
| needs-input | `--st-actn` | `ACTN` | `#FFB000` | Claude waiting at a prompt/permission |
| idle | `--st-stby` | `STBY` | `#6F8378` | At prompt, quiet > 15s |
| dead | `--st-los` | `LOS` | `#FF4D3D` | tmux session gone (loss of signal) |

### xterm theme — Claude's output must look native to the room

Full 16-color theme, desaturated one notch from stock and tinted toward the console: greens pulled toward phosphor, blues/magentas muted and warmed so spinners, links, and diff colors don't punch a hole in the green room. This is the biggest hierarchy risk in the whole design; ship these exact values.

```ts
export const mocrTermTheme = {
  background: '#040605',
  foreground: '#D7E2DA',
  cursor: '#51F08A',
  cursorAccent: '#040605',
  selectionBackground: 'rgba(81, 240, 138, 0.22)',
  black: '#121A15',          brightBlack: '#5B6E62',
  red: '#E06055',            brightRed: '#FF6F61',
  green: '#4DC97D',          brightGreen: '#6FE8A0',
  yellow: '#D9B25C',         brightYellow: '#EFC97E',
  blue: '#6E9ECF',           brightBlue: '#8FB8E0',
  magenta: '#B48EC7',        brightMagenta: '#CDA8DE',
  cyan: '#56BFAE',           brightCyan: '#79D9C6',
  white: '#B9C7BD',          brightWhite: '#E8F2EA',
} as const;
```

`foreground` sits one notch under `--ink-hi` so terminal copy reads perfectly but chrome callsigns still lead. `background` is exactly `--bg-term` — zero seam against the card well.

### Typography — all mono, that's the instrument soul

| Role | Stack | Size / weight |
|---|---|---|
| UI, labels, callsigns | `"IBM Plex Mono", "JetBrains Mono", ui-monospace, "SF Mono", monospace` | 12px/400; callsigns 12px/600 uppercase, `letter-spacing: 0.08em` |
| Micro labels (badges, plot labels) | same | 10px/500 uppercase, `letter-spacing: 0.1em` |
| Terminal (xterm) | `"JetBrains Mono", "SF Mono", Menlo, monospace` | 13px, line-height 1.35 |
| Mission clock | IBM Plex Mono | 15px/500, `font-variant-numeric: tabular-nums` |
| Repo paths, ticker, tool blips | IBM Plex Mono | 11px/400; blips 9px/500 |

Bundle IBM Plex Mono + JetBrains Mono as local woff2 (both OFL). No display font, no serif — restraint is the homage.

### Spacing / radii / shadows

- **Spacing scale:** `2, 4, 8, 12, 16, 24, 32, 48` px. Cards snap (optional) to the 48px graticule.
- **Radii:** cards/panels `4px`; badges/buttons `2px`; terminal viewport `0`; plot nodes are circles. Mission hardware is rectangular — never exceed 6px.
- **Shadows:** card `0 12px 32px rgba(0,0,0,.55), 0 2px 8px rgba(0,0,0,.5)`.
- **Glows (small elements only):** green `0 0 8px rgba(81,240,138,.35)`; amber `0 0 10px rgba(255,176,0,.40)`; focused-card halo `0 0 14px rgba(81,240,138,.12)`. Text glow on clock/callsigns: `text-shadow: 0 0 6px rgba(81,240,138,.25)`. No `filter: blur` anywhere.

---

## 2. The desktop canvas

The canvas is a **ground-track chart**: `--bg-void` with a graticule — minor lines every 48px at `rgba(81,240,138,.035)`, major lines every 240px at `rgba(81,240,138,.07)`, and a small `+` registration crosshair at each major intersection at `rgba(81,240,138,.05)`. A radial vignette darkens edges ~8% so the room feels lit from the consoles.

**FILM toggle** (top strip): a fixed `pointer-events:none` overlay of 1px scanlines at 2.5% opacity + faint phosphor bloom on `--phos-green` text. Off by default. **Cut from v1 if time is tight** — it is the only purely cosmetic feature in this spec; everything else is telemetry.

The **telemetry strip** (36px, full width, `--bg-titlebar`, hairline bottom border) is what makes it read as mission control before a single window opens: `MOCR · MISSION OPERATIONS CONTROL`, then `GMT 14:32:08Z` (real UTC, ticking seconds), `STATIONS 04`, `LINK ●GO` (WebSocket health), and an amber `ACTN` chip that only appears when something needs you (§5). No server-uptime MET counter — server uptime is not telemetry. Per-station mission elapsed time (`T+ 01:42:09` since tmux spawn) lives in the plot tooltip, where it means something.

**New-card auto-placement (keep-out rule):** spawning a station scans 48px-grid anchor slots left-to-right, top-to-bottom, and takes the first slot whose card rect does not intersect THE PLOT's rect + 24px margin, the telemetry strip, or the dock. If every clear slot overlaps an existing card, cascade-offset +24px/+24px from the most recent card. A fresh station never opens underneath the centerpiece.

Empty state: a dim centered reticle with `NO STATIONS ON CONSOLE — N TO OPEN ONE` and the tmux naming hint (`mc-<callsign>`) in `--ink-low` — this hint is the only way to learn the shortcut, so it gets readable ink; `--ink-ghost` stays reserved for decoration (§1).

---

## 3. Window chrome — "console stations"

Title bar: 32px, `--bg-titlebar`, 1px `--line-dim` bottom border. Anatomy, left to right:

1. **Annunciator block** — 36×16px bordered rectangle, status color text on transparent: `GO` / `ACTN` / `STBY` / `LOS`, 9px/600.
2. **Callsign** — `SPHERE-WEB`, 12px/600 uppercase tracked, `--ink-hi`.
3. **Repo + session** — `~/git/sphere-web · mc-sphere-web`, 11px, middle-truncated; the path in `--ink-mid` (you stare at these for hours — it has to clear the small-text contrast bar), the `· mc-<cs>` suffix in `--ink-low`.
4. **Right buttons** (20px square, `--ink-low` → `--ink-hi` on hover): `⧉` copies `tmux attach -t mc-sphere-web` (toast: `COPIED — ATTACH FROM ANY TERMINAL`); `–` minimize to dock; `×` kill — this terminates a real tmux session, so it requires a 600ms press-and-hold (the button fills with `--st-los` left-to-right as you hold; release early = cancel).

**Body:** 1px `--line` border, `--bg-card`, 8px padding around a zero-radius xterm viewport on `--bg-term`.

**Focus:** clicked card takes top z. The bright border (`rgba(81,240,138,.55)`) and outer halo live on a dedicated absolutely-positioned overlay (pseudo-element or sibling div with *static* border and box-shadow) whose `opacity` crossfades 0 → 1 over 200ms — never transition `border-color` or `box-shadow` themselves: animated box-shadow repaints the full card rect every frame, right next to a live WebGL canvas. Callsign and title text snap bright; annunciator at full saturation. **Blur:** halo overlay fades out, border snaps to `--line`, title text drops to `--ink-mid`, terminal stays at 92% opacity — *terminal content is never dimmed below readable, never blurred.* Same look as a transitioned border, composited-only.

**Resize:** bottom-right 14×14 grip drawn as three diagonal ticks in `--ink-ghost`, plus invisible 6px handles on all edges/corners. During resize show an `--ink-mid` `96×28` cols/rows readout near the grip — it's a live number you read mid-interaction, not decoration, so it doesn't get ghost ink. The PTY resize fires on release (terminal reflow is instant, never animated). Min size 320×220. Double-click title bar snaps to the 48px grid. Drag is 1:1 `transform`, no easing ever.

**Minimize — the terminal-safety rule:** never animate a mounted xterm. On minimize, the card wrapper hides with an instant `display:none` — xterm stays mounted and the PTY stays attached — while a snapshot/ghost div flies to the dock tile (320ms, `--ease-in`). Restore is an instant un-hide: scrollback intact, zero flicker. (Never unmount-and-reattach: xterm's scroll-wheel buffer dies with the instance, and tmux only keeps history for copy-mode.) A live terminal with a transform on it is a blurry terminal — this rule is absolute.

**Repaint on (re)mount — no blank consoles:** each connected card gets its *own* `tmux attach` inside its own node-pty (Plan.md, PTY/WS relay), and tmux replays a full screen redraw on every attach — so every fresh mount (page reload, WS reconnect, new card) repaints itself for free. Minimize/restore never remounts at all (rule above). An idle STBY station must restore showing its prompt, never a black card; a page reload must bring back four live screens, not four blank ones. The one gap is scroll-wheel history across *page reloads* (the redraw covers the visible screen only) — if that ever stings, the parked fix is a per-session `@xterm/headless` instance server-side replaying an `@xterm/addon-serialize` snapshot as the first frame.

---

## 4. THE PLOT — the agent-world centerpiece

A docked panel, default top-center under the telemetry strip (~460×260, draggable like any window, collapsible to a 28px strip). Double border (`╔═` energy): 1px `--line` outside, 1px `--line-dim` inside. Header in 10px tracked caps with **live counters, all real**: `THE PLOT — 4 STN · 3 LNK · 12 PULLS` (stations alive · edges with heat > 0 · context pulls this session).

**Geometry.** Center: **BASE** — the MCP server / shared-context store — a 16px reticle (circle + crosshair) in `--phos-green-dim`, labeled `BASE`. Around it, one dashed orbit ring (1px, `rgba(81,240,138,.10)`, r≈80px). Each agent is a **station** pinned to a stable bearing on the ring (assigned at spawn, persisted).

**BASE is honest.** The reticle pulses subtly on the real WebSocket heartbeat — every server ping (5s), opacity 0.7 → 1 → 0.7 over 600ms. Two missed pings or socket close: BASE desaturates to `--ink-ghost` over 600ms, all tracers suspend, `LINK` in the strip flips to `LOS`. The hub dies honestly; reconnect warms it back over 600ms.

**Station anatomy:**

- 8px core dot in status color, 14px outer ring, callsign label above.
- **Rate arc** — a 270° arc around the ring whose sweep maps log-scale to real PTY bytes/sec (0 → 10KB/s), lerped over 200ms.
- **Context arc** — a second, thinner ring (1px, r+4px): track in `--ink-ghost`, fill in `--phos-green-dim`, sweep 0–270° = **the model's own reported context occupancy**: the transcript tail (same watcher as tool blips) reads the latest assistant message's `message.usage` and computes `input_tokens + cache_read_input_tokens + cache_creation_input_tokens` over the model window — a real number, present in every local Claude Code transcript. Not transcript-file-size/4: that measures lifetime bytes (full tool results, pre-compaction history) and would read 110% amber on a freshly-compacted, perfectly healthy agent — wrong exactly when it matters. Above 80% the fill turns `--phos-amber`. This answers the question you'll actually have: *which agent is about to compact?*
- **`T-mm:ss`** since last output, below the label.
- **Tool blips** — when the transcript tail sees a `tool_use`, the live action (`EDIT src/routes/user.ts`, `BASH pnpm test`) fades in under the station in 9px `--ink-mid` (`--t-fast` in, 3s hold, `--t-blip-out` out; newest replaces). The plot stops being status-only and starts showing *what* each agent is doing.

**Stations are the fleet switcher.** Click a station to raise its card (or restore it from the dock). Hover for a tooltip: tmux session name, `T+ hh:mm:ss` since spawn, last activity, context occupancy, pulls served / pulls made. The centerpiece earns its billing functionally, not just visually.

**States:**

- **(a) Starts working:** core snaps to `--st-go` with one `--t-ring-flash` (240ms) ring flash; a 6px dash orbits the station ring at 1 rev/4s, linear — a radar sweep that means "executing." Rate arc tracks real throughput.
- **(b) Needs input:** core goes `--st-actn`; the sweep *stops* (it is waiting, not working); a sonar ping fires every 4s — a ring expanding 14px → 44px while fading 1 → 0 over 1.2s, `cubic-bezier(0, 0, 0.2, 1)`.
- **(c) HERO — context pull.** When any session's MCP call `get_agent_context("api-core")` fires, the server emits a plot event and you watch knowledge move:
  - **Shape:** a phosphor tracer — 3px head dot + fading tail of trailing dots at 40ms stagger, `--phos-green`, glow `0 0 6px rgba(81,240,138,.6)`. **Tail length is byte-scaled:** `tailDots = clamp(round(log10(payloadBytes)), 3, 8)` — a 1KB pull trails 3 dots, a 1MB pull trails 6. The MCP server knows the byte count; a big pull visibly carries more.
  - **Path:** source station → BASE along a quadratic Bézier bowed 24px off the chord (the hub mediates the data, so the visual routes through it honestly), then BASE → requesting station on a mirrored curve.
  - **Duration/easing:** leg 1, 400ms `cubic-bezier(0.4, 0, 0.2, 1)`; BASE reticle pulse scale 1 → 1.25 → 1 over `--t-handoff` (150ms) at handoff; leg 2, 400ms `cubic-bezier(0, 0, 0.2, 1)`. ~950ms total.
  - **Arrival:** requester's ring flashes `--flash-white` for 120ms.
  - **Edge heat (the collaboration map):** each pull adds **+0.1 opacity** to the 1px dotted station-to-station arc, capped at **0.6**, decaying linearly at **0.06/min** (a maxed edge cools to nothing in ~10 minutes). By midnight THE PLOT is a real map of tonight's collaboration — which is the whole point of the centerpiece. Heat lives client-side: `{pair, heat, lastPull}`, recomputed at 1Hz onto a CSS var.
  - `@docs-bot` send-keys injections use the same tracer in `--phos-amber`, station → station direct, `--t-cmd-transit` (500ms) — commands don't route through the store, so the visual doesn't either. They heat the edge by +0.05.
- **(d) Idle breathing:** core `--st-stby`, station group opacity oscillates 0.55 ↔ 0.75 on a 6s sine — phosphor persistence, not animation. **Dead:** ring gets an `×` strike, label struck in `--ink-ghost`, all motion stops. Silence reads as loss of signal.

**Event ticker:** a 3-line strip under the plot (10px mono): `14:32:08Z  SPHERE-WEB ◂CTX◂ API-CORE  3.2k`. New lines appear instantly (no slide); older lines step down the ink tiers.

**Full-canvas overlay (`P`):** the plot expands over the whole canvas above a near-opaque scrim (`rgba(5,8,7,.85)`). Terminals dim behind it — deliberately: this is a transient, any-key-dismiss view, and two seconds of dimmed consoles beats phosphor tracers, heat arcs, and orbit rings drawn over live green code with neither layer readable. The scrim does all the dimming; never set `opacity` on a card root to dim chrome (opacity on the card dims every child, xterm canvas included) — any chrome-dimming class targets titlebar/border elements individually. Any keypress or card click dismisses it instantly.

---

## 5. Status system + the attention ladder

The annunciator vocabulary (`GO` / `ACTN` / `STBY` / `LOS`) appears identically in four places — title-bar block, plot station, dock tile, strip chip — so status reads at any zoom level.

### Detection (server-side, per session — locked details in Plan.md, status engine)

1. **Primary — Claude Code hooks (push, <50ms).** Every spawn passes `--settings /Users/Saurav/.mission-control/mc-hooks.json` (absolute path), whose hooks POST to `/api/hooks`: UserPromptSubmit/PreToolUse/PostToolUse ⇒ `GO`, Notification ⇒ `ACTN`, Stop/SessionStart ⇒ `STBY`, SessionEnd ⇒ exited. Mapped to stations by the server-chosen `--session-id`. This is what makes the ACTN flip feel instant.
2. **Reconciler — tmux pane title (2s poll).** Claude Code sets an OSC 0/2 title whose first codepoint is a braille spinner while busy — but tmux *intercepts* titles into `pane_title` and re-emits nothing to attached clients (`set-titles` is off by default), so never sniff the stream: poll `tmux display-message -p -t =mc-<cs> '#{pane_title}'` and do the braille check there.
3. **Reconciler — capture-pane regexes (same 2s tick).** Covers the three verified hook blind spots: Esc-interrupt (no Stop fires), the folder-trust dialog (no Notification), and process death. ANSI-stripped patterns for the permission/prompt dialogs; running→idle downgrade only after 2 consecutive idle polls so hooks keep winning fast edges.
4. **Dead:** `tmux has-session` fail or `pane_dead=1` ⇒ `LOS`.

### The attention ladder — escalates by visibility, never by intensity

When an agent flips to **ACTN**:

1. Title-bar badge pulses opacity 1 → 0.65 on a 2s ease-in-out loop; a 1px `--phos-amber` underline draws across the title bar (200ms).
2. Its plot station pings every 4s.
3. Telemetry strip shows the amber count: `ACTN 01`.
4. **Card buried?** (minimized, or > 70% covered by higher-z cards — point-grid sampled on z-change, §8): the strip chip becomes clickable and names the agent — `[ ACTN 01 ▸ API-CORE ]`. Click raises/restores the card.
5. **Card offscreen?** An amber chevron `‹` hugs the nearest viewport edge pointing at it; click teleports the card front-center.
6. **Browser tab unfocused?** `document.title` → `(1) MOCR`, favicon swaps to a pre-made amber-dot data URI.
7. Unacknowledged past 2 minutes: the strip chip gains a slow 2s pulse. That is the top of the ladder.

Focusing the card **acknowledges the alarm** — every rung clears within 200ms, exactly like acking a master caution. **Never:** shaking, bouncing, anything flashing faster than 0.5Hz, sound (opt-in chime exists, default off), or anything modal. Amber means exactly one thing in this room.

---

## 6. Motion language

| Token | Value | Used for |
|---|---|---|
| `--t-instant` | 0ms | Drag, z-order, terminal output, terminal resize, ticker text, overlay dismiss |
| `--t-fast` | 120ms | Arrival flashes, hover states, blip fade-in |
| `--t-handoff` | 150ms | BASE reticle pulse at tracer handoff |
| `--t-norm` | 200ms | Focus/blur halo crossfade, card open (scale .98 → 1 + fade), underline draw, rate-arc lerp |
| `--t-ring-flash` | 240ms | GO ring flash when a station starts working |
| `--t-blip-out` | 300ms | Tool-blip fade-out |
| `--t-slow` | 320ms | Minimize-to-dock (wrapper only), plot collapse/expand |
| `--t-transit` | 400ms/leg | Tracer flight (context pulls) |
| `--t-cmd-transit` | 500ms | @-mention tracer, station → station direct |
| `--t-base` | 600ms | BASE warm/cold transition, hold-to-kill fill |
| `--t-ping` | 1200ms | Sonar ping |
| `--t-breath` | 6000ms | Idle breathing |
| `--ease-std` | `cubic-bezier(0.4, 0, 0.2, 1)` | Most things |
| `--ease-out` | `cubic-bezier(0, 0, 0.2, 1)` | Arrivals, pings |
| `--ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | Exits, minimize |
| linear | — | Radar sweeps, clock, heat decay |

Loop periods and holds are deliberate literals, not tokens: the 4s sonar interval, 4s radar-sweep revolution, 2s ACTN badge pulse, and 3s blip hold are rhythms tuned in place. Every one-shot transition lives in the table above — if a duration isn't there and isn't a loop, it doesn't exist.

**Never animates:** terminal bytes (xterm paints raw), PTY reflow, clock digits (they tick, no flips), ticker entries, window position during drag, any mounted xterm (§3). Only `transform`/`opacity` are animated; no layout, `filter`, `border-color`, or `box-shadow` animation on any large surface — the focus halo is an opacity-crossfaded static overlay (§3), not a transitioned shadow. Idle screen cost ≈ a few small CSS opacity loops — effectively free next to 4 live terminals.

**`prefers-reduced-motion`:** tracers become instant edge flashes (the heat arc jumps to its new opacity with a single 120ms `--flash-white` blink at the target station) plus their ticker lines; sonar pings become a steady amber ring; breathing stops; radar sweeps become a static arc shown only while running; minimize is a fade. Every state change remains **color-complete** — nothing is communicated by motion alone.

---

## 7. Full-screen mockup

(Tracer mid-flight: `API-CORE ◉╌╌╌╮ → ⊕ BASE → SPHERE-WEB`; `ctx ▮▮▮▮▱ 81%` = API-CORE's context arc running hot; `EDIT db/schema.sql` = live tool blip; strip chip `[ ACTN 01 ▸ API-CORE ]` is clickable because the waiting card is half-covered; `[◢]` = resize grip; TEST-RIG minimized to dock. Offscreen ACTN cards get an amber `‹` chevron at the nearest edge — not shown, nothing is offscreen.)

```
┌──[ MOCR ]── MISSION OPERATIONS CONTROL ──────────────────────────────────────────────────────────────────────────────────┐
│ GMT 14:32:08Z   STATIONS 04   LINK ●GO   [ ACTN 01 ▸ API-CORE ]                            [FILM·OFF]  [P PLOT]  [N NEW] │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ ·         +         ·         +         ·         +         ·         +         ·         +         ·         +          │
│ ┌─[ GO ]─ SPHERE-WEB ────────── ⧉  –  × ┐  ╔═[ THE PLOT — 4 STN · 3 LNK · 12 PULLS ]═══╗  ┌─[ FILE ]─ agents.ts ──── × ┐ │
│ │ ~/git/sphere-web · mc-sphere-web      │  ║     ·           +             ·     GMT⊙  ║  │  41│ const attach = (      │ │
│ │ ┌───────────────────────────────────┐ │  ║   API-CORE ◉╌╌╌╮       ctx ▮▮▮▮▱ 81%      ║  │  42│   cs: Callsign,       │ │
│ │ │ ● Refactor src/routes/user.ts     │ │  ║   EDIT db/schema.sql ╲                    ║  │  43│ ) =>                  │ │
│ │ │   ⎿ updated 142 lines             │ │  ║                  ▸⊕ BASE                  ║  │  44│   pty.spawn('tmux',   │ │
│ │ │ > pnpm typecheck ... ok           │ │  ║                  ╱                        ║  │  45│    ['attach','-t',    │ │
│ │ │ █                                 │ │  ║   SPHERE-WEB ◉╌╌╯          ◌ DOCS-BOT     ║  │  46│     `mc-${cs}`]);     │ │
│ │ └───────────────────────────────────┘ │  ║   rate ▮▮▮▮▯ · ctx 42%       T-04:12      ║  │────────────────────────────│ │
│ └───────────────────────────────────[◢]─┘  ╟───────────────────────────────────────────╢  │ ▸ src/server/              │ │
│                                            ║ 14:32:08Z  SPHERE-WEB ◂CTX◂ API-CORE 3.2k ║  │   agents.ts                │ │
│ ┌─[ACTN]─ API-CORE ──────────── ⧉  –  × ┐  ║ 14:31:44Z  @DOCS-BOT ◂CMD◂ SPHERE-WEB     ║  │   pty.ts                   │ │
│ │ ~/git/api-core · mc-api-core          │  ╚═══════════════════════════════════════════╝  │   ws.ts                    │ │
│ │ ┌───────────────────────────────────┐ │                                                 │ ▸ src/plot/                │ │
│ │ │ ? Allow edit to db/schema.sql?    │ │  ┌─[STBY]─ DOCS-BOT ─────── ⧉  –  × ┐           └────────────────────────────┘ │
│ │ │   ❯ 1. Yes   2. No                │ │  │ ~/git/docs-bot · mc-docs-bot     │                                          │
│ │ │ █                                 │ │  │ ┌──────────────────────────────┐ │                                          │
│ │ └───────────────────────────────────┘ │  │ │ > waiting at prompt          │ │                                          │
│ └───────────────────────────────────[◢]─┘  │ └──────────────────────────────┘ │                                          │
│                                            └──────────────────────────────[◢]─┘                                          │
│ ·         +         ·         +         ·         +         ·         +         ·         +         ·         +          │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ DOCK ▸ [● TEST-RIG · GO]                                                                N NEW STATION · P PLOT · ⌘K JUMP │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 8. Buildability notes — every effect, one evening each (one flagged exception)

| Effect | Technique |
|---|---|
| Graticule + crosshairs + vignette | Single CSS multi-background on the canvas div: two `repeating-linear-gradient`s (48px), a tiny SVG-data-URI `+` tiled at 240px, one `radial-gradient`. Zero runtime cost. |
| Scanline FILM toggle (v1.1, cut if tight) | One fixed `pointer-events:none` div, `repeating-linear-gradient(0deg, rgba(0,0,0,.06) 0 1px, transparent 1px 3px)`, class toggle. |
| Phosphor glows | `box-shadow`/`text-shadow` on small elements only. No `filter: blur` anywhere. |
| Draggable/resizable cards | ~300 lines in practice — the "80-line window manager" dies the moment edge/corner resize, min-size clamping, grid snap, the cols/rows readout, and layout persistence land. This is the one item that's honestly 1–2 evenings, not one; budget for it. Core: `pointerdown` on title bar → `pointermove` sets `translate3d`; 6px edge handles for resize; z = incrementing counter on focus. Persist `{x,y,w,h,z}` per callsign to `~/.mission-control/layout.json` via the server (survives browsers). |
| Keep-out placement | Pure function: scan 48px-grid slots, `rectsIntersect(slot, plotRect.pad(24))`, first clear slot wins, cascade fallback. ~30 lines, unit-testable. |
| Terminals | `@xterm/xterm` + **`@xterm/addon-webgl` as the default** for 4 live panes; DOM renderer is the fallback on WebGL context loss. Custom theme = `mocrTermTheme` (§1). `fit` addon on resize end → `pty.resize` → tmux reflows. Minimize: instant `display:none`, ghost div animates, xterm never unmounts (§3). |
| Repaint on (re)mount | Free: each card's WS connection gets its own `tmux attach` PTY, and tmux replays a full redraw on attach — page reloads and reconnects repaint themselves. Parked enhancement for scroll-wheel history across reloads: per-session `@xterm/headless` + `@xterm/addon-serialize` snapshot as first frame. |
| Session plumbing | Server spawns via the locked argv in Plan.md (absolute claude path, `--session-id <uuid>`, absolute `--settings`, `\; set-option remain-on-exit on` chained atomically); `node-pty` runs `tmux attach-session -t =mc-<cs>` per connected card; raw pty bytes as binary WS frames server→client; a JSON WS channel carries control events (status, rates, plot events, heartbeat). Setup note: `brew install tmux` first — tmux is not preinstalled on macOS. |
| Status detection | Hooks primary (push, §5); 2s reconciler polls `display-message -p -t =mc-<cs> '#{pane_title}'` (braille busy bit — never sniff OSC titles off the attached stream; tmux intercepts them) + ANSI-stripped capture-pane regex for the hook blind spots. Dead: `has-session` / `pane_dead`. Locked details in Plan.md. |
| THE PLOT | One SVG (~40 elements). Station positions = fixed bearings on a circle, computed once. Breathing/pings/sweeps = CSS keyframes on SVG elements (free when idle). Stations get `cursor: pointer` + click → raise/restore; tooltip is a plain positioned div fed by the agents store. |
| Hero tracer | CSS Motion Path: head dot gets `offset-path: path("M sx sy Q cx cy bx by")`, animate `offset-distance 0→100%` 400ms; tail = N dots (byte-scaled count), same path, 40ms `animation-delay` stagger; second leg = second path. BASE pulse + arrival flash = keyframes. No rAF. |
| Edge heat | Client store `{pair, heat, lastPull}`; +0.1 on each pull event (cap 0.6); 1Hz tick sets `style.opacity = max(0, heat - 0.001 * elapsedSec)` on the dotted SVG arc; remove at 0. ~20 lines. |
| Context arcs | Same jsonl tail as tool blips: read the latest assistant message's `message.usage`, compute `input_tokens + cache_read_input_tokens + cache_creation_input_tokens` over the model window → `stroke-dashoffset` on the thin ring, `transition: 200ms`; class swap to amber ≥ 80%. (Never transcript-size/4 — that's lifetime bytes and lies after every compaction.) |
| Tool blips | `fs.watch` on the newest `*.jsonl` per session dir + **per-file byte offsets**: on change, read only the delta via `fs.createReadStream({start: lastOffset})`; reset the offset if size shrinks (truncation). Never re-read a multi-MB transcript on every write. On `tool_use` emit `{cs, tool, target}`; client fades the label under the station (CSS, 3s hold). The same tail feeds the context arcs. |
| Rate arcs | SVG `stroke-dasharray`/`stroke-dashoffset` from bytes/sec counters the server emits every 500ms; CSS `transition: stroke-dashoffset 200ms`. |
| BASE heartbeat | Server pings every 5s on the JSON channel → one-shot CSS pulse class on the reticle. `onclose`/2 missed pings → `.cold` class (600ms desaturate via opacity+color transition), suspend tracer queue. |
| Mission clock | `setInterval` 250ms, `tabular-nums`. Per-station `T+` computed from spawn epoch sent in the WS hello. |
| Attention ladder rungs 4–6 | Buried check: sample a 12×12 point grid over the card rect against all higher-z card rects — buried if >70% of samples are covered. ~15 lines, recomputed on z-change; exact union-of-rectangles area is not worth writing. Chevron = fixed div, geometry from card rect vs viewport. Tab alert = `document.title` + two pre-made data-URI favicons swapped on `visibilitychange`. |
| Cross-agent UI sugar | On Enter, read the rendered input line back from xterm's buffer API (the rows above the cursor) and regex for `@<callsign>` there — the terminal already did the line editing, so backspace, paste, arrow-key history recall, and mid-line edits can't break it the way naive keystroke buffering does. Match → server `tmux send-keys -t mc-<cs>` → amber tracer event. The reliable path is `SEND TO STATION` in the existing ⌘K palette; inline `@` is best-effort sugar. |
| Plot overlay (`P`) | Class on the root: a fixed scrim div at `rgba(5,8,7,.85)` covers canvas and cards; the plot panel scales to viewport above it. The scrim does all dimming — never `opacity` on a card root (it would dim the xterm canvas with the chrome). `keydown`/card `pointerdown` removes the class instantly. |
| Editor panel | `@monaco-editor/react`, `monaco.editor.defineTheme('mocr-dark', …)` mapped from the token palette; server exposes read/write endpoints rooted at each agent's repo dir. |
| Reduced motion | One `@media (prefers-reduced-motion: reduce)` block: kill keyframes, swap tracer component for the flash-only variant. All state already color-complete. |
| Perf budget | Idle = a few CSS opacity loops on tiny SVG nodes + 1Hz heat tick; all animation is transform/opacity; tracers are the only transient work; zero permanent rAF loops. Comfortably smooth beside 4 live PTY streams on WebGL. |

Stack stays as locked: Express + ws + node-pty server, Vite + React + TS-strict client, functional components, named exports, pnpm, 2-space. Machine setup before evening one: `brew install tmux` — it is not on the box.
