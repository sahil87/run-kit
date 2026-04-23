# Intake: rk riff — Workflow Features

**Change**: 260423-jmwu-rk-riff-workflow-features
**Created**: 2026-04-23
**Status**: Draft

## Origin

Third and final change in the `rk riff` rework. Changes 1 (correctness) and 2 (CLI surface) establish a stable foundation; this change adds the three workflow features the user starred during triage as compounding wins:

1. **Feature 1 — fab-change bridge.** `rk riff --new-change "<desc>"` or `--change <id>` creates/attaches a fab change folder alongside the worktree and tmux window in one shot. Today the sequence is: user runs `rk riff`, then inside Claude runs `/fab-new` or `/fab-draft`. This inverts it so the change is created up front.
2. **Feature 2 — Presets.** Named bundles of `--skill`/`--setup-pane`/`wt` flags in `fab/project/config.yaml` under `riff.presets.<name>`, invoked positionally: `rk riff investigate`, `rk riff ship`, `rk riff fff`. Turns riff from a flag-heavy one-off into a named-workflow launcher.
3. **Feature 3 — `--fan-out N`.** Parallel riffs on the same task for the `fab-operator` multi-agent workflow. Spawns N worktrees + windows so the user can race or compare agents.

These three were grouped because they compound: presets should reference the fab-change bridge (a preset can embed `--new-change "<desc>"`), and fan-out can consume a preset (`rk riff --fan-out 3 investigate`). Shipping them together avoids mid-feature churn.

## Why

Each feature on its own is valuable; together they move `rk riff` from "flag-heavy plumbing" to a composable workflow DSL. Concretely:

- **Fab-change bridge** closes a manual-step gap. The user already creates a change for nearly every `rk riff` they spawn; automating it saves 30 seconds per invocation and avoids the "oh, I forgot to make a change" error case. It also makes worktree name → change folder name → branch name alignment automatic (all three derive from a single slug).
- **Presets** encode team/user conventions declaratively. Instead of typing `rk riff --skill /fab-fff --setup-pane "just dev" -- --base main` every time, it's `rk riff ship`. Teams with more than one riff-shape benefit immediately. Presets are also the natural extension point for future features (e.g., a preset can one day include a `--layout` shape).
- **`--fan-out N`** formalizes a workflow the user already does manually via `fab-operator`. Without it, fanning out is: run `rk riff` once per agent, type flags each time, remember to vary worktree names. With it, one command.

Why now vs. later: the three features interlock. If presets ship without the fab-change bridge, they can't embed "create a change." If fan-out ships without presets, users lose the ergonomic win. And all three benefit from the stable flag names that change 2 settles — if we shipped features first, we'd rename `--cmd` after users have baked it into their preset YAML.

## What Changes

### 1. Fab-change bridge — `--new-change "<desc>"` and `--change <id>`

Two new mutually-exclusive flags:

| Flag | Arg | Behavior |
|------|-----|----------|
| `--new-change "<desc>"` | quoted description | Creates a new fab change via `fab change new --slug <slugified-desc> --log-args "<desc>"`, captures the resulting folder name, passes it to `wt create` as the branch name so `wt` uses the fab-change folder name as the branch. |
| `--change <id>` | 4-char change ID or folder substring | Resolves to an existing change folder via `fab resolve --folder <id>`. Passes the resolved folder name to `wt create` as the branch name. If the change has an associated worktree already, errors unless `-- --reuse` is passed. |

**Shell-out entry points:** use the `fab` CLI that's already installed (confirmed present — this project is fab-based). For `--new-change`, shell out to `fab change new --slug <slug> --log-args <desc>` and capture stdout (which is the folder name). For `--change`, shell out to `fab resolve --folder <arg>` and capture stdout.

**[NEEDS CLARIFICATION]** whether the bridge also calls `/fab-draft` or `/fab-new` inside the spawned Claude session. Two options:

- **(a)** Just create the folder on disk; the user runs `/fab-new` themselves inside the Claude session.
- **(b)** Auto-prefill `--skill` with `/fab-new` and pass the description as an initial-prompt continuation (requires the send-keys delivery from change 2).

Recommendation: (a) for simplicity. (b) can be layered via a preset once presets are available.

**Slugification** for `--new-change`: mirror whatever `fab change new --slug` already normalizes (likely lowercase, kebab-case, drop articles). If the user's description contains more than ~6 words, truncate. Pure helper, test seam.

**Example:**

```
rk riff --new-change "investigate flaky user-auth test" --skill /fab-discuss
# → creates fab/changes/260423-xxxx-investigate-flaky-user-auth/
# → creates worktree on branch 260423-xxxx-investigate-flaky-user-auth
# → opens tmux window riff-260423-xxxx-investigate-flaky-user-auth (or truncated)
# → launches claude /fab-discuss in that window
```

### 2. Presets in `fab/project/config.yaml`

New config block under `riff.presets.<name>`:

