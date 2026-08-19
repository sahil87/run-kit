# Plan: tmux Version Floor

**Change**: 260819-vtd1-tmux-version-floor
**Intake**: `intake.md`

## Requirements

### tmux: Version helper

#### R1: Version probe and parse
A new `internal/tmux/version.go` SHALL probe the tmux version by running `tmux -V` through PATH (i.e. through the tmux-guard shim to the real binary — exactly the binary run-kit will use) via the existing `RunOutput` runner core (`exec.CommandContext`, argv slice, caller-owned timeout ctx). It SHALL parse the `tmux 3.2a` / `tmux 3.4` output shapes: extract `major.minor` as integers, ignore trailing letter suffixes, and retain the raw version token (e.g. `3.2a`) for messages. Non-release strings (`tmux next-3.7`, vendor formats, anything unparseable) SHALL parse to **unknown** — represented as a parse-failure result, never an error that propagates. The floor constant (`3.4`) SHALL live in this file as the single source of truth, and the comparison helper SHALL implement `>=` semantics (exactly 3.4 passes).

- **GIVEN** `tmux -V` prints `tmux 3.2a`
- **WHEN** the helper probes and compares against the floor
- **THEN** it reports version `3.2a` (raw), major 3 / minor 2, and below-floor = true

- **GIVEN** `tmux -V` prints `tmux 3.4`
- **WHEN** the helper compares against the floor
- **THEN** below-floor = false (the `>=` comparison is load-bearing — Ubuntu 24.04 ships exactly 3.4)

- **GIVEN** `tmux -V` prints `tmux next-3.7`, a vendor format, or the probe itself fails
- **WHEN** the helper parses
- **THEN** the result is unknown — unknown is never below-floor, never warns, never blocks

#### R2: Upgrade hint ladder
`internal/tmux/install_hint.go` SHALL gain an upgrade hint (tmux present but below floor), distinct from the unchanged absence ladder. It MUST NOT recommend apt (apt cannot deliver ≥ 3.4 on the releases where the warning fires). The ladder, keyed on `goos` + a brew PATH probe via the injected `lookPath`:

| Probe | Hint |
|-------|------|
| darwin | `tmux {raw} is below the supported 3.4 — upgrade with: brew upgrade tmux` |
| linux, brew on PATH | `tmux {raw} is below the supported 3.4 — upgrade with: brew install tmux` |
| linux, no brew | `tmux {raw} is below the supported 3.4 — your distro's tmux is too old; install Homebrew (https://brew.sh) then: brew install tmux` |

The full message line (version + remediation) SHALL be composed by this helper so all four consumers (daemon warn, serve warn, doctor note, remote gate) render the identical text.

- **GIVEN** goos=linux, brew absent from PATH, found version `3.2a`
- **WHEN** the upgrade hint is built
- **THEN** it names `3.2a`, states the 3.4 floor, and points to installing Homebrew then `brew install tmux`

### Daemon: Start-time warning

#### R3: Daemon-start version warning (warn, don't block)
The existing `checkTmuxPresent()` seam in `internal/daemon/daemon.go` (runs in both `Start` and `StartWithBinary`, before `IsRunning`, the port guard, and the stale-socket reap) SHALL be extended: absence stays a hard fail with the existing `tmux.InstallHint` remediation (byte-identical behavior); a parsed version below the floor SHALL print exactly one one-line warning (the R2 message) to stderr and continue; unknown versions SHALL neither warn nor block. The warning fires once at start — never per-request. Test seams follow the `daemonTmuxLookPath` idiom: a package-level version-probe var and a package-level warn writer defaulting to `os.Stderr`.

- **GIVEN** tmux resolves on PATH and `tmux -V` reports `3.2a`
- **WHEN** `daemon.Start()` runs
- **THEN** one warning line (R2 message) lands on stderr and the daemon starts normally

- **GIVEN** tmux is absent from PATH
- **WHEN** `daemon.Start()` runs
- **THEN** the existing hard-fail error with `tmux.InstallHint` is returned, unchanged

