# Intake: rk riff — CLI Surface Refinement

**Change**: 260423-udhe-rk-riff-cli-surface
**Created**: 2026-04-23
**Status**: Draft

## Origin

Second change in the three-change `rk riff` rework. The first change (`260423-ba9f-rk-riff-correctness-fixes`) handles mechanical bug fixes with no CLI surface impact. This change consolidates every CLI-visible refinement into one "break the surface once" PR before features land on top.

Items covered (from the prior triage):

- **Bug 2** — *(verified 2026-04-23 as phantom — no code change; see §1)*. Originally: `/fab-discuss` passed as positional argv to `claude`; suspected silent no-op. Confirmed working via live smoke test — positional argv dispatches slash-commands correctly.
- **DX 1** — *(deferred to change 3)*. Default `--cmd=/fab-discuss` is broken-by-default for users without fab-kit. Policy decision deferred — the presets feature in change 3 is the better home for per-project default-skill configuration. This change keeps the `/fab-discuss` hardcoded default.
- **DX 2** — `Long` help text mentions neither preconditions nor the default command nor launcher resolution; compare `serve.go:25-34` for house style.
- **DX 3** — `Use: "riff [-- wt-flags...]"` hides `--cmd` and `--split` from the synopsis line.
- **DX 4** — Flag names `--cmd` and `--split` are generic. Rename to more descriptive names (e.g., `--skill`, `--setup-pane`).

In-scope for this change: **DX 2, DX 3, DX 4** (pure CLI-surface refinement). Bug 2 is closed-as-phantom (documentation-only) and DX 1 is deferred to change 3.

Why DX 2/3/4 belong together: any one of them alone is a CLI-surface change that breaks muscle memory and requires users to update scripts/aliases/docs. Bundling them into one break minimizes pain and lets users learn the new surface once.

## Why

The main user-impact argument: `rk riff` today leaks its author's private workflow through flag names and a two-line help blurb. If rk is to be installed by anyone outside the author's immediate context, the surface needs to stop surprising strangers:

