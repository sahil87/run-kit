# Plan: Terminal Tile Progress

**Change**: 260819-1vxq-terminal-tile-progress
**Intake**: `intake.md`

## Requirements

### Frontend: Progress consumer (the throttled seam lift)

#### R1: rAF-throttled progress state in SurfaceLayout
`SurfaceLayout` (`app/frontend/src/components/surface-layout.tsx`) SHALL consume the scaffold's `onProgressChange?: (state, value) => void` prop on its tty `TerminalClient` mounts (the `renderContent` tty arm), lifting `{state, value}` into ONE per-window progress state slot (the `webPageTitle` single-slot precedent — duplicate tty tiles show the same window, so one slot serves all tty tiles). Updates MUST be coalesced to at most one React state commit per animation frame (latest event wins; pending rAF cancelled on unmount), so bursty emitters cannot re-render storm the tile grid. The state mapping SHALL be a pure reducer in a new DOM-free module `app/frontend/src/lib/tty-progress.ts` (the `window-transition.ts` / `surface-layout.ts` module contract, colocated `tty-progress.test.ts`):

| Code | State | Mapped render state |
|------|-------|---------------------|
| 0 | remove | idle (line hidden, chip removed) |
| 1 | set | determinate `{value}` (clamped 0–100) |
| 2 | error | error at last-known value (incoming `value > 0` wins, else retained) |
| 3 | indeterminate | indeterminate (no percentage) |
| 4 | pause/warning | paused at last-known value (same retention rule as error) |
| other | unknown | ignored (previous state kept) |

- **GIVEN** a tty tile whose pane emits passthrough-wrapped `OSC 9;4;1;42`
- **WHEN** the ProgressAddon fires `onProgressChange(1, 42)` through the scaffold seam
- **THEN** within one animation frame the tile renders determinate progress at 42%
- **AND** 100 bursty updates within one frame commit at most one state update (the last one)

#### R5: Per-viewer ephemerality
Progress SHALL exist only as `SurfaceLayout` component state — no backend, no SSE, no store, no localStorage. A window switch resets it to idle for free (`app.tsx` keys `SurfaceLayout` by `${server}:${windowId}` — remount). A stale determinate value with no updates is left as-is (the emitter owns lifecycle via state 0); no client-side staleness timeout. A relay reconnect within the same mount does NOT reset the value (the consumer has no reconnect seam and `terminal-client.tsx` is frozen by the scaffold contract — the stale-left-as-is rule covers it; see Assumptions).

- **GIVEN** a tile showing 60% progress
- **WHEN** the user switches to another window and back
- **THEN** the tile shows no progress until the next wrapped update arrives

### Frontend: Tile chrome rendering

#### R2: Progress line at the tty tile content top edge
The `{/* rk-slot: progress-line */}` anchor in `surface-layout.tsx` SHALL be replaced by a 2px progress strip rendered for **tty tiles only**, at the top edge of the content area (below the header), matching the web tile's `.rk-web-progress` geometry (2px, `globals.css`). The strip MUST be a zero-layout-footprint overlay — a zero-height relative wrapper with an absolutely positioned 2px bar — so the tile layout never shifts when progress appears or leaves and the terminal container never resizes (a flex-child strip would fire `ResizeObserver → fitAndSync → PTY resize` churn; the web tile's in-flow form is not viable over xterm). Renders nothing when idle. Per state: green (`--color-accent-green`) determinate fill at value%; red (`--color-signal-red`) at last-known width on error; amber (`--color-signal-yellow`) fill on pause; green sweep animation (reusing the `rk-web-progress-sweep` keyframes) on indeterminate. New `.rk-tty-progress*` classes live in `globals.css`. Only the two anchor lines are edited in the tile shell (parallel siblings own the adjacent anchors).

- **GIVEN** a tty tile in states 1/2/3/4
- **WHEN** the mapped state renders
- **THEN** a 2px strip shows green-fill / red-at-last-width / sweep / amber-fill respectively, and the content area's box height is identical to the idle render
- **GIVEN** state 0 (remove)
- **WHEN** it arrives after any active state
- **THEN** the strip renders nothing

#### R3: Percent chip beside the status dot
The `{/* rk-slot: progress-chip */}` anchor SHALL be replaced by a small bordered chip (the header meta-chip idiom: `rounded border px-1.5 text-[10px]`) rendered in the tty tile header beside the `StatusDot`, ONLY in states 1, 2, and 4 — showing `{value}%` with green/red/amber border+text per state. Indeterminate (3) and idle (0) render no chip. The header is desktop-only (`!mobile` — mobile renders no tile chrome), so the chip is desktop-only by construction; the line (R2) renders on mobile too.

