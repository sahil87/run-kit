# Plan: Live PR Status in Sidebar

**Change**: 260610-596o-pr-status-sidebar
**Status**: In Progress
**Intake**: `intake.md`

## Requirements

### Backend: Pane-Map PR Field Consumption (Layer 1)

#### R1: Window carries PR URL and number from pane-map
`tmux.WindowInfo` SHALL expose `PrURL *string` (`json:"prUrl,omitempty"`) and `PrNumber *int` (`json:"prNumber,omitempty"`), and the `internal/sessions` enrichment join SHALL populate them from the `fab pane map --json` `pr_url`/`pr_number` fields, keyed by stable window ID — exactly as `FabChange`/`FabStage`/`AgentState` are populated today.

- **GIVEN** a `fab pane map` entry with `pr_url` and `pr_number` set for a window
- **WHEN** `FetchSessions` enriches the matching window by its WindowID
- **THEN** that window's `PrURL`/`PrNumber` are the pointer values from the entry
- **AND** a window with no pane-map entry (or a null `pr_url`/`pr_number`) keeps `PrURL`/`PrNumber` nil

### Backend: PR Status Collector (Layer 2)

#### R2: In-memory PR status collector modeled on `internal/metrics`
A new `internal/prstatus` package SHALL provide a `Collector` holding `byNumber map[int]PRStatus` under a `sync.RWMutex`, with `NewCollector(interval)`, `Start(ctx)` (background goroutine ticking at `interval`, exits on `ctx.Done()`), `Snapshot()` (deep copy under `RLock`), and `RefreshNow(ctx)`. No database, no disk, no tmux option — in-memory only (Constitution §II).

- **GIVEN** a collector started with a tick interval
- **WHEN** the ticker fires or `RefreshNow` is called
- **THEN** `refresh()` runs and updates `byNumber`
- **AND** `Snapshot()` returns a copy that callers can read without holding the lock

#### R3: Single batched `gh` call with security-compliant exec
`refresh()` SHALL guard on `gh` availability (`exec.LookPath("gh")`) and `gh auth status`; when either fails it SHALL leave the last-good map untouched and return nil (silent no-op). When available it SHALL make ONE batched call fetching all of the user's open PRs across all repos with their number/url/state/isDraft/statusCheckRollup/reviewDecision, via `exec.CommandContext` with a 10s timeout and an explicit argument slice (never a shell string; no user input in argv — Constitution §I). The `gh` exec SHALL be injectable via a function field for test stubbing. *(Implemented via `gh api graphql` `viewer.pullRequests` — see Assumptions #8: the intake's literal `gh search prs` argv errors because `gh search prs` lacks the rollup/review JSON fields.)*

- **GIVEN** `gh` is absent or unauthenticated
- **WHEN** `refresh()` runs
- **THEN** the existing `byNumber` is preserved and no error surfaces
- **GIVEN** `gh` is available and authenticated
- **WHEN** `refresh()` runs
- **THEN** exactly one batched `gh` invocation is made with an explicit arg slice and 10s timeout

#### R4: Wholesale rebuild is the cleanup mechanism; stale-while-revalidate on error
On a successful `gh` call, `refresh()` SHALL build a fresh `map[int]PRStatus` and REPLACE `byNumber` wholesale under `Lock` — a PR absent from the new result (merged/closed/out of `--state open`) is simply gone next cycle (no eviction logic). On a `gh` call error (network blip) it SHALL keep the last-good map (stale-while-revalidate).

- **GIVEN** PR #100 was present last cycle and the new `gh` result omits it
- **WHEN** `refresh()` rebuilds the map
- **THEN** `Snapshot()` no longer contains #100
- **GIVEN** the `gh` call errors after a prior successful refresh
- **WHEN** `refresh()` runs
- **THEN** `Snapshot()` still returns the last-good map unchanged

#### R5: Enum collapse for checks, review, and state
`refresh()` SHALL collapse `statusCheckRollup` to one of `pass|fail|pending|none`, map `reviewDecision` to `approved|changes_requested|review_required|none`, and map `state`+`isDraft` to `open|merged|closed` (draft is reflected via `IsDraft`).

