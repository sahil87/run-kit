# Intake: rk riff — CLI Surface Refinement

**Change**: 260423-udhe-rk-riff-cli-surface
**Created**: 2026-04-23
**Status**: Draft

## Origin

Second change in the three-change `rk riff` rework. The first change (`260423-ba9f-rk-riff-correctness-fixes`) handles mechanical bug fixes with no CLI surface impact. This change consolidates every CLI-visible refinement into one "break the surface once" PR before features land on top.

Items covered (from the prior triage):

- **Bug 2** — `/fab-discuss` passed as positional argv to `claude` rather than typed into the REPL; may require switching from the inline tmux-shell arg to `tmux send-keys`. Whether this is actually broken depends on current `claude` CLI behavior — must verify before designing the fix.
- **DX 1** — Default `--cmd=/fab-discuss` is broken-by-default for users without fab-kit. Policy decision: fall back to empty when no fab config, or make the default itself configurable.
- **DX 2** — `Long` help text mentions neither preconditions nor the default command nor launcher resolution; compare `serve.go:25-34` for house style.
- **DX 3** — `Use: "riff [-- wt-flags...]"` hides `--cmd` and `--split` from the synopsis line.
- **DX 4** — Flag names `--cmd` and `--split` are generic. Rename to more descriptive names (e.g., `--skill`, `--setup-pane`).

Why these four belong together: any one of them alone is a CLI-surface change that breaks muscle memory and requires users to update scripts/aliases/docs. Bundling them into one break minimizes pain and lets users learn the new surface once.

## Why

The main user-impact argument: `rk riff` today leaks its author's private workflow through defaults, flag names, and silent rc-file assumptions. If rk is to be installed by anyone outside the author's immediate context, the surface needs to stop surprising strangers:

