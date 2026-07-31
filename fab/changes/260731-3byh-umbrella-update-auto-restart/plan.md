# Plan: Umbrella `rk update` with Desktop Auto-Restart

**Change**: 260731-3byh-umbrella-update-auto-restart
**Intake**: `intake.md`

## Requirements

### Desktop Installer: Stage/Swap Split with Auto-Restart

#### R1: Stage phase runs while the app is running
The installer's stage phase (download → SHA256 vs release digest when supplied → mount → `codesign --verify --deep --strict` → `ditto` to the deterministic dot-prefixed staging path inside `InstallDir`) MUST run regardless of whether the app is running. The pre-download `AppRunning` refusal and `errDesktopAppRunning` MUST be removed from `cmd/rk/desktop.go` (`runDesktopInstall`, `runDesktopUpdate`). All existing verification gates remain unchanged and un-skippable.

- **GIVEN** Run Kit.app is running and a newer release exists
- **WHEN** `rk desktop update` (or `install`) runs
- **THEN** the download, checksum, codesign, and staging steps all complete without any running-app refusal before them

#### R2: Auto-restart swap when the app is running
At the swap boundary, `Install` MUST re-check `AppRunning` (the TOCTOU probe stays at the swap boundary). If the app is NOT running, the swap is exactly today's behavior (remove old bundle, rename staged into place). If the app IS running, `Install` MUST: (1) gracefully quit via `osascript -e 'tell application "Run Kit" to quit'` (argument-slice exec through the `ins.Run` seam, with timeout), (2) poll `AppRunning` at ~1s cadence until exit, bounded at 30s, (3) perform the existing atomic rename swap, (4) relaunch via `open -a <installed app path>` (argument slice, timeout). There is no suppress flag in v1.

- **GIVEN** the app is running at the swap boundary
- **WHEN** the staged bundle is ready to swap
- **THEN** the installer quits the app, waits for process exit, swaps atomically, and relaunches the new bundle — in that order
- **GIVEN** the app is not running at the swap boundary
- **WHEN** the swap runs
- **THEN** behavior is byte-identical to today (no osascript, no open)

#### R3: Quit-timeout aborts without swapping
If the app has not exited within the 30s bound, `Install` MUST abort without swapping: the existing install is untouched, nothing that exists is removed (the staged bundle is left in place — its deterministic dot-prefixed name self-heals on the next run), and the returned error MUST tell the user to quit the app manually and re-run.

- **GIVEN** the app is running and does not exit after the graceful quit
- **WHEN** the 30s wait bound elapses
- **THEN** `Install` returns an error instructing a manual quit, the installed bundle is untouched, and no rename happened

#### R4: Relaunch failure is non-fatal
A relaunch (`open -a`) failure MUST NOT fail the update — the swap already succeeded and reporting failure would misreport a completed update. The failure surfaces as a warning on the `Progress` (chatter) channel, and the result MUST NOT claim a completed restart (`Restarted` stays false).

- **GIVEN** quit + swap succeeded and `open -a` fails
- **WHEN** `Install` returns
- **THEN** the error is nil, the new bundle is installed, a warning is on the progress channel, and no restart announcement is printed

#### R5: Restart announcement is data; quit/relaunch progress is chatter
`InstallResult` SHALL carry a `Restarted bool` (true only when the app was running and the quit → swap → relaunch sequence fully completed). The CLI layer prints the restart announcement `Run Kit was running — restarted on the new version.` as a stdout data line (survives `--quiet`) when `Restarted` is true. Quitting/relaunching progress lines are stderr chatter dropped by `--quiet` (Toolkit Principle 9).

- **GIVEN** an update that auto-restarted the app, run with `--quiet`
- **WHEN** the command exits
- **THEN** stdout contains the updated-outcome line and the restart announcement; stderr is empty

#### R6: `rk desktop install` and `update` share the relocated gate
Both `rk desktop install` and `rk desktop update` route through `ins.Install` and therefore both get the relocated gate + auto-restart behavior. `errDesktopAppRunning` is deleted. The `--force` flag keeps its scope: version state only (it does not change how a running app is handled). The `Long` help of `desktop`, `desktop install`, and `desktop update` MUST be updated to describe auto-restart instead of the removed refusal.

