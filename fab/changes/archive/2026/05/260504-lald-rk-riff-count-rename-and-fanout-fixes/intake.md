# Intake: rk riff — `--count` rename and fan-out correctness fixes

**Change**: 260504-lald-rk-riff-count-rename-and-fanout-fixes
**Created**: 2026-05-04
**Status**: Draft

## Origin

Identified during a `/fab-discuss` session re-examining `rk riff` flag ergonomics. The user asked whether `--fan-out N` could be replaced with a simpler `--count` / `-N` form, and noted that fan-out "doesn't work today." Repro in this worktree (commit `ab92fd4`, branch `bold-moose`, freshly built `rk` binary from `app/backend/cmd/rk`) confirmed three concrete defects:

1. `tmux select-pane -t <window>.0` (riff.go:670) hardcodes pane index `0`. The local tmux server has `pane-base-index 1` (a very common configuration); the call fails with `can't find pane: 0` after the window has already been created.
2. The fan-out rollback path invokes `wt delete --worktree-name <name>` (riff.go:893). `wt` deprecated `--worktree-name` in favor of positional arguments, and without `--non-interactive` it prompts `Delete this worktree?` — reading EOF on stdin returns exit 1, so rollback fails silently and leaks worktrees + tmux windows.
3. As a downstream effect of #1 and #2, partial fan-out failures (one goroutine errors at `select-pane`, the other already created its worktree) leave both worktrees orphaned plus a `riff-<wt-name>` tmux window that the user has to clean up by hand.

Bug #1 affects **every** riff invocation, not just fan-out — single-pane riffs surface the same `can't find pane: 0` stderr message after the window has otherwise been built. The window is usable, but the error is alarming and pollutes operator output.

Multi-turn conversation decisions agreed in `/fab-discuss`:

- **Hard rename**, no `--fan-out` alias. The flag has been in master for ~11 days (since change `260423-jmwu-rk-riff-workflow-features` shipped on 2026-04-23) and has no external users; muscle memory cost is acceptable.
- **Short form is `-N`** (uppercase), not `-n`. Lowercase `-n` is more conventional but easier to confuse with future `--name`-style flags. `-N` is rare enough to read clearly as "count." `xargs -n` and friends use lowercase, but `-N` here is unambiguous because `riff` has no other count-like flag.
- **`--count` over alternatives** (`--windows`, `--workspaces`, `--copies`). `--count` reads correctly the first time and matches the user's actual ask ("give me N of these"); the alternatives are more verbose without being more precise.
- **Ship all three (rename + 2 bug fixes) in one change.** Rationale: the rename can't be tested end-to-end without the bug fixes (every riff fails at `select-pane` today), and the bugs surface specifically in the fan-out path the rename targets. Splitting would mean a bug-fix PR that's hard to verify, then a rename PR that's "rename a flag and also test it works." One PR is shorter and easier to review.

## Why

**Problem 1 — `--fan-out` is a poor name.** "Fan-out" is parallelism jargon (DAG schedulers, pub/sub) describing a *mechanism*. The user's actual ask is quantity: "give me N of these workspaces." `--count 3` reads correctly the first time; `--fan-out 3` makes you pause. Anecdotally, the user (the only current consumer) re-reads the flag every time. A short form (`-N`) further compresses the common case `rk riff ship -N 3`.

**Problem 2 — fan-out is broken today.** The two `wt`/`tmux` defects above mean: (a) every riff prints a spurious error after the window is built, eroding trust; (b) any partial fan-out failure leaks worktrees + windows, requiring manual cleanup. The fan-out feature shipped 11 days ago (change `260423-jmwu-rk-riff-workflow-features`) and was never exercised on a tmux config with `pane-base-index 1`, which the user's environment uses. The bug is portability, not regression — it has always been wrong on this configuration.