- **GIVEN** a tty tile at determinate 62%
- **WHEN** the header renders
- **THEN** a `62%` chip appears beside the status dot with `data-testid="progress-chip"`
- **GIVEN** indeterminate state
- **THEN** no chip renders while the line sweeps

#### R4: Reduced motion
Under `prefers-reduced-motion: reduce`, the indeterminate sweep SHALL be zeroed to a static dim fill (`animation: none` + a dimmed static bar — the `.rk-web-progress` / `.rk-waiting-halo` gating discipline: base rule before the media block, equal-specificity override wins by source order). Progress feedback is never motion-only — determinate states are static already.

### Testing

#### R6: Unit + e2e coverage with companion doc
Coverage SHALL include: (a) `tty-progress.test.ts` — reducer mapping for every state code, clamping, last-known retention, unknown-state ignore; (b) `surface-layout.test.tsx` — drive the mocked `TerminalClient`'s captured `onProgressChange` prop with each state code and assert the mapped chip/line render (including remove/idle and the rAF coalescing, using the existing props-spy pattern); (c) a new e2e `app/frontend/tests/e2e/tty-progress.spec.ts` (+ `.spec.md` per constitution) on the real-tmux port-3020 rig (`_tmux.ts` pattern) that `printf`s a passthrough-wrapped OSC 9;4 sequence (`\ePtmux;\e\e]9;4;1;42\a\e\\` — inner ESCs doubled) into a real pane and asserts the line + chip appear, then state 0 removes them — doubling as the passthrough-transport regression guard from the 2026-08-19 spikes.

- **GIVEN** the e2e pane runs `printf '\033Ptmux;\033\033]9;4;1;42\007\033\\'`
- **WHEN** the terminal-route tile is attached
- **THEN** the progress line and a `42%` chip appear, and a follow-up wrapped `9;4;0` hides both

### Non-Goals

- Emit side (fab-kit `[3pyc]`, shll `[rbdd]` own emission incl. the tmux-wrap requirement).
- Raw (unwrapped) OSC 9;4 — spiked dead through tmux; not a run-kit bug.
- Status-pyramid / sidebar / board rollups; persistence or backfill for late-attaching clients.
- Board pane cards: `board-page.tsx` mounts `TerminalClient` without the callback and its card chrome has no line/chip anatomy — the required surface is the terminal-route tile; board wiring is a natural follow-up once real emitters exist (intake: verify-not-fork, and there is nothing to verify where the callback is not wired).
- No edits to `package.json` or `terminal-client.tsx` (pre-landed by `260819-hqjo`).

### Design Decisions

#### Progress line is an absolute overlay, not an in-flow strip
**Decision**: The 2px line renders inside a zero-height `relative` wrapper at the anchor with an `absolute` 2px bar overlaying the content's top edge.
**Why**: The tile layout must not shift when progress appears (intake), and — stronger — an in-flow strip would change the terminal container's height, firing `ResizeObserver → fitAndSync → PTY resize` churn on every progress start/stop, which the slide-transition machinery treats as a hard constraint (transform-only, no layout change).
**Rejected**: The web tile's in-flow `.rk-web-progress` form (fine over an iframe, resize-churn over xterm); reserving a permanent 2px row (still shifts once at mount vs. siblings, and burns 2px on every idle tile).
*Introduced by*: 260819-1vxq-terminal-tile-progress

#### One shared progress slot per window, wired on every tty mount
**Decision**: A single progress state slot in `SurfaceLayout` (the `webPageTitle` precedent), with `onProgressChange` wired on every tty `TerminalClient` mount (primary and duplicates).
**Why**: All tty tiles show the same window, so per-tile state would just duplicate identical values; wiring every mount keeps the signal alive even when the primary tile is hidden (hide-never-unmount keeps its stream open), and duplicate firings are idempotent under rAF coalescing.
**Rejected**: Primary-tty-only wiring (loses updates only in exotic hidden-primary arrangements, but costs nothing to avoid); per-tile state (duplication with no benefit).
*Introduced by*: 260819-1vxq-terminal-tile-progress

## Tasks

### Phase 1: Core Implementation

- [x] T001 Create `app/frontend/src/lib/tty-progress.ts` — `TtyProgress` union (`idle | determinate | error | indeterminate | paused`, value-carrying where applicable) + pure `reduceProgress(prev, state, value)` with clamping, last-known retention for error/pause, unknown-state ignore; colocated `tty-progress.test.ts` covering every state code + retention + clamp + ignore <!-- R1 -->
- [x] T002 In `app/frontend/src/components/surface-layout.tsx`: add the per-window progress state + rAF-coalesced `onProgressChange` handler (latest-wins ref + single scheduled rAF commit, cancelled on unmount) and wire it on the `renderContent` tty arm's `TerminalClient` <!-- R1 -->
- [x] T003 Render the chrome at the two anchors in `surface-layout.tsx` — percent chip (tty gate, states 1/2/4, `data-testid="progress-chip"`, green/red/amber) replacing `rk-slot: progress-chip`; zero-height overlay line (tty gate, `data-testid="progress-line"`, per-state fill/sweep) replacing `rk-slot: progress-line` — plus `.rk-tty-progress*` classes in `app/frontend/src/globals.css` (determinate/error/paused fills, indeterminate sweep reusing `rk-web-progress-sweep`, reduced-motion static dim fill) <!-- R2 R3 R4 -->