#### R4: `rk serve` startup warning
`cmd/rk/serve.go` SHALL run the same version check at startup (after `slog.SetDefault`) and emit the R2 message via `slog.Warn` when below floor, so the warning lands in the daemon log on paths where daemon-start stderr is invisible (desktop app "Start & connect", `rk update` restart). Unknown versions log nothing.

- **GIVEN** the daemon session runs `rk serve` with tmux 3.2a on PATH
- **WHEN** the server starts
- **THEN** a `slog.Warn` carrying the R2 message appears in the daemon log

### Doctor: Version detail view

#### R5: Doctor tmux version note
The `rk doctor` tmux check in `cmd/rk/doctor.go` SHALL gain version info: when the version parses at-or-above floor, the OK row carries the version in the check's `Note` (e.g. `3.6a`); below floor the check stays **OK** (warn-shaped, mirroring the code-server precedent — doctor stays green for users who never touch tunnels) with the R2 message as the `Note`; unknown versions leave the note empty or state `version unknown` without warning. `--json` carries the version via the existing `note` field. Doctor is the detail view, not the enforcement point.

- **GIVEN** tmux 3.2a on PATH
- **WHEN** `rk doctor` runs
- **THEN** the tmux row renders `[ OK ] tmux — tmux 3.2a is below the supported 3.4 — …` and `--json` has `ok: true` with the message in `note`

- **GIVEN** tmux 3.6a on PATH
- **WHEN** `rk doctor --json` runs
- **THEN** the tmux check is `ok: true` with the version in `note`

### Remote: Tunnels hard gate

#### R6: Connect refuses below floor
`internal/remote` `Connect` SHALL, at entry (before the ssh probe), check the **local** tmux version via the R1 helper and refuse with an actionable error when the parsed version is below the floor — the tunnels path passes remote host input as tmux argv, and only ≥ 3.4 executes multi-argument commands without a shell (Constitution §I). The error SHALL name the version found plus the R2 upgrade hint. Unknown versions proceed (never block on a parse). A test seam (package-level version-probe var) follows the existing `tmuxRunFn`/`dialFn` idiom.

- **GIVEN** local tmux is 3.2a
- **WHEN** `rk remote connect <name>` runs
- **THEN** Connect returns an error naming `3.2a`, the 3.4 floor, and the upgrade hint — no ssh probe, no tunnel

- **GIVEN** local tmux reports an unparseable version
- **WHEN** Connect runs
- **THEN** the gate passes through and the normal flow proceeds

### Docs: Install guidance

#### R7: Documented minimum and upgrade path
`docs/site/install.md` SHALL state the minimum (tmux ≥ 3.4) and the recommended upgrade path (brew, both platforms), including two caveats: (a) `brew shellenv` must precede `/usr/bin` on PATH or the apt tmux keeps winning (the runtime check catches this since it probes what PATH resolves); (b) an upgraded binary takes effect only at the next `tmux kill-server` — the upgrade itself never kills running sessions. `README.md` SHALL carry at most a one-line minimum-version mention (install-composition standard Policy B — no per-formula install instructions).

- **GIVEN** a user reading docs/site/install.md
- **WHEN** they check tmux requirements
- **THEN** they find the 3.4 minimum, the brew upgrade path, and both caveats

### Non-Goals

- No change to the install script (deliberately thin bootstrap; must not carry run-kit-specific knowledge)
- No homebrew formula change (`depends_on "tmux"` is W3, a manual tap commit outside this repo)
- No doctor drift note (W5 is the separate change `260819-a8bf-doctor-tmux-drift-note`)
- No blocking of daemon start on version (only tunnels hard-gate)
- Nothing restarts or kills tmux (Constitution §VI — upgrades stay user-initiated and latent)

### Design Decisions

#### Floor constant lives in internal/tmux
**Decision**: The `3.4` floor is a single constant in `internal/tmux/version.go`; every consumer (daemon, serve, doctor, remote) compares through the same helper.
**Why**: One source of truth — a future floor bump touches one line; message composition in the hint helper keeps all four surfaces byte-identical.
**Rejected**: Per-consumer constants or strings — drift across four call sites is guaranteed eventually.
*Introduced by*: 260819-vtd1-tmux-version-floor