```yaml
# fab/project/config.yaml
riff:
    presets:
        investigate:
            skill: /fab-discuss
            setup_pane: ""
            wt_args: ["--base", "main"]
        ship:
            skill: /fab-fff
            setup_pane: "just dev"
            wt_args: []
        fff:
            skill: /fab-fff
            new_change_from_positional: true   # positional arg becomes --new-change value
```

**Invocation:** `rk riff <preset-name> [args...]`. The preset name is positional (before `--`). If the first positional argument matches a preset, it's consumed; remaining args are merged as follows:

- Flags explicitly passed override preset values (`rk riff ship --skill /review` overrides preset skill).
- `wt_args` from preset are prepended to `--` passthrough; user passthrough wins on conflict.
- If preset sets `new_change_from_positional: true`, the next positional arg becomes the `--new-change` description: `rk riff fff "add oauth flow"`.

**Resolution order** (effective flag values):

1. Explicit `--skill` / `--setup-pane` / `--new-change` on the command line.
2. Preset values (if a preset is invoked).
3. `agent.default_skill` from config (introduced in change 2 if policy (c)).
4. Built-in default (empty).

**`internal/fabconfig` changes:** grow `ReadPresets(root string) map[string]Preset` alongside the existing `ReadSpawnCommand` / `ReadDefaultSkill`. Same best-effort-never-errors pattern.

**Listing presets:** `rk riff --list-presets` prints the preset names and their resolved values. Nice-to-have; belongs in this change.

**Conflict with fab-change bridge:** presets can themselves include `new_change_from_positional` or a literal `new_change: true` — the bridge triggers whether from preset or flag.

### 3. `--fan-out N`

Spawn N riffs in parallel.

**[NEEDS CLARIFICATION]** semantics — must resolve before spec:

