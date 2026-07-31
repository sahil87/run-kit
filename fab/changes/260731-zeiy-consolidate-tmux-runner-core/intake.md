# Intake: Consolidate tmux subprocess runner core into internal/tmux

**Change**: 260731-zeiy-consolidate-tmux-runner-core
**Created**: 2026-07-31

## Origin

One-shot `/fab-new zeiy` from backlog item `[zeiy]` (dedupe sweep 2026-07-31, cluster 10, MEDIUM divergence). Raw backlog text:

> Consolidate the tmux subprocess runner core into internal/tmux (dedupe sweep 2026-07-31, cluster 10; MEDIUM divergence — scope tightly, app/backend production code). The exec.CommandContext("tmux", argv) + capture-stderr + wrap-trimmed-stderr-into-error runner is repeated in 4 packages (~9 sites): internal/tmux/tmux.go:1126 runTmuxWithEnv (canonical, has env+dir options), internal/daemon/daemon.go:102 runTmuxInDir + :120 runTmuxOutput (comment literally says "Mirrors runTmux's ... convention"; adds stdout-capture variant), internal/riff/riff.go:458/474/498/520 (argv built by tmuxArgv(spec,...) -L targeting + childEnv $TMUX restore), cmd/rk/agent_hook.go:409 and ~:432 (argv via tmuxSocketArgs(tmux.OriginalTMUX) -S targeting; errors deliberately swallowed, never-fail contract). SCOPE: consolidate ONLY the runner core — export from internal/tmux something like Run(ctx, argv, opts{Env, Dir}) error and RunOutput(ctx, argv, opts) ([]byte, error) with the stderr-in-error convention — and migrate the 4 packages onto it. The socket-TARGETING flavors (-L const daemon socket / -L spec.Server riff daemon-path / bare+restored $TMUX riff CLI-path / -S from tmux.OriginalTMUX agent_hook) are DELIBERATE, documented, per-site semantics and MUST NOT be unified — each caller keeps building its own argv prefix (riff keeps tmuxArgv, agent_hook keeps tmuxSocketArgs). agent_hook keeps swallowing errors at its call sites. Rationale: code-quality.md anti-pattern "Inline tmux command construction — all tmux interaction goes through internal/tmux/"; constitution I (CommandContext + explicit argv, timeouts stay at call sites). Verify: cd app/backend && go test ./... . Parallel-safe with the internal/testutil item (tests-only, disjoint files) — coordinate merges in internal/riff and internal/daemon.

All cited sites were re-verified against the current tree at intake time (line numbers confirmed accurate).

## Why

1. **The pain point**: the same ~15-line subprocess-runner idiom — `exec.CommandContext(ctx, "tmux", argv...)`, capture stderr into a buffer, on non-zero exit wrap the trimmed stderr into the returned error (`fmt.Errorf("%w: %s", err, trimmedStderr)`) — is hand-copied across 4 packages (~9 sites). `internal/daemon/daemon.go`'s copy literally documents itself as "Mirrors runTmux's exec.CommandContext + stderr-in-error convention". This is the exact anti-pattern `fab/project/code-quality.md` names: *"Duplicating existing utilities"* and *"Inline tmux command construction — all tmux interaction goes through `internal/tmux/`"*.

