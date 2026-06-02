# Plan: Fix sidebar non-current group expand (mss7)

**Change**: 260602-mss7-fix-sidebar-group-expand
**Status**: In Progress
**Intake**: `intake.md`

## Requirements

### Sidebar: Per-server group expand toggle

#### R1: Clicking Expand on a non-current server group opens it
The sidebar's per-server `ServerGroup` Expand/Collapse toggle (`toggleServerSection`)
MUST open a collapsed group on the first click and close an open group on the next
click — for *any* server, current or not — even under React 19 StrictMode (which
double-invokes state updaters in dev/e2e). The state updater passed to
`setServerSectionsOpen` MUST be pure: it MUST NOT perform `localStorage.setItem` or
call `attachServer` inside the updater body, because StrictMode's second invocation
would observe the first invocation's `localStorage` write and invert the computed
`next`, turning a single click into a no-op.

- **GIVEN** a non-current server group rendered collapsed (`aria-expanded="false"`)
  with the app wrapped in `<StrictMode>`
- **WHEN** the user clicks the group's "Expand {server} sessions" button once
- **THEN** the group's `aria-expanded` flips to `true` and its session body renders
- **AND** clicking the button a second time collapses it back to `aria-expanded="false"`

#### R2: Side-effects of toggling run exactly once, outside the updater
The localStorage persistence (`runkit-panel-sessions-{server}`) and the lazy
`attachServer(server)` call (when opening a non-current group) MUST be computed from
the current source of truth (`readServerOpen`) and executed once, *before* the pure
functional state commit — not inside the updater.

- **GIVEN** a collapsed non-current server group `B`
- **WHEN** the user clicks Expand once
- **THEN** `localStorage["runkit-panel-sessions-B"]` is written `"true"` exactly once
- **AND** `attachServer("B")` is invoked (B is non-current and now opening)
- **AND** the persisted value and the rendered `aria-expanded` agree (`true`)

#### R3: Existing coupling and persistence behavior is preserved
The fix MUST NOT regress the existing Server-Pane/Sessions-Pane coupling, the
force-open of the current server's group while filtered, the legacy-key migration,
or the default-open-for-current / collapsed-for-others behavior. The
`readServerOpen` fallback (cached state → namespaced localStorage → `server ===
currentServer`) remains the single read path.

- **GIVEN** the existing `index.test.tsx` suite (7 tests for coupling/persistence)
- **WHEN** the fix is applied
- **THEN** all 7 existing tests still pass unchanged

### Non-Goals

