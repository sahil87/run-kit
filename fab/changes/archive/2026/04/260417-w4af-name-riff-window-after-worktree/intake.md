# Intake: Name the tmux window created by `rk riff` after the worktree

**Change**: 260417-w4af-name-riff-window-after-worktree
**Created**: 2026-04-17
**Status**: Draft

## Origin

User observed that tmux windows spawned by `rk riff` had no stable, distinguishable
name. Instead tmux's `automatic-rename` was picking the name from whatever process
was currently foregrounded in the pane (`claude`, `zsh`, `node`, …), so the name
shifted as the agent and its subprocesses churned. This made it hard to pick a
riff-spawned window out of `tmux list-windows` / the status bar, and impossible
to route `tmux send-keys` at a stable target.

Interaction mode: conversational during investigation, precise decision at the
end. User had already applied the code change on this branch (`pacing-canyon`)
before invoking `/fab-new` — this intake formalizes the already-applied edit into
the pipeline (intake → spec → tasks → apply → review → hydrate → ship).

> Name the tmux window created by `rk riff` after the worktree. Pass
> `-n riff-<worktree-basename>` to `tmux new-window`. Example: for worktree
> `/home/sahil/code/sahil87/run-kit.worktrees/pacing-canyon`, window name is
> `riff-pacing-canyon`.

Upstream decisions made before this intake:

1. **Prefix is `riff-`** — user rejected no-prefix and `<repo>-` forms because
   the prefix signals provenance (this window came from `rk riff`, not from
   `wt open`, `fab operator`, or a hand-rolled `tmux new-window`).
2. **Name source is `filepath.Base(worktreePath)`** — `worktreePath` is the
   value returned by `parseWorktreePath(wtOutput)`, which has already been
   `os.Stat`-validated by `runWtCreate`. Its basename is always a safe string
   with no shell metacharacters.
3. **`-n` is passed as a distinct argv element** — not interpolated into the
   tmux shell-command string. This keeps the change inside constitution §I
   (Security First).
4. **Delegating window creation to `wt` was rejected** — see Open Questions /
   rejected alternatives below.

## Why

**The problem**: `rk riff` (`app/backend/cmd/rk/riff.go`, function
`runTmuxNewWindow`) invokes:

```
tmux new-window -c <worktree-path> "<launcher> '<cmd>'"
```

with no `-n <name>` flag. Tmux therefore applies its default naming policy —
the window name is derived from the currently-running process name, and the
`automatic-rename` option (on by default for unnamed windows) updates the name
as processes come and go. Observed consequences:

1. Users cannot distinguish riff-spawned windows from non-riff windows in the
   same tmux session by name alone.
2. The window name is unstable: a window that starts as `claude` may become
   `node` when claude spawns a helper, then `zsh` after the agent exits.
3. Automation that wants to find a riff window (e.g., `tmux list-windows -F
   '#{window_name}'` piped to `grep riff-`) has nothing stable to match.
4. `tmux display-message` / status bar readers see churn, not provenance.

**Why this approach** (pass `-n riff-<worktree-basename>`):

- **Stable**: The worktree basename is fixed for the life of the worktree.
  `riff-pacing-canyon` stays `riff-pacing-canyon`.
