# Plan: Delegate `rk riff` launcher resolution to `fab agent --print`

**Change**: 260703-w884-riff-launcher-fab-agent-print
**Intake**: `intake.md`

## Requirements

### rk riff: Launcher Resolution

#### R1: Launcher resolved via `fab agent --print`
`resolveLauncher()` in `app/backend/cmd/rk/riff.go` SHALL resolve the agent launcher by executing `fab agent --print` as a subprocess and using its trimmed single-line stdout as the launcher, rather than reading `agent.spawn_command` from `fab/project/config.yaml`.

- **GIVEN** `fab` is on PATH and `fab agent --print` succeeds with a single non-empty line of stdout (e.g. `claude --dangerously-skip-permissions --effort xhigh -n "$(basename "$(pwd)")" --model claude-fable-5 --effort xhigh`)
- **WHEN** `resolveLauncher()` runs
- **THEN** the returned launcher SHALL equal the trimmed stdout, and SHALL NOT be the hardcoded `defaultLauncher`

#### R2: Secure subprocess execution with a named timeout
The `fab agent --print` invocation MUST use `exec.CommandContext` with an explicit argument slice (`"fab", "agent", "--print"`) and a context bounded by a named 10-second timeout constant (`fabTimeout`), following the existing `wtTimeout`/`tmuxTimeout` pattern in riff.go (constitution §I Security First, §Process Execution).

- **GIVEN** the subprocess is constructed
- **WHEN** the command is built
- **THEN** it MUST be built via `exec.CommandContext(ctx, "fab", "agent", "--print")` with `ctx` derived from a `context.WithTimeout(..., fabTimeout)` where `fabTimeout = 10 * time.Second` is a named package-level constant
- **AND** stdout MUST be captured via `cmd.Output()` (not `CombinedOutput()`) so stderr does not pollute the launcher string

#### R3: Silent best-effort fallback (never errors)
`resolveLauncher()` MUST preserve its current never-errors, silent-fallback posture: on ANY failure it SHALL return `defaultLauncher` (`"claude --dangerously-skip-permissions"`) with no stderr noise and no returned error. Failure modes covered: `fab` not on PATH, non-zero exit, timeout, empty/whitespace-only stdout, and multi-line stdout (treated as malformed).

- **GIVEN** `fab` is absent from PATH, or exits non-zero, or times out, or writes empty/whitespace-only stdout
- **WHEN** `resolveLauncher()` runs
- **THEN** it SHALL return `defaultLauncher` and SHALL NOT emit anything to stderr or return an error
- **GIVEN** `fab agent --print` writes multi-line output (a trimmed string containing an embedded newline)
- **WHEN** `resolveLauncher()` post-processes it
- **THEN** the output SHALL be treated as malformed and `resolveLauncher()` SHALL return `defaultLauncher`

#### R4: cwd-based repo discovery (no FindGitRoot in resolveLauncher)
`resolveLauncher()` SHALL rely on `fab`'s own cwd-based repo discovery and SHALL NOT compute a repo root via `config.FindGitRoot` or pass a `--repo` flag. `rk riff` always runs inside the repo, so `fab agent` defaults to the current repo.

- **GIVEN** `rk riff` is invoked from anywhere inside the repo (root or a subdirectory)
- **WHEN** `resolveLauncher()` runs
- **THEN** it SHALL invoke `fab agent --print` in the process cwd without a `--repo` argument and without walking up to a git root itself

#### R5: Pure post-processing test seam
`resolveLauncher()` SHALL be split into a thin exec wrapper plus a pure post-processing helper (e.g. `parseFabAgentOutput(stdout string, err error) (string, bool)` or equivalent returning the launcher and whether it is usable), mirroring riff.go's established pure-helper seam pattern (`parseWorktreePath`, `parsePaneID`, `buildWtDeleteArgs`). The pure helper SHALL make the fallback decision (success → trimmed command; error → fallback; empty/whitespace → fallback; multi-line → fallback) testable without staging a subprocess.

