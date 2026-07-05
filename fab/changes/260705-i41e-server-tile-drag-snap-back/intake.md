# Intake: Server Tile Drag Snap-Back Fix

**Change**: 260705-i41e-server-tile-drag-snap-back
**Created**: 2026-07-05

## Origin

User-reported bug against the server-tile drag reorder feature shipped in PR #312
(`260705-bpnr-server-tiles-drag-reorder`). The root cause was diagnosed and verified in code
during a live conversation, a fix was proposed and agreed, and the user invoked the pipeline.
Created via `/fab-proceed` promptless dispatch (no questions asked; any would-be-asked decision
is deferred per the SRAD carve-out — none arose).

> Fix: server-tile drag reorder plays the native snap-back ghost animation to the original tile
> position on mouse-up, even when the reorder succeeded. On releasing a dragged server tile, the
> browser animates the drag ghost flying back to the tile's ORIGINAL grid position, even though
> the tile has visibly switched positions and the new order persists.

## Why

**The pain point.** Releasing a dragged server tile plays the browser's native "cancelled drag"
animation — the ghost flies back to the drag origin — even though the reorder visibly succeeded
and persists. The animation reads as *failure feedback*: users see the tile in its new position
while a ghost of it flies back to the old one, which is contradictory and looks broken. The same
latent bug exists in the sidebar session-row reorder (the pattern `useServerReorder` was copied
from), so session rows snap back identically.

**The mechanism (verified in code).** HTML5 drag-and-drop only treats a drop as *accepted* when
the LAST `dragover` event before mouse-up was `preventDefault()`ed. In
`app/frontend/src/hooks/use-server-reorder.ts`, `onDragOver` returns early at line 124
(`if (!dragName || dragName === targetName) return;`) WITHOUT calling `preventDefault()` when
hovering the dragged tile itself. Because the optimistic reorder splices the dragged tile in
under the cursor (insert-before semantics, line 136), every subsequent `dragover` fires on the
dragged tile's OWN element — so the final `dragover` is never cancelled, no `drop` event fires,
`dragend` sees `dropEffect: "none"`, and the browser plays its native cancelled-drag snap-back
animation to the drag origin. The reorder itself sticks because it was already applied during
`dragover` (override ref + debounced 250ms POST), which matches the observed symptom exactly.

