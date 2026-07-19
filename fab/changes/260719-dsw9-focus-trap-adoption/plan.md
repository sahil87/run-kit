# Plan: Dialog and CommandPalette Adopt useFocusTrap

**Change**: 260719-dsw9-focus-trap-adoption
**Intake**: `intake.md`

## Requirements

### Frontend: Dialog focus-trap adoption

#### R1: Dialog consumes useFocusTrap
`Dialog` (`app/frontend/src/components/dialog.tsx`) SHALL delete its hand-rolled focus-trap logic (the `handleKeyDown` callback, the `onCloseRef` plumbing, and the mount effect) and instead call `useFocusTrap(dialogRef, true, onClose)`. `dialogRef` stays attached to the same `role="dialog" aria-modal="true"` div. Observable behavior MUST be preserved: first focusable focused on mount, Escape calls `onClose` (latest closure), Tab/Shift+Tab wrap at the boundaries using the identical FOCUSABLE selector.

- **GIVEN** a mounted `Dialog` containing focusable children
- **WHEN** it mounts
- **THEN** the first focusable element inside the dialog receives focus
- **AND** Escape anywhere calls `onClose`, Tab from the last focusable wraps to the first, Shift+Tab from the first wraps to the last

#### R2: CommandPalette consumes useFocusTrap
`CommandPalette` (`app/frontend/src/components/command-palette.tsx`) SHALL attach a new `paletteRef` to the modal div (`role="dialog" aria-modal="true"`) and call `useFocusTrap(paletteRef, open, () => setOpen(false))`. The `Escape` branch of the input's `onKeyDown` handler SHALL be removed (the hook owns Escape at document level), and the `useEffect` that focuses `inputRef` on open SHALL be removed (the hook focuses the container's first focusable, which is the input — it is in fact the container's *only* focusable, since options are `<div role="option">`). ArrowDown/ArrowUp/Enter handling on the input SHALL remain unchanged, as SHALL the `Cmd+K` toggle and `palette:open` listeners.

- **GIVEN** the palette is open
- **WHEN** Escape is pressed with focus on any element inside the palette (input or an option row)
- **THEN** the palette closes
- **AND** Tab/Shift+Tab cannot move focus out of the palette (the trap wraps within it), and the input receives focus on open

#### R3: Hook doc comment names its consumers
The `useFocusTrap` doc comment (`app/frontend/src/hooks/use-focus-trap.ts`) SHALL replace the stale line "Mirrors the focus-cycle contract proven in `dialog.tsx` / `command-palette.tsx`" with a line naming the current consumers: Shell mobile drawer, Dialog, CommandPalette.

- **GIVEN** the hook file after this change
- **WHEN** the doc comment is read
- **THEN** it names Shell drawer, Dialog, and CommandPalette as consumers and no longer claims the components "prove" the contract independently

### Frontend: Tests

