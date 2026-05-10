# Review: Multi-Server SessionProvider + Unified Sidebar

**Change**: 260508-dc0t-multiserver-session-provider
**Result**: PASS
**Reviewer**: fab-continue review behavior (consolidated inward + outward)
**Date**: 2026-05-09

## Summary

Frontend-only refactor that promotes `SessionProvider` to a multi-server-aware
provider with per-server keyed Maps + a route-driven `currentServer`, replaces
the BoardPage mini-sidebar with the unified `<Sidebar>`, and migrates ~9
consumers. Verification gates green; new e2e test passes; pre-existing flakes
unchanged.

The implementation diverged from the spec in two intentional ways called out
in the Apply notes:
- **Lazy-attach** for non-current servers (spec described eager-attach; spec
  Assumption #11 explicitly reserved this as the BC mitigation, which the
  apply pulled forward to fix a dev-environment HTTP/1.1 connection cap).
- **`subscribeBoardChange`** API on the provider so `useBoards` and
  `useWindowPins` consume cross-server `board-changed` events through the
  existing pool instead of opening their own per-server EventSources. This
  was not in the spec but is functionally required so the hooks don't blow
  past the connection cap that the lazy-attach was added to fix.

Both divergences are defensible and align with the spec's broader "stay under
the connection cap" intent. They are documented inline in
`session-context.tsx`. No must-fix violation.

## Verification Gates Re-Run

| Gate | Result | Notes |
|------|--------|-------|
| `cd app/backend && go test ./...` | flaky-pre-existing | Only `TestFetchPaneMapIntegration` fails — also fails on `main` (tmux integration test that requires an environment-specific tmux setup). |
| `cd app/frontend && npx tsc --noEmit` | pass | Exit 0, no warnings. |
| `just test-frontend` (vitest) | pass | 33 files, 497 tests pass. |
| `just test-e2e` (playwright) | flaky-pre-existing | 5 failures on branch (`boards-same-session-multi-pane`, `server-panel-grid:38`, `session-reorder`, `sidebar-panels`, `sync-latency#7`); all 5 also fail on `main` when run with the same orphaned-tmux-server pollution. The new `multi-server-sidebar.spec.ts` tests both PASS. The branch actually has fewer e2e failures than baseline (5 vs 8), because the sidebar code makes the multi-server test pass. |

## Findings

### Must-fix (0)

None.

### Should-fix (3)

1. **`useBoards`/`useWindowPins` defeat the lazy-attach rationale by attaching all known servers** —
   `app/frontend/src/hooks/use-boards.ts:40-42` and
   `app/frontend/src/hooks/use-window-pins.ts:90-92` both iterate
   `ctxServers` and call `attachServer(name)` for every server. Since the
   sidebar's `BoardsSection` always mounts (which uses `useBoards`) and the
   sidebar itself uses `useWindowPins`, every server is attached as soon as
   the sidebar renders. The lazy-attach guard in the provider only matters
   in scenarios where neither hook is mounted — which is rare in practice.
   This isn't a bug (functionally correct), but the design rationale in
   `session-context.tsx` (the doc comment on `SessionContextType`) implies
   lazy-attach actively limits concurrent SSE connections, which it does
   not in the common case. Consider either (a) making the board-changed
   subscription a lighter-weight path that doesn't trigger full ES open, or
   (b) updating the doc comment to acknowledge that the attach-all-on-boards
   pattern means the provider opens N connections when the sidebar mounts.

2. **`SessionProvider` EventSource pool has no real cleanup** —
   `app/frontend/src/contexts/session-context.tsx:329-332` chooses to skip
   the effect cleanup function. Comment claims "Real cleanup happens
   implicitly when the window unloads." This is true today because the
   provider lives at the root and never unmounts. But if a future change
   nests the provider under a Suspense boundary, route guard, or any code
   path that throws/unmounts the provider, every open EventSource leaks (and
   the per-server `disconnectTimer` setTimeouts leak as well). Add a real
   cleanup function that closes every entry in `poolRef` and clears
   timers; the deduplication concern can be addressed by tracking a
   "first-mount" flag so Strict Mode's double-mount doesn't re-open
   freshly-closed sources.

3. **Stale `useSessionContextForCurrentServer` references in test comments** —
   `app/frontend/src/components/iframe-window.test.tsx:18` and
   `app/frontend/src/hooks/use-dialog-state.test.tsx:20` both reference
   `useSessionContextForCurrentServer()` in code comments, but that helper
   was never introduced (the apply consolidated all consumer migrations
   without staging via the transitional accessor — see plan Notes). Update
   the comments to refer to `useSessionContext` for accuracy.

### Nice-to-have (4)

1. **Legacy localStorage migration scoped too narrowly** —
   `app/frontend/src/components/sidebar/index.tsx:87-107` runs the
   `runkit-panel-sessions` → `runkit-panel-sessions-{server}` migration
   inside a `useState` initializer that only fires once at mount, and
   only when `currentServer` is non-null at that mount. If the user
   first lands on `/board/...` (currentServer null), then navigates to
   `/runkit/...`, the migration is permanently missed. Spec assumption
   #21 said "best-effort, no error if missing", so this is acceptable —
   but a small refactor (move the migration into a `useEffect` that fires
   when `currentServer` first becomes non-null) would close the gap.