- **GIVEN** a PR whose `statusCheckRollup` contains any FAILURE/ERROR conclusion
- **WHEN** the rollup is collapsed
- **THEN** `Checks == "fail"`
- **AND** all-success rolls up to `pass`, any pending/in-progress with no failure rolls up to `pending`, empty rolls up to `none`
- **GIVEN** `reviewDecision` is `CHANGES_REQUESTED`
- **WHEN** mapped
- **THEN** `ReviewDecision == "changes_requested"` (and `""`/unknown → `none`)

#### R6: Collector wired into the SSE hub at startup
`api/router.go` SHALL construct `pc := prstatus.NewCollector(prStatusPollInterval); pc.Start(ctx)` next to the metrics collector and hand the hub a reference. The cadence SHALL be a named const `prStatusPollInterval = 90 * time.Second`.

- **GIVEN** the production router is built
- **WHEN** `NewRouterAndServer` runs
- **THEN** a prstatus collector is started on `ctx` and stored on the `Server`/hub
- **AND** the cadence is `90 * time.Second`

### Backend: SSE Join + Refresh Endpoint (Layer 3)

#### R7: PR status attached on the SSE poll path via pure in-memory read
`tmux.WindowInfo` SHALL gain `PrState string` (`json:"prState,omitempty"`), `PrChecks string` (`json:"prChecks,omitempty"`), `PrReview string` (`json:"prReview,omitempty"`), and `PrIsDraft bool` (`json:"prIsDraft,omitempty"`). When the SSE hub assembles the sessions payload, for each window with a non-nil `PrNumber` AND a non-empty `FabChange` (change-bound gate), it SHALL look the number up in `pc.Snapshot()` and attach the status fields. This SHALL be a pure in-memory read — NO `gh` call on the poll path (the 2.5s hot path makes ZERO network calls).

- **GIVEN** a change-bound window (`FabChange != ""`) with `PrNumber == 386` and the snapshot has #386 = {open, pass, approved}
- **WHEN** the hub assembles the sessions payload
- **THEN** that window's `PrState/PrChecks/PrReview/PrIsDraft` are set from the snapshot
- **GIVEN** a window with a `PrNumber` but empty `FabChange` (scratch window)
- **WHEN** the payload is assembled
- **THEN** no PR status fields are attached
- **AND** the assembly performs no network/`gh` calls

#### R8: On-demand refresh endpoint (POST)
A `POST /api/pr-status/refresh` handler SHALL call `pc.RefreshNow(ctx)` and return `200 {"ok":true}`. It SHALL be registered in `api/router.go` as a POST route (Constitution §IX; CORS allowlist stays `[GET,POST,OPTIONS]`).

- **GIVEN** the server is running with a wired collector
- **WHEN** a client POSTs `/api/pr-status/refresh`
- **THEN** `RefreshNow` is invoked and the response is `200 {"ok":true}`

### Frontend: Types + Client (Layer 1 + 3)

#### R9: Window type carries PR fields
`src/types.ts` `WindowInfo` SHALL add `prUrl?: string; prNumber?: number; prState?: "open"|"merged"|"closed"; prChecks?: "pass"|"fail"|"pending"|"none"; prReview?: "approved"|"changes_requested"|"review_required"|"none"; prIsDraft?: boolean;`.

- **GIVEN** an SSE sessions payload with PR fields on a window
- **WHEN** it is deserialized into `WindowInfo`
- **THEN** the typed PR fields are available to components

#### R10: `refreshPrStatus()` client wrapper
`src/api/client.ts` SHALL export `refreshPrStatus()` that POSTs `/api/pr-status/refresh`.

- **GIVEN** a component calls `refreshPrStatus()`
- **WHEN** invoked
- **THEN** a `POST` to `/api/pr-status/refresh` is issued

### Frontend: Display (Layer 3)

#### R11: Sidebar WindowRow PR-status line
`src/components/sidebar/window-row.tsx` SHALL render a PR-status line below the existing name/`fabStage` row ONLY when `win.fabChange && win.prNumber`. The line SHALL read `PR #<n> <state-glyph> <state> · <checks/review summary>`. `PR #<n>` SHALL be an `<a href={prUrl} target="_blank">` whose onClick calls `stopPropagation` (so it does not select the window). Clicking the rest of the PR line SHALL trigger `refreshPrStatus()` (best-effort, never blocks). Colors SHALL use existing tokens (`text-text-secondary` default, accent/red for fail-ish states — no new hardcoded hex). Touch targets SHALL respect the `coarse:` convention.