**What happens if we don't fix it.** The rename alone is cosmetic and easily deferred. The bugs, however, mean fan-out is unusable on the user's primary machine and any other tmux setup with non-zero base indices (which is the default in many popular tmux configurations, including the `rk` project's own embedded `tmux.conf`). Without these fixes, `--fan-out` (or its renamed successor) cannot be used in real workflows.

**Why this approach over alternatives.**

- **For the rename:** considered keeping `--fan-out` as a hidden alias for one release. Rejected — the only consumer is the user, and a clean rename keeps help text and docs unambiguous. Hidden aliases also have a maintenance tax (deprecation warning, removal scheduling, test coverage of both forms).
- **For bug #1 (pane index):** two options — (a) read `pane-base-index` once via `tmux show-options -gv pane-base-index` and use it everywhere, or (b) capture the new window's first pane id directly via `tmux new-window -P -F '#{pane_id}'` and pass that pane id to subsequent calls. Option (b) is more robust (works regardless of tmux config, no second roundtrip on every spawn) and aligns better with how the rest of the codebase targets panes (by id, not index). Going with (b).
- **For bug #2 (wt delete):** the fix is mechanical — switch to positional args and add `--non-interactive`. Single line.

## What Changes

### 1. Rename `--fan-out N` → `--count N` (short form `-N`)

Hard rename, no alias. Changes touch:

- `app/backend/cmd/rk/riff.go`:
  - Rename `riffFanOutFlag` → `riffCountFlag`.
  - Replace `riffCmd.Flags().IntVar(&riffFanOutFlag, "fan-out", 1, "Spawn N worktree/window pairs in parallel (N >= 1)")` with `IntVarP(&riffCountFlag, "count", "N", 1, "Spawn N worktree/window pairs in parallel (N >= 1)")`.
  - Update the validation error message: `--fan-out requires a positive integer` → `--count requires a positive integer`.
  - Rename `effectiveSpec.FanOut` → `effectiveSpec.Count`.
  - Rename `runFanOut` → `runCount`. Internal helpers `fanOutResult`, `planFanOutRollback`, `rollbackFanOut` keep their names — those describe the parallelism mechanic, which is distinct from the user-facing flag. Renaming them too is churn without value.
  - Update `Use:` line in cobra command to `... [--count <N>] ...`.
  - Update `Long:` text — replace "Fan-out:" section heading and body with "Count:", and update the example `rk riff ship --fan-out 3` → `rk riff ship --count 3` (or `-N 3`).
  - Update inline `// fan-out validation` comment at riff.go:273 → `// count validation`.
- `app/backend/cmd/rk/riff_test.go`:
  - Replace `--fan-out` with `--count` in test fixtures (riff_test.go:515-516 and any other occurrences).
  - Rename test names that reference fan-out as a flag (e.g., `"fan-out respects CLI value"` → `"count respects CLI value"`). Test names referring to the *implementation* (`TestPlanFanOutRollback`) keep their names — they're testing the internal mechanic.
  - Add one test asserting `-N 3` short form parses correctly.
- `docs/memory/run-kit/rk-riff.md`:
  - Replace `--fan-out` mentions with `--count` (lines 23, 33, 148, 170 per repro grep). Update flag table, examples, and the changelog entry's wording.
  - Add a new changelog entry dated 2026-05-04 for this rename + the two fixes.

### 2. Fix bug A: hardcoded pane index `0` in `select-pane`

Current code (riff.go:642-671):

```go
argvs = append(argvs, []string{
    "new-window",
    "-n", resolvedName,
    "-c", worktreePath,
    paneShellString(spec.Launcher, spec.Panes[0]),
})
// ... split-window calls for panes 1..N ...
if spec.Layout != "" {
    argvs = append(argvs, []string{"select-layout", "-t", resolvedName, spec.Layout})
}
argvs = append(argvs, []string{"select-pane", "-t", resolvedName + ".0"})
```

The `.0` suffix assumes pane indices start at 0; on tmux with `pane-base-index 1` it must be `.1`. Hardcoding either is wrong.

**Fix approach:** capture the pane id of the new window directly, then target subsequent operations by pane id. This requires a structural change to `buildSpawnArgvs` because pane ids are runtime values — a pure `[][]string` builder no longer suffices for the final `select-pane`. Two options:

**Option A (chosen):** add `-P -F '#{pane_id}'` to the `new-window` invocation so it prints the new pane id. Replace `buildSpawnArgvs` returning `[][]string` with a small orchestrator in `spawnRiff` that:

1. Runs `tmux new-window -P -F '#{pane_id}' -n <name> -c <path> <shell>`, captures stdout (e.g., `%87`).
2. Runs the `split-window` calls (no change — they target the window by name, and the new pane is the active one in the window after each split, which is fine for chained splits).
3. Runs `select-layout` if non-empty.
4. Runs `select-pane -t <pane_id>` using the captured pane id from step 1.

Pure helpers `buildNewWindowArgs`, `buildSpawnArgvs`, `buildSkillShellString`, `buildCmdShellString` keep their pure shape — they construct argv slices without I/O. The orchestration in `spawnRiff`/`spawnRiffReturningName` becomes slightly less linear but more correct.

**Option B (rejected):** read `tmux show-options -gv pane-base-index` once at command startup and substitute into the hardcoded `.0`. Rejected because (a) it adds a roundtrip every invocation, (b) it misses the (rare) case where the option differs server-vs-window, (c) pane id is the canonical tmux primitive — index is a UI convenience.

**Test impact:** `buildSpawnArgvs` test cases stay; one of them changes — the trailing `select-pane` argv is no longer in the returned slice (it's now constructed at runtime with a captured pane id). New unit test for parsing the `new-window -P` output (trim, single line).

### 3. Fix bug B: deprecated `wt delete --worktree-name` in rollback

Current code (riff.go:889-898):

```go
func runWtDelete(parent context.Context, name string) error {
    ctx, cancel := context.WithTimeout(parent, wtTimeout)
    defer cancel()

    cmd := exec.CommandContext(ctx, "wt", "delete", "--worktree-name", name)
    out, err := cmd.CombinedOutput()
    ...
}
```

**Fix:** invoke `wt delete --non-interactive <name>` — drop `--worktree-name` (positional now), add `--non-interactive` so it doesn't prompt. Single-line change in `runWtDelete`. No test currently exercises the wt-delete argv; add one tiny test verifying the argv shape.

### 4. Acceptance verification

The user's own repro is the acceptance check:

1. From a tmux session with `pane-base-index 1`, run `rk riff --cmd "echo hi; sleep 30"` — expect a clean window with no `select-pane` error to stderr.
2. Run `rk riff --count 2 --cmd "echo hi; sleep 30"` — expect two worktrees, two riff- windows, no errors, no orphaned state on success.
3. Force a partial fan-out failure (hard to script — use a deliberately bad layout or break wt temporarily) and confirm rollback removes both worktrees and the surviving window without prompting.
4. Run `rk riff --fan-out 2 ...` — expect cobra "unknown flag" error.

## Affected Memory

- `run-kit/rk-riff.md`: (modify) — replace `--fan-out` with `--count` throughout (Quick Reference flag table at line 33, Synopsis at line 23, Fan-out section at line 148, Fan-out spawn description at line 170, changelog entry at line 277). Document the pane-id capture pattern in the Pane Spawn / Window Construction section (currently describes hardcoded `.0`). Add a changelog entry dated 2026-05-04 covering the rename, the pane-id fix, and the wt-delete fix.

## Impact

**Affected code:**

- `app/backend/cmd/rk/riff.go` — flag definition, `effectiveSpec` field, `runFanOut` rename, `buildSpawnArgvs` signature change (or split: keep for split/layout, add runtime pane-id capture in `spawnRiff*`), `runWtDelete` argv, all help text and error messages mentioning fan-out.
- `app/backend/cmd/rk/riff_test.go` — flag-name fixtures, `effectiveSpec.FanOut` references in tests, `buildSpawnArgvs` test trimming the `select-pane` row, new `-N` short-form test, new `runWtDelete` argv test.

**APIs:** none. `rk riff` is a CLI; the flag name is the only "API" surface and we're explicitly breaking it.

**Dependencies:** none added.

**Systems:** the embedded tmux.conf (`internal/tmux/tmux.conf`) is unaffected — the bug is in `riff.go`'s assumptions about user tmux config, not in `rk`'s own server.

**External tools relied on:**
- `wt delete` positional + `--non-interactive` arg shape (verified via `wt delete --help` in repro — `wt` is a documented dependency in riff.go's preflight check).
- `tmux new-window -P -F '#{pane_id}'` — standard tmux 1.8+ syntax, well below `rk`'s minimum tmux version.

**Risk:** low. Both bug fixes are mechanical. The rename is type-safe (Go won't compile if anything is missed). The pane-id approach makes the code more correct on every tmux configuration, not just `pane-base-index 1`.

## Open Questions

- Should `runFanOut` be renamed too, or only the user-facing flag? Leaning **no** — internal mechanic name vs flag name. Listed as a Confident assumption below.
- Should the test for `--fan-out` rejection be a positive assertion ("unknown flag" error) or just rely on cobra's default? Leaning toward an explicit test so the hard rename is regression-protected.
- Is there a tmux version concern with `new-window -P -F`? The codebase doesn't pin a minimum tmux version anywhere; `-P -F` is from tmux 1.8 (2013). Treating as not a concern.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Hard rename `--fan-out` → `--count` with short form `-N`; no alias | User explicitly chose hard rename in `/fab-discuss`; only one consumer; clean rename matches repo norms (see prior `--setup-pane` removal in change `260423-jmwu`) | S:95 R:60 A:90 D:95 |
| 2 | Certain | Short form is `-N` (uppercase), not `-n` | User confirmed `-N` after the discuss tradeoff analysis; lowercase `-n` is more conventional but visually conflates with `--name`-style flags; uppercase `-N` reads unambiguously as "count" | S:95 R:80 A:85 D:90 |
| 3 | Certain | Ship rename + both bug fixes in one change | User explicitly approved one-change scoping; rename can't be tested without the bug fixes (every riff fails at `select-pane` today) | S:95 R:65 A:90 D:95 |
| 4 | Certain | Bug A fix uses tmux pane-id capture (`new-window -P -F '#{pane_id}'`), not `pane-base-index` lookup | Pane id is the canonical tmux primitive; works regardless of server/window config; no extra roundtrip per invocation; aligns with how the rest of the codebase will need to target panes if more pane-targeted ops are added | S:80 R:60 A:90 D:80 |
| 5 | Certain | Bug B fix uses positional + `--non-interactive` for `wt delete` | Verified via `wt delete --help` in repro (commit `ab92fd4`); `wt` deprecated `--worktree-name` and now requires positional; `--non-interactive` is documented and necessary because rollback runs from a non-tty context (no stdin) | S:95 R:90 A:95 D:95 |
| 6 | Confident | `runFanOut` (the function), `fanOutResult`, `planFanOutRollback`, `rollbackFanOut` keep their names — only user-facing surfaces change | Internal names describe the parallelism mechanic, distinct from the user-facing flag name. The mechanic *is* fan-out (parallel worktree creation with rollback); the flag is just how the count is requested. Renaming internals would be churn. | S:80 R:75 A:80 D:75 |
| 7 | Confident | `buildSpawnArgvs` no longer returns the trailing `select-pane` argv — pane-id capture happens in `spawnRiff` orchestration | Pure-builder pattern can't carry runtime values; cleanest refactor is to scope `select-pane` to the orchestrator. Tests for `buildSpawnArgvs` lose one row but gain a separate test for the runtime path | S:80 R:60 A:80 D:75 |
| 8 | Confident | Add explicit positive test that `--fan-out` is rejected post-rename | Hard-rename regressions are easy to introduce via revert; an explicit "unknown flag" assertion costs ~5 lines and makes the contract testable | S:75 R:80 A:85 D:80 |
| 9 | Certain | Bug A applies to single-pane riffs too — fix removes the cosmetic stderr error there as well | Reproduced live in prior repro session: single-pane `rk riff --cmd "echo single-pane-test"` printed `can't find pane: 0` on tmux with `pane-base-index 1`. Observed fact, not design assumption. | S:95 R:85 A:95 D:90 |
| 10 | Confident | Memory file `docs/memory/run-kit/rk-riff.md` is the only doc that needs updating; specs (`docs/specs/api.md`, `docs/specs/architecture.md`) describe higher-level surface and don't mention `--fan-out` by name in a way that requires editing | Repro grep shows specs mention "fan-out" conceptually but not as a flag name to be renamed; rk-riff memory file has the flag table, synopsis, and changelog. Will re-check during apply | S:75 R:90 A:85 D:80 |
| 11 | Certain | Use `tmux new-window -P -F '#{pane_id}' ...` and parse a single trimmed line of stdout | Documented tmux API contract since 1.8 (2013); `-P -F '#{pane_id}'` always emits exactly one pane id per new-window invocation. Not a design choice — the prescribed tmux idiom for this purpose. | S:90 R:80 A:95 D:90 |
| 12 | Confident | The `split-window` calls in `buildSpawnArgvs` do not need pane-id targeting — they target the window by name, and tmux's "new pane is active after split" semantics make sequential splits work correctly | This is documented tmux behavior the existing code already relies on (and has been working since the change shipped 11 days ago). Not changing the split-window flow as part of this change. | S:85 R:75 A:85 D:85 |

12 assumptions (7 certain, 5 confident, 0 tentative, 0 unresolved).
