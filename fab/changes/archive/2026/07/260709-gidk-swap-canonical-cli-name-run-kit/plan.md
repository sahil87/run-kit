# Plan: Swap Canonical CLI Name to run-kit

**Change**: 260709-gidk-swap-canonical-cli-name-run-kit
**Intake**: `intake.md`

## Requirements

<!-- Derived from intake.md's nine "What Changes" areas plus the Invariants and Impact sections.
     The canonical command identity flips rk → run-kit; rk stays a permanent, fully-interchangeable
     alias. Internals (module path, cmd/rk/, RK_* env, rk-daemon socket/session, ~/.rk/, dist/rk,
     bin/rk, artifact names) stay rk. -->

### CLI Identity: Canonical Command Name

#### R1: Cobra root identity is `run-kit`
The Cobra root command SHALL declare a static `Use: "run-kit"` and matching `Short`. Version output SHALL read `run-kit version X` for both `rk` and `run-kit` invocations (Cobra's version template prints the root display name). `Use` MUST remain a static string (argv[0]-dynamic `Use` is rejected — help-dump determinism).

- **GIVEN** the built binary invoked as either `rk --version` or `run-kit --version`
- **WHEN** the version flag is evaluated
- **THEN** the output reads `run-kit version <v>` (dev builds: `run-kit version dev`)
- **AND** `run-kit --help` shows `run-kit` as the command name and the updated `Short`

#### R2: help-dump JSON reports `tool: "run-kit"`
`buildDump` SHALL set `Tool: "run-kit"`; `schemaVersion` SHALL remain `1` (a value change within the frozen shape, not a shape change). `root.name`/`root.path`/`usage`/`text` follow automatically from the Cobra `Use` change.

- **GIVEN** `rk help-dump` (or `run-kit help-dump`) is run
- **WHEN** the JSON document is emitted
- **THEN** `tool` is `"run-kit"`, `schema_version` is `1`, and `root.name`/`root.path` are `run-kit`

### CLI Identity: Shell Completion

#### R3: Shell completion binds BOTH names for zsh and bash
After the `Use` swap, cobra generates completion for `run-kit` only. The zsh output SHALL append an extra `compdef _run-kit rk` registration; the bash output SHALL append an extra `complete` line for `rk` using the same entry function and flags cobra emits for the primary name. Banner/help/error text SHALL adopt `run-kit` phrasing. fish/powershell keep cobra's single-name binding.

- **GIVEN** `rk shell-init zsh` output is evaluated
- **WHEN** the user types `rk <TAB>` or `run-kit <TAB>`
- **THEN** completion fires for both names (`compdef _run-kit run-kit` from cobra AND appended `compdef _run-kit rk`)
- **AND** for bash, both `run-kit` and `rk` are registered against `__start_run-kit`
- **AND** the banner reads `# run-kit(1) <shell> completion`, the install hint uses `run-kit shell-init`, and error prefixes use `run-kit shell-init:`

### Release: Homebrew Formula & Workflow

#### R4: Formula template flips real-vs-alias
`.github/formula-template.rb` SHALL declare `class RunKit < Formula`, install the tarball's `rk` binary renamed to `run-kit` (`bin.install "rk" => "run-kit"`), symlink `rk` back (`bin.install_symlink bin/"run-kit" => "rk"`), and assert both names output `run-kit version`. url/sha/desc/homepage lines are unchanged (tarballs keep `rk-{os}-{arch}.tar.gz` with a single `rk` member).

- **GIVEN** the formula installs from the release tarball
- **WHEN** `brew install` and `brew test` run
- **THEN** `run-kit` is the real binary, `rk` is a symlink to it, and both `--version` calls print `run-kit version`

#### R5: Release workflow pushes `run-kit.rb`
`.github/workflows/release.yml`'s "Update Homebrew tap" step SHALL write to `Formula/run-kit.rb`, `git add Formula/run-kit.rb`, and commit `"run-kit ${version}"`. The cross-compile step is untouched (outputs stay `dist/rk-{os}-{arch}/rk` and `rk-{os}-{arch}.tar.gz`).

- **GIVEN** a `v*` tag triggers the release workflow
- **WHEN** the tap-update step runs
- **THEN** the rendered formula lands at `Formula/run-kit.rb` with commit message `run-kit ${version}`
- **AND** the cross-compile artifact names remain `rk-{os}-{arch}.tar.gz`

### Runtime: Update & Hook Path Resolution

#### R6: `rk update` uses the `run-kit` formula identity
`upgrade.go` SHALL use `/Cellar/run-kit/` markers (lines 88, 141), `sahil87/tap/run-kit` formula refs (lines 112, 132), and the `/bin/run-kit` stable bin path (line 145). Printed messages and `Short` SHALL adopt `run-kit` phrasing; the non-brew reinstall hint SHALL print the single fully-qualified line `brew install sahil87/tap/run-kit` (matching README/install.md; the separate `brew tap sahil87/tap` line is dropped — a fully-qualified install auto-taps). The hint MUST NOT print unqualified `brew install run-kit`: homebrew-core ships an unrelated `run-kit` formula that wins unqualified resolution even with the tap tapped (review-verified), so the unqualified form installs the wrong software. Comments at lines 57/139 update. Internal `rk-daemon` socket/session identifiers stay.

- **GIVEN** a Homebrew-installed binary running `rk update` (or `run-kit update`)
- **WHEN** the Cellar marker, brew info/upgrade, and daemon-restart bin path are computed
- **THEN** they use `run-kit`/`sahil87/tap/run-kit`/`/bin/run-kit`
- **AND** a non-Homebrew binary prints a reinstall hint of exactly `brew install sahil87/tap/run-kit` (fully qualified, never the unqualified core-colliding form)

#### R7: agent-setup prefers `run-kit` in hook path resolution
`resolveRkPath` SHALL prefer `exec.LookPath("run-kit")` with `exec.LookPath("rk")` fallback, then the existing `os.Executable()` fallback. Existing installed hooks embedding `/opt/homebrew/bin/rk` keep working (the `rk` symlink persists). Hook-command shape, marker identification, and `validateHookPath` are unchanged.

- **GIVEN** a machine with both `run-kit` and `rk` on PATH (both stable symlinks to the same binary)
- **WHEN** `rk agent-setup` resolves the path to embed in the hook
- **THEN** it prefers the `run-kit` path, falling back to `rk`, then `os.Executable()`
- **AND** the resolved path is non-empty and absolute (the existing order-agnostic test still passes)

### CLI Identity: User-Facing Message Strings & Docs

#### R8: User-facing command-name strings in `cmd/rk/` read `run-kit`
All user-facing strings that name the command (Cobra `Short`/`Long` help text, printed `fmt.Print*` messages, error prefixes like `rk riff:` / `rk shell-init:`) SHALL switch to `run-kit` phrasing across `cmd/rk/`. Internal identifiers embedded in messages MUST NOT change: `rk-daemon`, `rk-test`, `RK_*` env vars, `~/.rk/`, `@rk_*` option names, `bin/rk`/`dist/rk` paths, the Go import path `rk/api`.

- **GIVEN** any `cmd/rk` help output or printed message that names the command
- **WHEN** it is emitted
- **THEN** it reads `run-kit <subcommand>` / `run-kit ...` rather than `rk`
- **AND** internal identifiers (`rk-daemon`, `RK_HOST`, `~/.rk/`, `@rk_...`) remain unchanged

#### R9: Docs teach `run-kit` as canonical with `rk` as the alias
`README.md` and `docs/site/install.md` SHALL be editorially re-voiced so `run-kit` is the canonical command and `rk` the short interchangeable alias. Install commands become `brew install sahil87/tap/run-kit`; primary examples switch to `run-kit ...`. Internal identifiers (`rk-daemon` server name, `RK_HOST`/`RK_PORT`, `~/.rk/`, `@rk_agent_state`/`@rk_board`, `bin/rk`, other tools' formulas `sahil87/tap/wt`/`sahil87/tap/all`) stay. This is an editorial pass, not a token find-replace. Other `docs/site/` pages are out of scope.

- **GIVEN** a new user reading README.md or docs/site/install.md
- **WHEN** they follow the install and usage instructions
- **THEN** the canonical command shown is `run-kit`, `rk` is presented as the interchangeable short alias, and the install command is `brew install sahil87/tap/run-kit`
- **AND** internal identifiers and other tools' formulas remain unchanged

### Non-Goals

- `sahil87/homebrew-tap` repo changes (`formula_renames.json` `{"rk": "run-kit"}`, dropping old `Formula/rk.rb`) — separate follow-up; sequencing dependency noted, not implemented here (intake §5 / Assumption 10).
- `shll` repo roster changes and shll.ai site copy — user handles independently.
- Renaming Go module path, `cmd/rk/` directory, `RK_*` env vars, `rk-daemon` socket/session names, `~/.rk/`, `dist/rk`, `bin/rk`, or release artifact names (all internal invariants — Assumption 2).
- Frontend / API behavior changes (frontend has no user-facing `rk`-command strings — only code comments, out of scope).
- Other `docs/site/` pages (`workflows.md`, `status-dot.md`, `notifications.md`) — Assumption 8.
- fish/powershell dual-completion registration — single-name binding kept (Assumption 9).

### Design Decisions

1. **Static Cobra `Use`, not argv[0]-dynamic**: `Use: "run-kit"` stays a literal — *Why*: help-dump JSON is regenerated on a schedule by shll.ai and must be deterministic regardless of which name invoked the CLI — *Rejected*: argv[0]-dynamic `Use` (non-deterministic help-dump, code for no gain).
2. **No dual-marker back-compat in `upgrade.go`**: the new logic uses only `/Cellar/run-kit/` markers — *Why*: an old installed binary runs its OWN old logic (self-resolves under `/Cellar/rk/`, brew `formula_renames` redirects the upgrade, the `rk` symlink persists for the daemon restart), so the transition completes without new-binary back-compat — *Rejected*: dual-marker matching (dead weight; the transition rides brew rename + persistent symlink).
3. **run-kit-first `resolveRkPath` order**: prefer `LookPath("run-kit")` — *Why*: matches the new canonical identity; functionally equivalent since both stable symlinks hit the same binary and the test is order-agnostic — *Rejected*: keeping rk-first (works but diverges from the new canonical direction).

## Tasks

### Phase 1: Core Identity (Cobra root + help-dump)

- [x] T001 Swap `rootCmd.Use` → `"run-kit"` and `Short` → `"run-kit — tmux session manager with web UI"` in `app/backend/cmd/rk/root.go` (lines 24-25); update the `displayVersion()` doc-comment example `"rk version v1.5.3"` → `"run-kit version v1.5.3"` (line 14) <!-- R1 -->
- [x] T002 Set `Tool: "run-kit"` in `buildDump` in `app/backend/cmd/rk/help_dump.go` (line 87); leave `schemaVersion` at `1` <!-- R2 -->

### Phase 2: Shell Completion Dual-Name Binding

- [x] T003 In `app/backend/cmd/rk/shell_init.go`: update `shellInitBanner` text (`# run-kit(1) ... completion`, install hint `eval "$(run-kit shell-init %[1]s)"`, note text `run-kit <subcommand>`), update the `zshCompinitShim` comment text (`_rk`/`rk` → `_run-kit`/`run-kit`), and update the `newShellInitCmd` `Short`/`Long` and the error messages in `runShellInit` (`rk shell-init:` → `run-kit shell-init:`) <!-- R3 -->
- [x] T004 In `runShellInit`, after `rootCmd.GenZshCompletion(out)` append an extra `compdef _run-kit rk` line; after `rootCmd.GenBashCompletionV2(out, true)` append an extra `complete` line registering `rk` against `__start_run-kit` using the same flags cobra's generated `run-kit` registration uses. Both appended writes go through `io.WriteString(out, ...)` with wrapped-error handling matching the surrounding code. fish/powershell branches untouched. `app/backend/cmd/rk/shell_init.go` <!-- R3 -->

### Phase 3: Release Plumbing

- [x] T005 [P] Rewrite `.github/formula-template.rb`: `class RunKit < Formula`, `def install` → `bin.install "rk" => "run-kit"` + `bin.install_symlink bin/"run-kit" => "rk"`, `test do` → assert both `#{bin}/run-kit --version` and `#{bin}/rk --version` match `"run-kit version"`. Keep desc/homepage/url/sha blocks unchanged <!-- R4 -->
- [x] T006 [P] In `.github/workflows/release.yml` "Update Homebrew tap" step: sed output path `Formula/rk.rb` → `Formula/run-kit.rb`, `git add Formula/rk.rb` → `Formula/run-kit.rb`, commit message `"rk ${version}"` → `"run-kit ${version}"`. Leave the cross-compile step (artifact names `rk-{os}-{arch}`) untouched <!-- R5 -->

### Phase 4: Runtime Identity (upgrade + agent-setup)

- [x] T007 In `app/backend/cmd/rk/upgrade.go`: `updateCmd.Short` → `"Update run-kit to the latest version"` (line 81); Cellar markers `"/Cellar/rk/"` → `"/Cellar/run-kit/"` (lines 88, 141); brew refs `sahil87/tap/rk` → `sahil87/tap/run-kit` (lines 112, 132); `brewBinPath` suffix `/bin/rk` → `/bin/run-kit` (line 145); printed messages `"rk v%s was not installed..."` → run-kit phrasing (line 89), reinstall hint → the single fully-qualified `brew install sahil87/tap/run-kit` line (drop the separate `brew tap sahil87/tap` line; NEVER unqualified `brew install run-kit` — that resolves to homebrew-core's unrelated formula), `"Restarting rk daemon..."` (line 149) and `"rk daemon started..."` (line 153) → run-kit phrasing; update the doc comments at lines 57 and 139 that name the `/Cellar/rk/` marker and the example resolved path. `rk-daemon` socket/session identifiers via `daemon.*` constants stay <!-- R6 --> <!-- rework: review cycle 1 must-fix — the implemented unqualified `brew install run-kit` hint resolves to homebrew-core's unrelated run-kit formula (verified via brew); R6's own wording encoded the footgun and was revised to require the fully-qualified form. Only the reinstall-hint lines need re-editing; the rest of this task's edits are already in place and correct -->
- [x] T008 In `app/backend/cmd/rk/agent_setup.go` `resolveRkPath` (line 91): try `exec.LookPath("run-kit")` first (abs-resolve as today), then `exec.LookPath("rk")`, then `os.Executable()`; update the doc comment to describe the run-kit-first preference. Hook shape, markers, and `validateHookPath` unchanged <!-- R7 -->

### Phase 5: Message-String Sweep (cmd/rk user-facing)

- [x] T009 Sweep user-facing command-name strings in `app/backend/cmd/rk/` to `run-kit` phrasing — `Short`/`Long` help text, printed messages, and error prefixes — across: `daemon.go`, `daemon_start.go`, `daemon_stop.go`, `daemon_restart.go`, `daemon_status.go`, `serve.go`, `context.go`, `layout.go`, `reaper.go`, `doctor.go`, `notify.go`, `status.go`, `initconf.go`, `riff.go`, `agent_setup.go` (help/error text), `agent_hook.go`. Preserve internal identifiers verbatim: `rk-daemon`, `rk-test`, `RK_*`, `~/.rk/`, `@rk_*`, `bin/rk`, `dist/rk`, the `rk/api` import path. Re-grep `cmd/rk/` after editing to confirm no user-facing `rk <subcommand>` string remains (excluding the internal-identifier allowlist) <!-- R8 -->

### Phase 6: Docs Voice Swap

- [x] T010 [P] Editorial re-voice of `README.md`: install command → `brew install sahil87/tap/run-kit`, flip the alias sentence (formula installs `run-kit`, `rk` is the interchangeable short alias), switch primary examples/command-reference/upgrade instructions to `run-kit ...`, re-voice branding prose. KEEP: `rk-daemon` server name, `RK_HOST`/`RK_PORT`, `~/.rk/`, `@rk_agent_state`/`@rk_board`, `bin/rk`, repo-internal links, other tools' formulas (`sahil87/tap/wt`, `sahil87/tap/all`) <!-- R9 -->
- [x] T011 [P] Editorial re-voice of `docs/site/install.md`: intro line, install command → `brew install sahil87/tap/run-kit`, flip the alias sentence, switch primary command examples to `run-kit ...`. Same KEEP list as README <!-- R9 -->

### Phase 7: Test Assertions

- [x] T012 Update `app/backend/cmd/rk/root_test.go` (lines 52, 68): `want := "rk version dev"` → `"run-kit version dev"` <!-- R1 -->
- [x] T013 Update `app/backend/cmd/rk/help_dump_test.go`: `doc.Tool` (lines 51-52), `doc.Root.Name`/`doc.Root.Path` (lines 60-64) `"rk"` → `"run-kit"`; verify the `UseLine()` self-consistent assertion (line ~197) still holds <!-- R2 -->
- [x] T014 Update `app/backend/cmd/rk/shell_init_test.go`: banner anchors (`# rk(1) ...` → `# run-kit(1) ...`, eval hints), assert BOTH `compdef _run-kit run-kit` and appended `compdef _run-kit rk`; `__start_rk` → `__start_run-kit` plus the appended `rk` complete line; no-wrapper test anchors on both `rk()` and `run-kit()` forms; error-message assertions follow the `run-kit shell-init:` prefix <!-- R3 -->
- [x] T015 Update `app/backend/cmd/rk/upgrade_test.go`: stub Cellar paths (`/Cellar/rk/.../bin/rk` → `/Cellar/run-kit/<v>/bin/run-kit`), restart-path assertion `/bin/rk` suffix → `/bin/run-kit`, brew-arg recordings `sahil87/tap/rk` → `sahil87/tap/run-kit` <!-- R6 -->
- [x] T016 Grep `cmd/rk/*_test.go` for any other user-facing `rk`-string assertions affected by T009's sweep (help/error text) and align them with the new phrasing; leave internal-identifier assertions untouched. `agent_setup_test.go` `resolveRkPath` test is order-agnostic — confirm it still passes unmodified <!-- R8 -->

### Phase 8: Review Rework (cycle 1 should-fixes)

- [x] T017 Fix stale in-page anchors broken by the `## Agent state — run-kit agent-setup` heading rename: `README.md` command-reference table link `#agent-state--rk-agent-setup` → `#agent-state--run-kit-agent-setup` (line ~234), and `docs/site/install.md` cross-doc link `../../README.md#agent-state--rk-agent-setup` → `#agent-state--run-kit-agent-setup` (line ~24) <!-- R9 --> <!-- rework: review cycle 1 should-fix — heading changed, referencing anchors did not -->
- [x] T018 In `app/backend/cmd/rk/agent_setup.go` (line ~278): the printed confirmation `"%s: will %s rk agent-state hooks in %s"` → run-kit phrasing (`run-kit agent-state hooks`) — the sole residual user-facing `rk` string found by review. While in the file's sibling `agent_hook.go` (line ~26), align the doc comment `brew upgrade rk` → `brew upgrade run-kit` for in-file consistency with its own Long text <!-- R8 --> <!-- rework: review cycle 1 should-fix — R8 sweep miss -->

## Execution Order

- T001, T002 first (root identity drives cobra-derived output).
- T003 before T004 (banner/help text edits precede the appended completion lines in the same file).
- T007, T008 independent of each other and of the completion work.
- T012-T016 (tests) run after their corresponding implementation tasks; T012 after T001, T013 after T002, T014 after T003-T004, T015 after T007.
- T005, T006, T010, T011 are `[P]` (release/docs files, no code dependency).

## Acceptance

### Functional Completeness

- [x] A-001 R1: `rootCmd.Use` is `"run-kit"` with matching `Short`; `rk --version` and `run-kit --version` both print `run-kit version <v>` (dev: `run-kit version dev`); `Use` is a static string
- [x] A-002 R2: `buildDump` emits `tool: "run-kit"` with `schema_version: 1`; `root.name`/`root.path` are `run-kit`
- [x] A-003 R3: zsh output carries both `compdef _run-kit run-kit` and `compdef _run-kit rk`; bash output registers both `run-kit` and `rk` against `__start_run-kit`; banner/help/error text uses `run-kit` phrasing; fish/powershell keep single-name binding
- [x] A-004 R4: `formula-template.rb` is `class RunKit`, installs `rk` renamed to `run-kit` with an `rk` symlink back, and tests both names against `"run-kit version"`
- [x] A-005 R5: `release.yml` writes/adds/commits `Formula/run-kit.rb` with message `run-kit ${version}`; cross-compile artifact names unchanged
- [x] A-006 R6: `upgrade.go` uses `/Cellar/run-kit/`, `sahil87/tap/run-kit`, `/bin/run-kit`, and run-kit-voiced messages incl. the single fully-qualified `brew install sahil87/tap/run-kit` reinstall hint (no `brew tap` line, never unqualified `brew install run-kit`)
- [x] A-007 R7: `resolveRkPath` prefers `run-kit`, falls back to `rk`, then `os.Executable()`; returns a non-empty absolute path
- [x] A-008 R8: no user-facing command-name string in `cmd/rk/` reads `rk <subcommand>` (excluding internal-identifier allowlist); internal identifiers are preserved verbatim
- [x] A-009 R9: README.md and docs/site/install.md teach `run-kit` as canonical with `rk` as the short alias; install command is `brew install sahil87/tap/run-kit`; internal identifiers and other tools' formulas unchanged
- [x] A-023 R9: no stale `#agent-state--rk-agent-setup` anchor remains in README.md or docs/site/install.md — both links target `#agent-state--run-kit-agent-setup` (rework cycle 1)
- [x] A-024 R8: `agent-setup`'s printed confirmation names `run-kit agent-state hooks` (no residual user-facing `rk` phrasing in `cmd/rk/`) (rework cycle 1)

### Behavioral Correctness

- [x] A-010 R1: version output flows from Cobra's version template for both invocation names (no per-name divergence)
- [x] A-011 R6: an old installed binary's upgrade path still completes via brew `formula_renames` redirect + the persistent `rk` symlink (transition-safety reasoning holds; no dual-marker code added)

### Scenario Coverage

- [x] A-012 R1: `root_test.go` asserts `run-kit version dev`
- [x] A-013 R2: `help_dump_test.go` asserts `tool`/`root.name`/`root.path` = `run-kit`
- [x] A-014 R3: `shell_init_test.go` asserts dual-name completion for zsh and bash plus the new banner/error prefixes
- [x] A-015 R6: `upgrade_test.go` asserts the `/Cellar/run-kit/`, `/bin/run-kit`, and `sahil87/tap/run-kit` markers/paths/args

### Edge Cases & Error Handling

- [x] A-016 R3: `run-kit shell-init` with missing/unsupported shell prints the `run-kit shell-init:` error prefix and exits 2
- [x] A-017 R7: existing installed hooks embedding `/opt/homebrew/bin/rk` remain valid (the `rk` symlink persists); order-agnostic `resolveRkPath` test still passes

### Code Quality

- [x] A-018 Pattern consistency: New code follows naming and structural patterns of surrounding code (cobra command idioms, `io.WriteString` + wrapped errors in shell_init, package-var seams untouched)
- [x] A-019 No unnecessary duplication: The appended completion registrations reuse cobra's entry function names/flags rather than reconstructing completion logic; no convention-string duplication introduced
- [x] A-020 Security First (Constitution I): No new shell-string subprocess construction; `exec.CommandContext` + argv slices preserved; `validateHookPath` guarding the hook path is unchanged
- [x] A-021 Test Integrity: Test assertions are updated to match the new spec (canonical name), not the implementation bent to old fixtures

### Backend Test Gate

- [x] A-022 `just test-backend` (or `cd app/backend && go test ./...`) passes with the updated assertions

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change swaps the canonical name in place; both command names stay live and no in-repo code, function, branch, or config becomes redundant. (Out-of-repo: `sahil87/homebrew-tap` `Formula/rk.rb` becomes redundant once `Formula/run-kit.rb` lands — already tracked as the scoped `formula_renames.json` follow-up, intake §5.)

## Assumptions

<!-- Graded SRAD decisions made while co-generating Requirements/Tasks/Acceptance. The intake's
     own Assumptions table (11 rows) is authoritative for the design; these are apply-level
     resolutions of any under-specified point encountered during plan generation. -->

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Code comments that merely name `rk` internally (not user-facing output) are updated ONLY where the intake explicitly calls them out (root.go:14 displayVersion example, zshCompinitShim comment, upgrade.go:57/139 comments, resolveRkPath doc comment); other incidental `rk`-mentioning comments in `cmd/rk/` are left as-is | Intake §8 scopes the sweep to "user-facing strings"; comments are not user-facing runtime output, and the intake's representative inventory names help/message/error text plus a specific comment set. Touching every comment would be churn beyond stated scope | S:80 R:85 A:80 D:75 |
| 2 | Confident | The appended bash `complete` line copies the exact flags cobra's generated `complete ... run-kit` invocation uses (e.g. `-o default -F __start_run-kit`), read from the generated output at implementation time rather than hardcoded blindly | Intake §3 says "copy the exact generated invocation's flags"; the precise flag set is cobra-version-dependent so it must be derived from the actual generated script, matched in the test | S:70 R:80 A:80 D:70 |
| 3 | Confident | The message-string sweep treats the `rk/api` Go import path in `serve.go` and any `"rk/internal/..."` import as an internal identifier (unchanged), consistent with the module-path invariant | Assumption 2 in the intake fixes the module path as `rk`; import paths derive from it and are not user-facing strings | S:85 R:90 A:85 D:80 |

3 assumptions (1 certain, 2 confident, 0 tentative).
