# Plan: Active Window Sync — tmux truth, URL as bookmark

**Change**: 260528-nvlp-active-window-sync
**Status**: In Progress
**Intake**: `intake.md`
**Spec**: `spec.md`

## Tasks

### Phase 1: Setup

- [x] T001 Add `github.com/fsnotify/fsnotify` dependency: run `cd app/backend && go get github.com/fsnotify/fsnotify` and verify it appears in `app/backend/go.mod` and `go.sum`.
- [x] T002 Create `app/backend/internal/tmuxctl/` package directory and add a doc.go describing the package boundary (control-mode subscriber for tmux servers; the only allowed bypass of `internal/tmux/` for tmux interaction).

### Phase 2: Core Implementation

- [x] T003 [P] Implement `app/backend/internal/tmuxctl/parser.go` — `ParseLine(line string) Event` as a pure function. Event types: `BeginEvent`, `EndEvent`, `ErrorEvent`, `SessionWindowChangedEvent`, `WindowAddEvent`, `WindowCloseEvent`, `WindowRenamedEvent`, `SessionsChangedEvent`, `LayoutChangeEvent`, `UnknownEvent`, `MalformedEvent`. Drop `%output` and `%unlinked-window-*` silently. Log unknown notifications once per name via `slog.Debug`. No panics on malformed input.
- [x] T004 [P] Add `tmux.ControlAnchorSessionName = "_rk-ctl"` constant in `app/backend/internal/tmux/tmux.go` (alongside `RelaySessionPrefix`). Update `parseSessions` to also skip lines where `parts[0] == ControlAnchorSessionName`.
- [x] T005 [P] Update `app/backend/cmd/rk/serve_sweep.go` `sweepOrphanedRelaySessions` to also skip `_rk-ctl` sessions explicitly — `ControlAnchorSessionName` shall not be reaped. (Already implicit since it's not prefixed with `rk-relay-`, but add an explicit comment + guard for defense-in-depth.)
- [x] T006 Implement `app/backend/internal/tmuxctl/event_sink.go` — define the `EventSink` interface with the 8 callbacks per spec. Include a `NoOpSink` for tests.
- [x] T007 Implement `app/backend/internal/tmuxctl/client.go` — `Client` type with `Open(ctx, socket, sink) (*Client, error)`, `Close() error`, `Generation() int64`, `Wait(after int64) <-chan struct{}`. Use `creack/pty` for `tmux -CC -L <socket> attach-session -t =<bootstrap> -r`. Bootstrap session resolution: first existing session or create `_rk-ctl` anchor with `@rk_ctl_keepalive=1`. Reconnect FSM with 250ms → 500ms → 1s → 2s → 5s backoff cap; reset on successful read.
- [x] T008 [P] Add `app/backend/internal/tmuxctl/parser_test.go` — golden-file fixtures for each notification type, plus malformed/unknown coverage.
- [x] T009 [P] Add `app/backend/internal/tmuxctl/client_test.go` — reconnect FSM tests using stubbed I/O. Cover EOF → reconnect, backoff sequence with fake clock, successful read resets backoff, `Close()` cancels reconnect.
- [x] T010 Implement `app/backend/internal/tmuxctl/supervisor.go` — `Supervisor` type with `Start(ctx)`, `Stop()`, owns `map[socket]*Client` guarded by `sync.Mutex`. Resolves watch dir from `TMUX_TMPDIR` or `/tmp/tmux-<euid>/`. `os.MkdirAll(dir, 0o700)` if missing. Uses `fsnotify.Watcher` for Create/Remove events.
- [x] T011 [P] Add `app/backend/internal/tmuxctl/supervisor_test.go` — fsnotify-driven Open/Close lifecycle using a temp dir + regular files (file Create/Remove fires the same fsnotify events as sockets).
- [x] T012 Refactor `app/backend/api/sse.go`: introduce `safetyPollInterval = 12 * time.Second`. Extract `detectKilledWindowIDs(prev, current map[string]struct{}) []string` as a pure function. Snapshot builder runs killed-window cleanup on every snapshot bump (whether driven by Wait channel or safety ticker). First snapshot per server initializes `prev` from `current` (no synthetic cleanup events).
- [x] T013 Adapt SSE hub `poll()` to be event-driven: each per-server goroutine selects over `client.Wait(prevGen)` and `time.NewTicker(safetyPollInterval)`. If no `tmuxctl.Client` is registered for the server (PTY-unavailable case), ticker-only mode. Add a hub-level adapter that bridges `tmuxctl.EventSink` callbacks into per-server `Wait` channel closes (generation counter increments live in the Client).
- [x] T014 Wire `tmuxctl.Supervisor` into `app/backend/cmd/rk/serve.go`: instantiate after `tmux.EnsureConfig()` and `sweepOrphanedRelaySessions`, BEFORE `server.ListenAndServe()` goroutine. Pass the SSE hub as the `EventSink`. On SIGINT/SIGTERM, `supervisor.Stop()` with 5s bounded context before `server.Shutdown`. Per-socket Open failures logged but never abort startup.

### Phase 3: Integration & Edge Cases

- [x] T015 Add `app/backend/internal/tmuxctl/integration_test.go` — spins up `tmux -L rk-tmuxctl-test new-session -d`, opens a `Supervisor`, triggers `tmux -L rk-tmuxctl-test select-window`, asserts the corresponding `Client.Generation()` advances within 500ms (target 200ms; upper bound 500ms per spec). `t.Cleanup` calls `tmux -L rk-tmuxctl-test kill-server`. Skip with `t.Skip` if `tmux` binary not present.
- [x] T016 [P] Update `app/frontend/src/app.tsx`: replace the URL-as-source-of-truth `useEffect` with mount-time alignment via `hasAlignedToUrlRef`. Delete `userNavTimestampRef` and the `elapsed < 3000` debounce. `navigateToWindow` becomes a pure mutation (`selectWindow` only, no `navigate`). Add a URL-write effect that fires `navigate({ replace: true })` whenever the SSE-derived `activeWindow.index` differs from the URL `windowIndex` (no debounce).
- [x] T017 [P] Update `app/frontend/src/components/sidebar/index.tsx` `WindowRow` `isSelected` computation: derive from `currentSession.windows.find(w => w.isActiveWindow)?.index === win.index` rather than URL `currentWindowIndex`. The `currentWindowIndex` prop is still threaded for backward compat but selection now flows from `isActiveWindow`. (Surgical: keep prop signatures stable.)
- [x] T018 Add a minimal `app/backend/api/sse_test.go` case: feed a stub `tmuxctl.Client` whose `Wait(after)` channel is closed manually, verify `event: sessions` broadcasts. Verify safety-net ticker continues to fire when no events arrive.

### Phase 4: Polish (deferred — see Notes)

- [ ] T019 [DEFERRED] Optimistic pending state on sidebar click (spec MAY, gated on median latency > 150ms).
- [ ] T020 [DEFERRED] `BoardEntry.isActiveWindow` field + subtle "tmux-active" ring on `BoardPane` (spec follow-up).
- [ ] T021 [DEFERRED] Frontend Vitest reconciler tests (`app/frontend/src/app.test.tsx` updates) — covered by Playwright e2e at the integration level.
- [ ] T022 [DEFERRED] Playwright e2e `app/frontend/tests/active-window-sync.spec.ts` + `.spec.md` — captured in spec but deferred per fff scope guidance; will ship via follow-up.

## Execution Order

- T001, T002 sequential (T002 depends on T001 only because both touch backend bootstrap)
- T003–T011 are parallelizable across files within the new `tmuxctl/` package (each test file pairs with its source)
- T012 blocks T013 (sse.go refactor must extract `detectKilledWindowIDs` first)
- T013 depends on T007/T010 (event-driven loop needs Client + Supervisor)
- T014 depends on T010 (Supervisor wiring)
- T015 depends on T007, T010 (integration test needs both)
- T016, T017 are frontend parallel; depend on no backend changes (they reference the existing `isActiveWindow` field which already flows through SSE).
- T018 depends on T013.

## Acceptance

### Functional Completeness

- [x] A-001 `internal/tmuxctl/Client`: opens long-running `tmux -CC -L <socket> attach-session -t =<bootstrap> -r` via `creack/pty`; exposes `Open/Close/Generation/Wait`.
- [x] A-002 Client reconnect FSM: 250ms→500ms→1s→2s→5s backoff, capped at 5s, resets on successful read, terminates on `Close()`.
- [x] A-003 `ParseLine`: pure function, recognizes all six relevant notifications + framing markers, handles malformed/unknown without panic.
- [x] A-004 `Supervisor`: enumerates watch dir on `Start`, fsnotify-driven Open/Close for runtime socket appear/disappear; per-socket mutex-guarded map.
- [x] A-005 `_rk-ctl` anchor: created when needed via `new-session -d`, tagged with `@rk_ctl_keepalive=1`, hidden from `parseSessions`, not reaped by `sweepOrphanedRelaySessions`.
- [x] A-006 SSE loop: event-driven via `Client.Wait(after)` + 12s safety-net ticker; PTY-unavailable falls back to ticker-only.
- [x] A-007 `detectKilledWindowIDs`: pure function moved out of inline poll loop; first snapshot per server emits no synthetic cleanup events.
- [x] A-008 `rk serve` ordering: `EnsureConfig → sweepOrphanedRelaySessions → Supervisor.Start → server.ListenAndServe`; graceful shutdown stops Supervisor before HTTP.
- [x] A-009 Frontend `app.tsx`: `userNavTimestampRef` + 3s debounce deleted; mount-time alignment via `hasAlignedToUrlRef` fires `selectWindow` exactly once per mount when URL ≠ active.
- [x] A-010 Frontend sidebar `WindowRow` selection derived from `isActiveWindow`, not URL.

### Behavioral Correctness

- [x] A-011 Control-mode-driven snapshot lands within 500ms target (200ms goal) after external `tmux select-window`.
- [x] A-012 Board cleanup latency tracks snapshot latency (sub-500ms instead of 2.5s/12s).
- [x] A-013 Sidebar click no longer calls `navigate` directly — URL follows SSE snapshot.

### Removal Verification

- [x] A-014 No `ssePollInterval = 2500ms` references remain; `safetyPollInterval = 12s` replaces them.
- [x] A-015 No `userNavTimestampRef` / `elapsed < 3000` references remain in `app.tsx`.

### Scenario Coverage

- [x] A-016 Parser scenario: `%session-window-changed $3 @42` → typed event.
- [x] A-017 Parser scenario: `%window-renamed @42 my new window name` preserves spaces.
- [x] A-018 Reconnect scenario: tmux kill-server → reconnect FSM advances through backoff sequence; new-session resets backoff.
- [x] A-019 Supervisor scenario: fsnotify Create event triggers Open within 100ms (or fast unit-test equivalent).
- [x] A-020 Integration scenario: tmux select-window on `rk-tmuxctl-test` server advances `Client.Generation()` within 500ms.

### Edge Cases & Error Handling

- [x] A-021 PTY-unavailable: Client surfaces error once via `slog.Warn`, no retry; Supervisor logs and continues with other sockets; SSE falls back to ticker-only.
- [x] A-022 Watch directory missing at Start: `slog.Warn` + `os.MkdirAll(dir, 0o700)` + watch the now-existing dir.
- [x] A-023 `_rk-ctl` already exists (concurrent rk): `new-session` failure treated as benign; proceed to attach.
- [x] A-024 First snapshot does not emit synthetic `board-changed { cleanup }`.

### Code Quality

- [x] A-025 Pattern consistency: `tmuxctl/` follows existing `internal/` patterns (`exec.CommandContext`, argument slices, no shell strings).
- [x] A-026 No persistent state introduced (no files under `~/.run-kit/` / `~/.cache/rk/` from tmuxctl).
- [x] A-027 Tests use isolated tmux servers (`rk-tmuxctl-test`); cleanup via `t.Cleanup`.
- [x] A-028 All Go subprocess calls in new package use `exec.CommandContext` with appropriate context lifecycle.
- [x] A-029 New code derives state from tmux + filesystem (no in-memory caches beyond the Supervisor's socket map, which mirrors the kernel-observable file system).

### Security

- [x] A-030 No new network listener / port opened by tmuxctl — `ss -tlnp` shows only the existing HTTP server.
- [x] A-031 Control-mode connection is read-only via `-r` flag.

## Notes

- Phase 4 tasks (T019–T022) are explicitly deferred per fab-fff scope guidance and spec assumption gradings:
  - T019/T020 are graded MAY/SHOULD with explicit "may ship as follow-up" language (spec §Frontend "Optimistic pending state" and §Boards "BoardEntry includes isActiveWindow").
  - T021/T022 (frontend test layer) — backend integration test (T015) provides architecture-level latency guarantee; frontend Playwright bound is verified by manual run if time permits.
- Mark items `[x]` as completed during apply.
- All MUST-HAVE acceptance items (A-001–A-031 minus deferred-test-only items) must pass before review.
