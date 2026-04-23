# Intake: rk riff — Workflow Features

**Change**: 260423-jmwu-rk-riff-workflow-features
**Created**: 2026-04-23
**Status**: Draft

## Origin

Third and final change in the `rk riff` rework. Changes 1 (correctness) and 2 (CLI surface) establish a stable foundation; this change adds the workflow features the user starred during triage, refined through an intake clarify pass into a coherent pane-centric model:

1. **Pane arrays.** `--skill` and `--cmd` become repeatable, argv-ordered flags. Each occurrence adds a pane to the spawned tmux window. `--skill "/foo"` = claude pane with that skill preloaded; `--cmd "htop"` = shell pane running `htop`; bare `--skill` or `--cmd` = blank claude or bare shell respectively.
2. **Layouts.** A new `--layout <name>` flag picks from tmux's 5 built-in layouts (`tiled`, `even-horizontal`, `even-vertical`, `main-horizontal`, `main-vertical`), each with a shortform alias (`t`, `h`, `v`, `deck-h`, `deck-v`). Default `auto` picks a sensible layout from pane count. Inline ASCII mockups render in `rk riff -h`.
3. **Presets.** Named bundles of `skill`/`cmd`/`layout`/`wt` settings in `fab/project/config.yaml` under `riff.presets.<name>`, invoked positionally: `rk riff investigate`, `rk riff ship`. Turns riff from a flag-heavy one-off into a named-workflow launcher.
4. **`--fan-out N`.** Parallel riffs on the same task for the `fab-operator` multi-agent workflow. Spawns N worktrees + windows so the user can race or compare agents.

Two explicit non-goals surfaced during triage and confirmed during clarify:

- **No fab-change bridge.** An earlier draft proposed `--new-change "<desc>"` / `--change <id>` flags that would shell out to `fab change new` and `fab resolve`. Dropped from scope; users continue to create or attach fab changes manually via `/fab-new`, `/fab-draft`, or `fab change switch`.
- **`--setup-pane` is removed, not aliased.** Its role is fully subsumed by `--cmd` in the pane-array model.

These four features were grouped because they compose: layouts configure the pane arrays, presets declare preset pane/layout shapes, and fan-out duplicates the whole window spec across N windows. Shipping them together avoids mid-feature churn on the preset schema.

## Why

Each feature on its own is valuable; together they move `rk riff` from "flag-heavy plumbing" to a composable workflow DSL:

- **Pane arrays** generalize the current single-pane + single-setup-pane model into a uniform "window is a list of runnables." The awkward primary/secondary split disappears. Users can run two claude sessions on the same worktree (`--skill /fab-fff --skill /review`) for side-by-side comparison, or mix claude + dev server + htop + bare shell in one window.
- **Layouts** close the visual-shape gap. Pane arrays let users declare *what* runs; layouts let them declare *where*. tmux already implements the geometry, so this is a thin wrapper.
- **Presets** encode team/user conventions declaratively. Instead of typing `rk riff --skill /fab-fff --cmd "just dev" --layout deck-h -- --base main` every time, it's `rk riff ship`. Teams with more than one riff-shape benefit immediately.
- **`--fan-out N`** formalizes a workflow the user already does manually via `fab-operator`. Without it, fanning out is: run `rk riff` once per agent, retype flags each time. With it, one command.

Why now vs. later: the features interlock. Presets without pane arrays are a thin win (one skill + one setup pane per preset). Fan-out without presets means users lose the ergonomic "preset as named workflow" composition. All four benefit from change 2's stable flag names — shipping features first would rename `--cmd` after users had baked it into preset YAML.

## What Changes

### 1. Pane arrays — `--skill` and `--cmd` as repeatable flags

Both flags accept an optional value:

| Flag | Arg | Behavior |
|------|-----|----------|
| `--skill "<name>"` | skill path (e.g., `/fab-fff`) | Pane runs Claude with that skill preloaded |
| `--skill` | *(no arg)* | Pane runs a blank Claude session (no skill) |
| `--cmd "<cmd>"` | shell command | Pane runs the command |
| `--cmd` | *(no arg)* | Pane runs `$SHELL` (fallback `zsh`) — a bare shell |

