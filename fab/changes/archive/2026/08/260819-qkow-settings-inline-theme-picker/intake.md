# Intake: Settings Inline Theme Picker

**Change**: 260819-qkow-settings-inline-theme-picker
**Created**: 2026-08-19

## Origin

Conversational — a `/fab-discuss` session exploring the Settings dialog's Appearance tab, then an explicit request:

> i want to move theme [the ThemeSelector modal] to [the Settings → Appearance section] theme, the dropdowns dark theme and light theme can be removed and replace with theme selector

Two implementation shapes were presented (reuse the global modal via the `theme-selector:open` event vs. extract the picker core and embed it inline). The user explicitly chose: **"yes, go ahead with the inline approach"** — accepting the proposed package: inline-embed shape, checkmarks on both preferred-theme slots, keep live preview, mode buttons stay.

## Why

1. **The pain point**: The Appearance tab's theme controls are two plain `<select>` dropdowns (`ThemePairControl` in `settings-dialog.tsx`) — no search, no palette swatches, no live preview. The app already has a much better theme-picking surface (the `ThemeSelector` modal: searchable, grouped DARK/LIGHT, per-theme palette swatches, live preview) but it is only reachable from the top-bar chevron menu and the command palette, not from the settings dialog where a user naturally looks for theme configuration.

2. **The consequence of not fixing**: Two divergent theme-picking experiences — the settings dialog (the canonical preferences surface) offers the worst one, and users configuring appearance never see the swatches/preview affordances that make theme selection usable.

3. **Why inline-embed over reusing the modal**: Dispatching `theme-selector:open` from inside the settings dialog stacks a modal on a modal — both the `Dialog` and the picker overlay sit at `z-50`, and the picker's Escape handler does not `stopPropagation`, so Escape would cancel the preview *and* close the settings dialog underneath. It also covers the settings dialog entirely and costs an extra click. Extracting the search-input + grouped-list core into a shared component and rendering it inline avoids all stacking/focus work, matches the VS Code-settings feel the dialog already imitates (per its own doc comment), and keeps the modal and settings surfaces drift-proof because both render the same core.

**Semantic cleanliness (verified in code)**: both existing surfaces call the same `setTheme(id)` (`theme-context.tsx`), which already handles the slotting internally — picking a dark theme updates the preferred-dark slot and switches mode to dark, and vice versa. The picker's DARK and LIGHT groups therefore *are* the two dropdowns, merged: replacing them loses zero functionality.

## What Changes

### 1. Extract a shared picker core from `theme-selector.tsx`

Pull the reusable core out of `ThemeSelector` (`app/frontend/src/components/theme-selector.tsx`) into a shared component (new file, e.g. `app/frontend/src/components/theme-picker-list.tsx`):

- The search `<input>` (combobox ARIA wiring: `role="combobox"`, `aria-controls`, `aria-autocomplete="list"`) with query-filtering of `THEMES` by name
- The grouped `role="listbox"` list: DARK then LIGHT category headers, flat keyboard-navigation index skipping headers, ArrowUp/ArrowDown wrap, Enter confirms
- Per-theme rows with the 7-band palette swatch (background + ANSI red/green/yellow/blue/magenta/cyan), hover selection with the keyboard-nav mouse-enter suppression (`keyboardNavRef`), scroll-into-view of the selected row
- Live preview on selection change via `previewTheme()` from `useThemeActions()`
- Checkmark rendering, parameterized (see §3)

The core takes props for: confirm handler, which theme id(s) show the checkmark, and whether preview is active. It owns no overlay, backdrop, open/close state, or document-event listener — those stay in the consumers.

### 2. Modal wrapper keeps its existing behavior

`ThemeSelector` becomes a thin wrapper: the `theme-selector:open` document-event listener, the fixed overlay + backdrop at `z-50`, the open-snapshot ref (`openThemeRef`), cancel-restores-on-Escape/outside-click via `cancelPreview()`, close-on-confirm. It renders the extracted core. Every existing entry point (top-bar chevron menu "Theme…" row, command palette "Theme: Select Theme") is untouched — no behavior change on the modal surface.

### 3. Settings Appearance tab: replace the two selects with the inline core

In `ThemePairControl` (`settings-dialog.tsx`):

