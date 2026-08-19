# Intake: Terminal Tile Progress

**Change**: 260819-1vxq-terminal-tile-progress
**Created**: 2026-08-19

## Origin

Conversational — the third change from the `/fab-discuss` addon-audit session (order: export → find → **progress**; design study `terminal-tile-addons-design-study.html`, state 03). Two transport spikes on 2026-08-19 grounded this intake (isolated `rk-spike-img` socket, pty harness simulating the relay client incl. its DA replies):

- **Raw OSC 9;4 is swallowed by tmux** (BEL- and ST-terminated both) — it never reaches the relay client. Ambient emitters (pnpm, winget) can therefore NEVER light this feature through tmux.
- **Passthrough-wrapped OSC 9;4 (`\ePtmux;…\e\\`) arrives byte-intact**, and the embedded conf already sets `allow-passthrough on` (`configs/tmux/default.conf:34`).

> Create the terminal-tile progress intake: register @xterm/addon-progress in TerminalClient and render OSC 9;4 task progress as a 2px line on the tty tile's content top edge plus a percent chip beside the status dot — knowing only tmux-passthrough-wrapped emitters can feed it

Key decisions from the discussion:

- The emit side is deliberately out of repo: fab-kit backlog `[3pyc]` (fab emits wrapped OSC 9;4 at stage transitions/task ticks) and shll backlog `[rbdd]` (toolkit-wide convention, which must specify the tmux-wrap requirement). This change is the **render side only** and is harmless while dark — it renders nothing until a wrapped emitter exists.
- Rendering follows the approved design study state 03: 2px determinate line at the content's top edge, a small percent chip beside the status dot, red line + chip on error state, sweep animation for indeterminate, hidden on remove/idle.
- Progress is **per-viewer ephemeral stream state** — no SSE, no backend, no persistence. A client that attaches mid-task shows nothing until the next progress update arrives (accepted limitation, consistent with the passthrough mechanism being invisible to tmux).

## Why

1. **Pain point**: a busy pane gives no glanceable signal of HOW FAR a long task has gotten — the status dot says busy/waiting, never 40% vs 95%. On a board of six agent panes, knowing which run is nearly done requires reading each pane's output.
2. **Consequence if unfixed**: the OSC 9;4 convention run-kit's own toolchain is about to adopt (fab `[3pyc]`, shll `[rbdd]`) would have no consumer in run-kit's UI — the dashboard would be the one surface NOT showing the progress its own tools emit.
3. **Why this approach**: `@xterm/addon-progress` (0.2.0, the 6.0.0 release train) parses the sequences into a typed `onChange({state, value})` event — no bespoke OSC parsing. Rendering in the tile chrome (not the xterm canvas) keeps the terminal content untouched and reuses the design language already approved for the web tile's loading line.

## What Changes

### 1. Addon registration + event plumbing

`@xterm/addon-progress@^0.2.0` added to `app/frontend/package.json`, statically imported and registered in `TerminalClient` (static-import rule per the board-route dynamic-import hang). The addon's `onChange` handler lifts `{state, value}` into per-tile React state via a callback prop (the `onFocusReport`/`onInteract`-style seam pattern), throttled to animation-frame cadence so bursty updates cannot re-render storm.

State mapping (the OSC 9;4 state codes):

| Code | State | Render |
|------|-------|--------|
| 0 | remove | line hidden, chip removed |
| 1 | set (0–100) | green determinate fill at value%, chip shows `{value}%` |
| 2 | error | red line (last-known width) + red chip |
| 3 | indeterminate | green sweep animation, no chip percentage |
| 4 | pause/warning | amber fill at last-known value |

### 2. Tile chrome rendering