#### R4: Tests lock the migrated trap behavior
A new `dialog.test.tsx` SHALL cover: renders title/children, first focusable receives focus on mount, Escape calls `onClose`, Tab wraps at both boundaries. `command-palette.test.tsx` SHALL be extended with: Escape pressed from an option row closes the palette, and Tab from the input does not move focus out of the palette (single-focusable wrap). All existing frontend tests (including the palette's "closes on Escape" and "focuses the search input when opened") MUST keep passing.

- **GIVEN** the migrated components
- **WHEN** `just test-frontend` and `just check` run
- **THEN** all suites pass, including the new/extended cases

### Non-Goals

- No focus-return-on-close behavior is added (matches the existing contract across all three consumers).
- No change to the palette's list-navigation model (ArrowUp/ArrowDown/Enter, `aria-activedescendant`) or to making option rows tabbable.
- No memory edits during apply — `run-kit/ui-patterns` § Mobile drawer focus trap updates at hydrate.

## Tasks

### Phase 2: Core Implementation

- [x] T001 Migrate `app/frontend/src/components/dialog.tsx`: delete `handleKeyDown`/`onCloseRef`/mount effect, call `useFocusTrap(dialogRef, true, onClose)`, drop now-unused imports (`useCallback`, and `useEffect` if unused) <!-- R1 -->
- [x] T002 Migrate `app/frontend/src/components/command-palette.tsx`: add `paletteRef` on the modal div, call `useFocusTrap(paletteRef, open, () => setOpen(false))`, remove the Escape branch from the input `handleKeyDown`, remove the focus-input-on-open effect and the now-unused `inputRef` <!-- R2 -->
- [x] T003 [P] Update the stale consumer line in the `useFocusTrap` doc comment in `app/frontend/src/hooks/use-focus-trap.ts` <!-- R3 -->

### Phase 3: Integration & Edge Cases

- [x] T004 [P] Add `app/frontend/src/components/dialog.test.tsx`: renders title/children; first focusable focused on mount; Escape calls `onClose`; Tab wraps last→first; Shift+Tab wraps first→last <!-- R4 -->
- [x] T005 [P] Extend `app/frontend/src/components/command-palette.test.tsx`: Escape fired on an option row closes the palette; Tab on the input keeps focus inside the palette (wraps to the input, its sole focusable) <!-- R4 -->
- [x] T006 Run `just check` and `just test-frontend`; fix any failures (max 3 attempts each) <!-- R4 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `dialog.tsx` contains no hand-rolled keydown/focus logic — the trap is exactly `useFocusTrap(dialogRef, true, onClose)`
- [x] A-002 R2: `command-palette.tsx` calls `useFocusTrap(paletteRef, open, ...)` with `paletteRef` on the `role="dialog"` div; input keydown handles only ArrowDown/ArrowUp/Enter
- [x] A-003 R3: hook doc comment names Shell drawer, Dialog, CommandPalette as consumers

### Behavioral Correctness

- [x] A-004 R1: Dialog behavior is byte-equivalent in effect: mount-focus, Escape→onClose, Tab wrap both directions
- [x] A-005 R2: palette Escape now closes from any focused element inside the palette, and Tab cannot walk focus out of the `aria-modal` container (intended a11y improvements)

### Removal Verification

- [x] A-006 R2: the focus-input-on-open effect and unused `inputRef` are gone from `command-palette.tsx`; no dead imports remain in either component

### Scenario Coverage

- [x] A-007 R4: `dialog.test.tsx` exists and covers mount-focus, Escape, and both Tab-wrap directions
- [x] A-008 R4: `command-palette.test.tsx` covers Escape-from-option-row and Tab containment; the pre-existing "closes on Escape" and "focuses the search input when opened" tests pass unmodified

### Code Quality

- [x] A-009 Pattern consistency: migration mirrors the existing `shell.tsx` hook consumption pattern (ref + active flag + onEscape closure)
- [x] A-010 No unnecessary duplication: the FOCUSABLE selector and trap logic exist only in `use-focus-trap.ts` after this change

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — the refactor's redundancy was already removed during apply (the hand-rolled trap in `dialog.tsx`, and the input `onKeyDown` Escape branch, focus-on-open effect, and `inputRef` in `command-palette.tsx`). The FOCUSABLE selector and trap logic now exist solely in `use-focus-trap.ts`; no further redundant code remains.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Dialog swap is exactly `useFocusTrap(dialogRef, true, onClose)` with all hand-rolled logic deleted | Intake specifies it verbatim; hook verified line-for-line equivalent to the deleted code | S:85 R:90 A:95 D:90 |
| 2 | Confident | Palette option rows are `<div role="option">` (not buttons), so the input is the container's sole focusable; "Tab wraps from last option back to the input" is implemented/tested as Tab-containment on the input, and Escape-from-option is tested by firing keydown on an option div (bubbles to the hook's document listener) | Verified in current `command-palette.tsx` DOM; intake's "option button" wording mis-describes the markup but the behavioral intent (Escape from anywhere, no focus escape) is unchanged | S:65 R:85 A:90 D:75 |
| 3 | Confident | Remove `inputRef` entirely from `command-palette.tsx` | Intake instructs removal if its only use was the removed focus effect; grep confirms uses were declaration, the effect, and the ref attachment only | S:75 R:95 A:90 D:85 |
| 4 | Certain | Verification is `just check` + `just test-frontend` only (no e2e) | Dispatch environment rules pin the recipes; project testing docs mandate `just` | S:90 R:95 A:95 D:95 |

4 assumptions (2 certain, 2 confident, 0 tentative).