- **GIVEN** the pure helper is called with a successful single-line stdout
- **WHEN** it post-processes the output
- **THEN** it SHALL return the trimmed launcher and signal "usable"
- **GIVEN** the pure helper is called with an exec error, or empty/whitespace-only stdout, or multi-line stdout
- **WHEN** it post-processes
- **THEN** it SHALL signal "not usable" so the wrapper falls back to `defaultLauncher`

### internal/fabconfig: API Reduction

#### R6: Delete `ReadSpawnCommand` and the orphaned `fabConfig` struct
`fabconfig.ReadSpawnCommand` (fabconfig.go:61-85) and the now-orphaned `fabConfig` struct (fabconfig.go:30-34) SHALL be removed. `ReadPresets`, `ReadPresetsOrdered`, and all preset types (`Preset`, `PaneSpec`, `PresetEntry`, the pane-kind constants) SHALL remain unchanged. Comments referencing the deleted symbol SHALL be updated: the package doc comment, and `ReadPresets`'s doc line "matches the silent-fallback posture of ReadSpawnCommand" (fabconfig.go:100-102) — the silent-fallback posture stays, only the cross-reference target changes.

- **GIVEN** the fabconfig package after this change
- **WHEN** the package is compiled and used
- **THEN** `ReadSpawnCommand` and the `fabConfig` struct SHALL NOT exist, and `ReadPresets`/`ReadPresetsOrdered` SHALL behave identically to before
- **AND** no comment in the package SHALL reference `ReadSpawnCommand` as an existing symbol

### rk riff: User-Facing Documentation

#### R7: Help text and comments describe the new resolution
The `Long` help's "Launcher resolution:" paragraph (riff.go:101-104), the runRiff "Step 5: launcher resolution" comment (riff.go:285-286), the `resolveLauncher` doc comment (riff.go:346-348), and the Prerequisites launcher bullet (riff.go:89) SHALL describe the new behavior: the launcher is resolved via `fab agent --print` (fab-kit's default tier), falling back to `claude --dangerously-skip-permissions` when `fab` is unavailable or fails. No documentation SHALL claim `agent.spawn_command` is read.

- **GIVEN** a user runs `rk riff -h`
- **WHEN** they read the "Launcher resolution:" section
- **THEN** it SHALL describe `fab agent --print` delegation and the silent `defaultLauncher` fallback, and SHALL NOT mention `agent.spawn_command`

### Non-Goals

- Duplicate `--effort` in the resolved command (once from the user's `session_command`, once appended by fab's profile injection) — last-wins, harmless, config hygiene for the user. Explicitly out of scope.
- No new schema parsing in `internal/fabconfig` (the rejected alternative — reimplements fab-kit's tier→provider→session_command resolution; constitution §III).
- No change to preset resolution, pane composition, layouts, fan-out, or any other riff behavior.
- No removal of the `rk/internal/config` import from riff.go — `FindGitRoot` is still used by `readPresetsForRepo` (riff.go:372) and `readPresetsOrderedForRepo` (riff.go:386).

### Design Decisions

1. **Delegate launcher resolution to `fab agent --print`, not a fabconfig schema re-teach** — the fab-kit 2.13.3 schema moved the launcher from `agent.spawn_command` to `providers.<name>.session_command` with per-tier profiles; delegating to the `fab` CLI means rk never drifts from fab's schema again. *Why*: constitution §III (Wrap, Don't Reinvent) applied to fab-kit's own binary. *Rejected*: teaching `internal/fabconfig` the new schema (reimplements fab's resolution, breaks on the next schema change); keeping `ReadSpawnCommand` as a second fallback (dead code — the key it reads no longer exists).
2. **Multi-line output → fallback** — a valid session command is one line; a trimmed string with an embedded newline is treated as malformed and falls back conservatively, matching the silent posture.
3. **Pure-helper test seam** — the exec-side is untestable without a subprocess, so the fallback decision lives in a pure helper (`parseFabAgentOutput`) unit-tested directly; end-to-end fab-found/fab-absent behavior is covered by staging a stub `fab` executable on a temp-dir PATH.

## Tasks

### Phase 1: fabconfig API reduction

