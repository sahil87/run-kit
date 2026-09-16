# Plan: xterm WebGL Fallback Telemetry

**Change**: 260916-jowy-xterm-webgl-fallback-telemetry
**Intake**: `intake.md`

## Requirements

### Terminal Frontend: WebGL fallback signal

#### R1: A runtime WebGL context loss is announced on the console
When a `TerminalClient`'s WebGL addon reports `onContextLoss`, the handler MUST — after disposing the addon and recording `"canvas"` in `window.__rkRenderer` as today — emit exactly one `console.warn` whose text contains the literal `rk: xterm WebGL context lost`, the `{server}/{windowId}` pair, and `({N} terminal(s) mounted)` where N is the number of keys in `window.__rkRenderer` at that moment.

- **GIVEN** a mounted `TerminalClient` for server `default`, window `@0`, with the WebGL addon loaded
- **WHEN** the addon's `onContextLoss` callback fires
- **THEN** `console.warn` is called once with a string containing `rk: xterm WebGL context lost`, `default/@0`, and `1 terminal mounted`
- **AND** the addon's `dispose()` has been called and `window.__rkRenderer["@0"] === "canvas"`

#### R2: A load-time WebGL failure is announced on the console, without a toast
When `new WebglAddon()` or its `loadAddon` throws during `init()`, the `catch` path MUST emit one `console.warn` containing `rk: xterm WebGL unavailable at load`, the `{server}/{windowId}` pair, and the mounted count — and MUST NOT raise a toast. The terminal MUST still finish initialising on the DOM renderer.

- **GIVEN** `WebglAddon`'s constructor throws
- **WHEN** a `TerminalClient` mounts inside a `ToastProvider`
- **THEN** `console.warn` is called with a string containing `unavailable at load`
- **AND** no `role="alert"` element is rendered
- **AND** `window.__rkRenderer[windowId] === "canvas"` and the terminal reaches ready

#### R3: The first runtime context loss of a page load raises one `info` toast
The first `onContextLoss` on a page load MUST call `addToast(WEBGL_FALLBACK_TOAST, "info")` through the provider-optional toast seam; every later context loss on that page load (any terminal) MUST NOT raise another toast. `WEBGL_FALLBACK_TOAST` is the exported constant `"Terminal GPU rendering lost — using the slower DOM renderer"`. The toast carries no action button.

- **GIVEN** two `TerminalClient`s mounted inside one `ToastProvider`
- **WHEN** both addons fire `onContextLoss`
- **THEN** exactly one `role="alert"` with the text `WEBGL_FALLBACK_TOAST` is rendered
- **AND** `console.warn` was called once per firing (twice)

#### R4: The toast seam is provider-optional
`TerminalClient` MUST obtain the toast through `useOptionalToast()` mirrored into a ref (the `onProgressChangeRef` pattern) so the init effect's dependency list is unchanged; outside a `ToastProvider` a context loss MUST still warn and MUST NOT throw.

- **GIVEN** a `TerminalClient` rendered without a `ToastProvider`
- **WHEN** `onContextLoss` fires
- **THEN** no error is thrown, `console.warn` fires, and no alert is rendered

#### R5: The mounted count comes from the existing renderer registry
The count MUST be `Object.keys(window.__rkRenderer).length` (0 when the map is absent), read after `setActiveRenderer` so the reporting terminal counts itself. No new registry is introduced.

- **GIVEN** three `TerminalClient`s have completed init and one has unmounted
- **WHEN** one of the remaining two loses its context
- **THEN** the warning says `2 terminals mounted`

#### R6: Steady-state behaviour is unchanged
The addon load order (Unicode before WebGL), the `__rkRenderer` literals (`"webgl"`/`"canvas"`), and the dispose-on-loss behaviour MUST be unchanged. The new code MUST run only on the two failure paths; an idle tty route MUST show no renderer-CPU change beyond the instrument's 3-point noise floor.

- **GIVEN** the live daemon and a tty route
- **WHEN** `just perf-idle-cpu <route> 30` runs before and after the change
- **THEN** renderer % differs by less than 3 points and `xtermScreens` is unchanged

### Memory: `run-kit/ui/terminal`

#### R7: Memory records the announced fallback
`docs/memory/run-kit/ui/terminal.md` § Terminal Addons' `@xterm/addon-webgl` row MUST describe the announced fallback (warn shape on both paths, one-shot `info` toast on runtime loss only, mounted-count source, the kept `"canvas"` literal), and § Design Decisions MUST gain a four-field entry "WebGL fallback is announced, not fixed".

- **GIVEN** the hydrated memory file
- **WHEN** a reader looks up the WebGL addon row
- **THEN** it states current truth with no transition narration and the file's `description:` still routes