- **GIVEN** a window with `fabChange` set and `prNumber == 386`, `prState == "open"`, `prChecks == "pass"`
- **WHEN** the row renders
- **THEN** a line containing `PR #386` is shown, with `PR #386` linking to `prUrl` in a new tab
- **GIVEN** a window with `prNumber` set but no `fabChange`, OR `fabChange` set but no `prNumber`
- **WHEN** the row renders
- **THEN** no PR-status line is shown
- **GIVEN** a window whose `prChecks == "fail"` or `prReview == "changes_requested"`
- **WHEN** the row renders
- **THEN** the fail-ish portion uses the red/accent token (not `text-text-secondary`)

#### R12: Dashboard window-card PR summary
`src/components/dashboard.tsx` SHALL render the same one-line PR summary on each window card under the fab-stage badge, under the same `win.fabChange && win.prNumber` gate.

- **GIVEN** a change-bound window with a PR on a dashboard card
- **WHEN** the card renders
- **THEN** the PR summary line appears under the fab-stage badge
- **GIVEN** a scratch window (no `fabChange` or no `prNumber`)
- **WHEN** the card renders
- **THEN** no PR summary appears

### Non-Goals

- PRs not authored by `@me` (opened by a teammate or bot) — `gh search prs --author @me` won't surface them and the row stays hidden (accepted for v1 per intake Open Questions).
- Restart-survival of the cache — the 90s in-memory cache is re-derivable in one `gh` call; no persistence (Constitution §II).
- Per-PR polling or webhook receivers — explicitly rejected in the intake.

### Design Decisions

1. **In-memory collector mirroring `internal/metrics`**: wholesale map rebuild per refresh — *Why*: gives cleanup for free (merged/closed PRs and killed windows drop out next cycle), no eviction logic — *Rejected*: tmux `@rk_pr_status` option (two-writer race + manual pruning), DB (Constitution §II).
2. **SSE join reads `Snapshot()` only**: pure in-memory read on the 2.5s hot path — *Why*: keeps the hot path network-free; the `gh` cost is isolated behind the 90s background tick + on-demand POST — *Rejected*: fetching `gh` on the poll path (would block SSE on network).
3. **`gh` exec injected via a function field**: matches the codebase's exec-seam test pattern — *Why*: lets table tests stub `gh` output deterministically without a real binary.
4. **SSE join lives in the hub (`api/sse.go`), not `FetchSessions`**: the collector reference is held by the hub; `FetchSessions` (in `internal/sessions`) stays free of the prstatus dependency — *Why*: keeps the network-isolated collector out of the pure tmux/filesystem fetch layer, and the hub already owns the metrics collector reference (same pattern).

## Tasks

### Phase 1: Backend Layer 1 — pane-map PR fields

- [x] T001 Add `PrURL *string` (`json:"prUrl,omitempty"`) and `PrNumber *int` (`json:"prNumber,omitempty"`) to `tmux.WindowInfo` in `app/backend/internal/tmux/tmux.go` <!-- R1 -->
- [x] T002 Add `PrURL *string` (`json:"pr_url"`) and `PrNumber *int` (`json:"pr_number"`) to `paneMapEntry` in `app/backend/internal/sessions/sessions.go`; assign `sd.windows[j].PrURL = entry.PrURL` and `.PrNumber = entry.PrNumber` in the `enrichByWindowID` join loop (~line 449) <!-- R1 -->
- [x] T003 Extend `app/backend/internal/sessions/sessions_test.go`: a pane-map entry with `pr_url`/`pr_number` enriches the matching `WindowInfo` by WindowID; a null entry leaves nil fields <!-- R1 -->

### Phase 2: Backend Layer 2 — prstatus collector

