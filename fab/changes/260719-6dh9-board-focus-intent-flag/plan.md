# Plan: Board Pane Focus Intent Flag

**Change**: 260719-6dh9-board-focus-intent-flag
**Intake**: `intake.md`

## Requirements

### Board Focus: Intent-Gated Imperative Focus

#### R1: Imperative focus fires only on true user intent
The board's single focus effect MUST call `paneRefs.current[focusedIndex]?.focus()` only when a
user-driven focus action set an intent flag for the render that changed `focusedIndex`. Index
change alone MUST NOT be sufficient.

- **GIVEN** a mounted board with ≥2 panes and the focused pane at index `i`
- **WHEN** the user presses `Cmd/Ctrl + ]` (or `[`), clicks a different pane, selects a palette
  cycle action, or completes an own move
- **THEN** the intent flag is set for that render, `focusedIndex` changes, and the settled pass
  imperatively focuses the moved-to pane's terminal
- **AND** the flag is cleared exactly on that settled pass so it cannot linger to a later render

#### R2: A remote reconcile MUST NOT steal focus
A `board-changed` SSE refetch from another client (remote reorder, or a pin/unpin ahead of the
focused pane) that shifts the focused pane's index MUST NOT move DOM focus into any terminal.

- **GIVEN** the user is typing in the palette / compose buffer / another surface, with the focused
  pane at index `i`
- **WHEN** a remote reorder (or a remote pin/unpin ahead of it) shifts the focused pane's index to
  `j ≠ i` via the key-reconcile early-return, then the effect re-enters with `orderChanged=false`
- **THEN** because no user-intent flag was set, `shouldFocusPane(intent=false, i, j)` returns
  `false` and no terminal is focused — DOM focus stays where the user put it

#### R3: The own-move follow (R6 of the board-reorder change) is preserved
An own move (palette move or DnD drop) MUST still land imperative focus in the moved pane after the
board-changed SSE echo settles.

- **GIVEN** the user initiates an own move of the focused pane (palette `Move Focused Pane
  Left/Right`, or a header drag-drop)
- **WHEN** the move's POST succeeds and the board-changed echo arrives, the key-reconcile bumps
  `focusedIndex` to the moved pane's new slot, and the effect re-enters on the settled pass
- **THEN** the intent flag set at move initiation survives the `orderChanged` early-return pass and
  is consumed on the re-entered settled pass, focusing the moved pane
- **AND** if the move's POST fails (`.catch`), the flag is cleared, because no echo will arrive to
  consume it (no stale flag)

#### R4: The gate helper carries the intent dimension
`shouldFocusPane` in `app/frontend/src/lib/board-reorder.ts` MUST take the signature
`(intent: boolean, prevFocusedIndex: number, focusedIndex: number): boolean` and return
`intent && prevFocusedIndex !== focusedIndex`, remaining the single unit-testable focus authority.

- **GIVEN** any `(intent, prev, current)` triple
- **WHEN** `shouldFocusPane` is called
- **THEN** it returns `true` iff `intent` is `true` AND `prev !== current`; both an
  `intent:false, prev≠current` (remote reconcile) and an `intent:true, prev===current`
  (same-index render) return `false`

#### R5: Stale-flag discipline at intent sites
Each intent site MUST set the flag only when the action will actually change `focusedIndex` (so a
set flag is always consumed by the following render's effect), and same-index user actions MUST be
handled imperatively WITHOUT setting the flag.

- **GIVEN** a board with exactly one pane
- **WHEN** the user presses `Cmd/Ctrl + ]` (a modulo cycle over one pane leaves the index unchanged)
- **THEN** the flag is NOT set (no re-render would consume it — it would go stale)
- **GIVEN** the focused pane is at index `i`
- **WHEN** the user clicks the already-focused pane (`idx === focusedIndex`)
- **THEN** the flag is NOT set; the pane's terminal is focused imperatively at the call site (no
  state change ⇒ the effect will not run ⇒ a set flag would go stale)

#### R6: The identity-reconcile machinery is untouched
The `focusedKeyRef` key→index identity reconcile (`focusedIndexForKey`, the `setFocusedIndex(j)`
early-return) MUST NOT change — only the imperative-focus gate changes.

