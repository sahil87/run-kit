# Plan: Settings Inline Theme Picker

**Change**: 260819-qkow-settings-inline-theme-picker
**Intake**: `intake.md`

## Requirements

### Frontend: Shared Theme-Picker Core

#### R1: Extracted shared picker core
A shared picker-core component (`app/frontend/src/components/theme-picker-list.tsx`, exported as `ThemePickerList`) SHALL own the search input + grouped theme list currently inlined in `ThemeSelector`: query filtering of `THEMES` by name (case-insensitive), DARK-then-LIGHT category grouping with headers, flat keyboard-navigation index that skips headers, ArrowUp/ArrowDown with wraparound, Enter/click confirm, per-theme 7-band palette swatches (background + ANSI 1–6), keyboard-nav mouse-enter suppression, selected-row scroll-into-view, live preview via `previewTheme()` on selection change, and the existing combobox/listbox ARIA wiring. The core MUST NOT own any overlay, backdrop, open/close state, or document-event listener. Checkmark placement MUST be prop-controlled (a set/predicate of checked theme ids) so the two consumers can differ.

- **GIVEN** the core rendered by any consumer
- **WHEN** the user types in the search input and navigates with arrow keys
- **THEN** the list filters by name, selection wraps and skips category headers, the selected theme live-previews, and Enter confirms it via the consumer's confirm handler

#### R2: Modal wrapper behavior unchanged
`ThemeSelector` (`theme-selector.tsx`) SHALL become a thin wrapper around the core, retaining exactly its current external behavior: opens on the `theme-selector:open` document event, fixed `z-50` overlay + backdrop, snapshot of the open-time theme, confirm closes and persists via `setTheme(id)`, Escape/outside-click cancels via `cancelPreview()` and closes, single checkmark on the open-time active theme. All existing entry points (chevron-menu "Theme…" row, palette "Theme: Select Theme") remain untouched.

- **GIVEN** the app with the modal closed
- **WHEN** `theme-selector:open` is dispatched, the user arrows to a theme, then presses Escape
- **THEN** the modal opened, previewed the navigated theme, reverted to the open-time theme, and closed — identical to pre-change behavior