- **Signals provenance**: The `riff-` prefix is a quick visual filter for
  "windows that came from `rk riff`" vs. "windows from `wt open`, `fab
  operator`, or a user-invoked `tmux new-window`".
- **Blocks auto-rename**: Tmux disables `automatic-rename` for a window once
  it has been explicitly named via `-n` (or `rename-window`). This is an
  implementation detail of the fix, not a contract we test for — the `-n`
  flag alone is what pins the name (see Assumptions #6).
- **Distinct argv**: `-n` and its value are distinct slice elements to
  `exec.CommandContext`; no shell-string interpolation. Constitution §I
  compliance is preserved.

**Why not fix it some other way**: see "Rejected alternatives" below.

**What happens if we don't fix it**: users keep squinting at
`tmux list-windows`, automation can't key on window name, and any future
feature that wants to locate "the riff window for worktree X" has to infer
from pane working-directory instead (expensive and brittle).

## What Changes

### 1. `app/backend/cmd/rk/riff.go` — `runTmuxNewWindow`

**Already applied in-branch**; this change formalizes it.

Before (line ~219, pre-change):

```go
// runTmuxNewWindow opens a new tmux window rooted at worktreePath, with the
// initial command being `<launcher> '<cmd>'` (cmd single-quote-escaped).
func runTmuxNewWindow(parent context.Context, worktreePath, launcher, cmdArg string) error {
    ctx, cancel := context.WithTimeout(parent, tmuxTimeout)
    defer cancel()

    shellCmd := fmt.Sprintf("%s '%s'", launcher, escapeSingleQuotes(cmdArg))
    cmd := exec.CommandContext(ctx, "tmux", "new-window", "-c", worktreePath, shellCmd)
    // ...
}
```

After (currently on disk on `pacing-canyon`):

```go
// runTmuxNewWindow opens a new tmux window rooted at worktreePath, with the
// initial command being `<launcher> '<cmd>'` (cmd single-quote-escaped). The
// window is named `riff-<worktree-basename>` so it's identifiable among other
// tmux windows and auto-rename won't overwrite it. The second arg to tmux
// new-window IS a shell string interpreted by tmux's shell — this is the
// spec's documented exception to the argv-only rule.
func runTmuxNewWindow(parent context.Context, worktreePath, launcher, cmdArg string) error {
    ctx, cancel := context.WithTimeout(parent, tmuxTimeout)
    defer cancel()

    windowName := "riff-" + filepath.Base(worktreePath)
    shellCmd := fmt.Sprintf("%s '%s'", launcher, escapeSingleQuotes(cmdArg))
    cmd := exec.CommandContext(ctx, "tmux", "new-window", "-n", windowName, "-c", worktreePath, shellCmd)
    // ...
}
```

Plus `"path/filepath"` added to the import block (also already on disk).

Argv ordering: `-n <name>` precedes `-c <path>`. tmux accepts either order, but
this grouping reads left-to-right as "name, then cwd, then command", which
matches the tmux(1) man-page example order.

### 2. `app/backend/cmd/rk/riff_test.go` — new coverage

Current tests cover `parseWorktreePath`, `escapeSingleQuotes`, and
`resolveLauncher`. They do NOT cover `runTmuxNewWindow` directly (no fake
tmux). To assert the new naming rule without invoking real tmux, we extract
the argv-construction into a pure helper and test it:

```go
// buildNewWindowArgs returns the argv slice passed to `tmux new-window`.
// Pure, no side effects — exposed for unit tests.
func buildNewWindowArgs(worktreePath, launcher, cmdArg string) []string {
    windowName := "riff-" + filepath.Base(worktreePath)
    shellCmd := fmt.Sprintf("%s '%s'", launcher, escapeSingleQuotes(cmdArg))
    return []string{"new-window", "-n", windowName, "-c", worktreePath, shellCmd}
}
```

Then `runTmuxNewWindow` calls `exec.CommandContext(ctx, "tmux",
buildNewWindowArgs(worktreePath, launcher, cmdArg)...)`. The existing
behavior is preserved byte-for-byte; only the test seam is added.

Test cases (new):

| # | worktreePath | Expected window name |
|---|--------------|---------------------|
| 1 | `/home/sahil/code/sahil87/run-kit.worktrees/pacing-canyon` | `riff-pacing-canyon` |
| 2 | `/tmp/myrepo.worktrees/alpha` | `riff-alpha` |
| 3 | `/tmp/myrepo.worktrees/alpha/` (trailing slash) | `riff-alpha` (Go `filepath.Base` strips trailing slash) |
| 4 | `alpha` (no dir) | `riff-alpha` |
| 5 | `/` | `riff-/` (degenerate — `filepath.Base("/")` returns `/`) — covered for completeness, real callers always pass the validated worktree path |

Also assert the full argv slice contains the `-n` / `-c` / shellCmd in the
expected order for one happy-path case.

### 3. `docs/memory/run-kit/rk-riff.md` — workflow step 5

Current Step 5 text (line 65):

> 5. `tmux new-window -c <worktree-path> "<launcher> '<cmd>'"` via `exec.CommandContext` (10s timeout). …

New text:

> 5. `tmux new-window -n riff-<worktree-basename> -c <worktree-path> "<launcher> '<cmd>'"`
>    via `exec.CommandContext` (10s timeout). The `-n` flag pins the window
>    name so it's easy to locate in `tmux list-windows` and signals provenance
>    (the window came from `rk riff`). Passing `-n` also prevents tmux's
>    `automatic-rename` from overwriting the name as processes come and go.
>    Basename is `filepath.Base(worktreePath)` where `worktreePath` is the
>    already-validated output of `parseWorktreePath`. …

Also add a short entry to the "Changelog" section at the bottom of the file
for `260417-w4af`.

## Affected Memory

- `run-kit/rk-riff`: (modify) Update Step 5 of the "Workflow Step Order" section
  to reflect the new `-n riff-<basename>` flag; add changelog entry for the
  window-naming change.

No other memory files are affected. `run-kit/tmux-sessions.md` documents
`rk`'s tmux-server interactions (session lifecycle, pane relay), not
riff-specific window naming — out of scope.

## Impact

**Code areas touched:**

- `app/backend/cmd/rk/riff.go` — 1 function (`runTmuxNewWindow`), 1 import
  (`path/filepath`). Optional: extract `buildNewWindowArgs` helper (a few
  more lines) for test seam.
- `app/backend/cmd/rk/riff_test.go` — new `TestBuildNewWindowArgs` (or
  equivalent name) with ~5 cases.
- `docs/memory/run-kit/rk-riff.md` — 2 edits: Step 5 body + Changelog row.

**APIs**: None. `rk riff` user-facing flag surface is unchanged. The only
observable behavior change is the tmux window name.

**Dependencies**: None. `path/filepath` is stdlib.

**Systems**: No changes to session lifecycle, pane relay, WebSocket, SSE,
or frontend. The backend's tmux-session-listing APIs will naturally show the
new window name once users create riff windows — no code change needed there.

**Backward compatibility**: Existing already-open riff windows (created with
the pre-fix code) keep whatever tmux assigned them; only newly-created riff
windows get the `riff-<basename>` name. No migration, no breakage.

## Open Questions

No blocking questions. All significant decisions were made before `/fab-new`
was invoked — captured in Assumptions below.

Rejected alternatives (recorded here for traceability, not open):

1. **Delegate window creation to `wt open --app tmux_window` via
   `wt create --worktree-open tmux_window`**. Rejected: `wt`'s `tmux_window`
   handler (`fab-kit/src/go/wt/internal/worktree/apps.go:253-262`) creates a
   bare shell in the worktree with no initial command. To then run the
   claude launcher we would need `tmux send-keys` into the newly-created
   window — timing-fragile (needs the shell prompt ready), requires extra
   logic to identify the target window, and means the launcher isn't the
   window's initial command so `exit` semantics diverge from the current
   design. Strictly worse than having riff control its own window.
2. **Use `<repo>-<wtname>`** (matching `wt open`'s own naming convention,
   e.g., `run-kit-pacing-canyon`). Rejected: no `riff-` prefix means no
   visual signal of provenance — user wants to distinguish riff windows
   from generic `wt open` windows at a glance.
3. **Plain `<wtname>`** (e.g., `pacing-canyon`). Rejected: same reason as #2.
   The prefix is the value the user wants.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Window name pattern is `riff-<worktree-basename>` (literal `riff-` prefix + `filepath.Base(worktreePath)`) | User explicitly specified this in the /fab-new description; two alternative names rejected with rationale | S:95 R:85 A:95 D:95 |
| 2 | Certain | Implemented via `-n <name>` as a distinct argv element to `exec.CommandContext` — never interpolated into the tmux shell-command string | Required by constitution §I (Security First): "never shell strings or exec.Command without a context/timeout… User-provided input… SHALL be validated before passing to any subprocess" | S:95 R:90 A:95 D:95 |
| 3 | Certain | Files touched are exactly three: `app/backend/cmd/rk/riff.go`, `app/backend/cmd/rk/riff_test.go`, `docs/memory/run-kit/rk-riff.md` | User enumerated them in the /fab-new description; independent grep confirms no other file mentions `tmux new-window` invocation in a way this change affects | S:95 R:75 A:90 D:90 |
| 4 | Certain | Change type is `feat` (new user-visible behavior — stable, discoverable window name) | User called it out explicitly; matches the `_preamble.md` Step 6 keyword inference (description contains no fix/refactor/docs/test/ci/chore keywords) | S:90 R:100 A:95 D:95 |
| 5 | Certain | `worktreePath` passed to `runTmuxNewWindow` is always a validated, existing directory path | `runWtCreate` (riff.go:193) calls `os.Stat` and rejects non-existent or non-directory paths before returning — `runTmuxNewWindow` is only reachable when that check passes | S:90 R:80 A:100 D:95 |
| 6 | Certain | Tests and spec SHALL NOT depend on tmux's `automatic-rename` being on or off | The `-n` flag alone pins the name; whether auto-rename is separately disabled is a tmux implementation detail we shouldn't couple to. Constitution-adjacent — we test observable behavior, not internal tmux state | S:85 R:85 A:90 D:85 |
| 7 | Confident | Test strategy is to extract a pure `buildNewWindowArgs(worktreePath, launcher, cmdArg) []string` helper and unit-test it | Matches the existing rk test pattern (riff_test.go tests `parseWorktreePath`, `escapeSingleQuotes`, `resolveLauncher` — all pure helpers; no test invokes real wt/tmux). Reversible if a cleaner seam emerges during spec | S:75 R:80 A:85 D:70 |
| 8 | Confident | Argv order is `new-window -n <name> -c <path> <shellCmd>` | tmux accepts either `-n` or `-c` first; chosen order reads as "name, dir, command" matching tmux(1) man-page style. Purely cosmetic — changing it is a one-line edit | S:70 R:95 A:80 D:70 |
| 9 | Confident | `filepath.Base` is the right derivation (not `filepath.Base` of a `filepath.Clean`'d path, not a regex) | Go's `filepath.Base` already trims trailing slashes and returns `.` for empty input; `parseWorktreePath` never returns empty (it returns `""` only when no `Path:` line found, which is caught earlier as a subprocess error). Standard library idiom | S:85 R:85 A:85 D:80 |
| 10 | Confident | Memory file `docs/memory/run-kit/rk-riff.md` is updated in this change (not deferred to `/fab-archive`) | The file explicitly documents the exact tmux invocation string in Step 5; leaving it stale contradicts an observable user-visible change. Per `code-quality.md`: "New features and bug fixes MUST include tests covering the added/changed behavior" — memory is documentation of behavior, same principle applies | S:80 R:90 A:85 D:80 |
| 11 | Confident | No changelog entry is needed in any other memory file (e.g., `run-kit/tmux-sessions.md`, `run-kit/architecture.md`) | Those files describe system-level tmux interactions; window-naming for a single subcommand is too narrow to warrant an entry there. If `/fab-archive` later surfaces a cross-domain impact, it can be reconsidered | S:70 R:95 A:80 D:75 |

11 assumptions (6 certain, 5 confident, 0 tentative, 0 unresolved).
