# Plan: Tmux-Missing Remediation Hints

**Change**: 260817-ho1o-tmux-missing-remediation-hints
**Intake**: `intake.md`

## Requirements

### CLI: shared tmux install-hint helper

#### R1: Platform/package-manager-aware install hint
A new pure helper `InstallHint(goos string, lookPath func(string) (string, error)) string` SHALL live in `app/backend/internal/tmux/install_hint.go` and return the platform-appropriate tmux install instruction. On `darwin` it MUST return `install with: brew install tmux` (byte-identical to the current doctor hint). On `linux` it MUST probe for a package manager via the injected `lookPath`, first found wins, in the fixed order `apt-get` → `dnf` → `yum` → `pacman` → `zypper` → `apk`, returning `install with: sudo <manager-specific command>` (`apt-get install tmux`, `dnf install tmux`, `yum install tmux`, `pacman -S tmux`, `zypper install tmux`, `apk add tmux`). When no manager is found, or on any other GOOS, it MUST return the existing generic fallback `install tmux and ensure it is on PATH`. The helper performs no subprocess execution — `lookPath` probes only.

- **GIVEN** goos `darwin`
- **WHEN** `InstallHint` is called
- **THEN** it returns `install with: brew install tmux` without probing any Linux manager

- **GIVEN** goos `linux` with a `lookPath` that resolves both `apt-get` and `pacman`
- **WHEN** `InstallHint` is called
- **THEN** it returns `install with: sudo apt-get install tmux` (probe order wins)

- **GIVEN** goos `linux` with a `lookPath` that resolves nothing
- **WHEN** `InstallHint` is called
- **THEN** it returns `install tmux and ensure it is on PATH`

### Daemon: fail-fast tmux precheck

#### R2: `rk daemon start` fails fast with remediation when tmux is absent
`daemon.Start()` and `daemon.StartWithBinary()` (`app/backend/internal/daemon/daemon.go`) MUST check tmux presence via a package-level seam (`var daemonTmuxLookPath = exec.LookPath`, the `codeServerLookPath` idiom) at the very top — before `IsRunning()`, `guardPortAvailable()`, and `reapStaleDaemonSocket()`, all of which shell out to tmux. When tmux is absent the returned error MUST carry (a) a plain statement that tmux is required (`tmux not found on PATH — the run-kit daemon runs inside a tmux session`), (b) the `InstallHint` output, and (c) an `rk doctor` pointer. No tmux subprocess may be attempted on this path. Exit-code semantics are unchanged (already fixed at HEAD).

- **GIVEN** a host where `lookPath("tmux")` fails
- **WHEN** `Start()` (or `StartWithBinary()`) is called
- **THEN** it returns an error containing `tmux not found on PATH`, the platform install hint, and `rk doctor`
- **AND** no tmux subprocess is spawned

- **GIVEN** a host where tmux resolves
- **WHEN** `Start()` is called
- **THEN** behavior is unchanged from today (precheck passes through)

### Doctor: package-manager-aware tmux hint

#### R3: Doctor's tmux FAIL hint uses the shared helper
`runDoctorChecks()` (`app/backend/cmd/rk/doctor.go:54-59`) MUST replace its inline darwin/generic branch with `tmux.InstallHint(runtime.GOOS, exec.LookPath)` so the doctor hint and the daemon-start error can never drift. macOS output stays byte-identical; the generic fallback text is preserved for undetectable platforms; the `--json` document shape (`{ok, checks:[{name, ok, hint}]}`) is unchanged — only the `hint` string value varies by platform, as it already does today.

- **GIVEN** a tmux-less Linux host with `apt-get` on PATH
- **WHEN** `rk doctor` runs
- **THEN** the tmux check's Hint is `install with: sudo apt-get install tmux`

- **GIVEN** a tmux-less macOS host
- **WHEN** `rk doctor` runs
- **THEN** the tmux check's Hint is `install with: brew install tmux` (unchanged)

### Non-Goals

- No precheck in foreground `rk serve` or the sessions API — backlog scopes this to daemon start
- No change to the shim hints (`doctor.go` shim check, `tmux_guard.go`) — different failure, different remediation
- No exit-code changes; no auto-install of tmux

### Design Decisions

#### Shared hint helper in `internal/tmux` with injected lookPath
**Decision**: One pure `InstallHint(goos, lookPath)` helper in `internal/tmux`, consumed by both `internal/daemon` (precheck error) and `cmd/rk` (doctor hint).
**Why**: All tmux concerns route through `internal/tmux` (code-quality anti-pattern list); both consumers already import it; a single source keeps the two user-facing hints from drifting; the injected `lookPath` mirrors the `codeServerCheck(home, lookPath, dial)` test idiom so every branch is unit-testable without host PATH dependence.
**Rejected**: Duplicating the darwin/generic branch in the daemon package (drift risk); a new standalone `internal/hints` package (needless surface for one function).
*Introduced by*: 260817-ho1o-tmux-missing-remediation-hints

## Tasks

### Phase 2: Core Implementation

