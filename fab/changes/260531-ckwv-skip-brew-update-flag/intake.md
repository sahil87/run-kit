# Intake: Add --skip-brew-update flag to update command

**Change**: 260531-ckwv-skip-brew-update-flag
**Created**: 2026-05-31
**Status**: Draft

## Origin

> Add a boolean `--skip-brew-update` flag to the `update` command. **CONTRACT (cross-toolkit, identical in 6 tools)**: flag name EXACTLY `--skip-brew-update`. When set, skip ONLY the internal `brew update --quiet` tap-metadata refresh. Everything else unchanged: `brew info` version check, up-to-date short-circuit, `brew upgrade`, AND the daemon restart side effect (`daemon.RestartWithBinary`). Default (absent) = current behavior exactly preserved. THIS REPO (run-kit, binary `rk`): file `app/backend/cmd/rk/upgrade.go` (`var updateCmd`, the `brew update` call ~L48); self-contained cobra command. Add a real cobra bool flag `--skip-brew-update` and gate ONLY the brew update line. CRITICAL: leave `daemon.RestartWithBinary` (~L100) untouched — it must still run when the flag is set. Match existing subprocess convention (do NOT refactor). Add a test asserting `--skip-brew-update` omits `brew update` but still runs `brew upgrade` AND the daemon restart, following the repo test pattern.

This is a one-shot, externally-specified change. It is one of six parallel implementations of an identical cross-toolkit contract — the flag name, semantics, and "only gate the metadata refresh" rule are fixed by that contract and are NOT subject to local design preference. run-kit's role is to implement the contract faithfully against its own `rk upgrade` command while matching run-kit's existing subprocess and test conventions.

## Why

1. **Problem.** `rk update` (alias `rk upgrade`) unconditionally runs `brew update --quiet` to refresh tap metadata before checking for a newer `rk`. In environments where the tap is already fresh — CI, scripted batch upgrades, or a fleet/operator loop that updates many tools back-to-back — that metadata refresh is redundant, slow (network round-trip to refresh ALL taps, not just `sahil87/tap`), and occasionally flaky. Across six toolkits invoked in sequence, six redundant `brew update` calls dominate the wall-clock.
2. **Consequence of not fixing.** Callers have no way to opt out of the slow path short of not calling `rk update` at all, which also skips the genuinely useful version check + upgrade + daemon restart. The metadata refresh is currently load-bearing-by-accident: there is no seam to skip just it.
3. **Why this approach.** A single additive boolean flag, defaulting to the current behavior, is the minimal surface that satisfies the contract. It gates exactly one line (`brew update --quiet`) and leaves the entire rest of the flow — including the daemon restart, which is the whole point of `rk update` over a bare `brew upgrade` — intact. Alternatives (an env var, a config setting, a separate `--no-refresh` command) were rejected: the cross-toolkit contract fixes the surface as a cobra bool flag named exactly `--skip-brew-update`, so there is no local choice to make on naming or mechanism.

## What Changes

### 1. New cobra flag on `updateCmd`

Add a real persistent-or-local bool flag to the existing `var updateCmd` in `app/backend/cmd/rk/upgrade.go`. The flag is local to `updateCmd` (the command is self-contained; do not promote to a persistent/root flag). Name EXACTLY `--skip-brew-update`. Default `false`. The flag value is read inside `RunE`.

Because `updateCmd` is currently a package-level `var` with an inline `RunE` closure, the flag must be bound to a package-level variable (cobra cannot bind a closure-local var declared after the command). Follow the repo idiom for command-local flags. Concretely, something like:

```go
var skipBrewUpdate bool

func init() {
    updateCmd.Flags().BoolVar(&skipBrewUpdate, "skip-brew-update", false,
        "Skip the internal 'brew update' tap-metadata refresh (still runs brew info/upgrade and restarts the daemon)")
}
```

