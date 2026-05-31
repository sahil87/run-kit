# Spec: Add --skip-brew-update flag to update command

**Change**: 260531-ckwv-skip-brew-update-flag
**Created**: 2026-05-31
**Affected memory**: none (additive implementation-level CLI flag; default behavior unchanged)

## Non-Goals

- Refactoring the existing `exec.CommandContext("brew", …)` subprocess call style — only a minimal observability/indirection seam matching the repo's existing `…Fn` convention is introduced.
- Changing `brew info`, the up-to-date short-circuit, `brew upgrade`, the non-Homebrew-install message, or the Cellar→bin symlink derivation.
- Touching the daemon restart (`daemon.RestartWithBinary`) behavior — it MUST still run when the flag is set.
- Promoting the flag to a persistent/root flag — it is local to `updateCmd`.
- Implementing the other five toolkits in the cross-toolkit contract — each is a separate change.

## CLI: `rk update` flag surface

### Requirement: `--skip-brew-update` flag exists on the update command

The `update` command (`var updateCmd` in `app/backend/cmd/rk/upgrade.go`, alias `upgrade`) SHALL register a real cobra boolean flag named exactly `--skip-brew-update`. The flag SHALL default to `false`. The flag SHALL be local to `updateCmd` (registered via `updateCmd.Flags()`), NOT a persistent or root-level flag. The flag's help text SHALL convey that it skips the internal `brew update` tap-metadata refresh while still performing the version check, upgrade, and daemon restart.

#### Scenario: Flag is registered and parseable
- **GIVEN** the `rk` binary built from this change
- **WHEN** `rk update --skip-brew-update` is parsed by cobra
- **THEN** parsing succeeds with no unknown-flag error
- **AND** the bound boolean variable is `true`

#### Scenario: Flag defaults to false when absent
- **GIVEN** the `rk` binary built from this change
- **WHEN** `rk update` is parsed without the flag
- **THEN** the bound boolean variable is `false`

#### Scenario: Flag name is exact
- **GIVEN** the cross-toolkit contract fixing the name as `--skip-brew-update`
- **WHEN** the flag is registered
- **THEN** the registered long name is exactly `skip-brew-update` (no alias, no abbreviation-only form, no rename)

### Requirement: The flag gates ONLY the `brew update` tap-metadata refresh

When `--skip-brew-update` is set, the `update` command SHALL skip ONLY the internal `brew update --quiet` invocation (the tap-metadata refresh). All other behavior SHALL be unchanged: the `brew info --json=v2 sahil87/tap/rk` version check, the up-to-date short-circuit (`if latest == version`), the `brew upgrade sahil87/tap/rk`, the Cellar→bin symlink derivation, and the daemon restart SHALL all execute exactly as when the flag is absent.

#### Scenario: Flag set skips brew update but runs brew upgrade
- **GIVEN** a Homebrew-installed `rk` (resolved exe path contains `/Cellar/rk/`)
- **AND** `brew info` reports a stable version different from the running version
- **WHEN** `rk update --skip-brew-update` runs
- **THEN** `brew update` is NOT invoked
- **AND** `brew info` IS invoked (the version check still runs)
- **AND** `brew upgrade sahil87/tap/rk` IS invoked

#### Scenario: Flag set still restarts the daemon
- **GIVEN** the same preconditions as above
- **WHEN** `rk update --skip-brew-update` runs and `brew upgrade` succeeds
- **THEN** `daemon.RestartWithBinary` IS invoked exactly once with the derived brew bin path (`{prefix}/bin/rk`)

#### Scenario: Up-to-date short-circuit still applies with the flag
- **GIVEN** a Homebrew-installed `rk`
- **AND** `brew info` reports a stable version equal to the running version
- **WHEN** `rk update --skip-brew-update` runs
- **THEN** `brew update` is NOT invoked
- **AND** `brew info` IS invoked
- **AND** `brew upgrade` is NOT invoked (short-circuited as "Already up to date")
- **AND** `daemon.RestartWithBinary` is NOT invoked

### Requirement: Default behavior is exactly preserved when the flag is absent

When `--skip-brew-update` is NOT set, the `update` command SHALL behave exactly as it does today: it SHALL invoke `brew update --quiet` before the version check, and on failure SHALL return the existing wrapped error (`could not check for updates (brew update failed): …`).

