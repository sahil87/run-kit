# Intake: Go internal/testutil Test Scaffolding Consolidation

**Change**: 260731-4404-go-internal-testutil
**Created**: 2026-07-31

## Origin

Backlog item `[4404]` (dedupe sweep 2026-07-31, clusters 4+8), invoked one-shot via `/fab-new 4404`:

> Consolidate Go test scaffolding into a new app/backend/internal/testutil package (dedupe sweep 2026-07-31, clusters 4+8; tests-only, no production code). (4) STUB-EXECUTABLE-ON-PATH fixture, 5 members ~22 call sites: writeStub duplicated VERBATIM at internal/riff/riff_test.go:435 and internal/wt/wt_test.go:81 (write script bytes 0o755 into a dir, t.Fatalf on error); stubFab riff_test.go:425 (fixed name "fab", returns the t.TempDir); installFakeBrew/withFakeBrew cmd/rk/upgrade_test.go:364/357 (also prepends the temp dir to PATH preserving the original — keep PATH-prepend as an opt-in layer, callers elsewhere do t.Setenv("PATH", dir) themselves); inline fake-serve script internal/daemon/daemon_test.go:834. Layered API: base WriteStub(t, dir, name, script) → 0o755 file; layers: StubOnPath(t, name, script) (TempDir + PATH prepend/restore via t.Setenv), fixed-name conveniences per caller. (8) DEADLINE-POLL loops: 13 inline `deadline := time.Now().Add(...)` + ~50ms-sleep wait loops across internal/tmuxctl/supervisor_test.go (4), internal/tmuxctl/client_test.go (4), internal/tmuxctl/integration_test.go (1), api/relay_test.go (2: :506 waits for clients, :551 fallthrough on resize), api/terminals_ws_test.go (2); divergence = fail-on-expiry (t.Fatalf) vs fall-through-and-assert-after, plus timeout values → WaitUntil(t, timeout, cond func() bool) bool + a Fatalf variant. Do NOT touch internal/desktop/installed_test.go:14 writeFakeBundle (writes a directory bundle, different behavior). Verify: cd app/backend && go test ./... . Parallel-safe with the internal/tmux runner-core item (that one touches riff.go/daemon.go non-test files) — same packages, disjoint files; coordinate merges in internal/riff.

All referenced sites were re-verified against the current tree at intake time (2026-07-31) and match the backlog's line numbers and shapes. No `app/backend/internal/testutil` package exists yet.

## Why

The Go backend test suite has grown two families of copy-pasted scaffolding:

1. **Stub-executable-on-PATH fixture** (5 members, ~22 call sites): `writeStub` is duplicated **verbatim** — identical signature, body, and doc-comment intent — in `internal/riff/riff_test.go:435` and `internal/wt/wt_test.go:81`. Three more variants re-implement the same "write an executable shell script into a dir" primitive with small layers on top: `stubFab` (riff), `installFakeBrew`/`withFakeBrew` (cmd/rk), and an inline fake-serve script in `internal/daemon/daemon_test.go:834`.
2. **Deadline-poll wait loops** (13 sites): the same `deadline := time.Now().Add(...)` + ~50ms `time.Sleep` polling loop is hand-rolled across `internal/tmuxctl` (9), `api/relay_test.go` (2), and `api/terminals_ws_test.go` (2), diverging only in timeout value and expiry behavior (fail with `t.Fatalf` vs fall through and assert after).

If left alone, each new test that needs a stub binary or a wait loop copies one of the existing instances, and the copies drift (they already have: PATH-replacement vs PATH-prepend, Fatalf-on-expiry vs fall-through). Consolidating into one `internal/testutil` package makes the pattern discoverable (code-quality.md explicitly lists "duplicating existing utilities" as an anti-pattern), gives one place to fix behavior, and shrinks the test files. A shared-helper package is the standard Go answer; alternatives (leaving duplication, or per-package `testhelpers_test.go` files) keep the drift problem.

This is **tests-only** — no production code changes, no behavior changes to what the tests prove.

## What Changes

