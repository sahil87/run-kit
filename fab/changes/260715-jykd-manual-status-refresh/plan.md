# Plan: Manual Status Refresh

**Change**: 260715-jykd-manual-status-refresh
**Intake**: `intake.md`

## Requirements

### Backend: On-demand branch-refresher kick

#### R1: `BranchRefresher` gains an exported `RefreshNow`
`BranchRefresher` SHALL expose an exported `RefreshNow(ctx context.Context)` method that triggers an on-demand re-resolve of every registered `(repo, branch)` pair by delegating to the existing unexported `refresh(ctx)`, mirroring `Collector.RefreshNow` (`internal/prstatus/prstatus.go:119`). It MUST be best-effort — errors are swallowed per pair (stale-while-revalidate), exactly as the tick-driven path already behaves.

- **GIVEN** a `BranchRefresher` with one or more registered pairs
- **WHEN** `RefreshNow(ctx)` is called
- **THEN** `refresh(ctx)` runs a re-resolve pass over the live pairs
- **AND** a transient `gh` error on any pair keeps that pair's last-good entry rather than downgrading it

### Backend: Composing refresh endpoint `POST /api/status/refresh`

#### R2: New endpoint kicks BOTH pollers
The server SHALL register `POST /api/status/refresh` → `handleStatusRefresh` and this handler SHALL kick BOTH the viewer-wide collector (`prstatus.Collector.RefreshNow`) AND the branch refresher (`BranchRefresher.RefreshNow`). The viewer collector supplies the merged state via its URL-keyed join; the branch refresher covers the sibling case (a just-opened PR appearing on a window). The collector kick MUST be nil-guarded (the test router wires no collector), matching `handlePRStatusRefresh` today. POST per Constitution §IX (mutating endpoints use POST). The naming is "status" (not "pane"): "pane" collides with the tmux-pane meaning in this codebase.

- **GIVEN** a running server with both pollers wired
- **WHEN** a client POSTs `/api/status/refresh`
- **THEN** both `RefreshNow` seams are invoked (asynchronously — see R3)
- **GIVEN** a server with no collector wired (test router)
- **WHEN** a client POSTs `/api/status/refresh`
- **THEN** the handler does not panic and still returns 202 (branch kick still fires)

#### R3: Non-blocking, returns 202 immediately via a detached goroutine
`handleStatusRefresh` SHALL start the two refreshes in a DETACHED goroutine and return `202 Accepted` WITHOUT waiting for the refreshes to finish. The detached goroutine MUST use a fresh `context.Background()` bounded by its own timeout — NOT `r.Context()` (which is cancelled the moment the handler returns), copying the detached-goroutine pattern in `api/waiting_push.go`. The branch refresher's pass is one `gh pr list` per registered pair and can exceed the 5s handler-blocking cap (`code-review.md`); the 202-then-detach shape keeps the handler well under that cap. The response body is never what the UI waits on — fresh data reaches clients via the existing SSE stream (~2.5s cadence).

- **GIVEN** a client POSTs `/api/status/refresh`
- **WHEN** the handler runs
- **THEN** it responds `202 Accepted` immediately, before the refreshes complete
- **AND** the refreshes run on a goroutine whose context is derived from `context.Background()` (survives handler return) with a bounded timeout (~60s)

#### R4: Coalescing + server-side min-interval throttle (single choke point)
`handleStatusRefresh` SHALL be the single frequency-control choke point for forced refreshes:
- **Coalescing**: if a forced refresh is already in flight, the handler returns 202 WITHOUT starting another.
- **Min-interval throttle**: the handler SHALL enforce a minimum interval (default 10 seconds) between forced refreshes; a call arriving within that window returns 202 WITHOUT starting a refresh.
Both throttled and coalesced calls return 202 — the client never distinguishes started/coalesced/throttled (fire-and-forget semantics). This makes ANY trigger (button-mashing, multiple tabs, future auto-triggers) safe to over-fire.

- **GIVEN** a forced refresh is currently in flight
- **WHEN** a second POST arrives
- **THEN** the handler returns 202 and does NOT start a second refresh
- **GIVEN** a refresh completed less than the min-interval ago
- **WHEN** another POST arrives
- **THEN** the handler returns 202 and does NOT start a refresh
- **GIVEN** more than the min-interval has elapsed and nothing is in flight
- **WHEN** a POST arrives
- **THEN** the handler starts a new refresh and returns 202

