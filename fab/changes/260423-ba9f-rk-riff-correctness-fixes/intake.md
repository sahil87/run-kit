# Intake: rk riff — Correctness and Portability Fixes

**Change**: 260423-ba9f-rk-riff-correctness-fixes
**Created**: 2026-04-23
**Status**: Draft

## Origin

This change was identified during a multi-angle evaluation of `rk riff` where three subagents reviewed the command from bug, DX, and feature angles. The user picked a subset of findings and asked for a grouping plan across 2–3 changes. We agreed on a three-change split organized by risk/reversibility:

1. **This change** — correctness and portability fixes that do not alter the CLI surface.
2. A later change for CLI surface refinement (flag renames, default policy, help text, and the `/fab-discuss` delivery fix).
3. A later change for workflow features (presets, fab-change bridge, `--fan-out`).

The split keeps mechanical fixes in one reviewable PR, isolates the surface-breaking change to a second PR, and leaves features additive on a stable surface. This change is intentionally the "boring" one — no new flags, no renames, no user-visible behavior changes beyond "the pane no longer dies on launcher exit."

Items covered here (per the prior triage):

- **Bug 1** — `--cmd` pane has no shell wrapper, dies on launcher exit (`runTmuxNewWindow`).
- **Bug 3** — Launcher runs under non-interactive `sh -c`, so `.zshrc` aliases/functions don't load.
- **Bug 8** — `exec zsh` hardcoded in `--split`, breaks bash/fish users.
- **Bug 9** — `agent.spawn_command` shell-injection surface needs explicit documentation (no code change).
- **Bug 10** — No SIGINT handling; Ctrl-C during `wt create` hang leaves zombies.
- **Bug 11** — Window-name collision on `riff-<basename>` is silent; produces duplicate names.

Explicitly deferred to the CLI-surface change:

- **Bug 2** — `/fab-discuss` is passed as a positional argv to `claude`, not typed into the REPL. The fix may require `tmux send-keys` which IS a surface change, so it ships with the flag-rename/help-text change.

## Why

Five of the six items are unrelated mechanical correctness fixes. Bundling them is purely for review efficiency — each one in isolation would be a trivial PR with high ceremony overhead. Bundling them is safe because none of them change the CLI contract.

**The stakes per item:**

- **Bug 1 (pane death)**: the current behavior — Claude exits, pane disappears — is hostile. After a Claude session the user expects to drop back into a shell in the worktree (same as `--split` already provides). Today they either lose the window or have to squint at `[exited]` depending on tmux's `remain-on-exit` setting.
- **Bug 3 (non-interactive shell)**: users who have `claude` aliased, or have PATH tweaks that only run in interactive shells, silently don't get them. This is the class of bug that makes `rk riff` "works for me, breaks on my teammate's machine."
- **Bug 8 (`exec zsh`)**: portability papercut. Trivial to fix.
- **Bug 9 (trust boundary doc)**: security posture hygiene. The spec should name the trust boundary explicitly so a future reviewer doesn't flag it as an oversight.
- **Bug 10 (SIGINT)**: Ctrl-C during a hung `wt create` currently leaves the `wt` process running after rk exits. Low-probability, but the fix is a one-liner.
- **Bug 11 (name collision)**: silent dupes in `tmux list-windows` make it impossible to tell two riffs apart. Users resort to visual inspection of pane content.

None of these are sharp-edge user-blocking bugs today, but they compound: a user whose first riff's pane died, whose second riff collided with the first's window name, and whose Ctrl-C didn't work, quickly loses confidence in the tool.

**Why not fix one at a time:** each fix touches `riff.go` in a small, orthogonal way. Bundling avoids five separate PR cycles and one rebase per fix. The tests are additive — one new test per bug fix plus a refactor of `TestBuildNewWindowArgs` to account for the shell wrap.

## What Changes

### 1. Shell-wrap the `--cmd` pane so it survives launcher exit

**Current** (`app/backend/cmd/rk/riff.go:225-229`):

```go
func buildNewWindowArgs(worktreePath, launcher, cmdArg string) []string {
    windowName := "riff-" + filepath.Base(worktreePath)
    shellCmd := fmt.Sprintf("%s '%s'", launcher, escapeSingleQuotes(cmdArg))
    return []string{"new-window", "-n", windowName, "-c", worktreePath, shellCmd}
}
```

The `shellCmd` runs directly; when `claude` exits, the pane dies (tmux default behavior) or shows `[exited]` (if `remain-on-exit` is on).

**Target** — mirror the `--split` pattern with a shared helper:

```go
// shellWrap returns a shell command string that runs cmd and then re-execs
// the user's shell so the pane stays interactive after cmd exits. $SHELL is
// expanded by tmux's shell at window-creation time.
func shellWrap(cmd string) string {
    return fmt.Sprintf(`%s; exec "${SHELL:-/bin/sh}"`, cmd)
}

func buildNewWindowArgs(worktreePath, launcher, cmdArg string) []string {
    windowName := "riff-" + filepath.Base(worktreePath)
    shellCmd := shellWrap(fmt.Sprintf("%s '%s'", launcher, escapeSingleQuotes(cmdArg)))
    return []string{"new-window", "-n", windowName, "-c", worktreePath, shellCmd}
}
```

