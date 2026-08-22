# Plan: Sidebar Current-Session Derived Expand

**Change**: 260822-o0cz-sidebar-current-session-derived-expand
**Intake**: `intake.md`

## Requirements

### Sidebar: Current-session derived collapse override

#### R1: Current session renders expanded via a derived override at both collapse read sites
The sidebar SHALL treat a session as collapsed only when it has a collapsed exception AND it is not the current route's session. Both `collapsed[` read sites in `app/frontend/src/components/sidebar/index.tsx` — the `rowSlice`/`rowSignature` `useMemo` (~`:2366`, feeds roving/visible rows) and the render body (~`:2832`, drives `SessionRow`'s `isCollapsed` prop) — MUST apply the same predicate: `(collapsed[sessionRowKey] ?? false) && session.name !== currentSessionName`, using the existing server-scoped `currentSessionName` prop already threaded into `ServerGroupInner` (passed at `:1731` as `srvInfo.name === currentServer ? currentSession : null`). The two sites MUST agree so keyboard roving and painted rows never diverge.

- **GIVEN** a session with a collapsed exception in `runkit-session-collapsed`
- **WHEN** navigation (⌘↑/⌘↓ tab cycle, session jump, click, deep link) makes a window of that session the current route
- **THEN** the session's group renders expanded (window rows in the DOM, chevron `aria-expanded="true"`)
- **AND** the roving visible-row slice includes those window rows

#### R2: Persisted collapse state and write path are untouched
The `runkit-session-collapsed` exceptions map SHALL keep its exceptions-only semantics (`260807-kddk`) with no schema or write-path change: `toggleSession` keeps operating on the RAW `collapsedRef.current` map (write exception when absent, delete when present), and the override never mutates the map.

- **GIVEN** a session with a collapsed exception that is currently the route's session (rendering expanded via R1)
- **WHEN** the user navigates away to a different session
- **THEN** the session renders collapsed again — its exception never left the map
- **AND** collapsing the current session via its chevron writes the exception (taking visual effect when the session stops being current); a second chevron click deletes it (two clicks return to the original persisted state)

#### R3: The deferred selection scroll completes into the current session's group
The `rowSlice` memo's dependency array (~`:2389`) MUST gain `currentSessionName` so the visible-row slice and `rowSignature` recompute when the current session changes — the signature change bumps `rowsVersion`, which is what lets the armed `pendingScrollKeyRef` scroll complete once the group's rows paint. The deferred-scroll machinery itself SHALL NOT change.

- **GIVEN** a collapsed session and a selection change into one of its windows
- **WHEN** the derived override renders the group expanded on that navigation
- **THEN** the armed deferred scroll fires exactly once, targeting the selected row
- **AND** a collapsed NON-current session still defers: no scroll, no auto-expand, armed ref completes later on expand/data arrival (the still-true half of the old rule)

#### R4: The old no-auto-expand comment documents the new rule
The comment at `app/frontend/src/components/sidebar/index.tsx:1188-1190` ("no scroll, no auto-expand (expanding would fight the user's explicit collapse)") SHALL be rewritten to describe the new rule: the current session renders expanded via the derived override so an armed scroll into it completes once the rows paint; only NON-current collapsed groups still keep rows out of the DOM and defer the scroll.

- **GIVEN** the shipped change
- **WHEN** a reader inspects the selection-autoscroll effect
- **THEN** the comment states the derived-override rule, not the reversed decision

#### R5: Unit tests cover the new rule
`app/frontend/src/components/sidebar/index.test.tsx`'s "collapsed group: no scroll, no auto-expand; the deferred scroll fires on expand" test (~`:2564`) asserts the old behavior with a single current session and MUST be restructured. Coverage MUST include: (a) current session renders expanded despite a collapsed exception, and the deferred scroll completes; (b) a collapsed NON-current session stays collapsed and defers the scroll (the fixture needs a second session so a non-current one exists); (c) navigate-away auto-recollapse with the exception intact; (d) roving slice agreement — the visible-row set includes the current session's window rows under the override.

- **GIVEN** the test suite
- **WHEN** `just test-frontend` runs
- **THEN** the restructured and added tests pass, and no test asserts the old no-auto-expand-for-current-session behavior

### Non-Goals

- No new Playwright e2e (intake assumption 6: jsdom proves the DOM behavior; the existing `sidebar-multiselect.spec.ts:164` collapse e2e runs on the server route with no current session and is unaffected)
- No navigation changes (`lib/window-cycle.ts`, keybindings, `app.tsx` memos untouched)
- No localStorage schema or write-path changes

### Design Decisions

