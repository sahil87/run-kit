# Intake: Sidebar cwd "(deleted)" marker

**Change**: 260614-nj74-sidebar-cwd-deleted-marker
**Created**: 2026-06-14

## Origin

> User observed that the sidebar's PANE status panel shows very few rows once a fab change is
> completed and its worktree is archived/deleted. Investigation traced this to a still-live tmux
> pane whose backing worktree directory was removed out from under it — the shell's cwd recovered
> to `$HOME`, but the panel kept showing the stale deleted path with no indication it no longer
> existed. User asked for the cwd row to indicate when the folder no longer exists.

Interaction mode: conversational (discussion → diagnosis → interactive design decisions on the
warning treatment). Key decisions reached with the user:

- Surface the deletion in the existing `cwd` row rather than removing the path or adding a new row
  (chosen option 2 of a 3-way layout question).
- Use **color** (`text-red-400`, the panel's existing failure color) over dimming — a vanished cwd
  is more notable, not less; dimming would wrongly read as "less important."
- Keep the stale path as a breadcrumb (so you still see *where* the worktree was) and append a
  `(deleted)` tag.

## Why

1. **Problem**: When an archived change's worktree is deleted, a still-live tmux window points at a
   directory that no longer exists. tmux keeps reporting the stale path until the shell's cwd
   recovers, so the PANE panel silently disagrees with reality — it shows a real-looking path that
   is actually gone, and the `git`/`fab`/`pr` rows vanish with no explanation.
2. **Consequence if unfixed**: The operator sees a confusingly thin panel and a path that looks
   valid but isn't, with no signal that the worktree was cleaned up. Diagnosing "why did my panel
   shrink?" requires reading backend code (as this very session demonstrated).
3. **Approach over alternatives**: Detection must be server-side — the frontend cannot `stat`
   paths. We piggyback on the existing per-pane enrichment loop (which already resolves git
   branches per cwd) and add a TTL-cached `os.Stat` sweep, mirroring the `resolveGitBranches`
   cache so the SSE tick doesn't stat-storm. Rejected: killing/renaming the orphaned tmux window on
   archive (violates constitution §VI — run-kit must not tear down tmux windows); doing nothing
   (the silent-stale state is the actual complaint).

## What Changes

### Backend — detect the deletion

- `internal/tmux/tmux.go`: add `CwdMissing bool` to `PaneInfo` (JSON `cwdMissing,omitempty`).
- `internal/sessions/sessions.go`: add `resolveCwdMissing([]string) map[string]bool` — a
  TTL-cached `os.Stat` sweep (10s TTL via `cwdExistsCache`/`cwdExistsCacheMu`, mirroring the
  `gitBranchCache` structure). Flags **only** the unambiguous `errors.Is(err, fs.ErrNotExist)`
  case; transient errors (permissions, races) are treated as present to avoid false `(deleted)`
  markers. Empty cwds are skipped. Wired into the existing per-pane enrichment loop, reusing the
  already-collected `allCwds` slice.

### Frontend — surface it

- `types.ts`: add optional `cwdMissing?: boolean` to `PaneInfo`.
- `components/sidebar/status-panel.tsx`: when the active pane's `cwdMissing` is set, the `cwd` row
  keeps the stale (shortened) path as a breadcrumb, recolors it `text-red-400`, and appends a
  `(deleted)` tag (`data-testid="cwd-deleted"`). The `title` tooltip reads `{path} (no longer
  exists)`. When the cwd exists, the row renders unchanged.

### Self-healing behavior

The marker is transient: once the shell's cwd recovers to a real directory and tmux reports that
path, `os.Stat` succeeds and the marker clears. It only flares during the window where tmux still
reports the stale deleted path — exactly the confusing state being fixed.

## Affected Memory

- `run-kit/architecture`: (modify) note the per-pane `cwdMissing` enrichment in the
  sessions-enrichment pipeline (TTL-cached `os.Stat`, `fs.ErrNotExist`-only).
- `run-kit/ui-patterns`: (modify) document the PANE/status-panel `cwd` row "(deleted)" treatment —
  red breadcrumb + tag, self-healing.

## Impact

- Backend: `internal/sessions/sessions.go` (new resolver + loop wiring + imports `errors`,
  `io/fs`), `internal/tmux/tmux.go` (`PaneInfo` field). New cache is package-level, additive.
- Frontend: `src/types.ts` (`PaneInfo`), `src/components/sidebar/status-panel.tsx` (cwd row).
- No API contract change (additive `omitempty` field on an existing JSON shape). No new route, no
  new dependency, no database (none exists). Constitution-clean: `os.Stat` is not a subprocess;
  no tmux teardown.
- Tests: `internal/sessions/sessions_test.go` (`TestResolveCwdMissing`),
  `status-panel.test.tsx` (marker shown when missing / absent when present).

## Open Questions

- None. Design decisions were resolved interactively; behavior, color, and layout are settled.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Detection lives server-side (frontend cannot stat paths) | Architecture deterministically dictates this — the SSE/sessions enrichment is the only layer with filesystem access | S:90 R:80 A:100 D:95 |
| 2 | Certain | Reuse the existing per-pane enrichment loop + a TTL cache mirroring `resolveGitBranches` | Codebase pattern is explicit and adjacent; the git-branch resolver is the template | S:85 R:85 A:100 D:90 |
| 3 | Certain | Flag only `fs.ErrNotExist`, treat other stat errors as present | Avoids false "(deleted)" on transient permission/race errors; the one unambiguous signal | S:80 R:90 A:95 D:90 |
| 4 | Certain | cwd row treatment = red path breadcrumb + `(deleted)` tag, `text-red-400` | Chosen interactively by the user over dimming and over path-removal; reuses the panel's existing failure color token | S:95 R:95 A:90 D:95 |
| 5 | Confident | 10s TTL for the cwd-exists cache | Matches the SSE tick cadence; a deleted worktree stays deleted, so a short single TTL suffices without stat-storming | S:70 R:90 A:85 D:80 |
| 6 | Confident | Do NOT auto-close/rename the orphaned tmux window | Constitution §VI — run-kit must not tear down tmux windows; the marker is the minimal honest signal | S:75 R:70 A:95 D:85 |

6 assumptions (4 certain, 2 confident, 0 tentative, 0 unresolved).