### 1. New package `app/backend/internal/testutil`

A test-support package (regular `.go` files importable from `_test.go` files in other packages; not itself `package *_test`). Contents:

**Stub-executable fixture** (cluster 4):

```go
// WriteStub writes an executable script named `name` into `dir` (0o755).
// Fails the test on write error.
func WriteStub(t *testing.T, dir, name, script string)

// StubOnPath writes an executable script named `name` into a fresh t.TempDir()
// and PREPENDS that dir to PATH (preserving the original, restored via t.Setenv
// cleanup). Returns the dir. This is the opt-in PATH layer — callers that want
// PATH *replacement* call WriteStub and do t.Setenv("PATH", dir) themselves.
func StubOnPath(t *testing.T, name, script string) string
```

- `WriteStub` body is exactly the current duplicated helper: `t.Helper()`, `os.WriteFile(filepath.Join(dir, name), []byte(script), 0o755)`, `t.Fatalf("WriteFile stub %s: %v", name, err)` on error.
- `StubOnPath` composes `t.TempDir()` + `WriteStub` + `t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))` — the `installFakeBrew` semantics. PATH-prepend stays an **opt-in layer**, per the backlog: riff/wt call sites deliberately *replace* PATH (`t.Setenv("PATH", dir)`) and keep doing so at the call site.

**Deadline-poll wait** (cluster 8):

```go
// WaitUntil polls cond every ~50ms until it returns true or timeout elapses.
// Returns whether cond succeeded — the fall-through variant: the caller
// asserts (or t.Errorf's) after.
func WaitUntil(t *testing.T, timeout time.Duration, cond func() bool) bool

// MustWaitUntil is the fail-on-expiry variant: t.Fatalf(msg, args...) when
// WaitUntil returns false.
func MustWaitUntil(t *testing.T, timeout time.Duration, cond func() bool, msg string, args ...any)
```

Both `t.Helper()`. The two variants absorb the observed divergence (fail-on-expiry vs fall-through-and-assert-after); timeout stays a per-call-site argument (values differ: 2s/3s today).

### 2. Migrate cluster-4 call sites (5 members, ~22 call sites)

- `internal/riff/riff_test.go` — delete local `writeStub` (:435); keep `stubFab` (:425) as a thin local convenience delegating to `testutil.WriteStub` (fixed name `"fab"`, returns the `t.TempDir()`). All `writeStub(...)` call sites become `testutil.WriteStub(...)`.
- `internal/wt/wt_test.go` — delete local `writeStub` (:81); call sites become `testutil.WriteStub(...)`. PATH handling at call sites (`t.Setenv("PATH", dir)` — replacement) is unchanged.
- `cmd/rk/upgrade_test.go` — `installFakeBrew` (:364) becomes a thin wrapper over `testutil.StubOnPath(t, "brew", script)` (or is deleted with call sites using `StubOnPath` directly, whichever reads better — the `withFakeBrew` printf-formatting convenience stays local either way).
- `internal/daemon/daemon_test.go:834` — the inline fake-serve `os.WriteFile(..., 0o755)` block becomes `testutil.WriteStub(t, dir, "fake-serve", "#!/bin/sh\nsleep 300\n")` with `script := filepath.Join(dir, "fake-serve")` preserved for the `startSession(script)` call (this caller wants the file *path*, not a PATH entry).

**Excluded**: `internal/desktop/installed_test.go:14` `writeFakeBundle` — writes a directory bundle, different behavior. Do NOT touch.

### 3. Migrate cluster-8 call sites (13 loops)

Replace each inline `deadline := time.Now().Add(...)` + sleep loop with `WaitUntil`/`MustWaitUntil`, choosing the variant matching current expiry behavior:

- `internal/tmuxctl/supervisor_test.go` — 4 loops (:147, :251, :288, :364)
- `internal/tmuxctl/client_test.go` — 4 loops (:139, :178, :233, :444)
- `internal/tmuxctl/integration_test.go` — 1 loop (:67)
- `api/relay_test.go` — 2 loops (:506 waits for tmux clients to register; :551 fall-through on resize, `t.Errorf` after)
- `api/terminals_ws_test.go` — 2 loops (:110, :206)