#### Unknown is never a failure
**Decision**: Unparseable `tmux -V` output (or a failed probe) is "unknown": no warning, no block, empty-note doctor.
**Why**: Never block on a parse — vendor builds and `next-*` snapshots would otherwise brick working setups; false negatives (a silent old tmux) are bounded because release builds all parse.
**Rejected**: Treating unknown as below-floor — turns cosmetic parse gaps into hard tunnel refusals.
*Introduced by*: 260819-vtd1-tmux-version-floor

#### Probe through PATH, not the shim target
**Decision**: `tmux -V` runs through PATH (which resolves to the tmux-guard shim, which execs the real binary).
**Why**: That is exactly the binary every run-kit tmux call uses — probing anything else would measure the wrong tmux under PATH shadowing (the apt-vs-brew case the docs caveat describes).
**Rejected**: Resolving the shim's exec target directly — bypasses the very PATH semantics being checked.
*Introduced by*: 260819-vtd1-tmux-version-floor

## Tasks

### Phase 1: Version helper

- [x] T001 Create `app/backend/internal/tmux/version.go`: `Version` type (major/minor ints + raw token), pure `ParseVersion(string)` for the `tmux 3.2a`/`tmux 3.4` shapes returning unknown on non-release strings, floor constant `3.4`, `>=` below-floor comparison, and a `CurrentVersion(ctx)` probe via `RunOutput(ctx, []string{"-V"}, …)`; add `version_test.go` covering `3.2a`, `3.4`, `3.6a`, `next-3.7`, vendor junk, empty/error output <!-- R1 -->
- [x] T002 Extend `app/backend/internal/tmux/install_hint.go` with the upgrade hint ladder (darwin → `brew upgrade tmux`; linux+brew → `brew install tmux`; linux no-brew → install Homebrew pointer) composing the full "tmux {raw} is below the supported 3.4 — …" line; extend `install_hint_test.go` for all three branches; absence ladder unchanged <!-- R2 -->

### Phase 2: Enforcement points

- [x] T003 Extend `checkTmuxPresent()` in `app/backend/internal/daemon/daemon.go`: after the presence check, probe version (package-level stub var per the `daemonTmuxLookPath` idiom) and print the R2 warning once to a package-level writer (default `os.Stderr`) when below floor; unknown stays silent; absence behavior byte-identical; extend `daemon_test.go` (below-floor warns + continues, at-floor silent, unknown silent, absent still hard-fails) <!-- R3 -->
- [x] T004 [P] Add the startup version check to `app/backend/cmd/rk/serve.go` RunE after `slog.SetDefault`: `slog.Warn` with the R2 message when below floor; nothing on unknown/at-floor <!-- R4 -->
- [x] T005 [P] Extend the tmux check in `app/backend/cmd/rk/doctor.go` `runDoctorChecks()`: version in `Note` when parsed (plain version at/above floor; R2 message below floor; stays `OK: true` both ways); extend `doctor_test.go` for the three note shapes incl. `--json` <!-- R5 -->
- [x] T006 [P] Add the Connect-entry gate in `app/backend/internal/remote/connect.go`: probe local tmux version through a package-level seam, refuse below floor with an error carrying the found version + R2 hint, pass through on unknown; extend `connect_test.go` (below-floor refuses before any ssh, unknown proceeds, at-floor proceeds) <!-- R6 -->

### Phase 3: Docs

- [x] T007 [P] Update `docs/site/install.md`: tmux ≥ 3.4 minimum, brew upgrade path both platforms, the PATH-precedence caveat and the kill-server-latency caveat <!-- R7 -->
- [x] T008 [P] Add the one-line minimum-version mention to `README.md` (Policy B: no per-formula install instructions) <!-- R7 -->

## Execution Order

- T001 blocks everything in Phase 2 (all consume the helper); T002 blocks T003–T006 (all render its message)
- T004, T005, T006 are independent of each other; T007/T008 are independent of all code tasks

## Acceptance

### Functional Completeness