- [x] T001 In `app/backend/internal/fabconfig/fabconfig.go`, delete `ReadSpawnCommand` (fabconfig.go:61-85) and the orphaned `fabConfig` struct (fabconfig.go:30-34). Update the package doc comment and `ReadPresets`'s doc line that cross-references `ReadSpawnCommand` so no comment references the deleted symbol; the silent-fallback posture description stays. <!-- R6 -->
- [x] T002 In `app/backend/internal/fabconfig/fabconfig_test.go`, delete `TestReadSpawnCommand` (lines 10-82), `TestReadSpawnCommand_EmptyRoot` (lines 84-88), and the now-unused `writeFabConfig` helper only if no remaining test uses it (the `ReadPresets` tests reuse it — verify and keep it). Keep all `ReadPresets`/`ReadPresetsOrdered` tests. <!-- R6 -->

### Phase 2: resolveLauncher rewrite + test seam

- [x] T003 In `app/backend/cmd/rk/riff.go`, add a named `fabTimeout = 10 * time.Second` constant to the timeouts `const` block (alongside `wtTimeout`/`tmuxTimeout`). <!-- R2 -->
- [x] T004 In `app/backend/cmd/rk/riff.go`, add a pure post-processing helper `parseFabAgentOutput(stdout string, err error) (string, bool)` that returns `(trimmed-launcher, true)` on success (err nil, single non-empty trimmed line) and `("", false)` on any failure (err non-nil, empty/whitespace stdout, or multi-line trimmed output). Document it as the test seam mirroring `parsePaneID`. <!-- R5 -->
- [x] T005 In `app/backend/cmd/rk/riff.go`, rewrite `resolveLauncher()` to: build a `context.WithTimeout(context.Background(), fabTimeout)`, run `exec.CommandContext(ctx, "fab", "agent", "--print")`, capture stdout via `cmd.Output()`, pass `(stdout, err)` to `parseFabAgentOutput`, and return the launcher when usable else `defaultLauncher`. Remove the `os.Getwd`/`config.FindGitRoot`/`fabconfig.ReadSpawnCommand` body. Never errors, never writes stderr. Update the doc comment (R7). <!-- R1 R2 R3 R4 R5 -->
- [x] T006 In `app/backend/cmd/rk/riff.go`, verify the `rk/internal/config` import is still required (it is — `readPresetsForRepo`/`readPresetsOrderedForRepo` call `config.FindGitRoot`) and keep it. Confirm `fabconfig` is still imported (it is — `ReadPresets`). No import changes expected. <!-- R4 -->

### Phase 3: help text + comments

- [x] T007 In `app/backend/cmd/rk/riff.go`, update the `Long` help "Launcher resolution:" paragraph (riff.go:101-104), the Prerequisites launcher bullet (riff.go:89), and the runRiff "Step 5: launcher resolution" comment (riff.go:285-286) to describe `fab agent --print` (default tier) delegation with silent fallback to `claude --dangerously-skip-permissions`. Remove any `agent.spawn_command` mention. <!-- R7 -->

### Phase 4: launcher tests

- [x] T008 In `app/backend/cmd/rk/riff_test.go`, delete the config-read launcher tests that assert the dead path: `TestResolveLauncher` (lines 323-396), `TestResolveLauncher_ReadsFromSubdir` (lines 400-416), `TestFabconfigIntegration` (lines 421-427), and the `writeGitDir` helper (lines 431-436) if unused after deletion. Remove the now-unused `fabconfig` import if no other test references it, and the `writeFabConfig`/`chdir` helpers only if no surviving test uses them (`chdir` is used by `TestPrintPresets`; check `writeFabConfig`). <!-- R1 R6 -->
- [x] T009 In `app/backend/cmd/rk/riff_test.go`, add `TestParseFabAgentOutput` covering: success (single trimmed line → launcher, usable), leading/trailing whitespace trimmed, error non-nil → fallback, empty stdout → fallback, whitespace-only stdout → fallback, multi-line stdout → fallback. Pure-function table test, no subprocess. <!-- R5 R3 -->
- [x] T010 In `app/backend/cmd/rk/riff_test.go`, add `TestResolveLauncher_StubFab` end-to-end cases: (a) stage a stub `fab` executable on a temp-dir `PATH` that prints a known launcher → `resolveLauncher()` returns it; (b) a stub that exits non-zero → `defaultLauncher`; (c) empty PATH so `fab` is absent → `defaultLauncher`. Use a `PATH` override via `t.Setenv`, restore after. <!-- R1 R3 R4 -->