- [x] T004 Create `app/backend/internal/prstatus/prstatus.go`: `PRStatus` struct, `Collector{mu, byNumber, interval, ghExec func}`, `NewCollector`, `Start`, `Snapshot` (deep copy under RLock), `RefreshNow`, `refresh()` (gh guard, single `exec.CommandContext` batched call with 10s timeout + arg slice, enum collapse, wholesale rebuild under Lock, stale-while-revalidate on error, injectable `gh` exec) <!-- R2 R3 R4 R5 -->
- [x] T005 Create `app/backend/internal/prstatus/prstatus_test.go`: table-test `refresh()` with stubbed gh exec — wholesale rebuild (PR present last cycle but absent in new output is gone), stale-while-revalidate on error (last-good kept), gh-absent → no-op; enum-collapse fixtures for `statusCheckRollup`/`reviewDecision`/`state`+`isDraft` <!-- R2 R3 R4 R5 -->

### Phase 3: Backend Layer 3 — wiring, SSE join, refresh endpoint

- [x] T006 Wire collector into `app/backend/api/router.go`: add `prStatus *prstatus.Collector` to `Server`; in `NewRouterAndServer` construct `pc := prstatus.NewCollector(prStatusPollInterval); pc.Start(ctx)` and store on `Server`; pass to the hub via `newSSEHub`; add named const `prStatusPollInterval = 90 * time.Second` (in `api/sse.go` alongside `metricsPollInterval`) <!-- R6 -->
- [x] T007 Add `PrState string` (`json:"prState,omitempty"`), `PrChecks string` (`json:"prChecks,omitempty"`), `PrReview string` (`json:"prReview,omitempty"`), `PrIsDraft bool` (`json:"prIsDraft,omitempty"`) to `tmux.WindowInfo` in `app/backend/internal/tmux/tmux.go` <!-- R7 -->
- [x] T008 In `app/backend/api/sse.go`: give the hub a `prStatus` field + a `PRStatusSnapshotter` seam interface; in `poll()` after `FetchSessions` returns, before marshaling, attach PR status to each window with non-nil `PrNumber` AND non-empty `FabChange` from `prStatus.Snapshot()` (pure in-memory read, no network) <!-- R7 -->
- [x] T009 Add `POST /api/pr-status/refresh` handler in `app/backend/api/` calling `s.prStatus.RefreshNow(ctx)` returning `200 {"ok":true}` (nil-safe); register the POST route in `api/router.go` <!-- R8 -->

### Phase 4: Frontend Layer 1 + 3

- [x] T010 [P] Add PR fields to `WindowInfo` in `app/frontend/src/types.ts` (`prUrl`, `prNumber`, `prState`, `prChecks`, `prReview`, `prIsDraft`) <!-- R9 -->
- [x] T011 [P] Add `refreshPrStatus()` POST wrapper for `/api/pr-status/refresh` in `app/frontend/src/api/client.ts` <!-- R10 -->
- [x] T012 Render PR-status line in `app/frontend/src/components/sidebar/window-row.tsx` (gated `win.fabChange && win.prNumber`; `PR #<n>` link with stopPropagation; row click → `refreshPrStatus()`; color tokens; `coarse:` targets) <!-- R11 -->
- [x] T013 Render PR summary line in `app/frontend/src/components/dashboard.tsx` window cards under fab-stage badge, same gate <!-- R12 -->
- [x] T014 [P] Extend `app/frontend/src/components/sidebar/window-row.test.tsx`: PR line renders only when `fabChange && prNumber`; `PR #<n>` link points at `prUrl`; hidden otherwise <!-- R11 -->

### Phase 5: E2E

- [x] T015 Add Playwright e2e spec `app/frontend/tests/e2e/pr-status-sidebar.spec.ts` + sibling `.spec.md`: mock the sessions SSE payload (via `page.route` on `/api/sessions/stream`) to include `prState`/`prChecks`; assert the PR line renders for a change-bound window and is absent for a scratch window; verify at 375px and 1024px <!-- R7 R11 -->

## Execution Order

- T001 → T002 → T003 (Layer 1 backend, sequential)
- T004 → T005 (collector before its tests; T004 also unblocks T006/T008)
- T006 depends on T004; T008 depends on T004 + T007; T009 depends on T004
- T007 can run alongside T004 (different files) but must precede T008
- T010–T011 are `[P]` (independent files); T012 depends on T010 + T011; T013 depends on T010 + T011; T014 depends on T012
- T015 depends on T012 (display) being in place

## Acceptance

### Functional Completeness