#### R5: Testability seam
The two kicks SHALL be injectable so handler tests can assert both fire without spawning `gh`. Injection is via function fields on `api.Server` (defaulting to the real kicks in `NewRouterAndServer`), mirroring the existing collector-injection house pattern. The coalescing + throttle state (mutex, last-refresh timestamp, in-flight flag) lives on `api.Server` so it is per-server and testable. A test clock seam SHALL allow deterministic min-interval assertions without real sleeps.

- **GIVEN** a test wires recorder functions into the kick seams
- **WHEN** the handler runs a refresh
- **THEN** the test can observe both kicks were invoked, without any `gh` subprocess

### Backend: Retire the orphaned old endpoint

#### R6: Delete `POST /api/pr-status/refresh` and its handler
The route registration `r.Post("/api/pr-status/refresh", s.handlePRStatusRefresh)` (`api/router.go`) and the `handlePRStatusRefresh` handler (`api/pr_status.go`) SHALL be removed. `api/pr_status.go` holds only that handler, so the whole file is deleted; its test `TestHandlePRStatusRefreshReturnsOK` (`api/pr_status_test.go`) is removed and replaced by the new handler's tests. The remaining tests in `pr_status_test.go` (the `attachPRStatus` tests) are unrelated to the endpoint and MUST be preserved (moved intact into a retained/renamed test file).

- **GIVEN** the change is applied
- **WHEN** a client POSTs `/api/pr-status/refresh`
- **THEN** the route is gone (404) — the endpoint no longer exists
- **AND** the `attachPRStatus` test coverage still exists and passes

### Frontend: Retire `PrStatusLine` and repoint client wiring

#### R7: Remove the `PrStatusLine` component (its only consumer of the old endpoint)
The `PrStatusLine` React component SHALL be removed along with the helpers used ONLY by it (`stateGlyph`, `summarySegments`) and the `refreshPrStatus` import. `PrStatusLine` has zero live mount sites (all remaining references are prose comments). Because `pr-status-line.tsx` ALSO exports the shared PR color vocabulary (`PR_STATE_COLORS`/`PR_CHECKS_COLORS`/`PR_REVIEW_COLORS`), the lifecycle status-dot model (`statusDotState`, `fabPhase`, `fabShape`, `prShape`, `PHASE_HUE`, `prDotState`, `isFailish`, `DotShape`, `DotPhase`, `StatusDotState`, `PrDotState`) — all still consumed by `status-panel.tsx`, `status-dot.tsx`, `status-dot-tip.tsx`, `status-dot-label.ts`, and `status-dot.test.tsx` — the FILE MUST NOT be deleted wholesale. Only the `PrStatusLine`-specific code is removed; every other export stays. The `PrStatusLine`-specific test cases in `pr-status-line.test.tsx` are removed; the `prDotState precedence` describe block (which exercises retained exports) is preserved.

- **GIVEN** the change is applied
- **WHEN** the frontend builds and type-checks
- **THEN** `PrStatusLine` no longer exists and no live code imports it
- **AND** every other export of `pr-status-line.tsx` remains and its consumers compile

#### R8: Repoint the client to the new endpoint
`refreshPrStatus()` in `api/client.ts` SHALL be renamed to `refreshStatus()` targeting `/api/status/refresh`, with its doc comment updated to reflect the new behavior (kicks both pollers, returns 202, fresh data arrives via SSE, best-effort/fire-and-forget).

- **GIVEN** a caller invokes `refreshStatus()`
- **WHEN** it runs
- **THEN** it POSTs `/api/status/refresh` and resolves best-effort (a non-2xx is tolerated by callers)

### Frontend: Refresh button on the PANE section header

#### R9: PANE header refresh button with busy state
`WindowPanel` (`components/sidebar/status-panel.tsx`) SHALL render a refresh button at the top-right of the PANE section header via `CollapsiblePanel`'s `headerAction` prop (the purpose-built seam whose clicks are stopped from toggling the panel). The button SHALL trigger `refreshStatus()`, show a busy/spinner state while the POST is in flight, and clear busy when the POST settles (fresh state lands via SSE within ~2.5s after). It SHALL follow the CRT-glint button treatment (`rk-glint`) matching the top-bar/board `RefreshButton` affordance vocabulary. The button SHALL render whenever the PANE panel header renders (including with no window selected) — the refresh is server-global.

