# Plan: Cache pane-border git info (fix the split-window server wedge)

**Change**: 260908-s9fw-cache-pane-border-git-info
**Intake**: `intake.md`

## Requirements

### R1: Pane border renders with no draw-time subprocess

The managed `pane-border-format` (`configs/tmux/default.conf`) MUST NOT contain any `#(...)` shell
job. All previously forked values (path tail, worktree badge, git branch) MUST be read from tmux
pane user-options instead.

- **GIVEN** the managed tmux config is loaded on a server
  **WHEN** any pane border is drawn or redrawn (including during a `split-window` resize)
  **THEN** tmux forks no `/bin/sh`, `git`, `rev`, `cut`, or `grep` process for the border.
- **GIVEN** a window with two size-participating clients of different sizes
  **WHEN** the window is split
  **THEN** the tmux server continues answering other clients (no multi-second wedge).

### R2: Daemon stamps per-pane git info, always-on and only-on-change

The daemon MUST write three pane-scoped user-options per pane from a **subscriber-independent**
background pass (the snapshotter tick, which already enumerates every covered server's panes with
their cwd):

- `@rk_pane_git_branch` — branch name, or the last-known branch during the detached-HEAD grace
  window (then empty), or empty for no repo. Semantics come from `internal/gitinfo` and match the
  sidebar — see R3 (this deliberately supersedes the retired job's short-SHA detached fallback).
- `@rk_pane_git_worktree` — the badge glyph string when the pane's git root lies under a
  `worktrees`/`.worktrees` directory, else empty.
- `@rk_pane_pathtail` — the last two path segments of the pane's cwd.

Writes MUST be **only-on-change**: a value equal to the last stamped value for that pane issues no
`set-option`. The last-stamped cache MUST be pruned when a pane disappears so it stays bounded.

- **GIVEN** a covered server with panes
  **WHEN** the snapshotter tick runs and a pane's derived values are unchanged since last stamp
  **THEN** no `set-option -p` is issued for that pane.
- **GIVEN** a pane whose branch/cwd changed
  **WHEN** the next tick (event-driven, or the ≤60s safety pass) runs
  **THEN** the changed option(s) are re-stamped with the new value.
- **GIVEN** no browser client is connected to any server
  **WHEN** the snapshotter ticks
  **THEN** the options are still stamped (coverage does not depend on SSE subscribers).

### R3: Git-value semantics come from the daemon resolver (sidebar-consistent)

The stamped branch string MUST be produced by the daemon's existing TTL-cached, subprocess-free
resolver (`resolveGitBranchFromHead` / `classifyGitRoot` / `resolveGitBranches`, today in
`internal/sessions`), extracted to a shared package (`internal/gitinfo`) that `internal/sessions`
then reuses — no new or duplicated git logic. This means the pane border shows **exactly what the
run-kit sidebar shows**, which is the goal. Two deliberate deltas from the retired shell job:

- Detached HEAD serves the **last-known branch during the grace window** (then empty), NOT a raw
  short SHA. This supersedes the old `git rev-parse --short HEAD` fallback and matches the sidebar.
- The worktree badge fires when the pane's git root (the `classifyGitRoot` walk result — the dir
  holding `.git`) path contains `worktrees`/`.worktrees`, the same condition as the old
  `git rev-parse --show-toplevel | grep` job.