- **Bug 2** — resolved during intake clarification (verified phantom via smoke test; current delivery is correct). Only a Changelog note remains.
- **DX 1 (broken default)** — acknowledged but deferred to change 3. `/fab-discuss` assumes fab-kit is installed; strangers without it will hit an unknown-skill error on first run. The fix belongs with the presets feature, which will provide a cleaner per-project default-skill mechanism than a narrow config key added here.
- **DX 2 and 3 (help text)** — pure ergonomics; the help output should tell a new user what they need and how. Compare `serve.go:25-34` — it enumerates env vars and gives examples; riff's help is a two-line stub.
- **DX 4 (flag names)** — a one-time rename is cheaper than living with confusing names forever. `--cmd` is especially bad (ambiguous: shell command? claude command? REPL input?). `--skill` is more honest (it's a Claude Code slash-command / skill).

Why renaming once, here, and not later: once presets (change 3) reference flag names in config, renames get more expensive. Settle the surface now.

## What Changes

### 1. Bug 2 — `/fab-discuss` delivery mechanism (verified: phantom bug)

**Verified 2026-04-23 via live smoke test (outcome (a)):** `claude --help` documents `Usage: claude [options] [command] [prompt]` with `prompt` as a positional arg, and running `tmux new-window 'claude --dangerously-skip-permissions /fab-discuss'` confirmed the slash-command dispatches as a skill invocation (not literal text, not empty REPL).

**Resolution:** no code change required. The current delivery path (`<launcher> '<escaped-cmd>'` composed inside `buildNewWindowArgs`) is correct. Drop Bug 2 from this change's scope — update the change spec's Changelog to record it as investigated-and-ruled-out.

<!-- clarified: Bug 2 verified as phantom — positional argv correctly dispatches slash-commands. No send-keys switch needed. -->

### 2. Rename `--cmd` → `--skill` and `--split` → `--setup-pane`

**Decision: hard-rename.** No deprecated aliases. rk is early (v1.4.0) and the blast radius is small — likely only the author's own dotfiles. Keeping aliases would undo the "break the surface once" rationale that justifies bundling DX 2/3/4. If pain is observed post-merge, re-adding aliases as a patch release is cheap.

<!-- clarified: Hard-rename without deprecated aliases. User selected (a) in intake clarification 2026-04-23. -->

Updated flag definitions (sketch):

```go
riffCmd.Flags().StringVar(&riffSkillFlag, "skill", "", "Claude Code skill or slash-command to run in the new window (e.g., /fab-discuss)")
riffCmd.Flags().StringVar(&riffSetupPaneFlag, "setup-pane", "", "If non-empty, split the window and run this setup command in the right pane")
```

Rename in internal code: `riffCmdFlag` → `riffSkillFlag`, `riffSplitFlag` → `riffSetupPaneFlag`. Tests updated accordingly.

### 3. Default `--skill` resolution policy (DX 1) — deferred to change 3

Decision: **keep status quo**. `--skill` retains the hardcoded `/fab-discuss` default after renaming. No change to `internal/fabconfig`. The DX 1 onboarding landmine is acknowledged and deferred to change 3, where the presets feature will own per-project default-skill configuration with a cleaner story than a narrow single-key addition here.

<!-- clarified: DX 1 deferred to change 3 (presets); --skill default stays hardcoded as /fab-discuss. User selected option (a) in intake clarification 2026-04-23. -->

### 4. Expand help text (DX 2 and 3)

**`Use:` synopsis (DX 3):** show all flags in the one-liner.

```go
Use: "riff [--skill <name>] [--setup-pane <cmd>] [-- <wt-flags>...]"
```

**`Long:` text (DX 2):** rewrite to match the `serve.go:25-34` house style — prerequisites, examples, pointer to `wt create --help`, note about exit codes. Draft:

```
Create a git worktree via wt, open a new tmux window in it, and launch a
Claude Code session with a skill or slash-command.

Prerequisites:
  - You must be inside a tmux session ($TMUX set).
  - 'wt' must be on your PATH (https://github.com/sahil87/wt).
  - The launcher binary (default: 'claude') must be installed.

Flags before -- are parsed by rk; flags after -- are forwarded verbatim to
wt create (e.g., --worktree-name, --base, --reuse). Run 'wt create --help' to
see the available passthrough flags.

Launcher resolution:
  If 'fab/project/config.yaml' has 'agent.spawn_command', that value is used
  as the launcher. Otherwise, falls back to 'claude --dangerously-skip-permissions'.

Examples:
  rk riff                                     # default skill in a new worktree
  rk riff --skill /review                     # pick a specific skill
  rk riff --setup-pane "just dev"             # add a setup pane running 'just dev'
  rk riff -- --worktree-name pacing-canyon    # name the worktree
  rk riff --skill /ship -- --reuse --base main

Exit codes:
  0  success
  2  precondition failure ($TMUX unset, wt not found)
  3  subprocess failure (wt or tmux non-zero, output parse failure, timeout)
```

### 5. Update memory and tests

- `docs/memory/run-kit/rk-riff.md` — update every reference to `--cmd`/`--split`, the flag table, the flag-surface section, the Long/Use help blurbs, and the Changelog. Record Bug 2 as verified-phantom in the Changelog so future readers know the positional-argv delivery is intentional. No default-skill section added (deferred to change 3).
- `app/backend/cmd/rk/riff_test.go` — rename test variables/cases to match new flag names. `TestBuildNewWindowArgs` stays on its current signature.
- `app/backend/internal/fabconfig/fabconfig.go` — no changes (deferred to change 3).

## Affected Memory

- `run-kit/rk-riff.md`: (modify) — flag renames, Long text rewrite, Use synopsis update, Changelog entry (including the Bug 2 phantom-verification note).

## Impact

**Code:**
- `app/backend/cmd/rk/riff.go` — flag renames (`--cmd` → `--skill`, `--split` → `--setup-pane`) and help-text expansion. No change to `runTmuxNewWindow`, `resolveLauncher`, or delivery path.
- `app/backend/cmd/rk/riff_test.go` — renames only.
- `app/backend/internal/fabconfig/` — unchanged.

**Docs:** `docs/memory/run-kit/rk-riff.md` per §5.

**APIs/flags**: **BREAKING** — `--cmd` and `--split` are renamed. If we keep deprecated aliases they stay functional; if we hard-rename, existing scripts/aliases break. This is the reason the change is grouped at this boundary.

**Dependencies**: none new.

**Ordering caveat**: this change depends on change 1 landing first — now satisfied (change 1 merged as `f792890` on 2026-04-23).

## Open Questions

*(all intake-level questions resolved during 2026-04-23 clarification — see Clarifications section below)*

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Bundle Bug 2 + DX 1/2/3/4 into one "surface break" change; change 1 ships first (no surface change), change 3 ships after (features on stable surface) | User-specified three-change grouping | S:95 R:70 A:85 D:90 |
| 2 | Certain | Change depends on 260423-ba9f (change 1) landing first — specifically the `shellWrap` and `resolveWindowName` helpers | Temporal dependency stated in the grouping plan | S:95 R:80 A:90 D:95 |
| 3 | Certain | Rename `--cmd` to `--skill` | Clarified — user confirmed | S:95 R:65 A:75 D:70 |
| 4 | Certain | Rename `--split` to `--setup-pane` | Clarified — user confirmed | S:95 R:65 A:75 D:70 |
| 5 | Certain | Expand `Long` help text to match `serve.go:25-34` house style with Prerequisites, Examples, and exit-code table | Clarified — user confirmed | S:95 R:95 A:85 D:90 |
| 6 | Certain | Expand `Use:` synopsis to list all primary flags, not just the passthrough separator | Clarified — user confirmed | S:95 R:95 A:85 D:90 |
| 7 | Certain | DX 1 default-skill policy: option (a) status quo — keep hardcoded `/fab-discuss` as `--skill` flag default; defer per-project default-skill to change 3 (presets) | Clarified — user selected (a) on 2026-04-23 | S:95 R:55 A:55 D:45 |
| 8 | Certain | Bug 2: no code change — current `<launcher> '<escaped-cmd>'` delivery is correct; positional argv dispatches slash-commands | Clarified — verified 2026-04-23 via live smoke test (outcome (a)) | S:95 R:50 A:60 D:50 |
| 9 | Certain | DX 4 back-compat: hard-rename without deprecated aliases | Clarified — user selected (a) on 2026-04-23 | S:95 R:60 A:55 D:55 |
| 10 | Certain | Flag default for `--skill` is the hardcoded string `/fab-discuss` (status quo) — no separate config-resolution layer in this change | Clarified — consequential to #7 selection of option (a) on 2026-04-23 | S:95 R:70 A:80 D:70 |
| 11 | Certain | `claude --dangerously-skip-permissions /fab-discuss` dispatches the slash-command correctly (positional argv is routed through the skill system) | Clarified — verified 2026-04-23 via live smoke test (outcome A) | S:95 R:40 A:20 D:25 |

11 assumptions (11 certain, 0 confident, 0 tentative, 0 unresolved).

## Clarifications

### Session 2026-04-23

| # | Q | A |
|---|---|---|
| 11 | What does `claude --dangerously-skip-permissions /fab-discuss` actually do today? | Verified via live smoke test: outcome (A) — positional argv dispatches the slash-command as a skill invocation. Bug 2 is a phantom. |
| 8 | Bug 2 fix path (resolved as consequence of #11) | No code change. Current `<launcher> '<escaped-cmd>'` delivery is correct. |
| 7 | Default-skill resolution policy — (a), (b), or (c)? | (a) status quo. Keep `/fab-discuss` as hardcoded `--skill` flag default. DX 1 (onboarding landmine for non-fab users) is deferred to change 3 (presets), which has a better home for per-project default-skill configuration. |
| 10 | Flag-default vs effective-default split (consequential to #7) | Collapsed: flag default *is* the effective default (`/fab-discuss`) under policy (a). No config resolution layer. |
| 9 | DX 4 back-compat: hard-rename, or keep deprecated `--cmd`/`--split` aliases for one release? | (a) hard-rename. No aliases. rk is early, blast radius is small, and keeping aliases would undo the "break the surface once" rationale. |

### Session 2026-04-23 (bulk confirm)

| # | Action | Detail |
|---|--------|--------|
| 3 | Confirmed | — |
| 4 | Confirmed | — |
| 5 | Confirmed | — |
| 6 | Confirmed | — |