#### Scenario: Default path runs brew update then upgrade then restart
- **GIVEN** a Homebrew-installed `rk`
- **AND** `brew info` reports a stable version different from the running version
- **WHEN** `rk update` runs without the flag
- **THEN** `brew update` IS invoked
- **AND** `brew upgrade` IS invoked
- **AND** `daemon.RestartWithBinary` IS invoked

#### Scenario: Non-Homebrew install is unaffected by the flag
- **GIVEN** an `rk` whose resolved exe path does NOT contain `/Cellar/rk/`
- **WHEN** `rk update` runs with or without `--skip-brew-update`
- **THEN** the existing "not installed via Homebrew" guidance is printed
- **AND** neither `brew update` nor `brew upgrade` nor the daemon restart is invoked

## Testing: subprocess-stub convention

### Requirement: Tests use the repo's package-var stub convention, not real subprocesses

A new test file `app/backend/cmd/rk/upgrade_test.go` SHALL verify the flag behavior without invoking real Homebrew or restarting a real daemon. The test SHALL follow the repo's established subprocess-test convention: package-level function variables defaulting to the real implementation, swapped within a test via `t.Cleanup`-restored stubs (as in `app/backend/cmd/rk/daemon_start.go`'s `innerServePIDFn` and `daemon_test.go`'s `withInnerServePID`/`withPortOwnerStub`). The change SHALL introduce only the minimal seam(s) needed for this — it SHALL NOT alter the `exec.CommandContext` calling style.

#### Scenario: Brew invocations are observable via a stub
- **GIVEN** a package-level seam routing brew subcommands through a swappable function var
- **WHEN** a test installs a stub that records each brew subcommand name and returns canned output for `info`
- **THEN** the test can assert which brew subcommands ran (`update`, `info`, `upgrade`) without spawning `brew`
<!-- clarified: brew-runner seam shape — upgrade.go currently builds three separate inline exec.CommandContext("brew", …) calls (update/info/upgrade) with no existing var. The seam is a single package-level func var (e.g. `var runBrewFn = func(ctx context.Context, args ...string) ([]byte, error){…}` wrapping exec.CommandContext) that all three call sites route through, defaulting to the real impl and swapped via t.Cleanup per the daemon_start.go innerServePIDFn idiom. The stub records args[0] (subcommand) and returns canned --json=v2 output for "info". This is the minimal seam the contract permits — it does NOT change the exec.CommandContext calling style, it only relocates it behind a var. Resolvable from the established convention; apply agent picks the exact signature. -->

#### Scenario: Daemon restart is observable and stubbed
- **GIVEN** a package-level seam (e.g. `restartDaemonFn`) defaulting to `daemon.RestartWithBinary`
- **WHEN** a test swaps it for a recording stub returning `nil`
- **THEN** the test can assert the restart was called (and with what bin path) without restarting a real daemon

#### Scenario: Homebrew-install guard is satisfiable in-test
- **GIVEN** the `RunE` early-returns unless the resolved exe path contains `/Cellar/rk/`
- **WHEN** a test forces the guard to pass via the same package-var seam convention
- **THEN** the brew-upgrade and daemon-restart code path is reachable independent of the test binary's real location
<!-- clarified: guard seam mechanism — RunE resolves the exe path via os.Executable + filepath.EvalSymlinks, then checks strings.Contains(resolved, "/Cellar/rk/"). The seam is a package-level func var over the path resolution (e.g. `var resolveExeFn = func() (string, error){ … os.Executable + EvalSymlinks … }`), defaulting to the real impl and stubbed in-test to return a synthetic "/opt/homebrew/Cellar/rk/9.9.9/bin/rk" so the guard passes AND the Cellar→bin derivation ("{prefix}/bin/rk") is exercised. Same var idiom as innerServePIDFn; no calling-style change. Any equivalent package-var that makes the guard satisfiable is acceptable — apply agent picks one. -->

### Requirement: Test asserts flag-set and default behaviors

The test SHALL include at least: (a) a flag-set case asserting `brew update` is omitted while `brew upgrade` AND the daemon restart still run; and (b) a default (flag-absent) regression case asserting `brew update` AND `brew upgrade` both run and the daemon restart still happens. The tests SHALL be driven the same way existing flag-bearing commands are driven in `daemon_test.go` (cobra `SetArgs` + `Execute`, or direct `RunE` after setting the flag).

