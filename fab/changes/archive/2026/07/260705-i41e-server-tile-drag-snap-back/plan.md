# Plan: Server Tile Drag Snap-Back Fix

**Change**: 260705-i41e-server-tile-drag-snap-back
**Intake**: `intake.md`

## Requirements

### Server-tile reorder: drop acceptance on self-target

#### R1: `useServerReorder.onDragOver` MUST accept the drop before the self-target check
`onDragOver` in `app/frontend/src/hooks/use-server-reorder.ts` SHALL call `preventDefault()` and set `dataTransfer.dropEffect = "move"` for a valid same-hook server-reorder drag *even when hovering the dragged tile itself*, so HTML5 DnD registers the release as an accepted drop (no native cancelled-drag snap-back animation). The self-target case MUST then bail with no reorder math. The originating-instance guard (`!dragName`), the infra-target guard (`isInfraServer(targetName)`), and the MIME guard MUST remain BEFORE acceptance.

- **GIVEN** a drag started on tile "a" (so `dragNameRef.current === "a"`) and the optimistic override has spliced "a" under the cursor
- **WHEN** a `dragover` carrying `application/x-server-reorder` fires on tile "a" itself (`targetName === dragName`)
- **THEN** `preventDefault()` is called AND `dataTransfer.dropEffect` is `"move"`
- **AND** `orderedServers` is unchanged and no debounced POST is scheduled (no reorder math runs)

#### R2: A same-target dragover MUST NOT reschedule the debounce or mutate the override
When `dragName === targetName`, after accepting the drop the handler SHALL return before the splice/debounce block, so the override ref and the pending `putTimerRef` are untouched.

- **GIVEN** a drag on "a" that has swept over "b" (scheduling a debounced POST of `[b, a]`)
- **WHEN** a subsequent `dragover` fires on "a" itself
- **THEN** the previously scheduled order is preserved (not cleared/rescheduled) and the override still reads `[b, a]`

#### R3: Foreign and infra drags MUST still be rejected
The hoisted acceptance MUST NOT accept drags lacking `SERVER_REORDER_MIME`, drags from another `useServerReorder` instance (`dragNameRef.current === null`), or dragover on an infra target.

- **GIVEN** a hook instance whose `dragNameRef.current` is `null` (drag originated in the other grid's hook), OR a dragover whose payload lacks `application/x-server-reorder`, OR a dragover on an `isInfraServer` target
- **WHEN** `onDragOver` fires
- **THEN** `preventDefault()` is NOT called and no reorder occurs

### Server-tile reorder: revived drop-flush on the source tile

#### R4: A `drop` on the drag-source tile MUST flush the pending debounced POST
With self-target drops now accepted, releasing over the dragged tile's own element fires the existing `onDrop` handler (`use-server-reorder.ts:159-174`). That handler MUST flush any pending debounced `setServerOrder` POST immediately and cancel the timer (single POST, no double-post).

- **GIVEN** a drag on "a" swept over "c" (override `[b, c, a]`, debounced POST pending) with the release happening over the source tile "a"
- **WHEN** `onDrop` fires on tile "a" carrying the server-reorder MIME
- **THEN** `setServerOrder` is called exactly once with `["b", "c", "a"]` and advancing the debounce timer fires no second POST

### Sidebar session-reorder: same hoist

#### R5: `handleSessionReorderOver` MUST accept the drop before the self-name check
`handleSessionReorderOver` in `app/frontend/src/components/sidebar/index.tsx` SHALL call `preventDefault()` and set `dropEffect = "move"` for a valid same-server session-reorder drag even when the target is the dragged row itself, then bail on the self-name case. The source/scope guard (`!sessionDragSource || sessionDragSource.server !== server`) and the MIME guard (`application/x-session-reorder`) MUST remain before acceptance.

- **GIVEN** a session-reorder drag confined to one server's group
- **WHEN** a `dragover` fires on the dragged row itself (`sessionDragSource.name === targetName`)
- **THEN** `preventDefault()` is called and `dropEffect` is `"move"`, but no reorder math runs and no session-order POST is rescheduled

### Non-Goals

- **No container-level `dragover` acceptor** — releasing over grid gaps or infra tiles still snaps back (correct "didn't land on anything" feedback).
- **No session drop-flush added** — the sidebar keeps its debounce-only persistence even though `drop` now fires on session rows; `handleSessionDrop` no-ops safely on reorder payloads (empty `application/json` → `JSON.parse` throws → `catch` → return).
- **No backend/API/route/dependency changes** — frontend-only.
- **No custom animation work** — accepting the drop is the entire fix (native DnD offers only fly-back-to-origin or ghost-disappears-at-release).

### Design Decisions

1. **Hoist `preventDefault()`/`dropEffect` above the self-target check** — *Why*: HTML5 DnD marks a drop accepted only when the LAST `dragover` before mouse-up was `preventDefault()`ed; insert-before splicing makes the dragged tile's own element the common terminal hover state, so bailing early there leaves the final dragover uncancelled → native cancelled-drag snap-back + dead drop-flush path. *Rejected*: a container-level acceptor (would wrongly accept releases over gaps/infra) and custom ghost animation (impossible — native DnD can't animate the ghost to the new position).
2. **Keep originating-instance / scope / MIME guards before acceptance** — *Why*: the hook is instantiated by both the sidebar `ServerPanel` and the Cockpit grid; an instance whose `dragNameRef` is null did not start the drag and must not accept it. Infra tiles and foreign payloads (session-reorder, window-move JSON) must remain non-targets.