## Execution Order

- Phase 1 (fabconfig) is independent of Phases 2-4 (riff.go) but do it first so the package compiles standalone.
- T003 (const) and T004 (pure helper) precede T005 (rewrite consumes both).
- T008 (delete dead tests) precedes/parallels T009-T010 (new tests) — all in the same file; do T008 first to avoid stale-reference compile errors.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `resolveLauncher()` executes `fab agent --print` and returns its trimmed single-line stdout as the launcher on success (verified by `TestResolveLauncher_StubFab` case a).
- [x] A-002 R6: `fabconfig.ReadSpawnCommand` and the `fabConfig` struct no longer exist; `ReadPresets`/`ReadPresetsOrdered` still work (verified by surviving `TestReadPresets*` passing and a clean build).
- [x] A-003 R5: A pure `parseFabAgentOutput` helper exists and makes the fallback decision (verified by `TestParseFabAgentOutput`).

### Behavioral Correctness

- [x] A-004 R1: The launcher no longer comes from `agent.spawn_command` — with a stub `fab` present, the returned string is the stub's output, not `defaultLauncher` (verified by `TestResolveLauncher_StubFab` case a).
- [x] A-005 R2: The subprocess is built via `exec.CommandContext(ctx, "fab", "agent", "--print")` with `ctx` bounded by the named `fabTimeout = 10 * time.Second` constant, and stdout is captured via `cmd.Output()` (verified by code inspection / review).

### Edge Cases & Error Handling

- [x] A-006 R3: On `fab` absent, non-zero exit, empty/whitespace stdout, or multi-line stdout, `resolveLauncher()` returns `defaultLauncher` with no stderr output and no error (verified by `TestParseFabAgentOutput` fallback rows + `TestResolveLauncher_StubFab` cases b/c).
- [x] A-007 R4: `resolveLauncher()` does not call `config.FindGitRoot` or pass `--repo`; it relies on `fab`'s cwd discovery (verified by code inspection — no FindGitRoot/`--repo` in the function body).

### Removal Verification

- [x] A-008 R6: The dead config-read launcher tests (`TestResolveLauncher`, `TestResolveLauncher_ReadsFromSubdir`, `TestFabconfigIntegration`, `TestReadSpawnCommand`, `TestReadSpawnCommand_EmptyRoot`) are gone; no test references `ReadSpawnCommand` (verified by grep + green suite).

### Documentation

- [x] A-009 R7: `rk riff -h` "Launcher resolution:" describes `fab agent --print` delegation with silent `claude --dangerously-skip-permissions` fallback and does not mention `agent.spawn_command`; the Step-5 comment and `resolveLauncher` doc comment match (verified by inspection + `grep -c spawn_command app/backend/cmd/rk/riff.go` returning 0).

### Code Quality

- [x] A-010 Pattern consistency: The new subprocess follows riff.go's `exec.CommandContext` + named-timeout-constant + pure-helper-seam patterns; the pure helper mirrors `parsePaneID`.
- [x] A-011 No unnecessary duplication: No new config-parsing logic is added; fab-kit's resolution is reused via the CLI (constitution §III). No shell-string subprocess construction (code-quality anti-pattern).
- [x] A-012 Test coverage: New/changed behavior is covered by tests (`TestParseFabAgentOutput`, `TestResolveLauncher_StubFab`); `cd app/backend && go test ./...` is green (code-quality §Principles: new behavior MUST include tests).

### Security

