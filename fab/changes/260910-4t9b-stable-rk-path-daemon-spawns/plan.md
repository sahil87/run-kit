# Plan: Stable rk path for daemon-spawned processes

**Change**: 260910-4t9b-stable-rk-path-daemon-spawns
**Intake**: `intake.md`

## Requirements

### selfpath: version-stable path derivation

#### R1: `StableFor` maps a Cellar path to the brew-prefix symlink
`app/backend/internal/selfpath` MUST export `StableFor(resolved string) string`. When `resolved` contains `CellarMarker` (`/Cellar/run-kit/`), it SHALL return `resolved[:index(CellarMarker)] + "/bin/run-kit"` — byte-identical to the derivation `cmd/rk/upgrade.go` performs inline today. Any other input (no marker, empty string) SHALL be returned unchanged. The function MUST be a pure string derivation: it SHALL NOT stat, resolve, or otherwise touch the filesystem.

- **GIVEN** `/home/linuxbrew/.linuxbrew/Cellar/run-kit/3.19.42/bin/run-kit`
- **WHEN** `StableFor` is called
- **THEN** it returns `/home/linuxbrew/.linuxbrew/bin/run-kit`

- **GIVEN** `/opt/homebrew/Cellar/run-kit/0.5.3/bin/run-kit`
- **WHEN** `StableFor` is called
- **THEN** it returns `/opt/homebrew/bin/run-kit`

- **GIVEN** `/usr/local/bin/rk`, `/home/u/go/bin/rk`, or `""`
- **WHEN** `StableFor` is called
- **THEN** the input is returned unchanged

#### R2: `Stable` is `Resolve` followed by `StableFor`
`selfpath` MUST export `Stable() (string, error)` with the same signature as `Resolve`, returning `StableFor(resolved)` where `resolved` is the `Resolve()` result, and propagating `Resolve`'s error unchanged. `Resolve`, `IsBrewInstalled`, and `CellarMarker` SHALL remain unchanged.

- **GIVEN** the test binary (a non-Cellar path)
- **WHEN** `Stable()` is called
- **THEN** it returns a non-empty path, no error, and equals `StableFor(Resolve())`

### daemon: long-lived spawns carry the stable path

#### R3: The code-server spawn's `RK_BIN` and the install-job chain use `Stable`
`internal/daemon/codeserver.go` MUST default `codeServerSelfPath` to `selfpath.Stable`. Both consumers — the `RK_BIN=<self>` env element of the `rk-code-server` spawn argv and the `'<exe>' code-server install && '<exe>' code-server start` install-job chain — SHALL therefore carry the brew-prefix symlink on a Homebrew install and the resolved binary elsewhere. The warn-and-continue posture on resolution failure MUST be unchanged (spawn proceeds without `RK_BIN`; install job is skipped with a warning). The seam's doc comment and the spawn commentary block MUST describe the value as version-stable and state why (the session outlives the binary version that spawned it).

- **GIVEN** the self path resolves to `/opt/homebrew/Cellar/run-kit/1.2.3/bin/run-kit`
- **WHEN** the daemon spawns `rk-code-server`
- **THEN** the `new-session` argv carries `RK_BIN=/opt/homebrew/bin/run-kit` immediately after `-u VSCODE_IPC_HOOK_CLI` and no argv element contains `/Cellar/`

- **GIVEN** the same self path and a missing managed code-server binary
- **WHEN** the daemon spawns the install job
- **THEN** the job argv is `'/opt/homebrew/bin/run-kit' code-server install && '/opt/homebrew/bin/run-kit' code-server start`

#### R4: The gui supervisor argv uses `Stable`
`internal/daemon/gui.go` MUST default `guiSelfPath` to `selfpath.Stable`, with its doc comment updated to say the value is version-stable. The `<rk-exe> gui supervise host --display :N` argv element SHALL be the brew-prefix symlink on a Homebrew install and the resolved binary elsewhere.

- **GIVEN** the self path resolves to `/opt/homebrew/Cellar/run-kit/1.2.3/bin/run-kit` and a free display `:10`
- **WHEN** the daemon spawns the `rk-gui` session
- **THEN** the `new-session` argv's exe element is `/opt/homebrew/bin/run-kit` and no element contains `/Cellar/`

### cmd/rk: the upgrade leg reuses the shared derivation