- **Bug 2 is an unknown** — we do not currently know whether `claude ... /fab-discuss` as positional argv even invokes the slash command, or just drops into an empty REPL. If it's broken, the default has been silently useless since the feature landed. **Verification step is the first task.** If broken, the fix is likely `tmux new-window` (bare shell) + `tmux send-keys '<cmd>' Enter` after confirming the launcher has started.
- **DX 1 (broken default)** — `/fab-discuss` assumes fab-kit is installed. A user who `brew install rk` and runs `rk riff` gets a Claude session that immediately hits an unknown slash-command. This is the single biggest onboarding landmine.
- **DX 2 and 3 (help text)** — pure ergonomics; the help output should tell a new user what they need and how. Compare `serve.go:25-34` — it enumerates env vars and gives examples; riff's help is a two-line stub.
- **DX 4 (flag names)** — a one-time rename is cheaper than living with confusing names forever. `--cmd` is especially bad (ambiguous: shell command? claude command? REPL input?). `--skill` is more honest (it's a Claude Code slash-command / skill).

Why renaming once, here, and not later: once presets (change 3) reference flag names in config, renames get more expensive. Settle the surface now.

## What Changes

### 1. Verify and fix Bug 2 — `/fab-discuss` delivery mechanism

**Verification-first:** before deciding the fix, run `claude --help` (or the equivalent for whatever binary `agent.spawn_command` resolves to) and confirm what happens when a slash-command is passed as a positional argv. Two possible outcomes:

- **(a) Positional arg IS interpreted as initial prompt and fires the slash-command** — current behavior is correct, no fix needed for this bug. Mark it as investigated-and-ruled-out, update the spec's Changelog.
- **(b) Positional arg is NOT interpreted, or is sent as literal prompt text with no slash-handling** — the current implementation is silently broken. Fix by changing delivery from "pass as argv" to "launch launcher, then send keys":

  ```go
  // NEW delivery path:
  // 1. tmux new-window -n <name> -c <path> '<launcher>'   (no quoted cmd arg)
  // 2. wait for the launcher to be ready (fixed short delay, e.g., 800ms — launcher
  //    start time. Or poll tmux capture-pane output for a readiness marker.)
  // 3. tmux send-keys -t <window> '<cmd>' Enter
  ```

  The send-keys approach handles any Claude Code command (skills, slash commands, arbitrary prompts) uniformly; the current approach only works if `claude` happens to interpret `argv[1]` as a prompt.

**[NEEDS CLARIFICATION]** the verification result (a vs b) and, if (b), whether we use a fixed delay or poll `tmux capture-pane`. Default recommendation: fixed 800ms delay — it matches the typical launcher start time and is the simplest correct implementation.

### 2. Rename `--cmd` → `--skill` and `--split` → `--setup-pane`

Cobra supports deprecated flag aliases. Two sub-questions:

- **Do we keep `--cmd` and `--split` as hidden deprecated aliases?** [NEEDS CLARIFICATION] — user input requested. Recommendation: hard-rename (rk is early; no external muscle memory to protect). If we do keep aliases, wire them via `pflag.Flag.Deprecated` so `--help` hides them and using them prints a deprecation warning.

Updated flag definitions (sketch):

```go
riffCmd.Flags().StringVar(&riffSkillFlag, "skill", "", "Claude Code skill or slash-command to run in the new window (e.g., /fab-discuss)")
riffCmd.Flags().StringVar(&riffSetupPaneFlag, "setup-pane", "", "If non-empty, split the window and run this setup command in the right pane")
```

Rename in internal code: `riffCmdFlag` → `riffSkillFlag`, `riffSplitFlag` → `riffSetupPaneFlag`. Tests updated accordingly.

### 3. Default `--skill` resolution policy (DX 1)

**[NEEDS CLARIFICATION]** — three candidate policies, user must pick:

- **(a)** Keep `/fab-discuss` as the hardcoded default (status quo).
- **(b)** Default to empty when no `fab/project/config.yaml` is detected; `/fab-discuss` only when fab is present.
- **(c)** Move the default itself to `fab/project/config.yaml` under a new key like `agent.default_skill` (or `riff.default_skill`), with a built-in fallback of empty.

Recommendation: (c) — composes naturally with the presets feature (change 3), and lets each project own its defaults. This means:

```yaml
# fab/project/config.yaml
agent:
    spawn_command: claude --dangerously-skip-permissions ...
    default_skill: /fab-discuss      # new
```

`internal/fabconfig` grows a `ReadDefaultSkill(root string) string` function, same shape as `ReadSpawnCommand`. Empty return means no default. `runRiff` resolves the effective skill in this order: explicit `--skill` flag → config `agent.default_skill` → empty.

If the user picks (b) instead, the flag default stays `/fab-discuss` but flipping to empty happens based on whether `fab/project/config.yaml` was readable. (b) is simpler but less extensible.

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

- `docs/memory/run-kit/rk-riff.md` — update every reference to `--cmd`/`--split`, the flag table, the flag-surface section, and the Changelog. Add a section on default-skill resolution and, if Bug 2 required a delivery change, update the "Workflow Step Order" to reflect the send-keys approach.
- `app/backend/cmd/rk/riff_test.go` — rename test variables/cases to match new flag names; add a test for default-skill resolution (if policy c); update `TestBuildNewWindowArgs` if Bug 2 delivery changed.
- `app/backend/internal/fabconfig/fabconfig.go` + test — add `ReadDefaultSkill` (if policy c).

## Affected Memory

- `run-kit/rk-riff.md`: (modify) — flag renames, default-skill policy, Long text rewrite, Use synopsis update, Changelog entry. If Bug 2 required a delivery-mechanism change, update "Workflow Step Order" accordingly.

## Impact

**Code:**
- `app/backend/cmd/rk/riff.go` — flag renames, `runTmuxNewWindow` delivery change (conditional on Bug 2 verification), resolveLauncher / effective-skill resolution, help text, possibly a helper for `tmux send-keys`.
- `app/backend/cmd/rk/riff_test.go` — renames + new test cases for default-skill resolution and (if applicable) the send-keys flow.
- `app/backend/internal/fabconfig/fabconfig.go` — new `ReadDefaultSkill` function (if policy c).
- `app/backend/internal/fabconfig/fabconfig_test.go` — tests for `ReadDefaultSkill`.

**Docs:** `docs/memory/run-kit/rk-riff.md` per §5.

**APIs/flags**: **BREAKING** — `--cmd` and `--split` are renamed. If we keep deprecated aliases they stay functional; if we hard-rename, existing scripts/aliases break. This is the reason the change is grouped at this boundary.

**Dependencies**: none new. `tmux send-keys` (if Bug 2 path) is just another tmux subprocess call.

**Ordering caveat**: this change depends on change 1 landing first because change 1 introduces `shellWrap` and the window-name-suffix helper, both of which survive into this change's code unchanged.

## Open Questions

- **Bug 2 verification** — what does `claude /fab-discuss` (as positional arg) actually do today? Need a one-command smoke test. This determines whether the delivery-mechanism change ships or not.
- **DX 1 default-skill policy** — pick (a), (b), or (c). Recommendation: (c).
- **DX 4 back-compat aliases** — hard-rename or keep deprecated `--cmd`/`--split` aliases for one release? Recommendation: hard-rename (rk is early).
- **Bug 2 readiness signal** (only relevant if we go down the send-keys path) — fixed delay, or poll `tmux capture-pane`? Recommendation: fixed delay (800ms) for simplicity.
- Should `tmux send-keys` escape the `--skill` value any differently than `escapeSingleQuotes` already does? send-keys uses tmux's own parsing, which has different rules than shell single-quoting. Needs a short investigation in the spec.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Bundle Bug 2 + DX 1/2/3/4 into one "surface break" change; change 1 ships first (no surface change), change 3 ships after (features on stable surface) | User-specified three-change grouping | S:95 R:70 A:85 D:90 |
| 2 | Certain | Change depends on 260423-ba9f (change 1) landing first — specifically the `shellWrap` and `resolveWindowName` helpers | Temporal dependency stated in the grouping plan | S:95 R:80 A:90 D:95 |
| 3 | Confident | Rename `--cmd` to `--skill` | `--cmd` is ambiguous (shell cmd? claude cmd?); `--skill` matches Claude Code terminology and the default value's nature | S:75 R:65 A:75 D:70 |
| 4 | Confident | Rename `--split` to `--setup-pane` | `--split` reads as a boolean; current value is a setup command for a pane. `--setup-pane` encodes intent | S:75 R:65 A:75 D:70 |
| 5 | Confident | Expand `Long` help text to match `serve.go:25-34` house style with Prerequisites, Examples, and exit-code table | Pure ergonomics; low-risk pattern already established elsewhere in the codebase | S:85 R:95 A:85 D:90 |
| 6 | Confident | Expand `Use:` synopsis to list all primary flags, not just the passthrough separator | Standard CLI convention; every other rk subcommand already does this | S:85 R:95 A:85 D:90 |
| 7 | Tentative | Default-skill resolution policy: option (c) — move default to `fab/project/config.yaml`'s `agent.default_skill` key with empty built-in fallback | Composes with presets feature; three policy options are all valid but user input required | S:55 R:55 A:55 D:45 |
| 8 | Tentative | Bug 2 fix path: verify first, then if broken switch to `tmux new-window` + `tmux send-keys` with 800ms fixed delay | Verification outcome unknown; delay-based readiness is the simplest correct approach if switch is needed | S:40 R:50 A:60 D:50 |
| 9 | Tentative | DX 4 back-compat: hard-rename without deprecated aliases | rk is early; low blast radius — but a case can be made for aliases during the 1.x window | S:55 R:60 A:55 D:55 |
| 10 | Confident | Default value of `--skill` flag itself is empty string; actual default comes from config resolution chain | Separates "flag defaulting" from "effective value resolution" cleanly | S:75 R:70 A:80 D:70 |
| 11 | Unresolved | What does `claude --dangerously-skip-permissions /fab-discuss` actually do today (positional argv → slash command or no-op)? | Asked — user has not verified; blocks design of the Bug 2 fix path | S:15 R:40 A:20 D:25 |

11 assumptions (2 certain, 5 confident, 3 tentative, 1 unresolved).