`runTmuxSplitWindow` uses the same helper: `shellCmd := shellWrap(setupCmd)`.

### 2. Decide whether to wrap the launcher in an *interactive* shell (Bug 3)

**[NEEDS CLARIFICATION]** — two options, user must pick one:

**Option A (recommended)**: wrap the launcher invocation itself in `$SHELL -i -c` so that `.zshrc`/`.bashrc` aliases, functions, and PATH additions are available to the launcher:

```go
// shellCmd before wrapping:
shellCmd := fmt.Sprintf(`%s -i -c %s`, shellBin(), singleQuote(launcherWithArg))
// then wrap with shellWrap to keep the pane alive:
return shellWrap(shellCmd)
```

Risks:
- `.zshrc` side effects (powerlevel10k instant-prompt warnings, heavy init) run twice — once for the launcher, once for the post-exit shell.
- Interactive rc files that assume a tty might print warnings or behave oddly when invoked via `-i -c`.

**Option B (conservative)**: leave non-interactive, document the limitation in `rk-riff.md`. Users who need aliases can set `agent.spawn_command` to include explicit PATH / absolute binary path.

Default recommendation in this intake: Option A with an escape hatch — if a future config key like `agent.shell_mode: non-interactive` is ever needed it can be added then. Don't add it preemptively.

### 3. Replace hardcoded `exec zsh` with `exec "${SHELL:-/bin/sh}"`

**Current** (`app/backend/cmd/rk/riff.go:258`):

```go
shellCmd := fmt.Sprintf("%s; exec zsh", setupCmd)
```

**Target** — use the `shellWrap` helper from (1):

```go
shellCmd := shellWrap(setupCmd)
```

`shellWrap` already handles the `${SHELL:-/bin/sh}` expansion, so this is a natural unification with (1).

### 4. SIGINT handling on `runRiff`

**Current** (`app/backend/cmd/rk/riff.go:102-137`): `runRiff` uses `cmd.Context()` from Cobra, which has no signal handler. Ctrl-C during any of the three child processes (`wt create`, `tmux new-window`, `tmux split-window`) terminates rk but leaves the child process running (rk reparents to init).

**Target** — wrap the context once, at the top of `runRiff`:

```go
func runRiff(cmd *cobra.Command, args []string) error {
    ctx, stop := signal.NotifyContext(cmd.Context(), os.Interrupt, syscall.SIGTERM)
    defer stop()

    // ... propagate ctx to all three CommandContext calls instead of cmd.Context()
}
```

All three `exec.CommandContext` call sites (`runWtCreate`, `runTmuxNewWindow`, `runTmuxSplitWindow`) need their `parent context.Context` argument swapped from `cmd.Context()` to the wrapped context. This is a mechanical change.

### 5. Window-name collision auto-suffix

**Current** (`app/backend/cmd/rk/riff.go:226`): `windowName := "riff-" + filepath.Base(worktreePath)`. If a window with this name exists, tmux silently creates a duplicate (or errors if the user has `set-option -g allow-rename off` — uncommon).

**Target** — before constructing the new-window argv, query existing window names and auto-suffix:

```go
func resolveWindowName(ctx context.Context, base string) (string, error) {
    existing, err := listWindowNames(ctx) // tmux list-windows -F '#W'
    if err != nil {
        return "", subprocessErr("rk riff: tmux list-windows failed: %v", err)
    }
    name := base
    taken := map[string]bool{}
    for _, n := range existing {
        taken[n] = true
    }
    for i := 2; taken[name]; i++ {
        name = fmt.Sprintf("%s-%d", base, i)
    }
    return name, nil
}
```

`buildNewWindowArgs` now takes the resolved name instead of deriving it from the path. The name derivation split (basename → resolved) is still pure and testable.

**Edge cases to handle in the spec:**

- `tmux list-windows` fails (tmux server died between precondition check and window creation) → bubble as subprocess error.
- `tmux list-windows` output empty → no collision, proceed with base name.
- Race between list and new-window (another process creates `riff-foo` in the gap): low-probability, acceptable — worst case is a duplicate, which is the current behavior.

### 6. Document the `agent.spawn_command` trust boundary

Add a section to `docs/memory/run-kit/rk-riff.md` titled **Security / Trust Boundary**:

```markdown
## Security / Trust Boundary

`fabconfig.ReadSpawnCommand` returns the `agent.spawn_command` value from
`fab/project/config.yaml` **unescaped and verbatim**. It is then concatenated
into a shell command string that tmux's shell executes. This means:

- `fab/project/config.yaml` is a trust boundary equivalent to committed code.
  A hostile or careless edit can execute arbitrary shell.
- `escapeSingleQuotes` ONLY protects `--cmd`. It does not protect the launcher.
- Shell expansion in the launcher (e.g., `claude -n "$(basename "$(pwd)")"`)
  is **intentional**; this is the documented exception to the constitution's
  argv-only rule (§I Security First).
- Users who consume third-party repos SHOULD audit `fab/project/config.yaml`
  before running `rk riff` against them, the same way they would audit a
  `justfile` or `Makefile`.
```