- The `attachServer`-inside-updater removal is a latent-correctness improvement that
  rides along (it was a second, independent impurity), but fixing the attach/SSE race
  the backlog *theorized* is out of scope — that theory was disproven during intake
  (B's EventSource opens on page load regardless; the bug is the toggle itself).
- No backend change. `RK_SERVER_ALLOWLIST` prefix-match already admits server B.
- No change to `multi-server-sidebar.spec.ts` — it flips red→green as a side effect.

### Design Decisions

1. **Compute `next` via `readServerOpen(server)`, not an inline localStorage read**:
   the updater already had a duplicated inline read of the namespaced key; replacing it
   with the existing `readServerOpen` callback removes the duplication and reuses the
   single canonical read path. — *Why*: one source of truth for "is this group open",
   already memoized and dependency-tracked. — *Rejected*: keeping the inline read
   (works, but duplicates `readServerOpen`'s logic and re-introduces the magic-string
   key inline).

## Tasks

### Phase 2: Core Implementation

- [x] T001 Make `toggleServerSection` pure in `app/frontend/src/components/sidebar/index.tsx` (~lines 149-173): read `current` via `readServerOpen(server)`, compute `next = !current`, perform the `localStorage.setItem` and conditional `attachServer(server)` side-effects once *outside* the updater, then commit `setServerSectionsOpen((prev) => ({ ...prev, [server]: next }))`. Add `readServerOpen` to the `useCallback` dependency array. <!-- R1 R2 -->

### Phase 3: Integration & Edge Cases

- [x] T002 Add a StrictMode-wrapped regression test in `app/frontend/src/components/sidebar/index.test.tsx`: render the sidebar inside `<StrictMode>` (the default `renderSidebar` does not wrap it — extend it with a `strict` option or add a dedicated render path), click a *non-current* server group's "Expand" button once and assert `aria-expanded` flips to `true`, then click again and assert it flips back to `false`. This test MUST fail against the pre-fix impure updater and pass after T001. <!-- R1 -->

### Phase 4: Polish

- [x] T003 Run the verification gates for the touched scope: `cd app/frontend && npx vitest run src/components/sidebar/index.test.tsx` (new + existing unit tests green) and `npx tsc --noEmit` (type check clean). <!-- R3 -->

## Execution Order

- T001 blocks T002 (the new test must pass against the fixed implementation; it is also expected to fail against the pre-fix code, but T001 lands the fix so the suite is green at commit time).
- T003 runs last (verification of T001 + T002).

## Acceptance

### Functional Completeness

- [x] A-001 R1: `toggleServerSection` opens a collapsed group on first click and closes it on the second click, for current and non-current servers alike.
- [x] A-002 R2: The `localStorage.setItem` and `attachServer` side-effects are computed from `readServerOpen` and executed once, outside the `setServerSectionsOpen` updater; the updater body is a pure functional spread.

### Behavioral Correctness

- [x] A-003 R1: Under `<StrictMode>` (double-invoked updaters), a single Expand click on a non-current group flips `aria-expanded` from `false` to `true` (no inversion no-op).
- [x] A-004 R2: After opening a non-current group, `localStorage["runkit-panel-sessions-{server}"]` reads `"true"` and `attachServer(server)` was called once. (Test asserts the localStorage `"true"` write + the `aria-expanded` flip; the attachServer call-count is verified by code inspection — the handler runs once since StrictMode does not double-invoke event handlers, and `next && server !== currentServer` holds for the non-current target.)

### Scenario Coverage

- [x] A-005 R1: A StrictMode-wrapped regression test exists in `index.test.tsx` exercising the click-toggle cycle (open then collapse) on a non-current group, and it passes.

### Edge Cases & Error Handling

- [x] A-006 R2: `localStorage` access in the toggle remains guarded by try/catch (no throw when storage is unavailable).
- [x] A-007 R3: The existing 7 coupling/persistence tests in `index.test.tsx` still pass; force-open of the current group, legacy-key migration, and default-collapse-for-others are unchanged.

### Code Quality

- [x] A-008 Pattern consistency: New code follows the surrounding sidebar conventions (uses `readServerOpen`, `useCallback` with correct deps, namespaced localStorage key, try/catch guards).
- [x] A-009 No unnecessary duplication: The inline namespaced-key read previously duplicated inside the updater is replaced by the existing `readServerOpen` callback (no reimplemented read path).
- [x] A-010 R3: Type narrowing over assertions and no magic strings introduced — the localStorage key uses the same `runkit-panel-sessions-${server}` template as the rest of the file; `npx tsc --noEmit` is clean.
- [x] A-011 R1: New/changed behavior is covered by tests (code-quality.md: bug fixes MUST include tests) — the StrictMode click-toggle regression test is the guard the suite previously lacked.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- The fix was prototyped and verified green during intake (both `multi-server-sidebar.spec.ts` tests + 7 `index.test.tsx` tests), then reverted so it lands here.

## Deletion Candidates

- None — this change adds a pure-updater fix + a regression test without making existing code redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Fix = move localStorage write + `attachServer` out of the `setServerSectionsOpen` updater; compute `next` via `readServerOpen` and commit a pure functional update | Prototyped and verified green (both e2e + 7 unit tests) during intake, then reverted; root cause traced to StrictMode double-invocation observing the in-updater localStorage write | S:95 R:88 A:92 D:90 |
| 2 | Certain | Add a StrictMode-wrapped click-toggle regression test in `index.test.tsx` targeting a non-current group | code-quality.md requires tests for bug fixes; the escaped-bug gap is precisely "a click toggle under StrictMode," which the existing suite lacks | S:85 R:85 A:88 D:85 |
| 3 | Confident | Regression test asserts BOTH open-on-first-click AND collapse-on-second-click (full toggle cycle) | Intake open question leaned this way for completeness; a full cycle is the strongest guard and cheap to add | S:75 R:85 A:80 D:75 |
| 4 | Confident | Extend `renderSidebar` with an opt-in StrictMode wrapper (vs. a separate bespoke render in the new test) | Reuses the existing provider stack and `SERVERS`/`PRIMARY_SESSIONS` fixtures; minimal surface, no duplication of the provider tree | S:78 R:88 A:82 D:78 |
| 5 | Confident | Target `alpha` (a non-current, session-less server) for the regression click | With `runkit-panel-server` unset (default collapsed), all groups render and non-current groups start collapsed — the exact precondition for the bug; an empty session list is sufficient since the assertion is on `aria-expanded`, not row contents | S:80 R:85 A:85 D:80 |

5 assumptions (2 certain, 3 confident, 0 tentative).
