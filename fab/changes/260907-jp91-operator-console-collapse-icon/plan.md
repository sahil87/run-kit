# Plan: Operator Console Collapse Fixes

**Change**: 260907-jp91-operator-console-collapse-icon
**Intake**: `intake.md`

## Requirements

### Operator Console: Collapse Affordances

#### R1: Header Button Icon
The operator console's header button that hides the drawer MUST use a glyph and `aria-label` that communicate a non-destructive collapse, not a destructive close, reusing the codebase's existing collapse-indicator convention rather than a new icon or icon library.

- **GIVEN** the drawer is open
- **WHEN** the header button is rendered
- **THEN** it SHALL display `▼` (matching `CollapsiblePanel`'s collapse-indicator glyph) with `aria-label="Collapse operator console"`
- **AND** its `onClick` behavior (`setConsoleMachineState("rest")`) SHALL remain unchanged — only the affordance's presentation changes

#### R2: Outside-Click Collapse
The console SHALL collapse to `rest` when a click lands outside its own DOM (the drawer and the top-bar omnibox) while the machine is `open`, without breaking any existing entry-point trigger's own click behavior (the top-bar ◉ button's open⇄rest toggle, a sidebar pinned row's retarget-to-another-server, a palette action).

- **GIVEN** the console machine is `open`
- **WHEN** a click lands on an element outside `isOperatorConsoleTarget` (the drawer or the omnibox)
- **THEN** the machine SHALL transition to `rest`, collapsing the drawer
- **AND** a click on the top-bar ◉ button or a sidebar pinned row (both outside the console's own DOM) SHALL still resolve to that trigger's own intended state (toggle-closed, or open+retargeted), never fighting with the outside-collapse
- **AND** a click landing inside the drawer or the omnibox SHALL NOT collapse the console

#### R3: Opacity Range Floor
The operator console opacity setting MUST accept values from 0.5 to 1.0 inclusive (previously 0.75–1.0), with the existing default (0.9) and ceiling (1.0, disabling the backdrop blur) unchanged.

- **GIVEN** the settings dialog's "Operator console opacity" slider
- **WHEN** rendered
- **THEN** its `min` SHALL be `0.5` and its `max` SHALL remain `1`
- **AND** `clampConsoleOpacity` SHALL clamp any stored or set value into `[0.5, 1.0]`

### Design Decisions

#### Outside-click ordering: capture phase, not bubble
**Decision**: Detect outside clicks with a `document`-level `click` listener registered in the **capture** phase, gated on `isOperatorConsoleTarget(e.target)`.
**Why**: Capture fires before any target element's own `onClick` for the same synchronous click dispatch. This lets legitimate outside triggers (top-bar ◉ button, sidebar pinned row) — which live outside the console's own DOM and would otherwise be misread as "outside clicks" — re-assert their own intended state (toggle, retarget) within that same synchronous dispatch, after the capture listener already ran. No React re-render can land between the capture and bubble phases of one native event, so the ordering is deterministic, not a race.
**Rejected**: A bubble-phase (or `pointerdown`) listener — analysis showed a real race: `pointerdown` creates a natural gap (mousedown → mouseup → click) long enough for React to flush the capture-triggered state change before the target's own click handler reads it, causing the top-bar button's toggle to reopen the drawer it just closed.
*Introduced by*: 260907-jp91-operator-console-collapse-icon

#### Outside-click containment: reuse the existing console-DOM marker
**Decision**: Gate the outside-click check on the existing `isOperatorConsoleTarget`/`OPERATOR_CONSOLE_ROOT_ATTR` helper (already applied to both the drawer and the top-bar omnibox for recognizing console-owned paste/drop events) rather than inventing a new containment mechanism or tagging every entry-point trigger element.
**Why**: The marker already spans exactly the console's own interactive DOM; reusing it avoids a second parallel "is this console-owned" mechanism and avoids touching unrelated trigger components (top-bar button, sidebar row) at all — capture-phase ordering (above) is what protects those, not tagging.
**Rejected**: Adding the marker to every entry-point trigger (top-bar button, sidebar pinned row) — unnecessary once capture-phase ordering was confirmed to resolve the conflict, and would have required touching shared components (`window-row.tsx`) used by many non-operator rows.
*Introduced by*: 260907-jp91-operator-console-collapse-icon

## Tasks

### Phase 1: Core Implementation

- [x] T001 [P] Header button: replace `✕` with `▼` and `aria-label="Close operator console"` with `"Collapse operator console"` in `app/frontend/src/components/operator-console.tsx`; update the file's doc comments (machine description, anatomy paragraph) to describe the collapse affordance and the new outside-click behavior. <!-- R1 -->
- [x] T002 Add the capture-phase outside-click-collapse effect to `app/frontend/src/components/operator-console.tsx` (gated on `machine === "open"`, using `isOperatorConsoleTarget` imported from `@/lib/operator-console`), placed after the existing Escape-key effect. <!-- R2 -->
- [x] T003 [P] Widen the opacity floor: `CONSOLE_OPACITY_MIN` `0.75` → `0.5` in `app/frontend/src/lib/operator-console.ts` (update `clampConsoleOpacity`'s doc comment), and update `ConsoleOpacityControl`'s doc comment in `app/frontend/src/components/settings-dialog.tsx`. <!-- R3 -->

### Phase 2: Test Coverage

- [x] T004 Update existing opacity-clamp assertions to the new 0.5 floor: `app/frontend/src/lib/operator-console.test.ts` (`clampConsoleOpacity` test) and `app/frontend/src/components/settings-dialog.test.tsx` (slider `min` attribute). <!-- R3 -->
- [x] T005 Add outside-click tests to `app/frontend/src/components/operator-console.test.tsx`: a click outside the open drawer collapses it to `rest`; a click inside the drawer does not collapse it; a real DOM click on an external trigger that re-opens/retargets the console (simulating the top-bar button / sidebar row case) wins over the outside-collapse, verifying the capture-phase ordering decision. <!-- R2 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: The header button renders `▼` with `aria-label="Collapse operator console"`; its `onClick` still calls `setConsoleMachineState("rest")` unchanged. (operator-console.tsx:619-627)
- [x] A-002 R2: With the console `open`, a click outside the drawer and omnibox transitions the machine to `rest` and the drawer unmounts (through the exit slide). (test "a click outside the console's DOM collapses the open drawer to rest" passes)
- [x] A-003 R3: The settings slider's `min` attribute is `0.5`; `clampConsoleOpacity(0.2)` returns `0.5`. (settings-dialog.test.tsx slider assertion; operator-console.test.ts clamp test — both pass)

### Behavioral Correctness

- [x] A-004 R2: A real DOM click on the top-bar ◉ button (open→rest toggle) or a simulated external retarget trigger resolves to that trigger's own intended state, not to a stale collapse. (retarget test passes; ◉ toggle verified by trace — `machineRef` is render-assigned and React 19 batching guarantees no re-render between capture and bubble of one native click dispatch, so `button` maps open→rest, the same destination the capture listener already wrote)
- [x] A-005 R3: `CONSOLE_OPACITY_DEFAULT` (0.9) and `CONSOLE_OPACITY_MAX` (1.0) are unchanged; opacity ≥ 1 still disables `backdropFilter`. (diff touches only `CONSOLE_OPACITY_MIN`; glassStyle `opacity < 1` gate at operator-console.tsx:539 intact)

### Scenario Coverage

- [x] A-006 R2: A click landing inside the drawer (e.g. on its own root element) does not collapse it. (test "a click inside the drawer does not collapse it" passes)
- [x] A-007 R1: No other file in the repo still references the old `✕` glyph or `"Close operator console"` aria-label for this button (verified by repo-wide grep — remaining `✕` uses are unrelated components; no "Close operator console" matches).

### Edge Cases & Error Handling

- [x] A-008 R2: The capture-phase listener is scoped to `machine === "open"` only — it does not attach (and cannot mis-fire) while the console is `rest` or `focused`. (operator-console.tsx:384 early-return)

### Code Quality

- [x] A-009 Pattern consistency: New code follows naming and structural patterns of surrounding code (bare Unicode glyphs, no icon library, existing `isOperatorConsoleTarget` helper reused as-is).
- [x] A-010 No unnecessary duplication: Existing utilities reused where applicable (`isOperatorConsoleTarget`/`OPERATOR_CONSOLE_ROOT_ATTR`, `CollapsiblePanel`'s glyph convention) instead of new mechanisms.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality (outside-click collapse) and replaces the header glyph/aria-label and the opacity-floor constant in place, without making any existing code redundant or unused.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Outside-click collapse gates on `machine === "open"` only (not `"focused"`) | `"focused"` has no visible drawer — the omnibox's own blur handler already returns it to rest when appropriate; an outside-click check there would be a no-op at best and a double-transition at worst | S:75 R:90 A:95 D:90 |
| 2 | Certain | Capture-phase `document` `click` listener, not `pointerdown`/bubble | Verified by code-trace timing analysis: capture-then-bubble for one native event is fully synchronous (no intervening React re-render), which is what makes external triggers' own re-assertion race-free; `pointerdown` reintroduces a real gap that flips the top-bar button's toggle direction | S:70 R:85 A:90 D:85 |
| 3 | Certain | Reuse `isOperatorConsoleTarget`/`OPERATOR_CONSOLE_ROOT_ATTR` rather than tagging every entry-point trigger | The marker already spans exactly the console's own DOM; capture-phase ordering (not tagging) is what protects external triggers, so no additional marker placement is needed | S:65 R:85 A:90 D:85 |

3 assumptions (3 certain, 0 confident, 0 tentative).