No code change. This is purely making the implicit-safe-because-we-trust-the-repo posture explicit in the spec.

## Affected Memory

- `run-kit/rk-riff.md`: (modify) — update workflow-step-order to document shell-wrap helper for new-window pane; update `--split` section to note `$SHELL` expansion; add Security / Trust Boundary section; add SIGINT and window-name-suffix behaviors; update the Changelog with this change's entry.

## Impact

**Code:**
- `app/backend/cmd/rk/riff.go` — majority of changes. New `shellWrap` helper, updated `buildNewWindowArgs` signature, new `resolveWindowName` + `listWindowNames` helpers, `signal.NotifyContext` wrap in `runRiff`, context propagation through subprocess calls.
- `app/backend/cmd/rk/riff_test.go` — update `TestBuildNewWindowArgs` cases to assert the shell-wrap suffix; add `TestShellWrap`; add `TestResolveWindowName` (pure function over a stub window-list).

**Docs:**
- `docs/memory/run-kit/rk-riff.md` — sections called out above.

**APIs/flags**: none. The CLI surface is unchanged.

**Dependencies**: no new packages. `os/signal`, `syscall`, `context` are all stdlib and already in use adjacent to this code.

**Ship order inside this change:** the fixes are mostly independent but the `shellWrap` helper factoring should land first so (1), (2), (3) all reuse it.

## Open Questions

- Interactive vs non-interactive shell wrap for the launcher (Bug 3 — see §2 above). **Must resolve before spec finalization.** Default recommendation: interactive.
- `resolveWindowName` — query `tmux list-windows` up front (explicit, one extra tmux call) or catch tmux's duplicate-name error retroactively (fewer calls but surfaces a race)? Recommendation: query up front; the extra call is ~5ms and the logic is easier to reason about.
- Do we test the SIGINT behavior? A unit test here requires forking a hanging child; probably out of scope. Manual verification via `rk doctor`-style smoke test is enough. Recommendation: skip automated SIGINT test; note the manual check in the spec.
- Should `shellWrap` use `${SHELL:-/bin/sh}` (POSIX safe, works everywhere) or `$SHELL` (simpler, fails if `$SHELL` is unset which is rare)? Recommendation: the `${SHELL:-/bin/sh}` form.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Bundle five mechanical fixes + one doc-only fix in a single change, defer Bug 2 to the CLI-surface change | User-specified in the grouping plan — explicit directive | S:95 R:70 A:80 D:90 |
| 2 | Certain | Factor a shared `shellWrap` helper used by both `runTmuxNewWindow` and `runTmuxSplitWindow` | Simple DRY; both paths now need identical "exec $SHELL" suffix | S:90 R:85 A:90 D:95 |
| 3 | Confident | Use `${SHELL:-/bin/sh}` form over bare `$SHELL` | POSIX-safe fallback with zero downside; matches conservative stdlib patterns elsewhere in rk | S:70 R:90 A:85 D:80 |
| 4 | Confident | Auto-suffix `-2`, `-3`, … on window-name collision rather than erroring or reusing | User explicitly preferred auto-suffix in the plan discussion (non-destructive, cheapest option) | S:80 R:75 A:75 D:70 |
| 5 | Confident | Query `tmux list-windows` up front to detect collisions | More explicit than catching tmux's duplicate-name error; one extra fast call; reasoning-simpler | S:70 R:80 A:80 D:70 |
| 6 | Confident | Wrap `runRiff`'s root context once via `signal.NotifyContext`, propagate to all three subprocess calls | Simpler than per-subprocess wrapping; matches stdlib idiom for CLI tools | S:75 R:85 A:85 D:85 |
| 7 | Confident | Skip automated SIGINT test — verify manually | Unit-testing signal handling here requires forking a hung child; ROI is low, other bug fixes have clean unit tests | S:60 R:85 A:70 D:80 |
| 8 | Confident | Add Security / Trust Boundary section to `rk-riff.md` as the Bug 9 "fix" — no code change | User-approved in the triage — explicit documentation of the existing design rather than new mitigation | S:85 R:90 A:85 D:85 |
| 9 | Tentative | Use option A (`$SHELL -i -c`) over option B (non-interactive) for Bug 3 | Recommended default in the intake pending user confirmation; reversible via a config flag later if rc-file side effects bite | S:55 R:55 A:55 D:45 |
| 10 | Tentative | Keep the existing `exitCodeError` discipline unchanged in this change | Promoting to a shared `internal/cliexit` helper was flagged as a DX concern but belongs in a follow-up change, not this one | S:70 R:75 A:75 D:65 |

10 assumptions (2 certain, 6 confident, 2 tentative, 0 unresolved).