2. **The consequence of not fixing it**: convention drift. The copies have already diverged in small ways (riff's `runTmuxArgv`/`listWindowNames` use `CombinedOutput` instead of stderr-only capture; buffer types differ — `strings.Builder` vs `bytes.Buffer`). Each future fix to the runner (e.g., a stderr-trimming edge case, an env-handling bug) must be applied N times or silently misses copies.

3. **Why this approach**: `internal/tmux` already owns the canonical implementation (`runTmuxWithEnv`, tmux.go:1126, the only copy with env+dir options — a superset of every other copy's needs). Exporting it as `Run`/`RunOutput` and migrating callers is the minimal consolidation: no new package, no behavior change, no unification of the deliberate per-site socket-targeting semantics.

## What Changes

### 1. New exported runner core in `internal/tmux`

Export two functions plus an options struct from `internal/tmux` (new code in `tmux.go` or a small new file in the package, following package layout conventions):

```go
// RunOpts carries optional per-invocation overrides for the tmux runner.
type RunOpts struct {
    Env []string // nil inherits the process environment
    Dir string   // "" inherits the process CWD
}

// Run executes `tmux <args...>` and returns an error with tmux's trimmed
// stderr appended ("%w: %s"); a bare error when stderr is empty.
func Run(ctx context.Context, args []string, opts RunOpts) error

// RunOutput executes `tmux <args...>` returning stdout on success; on failure
// the error carries trimmed stderr per the same convention.
func RunOutput(ctx context.Context, args []string, opts RunOpts) ([]byte, error)
```

Fixed contract (this IS the existing convention, now in one place):
- `exec.CommandContext(ctx, "tmux", args...)` — explicit argv slice, never shell strings (Constitution §I).
- **No timeout inside** — the ctx is caller-owned; every call site already wraps its own timeout (`withTimeout()`, riff's `TmuxTimeout`, daemon ctx, `agentHookCmdTimeout`). The core adds none.
- `Run` uses `cmd.Run()`; `RunOutput` uses `cmd.Output()` (stdout returned, excluded from error text) — both capture stderr separately and wrap it as `fmt.Errorf("%w: %s", err, strings.TrimSpace(stderr))`, falling back to the bare error when stderr is empty.
- `opts.Env == nil` → inherit process env; `opts.Dir == ""` → inherit process CWD (matches `runTmuxWithEnv`'s current semantics exactly).

`runTmuxWithEnv` (tmux.go:1126) is subsumed: its body becomes `Run`, and its in-package callers (e.g. `CreateSession` → `runTmuxWithEnv(ctx, full, CleanEnvForServer(), ServerBirthDir())`) migrate to `Run(ctx, full, RunOpts{Env: CleanEnvForServer(), Dir: ServerBirthDir()})`. In-package stdout-capture helpers `tmuxExecServer` / `tmuxExecRawServer` (tmux.go:~481/~511) already share the byte-exact convention and rebase onto `RunOutput`, keeping their line-splitting / raw-string wrappers.

### 2. Migrate `internal/daemon` (daemon.go:90–133)

- `runTmuxInDir(ctx, dir, args...)` — keeps prepending `-L serverSocket` (the deliberate const-socket targeting), then delegates: `tmux.Run(ctx, fullArgs, tmux.RunOpts{Dir: dir})`. The thin `runTmux`/`runTmuxInDir` wrappers MAY remain as package-local argv-prefix helpers — only the runner body is deleted.
- `runTmuxOutput(ctx, args...)` — same prefix, delegates to `tmux.RunOutput(ctx, fullArgs, tmux.RunOpts{})`.
- The "Mirrors runTmux's … convention" comment goes away with the mirrored code.

### 3. Migrate `internal/riff` (riff.go:458/474/498/520)

All four sites keep building argv via `tmuxArgv(spec, ...)` (the deliberate `-L` daemon-path / bare CLI-path targeting) and keep `childEnv(spec)` ($TMUX restore) — passed as `RunOpts{Env: childEnv(spec)}`:

- `resolveWindowIDFromPane` (:458) → `tmux.RunOutput(...)`, error still discarded at the call site (documented best-effort contract; no "quiet" variant added to the core).
- `runTmuxNewWindowCapturePaneID` (:474) → `tmux.RunOutput(...)`; on error, wrap the returned error into `SubprocessErr` at the call site as today (the core's stderr-in-error text replaces the manual `exitErr.Stderr` extraction).
- `runTmuxArgv` (:498) → `tmux.Run(...)`, wrapping into `SubprocessErr` at the call site.
- `listWindowNames` (:520) → `tmux.RunOutput(...)`, wrapping into `SubprocessErr`.

**Known error-text delta**: `runTmuxArgv` and `listWindowNames` currently use `CombinedOutput()`, so their `SubprocessErr` text today includes stdout+stderr; after migration it carries stderr only (the convention). tmux writes diagnostics to stderr, so no diagnostic signal is lost; no code or test parses these strings.
<!-- assumed: riff's two CombinedOutput sites adopt stderr-only error capture, dropping stdout from SubprocessErr text — tmux diagnostics go to stderr, message text is not parsed anywhere -->

### 4. Migrate `cmd/rk/agent_hook.go` (:409, :432)

`writeAgentStateImpl` and `writeChatImpl` keep building argv via `tmuxSocketArgs(tmux.OriginalTMUX)` (the deliberate `-S` targeting) and keep their never-fail contract — call sites become `_ = tmux.Run(cctx, args, tmux.RunOpts{})` with the error still deliberately swallowed and the existing "Errors are intentionally ignored (never-fail contract)" comments retained.

### Non-Goals (hard scope boundaries from the backlog)

- **NO unification of socket-targeting** — the four targeting flavors (`-L` const daemon socket / `-L spec.Server` riff daemon-path / bare+restored `$TMUX` riff CLI-path / `-S` from `tmux.OriginalTMUX` in agent_hook) are deliberate, documented, per-site semantics. Each caller keeps its own argv-prefix builder (`serverArgs`, daemon's `-L serverSocket` prepend, riff's `tmuxArgv`, agent_hook's `tmuxSocketArgs`).
- **NO timeout centralization** — timeouts stay at call sites (Constitution §I keeps them caller-owned; sites use different budgets: 5–10s tmux default, 2s probe, agent-hook's own).
- **NO behavior change** — pure consolidation; error-message text delta at riff's two CombinedOutput sites is the only observable difference, and it is diagnostic-text-only.
- Other direct `exec.CommandContext("tmux", ...)` sites with materially different contracts (e.g. `probeServerAlive` tmux.go:1978 — boolean probe, no stderr capture wanted) are out of scope.

## Affected Memory

None — implementation-only consolidation. No spec-level behavior changes: the API surface (HTTP/SSE/WS), tmux semantics, socket targeting, error contracts, and timeouts are all unchanged. The exported `Run`/`RunOutput` is an internal package seam, not an architectural component.

## Impact

- **Code areas** (app/backend production code only):
  - `internal/tmux/tmux.go` — new exported `Run`/`RunOutput`/`RunOpts`; `runTmuxWithEnv` subsumed; `tmuxExecServer`/`tmuxExecRawServer` rebased.
  - `internal/tmux/tmux_test.go` — unit tests for the new exported core.
  - `internal/daemon/daemon.go` — runner bodies replaced with delegation (~30 lines removed).
  - `internal/riff/riff.go` — four sites delegated (~35 lines simplified).
  - `cmd/rk/agent_hook.go` — two sites delegated.
- **Dependencies**: `internal/daemon`, `internal/riff`, and `cmd/rk` already import `internal/tmux` — no new import edges, no cycle risk.
- **Verification**: `cd app/backend && go test ./...` (run via `just test-backend` per project convention).
- **Parallel-work coordination**: backlog notes `[4404]` (internal/testutil consolidation) touches the same Go packages (`internal/riff`, `internal/daemon`) with disjoint files (tests vs production) — parallel OK; merge whichever lands first, rebase the other. Trivial merge coordination expected at PR time.

## Open Questions

None — the backlog entry (authored by the 2026-07-31 dedupe sweep with full site-level analysis) resolves scope, API shape, targeting semantics, error contracts, and verification explicitly.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Consolidate ONLY the runner core; the four socket-targeting argv-prefix flavors stay per-site and are never unified | Backlog mandates this in caps ("MUST NOT be unified"); each flavor is documented deliberate semantics | S:95 R:90 A:95 D:95 |
| 2 | Certain | agent_hook call sites keep swallowing errors (`_ = tmux.Run(...)`) preserving the never-fail contract | Explicit in backlog; contract is documented in-code at both sites | S:95 R:95 A:95 D:95 |
| 3 | Certain | The core takes a caller-owned ctx and adds no timeout; per-site timeout budgets stay at call sites | Backlog rationale + Constitution §I; every site already owns its timeout with differing budgets | S:90 R:90 A:95 D:90 |
| 4 | Confident | API shape: `Run(ctx, args []string, opts RunOpts) error` + `RunOutput(...) ([]byte, error)` with `RunOpts{Env []string, Dir string}`; nil/empty fields inherit process env/CWD | Backlog says "something like" — exact naming has latitude; shape mirrors the canonical `runTmuxWithEnv` signature | S:80 R:85 A:80 D:70 |
| 5 | Confident | riff's two `CombinedOutput` sites (`runTmuxArgv`, `listWindowNames`) adopt stderr-only capture; `SubprocessErr` wrapping stays at riff call sites, wrapping the core's returned error | Convention alignment is the point of the change; tmux diagnostics go to stderr; error text is not parsed by code or tests | S:60 R:85 A:75 D:65 |
| 6 | Confident | In-package helpers migrate too: `runTmuxWithEnv` becomes `Run`; `tmuxExecServer`/`tmuxExecRawServer` rebase onto `RunOutput` keeping their line-split/raw wrappers | They share the byte-exact convention; leaving in-package copies would defeat the consolidation; backlog names tmux.go:1126 as a migration site | S:65 R:90 A:85 D:70 |
| 7 | Certain | Best-effort riff `resolveWindowIDFromPane` uses `RunOutput` and discards the error at the call site — no "quiet" variant added to the core | Site's best-effort contract is documented in-code; error-discard at call site is the existing pattern | S:75 R:90 A:85 D:80 |
| 8 | Certain | New unit tests cover `Run`/`RunOutput` (stderr-wrap convention, empty-stderr fallback, Env/Dir overrides) in `internal/tmux`; migrated call sites are covered by the existing suite via `go test ./...` | code-quality.md requires tests for changed behavior; existing suite is the backlog's named verification gate | S:70 R:90 A:85 D:80 |

8 assumptions (5 certain, 3 confident, 0 tentative, 0 unresolved).