- **Progress line**: a 2px strip at the top edge of the tty tile's content area (below the header), matching the web tile chrome study's loading line geometry. Zero-height/invisible when idle — the tile layout must not shift when progress appears (the strip overlays or reserves its 2px always; decided at apply consistent with how the web tile's line behaves).
- **Percent chip**: a small bordered chip beside the status dot in the tile header (design study state 03's `62%` chip), rendered only in states 1/2/4.
- Under `prefers-reduced-motion` the indeterminate sweep is zeroed (static dim fill), per the project's animation rules.
- Board pane cards and duplicate tty tiles inherit automatically wherever `TerminalClient` mounts with the callback wired; the terminal-route tile is the required surface, board cards SHOULD work but are verify-not-fork.

### 3. Ephemerality rules

- No backend, no SSE, no store persistence: the signal exists only in the component that observed the stream (Constitution X spirit — an in-flight fact, not derivable at request time, and NOT pushed into tmux options by run-kit).
- On relay reconnect / window switch remount, progress resets to idle until the next update.
- A stale determinate value with no updates is left as-is (the emitter owns lifecycle via state 0); no client-side timeout in this change.

### Non-goals

- **No emit side in run-kit** — fab-kit `[3pyc]` and the shll `[rbdd]` convention own emission (including the tmux-passthrough wrap requirement).
- No status-pyramid / sidebar / board rollup of progress (a natural follow-up once real emitters exist; the per-tile signal ships first).
- No attempt to make raw (unwrapped) OSC 9;4 work — spiked dead through tmux; not a run-kit bug.
- No persistence or backfill of progress for late-attaching clients.

## Affected Memory

- `run-kit/ui/terminal`: (modify) xterm addons list gains addon-progress; the onChange seam + throttling
- `run-kit/ui/lenses-and-layout`: (modify) tty tile chrome gains the progress line + percent chip anatomy
- `run-kit/ui/status-signals`: (modify) the progress chip joins the header signal vocabulary beside the status dot (with the per-viewer ephemerality caveat)

## Impact

- **Frontend only**: the `TerminalClient` module (addon registration + onChange seam), `app/frontend/src/components/surface-layout.tsx` (line + chip render), `globals.css` (sweep keyframes if not reusing the web tile's), `app/frontend/package.json`.
- No backend, no Electron, no tmux config changes (allow-passthrough already on).
- **Tests**: Vitest unit test driving the addon's onChange with each state code and asserting the mapped render state (including remove/idle and reduced-motion); an e2e that prints a wrapped OSC 9;4 sequence into a real pane (`printf` via the test harness) and asserts the line + chip appear — this doubles as a regression guard on the passthrough transport; `.spec.md` companion per constitution.

## Open Questions

- None.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Render side only; emission lives in fab-kit `[3pyc]` / shll `[rbdd]` with the tmux-wrap requirement | Discussed — backlogs filed in both repos during this session; user confirmed the pairing | S:90 R:85 A:95 D:90 |
| 2 | Certain | Only passthrough-wrapped OSC 9;4 works; raw is dead through tmux and out of scope | Spike-verified 2026-08-19 (control cases both ways); allow-passthrough already in the embedded conf | S:95 R:85 A:95 D:95 |
| 3 | Certain | Visuals per approved design study state 03: 2px top-edge line + percent chip beside the status dot; state mapping green/red/sweep/amber | User reviewed and iterated the study; state table follows the addon's documented codes | S:85 R:85 A:90 D:85 |
| 4 | Confident | onChange lifted via a callback-prop seam with rAF throttling | Matches the existing TerminalClient seam patterns; prevents render storms from bursty emitters | S:55 R:85 A:85 D:80 |
| 5 | Confident | Per-viewer ephemeral; resets on remount/reconnect; no client-side staleness timeout | Consistent with the passthrough mechanism (tmux cannot replay it) and Constitution X's derivability line | S:60 R:85 A:80 D:80 |
| 6 | Confident | Pause/warning (state 4) renders amber at last value | Addon defines the state; amber matches the existing signal vocabulary; trivially retuned | S:50 R:95 A:80 D:75 |
| 7 | Confident | Board cards inherit via TerminalClient mount — verify, don't fork | Same renderer mounts there; the required surface is the terminal-route tile | S:55 R:85 A:80 D:75 |
| 8 | Confident | addon-progress imported statically, registered unconditionally | Static-import rule; the addon is passive stream parsing | S:60 R:90 A:85 D:80 |

8 assumptions (3 certain, 5 confident, 0 tentative, 0 unresolved).