- **GIVEN** the app is running
- **WHEN** `rk desktop install --force` runs against an already-current version
- **THEN** it reinstalls (force = version state) and auto-restarts — no refusal error exists anywhere

### Umbrella `rk update`

#### R7: CLI leg — non-brew installs no longer end the command
`rk update`'s CLI leg (first, "update the tool, then its artifacts") keeps the existing brew flow unchanged: `selfpath.IsBrewInstalled` → `brew update` (skippable via `--skip-brew-update`) → `brew info` → `brew upgrade` → daemon restart, with all existing brew-mutation bounds (SIGTERM + grace, generous timeouts) preserved. A non-brew install prints the existing manual-update guidance (data lines) but MUST NOT early-return the whole command — execution continues to the desktop leg. The non-brew case is a skip (contributes exit 0).

- **GIVEN** a non-brew rk binary on darwin with the desktop app installed and stale
- **WHEN** `rk update` runs
- **THEN** the guidance prints AND the desktop leg still runs

#### R8: Desktop leg — darwin only, default path, silent skip when absent
The desktop leg runs only on darwin (`desktopGOOS`) and only against the default `/Applications` install dir (custom `--path` installs are invisible to the umbrella — documented in help; Constitution II bars an install-path state store). `InstalledVersion()` empty → silently skip (exit-0, no output). Installed → resolve latest, compare via `updatecheck.AnyIncrease`; stale → run the R1–R5 install flow (auto-restart included); current → `Already up to date (vX).` data line mirroring the CLI leg's shape. Non-darwin: the leg no-ops silently and `rk update` behaves exactly as today. Standalone `rk desktop update` keeps its not-installed error.

- **GIVEN** darwin, no app at /Applications
- **WHEN** `rk update` runs
- **THEN** the desktop leg produces no output and no error
- **GIVEN** a non-darwin platform
- **WHEN** `rk update` runs
- **THEN** no desktop installer is constructed at all

#### R9: Legs are fail-independent; exit code aggregates genuine failures
A CLI-leg failure MUST NOT prevent the desktop leg from running (and vice versa). All skips (not brew-installed, non-darwin, no desktop app) are exit-0. The command exits non-zero if either leg genuinely fails; on any leg failure the command reports both legs' outcomes (the successful leg's data lines plus each failing leg's error, leg-labelled) and exits non-zero.

- **GIVEN** brew upgrade fails and the desktop app is stale
- **WHEN** `rk update` runs
- **THEN** the desktop leg still updates the app and the command exits non-zero with a CLI-leg-labelled error

### Toolkit Standards Conformance

#### R10: Update-standard and help-dump stability hold for the umbrella
The umbrella `rk update` MUST stay conformant to `shll standards update`: `--skip-brew-update` remains a literal substring of `rk update --help`; exit 0 on success including already-up-to-date and all skips; brew-mutation safety bounds unchanged; the non-brew message remains a clear degradation. The command *tree* is unchanged (no new subcommands, no new flags), so `rk help-dump` stays shape-stable. `rk update`'s help text SHALL describe the two-leg umbrella and document the `--path` limitation; the Principle 9 stdout/stderr + `--quiet` contract holds for both legs.

- **GIVEN** the finished change
- **WHEN** `rk update --help` renders
- **THEN** it contains the literal `--skip-brew-update`, describes updating both the CLI and the desktop app, and notes custom-path installs need `rk desktop update --path`

### Non-Goals

- A `--no-restart` suppress flag — deferred (minimal surface for v1)
- The "Restart to Update" shell menu item (sibling change 260731-vvco)
- Scanning candidate install paths (`~/Applications`) in the umbrella — Constitution II
- Any Windows/Linux desktop update mechanism (`rk desktop` remains macOS-only)
- In-app electron-updater/Squirrel — recorded non-goal, unchanged

### Design Decisions