### Non-Goals

- Fixing or reducing the fallback (context budget for hidden tiles, unmounting hidden tty tiles, board canvas cap) — backlog idea "xterm hidden-tile cap / WebGL context budget"
- Persisting or aggregating a count anywhere (localStorage, tmux option, daemon endpoint)
- A settings key to silence the toast
- Renaming the `__rkRenderer` `"canvas"` literal (the echo-latency harness asserts on it)

### Design Decisions

#### WebGL fallback is announced, not fixed
**Decision**: One `console.warn` per fallback event (both the runtime context-loss and the load-time failure paths), carrying server, window id, and the count of mounted terminals; one `info` toast per page load, raised only by a runtime context loss. Client-only.
**Why**: The 2026-09-16 idle-CPU measurement saw one run in nine fall back, at 39% renderer vs 21% with WebGL. The frequency on real hardware is unknown, so no fix can be sized; Chromium caps WebGL contexts at 16 per page and evicts the oldest, so the mounted count at the moment of loss is the datum that separates a context-budget cause from a GPU reset.
**Rejected**: A `/api` post (Principle X — nothing is pushed to the daemon, and a count on the user's own machine needs only a visible client signal); a toast on the load-time path (a WebGL-less host — software headless Chromium, the e2e rig — would toast on every page load and put a `role="alert"` box in every e2e run); a toast per event (a board or hidden-tile set losing many contexts at once is one event to the user).
*Introduced by*: 260916-jowy-xterm-webgl-fallback-telemetry

#### Toast via the provider-optional hook, not a prop or a document event
**Decision**: `TerminalClient` calls `useOptionalToast()` itself and mirrors it into a ref for the init effect.
**Why**: The hook exists for exactly this case (isolated mounts degrade to no toast); `ToastProvider` wraps every production mount; the ref mirror keeps the init effect's deps unchanged.
**Rejected**: A callback prop (three mount sites to thread — `surface-layout.tsx`, `board-pane.tsx`, `quake-terminal.tsx` — for a signal none of them interprets); an `rk:` document event (needs a listener with toast access to be added somewhere for one message).
*Introduced by*: 260916-jowy-xterm-webgl-fallback-telemetry

## Tasks

### Phase 1: Core Implementation

- [x] T001 In `app/frontend/src/components/terminal-client.tsx`: import `useOptionalToast`; add the exported `WEBGL_FALLBACK_TOAST` constant, `mountedTerminalCount()`, the module-level one-shot flag with an exported `resetWebglFallbackNoticeForTests()`, and `reportWebglFallback(kind, server, windowId, toast)` beside the renderer registry; inside `TerminalClient` add `const toast = useOptionalToast()` mirrored into `toastRef`; call `reportWebglFallback("context-loss", …)` after `setActiveRenderer(windowId, "canvas")` in the `onContextLoss` handler and `reportWebglFallback("unavailable", …)` in the `catch` path. Comments state constraints only (the 16-context cap, why the load path has no toast). <!-- R1 R2 R3 R4 R5 R6 -->

### Phase 2: Tests

- [x] T002 In `app/frontend/src/components/terminal-client.test.tsx`: add `describe("TerminalClient WebGL fallback telemetry")` with cases for R1 (warn shape + dispose + `"canvas"`), R3 (two terminals inside `ToastProvider` → exactly one alert, two warns), R4 (no provider → no throw, warn, no alert), R2 (`WebglAddon` throws → `unavailable at load` warn, no alert, terminal ready). Capture the loss callback from `vi.mocked(WebglAddon).mock.results[i].value.onContextLoss.mock.calls[0][0]`; spy `console.warn`; reset the one-shot flag and `window.__rkRenderer` between cases. Run `npx tsc --noEmit` and the file through `just test-frontend` (or `pnpm vitest run src/components/terminal-client.test.tsx` from `app/frontend` when the recipe takes no filter). <!-- R1 R2 R3 R4 R5 -->

### Phase 3: Verification

- [x] T003 Instrument: record the *before* line already captured (`just perf-idle-cpu /rK/@8 30 --url http://127.0.0.1:3000`) and run the same command *after* T001; paste both summary lines into `## Notes` below with the renderer delta and `xtermScreens`. If no daemon answers, record "instrument not run — no live daemon". <!-- R6 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: A runtime `onContextLoss` produces one `console.warn` containing `rk: xterm WebGL context lost`, `{server}/{windowId}`, and `({N} terminal(s) mounted)`, after `dispose()` and the `"canvas"` write
- [x] A-002 R2: A throwing `WebglAddon` construction produces one `console.warn` containing `unavailable at load` and no toast; the terminal still initialises
- [x] A-003 R3: The first runtime loss per page load calls `addToast(WEBGL_FALLBACK_TOAST, "info")`; subsequent losses on any terminal do not
- [x] A-004 R4: `useOptionalToast()` is used, mirrored into a ref; the init effect's dependency array is unchanged from `main`
- [x] A-005 R5: The count is derived from `window.__rkRenderer` keys with no new registry
- [x] A-006 **N/A**: hydrate-stage item — written by hydrate

### Behavioral Correctness

- [x] A-007 R6: Addon load order, `__rkRenderer` literals, and dispose-on-loss are byte-for-byte the same paths as before; the only new statements are the two `reportWebglFallback` calls plus the helper definitions
- [x] A-008 R6: `just perf-idle-cpu` before/after on the same tty route: renderer % within 3 points, `xtermScreens` unchanged — or an explicit "not run" note (judged from the § Notes table: changed build 9.4% vs unchanged 13.0% on the same server — 3.6 points *favorable*; the two unchanged-source runs on this box spread 3.8 points (13.0 vs 9.2), and the new code has no steady-state path; `xtermScreens` 1 in every run)

### Scenario Coverage

- [x] A-009 R1: Vitest case invokes the captured `onContextLoss` callback and asserts the warn text, `dispose`, and `"canvas"`
- [x] A-010 R3: Vitest case with two clients inside `ToastProvider` asserts exactly one `role="alert"` and two warns
- [x] A-011 R4: Vitest case without `ToastProvider` asserts no throw and no alert
- [x] A-012 R2: Vitest case with a throwing `WebglAddon` asserts the `unavailable at load` warn and no alert

### Edge Cases & Error Handling

- [x] A-013 R5: `mountedTerminalCount()` returns 0 when `window.__rkRenderer` is absent and never throws under SSR-style `typeof window === "undefined"`
- [x] A-014 R3: The one-shot flag is module state; the test-only reset is named `…ForTests` and has no production call site

### Code Quality

- [x] A-015 Pattern consistency: the ref mirror follows `onProgressChangeRef`; helpers sit beside `setActiveRenderer`; naming matches the file
- [x] A-016 No unnecessary duplication: no new registry, no new toast plumbing — `useOptionalToast` and `__rkRenderer` are reused
- [x] A-017 Type narrowing over assertions: no `as` casts in the new production code
- [x] A-018 Tests cover the added behaviour (code-quality.md § Principles) — four Vitest cases green
- [x] A-019 Comments state constraints, never narrate, and cite no change IDs or PR numbers
- [x] A-020 `npx tsc --noEmit` clean

## Notes

### Instrument — zero-regression check (2026-09-16, `just perf-idle-cpu /rK/@8 30`, headless Chromium, software GPU)

| Build | Server | Renderer % | GPU % | Recalcs / 30 s | xterm | Note |
|---|---|---|---|---|---|---|
| Live daemon (brew install, pre-change) | `--url http://127.0.0.1:3000` | 9.2 | 50.7 | 1883 | 1 | reference baseline |
| Worktree binary, `dist` built from `HEAD` source (pre-change) | `--url http://127.0.0.1:3777` | 13.0 | 11.1 | 1833 | 1 | same server as the row below |
| Worktree binary, `dist` built with this change | `--url http://127.0.0.1:3777` | 9.4 | 41.8 | 1870 | 1 | |

The A/B on the worktree server puts the changed build 3.6 points *below* the unchanged one and 0.2 above the daemon baseline — run-to-run spread on this box, not a signal (the GPU column swings 11–51% between identical pages: software rendering). No regression: the new code has no steady-state path. `xtermScreens` is 1 in every run. The worktree server was `rk-wt serve` on port 3777 with the Go embed dir empty, so it served `app/frontend/dist` from disk and only `dist` was swapped between the two worktree rows.

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | The one-shot flag is reset in tests through an exported `resetWebglFallbackNoticeForTests()` rather than `vi.resetModules()` | The file already carries test-only surface (`__rkTerminals`); a named reset keeps the existing mock/harness setup intact, whereas `vi.resetModules()` would force dynamic re-imports across a 1800-line test file | S:70 R:95 A:85 D:75 |
| 2 | Certain | The load-time failure path reads the count after its own `setActiveRenderer("canvas")` so it counts itself, matching the context-loss path | Both messages then mean the same thing ("terminals live including this one") | S:80 R:95 A:90 D:90 |
| 3 | Confident | The *before* instrument line is taken from `/rK/@8` (an idle window on the live `rK` server) with `--url http://127.0.0.1:3000` | `rk url` in this worktree reports the worktree's derived port, not the :3000 daemon; a missing route pins the renderer at 100%, so a verified live window is used | S:75 R:95 A:85 D:85 |

3 assumptions (1 certain, 2 confident, 0 tentative).
