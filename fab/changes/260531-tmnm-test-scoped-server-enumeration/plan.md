# Plan: Test-scoped server enumeration

**Change**: 260531-tmnm-test-scoped-server-enumeration
**Status**: In Progress
**Intake**: `intake.md`
**Spec**: `spec.md`

## Tasks

### Phase 1: Core Implementation

<!-- Primary functionality. Order by dependency — earlier tasks are prerequisites for later ones. -->

- [x] T001 Add a package-visible match predicate `matchesServerAllowlist(name, allowlist string) bool` in `app/backend/internal/tmux/tmux.go`. Semantics: empty/whitespace-only `allowlist` returns true for all names (treated as unset); otherwise split on `,`, trim each token of surrounding whitespace, skip empty tokens, and return true when `name` `strings.HasPrefix` ANY non-empty token (prefix match, exact = prefix-of-itself). <!-- A-002, A-005, A-006 -->
- [x] T002 Apply the predicate inside `ListServers` (`app/backend/internal/tmux/tmux.go:1413`) AFTER the live-server probe, gated on `os.Getenv("RK_SERVER_ALLOWLIST")` read directly in-package (matching the `RK_TMUX_CONF`/`OriginalTMUX` precedent at tmux.go:34,54 — do NOT import `internal/config`). Keep the existing concurrent probe + sort untouched; when the env var is unset/empty, output is byte-for-byte identical to today. Update the `ListServers` doc comment to explain the env-gating and WHY the filter lives here (board.go and /api/servers both root at ListServers; prod leaves the var unset so the tmux.go:1332 contract is preserved). Read-only enumeration — no new exec calls. <!-- A-001, A-003, A-004 -->

### Phase 2: Test Harness & Tests

- [x] T003 [P] Add a Go unit test for `matchesServerAllowlist` in `app/backend/internal/tmux/tmux_test.go`, mirroring the existing `TestIsTestServerName` table style. Cover: unset/empty allowlist → all match; whitespace-only allowlist → all match; exact match; prefix match (`rk-test-e2e` admits `rk-test-e2e-multi-4821-318204`); comma-separated multi-token with surrounding whitespace (`rk-test-e2e, rk-test-foo`); empty tokens ignored; non-match (`rk-test-relay-...` NOT admitted by `rk-test-e2e`); the broader `rk-test-` umbrella case. No live tmux server required. <!-- A-007 -->
- [x] T004 [P] In `scripts/test-e2e.sh`, export `RK_SERVER_ALLOWLIST` (set to the `E2E_TMUX_SERVER` value, `rk-test-e2e`) into the environment of the dev BACKEND launch (the `setsid ... just dev` line, ~:46) — not only the Playwright invocation. Preserve the existing setsid + PGID structure. Leave the existing `E2E_TMUX_SERVER` write-socket scoping unchanged. Add a brief comment explaining `RK_SERVER_ALLOWLIST` scopes the backend READ path (what `ListServers` returns) vs `E2E_TMUX_SERVER` scoping the WRITE socket. <!-- A-008, A-009 -->

### Phase 3: Verification

- [x] T005 Run the scoped gates: `cd app/backend && go build ./...`, `go test ./internal/tmux/...`, `go test ./api/...`, `go vet ./internal/tmux/...`, and `bash -n scripts/test-e2e.sh`. Fix root causes of any failures. <!-- A-010, A-011 -->

## Execution Order

- T001 blocks T002 (the predicate must exist before `ListServers` can call it).
- T003 depends on T001 (tests the predicate); T004 is independent and may run alongside.
- T005 runs last, after all implementation and test edits.

## Acceptance

### Functional Completeness

- [x] A-001 Env-gated allowlist filter in `ListServers`: `ListServers` reads `RK_SERVER_ALLOWLIST` directly via `os.Getenv` in-package (no `internal/config` import) and filters the probed live-server list through `matchesServerAllowlist` before returning.
- [x] A-002 Prefix-match semantics: a server matches when it `strings.HasPrefix` any trimmed, non-empty comma-delimited token; exact match is the prefix-of-itself case.
- [x] A-008 Harness scopes the backend read path: `scripts/test-e2e.sh` exports `RK_SERVER_ALLOWLIST=rk-test-e2e` into the `setsid ... just dev` backend launch environment.

### Behavioral Correctness

- [x] A-003 Env unset preserves production behavior: with `RK_SERVER_ALLOWLIST` unset, `ListServers` returns all live servers sorted, byte-for-byte identical to today (concurrent probe + sort unchanged).
- [x] A-004 Env set scopes enumeration: with `RK_SERVER_ALLOWLIST=rk-test-e2e`, `ListServers` returns only `rk-test-e2e*` servers, excluding operator `kit`/`runWork`; all `ListServers` consumers (servers.go, board.go, serve_sweep.go, router.go) inherit the scope.
- [x] A-009 Write-socket scoping unchanged: the existing `E2E_TMUX_SERVER` variable and the tmux server creation/cleanup in `scripts/test-e2e.sh` are untouched; the new comment distinguishes READ-path (`RK_SERVER_ALLOWLIST`) from WRITE-socket (`E2E_TMUX_SERVER`) scoping.

### Scenario Coverage

- [x] A-005 Match predicate unit-tested hermetically: a table-driven Go test exercises `matchesServerAllowlist` across unset, empty, exact, prefix, multi-token-with-whitespace, empty-token, and non-match rows with no live tmux server required.

### Edge Cases & Error Handling

- [x] A-006 Empty/whitespace-only value treated as unset: an empty or whitespace-only `RK_SERVER_ALLOWLIST` returns all servers (no accidental "match nothing").

### Code Quality

- [x] A-007 Test coverage: the changed behavior (the match predicate) ships with a unit test mirroring the package's existing `TestIsTestServerName` style.
- [x] A-010 Pattern consistency: env read matches the in-package `RK_TMUX_CONF`/`OriginalTMUX` precedent; no `internal/config` import added to `internal/tmux`; comment density and naming match surrounding code.
- [x] A-011 No new exec / no scope creep: the filter is pure read-only enumeration with no new `exec.CommandContext` calls; `IsTestServerName`, the `tmuxctl` supervisor, and the reaper are untouched (Non-Goals respected).

### Constitution Compliance

- [x] A-012 No database / derive-from-tmux preserved; read-only enumeration; mutations N/A (no new endpoints); `go build`, `go test ./internal/tmux/...`, `go test ./api/...`, `go vet`, and `bash -n scripts/test-e2e.sh` all pass.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
