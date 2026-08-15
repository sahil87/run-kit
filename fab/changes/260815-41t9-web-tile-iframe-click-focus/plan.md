# Plan: Web Tile Iframe Click Focus

**Change**: 260815-41t9-web-tile-iframe-click-focus
**Intake**: `intake.md`

## Requirements

### Frontend: IframeWindow interaction seam

#### R1: Same-origin contentDocument interaction reporting
`IframeWindow` (`app/frontend/src/components/iframe-window.tsx`) SHALL accept an optional `onInteract?: () => void` prop and, when provided, report in-iframe interaction by attaching capture-phase `pointerdown` and `keydown` listeners on the iframe's `contentDocument` after every iframe `load` event, mirroring `CodeSurface`'s attach pattern: re-attach on every `load` (each navigation replaces the document), guard `contentDocument` access with try/catch (cross-origin access throws — skip silently), remove listeners from the previously-attached document on cleanup/unmount, and hold the callback in a ref so the effect does not churn on prop identity. When the prop is omitted, behavior MUST be byte-for-byte unchanged (other mount contexts pass no `onInteract`).

- **GIVEN** a web tile whose iframe renders a same-origin document (`/proxy/<port>/…` or `/present/…`)
- **WHEN** the user clicks (pointerdown) or types (keydown) anywhere inside the iframe's content
- **THEN** `onInteract` fires in the parent

