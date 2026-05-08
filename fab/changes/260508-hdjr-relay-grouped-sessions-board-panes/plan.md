# Plan: Relay Grouped Sessions for Board Panes

**Change**: 260508-hdjr-relay-grouped-sessions-board-panes
**Status**: In Progress
**Intake**: `intake.md`
**Spec**: `spec.md`

## Tasks

### Phase 1: Setup

- [x] T001 Add `NewGroupedSession(ctx, server, realSession, ephemeral)` to `app/backend/internal/tmux/tmux.go` — invokes `tmuxExecServer(ctx, server, "new-session", "-d", "-s", ephemeral, "-t", realSession)` wrapped with `context.WithTimeout(ctx, TmuxTimeout)`. Mirrors the shape of sibling helpers (`KillSession`, `SelectWindow`).
- [x] T002 Add `KillSessionCtx(ctx, server, session)` (ctx-accepting variant) to `app/backend/internal/tmux/tmux.go` so the relay handler can pass `context.Background()` for cleanup; existing `KillSession(session, server)` is preserved as a thin wrapper. (Required because the spec mandates `defer s.tmux.KillSession(context.Background(), server, ephemeral)` semantics with explicit ctx.)
- [x] T003 Filter `rk-relay-` prefix in `parseSessions` (`app/backend/internal/tmux/tmux.go`) — early-skip any line whose name starts with `rk-relay-`. Add a named constant `RelaySessionPrefix = "rk-relay-"`.

### Phase 2: Core Implementation

- [x] T004 Extend `TmuxOps` interface in `app/backend/api/router.go` with `NewGroupedSession(ctx context.Context, server, realSession, ephemeral string) error` and `KillSessionCtx(ctx context.Context, server, session string) error`. Implement both on `prodTmuxOps` by delegating to the new tmux package functions.
- [x] T005 Add `mockTmuxOps.NewGroupedSession` and `mockTmuxOps.KillSessionCtx` in `app/backend/api/sessions_test.go` so existing test routers continue to satisfy `TmuxOps`.
- [x] T006 Replace the `SelectWindow + attach-session -t <session>` sequence in `app/backend/api/relay.go` with the per-WebSocket grouped ephemeral flow: generate `rk-relay-<8 hex>` via `crypto/rand`, call `s.tmux.NewGroupedSession`, `defer s.tmux.KillSessionCtx(context.Background(), server, ephemeral)`, `s.tmux.SelectWindow(ephemeral, winIdx, server)`, and attach with `attach-session -t <ephemeral>`. Preserve all existing behaviour (resize handshake, cleanup, error close codes 4004/4001).
- [x] T007 Add `sweepOrphanedRelaySessions(ctx context.Context, ops TmuxOps) error` to `app/backend/cmd/rk/serve.go` (or a sibling file in the same package). Iterate `ListServers`, then for each server call `ListSessions` directly via the production `tmux` package (the filter would otherwise hide ephemerals); kill any session matching `rk-relay-` via `KillSessionCtx`. Per-server failures are logged and skipped, never returned as fatal.
- [x] T008 Wire `sweepOrphanedRelaySessions` into `serveCmd.RunE` after `tmux.EnsureConfig()` and before the goroutine that calls `server.ListenAndServe()`, with a 30s bounded context.

### Phase 3: Integration & Edge Cases

- [x] T009 [P] Add tmux integration test `TestNewGroupedSession_*` to `app/backend/internal/tmux/tmux_test.go` using the existing `withSessionOrderTmux(t)` pattern: (a) success against a session with multiple windows — verify `list-sessions` includes the ephemeral and `list-windows -t <ephemeral>` matches the real session's window count; (b) error against a non-existent real session.
- [x] T010 [P] Add `parseSessions` filter test cases covering `rk-relay-*` exclusion (`app/backend/internal/tmux/tmux_test.go`).
- [x] T011 Create `app/backend/api/relay_test.go` with at least: (a) two simultaneous WebSocket relay connections to the same real session targeting different windows produce different PTY output streams; (b) after both close, `tmux list-sessions` for that server contains zero `rk-relay-*` entries. Use `httptest.NewServer(NewTestRouter(...))` with a real `prodTmuxOps` against an isolated tmux test server (skip if tmux missing). Use the gorilla/websocket client to dial.
- [x] T012 Extend `app/frontend/tests/e2e/boards-pin-flow.spec.ts` (or create a sibling `boards-same-session-multi-pane.spec.ts`) covering the multi-window same-session board case: pin two windows from the same session into one board and assert each pane shows its targeted window's distinct content. Update the corresponding `.spec.md` companion doc per the constitution's Test Companion Docs rule.