- [x] A-001 R1: `tmux.WindowInfo` exposes `PrURL`/`PrNumber` and the sessions enrichment join populates them from pane-map `pr_url`/`pr_number` by WindowID
- [x] A-002 R2: `internal/prstatus.Collector` provides `NewCollector`/`Start`/`Snapshot`/`RefreshNow` with in-memory `byNumber` under `sync.RWMutex` (no DB/disk/tmux-option)
- [x] A-003 R3: `refresh()` makes exactly one batched `gh` call (`gh api graphql viewer.pullRequests` — see Assumptions #8) via `exec.CommandContext` with a 10s timeout and explicit arg slice; `gh`-absent/unauth is a silent no-op; the `gh` exec is injectable
- [x] A-004 R4: a successful refresh replaces `byNumber` wholesale (absent PRs drop out); a `gh` error keeps the last-good map
- [x] A-005 R5: `statusCheckRollup`→`pass|fail|pending|none`, `reviewDecision`→4-enum, `state`+`isDraft`→`open|merged|closed` collapse correctly
- [x] A-006 R6: `router.go` starts `prstatus.NewCollector(prStatusPollInterval)` on `ctx` and hands the hub a reference; `prStatusPollInterval == 90 * time.Second`
- [x] A-007 R7: `tmux.WindowInfo` exposes `PrState/PrChecks/PrReview/PrIsDraft`; the SSE assembly attaches them from `Snapshot()` only for change-bound windows with a `PrNumber`
- [x] A-008 R8: `POST /api/pr-status/refresh` calls `RefreshNow` and returns `200 {"ok":true}`; registered as a POST route
- [x] A-009 R9: `WindowInfo` (frontend) carries the six PR fields with the specified literal union types
- [x] A-010 R10: `refreshPrStatus()` issues a `POST` to `/api/pr-status/refresh`
- [x] A-011 R11: the sidebar WindowRow renders the PR line only under `fabChange && prNumber`, with the `PR #<n>` link to `prUrl` (new tab, stopPropagation), row-click refresh, and token-based colors
- [x] A-012 R12: the dashboard window card renders the PR summary under the fab-stage badge under the same gate

### Behavioral Correctness

- [x] A-013 R7: the SSE poll path performs ZERO network/`gh` calls (the join is a pure `Snapshot()` read)
- [x] A-014 R4: stale-while-revalidate — after a `gh` error, `Snapshot()` returns the prior map unchanged (verified by test)
- [x] A-015 R11: clicking `PR #<n>` opens `prUrl` and does NOT select the window (stopPropagation verified)

### Scenario Coverage

- [x] A-016 R1: `sessions_test.go` proves enrichment of `PrURL`/`PrNumber` by WindowID and nil-on-missing
- [x] A-017 R4/R5: `prstatus_test.go` proves wholesale rebuild, stale-while-revalidate, gh-absent no-op, and enum collapse
- [x] A-018 R11: `window-row.test.tsx` proves the PR line renders only when gated and links to `prUrl`
- [x] A-019 R7/R11: the Playwright spec asserts the PR line renders for a change-bound window, is absent for a scratch window, at 375px and 1024px (with sibling `.spec.md`)

### Edge Cases & Error Handling

- [x] A-020 R3: `gh` absent OR `gh auth status` failing leaves the last-good map untouched and surfaces no error
- [x] A-021 R7: a window with `PrNumber` but empty `FabChange` (scratch) gets no PR fields attached
- [x] A-022 R5: an empty/absent `statusCheckRollup` collapses to `none` (not `pass`)

### Code Quality

- [x] A-023 Pattern consistency: `internal/prstatus` mirrors `internal/metrics.Collector` structure (NewCollector/Start/Snapshot/poll); handler mirrors existing POST handlers
- [x] A-024 No unnecessary duplication: reuses `derefStr`, existing client POST conventions, existing color tokens
- [x] A-025 Security (Constitution §I): all `gh` execution uses `exec.CommandContext` with timeout + explicit arg slice; no shell string; no user input in argv
- [x] A-026 Constitution §II: no database/disk/tmux-option persistence — collector state is in-memory only
- [x] A-027 Constitution §IX: the refresh endpoint is POST; CORS `AllowedMethods` stays `[GET,POST,OPTIONS]`
- [x] A-028 Test companion docs: the Playwright `.spec.ts` ships with a sibling `.spec.md` (Constitution Test Companion Docs)
- [x] A-029 No polling from the client: the PR line uses SSE-delivered fields; refresh is an on-demand POST, not `setInterval`+fetch

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | SSE join is implemented in the hub (`api/sse.go`) reading the collector `Snapshot()`, not inside `internal/sessions.FetchSessions` | Intake says "when assembling the SSE sessions payload"; the hub already owns the metrics collector ref and `FetchSessions` is the pure tmux/fs layer that must stay free of the network-isolated collector | S:88 R:80 A:90 D:85 |
| 2 | Certain | `prStatusPollInterval` const lives in `api/sse.go` beside `metricsPollInterval` | Intake says "named const `prStatusPollInterval = 90 * time.Second`" and groups it with the SSE cadence constants; same file as the other poll-interval consts | S:90 R:92 A:92 D:90 |
| 3 | Confident | `statusCheckRollup` collapse: GraphQL returns a single pre-collapsed `statusCheckRollup.state` enum — `SUCCESS`→pass, `FAILURE`/`ERROR`→fail, `PENDING`/`EXPECTED`→pending, null/empty→none | GitHub's GraphQL `StatusState` enum is already a rollup, so no per-check iteration is needed; a failing/errored state dominates (one obvious mapping) | S:80 R:88 A:88 D:82 |
| 8 | Confident | **Apply-time correction**: use `gh api graphql` (`viewer.pullRequests`) instead of the intake's literal `gh search prs --author @me --json ...statusCheckRollup,reviewDecision`. The literal command ERRORS — `gh search prs` does not expose `statusCheckRollup`/`reviewDecision` JSON fields (verified this session: "Unknown JSON field"). GraphQL `viewer.pullRequests(states: OPEN)` is ONE cross-repo call returning number/url/state/isDraft/reviewDecision/statusCheckRollup — faithfully serving every documented intake intent (one batched call, O(1), cross-repo, full status) and every SRAD assumption (#2/#9). exec.CommandContext + explicit arg slice + 10s timeout preserved (§I) | The intake's exact argv is unimplementable (confirmed empirically); GraphQL is the standard `gh` mechanism for cross-repo batched PR status with checks+review. Reversible (single function `defaultGhExec`); does not alter any user-facing requirement | S:70 R:80 A:88 D:80 |
| 4 | Confident | Collector held on `Server` via a `PRStatusSnapshotter` interface seam (matching `SessionFetcher`/`metrics.Collector` injection) so `NewTestRouter` and hub tests need no live `gh` | Mirrors the codebase's existing dependency-injection seams for testability; keeps `newSSEHub` signature extension minimal | S:80 R:85 A:88 D:82 |
| 5 | Confident | The refresh handler and route live in a new `api/pr_status.go` file | Matches the one-handler-per-concern file layout (`tmux_config.go`, `health.go`); avoids bloating `router.go` | S:82 R:90 A:88 D:85 |
| 6 | Confident | State glyph mapping: `open`→`●`/`✓`, `merged`→`✓`, `closed`→`✗`; checks `pass`→`✓`, `fail`→`✗`, `pending`→`…` | Display detail, fully reversible, no hardcoded hex (uses unicode glyphs + color tokens); one obvious set | S:75 R:90 A:80 D:78 |
| 7 | Confident | E2E mocks `/api/sessions/stream` (and `/api/servers`) via `page.route` fulfilling an SSE body, since the isolated test tmux server has no real change-bound PRs and `gh` is unavailable in CI | Intake explicitly says "mock the sessions SSE payload"; `page.route` is the only viable injection point for SSE-delivered fields in the real-backend e2e harness | S:85 R:80 A:85 D:82 |

8 assumptions (2 certain, 6 confident, 0 tentative).

> Apply-time note: the production `just build` gate could not complete in this worktree because the repo-tracked `VERSION` file (consumed by `scripts/build.sh` for the `-ldflags` version string) is absent on this branch — a pre-existing worktree/release-flow condition, NOT introduced by this change. The frontend `vite build` succeeded and the Go production binary was verified to compile via `go build -ldflags "-X main.version=..." ./cmd/rk` (exit 0). The pre-existing e2e flake `sidebar-window-sync › kill-then-create at same index` was confirmed to fail identically on the clean branch (changes stashed), so it is unrelated to this change.