- [x] A-001 R1: `internal/tmux/version.go` exists with parse/compare/probe; `3.4` compares as not-below-floor; letter suffixes ignored; unknown result for non-release strings
- [x] A-002 R2: Upgrade hint ladder implemented with the three probe branches and apt never recommended; absence ladder byte-identical
- [x] A-003 R3: Daemon start warns once on stderr below floor and continues; absence still hard-fails with `tmux.InstallHint`
- [x] A-004 R4: `rk serve` startup logs the R2 message via `slog.Warn` below floor
- [x] A-005 R5: Doctor tmux row carries version note; below floor is OK-with-warning-note, never FAIL; `--json` note populated
- [x] A-006 R6: `Connect` refuses below floor at entry with version + upgrade hint; unknown proceeds
- [x] A-007 R7: install.md states minimum, brew path, both caveats; README carries at most one line

### Behavioral Correctness

- [x] A-008 R1: Exactly-3.4 passes without nagging on every surface (daemon silent, doctor plain note, Connect proceeds)
- [x] A-009 R3: Warning fires once at start — no per-request or repeated logging path introduced

### Scenario Coverage

- [x] A-010 R1: Version parse table test covers `3.2a`, `3.4`, `3.6a`, `next-3.7`, vendor format, empty, probe error
- [x] A-011 R3: Daemon test proves below-floor start succeeds (warn is not a gate)
- [x] A-012 R6: Connect test proves the refusal happens before any ssh exec (no probe calls recorded)

### Edge Cases & Error Handling

- [x] A-013 R1: Probe failure (tmux present but `-V` errors/times out) yields unknown — no warn, no block, no error propagation
- [x] A-014 R2: Linux brew probe uses the injected lookPath (deterministic in tests, no host PATH dependence)

### Code Quality

- [x] A-015 Pattern consistency: version probe reuses `RunOutput`; seams follow the `daemonTmuxLookPath` / `tmuxRunFn` stub idioms; no inline tmux command construction outside `internal/tmux/`
- [x] A-016 No unnecessary duplication: the below-floor message is composed in one place (install_hint helper) and reused by all four consumers
- [x] A-017 `exec.CommandContext` with timeout for the `-V` probe at every call site (Constitution §I / Process Execution)
- [x] A-018 New behavior covered by tests in the same packages (`version_test.go`, `install_hint_test.go`, `daemon_test.go`, `doctor_test.go`, `connect_test.go`)

### Security

- [x] A-019 R6: The tunnels gate closes the <3.4 shell-interpolation exposure — remote host input can no longer reach a shell-joined tmux command on supported paths

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant. The absence ladder (`InstallHint`) and the `checkTmuxPresent()` presence check stay in active use unchanged; every new symbol (`Version`, `ParseVersion`, `CurrentVersion`, `BelowFloor`, `FloorMajor`/`FloorMinor`/`FloorString`, `UpgradeHint`) has call sites in the diff.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Version helper API: pure `ParseVersion` + `CurrentVersion(ctx)` probe reusing `RunOutput`; floor constant + comparison in `version.go` | Intake fixes the file and behavior; API shape follows the runner-core and pure-parse idioms already in `internal/tmux` | S:80 R:85 A:85 D:80 |
| 2 | Confident | Daemon warn writes via a package-level `io.Writer` seam defaulting `os.Stderr`, called from `checkTmuxPresent()` | Intake says "prints a one-line stderr warning"; the writer seam mirrors the existing stub-var idiom for testability | S:75 R:90 A:85 D:75 |
| 3 | Confident | Remote gate sits at the top of `Connect` (before the ssh probe), keyed on the LOCAL tmux version | Intake says "the Connect entry refuses"; the local tmux is what executes the sshArgv, so local version is the security-relevant one | S:85 R:85 A:90 D:85 |
| 4 | Confident | Doctor note carries the plain version at/above floor (not only below) | Intake: "`--json` output carries the version in the check's `note` field" — unconditional phrasing; harmless detail either way | S:70 R:90 A:80 D:75 |
| 5 | Certain | serve.go check runs after `slog.SetDefault` inside RunE | The warning must ride the configured logger (incl. RK_DAEMON_LOG tee) to land in the daemon log per intake | S:85 R:95 A:95 D:90 |

5 assumptions (1 certain, 4 confident, 0 tentative).