- **GIVEN** the order shifts underneath (own echo or remote)
- **WHEN** the effect runs the `orderChanged` branch
- **THEN** it still reconciles the index to the tracked key exactly as today, and it does NOT clear
  the intent flag (the flag must survive to the re-entered settled pass)

### Design Decisions

#### The intent flag survives the async POST→SSE-echo window
**Decision**: Set `focusIntentRef.current = true` at own-move initiation (ahead of the SSE echo),
consume it on the settled pass after the key-reconcile.
**Why**: An own move has no synchronous index change — the display reorders only when the
board-changed echo arrives. Setting intent at initiation and consuming it after the reconcile is
what preserves R6's own-move follow without a request-id correlation protocol.
**Rejected**: Suppressing focus on ALL order-changed re-entries (breaks the own-move follow);
debouncing/time-windowing SSE-adjacent focus (heuristic, racy, unprincipled when a true intent
signal is available).
*Introduced by*: 260719-6dh9-board-focus-intent-flag

## Tasks

### Phase 2: Core Implementation

- [x] T001 Add `focusIntentRef` (`useRef(false)`) beside `focusedKeyRef` in `app/frontend/src/components/board/board-page.tsx`, with a comment mirroring the sidebar `focusMovedRef`: gates the imperative `.focus()` to user-driven focus movement only; a passive `board-changed` refetch never sets it, so it never steals focus <!-- R1 -->
- [x] T002 Extend `shouldFocusPane` in `app/frontend/src/lib/board-reorder.ts` to the `(intent, prevFocusedIndex, focusedIndex)` signature returning `intent && prev !== current`; update its doc comment (index change alone insufficient; intent alone insufficient; same-index user actions handled imperatively at call sites; keep the "mirrors the sidebar focusMovedRef gate" note — now literal) <!-- R4 -->
- [x] T003 Consume the flag in the focus effect (board-page.tsx): call `shouldFocusPane(focusIntentRef.current, prevFocusedIndexRef.current, focusedIndex)` on the settled pass and clear the flag (`focusIntentRef.current = false`) whenever the settled pass runs with the flag set (regardless of index change); leave the flag untouched on the `orderChanged` early-return pass <!-- R2 R3 R6 -->

### Phase 3: Integration & Edge Cases

- [x] T004 Set the flag at the keyboard cycle site (`onKey`, board-page.tsx): before `setFocusedIndex`, set `focusIntentRef.current = true`, guarded by `entries.length >= 2` (a single-pane modulo cycle leaves the index unchanged — skip the set to avoid a stale flag) <!-- R1 R5 -->
- [x] T005 Set the flag at both palette cycle actions (`board-cycle-next` / `board-cycle-prev`, board-page.tsx): same `entries.length >= 2` guard before `setFocusedIndex` <!-- R1 R5 -->
- [x] T006 Add a `handlePaneClick` callback (board-page.tsx) and pass it as `onPaneClick` to BOTH `DesktopRow` and `MobileCarousel`: if `idx !== focusedIndex`, set the flag then `setFocusedIndex(idx)`; if `idx === focusedIndex`, imperatively `paneRefs.current[idx]?.focus()` WITHOUT setting the flag <!-- R1 R5 -->
- [x] T007 Wrap `reorder` (from `usePinActions`) in a board-page-level `reorderWithFollow` callback that sets `focusIntentRef.current = true` before delegating and clears it (`false`) in the `.catch` failure path; route BOTH own-move paths through it — the palette `moveFocusedPane` call and the `reorder` prop threaded to `DesktopRow` (consumed by `useBoardPaneReorder` for DnD drop) <!-- R1 R3 -->

### Phase 4: Tests

- [x] T008 Update the `shouldFocusPane` suite in `app/frontend/src/lib/board-reorder.test.ts` for the new signature: existing index-change cases get `intent: true`; board-load and same-index-refetch cases get `intent: true` (index unchanged → false) plus explicit `intent: false` variants; add the remote-reconcile case (`intent: false`, index changed → false) and the passive-refetch case (`intent: false`, index same → false) <!-- R4 R2 -->

## Execution Order

- T001, T002 before T003 (the effect consumes both the ref and the extended helper).
- T003 before T004–T007 (the consumption seam must exist before the intent sites feed it).
- T008 after T002 (tests the new signature).

## Acceptance

### Functional Completeness