## Tasks

### Phase 2: Core Implementation

- [x] T001 Reorder the guards in `onDragOver` of `app/frontend/src/hooks/use-server-reorder.ts` (currently lines 122-128): split `!dragName || dragName === targetName` into a leading `if (!dragName) return;`, keep the `isInfraServer(targetName)` and MIME guards next, then `e.preventDefault()` + `e.dataTransfer.dropEffect = "move"`, then a trailing `if (dragName === targetName) return;` before the splice/debounce block. <!-- R1 R2 R3 -->
- [x] T002 Reorder the guards in `handleSessionReorderOver` of `app/frontend/src/components/sidebar/index.tsx` (currently line 668): split the combined guard into `if (!sessionDragSource || sessionDragSource.server !== server) return;`, keep the MIME guard, then `e.preventDefault()` + `e.dataTransfer.dropEffect = "move"`, then a trailing `if (sessionDragSource.name === targetName) return;` before the splice/debounce block. <!-- R5 -->

### Phase 3: Tests

- [x] T003 Extend `app/frontend/src/hooks/use-server-reorder.test.ts`: add a case asserting that after `onDragStart` on "a", an `onDragOver` on "a" itself (carrying the server-reorder MIME) calls `preventDefault` and sets `dropEffect: "move"` while leaving `orderedServers` unchanged and scheduling no POST (advance the debounce timer → `setServerOrder` not called). <!-- R1 R2 -->
- [x] T004 [P] Extend `app/frontend/src/hooks/use-server-reorder.test.ts`: add a case asserting that a `drop` on the SOURCE tile after a reorder sweep flushes the pending debounced POST exactly once with the final order and fires no second POST when the timer advances. <!-- R4 -->
- [x] T005 Add sidebar mirror coverage for `handleSessionReorderOver` if a practical unit-test seam exists in `app/frontend/src/components/sidebar/index.test.tsx`; else record the gap in `## Assumptions`. <!-- R5 -->

### Phase 4: Verification

- [x] T006 Run `just test-frontend` (Vitest) and `npx tsc --noEmit` in `app/frontend`; both MUST pass. <!-- R1 R2 R3 R4 R5 -->

## Execution Order