#### R5: `runUpdateCLILeg` derives the restart path via `StableFor`
`cmd/rk/upgrade.go` `runUpdateCLILeg` MUST compute `brewBinPath` as `selfpath.StableFor(resolved)`, replacing the inline `strings.Index` derivation and its unreachable `cellarIdx == -1` branch (the leg already returned when `!IsBrewInstalled(resolved)`). Observable behavior SHALL be unchanged: the restart still receives `<prefix>/bin/run-kit`. `resolveExeFn` MUST keep `selfpath.Resolve` (brew detection needs the Cellar marker).

- **GIVEN** `resolveExeFn` returns `/opt/homebrew/Cellar/run-kit/9.9.9/bin/run-kit`
- **WHEN** `runUpdateCLILeg` restarts the daemon after a successful `brew upgrade`
- **THEN** `restartDaemonFn` receives `/opt/homebrew/bin/run-kit` (the existing `upgrade_test.go` assertions pass unchanged)

### Non-Goals

- `app/code-bridge/src/rk.ts` ladder unchanged — no fall-through to `rk` on PATH when `RK_BIN` is set but ENOENT (rejected as symptom treatment).
- No self-heal of an already-running `rk-code-server` session with a dangling `RK_BIN`; no doctor row.
- Callers that need the real binary keep `selfpath.Resolve`: `cmd/rk/upgrade.go` `resolveExeFn`, `api/update.go` `resolveSelfPathFn`, `cmd/rk/serve.go` `resolveBrewInstalled`, `internal/daemon/daemon.go` `Start`/`StartWithBinary`, `cmd/rk/agent_setup.go` `resolveRkPath`.
- No spec edit — `docs/specs/code-bridge.md` describes the ladder, which is unchanged.

### Design Decisions

#### Stable path is a pure string derivation
**Decision**: `StableFor` maps the Cellar path to `<prefix>/bin/run-kit` by string slicing and never stats the result.
**Why**: during `brew upgrade` the stable symlink dangles briefly; a stat-then-fallback at respawn time would re-pin the Cellar path — the exact bug being fixed. Matches the unconditional derivation `upgrade.go` already used for the daemon restart.
**Rejected**: stat-and-fallback to the resolved path (re-pins during the upgrade window); teaching the extension to fall through to PATH (symptom treatment, leaves the gui spawn and install chain broken).
*Introduced by*: 260910-4t9b-stable-rk-path-daemon-spawns

#### Two resolvers: real binary vs. version-stable path
**Decision**: `selfpath.Resolve` stays for brew detection and the daemon's own respawn; `selfpath.Stable` is for anything spawned to outlive this binary's version (spawn argv, `RK_BIN`, shell chains).
**Why**: `IsBrewInstalled` needs the Cellar marker, and `daemon.Start`/`StartWithBinary` `EvalSymlinks` on purpose so the daemon session names the binary actually running; long-lived children must instead survive a `brew upgrade` that deletes the old keg.
**Rejected**: switching every caller to the stable path (breaks brew detection); a single resolver with a flag (two named functions read better at the call site).
*Introduced by*: 260910-4t9b-stable-rk-path-daemon-spawns

## Tasks

### Phase 1: Core Implementation

- [x] T001 Add `StableFor(resolved string) string` and `Stable() (string, error)` to `app/backend/internal/selfpath/selfpath.go` with doc comments stating the purity rule and the Resolve-vs-Stable choice; add `app/backend/internal/selfpath/selfpath_test.go` with a table test for `StableFor` (linuxbrew Cellar, /opt/homebrew Cellar, /usr/local/bin/rk, go/bin/rk, empty) and a `Stable()` smoke test <!-- R1, R2 -->

### Phase 2: Integration

- [x] T002 [P] In `app/backend/internal/daemon/codeserver.go` switch `codeServerSelfPath` default to `selfpath.Stable`; update the seam doc comment and the spawn commentary ("sets RK_BIN to the daemon's own resolved binary path") to describe the version-stable value and why; add one `codeserver_test.go` case stubbing the seam with `selfpath.StableFor("/opt/homebrew/Cellar/run-kit/1.2.3/bin/run-kit")` asserting `RK_BIN=/opt/homebrew/bin/run-kit` and no `/Cellar/` in the spawn argv, and one asserting the install-job chain names `'/opt/homebrew/bin/run-kit'` <!-- R3 -->
- [x] T003 [P] In `app/backend/internal/daemon/gui.go` switch `guiSelfPath` default to `selfpath.Stable` and update its doc comment; add one `gui_test.go` case stubbing the seam with `selfpath.StableFor(<Cellar path>)` asserting the `new-session` argv exe element is `/opt/homebrew/bin/run-kit` with no `/Cellar/` <!-- R4 -->
- [x] T004 [P] In `app/backend/cmd/rk/upgrade.go` `runUpdateCLILeg` replace the inline `strings.Index`/`cellarIdx` block with `brewBinPath := selfpath.StableFor(resolved)`; keep the `strings` import (still used at line 97); run the existing `upgrade_test.go` cases unchanged <!-- R5 -->

