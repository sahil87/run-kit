# Plan: Sidebar cwd "(deleted)" marker

**Change**: 260614-nj74-sidebar-cwd-deleted-marker
**Intake**: `intake.md`

## Requirements

### Backend — deletion detection

- **R1** — The backend MUST detect, per pane, whether the pane's reported cwd no longer exists on
  disk and expose this as a boolean on the pane's serialized shape.
  - GIVEN a tmux pane whose `cwd` points at a directory that has been deleted
    WHEN the sessions snapshot is built
    THEN the pane's serialized `cwdMissing` field is `true`.
  - GIVEN a tmux pane whose `cwd` exists
    WHEN the sessions snapshot is built
    THEN `cwdMissing` is absent/false.

- **R2** — Detection MUST flag only the unambiguous "does not exist" case; transient stat errors
  (permissions, races) MUST NOT produce a false positive.
  - GIVEN `os.Stat(cwd)` returns an error that is `fs.ErrNotExist`
    WHEN resolving cwd existence
    THEN the cwd is flagged missing.
  - GIVEN `os.Stat(cwd)` returns any other error (or succeeds)
    WHEN resolving cwd existence
    THEN the cwd is treated as present.

- **R3** — Detection SHOULD NOT stat every pane cwd on every SSE tick.
  - GIVEN the SSE hub refreshes the snapshot periodically
    WHEN cwd existence is resolved
    THEN results are served from a TTL cache (10s) keyed by cwd, mirroring the git-branch resolver.

### Frontend — surface the marker

- **R4** — When the active pane's cwd is missing, the status-panel `cwd` row MUST visually indicate
  the directory no longer exists while preserving the stale path as a breadcrumb.
  - GIVEN the active pane has `cwdMissing: true`
    WHEN the PANE panel renders
    THEN the `cwd` row shows the shortened path in `text-red-400` followed by a `(deleted)` tag.
  - GIVEN the active pane's cwd exists
    WHEN the PANE panel renders
    THEN the `cwd` row renders in its normal (non-red, no-tag) style.

## Tasks

- [x] T001 [P] Add `CwdMissing bool` (`json:"cwdMissing,omitempty"`) to `PaneInfo` in `app/backend/internal/tmux/tmux.go` <!-- R1 -->
- [x] T002 Add `resolveCwdMissing` + `cwdExistsCache`/TTL to `app/backend/internal/sessions/sessions.go`; import `errors`, `io/fs` <!-- R2 R3 -->
- [x] T003 Wire `resolveCwdMissing(allCwds)` into the per-pane enrichment loop in `FetchSessions` (reuse `allCwds`) <!-- R1 -->
- [x] T004 [P] Add `cwdMissing?: boolean` to `PaneInfo` in `app/frontend/src/types.ts` <!-- R1 -->
- [x] T005 Render the red breadcrumb + `(deleted)` tag (`data-testid="cwd-deleted"`) in the `cwd` row of `app/frontend/src/components/sidebar/status-panel.tsx` <!-- R4 -->
- [x] T006 [P] Add `TestResolveCwdMissing` to `app/backend/internal/sessions/sessions_test.go` <!-- R2 -->
- [x] T007 [P] Add marker-shown / marker-absent tests to `app/frontend/src/components/sidebar/status-panel.test.tsx` <!-- R4 -->

## Acceptance

- [x] A-001 R1: A deleted pane cwd serializes `cwdMissing: true`; an existing cwd omits it (verified by `TestResolveCwdMissing`).
- [x] A-002 R2: Only `fs.ErrNotExist` is flagged; empty cwds are skipped (verified by `TestResolveCwdMissing`).
- [x] A-003 R3: cwd existence is served from a 10s TTL cache mirroring `resolveGitBranches` (code review).
- [x] A-004 R4: The `cwd` row renders the path in `text-red-400` with a `(deleted)` tag when missing, normal style when present (verified by the two status-panel tests).
- [x] A-005: `go test ./internal/sessions/ ./internal/tmux/` passes; `pnpm exec tsc --noEmit` clean; `status-panel.test.tsx` 47/47 pass (Code Quality).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Marker treatment = red path + `(deleted)` tag | User-chosen interactively; reuses `text-red-400` failure token | S:95 R:95 A:90 D:95 |
| 2 | Confident | 10s TTL on cwd-exists cache | Matches SSE cadence; deleted stays deleted | S:70 R:90 A:85 D:80 |

2 assumptions (1 certain, 1 confident, 0 tentative).

## Notes

Retroactive plan: the implementation was completed and verified in the working tree during the
same session before the change was formalized. All tasks/acceptance are recorded as done with the
verifying tests named. No code was (re-)generated at apply; this change exists to record the work
and drive the hydrate stage.