- T001 and T002 are independent (different files).
- T003 and T004 depend on T001; T005 depends on T002.
- T006 runs last.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `useServerReorder.onDragOver` calls `preventDefault()` + sets `dropEffect="move"` for a same-hook server-reorder dragover on the dragged tile itself, with the `!dragName` / infra / MIME guards still ahead of acceptance.
- [x] A-002 R4: `onDrop` on the drag-source tile flushes the pending debounced `setServerOrder` POST immediately (existing flush path, now reachable).
- [x] A-003 R5: `handleSessionReorderOver` calls `preventDefault()` + sets `dropEffect="move"` on the self-name target, with the source/scope + MIME guards still ahead of acceptance.

### Behavioral Correctness

- [x] A-004 R2: A same-target server dragover performs no reorder math — `orderedServers` unchanged, `putTimerRef` not rescheduled, override ref untouched.
- [x] A-005 R5: A same-name session dragover performs no reorder math — session order unchanged, `orderPutTimerRef` not rescheduled.

### Scenario Coverage

- [x] A-006 R1: A Vitest case in `use-server-reorder.test.ts` proves self-target dragover acceptance with no reorder/no POST.
- [x] A-007 R4: A Vitest case in `use-server-reorder.test.ts` proves the drop-on-source-tile flush (single POST, no double-post).

### Edge Cases & Error Handling

- [x] A-008 R3: Foreign-MIME dragover, null-`dragName` (other-instance) dragover, and infra-target dragover are all still rejected (no `preventDefault`).
- [x] A-009 R5: With session-reorder dragover now accepted, a session-reorder `drop` landing on `handleSessionDrop` no-ops safely (empty `application/json` → `catch` → return; no cross-move, no toast).

### Code Quality

- [x] A-010 Pattern consistency: The two handlers keep an identical guard-order shape (source/scope + MIME before acceptance; self-target no-op after), matching the shared-pattern relationship documented in memory.
- [x] A-011 No unnecessary duplication: No new helpers or animation code introduced; the existing `onDrop` flush path is reused, not reimplemented.
- [x] A-012 Test coverage for changed behavior: New/changed behavior has Vitest coverage per code-quality.md ("bug fixes MUST include tests"); the sidebar mirror-coverage decision is recorded (test added or gap noted in Assumptions).

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- No Playwright e2e is added: the native drag-ghost animation is browser-chrome-level and not observable via Playwright synthetic DnD (intake Assumption #8).

## Deletion Candidates

None — this change reorders guards in two existing handlers and adds tests; it makes no existing code redundant or unused (it *revives* the previously-unreachable `onDrop` flush path in `app/frontend/src/hooks/use-server-reorder.ts:166-181` rather than deadening anything).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Implement the exact guard hoist in both handlers as specified verbatim in the intake's `## What Changes` code blocks | Intake Assumptions #1–#3 are Certain; guard orders given line-for-line | S:95 R:90 A:95 D:95 |
| 2 | Certain | Server-hook test additions: self-target dragover acceptance (no reorder, no POST) + drop-on-source-tile flush, using the existing synthetic-DragEvent + fake-timers harness | Intake Assumption #6; the harness in `use-server-reorder.test.ts` supports both directly (preventDefault spy, dropEffect field, `vi.advanceTimersByTime`) | S:80 R:90 A:85 D:85 |
| 3 | Confident | Sidebar mirror coverage ADDED via the existing `renderSidebar` harness (not skipped): a self-target session-reorder dragover on the dragged row is drivable through the real `Sidebar` — `dragStart` seeds `sessionDragSource`, then `fireEvent.dragOver` on the same `data-session-row` row returns `false` (preventDefault called) proving drop acceptance, plus a source-guard negative case | Intake Assumption #7 made this apply-decides; a practical seam DOES exist (contrary to "no seam" in #7): the row is `draggable`, wires `onSessionReorderStart`/`onSessionReorderOver`, and the window-move `handleSessionDragOver` no-ops when `dragSource` is null, so `preventDefault` is attributable solely to the reorder handler | S:75 R:85 A:80 D:75 |

3 assumptions (2 certain, 1 confident, 0 tentative).
