# Plan: Update & Version Standards Conformance

**Change**: 260719-er5k-update-version-standards-conformance
**Intake**: `intake.md`

## Requirements

### CLI Update: Graceful brew-mutation handling

#### R1: No SIGKILL on brew mutations — SIGTERM + grace instead
The `update` command MUST NOT deliver `SIGKILL` to a mutating brew subprocess (`brew update`, `brew upgrade`) on context expiry. The `exec.Cmd` for mutating brew subcommands SHALL be configured with `cmd.Cancel` delivering `SIGTERM` and `cmd.WaitDelay = 30 * time.Second`, so on timeout brew gets a graceful termination signal plus a 30s grace window to unwind the keg swap before the runtime's final kill. The construction SHALL live in a small extracted helper (`newBrewCmd(ctx context.Context, args ...string) *exec.Cmd`) that the default `runBrewFn` implementation calls, so the cancel configuration is unit-testable without spawning a real brew.

- **GIVEN** a `brew upgrade sahil87/tap/run-kit` subprocess spawned by `rk update` whose context expires mid-transaction
- **WHEN** Go's cancel path fires
- **THEN** the subprocess receives `SIGTERM` (trappable — brew can finish or roll back the keg swap)
- **AND** only after a 30s `WaitDelay` grace window does the runtime escalate to a final kill