#### R3: Inline picker replaces the settings selects
`ThemePairControl` (`settings-dialog.tsx`) SHALL keep its System/Light/Dark mode button row and replace the two per-mode `<select>`s with the inline core: search on top, scrollable grouped list below (`max-h-64 overflow-y-auto`), within the existing `max-w-[420px]` control envelope. The inline control is collapsed at rest (`collapsible`): a trigger button names the active theme (swatch + name + ▾); clicking it swaps in the focused search field with the list in a popover (`absolute top-full z-50`), which closes on commit, Escape, or focus leave, refocusing the trigger on keyboard/commit closes. Confirm calls `setTheme(theme.id)` (the existing wiring — picking a theme updates its category's preferred slot and switches mode); nothing closes on confirm. The two `<select>`s and their labels MUST be fully removed.

- **GIVEN** the Settings dialog open on the Appearance tab
- **WHEN** the user searches "drac" and clicks Dracula
- **THEN** `setTheme("dracula")` fires (preferred-dark slot updates, mode switches to dark), the row re-renders with Dracula checked, and no `<select>` elements exist in the panel

#### R4: Dual-slot checkmarks on the inline surface
On the settings surface, the core's check-prop SHALL mark the row matching `themeDark` within the DARK group AND the row matching `themeLight` within the LIGHT group (both slots visible at once). The modal keeps its current single open-time-active check via the same prop.

- **GIVEN** `themeDark: "dracula"`, `themeLight: "default-light"` and the Appearance tab open
- **WHEN** the inline list renders
- **THEN** Dracula (DARK group) and Default Light (LIGHT group) both show checkmarks

#### R5: Inline preview cancel semantics
The inline surface SHALL live-preview on hover/keyboard navigation and revert via `cancelPreview()` when the interaction ends without a confirm: pointer leaving the list, focus leaving the picker, the settings dialog closing mid-preview, and Escape pressed in the picker's search input. That Escape MUST cancel only the preview (stopPropagation) without closing the settings dialog — mirroring the file's existing `TextSetting` Escape-scoping pattern; a second Escape (no active preview) closes the dialog as today.

- **GIVEN** the Appearance tab open with theme A committed
- **WHEN** the user arrows over theme B (preview applies) and presses Escape once
- **THEN** the preview reverts to A and the settings dialog stays open; a further Escape closes the dialog

### Tests

#### R6: Unit + e2e coverage updated
`theme-selector.test.tsx` SHALL stay green with its current behavioral coverage (open event, search, keyboard nav, preview, cancel-restore, confirm, checkmark). `settings-dialog.test.tsx` SHALL replace select-based assertions with inline-picker assertions (search filters, dual-slot checkmarks, click-confirm calls `setTheme`, Escape preview-cancel scoping, mode buttons intact). The e2e `settings-dialog.spec.ts` assertion on `getByLabel("Dark theme")` SHALL be updated to the inline picker, and its `.spec.md` companion updated in the same commit (constitution: Test Companion Docs).

- **GIVEN** the full test suite after the change
- **WHEN** `just test-frontend` and the settings-dialog e2e spec run
- **THEN** all pass, with the new assertions exercising the inline picker

### Non-Goals

- No backend/API/persistence changes — `/api/settings/theme`, `theme-context.tsx`, and `themes.ts` are consumed as-is
- No change to the modal's entry points, palette quick-switch actions, or the chevron-menu Theme… row
- No new themes, palette derivation, or tmux-side theme work (`docs/specs/themes.md` contracts untouched)

### Design Decisions

#### Inline embed over modal dispatch
**Decision**: Extract the picker core into a shared component and render it inline in the Appearance control column, rather than dispatching `theme-selector:open` from the settings dialog.
**Why**: Modal-on-modal stacking (both at `z-50`) plus Escape-handler interference; inline is one click fewer, keeps the dialog's VS Code-settings idiom, and the shared core keeps the two surfaces drift-proof.
**Rejected**: Reusing the global modal via the event — would cover the settings dialog, needs stacking/focus fixes, and Escape would close both layers. (Supersedes the memory DD in `run-kit/ui/dialogs-and-state` that chose two `<select>`s to stay self-contained — self-containment is preserved by the inline embed.)
*Introduced by*: 260819-qkow-settings-inline-theme-picker

#### Prop-controlled checkmarks
**Decision**: The core takes a checked-ids prop; settings passes both `themeDark` and `themeLight`, the modal passes its open-time active theme.
**Why**: The dual-slot view is the one thing the dropdowns showed that a single check would lose; the modal's contract stays byte-identical.
**Rejected**: Dual checks everywhere — an unrequested modal behavior change scoped outside this change.
*Introduced by*: 260819-qkow-settings-inline-theme-picker

## Tasks

### Phase 2: Core Implementation

- [x] T001 Create `app/frontend/src/components/theme-picker-list.tsx` (`ThemePickerList`: search + grouped list + swatches + keyboard nav + preview, props for confirm handler, checked theme ids, and Escape handling) by extracting the core from `theme-selector.tsx`; slim `ThemeSelector` to the overlay/open-event/cancel-restore wrapper rendering the core <!-- R1, R2 -->
- [x] T002 Replace the two `<select>`s in `ThemePairControl` (`app/frontend/src/components/settings-dialog.tsx`) with the inline `ThemePickerList` (mode buttons stay; `max-h-64` list in the `max-w-[420px]` envelope; dual-slot checked ids; hover/nav preview with revert-on-leave/blur/dialog-close and Escape preview-cancel scoping per R5) <!-- R3, R4, R5 -->

### Phase 3: Integration & Edge Cases

- [x] T003 [P] Update `app/frontend/src/components/theme-selector.test.tsx`: keep all existing behavioral tests green against the wrapper+core split <!-- R6 -->
- [x] T004 [P] Update `app/frontend/src/components/settings-dialog.test.tsx`: replace select assertions with inline-picker assertions (search filter, dual checkmarks, click-confirm → `setTheme`, Escape preview-cancel does not close the dialog, mode buttons intact) <!-- R6 -->
- [x] T005 [P] Update `app/frontend/tests/e2e/settings-dialog.spec.ts` (the `getByLabel("Dark theme")` assertion → inline picker) and its `settings-dialog.spec.md` companion in the same commit <!-- R6 -->
- [x] T006 Collapse the inline picker at rest: `collapsible` prop on `ThemePickerList` — a trigger button showing the active theme opens the search field + popover list (close on commit/Escape/focus-leave; trigger refocus on keyboard/commit closes; mousedown-preventDefault on the list so option clicks don't blur-close it first), settings passes it; unit + e2e + `.spec.md` updated <!-- R3 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `ThemePickerList` exists as the single shared core (search, grouping, swatches, keyboard nav, preview, ARIA) with no overlay/open-state ownership, and both consumers render it
- [x] A-002 R3: The Appearance tab renders the inline picker with the mode buttons above it; no `<select>` remains in `ThemePairControl`

### Behavioral Correctness

- [x] A-003 R2: The modal's external behavior is unchanged (open event, preview, Escape/outside-click revert+close, Enter confirm+close, single active check)
- [x] A-004 R4: Settings shows dual-slot checkmarks (themeDark in DARK, themeLight in LIGHT); the modal shows exactly one check
- [x] A-005 R5: Inline preview reverts on pointer/focus leave and on a first Escape without closing the settings dialog; confirm commits via `setTheme`

### Removal Verification

- [x] A-006 R3: The `settings-theme-dark` / `settings-theme-light` selects, their labels, and the now-unused `selectClass` are gone with no dead code left behind

### Scenario Coverage

- [x] A-007 R6: Unit tests cover the R3/R4/R5 scenarios in `settings-dialog.test.tsx`; `theme-selector.test.tsx` retains its full behavioral matrix; the e2e spec + `.spec.md` companion are updated together

### Code Quality

- [x] A-008 Pattern consistency: New component follows the codebase's component conventions (colocated tests, Tailwind tokens, `useTheme`/`useThemeActions` hooks, no `as` casts — type narrowing per code-quality.md)
- [x] A-009 No unnecessary duplication: The picker UI exists exactly once (the core); neither consumer re-implements filtering, grouping, nav, or swatches
- [x] A-010 Comment discipline: No comment narration; comments state only constraints the code can't show (per code-quality.md anti-patterns)
- [x] A-011 R3: The inline picker is collapsed at rest — a trigger naming the active theme opens the search-field popover, closing on commit, Escape, and focus leave (unit + e2e covered)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant. The selects, their labels, `selectClass`, and the `THEMES` import in `settings-dialog.tsx` were the only code made redundant, and all were removed in the same diff (verified: no `settings-theme-*`/`selectClass` references remain anywhere in `app/frontend`).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | New core lives in `theme-picker-list.tsx` exported as `ThemePickerList` | Matches sibling kebab-case file / PascalCase export convention; trivially renameable | S:70 R:95 A:90 D:85 |
| 2 | Confident | Escape-scoping implemented as stopPropagation-when-preview-active in the picker, mirroring `TextSetting`'s two-stage Escape | The file already establishes this exact pattern for the same dialog | S:70 R:85 A:85 D:75 |
| 3 | Confident | Dialog-close-mid-preview revert handled via the core's unmount cleanup calling `cancelPreview()` | The settings panel unmounts on dialog close and on tab switch, so unmount cleanup covers leave/close paths uniformly | S:65 R:85 A:80 D:70 |

3 assumptions (0 certain, 3 confident, 0 tentative).