Each condition body becomes a `cond` closure capturing any needed result (e.g., relay:506's `clients` slice is captured by the closure so the post-loop assertion still sees it). A site whose loop shape genuinely doesn't fit the `cond func() bool` contract (e.g., `client_test.go:139` `fakeSleep.triggerNext` returns a value from inside the loop) may keep a bespoke loop — fitting all 13 is the goal, not a hard requirement; any kept-bespoke site is noted in the plan.

### 4. Verification

`cd app/backend && go test ./...` (i.e., `just test-backend`) must stay green — tests-only change, zero behavior delta expected.

## Affected Memory

None — tests-only refactor with no spec-level behavior change (no production code, no API/UI surface). Hydrate is expected to be a no-op.

## Impact

- **New**: `app/backend/internal/testutil/` (one or two small `.go` files + doc comments; the package itself needs no `_test.go` beyond what's worthwhile — it is exercised by every migrated caller).
- **Modified (test files only)**: `internal/riff/riff_test.go`, `internal/wt/wt_test.go`, `cmd/rk/upgrade_test.go`, `internal/daemon/daemon_test.go`, `internal/tmuxctl/supervisor_test.go`, `internal/tmuxctl/client_test.go`, `internal/tmuxctl/integration_test.go`, `api/relay_test.go`, `api/terminals_ws_test.go`.
- **No production code**, no frontend, no docs/site surface.
- **Parallel-work coordination**: backlog notes `4404` ↔ `zeiy` (internal/tmux runner-core) touch the same packages (internal/riff, internal/daemon) but **disjoint files** (tests vs production) — parallel OK; merge whichever lands first, rebase the other; coordinate merges in internal/riff.

## Open Questions

None — the backlog entry (produced by the 2026-07-31 dedupe sweep) specifies the API shape, the member list, the exclusion, and the verify command, and all sites were re-verified at intake time.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Package path `app/backend/internal/testutil`, tests-only scope, and the `writeFakeBundle` exclusion | Stated verbatim in the backlog entry; sites re-verified against the tree at intake | S:95 R:90 A:95 D:95 |
| 2 | Certain | Layered API: base `WriteStub(t, dir, name, script)`; `StubOnPath` = TempDir + PATH-prepend/restore via `t.Setenv`, opt-in (PATH-replacing callers keep their own `t.Setenv("PATH", dir)`) | Backlog specifies the layering and the opt-in rule explicitly; matches verified `installFakeBrew` vs riff/wt semantics | S:90 R:85 A:95 D:90 |
| 3 | Confident | Fatalf variant named `MustWaitUntil(t, timeout, cond, msg, ...args)` | Backlog says only "a Fatalf variant"; `Must*` is the idiomatic Go prefix for fail-fast variants; trivially renameable | S:60 R:95 A:85 D:75 |
| 4 | Confident | Fixed-name conveniences (`stubFab`, `withFakeBrew`) stay as thin **local** wrappers in their own test files delegating to testutil, not exported from testutil | Backlog's "fixed-name conveniences per caller" reads as per-caller locals; keeps testutil generic and package-agnostic | S:65 R:90 A:80 D:70 |
| 5 | Confident | All 13 poll loops targeted, but a site whose shape doesn't fit `cond func() bool` (e.g., `client_test.go:139` returns a value from the loop) may stay bespoke, noted in the plan | Backlog counts 13; verified :139 is a return-value loop inside a fixture method — forcing it could hurt readability; Test Integrity constraint favors not contorting tests | S:70 R:90 A:80 D:70 |
| 6 | Confident | `WaitUntil` polls at a fixed ~50ms interval; timeout remains a per-site argument | Every verified site sleeps 50ms; timeouts differ (2s/3s) so they stay parameters | S:80 R:95 A:90 D:85 |

6 assumptions (2 certain, 4 confident, 0 tentative, 0 unresolved).