- [x] T001 Create `app/backend/internal/tmux/install_hint.go` with `InstallHint(goos string, lookPath func(string) (string, error)) string` (darwin → brew; linux probe apt-get → dnf → yum → pacman → zypper → apk, first found wins, `sudo`-prefixed commands; generic fallback otherwise) plus `install_hint_test.go` covering darwin, each of the six managers, probe order (apt-get beats pacman when both resolve), no-manager fallback, and non-linux/non-darwin GOOS fallback <!-- R1 -->
- [x] T002 <!-- rework: daemon precheck test hard-codes the generic hint; on darwin InstallHint returns the brew hint before probing, so the assertion fails on macOS — derive the expected hint from tmux.InstallHint(runtime.GOOS, daemonTmuxLookPath) --> Add `var daemonTmuxLookPath = exec.LookPath` seam and the fail-fast precheck at the top of `Start()` and `StartWithBinary()` in `app/backend/internal/daemon/daemon.go` (error: `tmux not found on PATH — the run-kit daemon runs inside a tmux session; <InstallHint output>; run `rk doctor` for a full dependency check`); add tests in `app/backend/internal/daemon/daemon_test.go` stubbing the seam to prove the hint-carrying error and that both entry points hit it before any tmux subprocess <!-- R2 -->
- [x] T003 Replace the inline darwin/generic hint branch in `app/backend/cmd/rk/doctor.go` `runDoctorChecks()` with `tmux.InstallHint(runtime.GOOS, exec.LookPath)`; update any `app/backend/cmd/rk/doctor_test.go` expectations touching the tmux hint <!-- R3 -->

### Phase 3: Integration & Edge Cases

- [x] T004 Run the verification gates: `cd app/backend && go test ./internal/tmux/ ./internal/daemon/ ./cmd/rk/`, then the full `go test ./...` (no frontend impact — Go-only change) <!-- R2 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `InstallHint` exists in `internal/tmux`, is pure over `(goos, lookPath)`, and returns the darwin brew hint, the six manager-specific Linux hints, and the generic fallback exactly as specified
- [x] A-002 R2: `Start()` and `StartWithBinary()` both fail fast on missing tmux with an error carrying the requirement statement, the install hint, and the `rk doctor` pointer
- [x] A-003 R3: `runDoctorChecks()` derives the tmux FAIL hint from `tmux.InstallHint` — no inline platform branch remains in `doctor.go`

### Behavioral Correctness

- [x] A-004 R2: The precheck sits before `IsRunning()`/`guardPortAvailable()`/`reapStaleDaemonSocket()` in both entry points — no tmux subprocess is attempted when tmux is absent
- [x] A-005 R3: macOS doctor hint is byte-identical to the previous `install with: brew install tmux`; the generic fallback text is byte-identical to the previous `install tmux and ensure it is on PATH`; the `--json` schema is unchanged

### Scenario Coverage

- [x] A-006 R1: Unit tests cover darwin, all six Linux managers, probe order, no-manager fallback, and other-GOOS fallback via injected `lookPath` stubs (no host PATH dependence)
- [x] A-007 R2: A daemon test stubs `daemonTmuxLookPath` to absent and asserts both `Start()` and `StartWithBinary()` return the hint-carrying error

### Edge Cases & Error Handling

- [x] A-008 R1: A multi-manager host (e.g. apt-get + pacman both resolve) deterministically gets the first manager in probe order
- [x] A-009 R2: With tmux present, `Start()`/`StartWithBinary()` behavior is unchanged (precheck is a pure pass-through; existing daemon tests still pass)

### Code Quality

- [x] A-010 Pattern consistency: seam naming (`daemonTmuxLookPath`) and injected-`lookPath` test style match the package idioms (`codeServerLookPath`, `codeServerCheck`)
- [x] A-011 No unnecessary duplication: the hint logic exists in exactly one place; `doctor.go` and `daemon.go` both consume the helper
- [x] A-012 Tests included: new behavior (helper, precheck, doctor hint) is covered by unit tests per code-quality.md
- [x] A-013 No subprocess construction: the change adds only `LookPath` probes — no `exec.Command*` calls, no shell strings

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant (the inline doctor hint branch was already removed by the change itself).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Seam named `daemonTmuxLookPath`, package-level var in `daemon.go` | Mirrors the existing `codeServerLookPath` seam in the same package | S:70 R:90 A:85 D:75 |
| 2 | Confident | Error wording: `tmux not found on PATH — the run-kit daemon runs inside a tmux session` + hint + doctor pointer, joined as a single error string | Intake marks exact wording refinable at apply; single-line-per-clause keeps CLI error rendering clean | S:60 R:95 A:75 D:65 |
| 3 | Certain | Verification is Go-only (`go test ./...` in app/backend) — no frontend/e2e gates | Change touches no frontend, API, or tmux-runtime path; code-quality gates scoped to relevant cases | S:80 R:90 A:90 D:85 |

3 assumptions (1 certain, 2 confident, 0 tentative).