### Phase 2: Tests & Verification

- [x] T004 Extend `app/frontend/src/components/surface-layout.test.tsx`: drive the captured `onProgressChange` prop with each state code and assert the mapped chip/line render (remove/idle included), the rAF coalescing (fake rAF, burst → one commit), the indeterminate no-chip case, and the sweep class presence (reduced-motion is a CSS gate — assert classes, not computed style) <!-- R6 R5 -->
- [x] T005 Add `app/frontend/tests/e2e/tty-progress.spec.ts` + `tty-progress.spec.md` — real-tmux rig, printf the wrapped OSC 9;4 set/remove sequences into the pane, assert line + chip appear with `42%` then disappear on state 0; run the frontend gates (`just test-frontend`, `npx tsc --noEmit`, `just test-e2e "tty-progress"`) <!-- R6 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `onProgressChange` is wired on tty mounts and a fired `{state, value}` lands in tile render state within one animation frame, coalesced under bursts
- [x] A-002 R2: The 2px line renders per the state table (green fill / red last-width / sweep / amber) with zero layout shift between idle and active renders
- [x] A-003 R3: The percent chip renders beside the StatusDot only in states 1/2/4 with the matching color, `{value}%` text
- [x] A-004 R4: Indeterminate sweep is zeroed to a static dim fill under `prefers-reduced-motion: reduce`
- [x] A-005 R5: Progress is component state only — no backend/SSE/persistence writes anywhere in the diff; window-switch remount resets to idle

### Scenario Coverage

- [x] A-006 R6: Unit tests cover every state code through both the reducer and the mocked-TerminalClient prop drive, including remove/idle and coalescing
- [x] A-007 R6: The e2e prints wrapped OSC 9;4 into a real pane and proves line + chip appear then remove — the passthrough-transport regression guard — with a `.spec.md` companion in the same commit

### Edge Cases & Error Handling

- [x] A-008 R1: Unknown state codes are ignored (prior render state kept); values clamp to 0–100; error/pause with `value: 0` retain the last-known value

### Code Quality

- [x] A-009 Pattern consistency: pure logic in a DOM-free `lib/` module with colocated tests; chip/line reuse the existing header-chip idiom and `globals.css` token vocabulary; type narrowing over `as` casts
- [x] A-010 No unnecessary duplication: indeterminate keyframes reuse `rk-web-progress-sweep`; no new OSC parsing (the addon owns it); no polling — the addon event is the only source

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new render-side functionality without making existing code redundant. The two consumed `rk-slot: progress-chip` / `rk-slot: progress-line` comment anchors in `surface-layout.tsx` were scaffold placeholders created by `260819-hqjo` to be replaced by exactly this change (planned consumption, not discovered redundancy); the three sibling-owned anchors remain for `260819-shqo` / `260819-zqf9`.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Relay reconnect within the same mount does NOT reset progress (only remount does) | Intake's reconnect-reset line conflicts with its own frozen-terminal-client constraint and stale-left-as-is rule; the consumer has no reconnect seam; emitter owns lifecycle via state 0 | S:60 R:90 A:80 D:70 |
| 2 | Confident | Line is an absolute zero-footprint overlay, not the web tile's in-flow strip | Intake left overlay-vs-reserve to apply; an in-flow strip over xterm fires PTY resize churn (hard constraint from the slide-transition machinery) | S:70 R:85 A:90 D:80 |
| 3 | Confident | Board pane cards stay unwired (non-goal); terminal-route tile is the only surface | Intake names the terminal tile as the required surface; board cards mount TerminalClient without the callback and have no chip/line anatomy — wiring them is real new UI, not inheritance | S:65 R:85 A:85 D:75 |
| 4 | Confident | Chip is desktop-only (mobile renders no tile header); the line renders on mobile too | The header block is `!mobile` by existing design; the line sits outside that gate and is the glanceable mobile signal | S:60 R:90 A:85 D:80 |
| 5 | Certain | Callback wired on all tty mounts into one shared state slot | Duplicate tty tiles show the same window (webPageTitle single-slot precedent); duplicate firings idempotent under rAF coalescing | S:80 R:90 A:90 D:85 |

5 assumptions (1 certain, 4 confident, 0 tentative).