- [x] A-013 R2: The subprocess uses an explicit argument slice (no shell string) with a context timeout, per constitution §I Security First and §Process Execution. The launcher string embeds `$(basename "$(pwd)")` which expands at pane-spawn time inside the existing `sh -i -c` wrap — the documented §Single-Quote-Escaping exception; the trust boundary is unchanged (launcher now sourced from the `fab` binary's stdout, resolved from committed `fab/project/config.yaml`).

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)

## Deletion Candidates

- None remaining — everything this change made redundant was already deleted within the change itself (R6/T001/T002/T008): `fabconfig.ReadSpawnCommand`, the `fabConfig` struct, `TestReadSpawnCommand`/`TestReadSpawnCommand_EmptyRoot` (fabconfig_test.go), `TestResolveLauncher`/`TestResolveLauncher_ReadsFromSubdir`/`TestFabconfigIntegration`, and the `writeGitDir`/`writeFabConfig` helpers (riff_test.go). Verified by grep: zero `spawn_command`/`ReadSpawnCommand`/`fabConfig` references left in `app/backend`; `config.FindGitRoot`, the `rk/internal/config` import, and the `chdir` test helper all retain live call sites (preset resolution / `TestPrintPresets`).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Delegate launcher resolution to `fab agent --print` (default tier), not a fabconfig schema re-teach | Intake row 1 (Certain); constitution §III; `fab agent --print` verified to emit the resolved default-tier launcher on exit 0 | S:90 R:75 A:90 D:90 |
| 2 | Certain | On any failure (`fab` absent, non-zero exit, timeout, empty output) fall back silently to `defaultLauncher`, never error, no stderr | Intake row 2 (Certain); preserves resolveLauncher's documented never-errors posture | S:90 R:85 A:90 D:90 |
| 3 | Certain | Delete `ReadSpawnCommand` + its tests + the orphaned `fabConfig` struct; keep `ReadPresets`/`ReadPresetsOrdered` | Intake row 3 (Certain); the key it reads is dead in the 2.13.3 schema; second-fallback was explicitly rejected as dead code | S:90 R:80 A:90 D:85 |
| 4 | Certain | Subprocess uses `exec.CommandContext` + explicit arg slice + named `fabTimeout = 10s` following the tmuxTimeout pattern | Intake row 4 (Certain); constitution §I and §Process Execution mandate the pattern | S:85 R:95 A:90 D:75 |
| 5 | Confident | Rely on fab's cwd-based repo discovery; drop `config.FindGitRoot`/`--repo` from `resolveLauncher` (import stays for preset helpers) | Intake row 5 (Confident); `fab agent` defaults to current repo; `rk riff` always runs in-repo; reinstatable via `--repo` if needed | S:70 R:85 A:80 D:70 |
| 6 | Confident | Multi-line trimmed stdout is malformed → fallback | Intake row 6 (Confident); a valid session command is one line; conservative fallback matches the silent posture | S:65 R:90 A:80 D:65 |
| 7 | Confident | Test seam: pure `parseFabAgentOutput` helper + stub `fab` on temp-dir PATH for end-to-end cases | Intake row 7 (Confident); mirrors riff.go's pure-helper pattern; PATH-stub is the standard Go exec-path technique | S:60 R:85 A:75 D:55 |
| 8 | Certain | Update riff.go `Long` help, Prerequisites bullet, Step-5 comment, and resolveLauncher doc to describe the new resolution | Intake row 8 (Certain); code-quality requires docs match behavior; help currently documents the dead `agent.spawn_command` path | S:75 R:95 A:95 D:90 |
| 9 | Certain | Duplicate `--effort` in the resolved command is out of scope (user config hygiene) | Intake row 9 (Certain); last-wins, harmless, explicitly excluded | S:90 R:95 A:90 D:95 |
| 10 | Confident | `parseFabAgentOutput` returns `(string, bool)` (launcher, usable) rather than a bare string | Signature detail left to apply by intake row 7; `(string, bool)` keeps the fallback decision in the pure helper and avoids conflating "" fallback with a legitimately-empty (never valid) launcher | S:60 R:90 A:80 D:70 |

10 assumptions (6 certain, 4 confident, 0 tentative).
