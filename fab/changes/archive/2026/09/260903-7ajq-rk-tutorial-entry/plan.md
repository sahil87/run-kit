# Plan: rk tutorial — one-command tour entry on a fast tier

**Change**: 260903-7ajq-rk-tutorial-entry
**Intake**: `intake.md`

## Requirements

### CLI: the `rk tutorial` command

#### R1: Command surface
run-kit SHALL provide a top-level `tutorial` command (`rk tutorial [--tier <role>]`) registered in `cmd/rk/root.go`. The `--tier` flag SHALL default to `fast` and be forwarded verbatim as the fab role selector for launcher resolution.

- **GIVEN** a user with run-kit installed
- **WHEN** they run `rk tutorial --help`
- **THEN** the command exists with a `--tier` flag documented as defaulting to `fast`

#### R2: tmux precondition
`rk tutorial` MUST require the caller to be inside a tmux session, detected via `internal/tmux.OriginalTMUX` (the captured pre-init `$TMUX`, the same mechanism as `cmd/rk/riff.go` `checkPreconditions`). Outside tmux it SHALL exit 1 (shll convention: operational failure) with a message directing the user to open the run-kit dashboard and create a session/window first — no tmux subprocess may run before this check.

- **GIVEN** a shell with `$TMUX` unset
- **WHEN** the user runs `rk tutorial`
- **THEN** the process exits 1 with guidance naming the dashboard flow, and no window is created