Both flags are repeatable. **Argv order = pane order.** The first flag in argv becomes pane 0, the second pane 1, etc.

**Focus:** pane 0 (the first flag in argv, regardless of skill or cmd) receives focus when tmux switches to the window.

**Example:**

```
rk riff --cmd --skill "/fab-discuss" --cmd htop --skill
# Pane 0: bare zsh           (focused)
# Pane 1: claude /fab-discuss
# Pane 2: zsh running htop
# Pane 3: blank claude
```

**`--setup-pane` removal.** Change 2 introduced `--setup-pane "<cmd>"`; this change removes it entirely. `--cmd` covers the same use case with the same semantics.

**Implementation:** supporting the space-separated form (`--cmd htop`) when the flag also has to accept a bare `--cmd` (no value) requires a small custom `pflag.Value` type with next-token lookahead — ~30-50 lines. If the next token after `--cmd` / `--skill` starts with `-` or is absent, the value is empty; otherwise the next token is consumed as the value. `--cmd=htop` and `--cmd ""` both work as equivalent explicit forms.

### 2. `--layout <name>` and 5 tmux layouts

New flag; also expressible as `layout:` in a preset. Accepts:

| Canonical | Shortform | Shape |
|-----------|-----------|-------|
| `auto` | `a` | Picks based on pane count: 1 → none, 2 → `even-horizontal`, 3+ → `tiled` |
| `tiled` | `t` | Grid |
| `even-horizontal` | `h` | Panes side by side |
| `even-vertical` | `v` | Panes stacked top to bottom |
| `main-horizontal` | `deck-h` | Main pane on top, others stacked below |
| `main-vertical` | `deck-v` | Main pane on left, others stacked on the right |

Default when `--layout` is omitted: `auto`.

**Main-* alignment.** The first pane in argv (pane 0, focused) is exactly what tmux's `main-*` layouts treat as the "main" pane. No special casing — first-in-argv = focused = main.

**Validation:** Unknown names error at parse time with a list of the 12 accepted strings (6 canonical + 6 shortforms).

**Help output.** `rk riff -h` renders inline ASCII mockups for all 5 layouts plus `auto`, using Unicode box-drawing chars. Cobra's `SetUsageFunc` / `SetHelpFunc` supports this; ~40-60 lines for the art + rendering hook.