#### Current-session expand is derived at render time, never persisted
**Decision**: A session renders collapsed only when it has a collapsed exception AND it is not the current route's session — a render-time predicate at both read sites; the `runkit-session-collapsed` map is never mutated by navigation.
**Why**: Reverses the documented no-auto-expand rule (the current tab's session must always be visible in the tree for keyboard-first orientation, Constitution V) without fighting the stored preference: a session cycled *through* expands only while current and auto-recollapses on navigate-away, so stored exceptions survive. Matches the derive-over-store convention (session-order override, present-auto-expand transient).
**Rejected**: Expand-on-entry that clears the persisted exception when navigation lands in a collapsed session — cycling through sessions would permanently bulldoze the user's collapse preferences.
*Introduced by*: 260822-o0cz-sidebar-current-session-derived-expand

## Tasks

### Phase 2: Core Implementation

- [x] T001 Apply the derived predicate at the `rowSlice` read site (`app/frontend/src/components/sidebar/index.tsx` ~`:2366`): `const isCollapsed = (collapsed[sessionRowKey] ?? false) && session.name !== currentSessionName;` and add `currentSessionName` to the memo deps (~`:2389`) <!-- R1, R3 -->
- [x] T002 Apply the same predicate at the render read site (~`:2832`): `const isCollapsed = (collapsed[`${server}:${session.name}`] ?? false) && session.name !== currentSessionName;` <!-- R1, R2 -->
- [x] T003 Rewrite the selection-autoscroll comment (~`:1188-1190`) to the new rule: current session renders expanded via the derived override (armed scroll completes once rows paint); only non-current collapsed groups defer <!-- R4 -->

### Phase 3: Integration & Edge Cases

- [x] T004 Restructure `app/frontend/src/components/sidebar/index.test.tsx` (~`:2564` block): two-session fixture; tests for current-session-expanded-despite-exception + scroll completion, non-current collapsed session defers (no scroll, no auto-expand), navigate-away auto-recollapse with exception intact, and roving-slice agreement (Enter activation through the identity slice); run `just test-frontend` and the frontend type check. Discovered during apply: the shared fixtures pass `currentSession="main"` / `currentWindowId="@0"`, so every existing test that folds the CURRENT session needed re-anchoring — added `currentSession`/`currentWindowId` overrides to `RenderOpts` and pinned the no-current-window route state in the kddk persistence block, the selection-survives block, the keyboard-nav fixture, and the operator home-session-collapse test; rewrote `sidebar.test.tsx`'s chevron test against the non-current `ao-server` session (its status-panel half asserted a scenario the new rule removes) <!-- R5 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: Both `collapsed[` read sites in `sidebar/index.tsx` apply the identical derived predicate keyed on `currentSessionName`; no other read site exists
- [x] A-002 R3: The `rowSlice` memo deps include `currentSessionName`

### Behavioral Correctness

- [x] A-003 R1: A window navigation into a session with a collapsed exception renders that session's group expanded (rows in DOM, `aria-expanded="true"`)
- [x] A-004 R2: Navigating away re-collapses the session; the `runkit-session-collapsed` entry was never removed or rewritten by navigation
- [x] A-005 R2: `toggleSession` is unchanged (raw-map semantics; chevron on the current session writes/deletes the exception without visual collapse while current)

### Scenario Coverage

- [x] A-006 R3: Deferred scroll completes exactly once into the current session's group when the override reveals the row; a collapsed non-current session defers with no scroll and no auto-expand
- [x] A-007 R5: Restructured/added unit tests exist in `index.test.tsx` covering override, non-current defer, auto-recollapse, and roving agreement; `just test-frontend` passes

### Edge Cases & Error Handling

- [x] A-008 R1: Board route / non-current servers (`currentSessionName === null`) are unaffected — exceptions apply normally there (null never equals a session name)

### Removal Verification

- [x] A-009 R4: The `index.tsx:1188-1190` comment no longer states the no-auto-expand rejection; it documents the derived-override rule

### Code Quality

- [x] A-010 Pattern consistency: The override follows the derive-over-store convention; comments state constraints, not narration (no change-ID citations in code comments)
- [x] A-011 No unnecessary duplication: No new state, props, or utilities — the existing `currentSessionName` prop and deferred-scroll machinery are reused
- [x] A-012 Tests included: The changed behavior is covered by unit tests (code-quality MUST)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant (the two-line predicate edit and comment rewrite leave no dead code; the replaced tests were rewritten in place, not orphaned)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Compare `session.name !== currentSessionName` directly (prop is already server-scoped null for non-current servers; session names cannot be null) | Verified in code at `:1731`/`:2207` — no new plumbing needed | S:90 R:90 A:95 D:90 |
| 2 | Confident | Test scope is unit-only (restructured `index.test.tsx` block, two-session fixture); no new Playwright e2e | Intake assumption 6 left final scope to the plan; jsdom proves DOM presence/absence and scroll spying; existing collapse e2e verified unaffected | S:65 R:90 A:80 D:75 |
| 3 | Confident | The old test's current-session collapse assertions are replaced (not kept alongside): under the new rule a collapsed CURRENT session renders expanded, so the old assertions are contract-invalid, not merely stale | Follows directly from R1; keeping them would assert the reversed decision | S:70 R:85 A:85 D:80 |
| 4 | Confident | Existing tests whose premise is "fold a session out of the DOM" are re-anchored to the no-current-window route state (`currentSession: null, currentWindowId: null` fixture overrides — a real state: `/$server` dashboard, board route) rather than rewritten per-test, preserving their assertions byte-for-byte; only tests whose SCENARIO the rule removes (`sidebar.test.tsx` chevron/status-panel, the :2564 scroll test) are rewritten | Least-churn path that keeps each test's original intent truthful; the persistence/selection/keyboard blocks test machinery orthogonal to route selection | S:70 R:90 A:85 D:75 |

4 assumptions (1 certain, 3 confident, 0 tentative).