#### Restart status rides InstallResult, announcement prints in the CLI layer
**Decision**: `Install` returns `InstallResult.Restarted`; the CLI layer (`cmd/rk`) prints the restart announcement on the data channel.
**Why**: The installer library owns orchestration (quit/wait/swap/relaunch) but has only a chatter writer (`Progress`); data-vs-chatter routing is the command layer's job (the existing outcome-line split), so the fact crosses the seam as a result field.
**Rejected**: Printing the announcement from inside `Install` via `Progress` (would make the announcement chatter, dropped by `--quiet` — violating the intake's data-line contract).
*Introduced by*: 260731-3byh-umbrella-update-auto-restart

#### osascript/open route through the existing `ins.Run` seam
**Decision**: The quit and relaunch subprocesses use the existing `Runner` struct-field seam, not new dedicated seam vars.
**Why**: `ins.Run` already carries every installer subprocess (hdiutil, ditto, codesign, plutil, pgrep) and the recorded-runner test idiom observes name+args per call, which covers osascript/open with zero new seams.
**Rejected**: New package-level seam vars per tool (the package deliberately uses struct fields, not package vars, so parallel tests do not race).
*Introduced by*: 260731-3byh-umbrella-update-auto-restart

#### Shared `desktopUpdateToLatest` helper for standalone and umbrella
**Decision**: The resolve-latest → compare → install → announce flow is one helper in `cmd/rk/desktop.go`, called by `runDesktopUpdate` (after its not-installed error) and by the umbrella desktop leg (after its silent skip).
**Why**: The intake requires the umbrella's stale-path to be exactly the piece-1 flow and its data lines to mirror the standalone shapes; one function makes divergence impossible.
**Rejected**: Duplicating the flow in `upgrade.go` (two drift-prone copies of compare/announce logic).
*Introduced by*: 260731-3byh-umbrella-update-auto-restart

### Deprecated Requirements

#### Pre-download running-app refusal (`errDesktopAppRunning`)
**Reason**: The running state is now handled (stage-while-running + auto-restart at the swap), not refused before the download.
**Migration**: R2's swap-boundary handling replaces it; the quit-timeout error (R3) is the only remaining "quit the app" message.

## Tasks

### Phase 1: Core Implementation — installer

- [x] T001 Add restart plumbing to `app/backend/internal/desktop/`: `quitTimeout`/`quitWaitTimeout`/`quitPollInterval`/`relaunchTimeout` consts and overridable wait/poll fields on `Installer` (defaulted in `New()`), plus `Restarted bool` on `InstallResult`; implement `quitApp`, `waitAppExit`, `relaunchApp` helpers (new `restart.go`) through the `ins.Run` seam with argument slices + timeouts <!-- R2 R3 R4 -->
- [x] T002 Restructure the swap phase of `Install` in `app/backend/internal/desktop/install.go`: replace the running-app refusal with the quit → wait → swap → relaunch orchestration (not-running path unchanged); quit-timeout abort leaves the staged bundle and existing install untouched with a manual-quit error; relaunch failure warns on `Progress` and leaves `Restarted` false <!-- R1 R2 R3 R4 R5 -->
- [x] T003 Cover the installer in `app/backend/internal/desktop/install_test.go`: stateful runner (pgrep flips after osascript quit); assert running → quit-poll-swap-relaunch command order + `Restarted=true`; not-running → no osascript/open (existing sequence test extended); quit-timeout → no swap, old install intact, manual-quit error; relaunch failure → nil error, warning on progress, `Restarted=false` <!-- R2 R3 R4 -->

### Phase 2: Core Implementation — CLI commands

- [x] T004 Relocate the gate in `app/backend/cmd/rk/desktop.go`: delete `errDesktopAppRunning` and both pre-download `AppRunning` refusals; extract the shared `desktopUpdateToLatest` helper (resolve → `AnyIncrease` compare → install → outcome + restart announcement data lines); print the restart announcement in `runDesktopInstall` too; update `desktop`/`install`/`update` Long help to describe auto-restart (keep `--force` scoped to "version state ONLY" and update's "no --version" note) <!-- R1 R5 R6 -->
- [x] T005 Update `app/backend/cmd/rk/desktop_test.go`: replace `TestDesktopRunningAppBlocksEvenWithForce` with a running-app auto-restart test (stateful fake runner handling osascript/open; assert updated outcome + restart announcement on stdout, quit-before-relaunch order); adjust the Long-help assertions to the new text <!-- R2 R5 R6 -->
- [x] T006 Restructure `app/backend/cmd/rk/upgrade.go` into the two-leg umbrella: extract the existing body as the CLI leg (non-brew guidance no longer returns early, becomes an exit-0 skip); add the desktop leg (darwin-only via `desktopGOOS`, `newDesktopInstallerFn` default path, silent skip on empty `InstalledVersion`, `desktopUpdateToLatest` when installed); run legs sequentially with `errors.Join` aggregation and leg-labelled errors; add a Long help block describing the umbrella + the `--path` limitation <!-- R7 R8 R9 R10 -->
- [x] T007 Cover the umbrella in `app/backend/cmd/rk/upgrade_test.go`: pin existing CLI-leg tests to a non-darwin desktop leg; add the leg-skip matrix (non-brew + app installed → guidance prints and desktop leg runs; brew + no app → silent desktop skip, exit 0; non-darwin → installer factory never invoked); fail-independence (CLI leg fails → desktop leg still updates, exit non-zero; desktop leg fails after CLI success → exit non-zero); `--quiet` keeps both legs' data lines <!-- R7 R8 R9 -->

### Phase 3: Integration & Verification

- [x] T008 Run `just test-backend`; verify `rk update --help` contains the literal `--skip-brew-update` and the umbrella description, help-dump tests stay green (tree unchanged), and the update-standard checklist (exit-0 skips, brew bounds untouched) holds <!-- R10 -->

## Execution Order

- T001 → T002 → T003 (installer library first)
- T004 blocks T005; T004 also blocks T006 (umbrella leg calls `desktopUpdateToLatest`)
- T006 → T007
- T008 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: The stage phase (download/checksum/codesign/ditto) completes while the app is running; no pre-download `AppRunning` refusal exists in `runDesktopInstall`/`runDesktopUpdate` — both refusals removed (`desktop.go:201`, `:251` sites now go straight to `ins.Install`); `TestDesktopUpdateRunningAppAutoRestarts` asserts `assetHits == 1` with a running app, proving the download happened
- [x] A-002 R2: A running app at the swap boundary is gracefully quit (osascript), waited on (~1s poll, 30s bound), swapped atomically, and relaunched (`open -a`) — proven by a command-order test: `install_test.go:409` pins the exact 8-command sequence `[hdiutil attach, codesign --verify, ditto, pgrep -f, osascript -e, pgrep -f, open -a, hdiutil detach]` plus the osascript/open argument slices
- [x] A-003 R6: `errDesktopAppRunning` is deleted; both `rk desktop install` and `rk desktop update` get the auto-restart behavior via `ins.Install`; Long help describes auto-restart — repo-wide grep for `errDesktopAppRunning` in `app/`,`docs/`,`scripts/` returns only the stale `docs/memory/run-kit/architecture.md:733` prose (hydrate's job); `TestDesktopRegisteredWithChildrenAndFlags` asserts `"quit gracefully"` in both Longs
- [x] A-004 R7: A non-brew install prints the guidance and continues to the desktop leg (no early return) — `TestUpdate_Umbrella_NonBrewContinuesToDesktopLeg` asserts both the guidance line and `Updated Run Kit v3.12.2 -> v3.13.0` on stdout
- [x] A-005 R8: Desktop leg: darwin-only, default path only, silent exit-0 skip when no app installed, `AnyIncrease` compare, up-to-date data line, stale → full install flow — `upgrade.go:312` GOOS gate, `:316` factory default path (no `InstallDir` override), `:322` empty-version skip; covered by the `NoAppSilentSkip` / `NonDarwinNeverConstructsInstaller` tests

### Behavioral Correctness

- [x] A-006 R2: The not-running swap path is byte-identical to today (no osascript/open in the command sequence) — `TestInstallSuccessFlow` (`install_test.go:184`) keeps its exact-length 5-command assertion and adds `Restarted == false`; the `wasRunning` guard makes both quit and relaunch unreachable when the boundary pgrep misses
- [x] A-007 R5: `Restarted` is true only after a completed quit→swap→relaunch; the announcement `Run Kit was running — restarted on the new version.` prints on stdout and survives `--quiet` — `restarted` is set only in the `else` of the relaunch error branch (`install.go:158`); `TestUpdate_Umbrella_QuietKeepsBothLegsData` asserts the announcement on stdout with `stderr == ""` under `--quiet`
- [x] A-008 R9: CLI-leg failure does not prevent the desktop leg (and vice versa); both failures are leg-labelled in the returned error; skips are exit-0 — `CLIFailureStillRunsDesktopLeg` and `DesktopFailureAfterCLISuccess` each assert the failing leg's label is present AND the successful leg's label is absent

### Removal Verification

- [x] A-009 R1: No pre-download running-app gate remains anywhere in install/update flows; `--force` semantics stay version-state-only — the only `AppRunning` call left in a flow is the swap-boundary probe (`install.go:131`); `TestDesktopInstallForceRunningAppAutoRestarts` proves `--force` against an already-current version with a live app reinstalls and restarts rather than refusing

### Scenario Coverage

- [x] A-010 R3: Quit-timeout test proves: no swap, existing install untouched, error instructs manual quit — `TestInstallQuitTimeoutAbortsWithoutSwap` (shrinks `QuitWait`/`QuitPoll` to 30ms/5ms) asserts the `"quit the app manually"` error, the old marker still present, the staged bundle still present, and no `open` command recorded
- [x] A-011 R4: Relaunch-failure test proves: nil error, new bundle installed, warning on progress channel, `Restarted=false` — `TestInstallRelaunchFailureNonFatal` asserts all four
- [x] A-012 R8: Leg-skip matrix tests exist (non-brew+app, brew+no-app, non-darwin) — `NonBrewContinuesToDesktopLeg`, `NoAppSilentSkip` (also asserts `assetHits == 0` and no `"Run Kit"` on stdout), `NonDarwinNeverConstructsInstaller` (t.Fatal inside the factory)

### Edge Cases & Error Handling

- [x] A-013 R3: The staged bundle left by a quit-timeout abort is reclaimed by the next run (deterministic staging name — existing `RemoveAll(staged)` at stage entry) — confirmed at `install.go:113-115`: the staging path is the fixed `"."+AppBundleName+".staging"` and stage entry `RemoveAll`s it before ditto, so the leftover is reclaimed (not accumulated); the quit-timeout test asserts the leftover is present after the abort
- [x] A-014 R9: Both-legs-fail returns a joined error naming both legs — behavior verified during review with a throwaway probe test (since removed): the joined error read `CLI update: could not check for updates (brew update failed): brew-boom\ndesktop update: reading installed app version from …: plutil-boom`, naming both legs on separate lines. Behavior correct; **no committed regression test covers this path** — see should-fix finding

### Code Quality

- [x] A-015 Pattern consistency: new code follows the seam-var/struct-field idioms (`ins.Run`, `desktopGOOS`, `newDesktopInstallerFn`) and sink data/chatter routing of surrounding code — osascript/open both route through `ins.Run` (no new package-level vars, per plan Design Decision 2); `QuitWait`/`QuitPoll` are `Installer` struct fields defaulted in `New()`; the desktop leg reuses `desktopGOOS` + `newDesktopInstallerFn`; `gofmt -l` and `go vet` both clean on the two packages
- [x] A-016 No unnecessary duplication: standalone `rk desktop update` and the umbrella leg share `desktopUpdateToLatest`; no reimplemented compare/announce logic — one definition (`desktop.go:241`) with exactly two call sites (`runDesktopUpdate`, `runUpdateDesktopLeg`); no `AnyIncrease` or announcement literal duplicated into `upgrade.go`
- [x] A-017 Tests included: new/changed behavior is covered by Go tests alongside the code (`just test-backend` green) — `just test-backend` green; forced `go test -count=1 -race ./cmd/rk/ ./internal/desktop/` also green (1.354s / 1.060s); all 12 new/changed tests verified individually PASS

### Security

- [x] A-018 R2: osascript/open invocations use `exec.CommandContext`-backed argument slices with explicit timeouts through the `Runner` seam — no shell strings; verification gates (SHA256, codesign) remain un-skippable — `quitApp`/`relaunchApp` each open their own `context.WithTimeout` (`quitTimeout` 15s / `relaunchTimeout` 30s) and pass discrete args to `ins.Run`, whose production impl is `exec.CommandContext(ctx, name, args...)` (`desktop.go:136`); the AppleScript string is built from the compile-time `AppBundleName` constant, so no caller-controlled input reaches it. The SHA256 and `codesign --verify --deep --strict` gates are untouched and still precede staging

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `docs/memory/run-kit/architecture.md:733` (prose) — the `desktop` row still states "A **running Run Kit blocks install and update** (`errDesktopAppRunning`, checked pre-download) and **`--force` does NOT override it**", which this change deletes; the last live reference to the removed symbol anywhere in the repo. Hydrate-stage rewrite (already listed in Affected Memory).
- `docs/memory/run-kit/desktop-shell.md:289` (prose) — "**Update path**: `rk desktop update` is the shell's only automated update mechanism" is now incomplete: the umbrella `rk update` also updates the app. The neighbouring "the app itself carries no auto-updater" claim survives unchanged and should be kept.
- `quitTimeout` / `relaunchTimeout` (`internal/desktop/restart.go:21,24`) — genuinely used, but they are the only two bounds in the restart path still hard-coded as consts while `quitWaitTimeout`/`quitPollInterval` were promoted to injectable `Installer` fields. Not redundant today (no test needs to shrink them); noted only so a future "make the restart bounds uniform" pass has the asymmetry recorded. **Do not delete.**
- None otherwise — the change is additive at the library layer, and its one real removal (the pre-download refusal + `errDesktopAppRunning`) was already carried out in code as a planned Deprecated Requirement, leaving no orphaned helper, branch, or test fixture behind. The `--force` flag, `AppRunning`, and the staging/rename machinery all retain live callers.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | osascript/open route through the existing `ins.Run` struct-field seam rather than new package-level seam vars — "new seam vars … mirroring the existing `Run` seam" in the intake is satisfied by the seam idiom itself, since the recorded runner already observes every subprocess by name+args | The package deliberately uses struct-field seams (not package vars) to avoid parallel-test races; adding package vars would contradict its own documented idiom | S:60 R:85 A:90 D:75 |
| 2 | Confident | Quit-timeout abort leaves the staged bundle in place (unlike other failure paths, which remove it) — reading the intake's "remove nothing that exists today (the deterministic staging name self-heals on the next run)" literally | The parenthetical about staging-name self-heal only makes sense if the staged copy is what is not removed; next run's `RemoveAll(staged)` reclaims it | S:55 R:90 A:75 D:60 |
| 3 | Confident | `Restarted` is true only when relaunch succeeded; on relaunch failure the announcement is suppressed and the warning goes to the chatter channel (the detach-warning precedent) | Printing "restarted on the new version" after a failed relaunch would be false; warnings-on-Progress is the package's existing pattern | S:60 R:85 A:85 D:70 |
| 4 | Confident | Wait bounds (30s cap, 1s poll) are `Installer` fields defaulted in `New()` so tests can shrink them — the package's seam-parameterization idiom extended to durations | Without injectable bounds the quit-timeout test would sleep 30s of wall clock; struct-field parameterization is the established pattern | S:65 R:90 A:90 D:80 |
| 5 | Confident | Leg aggregation uses `errors.Join` with leg-labelled wrapping (`CLI update: …` / `desktop update: …`); the successful leg's outcome is its already-printed data lines, the failing leg's outcome is its labelled error | Satisfies "reports both legs' outcomes and exits non-zero" with the CLI's single-RunE-error convention; stdlib Join keeps both messages | S:60 R:85 A:85 D:70 |
| 6 | Confident | The umbrella desktop leg's data lines are byte-identical to standalone `rk desktop update` (shared helper), including `Already up to date (vX).` — no leg-name prefix | The intake says the up-to-date line "mirrors the CLI leg's shape" and the stale path "runs the piece-1 install flow"; sharing the helper is the anti-drift choice | S:55 R:80 A:80 D:65 |
| 7 | Certain | `rk update`'s aliases/flags/tree are untouched: no new flags, no new subcommands; help text (Short/Long) may change freely since help-dump pins shape, not prose | Intake assumption 11 + `help_dump_test.go` asserts structure; the command tree is provably unchanged | S:85 R:90 A:95 D:90 |
| 8 | Confident | The quit target app name is derived from `AppBundleName` (`strings.TrimSuffix(…, ".app")`), not a second hardcoded literal | One constant already names the bundle; deriving avoids a drift pair | S:60 R:90 A:90 D:80 |

8 assumptions (1 certain, 7 confident, 0 tentative).