#### R3: Session-scoped singleton
GIVEN an existing window whose name is exactly `tutorial` in the **current session**, `rk tutorial` SHALL select it (`select-window` targeting the window's `@N` id, which is exempt from tmux prefix/glob target resolution) and report `Switched to existing tutorial tab.` instead of creating a duplicate. The probe SHALL enumerate only the current session's windows (`tmux list-windows -F '#{window_id}\t#{window_name}'` with the restored `$TMUX` env) and exact-match the name as the **last** tab-separated field (the fab-kit `findWindowExact` lesson). A `tutorial` window in a different session on the same server SHALL NOT be selected.

- **GIVEN** the current session already has a window named `tutorial`
- **WHEN** the user runs `rk tutorial`
- **THEN** that window is selected by its `@N` id, no new window is created, and the command reports the switch

#### R4: Launch — bare launcher + typed, verified kickoff
*(Revised after the live fast-tier failure: `kimi --auto '<prompt>'` parses a positional prompt as a subcommand and exits — positional delivery is claude-only, so the provider-opaque launcher MUST be fed by typed keys, per the backlog's original "types in the kickoff prompt" wording.)*

When no `tutorial` window exists in the current session, `rk tutorial` SHALL:
1. Resolve the launcher via `riff.ResolveLauncher(ctx, repoRoot, tier)` where `repoRoot` is `config.FindGitRoot(cwd)` (the riff CLI's own derivation — empty tolerated) and `tier` is the `--tier` value. The seam's existing contract supplies the fab-absent fallback: any failure degrades silently to `riff.DefaultLauncher`.
2. Compose the pane command via riff's exported skill-shell composition (R5) with an **empty prompt** — the launcher runs **bare** (`${SHELL:-/bin/sh} -i -c '<launcher>'` with the `; exec "${SHELL:-/bin/sh}"` fallback tail).
3. Open the window with `tmux new-window -P -F '#{pane_id}' -c <cwd> -n tutorial <shellCmd>` on the caller's current server (child env carries the restored `$TMUX`), capturing the pane id as the delivery target, and report the launch (window name + resolved tier).
4. **Type the kickoff** into the booted agent, each step verified from the pane's own text (`deliverTutorialKickoff`):
   - boot settle: poll `capture-pane` until the pane is non-blank and unchanged across two consecutive polls;
   - type `send-keys -l` with the exact constant:

     ```go
     const tutorialKickoffPrompt = "Run rk skill tutorial and follow it exactly"
     ```

   - echo verify: alphanumerics-only compare (`paneEchoesKickoff`/`stripToAlnum`) so input-box borders and line wrapping are presentation noise;
   - submit `send-keys Enter`, retrying ONCE when the pane is byte-identical after the settle wait (the swallowed-Enter trap).

   Pacing: each tmux call individually bounded (10s); the polls share a 25s wall-clock delivery deadline (600ms interval, 1.2s submit settle — package vars, shrunk by tests). An unverifiable delivery SHALL degrade to a stderr note carrying the exact kickoff text to paste, with exit 0 — the window and agent exist either way.

All subprocesses MUST be argv-slice `exec.CommandContext` calls with timeouts (constitution §I); the launcher string is the one documented shell-expansion exception, and the typed kickoff never passes through a shell at all (a literal `send-keys -l` argv element).

- **GIVEN** a tmux session with no `tutorial` window, inside a git repo with fab installed
- **WHEN** the user runs `rk tutorial`
- **THEN** a window named `tutorial` opens in the current session at the process cwd running the fast-tier-resolved launcher bare, the kickoff prompt is typed into the booted agent and submitted (verified), and the pane drops to an interactive shell when the agent exits

#### R5: Exported riff composition seam
`internal/riff` SHALL expose the skill-pane shell composition to `cmd/rk` (e.g. `func SkillPaneCommand(launcher, prompt string) string` delegating to `buildSkillShellString`) with **zero behavior change** for riff itself — existing riff tests pass unmodified.

- **GIVEN** the exported helper
- **WHEN** called with a launcher and prompt
- **THEN** its output is byte-identical to `buildSkillShellString(launcher, prompt)`

#### R6: Documentation
README SHALL name `run-kit tutorial` as the guided-tour entry: a Quick start mention and a row in the `## Command reference` table.

- **GIVEN** the README
- **WHEN** a new user reads Quick start or the command reference
- **THEN** `run-kit tutorial` is documented as the one-command guided tour

### Design Decisions

#### Kickoff typed into the booted agent, not a positional argument
**Decision**: run the launcher bare and deliver the kickoff by typed keys — verified boot settle, literal `send-keys -l`, alphanumerics-only echo check, Enter with one unchanged-screen retry, degrade-to-paste-note on failure.
**Why**: the launcher string is provider-opaque and a positional prompt is claude-only — the first shipped (positional) version broke immediately on the default fast tier, where `kimi --auto '<prompt>'` rejects the prompt as an unknown subcommand. The backlog's original wording ("types in the kickoff prompt") anticipated exactly this; the verification loop is what neutralizes the typed-delivery risks (readiness, swallowed Enter).
**Rejected**: the launcher positional argument (riff's task-injection seam) — shipped first, provider-dependent, live-failed on kimi; a per-provider prompt-flag table — rk would own provider CLI schemas it deliberately delegates to fab (constitution §III).
*Introduced by*: 260903-7ajq-rk-tutorial-entry

#### Session-scoped singleton
**Decision**: exact-name `tutorial` probe scoped to the current session; select the existing window instead of creating `tutorial-2`.
**Why**: re-running the entry command should return to the tour; a tour belongs to the project session it started in.
**Rejected**: operator's server-wide singleton (a tour is not a per-server coordinator); riff-style collision suffixing (stacks abandoned tutorial windows).
*Introduced by*: 260903-7ajq-rk-tutorial-entry

#### Default tier `fast`, one-line contingency
**Decision**: ship with `--tier` defaulting to `fast`.
**Why**: tour turns are short narration beats; the fast tier keeps them snappy, and the backlog's pacing validation is recorded as a live-run note for the PR (see Notes) — the default is a one-line flip if the fast provider breaks the pacing contract.
**Rejected**: defaulting to fab's default tier with `fast` opt-in — inverts the backlog's stated intent for the common case.
*Introduced by*: 260903-7ajq-rk-tutorial-entry

## Tasks

### Phase 1: Setup

- [x] T001 Export the skill-shell composition from `app/backend/internal/riff/shell.go`: add `SkillPaneCommand(launcher, prompt string) string` delegating to `buildSkillShellString`, with a unit test asserting byte-identity against the existing composition <!-- R5 -->

### Phase 2: Core Implementation

- [x] T002 Create `app/backend/cmd/rk/tutorial.go`: cobra `tutorialCmd` (`Use: "tutorial"`, `--tier` string flag default `"fast"`), the `tutorialKickoffPrompt` constant, and the tmux precondition check via `tmux.OriginalTMUX` returning exit 1 with dashboard guidance (riff `ExitCodeError` discipline) <!-- R1, R2 -->
- [x] T003 Singleton probe in `tutorial.go`: enumerate current-session windows (`list-windows -F '#{window_id}\t#{window_name}'`, restored-`$TMUX` child env, `exec.CommandContext` + timeout), exact-match `tutorial` via a pure last-field helper, `select-window -t <@id>` + `Switched to existing tutorial tab.` report <!-- R3 -->
- [x] T004 Launch path in `tutorial.go`: `riff.ResolveLauncher(ctx, config.FindGitRoot(cwd), tier)` → `riff.SkillPaneCommand(launcher, tutorialKickoffPrompt)` → `tmux new-window -c <cwd> -n tutorial <shellCmd>` (restored-`$TMUX` child env), success report naming the window and tier <!-- R4 -->
- [x] T005 Register `tutorialCmd` in `app/backend/cmd/rk/root.go` beside the other top-level commands <!-- R1 -->

### Phase 3: Integration & Edge Cases

- [x] T006 Unit tests in `app/backend/cmd/rk/tutorial_test.go`: precondition failure message + exit class, `--tier` default and override plumbing, bare-launcher composition, pure singleton-probe matcher (incl. non-match for other-session rows and tab-containing names); verify the suite passes under `env -u TMUX -u TMUX_PANE go test ./cmd/rk/` <!-- R1, R2, R3, R4 -->
- [x] T008 Typed-kickoff delivery (`deliverTutorialKickoff` in `tutorial.go`): pane-id capture via `new-window -P -F`, boot-settle poll, literal `send-keys -l` + alphanumerics-only echo verify (`paneEchoesKickoff`), Enter with one unchanged-screen retry, stderr paste-note degrade; scripted-capture unit tests (happy path, Enter retry, degrade note) plus a live isolated-server proof against the fast tier <!-- R4 -->

### Phase 4: Polish

- [x] T007 README: Quick start mention + `## Command reference` row for `run-kit tutorial`; check the new surface against `shll standards` (help text shape, Principle 9) <!-- R6 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `rk tutorial` exists as a registered top-level command with `--tier` defaulting to `fast` and sensible Short/Long help
- [x] A-002 R2: outside tmux the command exits 1 with dashboard-pointing guidance and runs no tmux subprocess
- [x] A-003 R3: an existing exact-name `tutorial` window in the current session is selected by `@N` id (no duplicate window) with the switch report
- [x] A-004 R4: with no existing window, a `tutorial` window opens in the current session at the process cwd running the BARE launcher with the interactive-shell fallback, and the kickoff is typed into the booted agent and submitted (verified boot settle → echo → Enter)
- [x] A-005 R5: the riff composition export is behavior-preserving — existing riff tests pass unmodified
- [x] A-006 R6: README Quick start and Command reference document `run-kit tutorial`

### Behavioral Correctness

- [x] A-007 R4: the kickoff prompt is exactly `Run rk skill tutorial and follow it exactly`, delivered as a literal `send-keys -l` argv element (never through a shell); the launcher half remains the documented unescaped exception; an unverifiable delivery degrades to a stderr paste note with exit 0
- [x] A-008 R1: `--tier <x>` reaches `ResolveLauncher` as the tier selector; omitted flag resolves tier `fast`

### Scenario Coverage

- [x] A-009 R2: unit test covers the `$TMUX`-unset failure (message + failure class), passing under `env -u TMUX -u TMUX_PANE`
- [x] A-010 R3: unit test covers the singleton matcher — exact match, no prefix/substring match, name as last tab-separated field

### Edge Cases & Error Handling

- [x] A-011 R4: fab absent or failing resolution degrades to `riff.DefaultLauncher` (seam contract — verified via the tier-plumbing test, not by invoking fab)
- [x] A-012 R3: a `tutorial` window in a different session is not selected; a fresh window is still created in the current session

### Code Quality

- [x] A-013 Pattern consistency: cobra command shape, exit-code discipline, and comment style match `cmd/rk/riff.go` and siblings
- [x] A-014 No unnecessary duplication: shell composition reused from `internal/riff`, not copied into `cmd/rk`
- [x] A-015 Subprocess discipline: every call is argv-slice `exec.CommandContext` with a timeout (constitution §I); no shell strings outside the documented launcher exception
- [x] A-016 Tests cover the added behavior (code-quality baseline: new features ship with tests)

### Security

- [x] A-017 R4: no user-controlled input reaches the shell string unescaped — the shell string carries only the resolved launcher (the documented exception); the kickoff constant rides `send-keys -l` as a literal argv element outside any shell; `--tier` travels only as a fab argv element

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- **Pacing validation (backlog rider)**: the fast tier's live pacing contract (one act per reply) cannot be judged by unit tests. The ship-stage PR body MUST carry a validation note: run `rk tutorial` once and confirm Act pacing; contingency is flipping the `--tier` default to `""` (fab default tier) — one line.

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Select-window targets the `@N` window id, not the name | tmux name targets are prefix/glob-resolved; id targeting is exact — the documented operator-launcher lesson | S:80 R:90 A:95 D:90 |
| 2 | Confident | `ResolveLauncher` repoRoot = `config.FindGitRoot(cwd)`; window `-c` = process cwd | Mirrors the riff CLI's own derivation; fab tolerates an empty root and the tour is project-agnostic | S:55 R:85 A:80 D:70 |
| 3 | Confident | No `switch-client` after select — session-scoped singleton needs only `select-window` | The window is in the caller's current session by construction; switch-client is operator's server-wide concern | S:60 R:90 A:85 D:80 |
| 4 | Confident | No `wt` dependency and no preset machinery — tutorial bypasses `riff.Run`/`Spawn` entirely, composing its own two tmux calls | The engine's worktree/collision/layout machinery is the wrong shape for select-or-create in the current session | S:60 R:80 A:85 D:75 |
| 5 | Confident | Singleton matcher cuts on the FIRST tab — name = remainder of the line (the format's last field), so a tab-containing name never exact-matches | "Last tab-separated field" read against `#{window_id}\t#{window_name}`: only the id precedes the name, so a first-tab cut preserves the name verbatim; a literal trailing-field match would false-positive on `foo\ttutorial` | S:65 R:85 A:90 D:75 |
| 6 | Confident | `os.Getwd` failure is a plain operational error (exit 1 via the central execute() seam), not the tolerated-empty repoRoot path | riff tolerates an empty root for launcher RESOLUTION only; `new-window -c` needs a real cwd, so a cwd failure is fatal | S:55 R:80 A:75 D:65 |
| 7 | Confident | Tmux/fab seams in tutorial.go are package-level function vars carrying (ctx, args, env) — the role.go test-seam shape — rather than reusing internal/riff's unexported childEnv | The two tmux calls are trivial argv slices; an exported riff seam for a two-line env append would widen the engine's surface for no behavioral gain | S:50 R:80 A:75 D:60 |
| 8 | Certain | Kickoff delivery revised from launcher-positional to typed keys (bare launcher + verified send-keys) after the live fast-tier failure | `kimi --auto '<prompt>'` rejects a positional prompt as an unknown subcommand (user-reported, reproduced); typed keys are the only provider-agnostic delivery — validated end-to-end on an isolated tmux server against the real fast-tier launcher | S:95 R:85 A:90 D:90 |

4 assumptions (1 certain, 3 confident, 0 tentative) at plan time; 3 apply-time decisions appended (rows 5–7, all confident); 1 post-review revision (row 8, certain — the typed-kickoff rework).