### Phase 3: Verification

- [x] T005 Run `cd app/backend && go test ./internal/selfpath/ ./internal/daemon/ ./cmd/rk/` then `just test-backend`; fix any failure at its root <!-- R1, R2, R3, R4, R5 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `selfpath.StableFor` exists, maps both Cellar prefixes to `<prefix>/bin/run-kit`, and passes non-Cellar and empty inputs through unchanged
- [x] A-002 R2: `selfpath.Stable` exists with `Resolve`'s signature, composes `Resolve` + `StableFor`, and `Resolve`/`IsBrewInstalled`/`CellarMarker` are unchanged
- [x] A-003 R3: `codeServerSelfPath` defaults to `selfpath.Stable`; the spawn env and the install-job chain both consume it
- [x] A-004 R4: `guiSelfPath` defaults to `selfpath.Stable`
- [x] A-005 R5: `runUpdateCLILeg` uses `selfpath.StableFor(resolved)`; the inline derivation and the dead `cellarIdx == -1` branch are gone

### Behavioral Correctness

- [x] A-006 R3: With a Cellar self path, the `rk-code-server` spawn argv carries `RK_BIN=<prefix>/bin/run-kit` (immediately after `-u VSCODE_IPC_HOOK_CLI`) and no `/Cellar/` substring; with a non-Cellar path the argv is byte-identical to before
- [x] A-007 R5: `restartDaemonFn` still receives `/opt/homebrew/bin/run-kit` for a `/opt/homebrew/Cellar/run-kit/9.9.9/bin/run-kit` self path — existing `upgrade_test.go` assertions pass unmodified

### Scenario Coverage

- [x] A-008 R1: `selfpath_test.go` table test covers linuxbrew Cellar, /opt/homebrew Cellar, /usr/local/bin/rk, a go/bin path, and the empty string
- [x] A-009 R3: `codeserver_test.go` has a Cellar-path case for the spawn env and one for the install-job chain
- [x] A-010 R4: `gui_test.go` has a Cellar-path case asserting the supervisor argv exe element

### Edge Cases & Error Handling

- [x] A-011 R3: Self-path resolution failure still spawns code-server without an `RK_BIN` element and skips the install job with a warning (existing tests pass)
- [x] A-012 R1: `StableFor` performs no filesystem access — no `os.Stat`, `EvalSymlinks`, or `LookPath` in its body

### Code Quality

- [x] A-013 Pattern consistency: new functions follow `selfpath.go`'s existing style; test cases mirror the existing seam-stub patterns in `codeserver_test.go` / `gui_test.go`
- [x] A-014 No unnecessary duplication: `upgrade.go` no longer carries its own Cellar derivation; there is exactly one derivation, in `selfpath`
- [x] A-015 Comments state constraints the code cannot show (why the path must be stable, why no stat) and do not narrate, cite PR numbers, or address the reviewer
- [x] A-016 Tests cover the changed behavior (code-quality.md: fixes MUST include tests)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality (the `StableFor`/`Stable` pair) and consolidates the one existing Cellar derivation (upgrade.go's inline block, removed in place) without making any other existing code redundant or unused.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Drop the unreachable `cellarIdx == -1` guard in `upgrade.go` rather than keep an `== resolved` equivalent | The leg returns at the `IsBrewInstalled` check before reaching it; a dead guard is noise. Intake left this to apply judgment | S:85 R:90 A:90 D:80 |
| 2 | Certain | Synthetic Cellar prefix in the new daemon tests is `/opt/homebrew/Cellar/run-kit/1.2.3/bin/run-kit` | Matches the prefix `upgrade_test.go` already uses, so the expected `/opt/homebrew/bin/run-kit` reads consistently across test files | S:80 R:95 A:90 D:85 |

2 assumptions (2 certain, 0 confident, 0 tentative).