#### Scenario: Flag-set assertion
- **WHEN** the test runs `update` with `--skip-brew-update` under stubs (info reports a newer version)
- **THEN** recorded brew subcommands contain `upgrade` and do NOT contain `update`
- **AND** the daemon-restart stub was called

#### Scenario: Default regression assertion
- **WHEN** the test runs `update` without the flag under stubs (info reports a newer version)
- **THEN** recorded brew subcommands contain both `update` and `upgrade`
- **AND** the daemon-restart stub was called

### Requirement: Build and package tests pass before PR

`go build ./...` (from `app/backend/`) SHALL succeed and the `./cmd/rk/` package tests SHALL pass before the PR is opened.

#### Scenario: Green build and tests
- **WHEN** `go build ./...` and `go test ./cmd/rk/` run from `app/backend/`
- **THEN** both complete with exit code 0

## Design Decisions

1. **Gate the block with `if !skipBrewUpdate`, keeping the timeout context inside the guard**: The `updateCtx`/`updateCancel` context is used only by `brew update`. Moving it inside the guarded block avoids an unused-variable/orphan-`defer` issue when the flag is set.
   - *Why*: Minimal, local, no behavior change on the default path.
   - *Rejected*: Leaving the context outside the guard — would leave an unused context when skipped (compile/lint smell) or require silencing it artificially.

2. **Introduce a package-var seam matching `innerServePIDFn`**: Route the daemon restart (and a brew-runner observability point) through package-level function vars defaulting to the real implementations, plus a seam to satisfy the `/Cellar/rk/` guard.
   - *Why*: This is exactly how the repo already makes `cmd/rk` subprocess/daemon paths testable (`daemon_start.go:17`, `daemon_test.go`). It satisfies the contract's "match existing subprocess convention, do NOT refactor."
   - *Rejected*: Real `brew`/daemon subprocesses in tests (flaky, environment-dependent, mutate the host); a full dependency-injection refactor of `updateCmd` (explicitly disallowed by the contract).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Flag named exactly `--skip-brew-update`, cobra bool, default `false`, local to `updateCmd` | Fixed verbatim by the cross-toolkit contract; confirmed from intake #1 | S:100 R:90 A:95 D:100 |
| 2 | Certain | Gate ONLY the `brew update --quiet` block; info / short-circuit / upgrade / daemon-restart all run regardless of the flag | Contract enumerates exactly what stays unchanged; daemon restart flagged CRITICAL-must-still-run; confirmed from intake #2 | S:100 R:85 A:95 D:100 |
| 3 | Certain | Default (flag absent) preserves current behavior exactly, including the existing brew-update-failed error wrap | Contract: "Default (absent) = current behavior exactly preserved"; confirmed from intake #3 | S:100 R:95 A:100 D:100 |
| 4 | Confident | Test seam uses the repo's `var …Fn = realImpl` package-var idiom, swapped via `t.Cleanup`, not real subprocesses | `daemon_start.go:17` + `daemon_test.go` establish this convention; contract says match existing convention; confirmed from intake #4 | S:85 R:75 A:90 D:80 |
| 5 | Confident | A seam satisfies the `/Cellar/rk/` Homebrew-install guard in-test so the upgrade/restart path is reachable | `RunE` early-returns otherwise; package-var seam is the minimal consistent approach; confirmed from intake #5 | S:75 R:80 A:85 D:75 |
| 6 | Confident | Test stubs `brew info` to return a `stable` version different from compiled-in `version` so `brew upgrade` is reached, plus an equal-version case for the short-circuit | Required to exercise upgrade+restart and the short-circuit assertions; keeps `parseBrewVersion` real; upgraded/confirmed from intake #6 | S:85 R:80 A:90 D:85 |
| 7 | Confident | Default-behavior (flag-absent) assertion included as a regression guard | "Current behavior exactly preserved" is only verifiable by asserting `brew update` runs by default; confirmed from intake #7 | S:80 R:85 A:85 D:80 |
| 8 | Certain | No memory files affected; additive implementation-level flag, default unchanged | Memory domains track tmux/relay/connection-pool behavior, not the `rk update` subprocess sequence; confirmed from intake #8 | S:90 R:90 A:90 D:90 |
| 9 | Certain | Keep the `brew update` timeout context inside the `if !skipBrewUpdate` guard | Context is only used by the refresh; avoids unused-variable/orphan-defer; new at spec stage | S:95 R:90 A:95 D:95 |

9 assumptions (5 certain, 4 confident, 0 tentative, 0 unresolved).