- **GIVEN** a pane in a normal repo on branch `main`
  **THEN** `@rk_pane_git_branch` == `main` (equals the sidebar's `gitBranch`).
- **GIVEN** a detached HEAD within the grace window
  **THEN** `@rk_pane_git_branch` is the last-known branch (matching the sidebar), else empty.
- **GIVEN** a pane whose git root path contains `worktrees`/`.worktrees`
  **THEN** `@rk_pane_git_worktree` is non-empty (the badge).

### R4: Graceful degrade before/after stamping

An unstamped or unset option MUST render as empty in the border (no fallback fork), so a brand-new
pane between creation and the next tick, or a pane on a server the daemon just began covering, shows
a clean border with no branch/badge until the next tick fills it in.

- **GIVEN** a freshly created pane not yet stamped
  **WHEN** its border draws
  **THEN** the branch/badge/path-tail segments render empty and no subprocess is forked.

### R5: Managed-conf change propagates

The edited `configs/tmux/default.conf` MUST be reflected in the embedded copy
(`app/backend/build/tmux.conf`) and re-hashed into `~/.config/run-kit/tmux.conf`, so live managed
servers pick it up via the existing daemon-start `RefreshSweep` / once-per-server pre-attach reload,
and rk-created servers get it at birth via `-f`.

- **GIVEN** a rebuilt binary
  **WHEN** the daemon starts and the managed conf hash changed
  **THEN** live managed servers reload the new `pane-border-format`.

### Non-Goals

- Changing tmux `window-size` / `aggressive-resize` to suppress the resize renegotiation. (Rejected:
  it alters the multi-viewer sizing behavior run-kit is built around; caching removes the fork storm
  regardless of how many resizes occur.)
- A deterministic end-to-end "split-under-two-clients does not wedge" CI test (hard to make
  reliable; covered by unit tests + the manual repro in the intake).
- A window-level rollup of the git options (the border is per-pane; per-pane suffices).

### Design Decisions

- **Decision**: Stamp the git options from the snapshotter tick (always-on, subscriber-independent),
  only-on-change.
  **Why**: The snapshotter already walks every covered server's panes with cwd on a 2s/60s cadence
  regardless of browser subscribers, so it preserves today's border behavior for ALL client types,
  including native-terminal-only users.
  **Rejected**: Stamping in the SSE poll — simplest (the pane already carries a resolved `GitBranch`)
  but browser-gated, so a native-terminal user with no web UI open would see a blank border (a
  behavior regression). A new dedicated background sweep — most new code for no benefit over reusing
  the snapshotter.
  *Introduced by*: 260908-s9fw-cache-pane-border-git-info
- **Decision**: Reuse the existing TTL-cached git-from-HEAD resolver rather than re-implementing.
  **Why**: `resolveGitBranchFromHead` + `gitBranchCache` are already correct, cached, and
  subprocess-free; the branch/worktree semantics must not drift from the sidebar's.
  **Rejected**: Duplicating git parsing in the snapshot package (drift risk).
  *Introduced by*: 260908-s9fw-cache-pane-border-git-info

## Tasks

### Phase 1: Setup — shared helpers

- [x] T001 Create `internal/gitinfo` and MOVE the resolver into it: `resolveGitBranchFromHead`,
  `resolveGitBranchWithGit`, `classifyGitRoot`, `resolveGitBranch`, `resolveGitBranches`, the
  `gitBranchCache` + entry type + all `gitBranch*` TTL constants. Export a small surface — e.g.
  `ResolveBranches(ctx, cwds) map[string]string` and a per-cwd worktree check (reuse
  `classifyGitRoot`'s root → `strings.Contains(root, "worktrees")`), plus `PathTail(cwd) string`.
  Update `internal/sessions` to import `internal/gitinfo` and call the exported functions (no
  behavior change there). Neither package imports the other today and both import only `tmux`, so
  `gitinfo` (stdlib-only) introduces no cycle. Move the corresponding resolver unit tests too.
  <!-- R3 -->
- [x] T002 [P] Add `SetPaneOption(ctx, server, paneID, option, value)` and `UnsetPaneOption` to
  `internal/tmux` (following `SetWindowOption` at tmux.go:2299, using `set-option -p -t %N`), plus
  the option-name constants `PaneGitBranchOption`, `PaneGitWorktreeOption`, `PanePathTailOption`
  (`@rk_pane_git_branch` / `@rk_pane_git_worktree` / `@rk_pane_pathtail`). <!-- R2 -->
  <!-- rework c1: removed the unused UnsetPaneOption (parsimony zero-call-sites, review must-fix); only SetPaneOption is needed since empty values are stamped as "" and options die with the pane. Also fixed a stale resolveGitBranches doc ref in sessions.go and a stampedGit comment in snapshotter.go. -->

### Phase 2: Core — derive, stamp, render

- [x] T003 Unit-test `gitinfo.PathTail` (last two path segments, matching the old
  `rev | cut -d/ -f1-2 | rev` output) covering root `/`, single-segment, and trailing-slash cwds.
  <!-- R2 -->
- [x] T004 In the snapshotter tick (`internal/snapshot/snapshotter.go`), for each covered server's
  panes, derive branch/worktree/pathtail (via T001 + T003) and stamp the three pane options
  only-on-change: maintain a `map[server]map[paneID]stampedValues` last-stamped cache, skip writes
  when unchanged, and prune entries for panes no longer present. Stamping is best-effort per pane
  (a `set-option` error is logged, not fatal). <!-- R2 -->
- [x] T005 Rewrite `pane-border-format` in `configs/tmux/default.conf` to read
  `#{@rk_pane_pathtail}`, `#{@rk_pane_git_worktree}`, `#{@rk_pane_git_branch}` in place of the three
  `#()` jobs, preserving the active/inactive color arms, the `#{?#{e|>:#{window_panes},1},#P · ,}`
  multi-pane prefix, and the trailing `#{pane_current_command}` segment. No `#(` may remain. <!-- R1 -->

### Phase 3: Integration & tests

- [x] T006 Propagate the conf: ensure the build copies the edited `configs/tmux/default.conf` to
  `app/backend/build/tmux.conf` (confirm `scripts/build.sh` / `scripts/dev.sh` copy path), and add a
  regression test asserting the embedded managed conf's `pane-border-format` contains no `#(`
  sequence. <!-- R1 R5 -->
- [x] T007 Unit-test the only-on-change stamp gate (a second tick with identical derived values
  issues zero `set-option` calls, via an injected pane-option writer seam) and the last-stamped
  cache prune when a pane closes; assert graceful empty-render expectations for an unstamped pane
  are covered by the format having no fork (T006 assertion). <!-- R2 R4 -->

## Acceptance

### Functional Completeness
- [ ] A-001 R1: `configs/tmux/default.conf` and the embedded `app/backend/build/tmux.conf`
  `pane-border-format` contain zero `#(` sequences; the border reads the three `@rk_pane_*` options.
- [ ] A-002 R2: The snapshotter stamps `@rk_pane_git_branch`/`@rk_pane_git_worktree`/
  `@rk_pane_pathtail` per pane from its subscriber-independent tick, only-on-change, with a bounded
  (pruned) last-stamped cache.
- [ ] A-003 R3: Branch/worktree values are produced by the reused (extracted-to-`internal/gitinfo`)
  resolver so the border matches the sidebar's `gitBranch`; detached HEAD serves the grace branch
  (not a short SHA), and the worktree badge fires on the `worktrees`/`.worktrees` root condition.
- [ ] A-004 R5: A managed-conf hash change on daemon start reloads live managed servers (existing
  RefreshSweep / pre-attach reload path), and rk-created servers get the new conf at birth.

### Behavioral Correctness
- [ ] A-005 R1: A `split-window` on a window with two size-mismatched clients no longer wedges the
  tmux server (validated against the intake's manual repro; the mechanism is removed because no
  border subprocess is forked).
- [ ] A-006 R4: An unstamped/new pane renders a clean border (empty branch/badge/path-tail) and
  forks nothing.

### Edge Cases & Error Handling
- [ ] A-007 R2: `pathTail` handles `/`, single-segment, and trailing-slash cwds correctly (unit
  test).
- [ ] A-008 R2: A `set-option` failure for one pane is logged and does not abort the tick or other
  panes' stamping.

### Code Quality
- [ ] A-009 Pattern consistency: `SetPaneOption` follows the existing `SetWindowOption`/`set-option`
  helpers and option-constant conventions in `internal/tmux`; the git resolver is single-sourced
  (no duplicated git parsing).
- [ ] A-010 No unnecessary duplication: git-info derivation is reused, not re-implemented, across
  `internal/sessions` and the snapshotter.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Stamp from the snapshotter tick (always-on), not the SSE poll | Snapshotter is subscriber-independent and already walks panes+cwd; SSE poll is browser-gated and would blank the border for terminal-only users | S:80 R:75 A:85 D:70 |
| 2 | Confident | Reuse the existing TTL-cached git-from-HEAD resolver, extracting to a shared pkg if layering requires | Single-source the branch/worktree semantics; avoid drift from the sidebar's derivation | S:80 R:75 A:85 D:75 |
| 3 | Confident | Replace all three `#()` jobs (path tail, worktree, branch), leaving no `#(` in the format | The resize storm re-fires every `#()`; removing all three fully eliminates draw-time forks | S:80 R:80 A:85 D:75 |
| 4 | Tentative | Branch-change with no tmux event refreshes on the snapshotter's ≤60s safety pass (slightly slower than the old ~15s status-interval) | Acceptable lag for a status badge; avoids adding a second stamping locus. Revisit if freshness complaints arise (SSE-poll augmentation is the escape hatch) | S:60 R:80 A:70 D:55 |
| 5 | Confident | Worktree badge derives from the git root path containing `worktrees`/`.worktrees`, matching the old `grep` | Same condition the retired `git rev-parse --show-toplevel | grep` job used | S:75 R:80 A:80 D:75 |

5 assumptions (0 certain, 4 confident, 1 tentative). Run /fab-clarify to review.