- **GIVEN** the PANE panel is rendered
- **WHEN** the user clicks the header refresh button
- **THEN** `refreshStatus()` is invoked and the button enters a busy state
- **WHEN** the POST settles
- **THEN** the busy state clears
- **AND** the button click does NOT toggle the panel open/closed

### Frontend: Command palette action

#### R10: `PR: Refresh Status` palette action
A command-palette action labeled `PR: Refresh Status` SHALL trigger the same `refreshStatus()` POST, satisfying Constitution §V (keyboard-first: any new user-facing action MUST be palette-reachable). It SHALL follow the established pure-builder pattern (`lib/palette-*.ts` with a colocated `.test.ts`) and be registered into the AppShell palette action aggregation in `app.tsx`.

- **GIVEN** the command palette is open in the AppShell
- **WHEN** the user selects `PR: Refresh Status`
- **THEN** `refreshStatus()` is invoked

### Non-Goals

- **Refresh on tab `visibilitychange` (refetch-on-focus)** — explicitly deferred out of v1 (refresh-frequency concern); the server-side min-interval makes it a safe follow-up later.
- **Lowering the 90s/30s poll intervals** — rejected in favor of the manual affordance.
- **Refreshing the other PANE registers (out/agt/fab)** — already fresh within ~7.5s worst case (5s fab pane-map cache + 2.5s SSE); the affordance is labeled around PR/status freshness and does not promise "refresh all pane stats".

### Design Decisions