- [x] A-001 R1: The focus effect calls `paneRefs.current[focusedIndex]?.focus()` only when a user-intent flag was set for the render that changed the index; `focusIntentRef` is declared beside `focusedKeyRef` with the mirroring comment
- [x] A-002 R4: `shouldFocusPane(intent, prev, current)` returns `intent && prev !== current`; doc comment updated per T002
- [x] A-003 R5: The keyboard cycle, both palette cycle actions, and the pane-click wrapper set the flag only when the index will change; the single-pane cycle and same-index click do not set the flag

### Behavioral Correctness

- [x] A-004 R2: A remote-style `entries` reorder (no intent) does NOT focus a terminal — `shouldFocusPane(false, i, j)` with `i ≠ j` returns `false`; the settled pass no-ops on focus
- [x] A-005 R3: An own move sets intent at initiation, the flag survives the `orderChanged` early-return pass, and the re-entered settled pass focuses the moved pane; a failed reorder POST clears the flag in `.catch`
- [x] A-006 R6: The `focusedKeyRef` / `focusedIndexForKey` / `setFocusedIndex(j)` early-return reconcile is byte-unchanged except for the added intent consumption; the `orderChanged` pass does NOT clear the flag

### Scenario Coverage

- [x] A-007 R4 R2: `board-reorder.test.ts` `shouldFocusPane` suite covers `intent:true`/`intent:false` × index-changed/index-same, including the remote-reconcile (`intent:false`, changed → false) and passive-refetch (`intent:false`, same → false) cases

### Edge Cases & Error Handling

- [x] A-008 R5: Single-pane keyboard/palette cycle does not set the flag (guarded by `entries.length >= 2`); same-index click focuses imperatively without the flag
- [x] A-009 R3: The own-move `.catch` clears the flag so a failed move leaves no stale intent

### Code Quality

- [x] A-010 Pattern consistency: New code follows the surrounding invariant-rationale comment register and mirrors the sidebar `focusMovedRef` pattern (type narrowing over assertions)
- [x] A-011 No unnecessary duplication: `shouldFocusPane` remains the single focus-gate authority; `reorderWithFollow` is the single own-move intent seam feeding both palette move and DnD
- [x] A-012 Client polling: no `setInterval`+fetch introduced; focus remains SSE-echo-driven
- [x] A-013 Tests: `just test-frontend` passes; `cd app/frontend && npx tsc --noEmit` clean

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- Component/e2e coverage (intake item 6): no board-page component test exercises the focus effect today, and there is no board-focus e2e spec. The focus-steal is a cross-client SSE timing behavior; `shouldFocusPane` is the unit-testable single authority and is the robust coverage seam. Adding an e2e that races two clients' `board-changed` events would be flaky and low-value versus the pure-function unit tests. Deferred deliberately, not skipped by omission.

## Deletion Candidates

None — this change extends the existing focus gate in place (`shouldFocusPane` signature widened, `setFocusedIndex` prop replaced by `handlePaneClick`, `reorder` wrapped by `reorderWithFollow`); no existing code was made redundant or unused.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Fix = a true intent ref consumed by the focus gate, mirroring sidebar `focusMovedRef`; only the imperative-focus gate changes, identity reconcile untouched | Intake enumerates it; sidebar precedent is in-repo; `shouldFocusPane`'s comment already cites it as the mirror | S:90 R:90 A:95 D:90 |
| 2 | Confident | Intent sites = keyboard cycle, palette cycle ×2, pane-click wrapper, own reorder (palette move + DnD) via one wrapped `reorderWithFollow` seam | Enumerated from the five `setFocusedIndex` call sites + the two own-move initiators; a missed site degrades to "no focus follow" (safe direction) | S:80 R:85 A:85 D:75 |
| 3 | Confident | Stale-flag discipline: set only when the action will change `focusedIndex` (single-pane cycle guard, same-index imperative click); clear on consumption and on reorder `.catch` | React render semantics (no state change ⇒ no effect ⇒ flag lingers); mirrors the sidebar's same-key imperative branch | S:75 R:85 A:85 D:75 |
| 4 | Confident | Component/e2e coverage deferred to the `shouldFocusPane` unit suite; no board-focus component/e2e spec exists and a two-client SSE-race e2e would be flaky | Intake item 6 is best-effort; the pure gate is the deterministic authority; existing board test files carry no focus-effect harness | S:70 R:90 A:80 D:70 |

4 assumptions (1 certain, 3 confident, 0 tentative).