- **Keep** the System / Light / Dark mode button row exactly as-is — System has no representation in the picker list, so the mode control survives above it
- **Remove** the two labeled `<select>`s (`settings-theme-dark`, `settings-theme-light`)
- **Render** the extracted core inline in the control column: search box on top, scrollable grouped list below (`max-h-64 overflow-y-auto`, matching the modal's sizing), constrained to the control column width (the existing `max-w-[420px]` envelope is a reasonable cap)
- **Checkmarks on both slots**: within the DARK group the row matching `themeDark` is checked; within the LIGHT group the row matching `themeLight` is checked — preserving the one thing the two dropdowns showed that the modal's single active-theme check would not. The modal keeps its current single-check behavior (check = theme active when it opened); the difference is a prop on the core.
- **Confirm**: click or Enter calls `setTheme(theme.id)` — same wiring as today's selects. The inline surface does not close anything on confirm (there is nothing to close); the row simply re-renders with the updated checkmark.
- **Preview**: hover and keyboard navigation live-preview via `previewTheme()`, exactly like the modal. On pointer/focus leaving the picker without a confirm, revert to the committed theme via `cancelPreview()` (the inline analogue of the modal's Escape/outside-click revert). Escape inside the inline search input should cancel the preview without closing the settings dialog (stopPropagation when a preview is active, mirroring the `TextSetting` Escape pattern already in the file).

### 4. Tests

- `theme-selector.test.tsx` — keep the modal's behavioral coverage green through the extraction (open event, search, keyboard nav, preview, cancel-restore, confirm)
- `settings-dialog.test.tsx` — replace the select-based assertions with inline-picker assertions: search filters, both slot checkmarks render, clicking a dark theme calls `setTheme` with its id, mode buttons still work
- New shared-core tests may live with the new file or be covered through the two consumer suites — implementer's choice per existing colocation convention

## Affected Memory

- `run-kit/ui/dialogs-and-state`: (modify) The settings dialog § Appearance tab description ("preferred dark-theme and light-theme `<select>`s") and — critically — the Design Decision recorded at its § Design Decisions ("The dialog's theme-pair surface is self-contained — … two `<select>`s … rather than dispatching `theme-selector:open`"): this change **supersedes that decision** (the self-containment rationale is preserved via inline embed rather than event dispatch; the `<select>` half is retired)
- `run-kit/ui/visual-design`: (modify) § Theme Selector (component anatomy now split into shared core + modal wrapper) and the "three switching surfaces" enumeration (the settings surface is now the same picker core, not a separate select-based control)

## Impact

- **Frontend only** — no backend, API, or persistence changes (`/api/settings/theme` contract untouched; `setTheme`/`previewTheme`/`cancelPreview` in `theme-context.tsx` used as-is)
- Files: `app/frontend/src/components/theme-selector.tsx` (slim to wrapper), new `app/frontend/src/components/theme-picker-list.tsx` (or similar), `app/frontend/src/components/settings-dialog.tsx` (`ThemePairControl`), plus `theme-selector.test.tsx` and `settings-dialog.test.tsx`
- `docs/specs/themes.md` is the human-curated spec for the theme system — no contract it documents changes (palettes, derivation, persistence all untouched); only UI surface composition moves
- The worktree branch `theme-selector` was cut for this work; the change folder/branch naming supersedes it

## Open Questions

- (none — the shape, checkmark semantics, and preview behavior were resolved in the originating discussion)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Inline-embed shape (extract core, render in Appearance column) over dispatching the existing modal | Discussed — user explicitly chose "go ahead with the inline approach" after both shapes were presented with tradeoffs | S:95 R:70 A:95 D:95 |
| 2 | Certain | One shared picker core used by both the modal and the settings surface (no forked copy) | Discussed — drift-proofing was part of the accepted proposal; codebase anti-pattern list forbids duplicating utilities | S:90 R:80 A:90 D:90 |
| 3 | Certain | The System/Light/Dark mode button row stays above the inline picker | Discussed — System has no picker-list representation; explicitly named in the accepted proposal | S:90 R:85 A:90 D:95 |
| 4 | Confident | Dual-slot checkmarks (themeDark in DARK, themeLight in LIGHT) apply to the inline surface only; the modal keeps its single active-theme check via a core prop | The dual-check was accepted for the inline surface; leaving the modal untouched is the conservative reading — behavior change was scoped to settings | S:75 R:85 A:75 D:70 |
| 5 | Confident | Inline preview semantics: hover/keyboard-nav previews, pointer/focus-leave without confirm reverts via `cancelPreview()`, Escape in the search input cancels preview without closing the dialog | "Keep preview" was accepted; the revert-on-leave and Escape-scoping details are the obvious inline analogue of the modal's cancel contract and mirror the file's existing TextSetting Escape pattern | S:65 R:80 A:70 D:60 |
| 6 | Confident | Inline list sizing: search on top, `max-h-64` scrollable list, capped near the existing `max-w-[420px]` control envelope | Matches the modal's proven sizing and the dialog's fixed-height `size="xl"` per-panel scroll design; trivially adjustable | S:60 R:90 A:80 D:70 |
| 7 | Certain | The recorded memory Design Decision (two selects instead of the ThemeSelector) is superseded and must be updated at hydrate, not silently contradicted | Memory is the authoritative record; `dialogs-and-state.md` § Design Decisions explicitly documents the decision this change reverses | S:85 R:80 A:90 D:90 |

7 assumptions (4 certain, 3 confident, 0 tentative, 0 unresolved).