1. **Composing endpoint over extending the orphan**: new `POST /api/status/refresh` + `handleStatusRefresh` kicks both pollers — *Why*: single choke point, minimal surface (Constitution IV) — *Rejected*: extending/nesting `handlePRStatusRefresh` (it only kicks one poller, blocks synchronously, and its sole frontend consumer is dead).
2. **"status" naming, not "pane"**: *Why*: "pane" means a tmux pane in this codebase; "status" matches the established vocabulary (status pyramid, StatusDot) — *Rejected*: `handlePaneRefresh`.
3. **202 + detached goroutine**: *Why*: the branch pass can exceed the 5s handler cap; `waiting_push.go` has the exact `context.Background()` detached pattern — *Rejected*: blocking synchronously (would risk the 5s cap with many windows).
4. **Coalesce + min-interval in the handler**: *Why*: makes any trigger safe to over-fire; keeps client fire-and-forget — *Rejected*: client-side debounce (would not protect against multiple tabs / future auto-triggers).
5. **Kick seams as `api.Server` function fields + per-server throttle state**: *Why*: the collector-injection house pattern; coalesce/throttle need per-server mutable state — *Rejected*: package-var seams (can't hold per-server throttle state cleanly).
6. **Surgically remove `PrStatusLine`, not the whole file**: *Why*: `pr-status-line.tsx` is the single source of truth for the shared PR color vocabulary AND the lifecycle status-dot model, both still consumed by five other modules — *Rejected*: deleting the file wholesale (would break `status-panel.tsx`, `status-dot.tsx`, `status-dot-tip.tsx`, `status-dot-label.ts`, `status-dot.test.tsx`). See Assumptions row 3.

### Deprecated Requirements

#### Old synchronous single-poller refresh endpoint
**Reason**: `POST /api/pr-status/refresh` only kicked the viewer collector, blocked synchronously, and its sole frontend consumer (`PrStatusLine`) has zero live mount sites.
**Migration**: replaced by `POST /api/status/refresh` (both pollers, 202 detached, coalesced + throttled) and `refreshStatus()`.

## Tasks

### Phase 1: Backend — on-demand seam

- [x] T001 Add exported `RefreshNow(ctx context.Context)` to `BranchRefresher` in `app/backend/internal/prstatus/prstatus_branch.go`, delegating to `refresh(ctx)`, doc-commented to mirror `Collector.RefreshNow`. <!-- R1 -->
- [x] T002 Add a `RefreshNow` test to `app/backend/internal/prstatus/prstatus_branch_test.go` — assert a registered pair is re-resolved on demand (stub `exec`, assert the entry updates) and that a transient error keeps last-good. <!-- R1 -->

### Phase 2: Backend — composing endpoint

- [x] T003 Add throttle/coalesce state + kick seams to `app/backend/api/router.go` `Server`: fields `refreshStatusMu sync.Mutex`, `refreshStatusInFlight bool`, `refreshStatusLast time.Time`, injectable `refreshCollectorFn func(context.Context)` + `refreshBranchFn func(context.Context)`, and a `nowFn func() time.Time` clock seam (default `time.Now`). Wire the real kicks in `NewRouterAndServer` (`refreshCollectorFn` nil-guards `s.prStatus.RefreshNow`; `refreshBranchFn` → `prstatus.DefaultBranchRefresher.RefreshNow`). Add a named `statusRefreshMinInterval = 10 * time.Second` constant and a `statusRefreshTimeout = 60 * time.Second` constant. <!-- R2 R4 R5 -->
- [x] T004 Create `app/backend/api/status_refresh.go` with `handleStatusRefresh`: coalesce (skip if in-flight) + min-interval throttle under `refreshStatusMu`; on pass, mark in-flight, set last-refresh time, launch a detached goroutine (`context.Background()` + `statusRefreshTimeout`) that calls both kick seams then clears the in-flight flag; return `202 Accepted` in all cases (started/coalesced/throttled). POST per §IX. <!-- R2 R3 R4 -->
- [x] T005 Register `r.Post("/api/status/refresh", s.handleStatusRefresh)` in `app/backend/api/router.go` and DELETE the `r.Post("/api/pr-status/refresh", s.handlePRStatusRefresh)` registration. <!-- R2 R6 -->
- [x] T006 Delete `app/backend/api/pr_status.go` (whole file — it holds only `handlePRStatusRefresh`). <!-- R6 -->

### Phase 3: Backend — tests

- [x] T007 Create `app/backend/api/status_refresh_test.go`: (a) 202 returned immediately; (b) both kick seams invoked (via injected recorder fns on the test server — add a small test-router variant or set the fields post-construction); (c) coalescing (second call while in-flight starts no second refresh); (d) min-interval throttle (a call within `statusRefreshMinInterval`, using the injected clock, starts no refresh; a call past it does). Wait on the detached goroutine deterministically (e.g. a done-channel recorder), no real sleeps. <!-- R2 R3 R4 R5 -->
- [x] T008 In `app/backend/api/pr_status_test.go`: remove `TestHandlePRStatusRefreshReturnsOK` and the now-unused `encoding/json`/`net/http`/`httptest` imports IF they become unused; PRESERVE the `attachPRStatus` tests intact (rename the file to `status_pr_attach_test.go` if the `pr_status.go` deletion makes the filename misleading — optional, keep coverage either way). <!-- R6 -->

### Phase 4: Frontend — client + component + palette

- [x] T009 In `app/frontend/src/api/client.ts`: rename `refreshPrStatus()` → `refreshStatus()` targeting `/api/status/refresh`; update the doc comment (kicks both pollers, 202, data via SSE, best-effort fire-and-forget). <!-- R8 -->
- [x] T010 In `app/frontend/src/components/pr-status-line.tsx`: remove the `PrStatusLine` component, the `stateGlyph` + `summarySegments` helpers (used only by it), and the `refreshPrStatus` import. Keep ALL other exports (`PR_STATE_COLORS`/`PR_CHECKS_COLORS`/`PR_REVIEW_COLORS`, `isFailish`, `prDotState`, `PrDotState`, `statusDotState`, `fabPhase`, `fabShape`, `prShape`, `PHASE_HUE`, `DotShape`, `DotPhase`, `StatusDotState`) unchanged. Tidy the file's header doc comment to drop the now-stale `PrStatusLine` narration. <!-- R7 -->
- [x] T011 In `app/frontend/src/components/pr-status-line.test.tsx`: remove the `describe("PrStatusLine", ...)` block and the `refreshPrStatus` mock/import; keep `describe("prDotState precedence", ...)` and the `makeWindow` helper. <!-- R7 -->
- [x] T012 Create `app/frontend/src/lib/palette-status-refresh.ts` (pure builder returning the `PR: Refresh Status` action given an `onSelect`) + colocated `palette-status-refresh.test.ts`. <!-- R10 -->
- [x] T013 Add the PANE header refresh button to `app/frontend/src/components/sidebar/status-panel.tsx` `WindowPanel`: pass a `headerAction` (a `rk-glint` icon button matching top-bar `RefreshButton`) that calls `refreshStatus()`, tracks a local busy state (`useState`) around the in-flight POST (busy true on click, cleared on settle), and is disabled/spinner-styled while busy. Renders regardless of `win === null`. <!-- R9 -->
- [x] T014 Wire the palette action into `app/frontend/src/app.tsx`: build it via `buildStatusRefreshAction` (calling `refreshStatus()` best-effort), memoize as a `PaletteAction[]` group, and include it in the `allActions` aggregation memo (both the array spread and its dependency list). <!-- R10 -->

### Phase 5: Component tests

- [x] T015 [P] Add/extend a colocated test for the PANE header button (`app/frontend/src/components/sidebar/status-panel.test.tsx` — create if absent): mock `@/api/client` `refreshStatus`, render `WindowPanel`, click the header button, assert `refreshStatus` fired and busy state applied; assert the click does not toggle the panel. <!-- R9 -->

## Execution Order

- T001 → T002 (test follows method).
- T003 blocks T004, T005, T007 (seams/state/constants must exist first).
- T005 and T006 are the route+file removal; do together to keep the build green.
- T009 (client rename) blocks T012–T015 (they call `refreshStatus`).
- T010 blocks T011 (component removal before its test edit).
- Backend phases (1–3) and frontend phases (4–5) are independent and may proceed in either order; keep each side's build green before moving on.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `BranchRefresher.RefreshNow(ctx)` exists, is exported, delegates to `refresh(ctx)`, and is covered by a unit test.
- [x] A-002 R2: `POST /api/status/refresh` is registered and `handleStatusRefresh` invokes BOTH the collector kick (nil-guarded) and the branch kick.
- [x] A-003 R3: the handler returns `202 Accepted` immediately and runs the refreshes on a `context.Background()`-derived, timeout-bounded detached goroutine (never `r.Context()`).
- [x] A-004 R4: coalescing (no second in-flight refresh) and a 10s min-interval throttle are enforced in the handler; throttled/coalesced calls still 202.
- [x] A-005 R5: the two kicks are injectable seams on `api.Server` and the handler tests assert both fire without spawning `gh`, using a clock seam for the throttle.
- [x] A-006 R8: `refreshStatus()` in `client.ts` POSTs `/api/status/refresh`; `refreshPrStatus` no longer exists.
- [x] A-007 R9: the PANE header renders a `rk-glint` refresh button (via `headerAction`) that calls `refreshStatus()`, shows a busy state, and does not toggle the panel.
- [x] A-008 R10: a `PR: Refresh Status` palette action exists (pure builder + colocated test) and is wired into the AppShell palette aggregation.

### Behavioral Correctness

- [x] A-009 R3: with many registered windows the handler does not block on the branch pass (returns 202 before the goroutine completes).
- [x] A-010 R4: a burst of POSTs (button-mash / multiple tabs) results in at most one in-flight refresh and no more than one refresh per min-interval window.

### Removal Verification

- [x] A-011 R6: `POST /api/pr-status/refresh`, `handlePRStatusRefresh`, and `api/pr_status.go` are gone; the route returns 404; no dead references remain.
- [x] A-012 R7: `PrStatusLine` is removed with no remaining live imports; every OTHER `pr-status-line.tsx` export remains and its five consumers compile.

### Scenario Coverage

- [x] A-013 R4: a test drives the started / coalesced / throttled paths and asserts the 202 + refresh-count for each.
- [x] A-014 R7: `pr-status-line.test.tsx` retains the `prDotState precedence` coverage; the `PrStatusLine` cases are removed.

### Edge Cases & Error Handling

- [x] A-015 R2: with no collector wired (test router) the handler does not panic and still 202s (branch kick still fires).
- [x] A-016 R3: a `gh` failure inside the detached refresh is swallowed (best-effort), never surfaced to the client (already-committed 202).

### Code Quality

- [x] A-017 Pattern consistency: new backend code uses `exec.CommandContext` only via existing seams (no new subprocess construction in the handler), named constants for the min-interval/timeout (no magic numbers), and follows the collector-injection house pattern; frontend follows the pure-builder + colocated-test convention and CRT-glint button vocabulary.
- [x] A-018 No unnecessary duplication: the detached-goroutine pattern reuses the `waiting_push.go` shape; the palette action reuses `PaletteAction`/pure-builder conventions; the button reuses the `rk-glint` treatment; no shared PR-vocabulary export is duplicated during the `PrStatusLine` removal.
- [x] A-019 Uniform HTTP verb (Constitution §IX): the new endpoint is POST; no PUT/PATCH/DELETE introduced.
- [x] A-020 Security (Constitution §I): no shell-string subprocess construction added; the detached context carries a bounded timeout so no unbounded/hung `gh` pass can accumulate.

### Test Companion Docs

- [x] A-021 R9/R10: no Playwright `.spec.ts` is added or modified by this change (unit tests only); if any `.spec.ts` IS touched during apply, its sibling `.spec.md` is updated in the same commit (Constitution — Test Companion Docs).

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- Verification gates (code-quality.md): `cd app/backend && go test ./...`, then `cd app/frontend && npx tsc --noEmit`, then the relevant `just` test recipes.

## Deletion Candidates

- `app/frontend/src/components/pr-status-line.tsx` + `pr-status-line.test.tsx` (module identity) — the `PrStatusLine` component this change removed was the file's namesake; what remains is the shared PR color vocabulary + lifecycle status-dot model, so the filename is now misleading. Rename candidate (e.g. `pr-status-model.ts`), deferred here to keep the diff surgical (five consumers would need import updates).
- No other candidates — the code this change made redundant was deleted within the change itself (`POST /api/pr-status/refresh` route + `handlePRStatusRefresh` + `api/pr_status.go`, the `PrStatusLine` component + its private helpers `stateGlyph`/`summarySegments` + its render tests, `refreshPrStatus`). The pre-existing `prShape` closed→skipped dead-branch flag in `docs/memory/run-kit/ui-patterns.md` predates this change and is unaffected by it.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Kick seams are function fields on `api.Server` (`refreshCollectorFn`/`refreshBranchFn`) with per-server throttle state (mutex + in-flight flag + last-refresh time) and a `nowFn` clock seam | Intake #11 left the exact shape "to apply"; fields on `api.Server` match the collector-injection house pattern and are the only clean home for per-server coalesce/throttle state; a clock seam is required for deterministic throttle tests without real sleeps | S:55 R:85 A:85 D:75 |
| 2 | Confident | Detached goroutine timeout = 60s (`statusRefreshTimeout`); min-interval = 10s (`statusRefreshMinInterval`) | Intake #12 required "own timeout" without a value (collector gh call is 10s-bounded, branch pass is per-pair — 60s bounds the whole pass without truncating); intake #5 fixed 10s as mash-safe, well under both tick cadences | S:45 R:90 A:80 D:65 |
| 3 | Certain | `pr-status-line.tsx` is NOT deleted wholesale — only the `PrStatusLine` component + its private helpers (`stateGlyph`/`summarySegments`) + the `refreshPrStatus` import are removed; all other exports stay | Verified: the file is the single source of truth for `PR_*_COLORS` AND the lifecycle status-dot model, imported by `status-panel.tsx`, `status-dot.tsx`, `status-dot-tip.tsx`, `status-dot-label.ts`, `status-dot.test.tsx`. The intake's literal "delete the file" would break the build; surgical removal is the only correct reading of "retire PrStatusLine" | S:95 R:80 A:95 D:90 |
| 4 | Confident | `pr-status-line.test.tsx` is edited in place (drop the `PrStatusLine` describe + `refreshPrStatus` mock, keep `prDotState precedence`) rather than deleted | Same file-preservation logic as row 3 — the `prDotState precedence` block exercises a retained export; deleting the whole test file would drop live coverage | S:70 R:90 A:90 D:85 |
| 5 | Confident | Palette action lives in a new pure builder `lib/palette-status-refresh.ts` + colocated test, wired into `app.tsx`'s `allActions` aggregation | Intake #8/#9 mandated a palette action following the pure-builder pattern; the exact module name and the AppShell aggregation seam are the established convention (mirrors `palette-view.ts`/`palette-update.ts`) | S:60 R:90 A:90 D:80 |
| 6 | Confident | PANE header button uses `CollapsiblePanel.headerAction` (not `headerRight`), with a local `useState` busy flag cleared on POST settle | `headerAction` is the purpose-built seam that stops toggle propagation (intake §5 named it); `headerRight` (which the intake's line reference pointed at) is the StatusDot+name slot and would toggle the panel on click. Local busy state matches the top-bar refresh affordance | S:70 R:88 A:88 D:82 |
| 7 | Confident | `attachPRStatus` tests are preserved by keeping them in `pr_status_test.go` (or renamed `status_pr_attach_test.go`), only removing `TestHandlePRStatusRefreshReturnsOK` | Those tests cover `sseHub.attachPRStatus`, unrelated to the deleted endpoint; deleting them would drop live coverage of the URL-keyed join | S:75 R:90 A:90 D:85 |

7 assumptions (1 certain, 6 confident, 0 tentative).