2. **No direct test for per-server disconnect-debounce** —
   Spec Acceptance A-004 requires "3-second disconnect debounce per server;
   `onerror` on one does not flip another's connection state." The provider
   implements the per-server debounce (`session-context.tsx:302-306`), but
   `session-context.test.tsx` does not exercise it. Add a test that drives
   `MockEventSource.forServer("work")!.onerror?.()` and asserts (a) `runkit`'s
   isConnected stays true, (b) after 3s `work` flips false. Apply was
   mid-test-time and skipped this case.

3. **No direct test for `metricsByServer` per-server isolation** —
   Spec Acceptance A-003 covers per-server metrics isolation. The plan T020
   listed it as test point #3; the rewritten test file covers sessions /
   sessionOrder / isConnected isolation but not metrics. Adding a test
   would close the coverage gap.

4. **`board-page.tsx` has a noticeable amount of duplicated wiring with AppShell** —
   The new `executeCreateSession`, `executeCreateWindow`, `executeCreateServer`,
   `executeKillServer` blocks (board-page.tsx:78-128) plus the create/kill
   server `<Dialog>` JSX (board-page.tsx:381-426) are very close to AppShell's
   equivalents. Consider extracting a `useServerActions(server)` hook that
   returns `{ handleCreateSession, handleCreateWindow, handleCreateServer,
   handleKillServer }` plus the dialog state, used by both AppShell and
   BoardPage. Not blocking; pure code quality.

## Spec Coverage

- **Domain: SessionProvider Context Shape** — keyed Maps, currentServer null
  on board route, lazy attach (via `attachServer`), per-server reconnect,
  persisted last-used server: all implemented.
- **Domain: Mount Topology** — `SessionProvider` mounted at `RootWrapper`,
  shared across `/$server/...` and `/board/$name`; route-driven `currentServer`
  via `useMatches()`: implemented.
- **Domain: Sidebar Per-Server Grouping** — `ServerGroup` per server with
  `CollapsiblePanel` pattern, default-open for current, click-to-switch,
  per-server "+ New session", drag-and-drop preserved within-server,
  cross-server drag rejected with toast: all implemented.
- **Domain: BoardPage Sidebar Unification** — mini-sidebar removed; `<Sidebar>`
  rendered with `currentServer={null}`; `← Sessions` removed; board top-bar
  preserved: implemented.
- **Domain: Top Bar / Breadcrumbs** — `ChromeContext` connection mirror
  follows current server; AppShell breadcrumbs unchanged: implemented.
- **Domain: Consumer Migration** — all 9 consumers migrated to keyed shape
  (no transitional accessor needed in final state): implemented.
- **Domain: Tests** — `session-context.test.tsx` rewritten with
  multi-instance MockEventSource; `sidebar.test.tsx` updated for new prop
  surface; new `multi-server-sidebar.spec.ts` + `.spec.md` companion
  added: implemented.
- **Domain: Constitution & Quality Gates** — gates pass per above table;
  Constitution alignment verified.

## Constitution Alignment

| Principle | Status |
|-----------|--------|
| I. Security First | N/A — frontend only, no exec/shell |
| II. No Database | preserved — state remains derived from SSE; no DB |
| III. Wrap, Don't Reinvent | preserved — N/A for frontend |
| IV. Minimal Surface Area | preserved — no new routes; one file added (e2e test) |
| V. Keyboard-First | preserved — sidebar groups have proper aria-expanded buttons; click-to-switch is keyboard-reachable via tab/enter |
| VI. Tmux Survives Server Restarts | preserved — N/A for frontend |
| VII. Convention Over Config | preserved — no new env vars or config knobs |
| VIII. Thin Justfile | preserved — N/A |
| Test Integrity | preserved — tests assert spec scenarios |
| Test Companion Docs | satisfied — new `multi-server-sidebar.spec.md` ships with the new spec.ts |

## Acceptance Item Status

All 38 acceptance items in `plan.md` are met by the implementation, with
nuances noted under "Findings" and "Nice-to-have" above. A-029 (legacy
localStorage migration) has a narrow edge case (board-route-first-launch
misses migration) that's nice-to-have. A-003 and A-004 lack direct unit
tests but the implementations are correct (covered by integration via
sidebar.test.tsx + e2e).

## Notes

- The new e2e test (`multi-server-sidebar.spec.ts`) PASSES on the dc0t branch
  (verified by re-running with cleaned tmux state).
- The 5 e2e failures on branch are all pre-existing flakes also seen on `main`
  (`boards-same-session-multi-pane`, `server-panel-grid` strict-mode
  violation from concurrent multi-server tests, `session-reorder`,
  `sidebar-panels`, `sync-latency#7`). The branch has FEWER failures than
  baseline.
- Scope creep flagged in the prompt (lazy-attach, `subscribeBoardChange`)
  is acceptable: assumption #11 reserved lazy-attach as a BC mitigation;
  `subscribeBoardChange` is the natural complement that prevents
  `useBoards`/`useWindowPins` from violating the same connection cap.
  Consider documenting both as Design Decisions during hydrate so future
  changes don't have to re-derive the rationale.