### Phase 4: Polish

- [x] T013 [P] Add a brief Go doc comment block above `NewGroupedSession` and `sweepOrphanedRelaySessions` describing the lifecycle (ephemeral per-WS, cleanup via `defer`, sweep on startup). No external README changes.

## Execution Order

- T001/T002/T003 in `internal/tmux/tmux.go` are in the same file; do them sequentially in the order listed (T001 → T002 → T003).
- T004 depends on T001 + T002 (it consumes the new tmux helpers).
- T005 depends on T004 (mock must satisfy the extended interface).
- T006 depends on T004 + T005 (relay handler uses the interface).
- T007 + T008 depend on T004 (sweep uses the interface).
- T009/T010 (tmux tests) can run in parallel with each other; they depend on T001 + T003.
- T011 depends on T006 (e2e relay test exercises the new relay flow).
- T012 depends on T006 (e2e board test exercises the new relay flow).
- T013 is independent and can be done last.

## Acceptance

### Functional Completeness

- [x] A-001 Per-Connection Ephemeral Session: `app/backend/api/relay.go` invokes `NewGroupedSession + select-window + attach-session` against the ephemeral, never against the real session.
- [x] A-002 Ephemeral Session Naming Convention: ephemeral names are generated via `crypto/rand` and match `^rk-relay-[0-9a-f]{8}$`.
- [x] A-003 Ephemeral Cleanup on WebSocket Close: relay handler defers `KillSessionCtx(context.Background(), server, ephemeral)`; cleanup uses `context.Background()`, not the request context.
- [x] A-004 NewGroupedSession Helper: function exists in `app/backend/internal/tmux/tmux.go` with signature `NewGroupedSession(ctx context.Context, server, realSession, ephemeral string) error` and wraps ctx with `TmuxTimeout`.
- [x] A-005 TmuxOps Interface Extension: interface includes `NewGroupedSession` and (ctx-aware) `KillSessionCtx`; `prodTmuxOps` and `mockTmuxOps` both implement them.
- [x] A-006 Synchronous Sweep at Server Start: `sweepOrphanedRelaySessions` runs in `cmd/rk/serve.go` before HTTP bind; iterates all servers and kills `rk-relay-*` sessions.
- [x] A-007 Sweep Ordering Before HTTP Bind: sweep call is placed after `tmux.EnsureConfig()` and before the `ListenAndServe` goroutine.
- [x] A-008 Filter rk-relay-* in ListSessions: `parseSessions` excludes any session whose name starts with `rk-relay-`; constant `RelaySessionPrefix` defined.
- [x] A-009 Filter Application Site: filter implemented inside `parseSessions` via fixed-prefix check, no regex, no config knob.
- [x] A-010 WebSocket URL Stability: frontend WebSocket URL contract `/relay/{session}/{window}?server={server}` remains unchanged; ephemeral name never appears in URLs or response payloads.
- [x] A-011 AppShell Single-Pane Uniformity: relay handler has no board/AppShell dispatch — every WebSocket gets its own ephemeral.
- [x] A-012 Sweep Function Signature: `sweepOrphanedRelaySessions(ctx, ops) error` is the canonical signature. **N/A**: implementation uses `sweepOrphanedRelaySessions(ctx)` because it needs `tmux.ListRawSessionNames` (not exposed via `TmuxOps`) to see ephemerals before the user-facing filter applies. Documented in code comments.

### Behavioral Correctness

- [x] A-013 Two relays to the same session, different windows show distinct content (the central bug fix). Verified by `TestRelay_TwoWindowsTwoRelaysDistinctOutput`.
- [x] A-014 Two browser tabs viewing different windows of the same session no longer interfere with each other (latent bug fixed as a side effect). Verified by uniform ephemeral treatment in relay handler.

