# Plan: Active-Window Event-Driven Derivation

**Change**: 260530-v6hm-active-window-event-derivation
**Status**: In Progress
**Intake**: `intake.md`
**Spec**: `spec.md`

<!--
  Apply parses ## Tasks only. Review parses ## Acceptance only.
  Section headings (## Tasks, ## Acceptance) are the stable parser contract.
-->

## Tasks

<!-- Sequential work items for the apply stage. Checked off [x] as completed. -->

### Phase 1: Setup — the tracker type

- [x] T001 Add a concurrency-safe per-server active-window tracker type in a new file `app/backend/internal/tmuxctl/active_window.go`. The tracker keys the last-active `@wid` by **session group name** for one server (one tracker instance per `Client`). Provide methods: `Set(group, wid string)` (latest-event-wins overwrite), `Get(group string) (wid string, ok bool)`, `SetSidGroup(sid, group string)` / `ResolveGroup(sid string) (group string, ok bool)` for the `$sid`→group map, `ReplaceSidGroups(map[string]string)` (atomic refresh on `%sessions-changed`/connect), and `Snapshot() map[string]string` (group→wid copy for the read path). Guard all state with a single `sync.RWMutex` (or two — one per sub-map — if it reads cleaner). Reads MUST NOT block the read loop; the read loop's writes MUST NOT block SSE reads. The tracker is in-memory only (a Go struct guarded by a mutex) — no database, file, or ORM (Constitution §II). <!-- A-001 A-005 A-013 A-025 -->

### Phase 2: Core Implementation — wire events into the tracker

- [x] T002 Replace `hubSink`'s no-op `OnSessionWindowChanged` in `app/backend/api/tmuxctl_bridge.go` with payload tracking: resolve `$sid`→group via the tracker's cached map (O(1), no subprocess) and record `@wid` for that group via `tracker.Set`. An unresolved `$sid` (absent from the map) MUST be tolerated — skip tracking for that event, do not error/panic/block. The generation-bump path stays unchanged (it already runs in `Client.dispatch` after the sink callback). Give `hubSink` a reference to the tracker (struct field) so the callback can reach it. <!-- A-002 A-003 A-006 A-008 -->

- [x] T003 Implement `$sid`→group cached-map maintenance in `app/backend/api/tmuxctl_bridge.go` `hubSink.OnSessionsChanged` (currently no-op): on `%sessions-changed`, refresh the tracker's `$sid`→group map by listing sessions with their `$sid` and `#{session_group}` for the server. Add a tmux helper in `app/backend/internal/tmux/tmux.go` (e.g. `ListSessionGroups(ctx, server) (map[sid]group, error)`) that runs `tmux list-sessions -F '#{session_id}<delim>#{session_group}'` under `context.WithTimeout` (no shell strings — §I). For ungrouped sessions tmux reports an empty `#{session_group}`; fall back to using `#{session_name}` as the group key so single-session servers still track. This new subprocess MUST use `exec.CommandContext` with an explicit timeout and argument slices — no shell strings (Constitution §I). <!-- A-004 A-007 A-009 A-024 -->

- [x] T004 Re-seed the tracker on control-client (re)connect: implement `hubSink.OnConnectionEstablished` (currently no-op) in `app/backend/api/tmuxctl_bridge.go` to (a) refresh the `$sid`→group map (reuse the T003 helper) and (b) for each session group, query the current active window and seed Tier 1. Add a tmux helper in `app/backend/internal/tmux/tmux.go` (e.g. `ListActiveWindowsByGroup(ctx, server) (map[group]wid, error)`) using `tmux list-windows -a -F '#{session_group}<delim>#{window_id}<delim>#{window_active}'` (or per-group `list-windows`) under `context.WithTimeout`, recording the `@wid` whose `#{window_active}` is `1` per group. This addresses cold-start (intake: tmux does NOT replay `%session-window-changed` on fresh `-CC` attach) and reconnect staleness. This new subprocess MUST use `exec.CommandContext` with an explicit timeout and argument slices — no shell strings (Constitution §I). <!-- A-010 A-011 A-016 A-024 -->

- [x] T005 Decide and document tracker ownership/lifecycle: instantiate one tracker per `Client` (the read-loop goroutine owns writes, `OnConnectionEstablished` fires from the same loop). Since `hubSink` is currently shared by the `Supervisor` across all Clients, change the wiring so each Client gets a sink bound to that Client's own tracker. Options to settle in this task: (a) `Supervisor` builds a per-socket sink+tracker pair in `openSocket` via a sink factory, exposing `Supervisor.ActiveWindow(server, group)` for the read path; or (b) tracker hangs on the `Client` with a `Client.ActiveWindow(group)` accessor and `Supervisor` delegates by socket. Implement one; update `app/backend/internal/tmuxctl/supervisor.go` and `app/backend/cmd/rk/serve.go` (`tmuxctl.NewSupervisor(api.NewHubSink())`) accordingly. Expose a server-keyed read accessor for the SSE/fetch path. <!-- A-006 A-008 A-013 -->

### Phase 3: Integration — two-tier derivation in the fetch path

- [x] T006 Define an active-window provider seam consumed by the derivation. Add an interface (e.g. `ActiveWindowProvider { ActiveWindow(server, group string) (wid string, ok bool) }`) and thread it from the supervisor (T005) into `sessions.FetchSessions`. Because `sessions.FetchSessions` is a package-level function called via `prodSessionFetcher` (`app/backend/api/router.go`), change the signature/struct so the provider is injectable: pass it as a parameter or store it on a fetcher struct. Update `prodSessionFetcher` in `app/backend/api/router.go` to hold the provider, wire it in `app/backend/cmd/rk/serve.go` after the supervisor starts (alongside `SetWindowChangeSubscriber`), and ensure `NewTestRouter` / test fetchers can inject a fake provider. A nil/absent provider MUST degrade gracefully to Tier 2 (pure base-pointer behavior — preserves current behavior when control-mode is unavailable). <!-- A-006 A-008 A-014 -->

- [x] T007 Implement two-tier `isActiveWindow` derivation in `app/backend/internal/sessions/sessions.go` `FetchSessions`. For each session `si`, resolve its group (the user-facing session name IS the group leader / group name after `parseSessions` filtering; use `si.Name` as the group key, matching T003's group keying). Query the provider for the tracked `@wid`: **Tier 1** — if a tracked `@wid` exists, set `IsActiveWindow=true` for exactly the window whose `WindowID` matches and `false` for all others in that session (overriding the `#{window_active}` flag parsed in `WindowInfo`); **Tier 2** — if no tracked entry, leave the base-pointer-derived `IsActiveWindow` (from `parseWindows`) untouched. Tier 1 once present is authoritative — base pointer never overrides it. <!-- A-010 A-012 A-015 A-016 A-017 -->

- [x] T008 Enforce the single-highlight invariant in derivation (`app/backend/internal/sessions/sessions.go`): when Tier 1 applies, guarantee at most one `IsActiveWindow=true` per session; when the tracked `@wid` matches no live window in the session (e.g. window closed between event and fetch), fall back to Tier 2 for that session rather than marking zero/none silently — keep behavior sensible and documented in a comment. <!-- A-018 A-019 -->

### Phase 4: Tests & frontend verification

- [x] T009 [P] Unit tests for the tracker in `app/backend/internal/tmuxctl/active_window_test.go`: latest-event-wins overwrite, `$sid`→group resolution hit/miss, `ReplaceSidGroups` atomic refresh, unknown-sid tolerance (no panic), and a `-race`-clean concurrent read-during-write test (writer goroutine + reader goroutine). <!-- A-001 A-003 A-007 A-009 A-013 -->

- [x] T010 [P] Unit tests for `hubSink` event handling in `app/backend/api/tmuxctl_bridge_test.go` (create if absent): `OnSessionWindowChanged` records `@wid` for the resolved group; unknown `$sid` is skipped without error; `OnSessionsChanged` refreshes the map; `OnConnectionEstablished` re-seeds from a stubbed active-windows query. Use a fake/stubbed tmux query seam (inject the list helpers) so tests do not spawn real tmux. <!-- A-002 A-004 A-006 A-010 A-011 -->

- [x] T011 [P] Unit tests for two-tier derivation in `app/backend/internal/sessions/sessions_test.go` (or a focused new test file) using a fake `ActiveWindowProvider`: Tier-1 tracked value wins over a stale base pointer; Tier-2 fallback when no tracked entry; external-client move followed (tracked `@wid` honored with no override path); single-highlight invariant (exactly one `true`); tracked `@wid` matching no live window falls back to Tier 2. If `FetchSessions` cannot be unit-tested without live tmux, factor the pure derivation step into a testable helper (e.g. `applyActiveWindow(windows, trackedWid string)`) and test that directly. <!-- A-012 A-015 A-016 A-017 A-018 A-019 -->

- [x] T012 [P] Add tmux helper tests in `app/backend/internal/tmux/tmux_test.go` for the new parsers (T003/T004): parse `list-sessions` group output into `$sid`→group (ungrouped → name fallback) and parse `list-windows -a` output into group→active-`@wid`. Test the pure parse functions (split out from the exec call, matching the existing `parseSessions`/`parseWindows`/`parsePanes` exported-for-testing pattern). <!-- A-004 A-009 A-011 -->

- [x] T013 Verify frontend auto-follow requires NO logic change (`app/frontend/src/app.tsx`): confirm the existing URL-writeback effect (~line 395-425, `activeWindow = currentSession.windows.find(w => w.isActiveWindow)` → `navigate({ replace: true })`) delivers auto-follow once `isActiveWindow` is corrected, and that board panes (`app/frontend/src/components/board/board-pane.tsx`) pin explicit window IDs and never read `isActiveWindow`. No code edit expected — this is a read/confirm task; note findings in the task completion. <!-- A-020 A-021 -->

- [x] T014 Run verification gates per `fab/project/code-quality.md`: `just test-backend` (Go, with `-race` coverage for the tracker), `just build`. Frontend type check (`cd app/frontend && npx tsc --noEmit`) only if any `.ts/.tsx` was touched (expected: none beyond verification). Fix any failures at root cause. <!-- A-022 A-023 -->

## Execution Order

- T001 blocks T002, T003, T004, T005 (tracker type must exist first).
- T005 (ownership/wiring) blocks T006 (provider seam reads the tracker).
- T006 blocks T007, T008 (derivation consumes the provider).
- T003 and T004 share new tmux helpers — implement helpers once; whichever task lands first adds them.
- T009–T013 are `[P]` (different files) but each depends on its subject task (T009→T001, T010→T002-T005, T011→T006-T008, T012→T003-T004, T013 is independent verify-only).
- T014 runs last (after all implementation + tests).

## Acceptance

<!-- Declarative criteria consumed by the review stage. -->

### Functional Completeness

- [x] A-001 Tracker type: a concurrency-safe per-server tracker exists (`internal/tmuxctl/active_window.go`) keying last-active `@wid` by session group, with set/get/resolve/replace/snapshot methods. (RWMutex + two maps; Set/Get/SetSidGroup/ResolveGroup/ReplaceSidGroups/SeedGroups/Snapshot all present.)
- [x] A-002 Payload consumed: `hubSink.OnSessionWindowChanged` records the `@wid` for the resolved session group instead of discarding it; it is no longer a no-op. (`tmuxctl_bridge.go` resolves group then `tracker.Set`.)
- [x] A-003 Latest event wins: a later `%session-window-changed` for the same group overwrites the tracked `@wid`. (`Set` overwrites; `TestHubSink_OnSessionWindowChanged_LatestEventWins`.)
- [x] A-004 Cached sid→group map: maintained per server, refreshed on `%sessions-changed` and on connect; resolution is O(1) with no per-event subprocess. (`ResolveGroup` is a map lookup; refresh via `refreshSidGroups`.)
- [x] A-005 Generation path preserved: the per-server generation-counter bump that wakes the SSE poll loop still fires on `%session-window-changed` (tracking is additive). (client.go unchanged; `dispatch` calls sink then `bumpGeneration` at line 319.)
- [x] A-006 Tracker reachable from fetch path: an `ActiveWindowProvider` seam threads the tracker from tmuxctl through to `sessions.FetchSessions`, wired in `cmd/rk/serve.go`. (Supervisor.ActiveWindow → prodSessionFetcher.provider → FetchSessions; serve.go:127.)
- [x] A-007 Re-seed on reconnect: `OnConnectionEstablished` refreshes the sid→group map and seeds Tier 1 from current `#{window_active}` per group. (`reseed`: refreshSidGroups + listActiveByGroup + SeedGroups; `TestHubSink_reseed_SeedsTier1AndMap`.)

### Behavioral Correctness

- [x] A-008 No-op replaced cleanly: the generation-counter signalling behavior is unchanged for all other events; only `OnSessionWindowChanged`/`OnSessionsChanged`/`OnConnectionEstablished` gain side effects. (`OnWindowAdd/Close/Renamed/LayoutChange/ConnectionLost` remain empty; gen bump in client.go untouched.)
- [x] A-009 Unknown sid tolerated: a `%session-window-changed` for a `$sid` not in the map is skipped for tracking without error, panic, or block, and corrected on the next `%sessions-changed`. (`ResolveGroup` miss → early return; `TestHubSink_OnSessionWindowChanged_UnknownSidSkipped`.)
- [x] A-010 Tier 1 authoritative: when a tracked `@wid` exists for a group, that window is `isActiveWindow:true` and the stale base `#{window_active}` does not override it. (`applyActiveWindow` clears all then sets match; `TestApplyActiveWindow_Tier1WinsOverStaleBase`.)
- [x] A-011 Cold-start seed: on initial attach (no event yet) the tracker is seeded from `#{window_active}` per group so the first SSE snapshot reflects the genuinely-active window. (`OnConnectionEstablished` fires on initial attach in client.go:254; reseed seeds Tier 1.)
- [x] A-012 Tier 2 fallback: a group with no tracked entry derives `isActiveWindow` from the base session `#{window_active}` flag. (provider miss → no `applyActiveWindow` call; `TestApplyActiveWindow_Tier2FallbackWhenNoTracked`.)

### Scenario Coverage

- [x] A-013 Concurrency safety: a `-race` test exercises concurrent tracker read (SSE) and write (read loop) with no data race. (`TestActiveWindowTracker_ConcurrentReadWrite`: 2 writers + 1 reader; passes under `-race`.)
- [x] A-014 Graceful degradation: when no provider is wired (control-mode unavailable / nil provider), `FetchSessions` behaves exactly as today (Tier 2 only). (FetchSessions guards `if provider != nil`; nil factory → NoOpSink; `SetActiveWindowProvider` no-op when not prod fetcher.)
- [x] A-015 New-window-becomes-active scenario: an event activating `@27` in a group member results in `@27` marked active for that group's session. (`TestHubSink_OnSessionWindowChanged_RecordsResolvedGroup` records `@27`; applyActiveWindow marks it.)
- [x] A-016 External-client move followed: an iTerm/Ghostty activation (also emits the event) is honored with no base-pointer-override code path. (`TestApplyActiveWindow_ExternalClientMoveFollowed`; no override path exists — latest-event-wins.)
- [x] A-017 Tracked-wins-over-stale-base scenario: tracker `@27` vs stale base `@24` → `@27` true, `@24` false. (`TestApplyActiveWindow_Tier1WinsOverStaleBase`.)

### Edge Cases & Error Handling

- [x] A-018 Single-highlight invariant: at most one window per session is `isActiveWindow:true` after derivation (per-session scope, not per-server). (`applyActiveWindow` sets `IsActiveWindow = i == matchIdx`; per-session loop; `TestApplyActiveWindow_SingleHighlightInvariant`.)
- [x] A-019 Stale-tracked-wid edge case: a tracked `@wid` matching no live window in the session falls back to Tier 2 for that session rather than marking none active. (`matchIdx < 0` → return, base flags retained; `TestApplyActiveWindow_StaleTrackedWidFallsBackToTier2`.)

### Code Quality

- [x] A-020 Frontend no-logic-change confirmed: `app.tsx` URL-writeback delivers auto-follow with no frontend code edit; sidebar highlight follows. (No `app/frontend/` files changed; `app.tsx:358` writeback reads `isActiveWindow` unchanged.)
- [x] A-021 Boards unaffected: board panes (`board-pane.tsx`) pin explicit window IDs and never read `isActiveWindow`; verified untouched. (`board-pane.tsx` uses `entry.windowId`; zero `isActiveWindow` references; file untouched.)
- [x] A-022 Pattern consistency: new tracker/helpers follow surrounding conventions (exported-for-testing pure parse functions like `parseWindows`; `exec.CommandContext` + `context.WithTimeout`; sink callbacks non-blocking per `EventSink` doc); tests colocated `*_test.go`. (`parseSessionGroups`/`parseActiveWindowsByGroup` mirror `parseWindows`; blocking queries offloaded to goroutines in `OnSessionsChanged`/`OnConnectionEstablished`.)
- [x] A-023 No unnecessary duplication: new tmux queries reuse `tmuxExecServer`/`listDelim`/`withTimeout` helpers and existing `ListWindows`/`#{window_active}` patterns rather than reimplementing exec/parse; no inline tmux command strings. (Both new helpers call `tmuxExecServer` + `listDelim` + `context.WithTimeout(ctx, TmuxTimeout)`.)

### Security

- [x] A-024 Exec discipline: every new tmux subprocess (sid→group list, re-seed list-windows) uses `exec.CommandContext` with an explicit timeout and argument slices — no shell strings (Constitution §I, code-quality anti-pattern). (Both `ListSessionGroups`/`ListActiveWindowsByGroup` route through `tmuxExecServer` argument slices under `context.WithTimeout(ctx, TmuxTimeout)`; format strings are `-F` args, not shell.)
- [x] A-025 No persistent store: the tracker is in-memory only (mirrors tmux state); no database/file/ORM introduced (Constitution §II). (`ActiveWindowTracker` is two in-memory maps under a mutex; no imports beyond `sync`.)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- Key wiring insight for apply: `sessions.FetchSessions` is package-level and reached via `prodSessionFetcher` (`api/router.go`) + the SSE hub (`api/sse.go:438`); the tracker lives on the tmuxctl side (`cmd/rk/serve.go:119`). T005/T006 establish the injection seam connecting them — this is the load-bearing structural decision.
<!-- clarified: Security acceptance A-024 (exec discipline) and A-025 (no persistent store) were defined in ## Acceptance but uncited by any task. Attached A-024 to T003/T004 (the two tasks that introduce new tmux subprocesses) and A-025 to T001 (the in-memory tracker type), with reinforcing constraint prose in each. All 25 acceptance IDs now map to a covering task. -->
- Group keying assumption (T003/T007): after `parseSessions` filtering, the user-facing session name equals the session-group leader name (= `#{session_group}`); ephemeral `rk-relay-*` members share that group. Confirm this holds during apply (verify `#{session_group}` for a base session equals its name) — if not, an explicit name→group map from the sid→group refresh is needed in the derivation path too.

## Deletion Candidates

- **`NewHubSink()` + the no-op `hubSink struct{}` value-receiver methods** (`api/tmuxctl_bridge.go`) — REMOVED by this change. The old `func NewHubSink() tmuxctl.EventSink` returned an empty `hubSink{}` whose 8 callbacks were all no-ops; it is fully superseded by `NewHubSinkFactory()` returning a per-socket tracker-bound `*hubSink`. `grep` confirms zero remaining references to `NewHubSink` (only `NewHubSinkFactory`). No further deletion needed — the apply already removed it cleanly rather than leaving a dead wrapper.
- **`Supervisor.sink` field** (`internal/tmuxctl/supervisor.go`) — REMOVED, replaced by `sinkFactory SinkFactory` + per-socket `trackers map`. No stale single-shared-sink field remains.
- **Reviewer note (not a deletion, an observed redundancy boundary)**: the base-pointer `#{window_active}` parse in `parseWindows` is NOT redundant — Tier 2 still depends on it as the cold-start/reconnect fallback and as the leaderless-group fallback. Correctly retained.
- Otherwise None — this change is additive (new tracker + seam) over an existing no-op hook; it did not orphan any other production code path.