(Exact registration site — new `init()` vs. an existing one — follows whatever `cmd/rk` already does; if there is no existing `init()` registering `updateCmd`'s flags, add a minimal one. The command registration onto `rootCmd` lives elsewhere and is NOT touched.)

### 2. Gate ONLY the `brew update` line

The current flow (`upgrade.go` ~L44–L52) is:

```go
// Refresh tap metadata
updateCtx, updateCancel := context.WithTimeout(context.Background(), 30*time.Second)
defer updateCancel()

update := exec.CommandContext(updateCtx, "brew", "update", "--quiet")
update.Stderr = os.Stderr
if err := update.Run(); err != nil {
    return fmt.Errorf("could not check for updates (brew update failed): %w", err)
}
```

Wrap exactly this block in `if !skipBrewUpdate { ... }`. Nothing else in the function moves. The `brew info --json=v2` version check (~L58), the `if latest == version` up-to-date short-circuit (~L69), the `brew upgrade sahil87/tap/rk` (~L79), the Cellar→bin symlink derivation (~L91–95), and the `daemon.RestartWithBinary(brewBinPath)` call (~L100) all run exactly as before, regardless of the flag.

When `skipBrewUpdate` is true, the `updateCtx`/`updateCancel` timeout context for the refresh is no longer needed; move/remove it so it lives only inside the guarded block (avoid an unused-variable / unused-context compile issue and an orphan `defer`).

### 3. Subprocess seam for testability (match existing convention — do NOT refactor the calls)

The contract requires a test that asserts, with `--skip-brew-update` set: `brew update` is NOT invoked, but `brew upgrade` IS invoked AND `daemon.RestartWithBinary` IS invoked — without actually shelling out to Homebrew or restarting a real daemon.

The repo's **established subprocess-test convention** is a package-level function variable defaulting to the real implementation, swapped in tests via `t.Cleanup`. See `app/backend/cmd/rk/daemon_start.go:17`:

```go
var innerServePIDFn = daemon.InnerServePID
```

…stubbed in `daemon_test.go` via `withInnerServePID(t, pid, err)` / `withPortOwnerStub(t, stub)` (set the var, restore in `t.Cleanup`). This is the convention to match. It is NOT a refactor of how the subprocess is *called* — the `exec.CommandContext("brew", ...)` style is preserved verbatim; we only introduce the same kind of indirection seam the repo already uses for `lsof`/`innerServePID`, so the test can observe which brew subcommands ran and stub the daemon restart.

The minimal seam that lets the test observe behavior without altering the calling style:

- Route the three brew invocations through a tiny package-level runner var, e.g. `var runBrew = func(ctx context.Context, args ...string) (*exec.Cmd, ...) {...}` OR, more in keeping with the existing `Fn` idiom, extract the two side-effecting operations the test must observe into package-level function vars: one that runs a brew subcommand and one for the daemon restart. The daemon restart already calls `daemon.RestartWithBinary`; mirror `innerServePIDFn` with e.g. `var restartDaemonFn = daemon.RestartWithBinary` so the test can stub it and record that it was called.
- The `brew info` JSON parsing (`parseBrewVersion`) stays a pure function and is already unit-testable; the test can stub the info call to return a canned newer-version JSON so the up-to-date short-circuit is NOT hit and `brew upgrade` IS reached.

The exact seam shape is an implementation detail for the spec/apply stage, constrained by: (a) match the `…Fn = daemon.X` package-var idiom already in `cmd/rk`; (b) do not change the `exec.CommandContext` call style; (c) the seam must let the test distinguish "brew update ran" from "brew upgrade ran" and confirm "daemon restart ran".

### 4. Test (follow repo test pattern)

Add `app/backend/cmd/rk/upgrade_test.go` (no test file exists today). Follow the patterns in `daemon_test.go` / `doctor_test.go`:

- Use `t.Setenv`/package-var stubs with `t.Cleanup` restoration (the `withInnerServePID` style), not real subprocesses.
- Stub the brew runner so each invoked subcommand is recorded (e.g., append `args[0]` — `"update"`/`"info"`/`"upgrade"` — to a slice). Have the `info` stub return canned `brew info --json=v2` JSON with a `stable` version DIFFERENT from the compiled-in `version`, so the up-to-date short-circuit is skipped and `brew upgrade` is reached.
- Stub `restartDaemonFn` to record it was called and return `nil`.
- Force the Homebrew-install guard to pass. The `RunE` early-returns unless `os.Executable()` resolves to a path containing `/Cellar/rk/`. The test must satisfy this guard via the same kind of seam (e.g., a package-var for the resolved-exe path, or a stub for the function that produces it) so the test does not depend on the test binary's real location. This guard-satisfaction seam follows the same package-var convention.
- **Assertion (flag set, `--skip-brew-update`)**: recorded brew subcommands contain `upgrade` and do NOT contain `update`; `restartDaemonFn` was called exactly once with the derived brew bin path.
- **Assertion (default, flag absent — regression guard)**: recorded brew subcommands contain `update` AND `upgrade`; `restartDaemonFn` was called. This locks in "default = current behavior exactly preserved."

Run via `cobra`'s `RunE`/`Execute` the same way `daemon_test.go` drives commands (`rootCmd.SetArgs([]string{"update", "--skip-brew-update"})` + `Execute()`, or invoke `updateCmd.RunE` directly after setting the flag — match whichever the existing tests prefer for flag-bearing commands).

### 5. Build + test gate before PR

Before opening the PR: `go build ./...` (from `app/backend/`) and run the upgrade package tests (`go test ./cmd/rk/ -run 'Update|Upgrade'` or the full `./cmd/rk/` package). Both must pass.

## Affected Memory

No memory files are affected. This is an additive, implementation-level CLI flag with no spec-level behavioral surface that the memory landscape tracks (memory domains here cover tmux/active-window/relay/connection-pool concerns, not the `rk update` subprocess flow). Default behavior is unchanged, so no existing documented behavior is invalidated.

- *(none)*

## Impact

- **Code (single file + one new test file)**:
  - `app/backend/cmd/rk/upgrade.go` — add bool flag binding, wrap the `brew update` block in `if !skipBrewUpdate`, introduce the minimal package-var seam(s) matching the `innerServePIDFn` idiom for the brew runner / daemon-restart / exe-path guard.
  - `app/backend/cmd/rk/upgrade_test.go` — NEW. Stubbed-subprocess test per repo convention.
- **Behavior**: default path byte-for-byte equivalent to today. New path skips exactly one subprocess (`brew update --quiet`).
- **APIs/deps**: no new dependencies. `cobra` flag API already in use. `daemon.RestartWithBinary` signature unchanged (`func(binPath string) error`).
- **Side effects preserved**: daemon restart (`daemon.RestartWithBinary`) MUST still run with the flag set — this is called out as CRITICAL in the contract and is the primary regression risk.
- **Out of scope / Non-goals**: no refactor of the existing `exec.CommandContext` call style; no change to `brew info`, `brew upgrade`, the up-to-date short-circuit, the non-Homebrew-install message, or the daemon restart; flag is not promoted to root/persistent; the other five toolkits are implemented separately.

## Open Questions

- None blocking. The contract fixes the flag name, semantics, scope, and the "don't touch daemon restart" constraint. The only latitude is the exact shape of the test seam, which is constrained to "match the existing `…Fn` package-var convention" and is resolvable at spec/apply time without user input.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Flag named EXACTLY `--skip-brew-update`, cobra bool, default `false`, local to `updateCmd` | Fixed verbatim by the cross-toolkit contract; no local naming latitude | S:100 R:90 A:95 D:100 |
| 2 | Certain | Gate ONLY the `brew update --quiet` block; `brew info`, up-to-date short-circuit, `brew upgrade`, and `daemon.RestartWithBinary` all run regardless of the flag | Contract enumerates exactly what stays unchanged and flags the daemon restart as CRITICAL-must-still-run | S:100 R:85 A:95 D:100 |
| 3 | Certain | Default (flag absent) preserves current behavior exactly | Contract: "Default (absent) = current behavior exactly preserved" | S:100 R:95 A:100 D:100 |
| 4 | Confident | Test seam uses the repo's package-level function-var idiom (`var …Fn = realImpl`, swapped via `t.Cleanup`) rather than real subprocesses | `daemon_start.go:17` + `daemon_test.go` `withInnerServePID`/`withPortOwnerStub` establish this exact convention; contract says "match existing subprocess convention, do NOT refactor" | S:80 R:70 A:85 D:75 |
| 5 | Confident | Add a seam so the test can satisfy the `/Cellar/rk/` Homebrew-install guard without depending on the test binary's real path | The `RunE` early-returns otherwise, so the brew-upgrade/daemon-restart path is unreachable in a test; a package-var seam is the minimal consistent way to force the guard | S:70 R:75 A:85 D:70 |
| 6 | Confident | Test stubs `brew info` to return a `stable` version different from compiled-in `version` so the up-to-date short-circuit is skipped and `brew upgrade` is reached | Required to exercise the assertion that `brew upgrade` AND daemon restart run; canned JSON keeps `parseBrewVersion` real | S:80 R:80 A:90 D:80 |
| 7 | Confident | Add a default-behavior (flag-absent) assertion alongside the flag-set one as a regression guard | Contract's "current behavior exactly preserved" is only verifiable by asserting `brew update` DOES run by default | S:75 R:85 A:85 D:75 |
| 8 | Certain | No memory files affected; additive implementation-level flag | Memory domains track tmux/relay/connection-pool behavior, not the subprocess sequence of `rk update`; default behavior unchanged | S:85 R:90 A:90 D:90 |
| 9 | Certain | PR title EXACTLY `feat: add --skip-brew-update flag to update command`; do NOT merge; no Co-Authored-By / "Generated with Claude" footer | Specified verbatim in the request | S:100 R:80 A:100 D:100 |

9 assumptions (6 certain, 3 confident, 0 tentative, 0 unresolved).