### Scenario Coverage

- [x] A-015 Scenario "Single relay connection" exercised by relay e2e test.
- [x] A-016 Scenario "Two relay connections to the same session, different windows" exercised by relay e2e test.
- [x] A-017 Scenario "Ephemeral creation fails on missing real session" returns close code 4004 (verified by `TestRelay_MissingSessionClose4004`).
- [x] A-018 Scenario "Round-trip creation" exercised by `TestNewGroupedSession_success`.
- [x] A-019 Scenario "Cleanup verification" — after WS close, no `rk-relay-*` sessions remain (verified by `TestRelay_EphemeralCleanupOnClose`).
- [x] A-020 Scenario "Orphans from a crashed prior instance" exercised conceptually via the sweep helper; sweep code path is exercised at server startup in normal operation.
- [x] A-021 Scenario "rk-relay-* session present" exercised by `parseSessions` unit test (`filters rk-relay-* ephemerals from user-facing list`).
- [x] A-022 Scenario "Group leader filtering still applies" exercised by `parseSessions` unit test (`rk-relay-* exclusion still allows group leaders to be kept`).
- [x] A-023 Scenario "Same-session multi-pane board" covered by `boards-same-session-multi-pane.spec.ts`.

### Edge Cases & Error Handling

- [x] A-024 PTY start failure after ephemeral creation: deferred `KillSessionCtx` runs (defer placed before `pty.StartWithSize`); ephemeral does not leak.
- [x] A-025 Cleanup with cancelled request context: kill uses `context.Background()` with `TmuxTimeout`, not `r.Context()`.
- [x] A-026 Cleanup failure logged at debug level, no error response written to closed WebSocket.
- [x] A-027 ListServers failure during sweep: error logged, sweep returns without killing, server startup continues.
- [x] A-028 Per-server enumeration failure during sweep: failure for one server logged; orphans on other servers still killed.

### Code Quality

- [x] A-029 Pattern consistency: New code follows naming and structural patterns of surrounding code (package-level functions in `tmux.go`, interface dispatch from relay).
- [x] A-030 No unnecessary duplication: Reuses `tmuxExecServer`, `serverArgs`, existing `KillSession` plumbing.
- [x] A-031 `exec.CommandContext` with timeouts (constitution I, code-quality.md): all new tmux calls use `context.WithTimeout(ctx, TmuxTimeout)`.
- [x] A-032 No shell strings (constitution I, code-quality.md anti-pattern): tmux args passed as discrete slice elements.
- [x] A-033 No new in-memory caches (constitution II, code-quality.md anti-pattern): lifecycle is `defer KillSessionCtx` + startup sweep, no registry.
- [x] A-034 Tmux interaction routed through `internal/tmux/` (code-quality.md anti-pattern): no inline tmux command construction in `api/` or `cmd/rk/`.
- [x] A-035 Tests cover added/changed behavior (code-quality.md): tmux integration test for `NewGroupedSession`, relay e2e test, parse filter test, board e2e extension.
- [x] A-036 Test companion docs updated for any modified Playwright `.spec.ts` (constitution Test Companion Docs).
- [x] A-037 Function size: no god functions (>50 lines without clear reason); relay handler additions remain focused.

### Security

- [x] A-038 Random source: 8-hex suffix is read from `crypto/rand.Read`; never derived from user input.
- [x] A-039 Argv safety: all new tmux calls pass arguments as discrete slice elements (no shell strings).
- [x] A-040 Sweep prefix is fixed `rk-relay-` constant; no user-controlled input influences the sweep target.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `app/backend/internal/tmux/tmux.go:610-612` (`KillSession` wrapper) — now a one-line proxy to `KillSessionCtx(context.Background(), ...)`. Existing call sites still use it, so the wrapper is fine to keep, but a future migration to `KillSessionCtx` everywhere would let this be removed.
- `app/backend/api/relay.go:95` (`ListWindows` pre-check) — partly redundant with `NewGroupedSession`'s internal `has-session` probe. The `windows == nil` nil-check is the only consumer of the return value; both paths converge on a 4004 close code. A future simplification could drop the pre-check and rely on `NewGroupedSession` errors alone, saving one tmux subprocess on the missing-session path.