**Edge case:** `layout: main-*` with only 1 pane is a silent no-op (tmux doesn't split a single pane regardless of layout).

**Fab-style naming tension:** tmux's `main-horizontal` puts the main pane *on top* (a horizontal split between it and the rest) — counterintuitive. `deck-h` shortform uses a "deck of cards" metaphor (main card on top, stacked deck below) that reads more naturally. Both names accepted; both round-trip identically in config.

### 3. Presets in `fab/project/config.yaml`

New config block under `riff.presets.<name>`:

```yaml
# fab/project/config.yaml
riff:
    presets:
        investigate:
            layout: h
            panes:
                - { skill: "/fab-discuss" }
                - { cmd: "just dev" }
            wt_args: ["--base", "main"]

        ship:
            layout: deck-h
            panes:
                - { skill: "/fab-fff" }
                - { cmd: "just dev" }
                - { cmd: "just logs" }
            wt_args: []

        compare:
            layout: v
            panes:
                - { skill: "/fab-fff" }
                - { skill: "/review" }
```

**Location:** top-level `riff.presets.<name>`, not nested under `agent.*`. `agent.*` owns "what Claude-like tool to spawn" (`spawn_command`, `default_skill`); `riff.*` owns "how riff composes flags." Siblings, not parent/child.

**Invocation:** `rk riff <preset-name> [args...]` (positional) or `rk riff --preset <preset-name> [args...]` (named alias). The positional form is the ergonomic default; the alias exists for scripts where positional parsing is fragile. If the first positional argument matches a preset, it's consumed.

**Pane resolution when CLI panes are present:** CLI `--skill`/`--cmd` flags **replace** the preset's `panes:` entirely. Mental model: the preset sets a default pane shape; any CLI pane flag means "I'm redefining the shape." Keeps semantics aligned with the flag-precedence rules below.

**Flag resolution order** (effective values):

1. Explicit CLI flag (e.g., `--skill`, `--cmd`, `--layout`).
2. Preset value (if a preset is invoked).
3. `agent.default_skill` from config (introduced in change 2).
4. Built-in default (empty / `auto`).

For array-valued flags (`panes`, `wt_args`): CLI replaces preset; preset replaces built-in.

**`internal/fabconfig` changes:** add `ReadPresets(root string) map[string]Preset` alongside existing `ReadSpawnCommand` / `ReadDefaultSkill`. Same best-effort-never-errors posture — malformed YAML yields an empty map, logged but never fatal.

**Listing presets:** `rk riff --list-presets` prints preset names and their resolved values in plain text, then exits 0. No `--json` flag in this change — add later only if a scripting consumer appears.

### 4. `--fan-out N`

Spawn N riffs in parallel.

**Semantics:**

- **N separate windows,** each with the full resolved pane shape (panes + layout + wt_args). Consistent with the "one worktree = one window" mental model.
- **Worktree naming:** each `wt create` invocation is independent, so each worktree gets its own random adjective-noun name from `wt`'s generator (e.g., `swift-fox`, `clever-crab`, `brave-bear`). Rk does not impose a `-1..-N` suffix scheme on top of `wt`.
- **Window naming:** each tmux window is named `riff-<wt-name>` (e.g., `riff-swift-fox`). Derived from `wt`'s output, no rk-side numbering.
- **Pane shape uniformity:** all N windows share the same pane shape. `rk riff --fan-out 3 --skill /fab-fff --cmd "just dev"` = 3 windows × 2 panes each = 6 total panes. Users wanting different shapes per agent run `rk riff` N times manually.
- **Concurrency:** parallel `wt create` via goroutines; aggregate errors. If any `wt create` fails, clean up the successful ones (partial-failure rollback). 30s × N serial is too slow.

**No coupling to fab-change:** `--fan-out` does not create or attach fab changes (consistent with the bridge being dropped).

**Example:**

```
rk riff --fan-out 3 --skill /fab-fff --cmd "just dev" --layout deck-h
# spawns 3 worktrees (wt picks names: e.g., swift-fox, clever-crab, brave-bear)
# opens 3 tmux windows: riff-swift-fox, riff-clever-crab, riff-brave-bear
# each window has 2 panes (claude /fab-fff main, just dev deck), layout deck-h
```

### 5. Wire presets → `--list-presets`

Add a flag `--list-presets` (boolean) that prints resolved preset names and their values in plain text, then exits 0. Useful for discoverability; avoids the "what presets does this project have?" question.

## Affected Memory

- `run-kit/rk-riff.md`: (modify) — new sections for pane arrays, layouts (with ASCII mocks), presets config format, `--fan-out`. Updated flag table. Workflow Step Order updates for each path. Non-goal callouts (no fab-change bridge, `--setup-pane` removed). Changelog entry.
- `run-kit/tmux-sessions.md`: (modify) — document the N-window fan-out layout and `riff-<wt-name>` naming pattern.

No new memory files needed.

## Impact

**Code:**
- `app/backend/cmd/rk/riff.go` — major: custom flag type for `--skill`/`--cmd` lookahead; pane-array resolution; layout flag + shortform map + validator; preset resolution (CLI replaces preset); fan-out orchestration (parallel goroutines + rollback); `--list-presets` output; `--setup-pane` removal; inline layout mocks in help.
- `app/backend/cmd/rk/riff_test.go` — new tests: pane-array argv parsing (bare flag, space form, `=` form), layout validator + shortform resolution, preset resolution (replace semantics), fan-out argv construction, `--list-presets` output format.
- `app/backend/internal/fabconfig/fabconfig.go` — new `ReadPresets` + `Preset`, `PaneSpec` structs. Typed `panes: [...]` parsing.
- `app/backend/internal/fabconfig/fabconfig_test.go` — preset parsing cases (empty, malformed, partial, typed panes, shell-string wt_args, layout field).
- `app/backend/cmd/rk/context.go` — if `rk context` output lists commands, keep it in sync.
- `app/backend/cmd/rk/layout_help.go` *(new file, optional split)* — ASCII mock rendering for `-h`. Extracted for readability.

**Docs:** `docs/memory/run-kit/rk-riff.md` and `docs/memory/run-kit/tmux-sessions.md` per §§ above.

**APIs/flags:**
- **Added:** `--skill` (repeatable, optional value), `--cmd` (repeatable, optional value), `--layout <name>`, `--fan-out N`, `--list-presets`, `--preset <name>`, positional preset name.
- **Removed:** `--setup-pane` (use `--cmd` instead).
- **Behavior change:** `--skill` was singular in change 2; now repeatable. Single-use calls (`rk riff --skill /foo`) still work — just produce a 1-pane window.

**Dependencies:** none new. `rk riff` does not shell out to `fab` in this change — no `fab` precondition check.

**Ordering:** depends on change 2 landing first for stable flag names and the `agent.default_skill` config key. (Change 2 has landed.)

## Open Questions

None blocking at intake stage. All design questions were resolved during clarify (see Clarifications log). Spec-stage questions that remain:

- Exact `--list-presets` output layout (table vs indent vs bullet) — spec-stage detail.
- Error-message formatting for unknown `--layout` / unknown preset / malformed preset YAML — follow existing `fabconfig` best-effort patterns, exact wording TBD in spec.
- `layout: main-*` with 1 pane: silent no-op or warning? Lean silent. Spec-stage detail.

## Clarifications

### Session 2026-04-23

| Area | Action | Detail |
|------|--------|--------|
| Scope | Dropped | Entire fab-change bridge (both `--new-change` and `--change <id>`). Removes the `fab`-shell-out dependency and associated assumptions. |
| Scope | Added | Pane arrays: `--skill` / `--cmd` repeatable, argv order = pane order, bare flag = empty. |
| Scope | Added | Layouts: `--layout` flag with 5 tmux layouts + 6 shortforms (`a`/`t`/`h`/`v`/`deck-h`/`deck-v`) + `auto` default. |
| Scope | Added | Inline ASCII layout mocks in `rk riff -h`. |
| Scope | Removed | `--setup-pane` removed entirely (not aliased); `--cmd` subsumes it. |
| Panes | Decided | First pane in argv gets focus, regardless of type. |
| Panes | Decided | Custom flag type (~30-50 lines) supports space-form (`--cmd htop`) alongside bare flag. |
| Fan-out | Decided | Each of N windows gets the full pane shape (panes + layout duplicated). |
| Fan-out | Decided | Worktree naming delegates to `wt create` (no rk-side `-1..-N` suffix). |
| Fan-out | Decided | tmux windows named `riff-<wt-name>`. |
| Presets | Decided | Location: top-level `riff.presets.<name>`, not under `agent.*`. |
| Presets | Decided | Invocation: positional (`rk riff investigate`) + `--preset <name>` alias for scripts. |
| Presets | Decided | Schema: typed ordered list `panes: [ {skill|cmd: ...} ]`, plus optional `layout:` and `wt_args:`. |
| Presets | Decided | CLI panes replace preset panes entirely (not append). |
| Presets | Decided | `--list-presets` emits plain text; no `--json` in this change (YAGNI). |

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Ship pane arrays + layouts + presets + fan-out in one change; depends on changes 1 and 2 | User-confirmed scope across multi-turn clarify; features compose on the preset schema | S:95 R:65 A:85 D:90 |
| 2 | Certain | No fab-change bridge; `rk riff` does not shell out to `fab change new` / `fab resolve` | Clarified — user dropped the entire bridge feature from scope | S:95 R:50 A:85 D:90 |
| 3 | Certain | `--setup-pane` removed entirely; `--cmd` subsumes it | Clarified — user explicitly requested removal (not alias) | S:95 R:55 A:85 D:90 |
| 4 | Certain | `--skill` / `--cmd` are repeatable, argv order = pane order | Clarified — user designed the syntax inline with a concrete example | S:95 R:60 A:85 D:90 |
| 5 | Certain | Bare `--skill` / `--cmd` (no value) = blank claude / bare shell respectively | Clarified — user's example specified this semantics | S:95 R:65 A:85 D:90 |
| 6 | Certain | First pane in argv gets focus, regardless of skill/cmd type | Clarified — user chose "first irrespective of type" | S:95 R:80 A:85 D:85 |
| 7 | Certain | Fan-out worktree naming delegates to `wt create` (no rk-side `-1..-N` suffix) | Clarified — user chose "delegate to wt" | S:95 R:60 A:70 D:60 |
| 8 | Certain | tmux windows named `riff-<wt-name>` (derived from wt's output) | Clarified — user accepted recommendation; avoids rk-side numbering | S:95 R:75 A:80 D:75 |
| 9 | Certain | `--list-presets` emits plain text; no `--json` flag in this change | Clarified — user confirmed YAGNI for structured output | S:95 R:85 A:75 D:65 |
| 10 | Certain | Preset location: top-level `riff.presets.<name>` | Clarified — user accepted recommendation; keeps `agent.*` focused | S:95 R:75 A:80 D:80 |
| 11 | Certain | Preset invocation: positional + `--preset <name>` alias for scripts | Clarified — user accepted recommendation | S:95 R:75 A:80 D:80 |
| 12 | Certain | Preset schema: typed ordered `panes: [ {skill|cmd: ...} ]` list | Clarified — user confirmed typed list preserves CLI argv ordering | S:95 R:70 A:80 D:85 |
| 13 | Certain | CLI panes replace preset panes entirely (not append) | Clarified — user accepted recommendation; matches flag-precedence rules | S:95 R:70 A:80 D:85 |
| 14 | Certain | Layout flag accepts 5 tmux names + 6 shortforms + `auto`; default `auto` | Clarified — user proposed shortform map, confirmed inline | S:95 R:75 A:90 D:85 |
| 15 | Certain | `auto` layout: 1 pane → none, 2 → `even-horizontal`, 3+ → `tiled` | Clarified — user accepted recommendation | S:95 R:85 A:85 D:80 |
| 16 | Certain | Layout help shows inline ASCII mocks in `rk riff -h` (all 5 + auto) | Clarified — user chose inline over dedicated `--help-layouts` | S:95 R:85 A:80 D:80 |
| 17 | Certain | Fan-out = N separate windows, each with full pane shape | Clarified — user confirmed during pane-array design | S:95 R:65 A:80 D:80 |
| 18 | Confident | Flag resolution order: explicit flag > preset > config default > built-in | Standard precedence convention for CLI tools with presets | S:80 R:75 A:80 D:80 |
| 19 | Confident | Extract `spawnRiff(ctx, opts) error` helper so fan-out calls it N times | Avoids duplicating the spawn sequence; clean test seam | S:80 R:85 A:85 D:85 |
| 20 | Confident | Fan-out uses parallel goroutines for `wt create`, aggregates errors, rollback on failure | 30s × N serial is too slow; parallel is the obvious stdlib pattern | S:75 R:75 A:80 D:75 |
| 21 | Confident | Custom `pflag.Value` type (~30-50 lines) supports space form with optional values | Required for `--cmd htop` + bare `--cmd` to both work; alternative (`=` only) hurts UX | S:75 R:80 A:85 D:75 |
| 22 | Confident | No new positional args besides the preset name | Keeps command shape predictable; leaves room for future features | S:75 R:70 A:75 D:70 |

22 assumptions (17 certain, 5 confident, 0 tentative, 0 unresolved).