- **GIVEN** the iframe navigates (a new `load` fires, e.g. the ↻ refresh's about:blank round-trip or a URL-bar change)
- **WHEN** the user next interacts inside the new document
- **THEN** `onInteract` still fires (listeners were re-attached to the fresh document)

- **GIVEN** no `onInteract` prop is passed
- **WHEN** the component mounts and the user interacts with the iframe
- **THEN** nothing is reported and no errors occur — observable behavior unchanged (listeners attach but no-op via the ref, so a handler supplied after mount — a hidden tile's slot -1 → visible transition — starts reporting without a re-attach)

#### R2: Cross-origin blur fallback
When `onInteract` is provided, `IframeWindow` SHALL also attach a parent-`window` `blur` listener (mounted once, removed on unmount) that calls `onInteract` when `document.activeElement` is the component's iframe element at blur time — the standard "focus entered an iframe" detection, covering cross-origin URLs where `contentDocument` is inaccessible.

- **GIVEN** a web tile whose iframe renders a cross-origin document
- **WHEN** the user clicks into the iframe content (focus leaves the parent window; `document.activeElement` becomes the iframe)
- **THEN** the window `blur` handler fires `onInteract`

- **GIVEN** focus leaves the parent window for another browser window/tab (activeElement is NOT the iframe)
- **WHEN** `blur` fires
- **THEN** `onInteract` does NOT fire

Known accepted limitation (intake): once the iframe holds focus, subsequent in-iframe clicks fire no parent events — acceptable because the tile is already focused at that point. No additional refocus bookkeeping is added.

#### R3: Surface-layout wiring and comment correction
`surface-layout.tsx`'s `renderContent` `"web"` case SHALL pass `onInteract={slot >= 0 ? () => focusSlot(slot) : undefined}` to `IframeWindow` — the exact shape the code tile uses. The stale focus-assignment comments (the `renderContent` doc block ~line 791 and the focus-assignment comment ~line 885) SHALL be rewritten to state the real contract: no parent-document focusin fires when focus enters iframe content; in-iframe interaction arrives via each iframe surface's `onInteract` (contentDocument listeners same-origin, window-blur fallback cross-origin); the wrapper's `pointerdown`-capture + focusin seams cover parent-DOM interaction only.

- **GIVEN** a desktop multi-tile layout with a web tile not currently focused
- **WHEN** the user clicks inside the web tile's same-origin iframe content
- **THEN** the web tile becomes the focused tile (accent-green border + glyph) and the focused kind `web` is reported via `onFocusedKindChange` (disabling `ttyOnly` chords — existing gate behavior, now fed truthfully)

### Non-Goals

- No change to `CodeSurface` — its `/code/` embed is same-origin by construction and already has its own seam.
- No shared-hook extraction across the two iframe surfaces (see Design Decisions).
- No change to the `ttyOnly` chord gate or `onFocusedKindChange` contract.
- No e2e addition in this change (see Design Decisions).

### Design Decisions

#### Standalone effect in IframeWindow, no shared hook
**Decision**: Implement the contentDocument attach as a self-contained effect inside `IframeWindow` rather than extracting a shared hook used by both `CodeSurface` and `IframeWindow`.
**Why**: `CodeSurface`'s load-seam is entangled with two other concerns (chord reclaim, folder-follow location reads) and keyed on `reachable`; a shared abstraction would either carry those concerns or force `CodeSurface` refactoring, which the intake explicitly scopes out. The duplicated surface is ~15 lines of well-understood listener plumbing.
**Rejected**: A `useIframeInteract` shared hook — touches `CodeSurface` (out of scope) and couples two seams with different lifecycles for marginal reuse.
*Introduced by*: 260815-41t9-web-tile-iframe-click-focus

#### Unit coverage only, no new e2e case
**Decision**: Cover the seam in jsdom unit tests (`iframe-window.test.tsx` + a `surface-layout.test.tsx` wiring assertion); add no Playwright case.
**Why**: jsdom exercises every branch (same-origin attach, load re-attach, omitted prop, blur fallback) deterministically; the e2e-visible behavior (border flip on in-iframe click) rides an iframe interaction Playwright can drive but that adds a plaintext-origin tile flow to the budget for a mechanism fully proven at unit level. The intake left e2e inclusion to plan discretion.
**Rejected**: Extending `web-view-lens.spec.ts` — cost (multi-tile + iframe click choreography on the ≤2-tile plaintext budget) outweighs marginal proof.
*Introduced by*: 260815-41t9-web-tile-iframe-click-focus

## Tasks

### Phase 2: Core Implementation

- [x] T001 Add optional `onInteract` prop to `app/frontend/src/components/iframe-window.tsx`: ref-held callback; effect attaching capture-phase `pointerdown`/`keydown` on `contentDocument` after every iframe `load` (attach immediately too if a document is already present), try/catch on access, cleanup removes listeners from the attached document; skip everything when the prop is absent at attach time is NOT required — the ref-held callback may simply no-op — but no listener errors may surface either way <!-- R1 -->
- [x] T002 Add the window-`blur` fallback in `app/frontend/src/components/iframe-window.tsx`: mount-scoped listener calling the ref-held `onInteract` when `document.activeElement === iframeRef.current`; removed on unmount <!-- R2 -->
- [x] T003 Wire `onInteract={slot >= 0 ? () => focusSlot(slot) : undefined}` in the `"web"` case of `renderContent` in `app/frontend/src/components/surface-layout.tsx`; rewrite the stale focus-assignment comments (renderContent doc block ~791 and focus-assignment note ~885) per R3 <!-- R3 -->

### Phase 3: Integration & Edge Cases

- [x] T004 [P] Extend `app/frontend/src/components/iframe-window.test.tsx`: `onInteract` fires on synthetic `pointerdown` and `keydown` in the frame document after `load`; re-attaches after a second `load`; omitted prop attaches nothing and errors nothing; blur fallback fires only when `document.activeElement` is the iframe <!-- R1 -->
- [x] T005 [P] Assert the web-tile wiring in `app/frontend/src/components/surface-layout.test.tsx` (web tile receives `onInteract` and invoking it focuses the web slot — mirror how the code-tile wiring is covered), then run the gates: `cd app/frontend && npx tsc --noEmit` and `just test-frontend` <!-- R3 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: Same-origin in-iframe `pointerdown`/`keydown` reaches `onInteract` after initial load AND after a subsequent navigation's `load` re-attach
- [x] A-002 R2: Window `blur` with `document.activeElement === iframe` fires `onInteract`; blur with focus elsewhere does not; listener removed on unmount
- [x] A-003 R3: `surface-layout.tsx` web case passes the slot-focusing `onInteract`; clicking in-iframe content focuses the web tile (border + glyph + reported kind)

### Behavioral Correctness

- [x] A-004 R1: With `onInteract` omitted, `IframeWindow` behavior is unchanged (no new listeners observable, existing tests pass unmodified)

### Scenario Coverage

- [x] A-005 R1: Unit tests cover attach, re-attach, omitted-prop, and blur-fallback branches and pass under `just test-frontend`

### Edge Cases & Error Handling

- [x] A-006 R1: Cross-origin `contentDocument` access is guarded — no thrown error and no console error when the frame is cross-origin or pre-load

### Code Quality

- [x] A-007 Pattern consistency: the new effect mirrors `CodeSurface`'s attach pattern (load re-attach, try/catch posture, ref-held callback) and surrounding naming
- [x] A-008 No unnecessary duplication: no new utility duplicating an existing one; the deliberate non-extraction is recorded in Design Decisions
- [x] A-009 Comments state constraints only — no narration, no change-ID citations in code comments (code-quality anti-pattern list)
- [x] A-010 Type narrowing over assertions — no `as` casts introduced

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds a new `onInteract` focus seam without making existing code redundant

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Standalone effect in `IframeWindow`; no shared-hook extraction touching `CodeSurface` | Intake scopes CodeSurface out (assumption 7); entangled concerns make the abstraction worse than ~15 duplicated lines | S:85 R:90 A:90 D:85 |
| 2 | Confident | No new e2e case — jsdom unit coverage + wiring assertion suffice | Intake assumption 6 delegates the call to plan time; every branch is deterministically provable in jsdom; e2e budget favors omission | S:75 R:85 A:80 D:65 |
| 3 | Certain | Blur fallback is minimal — no refocus bookkeeping for repeated in-iframe clicks | Intake assumption 4 accepts the limitation explicitly (tile already focused once the iframe holds focus) | S:85 R:80 A:90 D:90 |
| 4 | Confident | `keydown` attaches alongside `pointerdown` in the contentDocument seam | Intake specifies both; keydown matters when focus is restored to iframe content via keyboard without a click | S:75 R:85 A:85 D:80 |

4 assumptions (2 certain, 2 confident, 0 tentative).