#### R2: Generous bounds on brew mutations — no short hard timeout
The bounds on mutating brew subprocesses MUST be generous, sized for a network transfer (the standard: "MUST NOT impose a short hard timeout on `brew upgrade`"). The current `brewTimeout = 120s` on `brew upgrade` (the incident's exact figure) and the inline `30s` on `brew update` SHALL be replaced by `brewUpgradeTimeout = 30 * time.Minute` and `brewUpdateTimeout = 10 * time.Minute`. `exec.CommandContext` with a timeout is retained (constitution § Process Execution) — the bound is generous with graceful cancel, satisfying both the constitution and the standard.

- **GIVEN** a `brew upgrade` that legitimately stalls for minutes on an un-timed `api.github.com` call (Homebrew 6 behavior, observed 2026-07-19)
- **WHEN** the stall exceeds two minutes
- **THEN** the subprocess is NOT terminated — the bound is 30 minutes for `upgrade` and 10 minutes for `update`
- **AND** a hypothetical expiry terminates gracefully per R1, never leaving a corrupted keg

#### R3: Read-only brew calls keep short bounds and default cancel
Non-mutating brew queries SHALL keep their existing short bounds and Go's default cancel behavior: `brew info --json=v2` (10s, `upgrade.go`) and `internal/updatecheck`'s `brew list --versions` (10s) are unchanged. A kill there corrupts nothing and fast-fail is correct.

- **GIVEN** the `brew info --json=v2` version lookup in `rk update`
- **WHEN** `newBrewCmd` constructs its command
- **THEN** no `WaitDelay` is set (zero value) and the default `CommandContext` cancel applies
- **AND** `internal/updatecheck/updatecheck.go` is not modified

#### R4: Tests pin the graceful-mutation behavior against regression
Tests MUST pin (a) the cancel configuration per subcommand class (mutating: `WaitDelay == 30s`; read-only: `WaitDelay == 0`), (b) behavioral `SIGTERM` (not `SIGKILL`) delivery — a fake brew trapping `SIGTERM` exits cleanly within the grace window after context cancel, and (c) the generous bounds (`brewUpgradeTimeout >= 30*time.Minute`, `brewUpdateTimeout >= 10*time.Minute`) so a future refactor cannot silently reintroduce a short hard cap. Existing `upgrade_test.go` seam tests (stubbed `runBrewFn`) MUST stay green unchanged.

- **GIVEN** a fake `brew` on PATH that traps `SIGTERM` (writes a marker, exits 0) and otherwise loops
- **WHEN** the test cancels the context of a `newBrewCmd(ctx, "upgrade", …)` process
- **THEN** the process exits well within the grace window and the marker file exists — proving trappable `SIGTERM` was delivered, not `SIGKILL`

### CLI Version: Release-shape pin

#### R5: `displayVersion` release shape is unit-pinned
A unit test in `root_test.go` MUST pin `displayVersion`'s three input shapes: numeric ldflags version `"1.2.3"` → `"v1.2.3"` (the release shape shll actually parses), already-prefixed `"v1.2.3"` → passthrough, and the `"dev"` sentinel → passthrough (no `"vdev"`). Existing `TestVersionFlag`/`TestShortVersionFlag` stay green unchanged.

- **GIVEN** the package-level `version` var set to `"1.2.3"` (restored after the test)
- **WHEN** `displayVersion()` is called
- **THEN** it returns `"v1.2.3"`, matching the version standard's canonical `run-kit version v{semver}` first-line shape

### Non-Goals

- `HOMEBREW_NO_GITHUB_API=1` is NOT set — the standard's "should also consider" is optional; the generous bound + SIGTERM already satisfies the SHOULD, and the env var alters brew behavior beyond this path (trivially addable later).
- No changes to `api/update.go` (the web one-click path routes through `updateCmd` and inherits the fix), `internal/updatecheck` (read-only query), frontend, or daemon.
- No committed conformance-report doc — the intake's per-clause audit table is the record; ship lifts what's needed into the PR body.

### Design Decisions

#### Graceful cancel lives in an extracted `newBrewCmd` helper
**Decision**: Extract `exec.Cmd` construction into `newBrewCmd(ctx, args...) *exec.Cmd`; the default `runBrewFn` calls it; mutating subcommands (`update`, `upgrade`) get `Cancel`=SIGTERM + `WaitDelay`=30s, keyed on `args[0]`.
**Why**: Makes the cancel configuration unit-testable without spawning a real brew (tests assert on the returned `*exec.Cmd` fields), and keeps the single `runBrewFn` seam that all brew calls and all existing tests route through.
**Rejected**: Configuring the cmd inline in `runBrewFn` (untestable without a real brew or duplicating the wiring); a separate mutating-vs-readonly seam pair (splits the seam existing tests stub).
*Introduced by*: 260719-er5k-update-version-standards-conformance

## Tasks

### Phase 2: Core Implementation

- [x] T001 In `app/backend/cmd/rk/upgrade.go`: replace `brewTimeout = 120s` with `brewUpgradeTimeout = 30 * time.Minute`, `brewUpdateTimeout = 10 * time.Minute`, and `brewCancelGrace = 30 * time.Second`; extract `newBrewCmd(ctx, args...) *exec.Cmd` setting `cmd.Cancel` (SIGTERM) + `cmd.WaitDelay = brewCancelGrace` for `update`/`upgrade` args; route the default `runBrewFn` through it; use the new timeout constants at both `context.WithTimeout` call sites; update the stale seam comment ("does NOT change the exec.CommandContext calling style") <!-- R1, R2, R3 -->
- [x] T002 In `app/backend/cmd/rk/upgrade_test.go`: unit-pin `newBrewCmd` cancel config — `WaitDelay == brewCancelGrace` (30s) for `update` and `upgrade` args; `WaitDelay == 0` for `info` (read-only keeps default cancel) <!-- R1, R3, R4 -->
- [x] T003 In `app/backend/cmd/rk/upgrade_test.go`: behavioral SIGTERM pin — fake `brew` on PATH traps SIGTERM (marker file + exit 0), test starts `newBrewCmd(ctx, "upgrade", …)`, waits for ready, cancels the context, asserts clean exit within the grace window and marker presence <!-- R1, R4 -->
- [x] T004 [P] In `app/backend/cmd/rk/upgrade_test.go`: pin generous bounds — `brewUpgradeTimeout >= 30*time.Minute`, `brewUpdateTimeout >= 10*time.Minute` <!-- R2, R4 -->
- [x] T005 [P] In `app/backend/cmd/rk/root_test.go`: add `TestDisplayVersion` covering `"1.2.3" → "v1.2.3"`, `"v1.2.3"` passthrough, `"dev"` passthrough (swap/restore the package `version` var) <!-- R5 -->

### Phase 3: Integration & Edge Cases

- [x] T006 Run `cd app/backend && go test ./cmd/rk/...` then `go test ./...`; confirm all existing seam tests (`TestUpdate_*`, `TestVersionFlag`, `TestShortVersionFlag`) stay green unchanged <!-- R4, R5 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `newBrewCmd` exists in `upgrade.go`, sets a SIGTERM `Cancel` + 30s `WaitDelay` for `update`/`upgrade` args only, and the default `runBrewFn` constructs its command through it
- [x] A-002 R2: no short hard timeout remains on brew mutations — `brewTimeout = 120s` is gone; `brew upgrade` is bounded at `brewUpgradeTimeout` (30 min) and `brew update` at `brewUpdateTimeout` (10 min)
- [x] A-003 R3: read-only brew calls are untouched — `brew info` keeps its 10s bound with default cancel (zero `WaitDelay`), and `internal/updatecheck/updatecheck.go` has no diff
- [x] A-004 R5: `TestDisplayVersion` in `root_test.go` pins the release shape (`"1.2.3" → "v1.2.3"`) plus both passthroughs

### Behavioral Correctness

- [x] A-005 R1: behavioral test proves context expiry delivers trappable SIGTERM (marker written by the trap) and the process exits within the grace window — never an untrappable SIGKILL

### Scenario Coverage

- [x] A-006 R4: regression pins exist for the bounds (`>= 30m` / `>= 10m`) and the per-subcommand-class `WaitDelay` split, and all pre-existing `upgrade_test.go` / `root_test.go` tests pass unchanged

### Edge Cases & Error Handling

- [x] A-007 R1: a new brew subcommand not matched as mutating inherits the safe default (no grace config, default cancel) — keyed on `args[0]` exactly like the existing stream wiring

### Code Quality

- [x] A-008 Pattern consistency: new code follows the existing seam/helper idioms (`runBrewFn` var seam, `brewStreams`-style standalone testable helper, comment discipline)
- [x] A-009 No unnecessary duplication: single `newBrewCmd` construction point; existing `withFakeBrew` PATH-override idiom reused for the behavioral test
- [x] A-010 Constitution § Security First / § Process Execution: all subprocess calls remain `exec.CommandContext` with explicit argument slices and a timeout — no shell strings, no unbounded contexts

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality (graceful brew-mutation handling + a release-shape version test) without making existing code redundant. The removed `brewTimeout = 120s` const is replaced in place by the two generous bounds, and `installFakeBrew` is extracted from `withFakeBrew` (which now delegates to it) — no leftover symbols or dead branches.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Unit-pin the graceful config via `WaitDelay` (30s vs zero), not `Cancel != nil` — since Go 1.20 `exec.CommandContext` always sets a non-nil default Kill cancel, so `Cancel != nil` distinguishes nothing; SIGTERM semantics are pinned behaviorally instead | Determined by Go stdlib semantics; the intake's "Cancel != nil" phrasing is satisfied in spirit by the behavioral SIGTERM test | S:80 R:95 A:95 D:85 |
| 2 | Certain | Grace window constant named `brewCancelGrace = 30 * time.Second`, defined alongside the timeout constants | Trivial naming within the intake's exact 30s value; matches surrounding constant style | S:75 R:95 A:90 D:90 |
| 3 | Confident | Behavioral SIGTERM test uses the existing fake-brew-on-PATH idiom with a trap script, a ready-file handshake before cancel (avoids the trap-not-yet-installed race), and a `testing.Short()` skip | Intake suggests the shape ("short shell script that traps SIGTERM", "skippable with testing.Short()"); ready-file handshake is a standard anti-flake measure | S:70 R:90 A:85 D:75 |

3 assumptions (2 certain, 1 confident, 0 tentative).