- **Window vs pane layout:** N separate windows (each `riff-<name>-i`), or one window with N panes tiled? Recommendation: N separate windows. Consistent with the "one worktree = one window" mental model.
- **Worktree naming:** auto-suffix `-1`, `-2`, …, `-N`? Or use `wt create` N times and let `wt` assign names, then rename? Recommendation: auto-suffix from a base (derived from the slug or preset name), so all N have an obvious relationship.
- **Same `--skill` for all, or different?** Recommendation: same skill for all (that's the fan-out model — same task, different agents). If users want different skills, they run `rk riff` N times manually.
- **Parallel vs sequential `wt create`?** 30s timeout × N serialized = slow. Recommendation: parallel via goroutines; aggregate errors. If any `wt create` fails, clean up the successful ones (match the partial-failure rollback behavior discussed for the correctness change — but this change doesn't depend on that since it's its own code path).

**Interaction with `--new-change`:** when fanning out a new change, all N worktrees share the same fab change (one change folder, N worktrees/branches on top). The branches are named `<change-folder>-1`, `<change-folder>-2`, etc. [NEEDS CLARIFICATION] — alternatively, each gets its own change folder. Recommendation: one change, N branches (simpler; matches the "compare agents on the same task" use case).

**Example:**

```
rk riff --fan-out 3 --new-change "try oauth approaches" --skill /fab-fff
# creates one change folder
# creates 3 worktrees on 3 branches
# opens 3 tmux windows
# launches /fab-fff in all 3
```

### 4. Wire presets → `--list-presets`

Add a flag `--list-presets` (boolean) that prints the resolved preset names and their values, then exits 0. Useful for discoverability; avoids the "what presets does this project have?" question.

## Affected Memory

- `run-kit/rk-riff.md`: (modify) — new sections for fab-change bridge, presets config format, `--fan-out`, updated flag table, Workflow Step Order updates for each path, Changelog entry.
- `run-kit/tmux-sessions.md`: (modify) — document the N-window fan-out layout if it affects how sessions enumerate riff-prefixed windows.

No new memory files needed; everything lives under the existing `rk-riff.md`.

## Impact

**Code:**
- `app/backend/cmd/rk/riff.go` — three new code paths (fab bridge, preset resolution, fan-out). Likely grows enough that a helper extraction is warranted — specifically: extract the "single riff" spawn sequence into `spawnRiff(ctx, opts) error` so `--fan-out` can call it N times in a goroutine pool.
- `app/backend/cmd/rk/riff_test.go` — new tests for preset resolution, fan-out argv construction, slugification helper.
- `app/backend/internal/fabconfig/fabconfig.go` — new `ReadPresets` + `Preset` struct.
- `app/backend/internal/fabconfig/fabconfig_test.go` — preset parsing cases (empty, malformed, partial, shell-string wt_args).
- `app/backend/cmd/rk/context.go` — if `rk context` output lists commands, keep it in sync.

**Docs:** `docs/memory/run-kit/rk-riff.md` per §§ above.

**APIs/flags**: additive — `--new-change`, `--change`, `--fan-out`, `--list-presets`, plus positional preset name. No removals. No rename of the base flags (those shipped in change 2).

**Dependencies**: shell-out to `fab change new` and `fab resolve`. These are already assumed present in this project (it's a fab repo); `rk riff` SHOULD detect `fab` on PATH and fail gracefully if absent (same posture as the current `wt` check). [NEEDS CLARIFICATION] — do we add a `fab` precondition check, or only error when the user tries `--new-change` / `--change`? Recommendation: detect lazily (only when the fab bridge is invoked) so non-fab users are unaffected.

**Ordering**: depends on change 2 landing first for stable flag names and (if policy (c)) the `agent.default_skill` config key.

## Open Questions

- **Fan-out layout:** N windows or one window with N panes? Rec: N windows.
- **Fan-out worktree naming:** suffix `-1`..`-N` from a base, or delegate to `wt`? Rec: suffix from base.
- **Fan-out change mapping:** one change / N branches, or N changes? Rec: one change / N branches.
- **Parallel vs sequential `wt create` in fan-out:** parallel? Rec: parallel goroutines with aggregated errors.
- **Fab-bridge delivery:** just create folder (rec a), or auto-run `/fab-new` inside Claude (b)?
- **`fab` CLI precondition:** preflight check, or lazy detection? Rec: lazy.
- **Preset schema:** is `riff.presets.<name>` the right location, or should it live under `agent.riff.presets`? Rec: top-level `riff.presets`, keeps the agent block focused on the spawn command.
- **Positional preset arg vs `--preset <name>`:** positional is more ergonomic, but clashes with future positional uses. Rec: positional with a `--preset` alias for scripts.
- **`--list-presets` format:** plain text, YAML echo, or `--json`? Rec: plain text by default, add `--json` if/when scripting need arrives.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Ship fab-change bridge, presets, and fan-out in one change; depends on changes 1 and 2 | User-specified three-change grouping; features interlock | S:95 R:65 A:85 D:90 |
| 2 | Certain | Shell out to `fab change new` / `fab resolve` rather than reimplementing change management | Constitution §III: Wrap, Don't Reinvent | S:95 R:85 A:95 D:95 |
| 3 | Confident | Preset config lives at `riff.presets.<name>` in `fab/project/config.yaml` | Namespaces cleanly away from `agent.*`; preserves the "riff is one feature of rk" framing | S:75 R:70 A:75 D:70 |
| 4 | Confident | Presets are positional (`rk riff investigate`) with a `--preset` alias for scripts | Positional is ergonomic for CLI use; named flag for scripts and discoverability | S:70 R:65 A:75 D:65 |
| 5 | Confident | Resolution order: explicit flags > preset > config default > built-in default | Standard precedence convention for CLI tools with presets | S:80 R:75 A:80 D:80 |
| 6 | Confident | Extract a `spawnRiff(ctx, opts) error` helper so fan-out can call it N times | Avoids duplicating the full spawn sequence; clean test seam | S:80 R:85 A:85 D:85 |
| 7 | Confident | Fan-out spawns N separate windows (not one window with N panes) | Matches "one worktree = one window" model; presets and tmux-sessions memory already assume this | S:75 R:70 A:70 D:70 |
| 8 | Confident | Fan-out uses parallel goroutines for `wt create`, aggregates errors, cleans up successful ones on failure | 30s × N serial is too slow; parallel is the obvious stdlib pattern | S:70 R:75 A:80 D:75 |
| 9 | Confident | `--new-change` slug is derived via the same rules `fab change new --slug` already applies | Avoids drift between fab and rk slugification | S:80 R:85 A:90 D:85 |
| 10 | Confident | Detect `fab` on PATH lazily — only error when `--new-change` / `--change` is invoked | Non-fab users should be unaffected; follows the `wt` precondition pattern already in place | S:75 R:80 A:85 D:80 |
| 11 | Tentative | Fab-bridge does NOT auto-run `/fab-new` inside Claude — it just creates the folder. User picks (a) over (b) | Simpler; (b) can be implemented as a preset later. Recommendation pending user confirmation | S:55 R:55 A:55 D:50 |
| 12 | Tentative | Fan-out worktree naming: base + `-1`..`-N` suffix from the preset/change slug | Simple; keeps related worktrees adjacent in `wt list`. Alternative delegations to `wt` also work | S:55 R:55 A:60 D:50 |
| 13 | Tentative | Fan-out change mapping: one fab change, N branches | Matches the "compare agents on the same task" use case. Alternative (N changes) is also defensible | S:55 R:50 A:60 D:50 |
| 14 | Tentative | `--list-presets` emits plain text; add `--json` later only if scripting need emerges | YAGNI for structured output until a real consumer appears | S:60 R:85 A:75 D:65 |
| 15 | Confident | No new positional arg besides the preset name and the optional `--new-change` description; everything else is flags | Keeps the command shape predictable and leaves room for future features | S:75 R:70 A:75 D:70 |

15 assumptions (2 certain, 9 confident, 4 tentative, 0 unresolved).
