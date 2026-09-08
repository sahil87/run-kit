# Intake: Cache pane-border git info (fix the split-window server wedge)

**Change**: 260908-s9fw-cache-pane-border-git-info
**Created**: 2026-09-08

## Origin

> User: "check out a potential bug — start Claude via `fab agent`, then open a tmux pane on
> the right, and the RunKit UI hangs. Is codex TUI incompatible with panes?" … after
> investigation, user: "yes, go ahead [open a fab change and implement the cached-branch version]."

Conversational. The bug was reproduced and root-caused live before this change was opened. Key
findings from that investigation (all reproduced on isolated scratch tmux servers, not the host
server):

- The freeze is **not** related to codex or claude. A plain `sleep` pane reproduces it identically —
  the pane's running command is irrelevant.
- The freeze is a **whole-tmux-server wedge of ~40–64 seconds**. During it, *every* client of that
  server (including the run-kit browser relay and the daemon's control-mode client) stops receiving
  updates, so the UI appears hung. It is not a frontend or WebSocket bug — a concurrent
  `tmux display -p ok` from an unrelated third client blocks for the full duration.
- **Trigger**: a `split-window` on a window that has **two size-participating clients attached at
  different sizes** — e.g. the user's native terminal (where `fab agent` runs Claude) *plus* the
  run-kit browser relay viewing the same window. Neither client alone triggers it (browser-only:
  no wedge; a second client alone: no wedge). The daemon's always-attached control-mode client is
  `ignore-size` and does not participate in sizing, so it does not count.
- **Root cause**: the managed `pane-border-format` in `configs/tmux/default.conf` runs three `#()`
  shell jobs per pane, two of them git subprocesses (`git rev-parse --show-toplevel` for the
  worktree badge, `git branch --show-current` for the branch). On the split-driven resize with two
  mismatched clients, tmux redraws repeatedly and re-fires these `#()` jobs in a burst
  (strace of the wedged server: repeated `/bin/sh → git → rev-parse → cut → grep` spawns with
  ~21s stalls between the job-queue wakeup `write(4,"\21")` and the next `clone()`).
- **Proof of cause (A/B on an identical server, identical two clients, identical split)**:

  | Config | Max stall observed on a concurrent `tmux display` |
  |--------|---------------------------------------------------|
  | `pane-border-status on` (default) | **62.6 s** |
  | `pane-border-status off` | **0.003 s** |

## Why

**Problem.** Any user who does the normal run-kit thing — run an agent in a terminal pane *and*
watch it in the web UI — and then splits that pane will freeze the entire dashboard for up to a
minute. It looks like run-kit has crashed. This is a Constitution-VI-class availability failure: a
routine action wedges the substrate everyone shares.

**Consequence if unfixed.** The freeze recurs on every qualifying split, is silent (no error), and
mimics a hard hang, so users will assume run-kit is broken. It also blocks the daemon's snapshot
poll for the duration, delaying state updates for other servers on the same tick.

**Why this approach (cache, don't fork).** The individual git commands are fast in isolation
(~3 ms). The wedge is caused by the *volume and serialization* of subprocess spawns during the
resize storm — so the fix is to make the pane border stop forking subprocesses at draw time at all.
The run-kit **daemon already derives each pane's git branch and git root**, cheaply and cached, for
the sidebar/API: `internal/sessions/sessions.go` has `resolveGitBranchFromHead` (reads `.git/HEAD`
directly, no subprocess) fronted by `gitBranchCache` (30s positive / 15s negative TTL, bounded
fan-out). The `/api/sessions` payload already carries `gitBranch` and `gitRoot` per pane. So the
answer the border needs is *already computed* — we just need to hand it to tmux as data instead of
making tmux recompute it via `#()` on every redraw. This reuses existing, battle-tested derivation
and matches run-kit's established `@rk_pane_*` user-option convention (agent-state.md).

## What Changes

### 1. Daemon stamps per-pane git info as tmux pane user-options

During the existing session poll (where `gitBranch`/`gitRoot` are already resolved per pane), the
daemon writes the derived values to the pane as tmux **pane-scoped user options** (`set-option -p`),
mirroring the `@rk_pane_agent_state` pattern:

- `@rk_pane_git_branch` — the branch name (or short SHA for detached HEAD), i.e. exactly the string
  the old `git branch --show-current || git rev-parse --short HEAD | cut -c1-20` job produced.
- `@rk_pane_git_worktree` — a badge flag: `1` (or the badge glyph string) when the pane's `gitRoot`
  path contains `.worktrees`/`worktrees`, else empty — replacing the
  `git rev-parse --show-toplevel | grep -q "\.worktrees\|worktrees"` job.
- `@rk_pane_pathtail` — the last two segments of `pane_current_path`, replacing the
  `echo #{pane_current_path} | rev | cut -d/ -f1-2 | rev` job (the daemon already has the cwd, so
  this is a pure string op in Go — it removes the third and final `#()` fork).

**Write discipline**: stamp **only on change** (compare against the last-stamped value, cached in
the daemon) so a steady-state poll issues no `set-option` writes. This keeps the added tmux
round-trips bounded and avoids waking the control-mode parser needlessly.

### 2. `pane-border-format` reads the cached options instead of forking

`configs/tmux/default.conf` `pane-border-format` is rewritten to reference the user options with
`#{@rk_pane_git_branch}`, `#{@rk_pane_git_worktree}`, `#{@rk_pane_pathtail}` — **no `#()` jobs
remain in the format**. All existing presentation is preserved: the `#P · ` multi-pane prefix
(`#{?#{e|>:#{window_panes},1},#P · ,}`), the per-state color arms (active vs inactive), the
worktree badge, the branch segment, and the trailing `#{pane_current_command}` segment. The change
is embedded in the binary and re-hashed into `~/.config/run-kit/tmux.conf` on the normal managed-conf
path (the header carries a `sha256:` stamp).

**Graceful pre-stamp state**: before the daemon has stamped a pane (e.g. a brand-new pane between
creation and the next poll), the `#{@rk_pane_*}` reads resolve to empty and the border simply shows
no branch/badge/path-tail for that pane until the next poll fills them in — a cosmetic, self-healing
gap, never a fork and never a wedge.

### 3. No behavioral change to the git values themselves

The branch string, detached-HEAD short-SHA fallback, and worktree-badge semantics are unchanged —
they are lifted from the daemon's existing resolver, which already implements the same intent as the
old shell jobs. The only observable difference is that the border may lag reality by up to one poll
interval / the branch-cache TTL, which is acceptable for a status decoration.

## Affected Memory

- `run-kit/configuration.md`: (modify) — the `pane-border-format` description (currently qt7k) now
  documents cached `@rk_pane_git_branch` / `@rk_pane_git_worktree` / `@rk_pane_pathtail` reads
  instead of `#()` git jobs, plus a Design Decision entry recording the wedge root-cause and the
  cache-don't-fork fix.
- `run-kit/agent-state.md`: (modify) — the `@rk_pane_*` user-option family gains the daemon-written
  `@rk_pane_git_*` members (writer = daemon poll, not a shell hook); note the ownership tier
  (daemon-derived, only-on-change stamp).

<!-- assumed: the git-info stamping is documented alongside the existing @rk_pane_* convention in
     agent-state.md rather than a new memory file; hydrate may relocate it if the domain owner prefers. -->

## Impact

- **Code**:
  - `configs/tmux/default.conf` — rewrite `pane-border-format` (also copied to
    `app/backend/build/tmux.conf` at build; `scripts/dev.sh` copies it for dev).
  - `app/backend/internal/sessions/sessions.go` (or the SSE poll caller in `app/backend/api/sse.go`)
    — after per-pane git resolution, stamp the three pane options only-on-change; add a small
    last-stamped cache and the pathtail helper.
  - `app/backend/internal/tmux/` — a thin `SetPaneOption`/`set-option -p` helper if one does not
    already exist (agent-state writes pane options, so a writer likely exists to reuse).
- **APIs/sockets**: none changed. `set-option -p` is invisible to the control-mode parser, so if a
  visible-in-UI repaint is ever wanted on a branch change, the SSE hub can be woken (as the
  legacy-option sweep does) — not required for this fix.
- **Managed conf**: the conf hash changes; live servers pick it up via the daemon-start
  RefreshSweep / the once-per-server pre-attach reload, and rk-created servers get it at birth.
- **Tests**: Go unit test for the pathtail helper and the only-on-change stamp gate; a regression
  assertion that `pane-border-format` contains no `#(` sequence. (An end-to-end "split under two
  mismatched clients does not wedge" test is hard to make deterministic in CI and is out of scope.)

## Open Questions

- Should the branch/worktree/pathtail also drive a **window-level** rollup option, or is per-pane
  sufficient? (Per-pane is sufficient — the border is per-pane. Not blocking.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Root cause is the `pane-border-format` `#()` git jobs; fix by caching, not forking | A/B proven in-session (62.6s → 0.003s with border off); user agreed to the cached-branch version | S:95 R:80 A:95 D:90 |
| 2 | Confident | Cache source = the daemon's existing per-pane git derivation, stamped as `@rk_pane_git_*` pane options | `resolveGitBranchFromHead` + `gitBranchCache` already compute branch/gitRoot cached & subprocess-free; reuses code and the established `@rk_pane_*` convention | S:85 R:75 A:90 D:70 |
| 3 | Confident | Replace all three `#()` jobs (branch, worktree badge, path tail), leaving zero `#(` in the format | The resize storm re-fires every `#()`; the path tail is trivially stampable in Go, so removing all three fully eliminates draw-time forks | S:80 R:80 A:85 D:75 |
| 4 | Confident | Stamp only-on-change during the existing poll (no new poll loop, no per-tick writes) | Bounds added tmux round-trips; mirrors run-kit's only-on-change option-write discipline | S:75 R:85 A:80 D:75 |
| 5 | Tentative | Pre-stamp panes render the border with empty branch/badge/path-tail until the next poll fills them | Simplest self-healing degrade; alternative (a one-shot inline fallback) would reintroduce a fork — rejected | S:60 R:80 A:70 D:55 |
| 6 | Confident | Git-value semantics (branch string, detached short-SHA, worktree badge) are preserved, not redesigned | Lifted from the daemon resolver, which already matches the old shell jobs' intent | S:80 R:75 A:85 D:80 |

6 assumptions (1 certain, 4 confident, 1 tentative, 0 unresolved). Run /fab-clarify to review.