**Consequence of not fixing.** Beyond the broken-looking UX, the `onDrop` flush at
`use-server-reorder.ts:159-174` (immediate POST flush "so the write is not lost if the SSE echo
races the timer") is effectively dead code in the common case — `drop` never fires when releasing
over the dragged tile's own element, so only the 250ms debounce timer saves the order. The race
that flush was built to guard is unguarded in practice. The fix revives this drop-flush path.

**Why this approach.** Native DnD cannot animate the ghost to the NEW position — the only two
outcomes the browser offers are "fly back to origin" (rejected drop) or "ghost disappears at the
release point" (accepted drop). Accepting the drop is the correct and only fix; no custom
animation work is possible or needed.

## What Changes

### 1. `app/frontend/src/hooks/use-server-reorder.ts` — hoist drop acceptance in `onDragOver`

Current guard order (lines 122–128):

```ts
const dragName = dragNameRef.current;
if (!dragName || dragName === targetName) return;   // ← self-target bails BEFORE acceptance
if (isInfraServer(targetName)) return;              // infra tiles are not drop targets
if (!e.dataTransfer.types.includes(SERVER_REORDER_MIME)) return;
e.preventDefault();
e.dataTransfer.dropEffect = "move";
```

New guard order — hoist drop acceptance above the self-target check:

```ts
const dragName = dragNameRef.current;
if (!dragName) return;                              // drag from another hook instance — not ours
if (isInfraServer(targetName)) return;              // infra tiles are not drop targets
if (!e.dataTransfer.types.includes(SERVER_REORDER_MIME)) return;
e.preventDefault();                                 // accept the drop…
e.dataTransfer.dropEffect = "move";
if (dragName === targetName) return;                // …then bail: nothing to reorder
```

- The `!dragName` guard stays FIRST and keeps rejecting drags that originate from another hook
  instance — the hook is instantiated by both the sidebar ServerPanel
  (`components/sidebar/server-panel.tsx:74`) and the Cockpit grid
  (`components/server-list-page.tsx:48`); an instance whose `dragNameRef` is null did not start
  the drag and must not accept it.
- The infra guard and MIME guard stay BEFORE acceptance — infra tiles remain non-targets and
  foreign payloads (session-reorder, window-move JSON) remain unaccepted.
- The self-target check moves AFTER `preventDefault()`: the drop is accepted (no snap-back),
  but no reorder math runs (order unchanged, no debounce reschedule).
- Downstream effect: releasing over the dragged tile now fires `drop` → the existing `onDrop`
  flush (lines 159–174) runs and immediately POSTs the pending order, and `dragend` sees
  `dropEffect: "move"` → no native snap-back animation.

### 2. `app/frontend/src/components/sidebar/index.tsx` — same hoist in `handleSessionReorderOver`

The sidebar session-reorder is the pattern's origin and has the identical bug. Current guard
order (line 668):

```ts
if (!sessionDragSource || sessionDragSource.server !== server || sessionDragSource.name === targetName) return;
if (!e.dataTransfer.types.includes("application/x-session-reorder")) return;
e.preventDefault();
e.dataTransfer.dropEffect = "move";
```

New guard order:

```ts
if (!sessionDragSource || sessionDragSource.server !== server) return;  // source guard: drag confined to one server's group
if (!e.dataTransfer.types.includes("application/x-session-reorder")) return;
e.preventDefault();                                                     // accept the drop…
e.dataTransfer.dropEffect = "move";
if (sessionDragSource.name === targetName) return;                      // …then bail: nothing to reorder
```

- The source guard (`!sessionDragSource || sessionDragSource.server !== server`) stays before
  acceptance — the drag stays confined to one server's group.
- The MIME guard stays before acceptance.
- Only the self-name check moves after `preventDefault()`.
- Analyzed side effect: session rows also carry `onDrop={handleSessionDrop}` (the window-move
  drop handler, `session-row.tsx:140` → `index.tsx:633`). With the reorder `dragover` now
  accepted, releasing a session-reorder drag over a session row fires `handleSessionDrop`, which
  `preventDefault()`s, clears window-move drag state, then attempts
  `JSON.parse(e.dataTransfer.getData("application/json"))` — an empty string for a reorder
  payload — and returns via its `catch`. Harmless no-op; `sessionDragSource` is cleared by
  `handleSessionReorderEnd` on `dragend` as today. The sidebar session order keeps its
  debounce-only persistence (there is no session drop-flush today and this fix does not add one).

### 3. Tests

Per `fab/project/code-quality.md`, bug fixes MUST include tests covering the changed behavior.

- **`app/frontend/src/hooks/use-server-reorder.test.ts`** (extend the existing suite, which
  already has a synthetic-DragEvent harness with a `preventDefault` spy): assert that after
  `onDragStart` on tile "a", a `dragover` on "a" ITSELF (carrying the server-reorder MIME) calls
  `preventDefault` and sets `dropEffect: "move"` (drop acceptance) while performing NO reorder —
  `orderedServers` unchanged and no POST scheduled. Additionally cover the revived flush path:
  a `drop` on the drag-source tile after a reorder sweep flushes the pending debounced POST
  (the existing drop-flush tests drop on the target tile; the common real-world release point
  is now the source tile).
- **Sidebar handler**: mirror coverage for `handleSessionReorderOver` if a unit-test seam is
  practical. There is no existing dedicated unit test for the sidebar reorder handlers
  (`index.test.tsx` has no reorder coverage; `session-row.test.tsx` stubs `onReorderOver` as a
  noop), so apply decides: add coverage through the existing sidebar render harness in
  `index.test.tsx` if practical, else record the gap in the plan. Unit tests are exempt from the
  `.spec.md` companion rule (constitution — Playwright specs only).

### Constraints (agreed in discussion)

- **No container-level `dragover` acceptor.** Releasing over grid gaps or infra tiles still
  snaps back — intentional: those aren't drop targets, and the snap-back is correct
  "didn't land on anything" feedback.
- **All other behavior unchanged**: insert-before semantics, derive-over-store override ref,
  render-time equality reconcile, 250ms debounce + drop-flush, infra exclusion
  (`isInfraServer`), custom MIME types (`application/x-server-reorder`,
  `application/x-session-reorder`).
- **Frontend-only**: no backend/API changes, no new routes, no dependency changes.
- **No custom animation work**: accepting the drop is the entire fix.

## Affected Memory

- `run-kit/ui-patterns`: (modify) Amend the server-tile drag-reorder and sidebar session-reorder
  entries: `dragover` must accept (`preventDefault`) even on the self-target element so HTML5
  DnD registers the drop — otherwise the browser plays the native cancelled-drag snap-back ghost
  and the drop-flush path is dead (insert-before splicing makes the self-target the common
  terminal hover state). Guard order: source/scope + MIME guards before acceptance, self-target
  no-op after.

## Impact

- `app/frontend/src/hooks/use-server-reorder.ts` — `onDragOver` guard reorder (~6 lines moved).
- `app/frontend/src/components/sidebar/index.tsx` — `handleSessionReorderOver` guard reorder
  (~4 lines moved).
- `app/frontend/src/hooks/use-server-reorder.test.ts` — new test cases (self-target acceptance,
  drop-on-source flush).
- Possibly `app/frontend/src/components/sidebar/index.test.tsx` — mirror coverage (apply
  decides; see Assumptions #7).
- User-facing surfaces affected: sidebar ServerPanel tile grid, Cockpit TMUX SERVERS grid
  (both consume `useServerReorder`), and sidebar session rows (`handleSessionReorderOver`).
- No backend, no API surface, no routes, no schema/config changes. Verification gates:
  `just test-frontend` (Vitest), `npx tsc --noEmit` in `app/frontend`.

## Open Questions

None — the root cause was verified in code and the exact fix (guard order per site) was agreed
in the originating discussion.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Fix = accept the drop by hoisting `preventDefault()` above the self-target check in both handlers; no custom animation work | Discussed and agreed — native DnD offers only rejected (fly-back) or accepted (ghost disappears) outcomes; acceptance is the only fix | S:95 R:85 A:95 D:95 |
| 2 | Certain | Exact guard order in `useServerReorder.onDragOver`: `!dragName` → `isInfraServer(targetName)` → MIME → `preventDefault()` + `dropEffect="move"` → self-target return | Specified verbatim in the discussion; `!dragName` first correctly rejects drags from the other hook instance (ServerPanel vs Cockpit grid) | S:95 R:90 A:90 D:90 |
| 3 | Certain | Sidebar `handleSessionReorderOver` hoist keeps the source guard (no `sessionDragSource`, or its server differs) + MIME guard before acceptance; only the self-name check moves after | Specified in the discussion; source guard preserves the drag-confined-to-one-server-group invariant | S:95 R:90 A:90 D:90 |
| 4 | Certain | No container-level `dragover` acceptor — releases over grid gaps or infra tiles still snap back | Discussed decision: those aren't drop targets; snap-back there is correct "didn't land on anything" feedback | S:90 R:85 A:90 D:85 |
| 5 | Certain | All other behavior unchanged (insert-before, override ref + render-time reconcile, 250ms debounce + drop-flush, custom MIME types, infra exclusion); frontend-only scope | Explicit constraint list from the discussion; no backend/API surface touched | S:95 R:90 A:95 D:90 |
| 6 | Confident | Test additions: extend `use-server-reorder.test.ts` with (a) self-target dragover → `preventDefault` + `dropEffect="move"`, no reorder, no POST scheduled; (b) drop on the SOURCE tile flushes the pending debounced POST | (a) specified in the discussion; (b) inferred from the revived drop-flush side effect — the source tile is the common real-world release point, and the existing harness (synthetic DragEvent + preventDefault spy + fake timers) supports it directly | S:70 R:85 A:75 D:70 |
| 7 | Confident | Sidebar mirror coverage: no dedicated unit seam exists for `handleSessionReorderOver` (index.test.tsx has no reorder tests; session-row.test.tsx stubs `onReorderOver`); apply adds coverage via the existing sidebar render harness if practical, else records the gap | Discussion made this conditional ("mirror coverage … if it has an existing unit-test seam"); verified no seam exists today, so apply decides-and-records | S:65 R:85 A:70 D:60 |
| 8 | Confident | No Playwright e2e test for this fix — unit-level drop-acceptance assertions are the testable seam | The native drag ghost animation is browser-chrome-level and not observable via Playwright's synthetic DnD events; code-quality's "SHOULD include e2e where possible" is not satisfiable for this behavior | S:70 R:80 A:75 D:70 |
| 9 | Confident | Sidebar keeps debounce-only persistence — no session drop-flush is added even though `drop` now fires on session rows; `handleSessionDrop` no-ops safely on reorder payloads (empty `application/json` → catch → return) | Matches shipped sidebar behavior (PR #240 derive-over-store pattern); adding a flush would be scope creep beyond the agreed constraint "all other behavior unchanged"; the no-op path was verified in code (index.tsx:633-655) | S:70 R:85 A:80 D:70 |

9 assumptions (5 certain, 4 confident, 0 tentative, 0 unresolved).
