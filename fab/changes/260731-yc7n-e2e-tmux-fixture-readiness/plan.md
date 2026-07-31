# Plan: E2E Tmux Fixture + Readiness Consolidation

**Change**: 260731-yc7n-e2e-tmux-fixture-readiness
**Intake**: `intake.md`

## Requirements

All work is confined to `app/frontend/tests/e2e/` — test infrastructure only, zero production code.

### File matrix (re-derived by grep at apply entry, 2026-07-31)

- **`TMUX_SERVER` declarations** (`process.env.E2E_TMUX_SERVER`, 41 spec files): api-integration, board-autofit, board-close-and-unpin, board-list-reorder, board-reorder, boards-desktop-suspend, boards-mobile, boards-multi-server, boards-pin-flow, boards-same-session-multi-pane, bottom-bar-chip-size, compose-strip, connection-budget, create-server-waiting, echo-latency, host-health-home, mobile-layout, mobile-touch-scroll, multi-server-sidebar, new-window-unnamed, server-panel-grid, server-reorder, session-reorder, session-tiles, sessions-scope-toggle, settings-dialog, shell-rotation, sidebar-autoscroll, sidebar-footer, sidebar-keyboard-nav, sidebar-panels, sidebar-window-sync, sse-connection, sync-latency, tooltips, top-bar-overflow, top-bar-overlap, web-view-lens, window-heading, window-marker-gutter, window-switch-transition.
- **Lifecycle files** (`new-session` in beforeAll/afterAll, 35 files): the decl list minus bottom-bar-chip-size, create-server-waiting, mobile-layout, server-reorder, sidebar-footer, tooltips.
- **Second-server files** (`TMUX_SERVER_A`, 4): multi-server-sidebar, sessions-scope-toggle, boards-multi-server, create-server-waiting. `connection-budget` confirmed single-server (intake assumption 9 verified).
- **Inline Connected-dot gates** (48 sites across 20 files): new-window-unnamed(1), connection-budget(4), create-server-waiting(2), api-integration(1), server-reorder(1), session-reorder(2), server-panel-grid(3), sessions-scope-toggle(4), sidebar-window-sync(5), window-marker-gutter(4), multi-server-sidebar(2), sidebar-panels(5), session-tiles(1), sidebar-footer(2), sidebar-keyboard-nav(1), window-heading(2), settings-dialog(5), sync-latency(1), sse-connection(1), web-view-lens(1).
- **Local `/api/sessions` window-resolver copies** (9 files): window-marker-gutter, sidebar-window-sync, web-view-lens, compose-strip, sidebar-keyboard-nav, mobile-touch-scroll, session-tiles, echo-latency, window-switch-transition. (Excluded: new-window-unnamed and shortcut-registry use route mocks; board-close-and-unpin's `listed` is presence-check semantics; session-reorder POSTs order.)
- **Existing `_ready` importers using `resolveWindow`** (5 files): boards-pin-flow, sidebar-autoscroll, top-bar-overlap, top-bar-overflow, window-heading.
- **Sync `list-windows -F` parse sites** (13 files): boards-multi-server, board-reorder, connection-budget, boards-same-session-multi-pane, board-list-reorder, board-autofit, boards-desktop-suspend, board-close-and-unpin, boards-mobile, boards-pin-flow, shell-rotation, settings-dialog, sidebar-panels.
- **Untouched** (no decl, no lifecycle, 14 files): agent-next-waiting, chat-view, macro-riff-bindings, open-in-app, pane-register-panel, pr-status-sidebar, pwa-assets, row-minimalism, shortcut-registry, smoke, spawn-agent, status-dot-tip, top-bar-persistence, top-bar-refresh.

### Fixture: `tests/e2e/_tmux.ts`

#### R1: Single tmux helper module
A new `app/frontend/tests/e2e/_tmux.ts` SHALL export `TMUX_SERVER` (`process.env.E2E_TMUX_SERVER ?? "rk-test-e2e"`) plus lifecycle helpers: `createSession(session, opts?)`, `killSession(session, server?)`, `killServer(server)`, `newWindow(session, name, opts?)`, `listWindows(session, server?)`, and a low-level `tmux(args, opts?)` runner. All subprocess calls SHALL use `execFileSync("tmux", [...])` with argument arrays (no shell-string construction).

- **GIVEN** a spec needing a tmux session with N named windows and per-window idle commands
- **WHEN** its `beforeAll` calls `createSession(SESSION, { windows: [{ name, command }...] })`
- **THEN** the session exists on `TMUX_SERVER` at 80x24 with the first window created via `new-session -n` and the rest via `new-window`, each running its command
- **AND** `afterAll` calling `killSession(SESSION)` tears it down best-effort (no throw when already gone)

#### R2: Exact-match session targets
Every window-scoped tmux command inside `_tmux.ts` (`new-window`, `list-windows`) MUST target the session as `=${session}:` (exact-match, session-qualified) or use `@`/`$` ids — never bare `-t ${session}`.

- **GIVEN** a tmux server where a window is named identically to another session
- **WHEN** `newWindow`/`listWindows` run against the intended session
- **THEN** the command binds to the exact-named session, not a same-named window

#### R3: Second-server + idle-command layers
`createSession`/`killSession`/`newWindow`/`listWindows` SHALL accept an optional `server` override (defaulting to `TMUX_SERVER`) covering the A/B second-server specs, and `killServer(server)` SHALL provide the best-effort `kill-server` teardown. Idle commands are parameterized per window (`command` per window entry), not a fixed string.

- **GIVEN** `multi-server-sidebar` creating sessions on `TMUX_SERVER_A` and a scratch `TMUX_SERVER_B`
- **WHEN** setup passes `{ server: TMUX_SERVER_B }` and teardown calls `killServer(TMUX_SERVER_B)`
- **THEN** behavior matches today's per-file copies (create on B, kill whole scratch server)

#### R4: All spec files consume `_tmux.ts`
The 40 decl files SHALL import `TMUX_SERVER` from `./_tmux` (zero remaining `process.env.E2E_TMUX_SERVER` declarations in `*.spec.ts`), and the 35 lifecycle files SHALL replace their copied beforeAll/afterAll tmux blocks with `_tmux` helper calls. Fixture-time window loops move into `createSession`'s `windows` option; mid-test `new-window`/`list-windows` `execSync` calls in migrated files move to `newWindow`/`listWindows`. Board specs' post-teardown HTTP API cleanup stays in each spec's `afterAll` (ordered before/after `killSession` exactly as today) — no fixture hook layer. Session-scoped `send-keys` calls stay inline (pane targets — not part of the window-target hazard).

- **GIVEN** the migration is complete
- **WHEN** grepping `*.spec.ts` for `process.env.E2E_TMUX_SERVER`, lifecycle `new-session` execSync copies, and bare `-t ${...}` `new-window`/`list-windows` targets
- **THEN** zero hits remain (global-teardown.ts, a non-spec Node teardown, keeps its own env read)

### Readiness: `tests/e2e/_ready.ts`

#### R5: Inline Connected gates migrate to `_ready`
The 48 inline `expect(page.locator("[aria-label='Connected']")).toBeVisible({ timeout: 10_000 })` waits across 20 files SHALL be replaced: `goto(/${server})`+gate → `gotoServerReady`; `goto(/${server}/${id})`+gate → `gotoWindow`; gates not paired with a matching goto (post-reload, post-click, non-standard routes) keep the inline expect but use imported `READY_TIMEOUT`. `gotoWindow`'s own hardcoded `10_000` becomes `READY_TIMEOUT`. Mobile-viewport specs are not migrated onto the Connected gate (none of the 20 files is mobile-viewport; boards-mobile/mobile-layout/mobile-touch-scroll keep their always-mounted gates).

- **GIVEN** CI sets `CI=1` so `READY_TIMEOUT` is 20s
- **WHEN** any migrated spec waits for readiness
- **THEN** the wait uses the CI-widened 20s, not a hardcoded 10s

#### R6: `resolveWindow` returns the full window object
`_ready.resolveWindow(page, server, session, windowName?)` SHALL return the full snapshot window (`{ windowId, index, name, marker?, color? }`); omitting `windowName` resolves the session's first window. The 9 local poll copies are deleted and their call sites migrated (projections like `.windowId`, `.index`, `.marker` happen at the caller). The 5 existing importer files update their call sites/wrappers for the new return type. `echo-latency`/`mobile-touch-scroll` drop their absolute-`BASE` resolver copies — `page.request` honors the Playwright `baseURL`, so the shared relative-path helper works.

- **GIVEN** window-marker-gutter needing `{windowId, index, marker, color}` and session-tiles needing the first window's `{windowId, index}`
- **WHEN** both call the shared `resolveWindow` (with and without `windowName`)
- **THEN** each gets its projection from the one shared poll implementation

### Verification & Docs

#### R7: Companion docs updated only where setup/steps change
Sibling `.spec.md` files SHALL be updated only where a Shared setup description or test step no longer matches the migrated code (constitution § Test Companion Docs). Pure mechanical helper swaps that leave behavior and steps identical require no companion edit.

- **GIVEN** a migrated spec whose `.spec.md` Shared setup describes behavior ("creates a session with 6 idle windows")
- **WHEN** the fixture swap preserves that behavior
- **THEN** the companion is left untouched; only mismatching descriptions are edited

#### R8: Suite verification
The change SHALL pass `cd app/frontend && npx tsc --noEmit` and `just test-e2e` (full suite, serial, box-wide mutex), modulo the known pre-existing failures (max-update-depth console errors in window-heading/window-switch-transition/sync-latency, window-heading history-arrows forward-nav timeout, multi-server-sidebar:70 expand race). Never raw playwright; never `just pw` in this environment.

- **GIVEN** the migration is complete
- **WHEN** `just test-e2e` runs
- **THEN** no NEW failures relative to the known pre-existing list

### Non-Goals

- No Playwright `test.extend` fixture object — helpers stay a callable pair used from existing beforeAll/afterAll hooks (least-churn shape; `2kio`'s `_boards.ts` builds on this later).
- No consolidation of ad-hoc `send-keys`, `capture-pane`, or the untouched 14 spec files.
- No production code, no `docs/memory/` changes.

## Tasks

### Phase 1: Helpers

- [x] T001 Create `app/frontend/tests/e2e/_tmux.ts`: `TMUX_SERVER`, low-level `tmux()` (execFileSync arg arrays, `stdio` per caller), `createSession` (best-effort pre-kill, `new-session -d -x 80 -y 24` with optional first-window name/command, `new-window` loop for the rest, whole setup best-effort like the copied pattern), `killSession`, `killServer`, `newWindow`, `listWindows` returning `{ windowId, name }[]`; all window-scoped targets `=${session}:` <!-- R1, R2, R3 -->
- [x] T002 Extend `app/frontend/tests/e2e/_ready.ts`: add `SnapshotWindow` type; `resolveWindow` returns the full window with optional `windowName` (absent → first window); `gotoWindow` uses `READY_TIMEOUT` <!-- R5, R6 -->
- [x] T003 Update the 5 existing `resolveWindow` importers for the new return type (project `.windowId` at wrappers/call sites): boards-pin-flow, sidebar-autoscroll, top-bar-overlap, top-bar-overflow, window-heading <!-- R6 -->

### Phase 2: Spec migration (per file: decl→import, lifecycle→createSession/killSession, window loops→`windows` option, mid-test new-window/list-windows→helpers, Connected gates→_ready, local resolvers→resolveWindow)

- [x] T004 Board cluster: board-autofit, board-reorder, board-close-and-unpin, board-list-reorder, boards-pin-flow, boards-desktop-suspend, boards-mobile (keep always-mounted mobile gates), boards-same-session-multi-pane, boards-multi-server <!-- R4, R5, R6 -->
- [x] T005 Multi-server/scope cluster: multi-server-sidebar, sessions-scope-toggle, create-server-waiting, connection-budget <!-- R3, R4, R5 -->
- [x] T006 Sidebar cluster: sidebar-panels, sidebar-window-sync, sidebar-keyboard-nav, sidebar-autoscroll, sidebar-footer <!-- R4, R5, R6 -->
- [x] T007 Window/top-bar cluster: window-heading, window-marker-gutter, window-switch-transition, top-bar-overlap, top-bar-overflow, new-window-unnamed <!-- R4, R5, R6 -->
- [x] T008 Session/server cluster: session-tiles, session-reorder, server-panel-grid, server-reorder, sse-connection, api-integration, host-health-home, settings-dialog, shell-rotation, sync-latency <!-- R4, R5, R6 -->
- [x] T009 Remaining decl files: compose-strip, echo-latency, mobile-touch-scroll, web-view-lens, tooltips, mobile-layout, bottom-bar-chip-size <!-- R4, R5, R6 -->

### Phase 3: Integration & Edge Cases

- [x] T010 Sweep verification: grep `*.spec.ts` for zero `process.env.E2E_TMUX_SERVER`, zero inline Connected+`10_000` gates, zero local `/api/sessions` window-resolver loops, zero bare `-t ${...}` on `new-window`/`list-windows`; run `cd app/frontend && npx tsc --noEmit` <!-- R4, R5, R8 -->
- [x] T011 Companion-doc pass: diff each migrated spec's `.spec.md` Shared setup / steps against the new code; edit only mismatches <!-- R7 -->

### Phase 4: Verification

- [x] T012 Run `just test-e2e` (full suite, single serial invocation); triage failures against the known pre-existing list; fix regressions caused by this change <!-- R8 -->

## Execution Order

- T001–T002 block everything; T003 depends on T002
- T004–T009 are independent of each other (disjoint file sets) but sequential in practice (single worker)
- T010–T011 after all migrations; T012 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `_tmux.ts` exists exporting `TMUX_SERVER`, `createSession`, `killSession`, `killServer`, `newWindow`, `listWindows`, all via `execFileSync` argument arrays
- [x] A-002 R4: zero `process.env.E2E_TMUX_SERVER` declarations remain in `*.spec.ts`; all 35 lifecycle files use `_tmux` helpers for session setup/teardown
- [x] A-003 R5: zero inline `[aria-label='Connected']` waits with hardcoded `10_000` remain in `*.spec.ts`; `gotoWindow` uses `READY_TIMEOUT`
- [x] A-004 R6: `resolveWindow` returns the full window object (optional `windowName` → first window); the 9 local resolver copies are gone

### Behavioral Correctness

- [x] A-005 R2: no bare `-t ${session}` window-scoped targets (`new-window`, `list-windows`) remain in `_tmux.ts` or migrated specs — all `=name:` or id-based
- [x] A-006 R3: the 4 `TMUX_SERVER_A` specs create/tear down their scratch server through `_tmux` (`killServer`), preserving today's A/B behavior; idle commands remain per-window (sleep 300 / printf+sleep 120 / marker+sleep 60 variants preserved)
- [x] A-007 R5: mobile-viewport specs (boards-mobile, mobile-layout, mobile-touch-scroll) still gate on always-mounted elements, not the Connected dot

### Scenario Coverage

- [x] A-008 R8: `just test-e2e` full suite passes with no NEW failures vs the known pre-existing list; `npx tsc --noEmit` clean

### Edge Cases & Error Handling

- [x] A-009 R1: `killSession`/`killServer` are best-effort (already-dead session/server does not throw); `createSession` pre-kills so duplicate names cannot fail setup

### Code Quality

- [x] A-010 Pattern consistency: `_tmux.ts` follows the `_ready.ts` underscore-helper convention (header doc comment, named exports, no default export)
- [x] A-011 No unnecessary duplication: specs reuse `_tmux`/`_ready` helpers rather than local copies; no new near-duplicate helpers introduced
- [x] A-012 R7: `.spec.md` companions updated exactly where Shared setup/steps descriptions changed, and nowhere else

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)

## Deletion Candidates

- `app/frontend/tests/e2e/_tmux.ts:41` (`tmux()` export) — mandated by R1, but zero `*.spec.ts` files import it; it is used only as `_tmux.ts`'s internal implementation seam. Dropping `export` (keeping the function module-private) would shrink the public helper surface `2kio`/`_boards.ts` has to reason about. Defer if `_boards.ts` is expected to consume it.
- `app/frontend/tests/e2e/create-server-waiting.spec.ts:11`, `boards-multi-server.spec.ts:4`, `multi-server-sidebar.spec.ts:5`, `sessions-scope-toggle.spec.ts:5` (`const TMUX_SERVER_A = TMUX_SERVER;`) — a pure re-alias left behind by the migration; the `_A` suffix only earned its name when it sat next to a local `process.env` read. Call sites could use `TMUX_SERVER` directly (`TMUX_SERVER_B` stays, it is a genuinely distinct scratch socket).
- `app/frontend/tests/e2e/echo-latency.spec.ts:93` (local `tmux(cmd)` shell-string runner) — now only carries `send-keys`/`capture-pane`; R4 deliberately scoped those out, so this survives by design. Revisit if a future change extends `_tmux.ts` to pane-scoped commands.
- `app/frontend/tests/e2e/window-marker-gutter.spec.ts` (`expectMarker`/`expectColor` `/api/sessions` polls) — NOT redundant: these are poll-until-equals assertions, semantically distinct from `resolveWindow`'s poll-until-found. Listed only to record that the review checked them.

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Helper-pair shape (functions called from existing beforeAll/afterAll), not a Playwright `test.extend` fixture | Intake leaves shape to apply; helper pair is least-churn across 35 files and matches how specs are structured today | S:70 R:85 A:85 D:70 |
| 2 | Confident | `_tmux.ts` uses `execFileSync` argument arrays instead of `execSync` shell strings | Constitution's no-shell-strings principle (spirit), kills quoting hell for idle commands; new-window-unnamed already does this | S:65 R:85 A:90 D:80 |
| 3 | Confident | Window shell commands pass through as a single tmux argument (tmux wraps with `sh -c`), preserving today's `sh -c '...'` strings byte-identically | Matches current double-wrap behavior exactly; zero behavioral delta | S:60 R:85 A:85 D:75 |
| 4 | Confident | Board specs' HTTP unpin/cleanup stays in each spec's afterAll (no fixture hook layer) | Cleanup needs per-spec board names + request fixture; a hook layer adds indirection for 3 files with no dedupe win | S:55 R:85 A:80 D:70 |
| 5 | Confident | Mid-test `new-window`/`list-windows` execSync calls in migrated files also move to `_tmux` helpers | Same window-target hazard the intake mandates fixing; mechanical swap while files are open anyway | S:60 R:80 A:85 D:75 |
| 6 | Confident | `echo-latency`/`mobile-touch-scroll` absolute-`BASE` resolvers migrate to the shared relative-path helper | Playwright config sets `baseURL`; `page.request` resolves relative URLs against it — no base-URL param needed | S:60 R:80 A:85 D:75 |
| 7 | Certain | Session-scoped `send-keys` and other ad-hoc pane-target tmux calls stay inline in specs | Outside intake scope; pane targets are not the window-target hazard | S:80 R:90 A:90 D:85 |
| 8 | Confident | Connected gates not paired with a matching `goto` keep their inline expect, switching only to `READY_TIMEOUT` | `gotoServerReady`/`gotoWindow` bundle a navigation; forcing them onto reload/click sites would change behavior | S:65 R:85 A:85 D:75 |

8 assumptions (1 certain, 7 confident, 0 tentative).
