# Spec: Mobile Bottom Bar & Breadcrumb Cleanup

**Change**: 260307-l9jj-mobile-bar-breadcrumb-cleanup
**Created**: 2026-03-07
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`

## Bottom Bar: Combined Function & Extended Keys Popup

### Requirement: Single Combined Popup

The `F▴` button SHALL open a single popup containing both function keys (F1-F12) and extended navigation keys (PgUp, PgDn, Home, End, Ins, Del). The separate `⋯` extended keys button and its dropdown SHALL be removed.

#### Scenario: Opening the combined popup
- **GIVEN** the terminal page is loaded with the bottom bar visible
- **WHEN** the user taps the `F▴` button
- **THEN** a single popup appears with F1-F12 in a 4-column grid at the top
- **AND** a visual divider separates the two sections
- **AND** PgUp, PgDn, Home, End, Ins, Del appear in a 3-column grid below the divider

#### Scenario: Sending a key from the extended section
- **GIVEN** the combined popup is open
- **WHEN** the user taps "PgUp"
- **THEN** the correct escape sequence is sent via WebSocket (respecting armed modifiers)
- **AND** the popup closes

### Requirement: Cleanup of Extended Keys State

The `extOpen` state, `extRef` ref, and the `⋯` button element SHALL be removed from `bottom-bar.tsx`. The `EXT_KEYS` array SHALL remain as data, rendered inside the combined popup.

#### Scenario: No residual extended keys UI
- **GIVEN** the bottom bar is rendered
- **WHEN** inspecting the DOM
- **THEN** there is no button with aria-label "Extended keys"
- **AND** there is only one popup-triggering button for function/navigation keys

## Bottom Bar: Upload Button Relocation

### Requirement: Remove Upload from Bottom Bar

The upload button (`📎`) and its hidden `<input type="file">` SHALL be removed from `bottom-bar.tsx`. The `onUploadFiles` prop SHALL be removed from `BottomBar`.

#### Scenario: Bottom bar without upload
- **GIVEN** the terminal page is loaded
- **WHEN** the bottom bar renders
- **THEN** there is no upload/paperclip button in the bottom bar
- **AND** the `BottomBar` component does not accept an `onUploadFiles` prop

### Requirement: Upload in Compose Buffer

The `ComposeBuffer` component SHALL include an upload button (paperclip icon) to the left of the Send button in the action row. A hidden `<input type="file" multiple>` SHALL be added to `compose-buffer.tsx`. The `ComposeBuffer` SHALL accept an `onUploadFiles` prop.

#### Scenario: Upload from compose buffer
- **GIVEN** the compose buffer is open
- **WHEN** the user taps the upload button (paperclip icon)
- **THEN** the native file picker opens
- **AND** selected files are passed to `onUploadFiles`

#### Scenario: Upload result appends to textarea
- **GIVEN** files are uploaded via the compose buffer's file picker
- **WHEN** the upload completes and `initialText` updates
- **THEN** the file paths are appended to the textarea content (existing behavior via `initialText` effect)

## Bottom Bar: Keyboard Dismiss Button

### Requirement: Dismiss Button

A new dismiss button (`⌄`, down chevron) SHALL be added to the bottom bar modifiers row, positioned after the `F▴` dropdown (in the slot freed by removing `⋯`).

#### Scenario: Dismissing the iOS keyboard
- **GIVEN** the software keyboard is visible on iOS
- **WHEN** the user taps the `⌄` button
- **THEN** `document.activeElement?.blur()` is called
- **AND** the iOS software keyboard collapses

#### Scenario: Button styling and accessibility
- **GIVEN** the bottom bar is rendered
- **WHEN** inspecting the dismiss button
- **THEN** it uses `KBD_CLASS` styling consistent with other buttons
- **AND** it has `aria-label="Dismiss keyboard"`

### Requirement: Final Row Layout

The bottom bar modifiers row SHALL render in this order: `⎋ ⇥ | ^ ⌥ ⌘ | ↑(arrows) F▲ ⌄ | >_`

That is 9 interactive elements (down from 10), with `⌄` replacing the `⋯` slot and `📎` removed entirely.

#### Scenario: Button count verification
- **GIVEN** the terminal page is loaded on a 390px screen
- **WHEN** counting interactive elements in the bottom bar
- **THEN** there are exactly 9 interactive elements (Esc, Tab, Ctrl, Alt, Cmd, ArrowPad, F-keys, Dismiss, Compose)

## Breadcrumb: Icon as Dropdown Trigger

### Requirement: Remove Chevron Trigger

The `▾` button in `BreadcrumbDropdown` SHALL be removed. The component SHALL instead render the breadcrumb icon as the dropdown trigger button.

#### Scenario: Icon triggers dropdown
- **GIVEN** the terminal page breadcrumb shows `⬡ projectName › ❯ windowName`
- **WHEN** the user taps the `⬡` icon
- **THEN** the project switching dropdown opens
- **AND** tapping `❯` opens the window switching dropdown

#### Scenario: No chevron in breadcrumb
- **GIVEN** the breadcrumb is rendered
- **WHEN** inspecting the DOM
- **THEN** there are no `▾` characters in the breadcrumb area

### Requirement: Pass Icon to BreadcrumbDropdown

`TopBarChrome` SHALL pass the `icon` string into `BreadcrumbDropdown` via a new `icon` prop. `BreadcrumbDropdown` SHALL render this icon as the button content instead of `▾`. The passive `<span aria-hidden="true">` for the icon in `TopBarChrome` SHALL be removed (the icon is now rendered inside `BreadcrumbDropdown`).

#### Scenario: Component interface
- **GIVEN** a breadcrumb with `icon: "⬡"` and `dropdownItems` configured
- **WHEN** `TopBarChrome` renders the breadcrumb
- **THEN** `BreadcrumbDropdown` receives `icon="⬡"` and renders it as the toggle button content
- **AND** the icon is not rendered separately as a passive span in `TopBarChrome`

### Requirement: Preserved Dropdown Behavior

All existing dropdown behavior SHALL be preserved: outside-click dismiss, Escape dismiss, ArrowUp/ArrowDown navigation, ARIA `role="menu"`/`role="menuitem"`, capture-phase keyboard handling, auto-focus on current item.

#### Scenario: Keyboard navigation still works
- **GIVEN** the project dropdown is open (triggered by tapping `⬡`)
- **WHEN** the user presses ArrowDown
- **THEN** focus moves to the next item in the list
- **AND** pressing Escape closes the dropdown and returns focus to the icon button

## Deprecated Requirements

### Separate Extended Keys Dropdown

**Reason**: Merged into the function keys popup to reduce button count.
**Migration**: All extended keys (PgUp, PgDn, Home, End, Ins, Del) are now in the combined `F▴` popup's lower section.

### Upload Button in Bottom Bar

**Reason**: Relocated to compose buffer to free bottom bar space.
**Migration**: Upload functionality available via paperclip button in compose buffer's action row, plus existing clipboard paste, drag-and-drop, and command palette entry points.

### Chevron (▾) Breadcrumb Dropdown Trigger

**Reason**: Replaced by icon-as-trigger to save horizontal space.
**Migration**: Breadcrumb icons (`⬡`, `❯`) now serve as dropdown triggers with identical dropdown behavior.

## Design Decisions

1. **Pass icon into BreadcrumbDropdown (Approach A)**: Simpler than lifting open state to TopBarChrome.
   - *Why*: BreadcrumbDropdown already owns toggle, outside-click, keyboard handling, and ARIA. Adding an `icon` prop keeps all dropdown logic in one component.
   - *Rejected*: Approach B (lift state to TopBarChrome) — adds prop threading and splits dropdown control across two components for no benefit.

2. **Combined popup with divider**: F-keys on top (4-col grid), divider, nav keys on bottom (3-col grid).
   - *Why*: Groups keys by function (function vs navigation) while maintaining a single popup entry point.
   - *Rejected*: Single flat grid — different key groups have different column counts, would look unbalanced.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Merge EXT_KEYS into FN_KEYS popup as a second section | Confirmed from intake #1 — user explicitly requested | S:95 R:90 A:90 D:95 |
| 2 | Certain | Move upload button from bottom bar into compose buffer, left of Send | Confirmed from intake #2 — user explicitly requested | S:95 R:90 A:90 D:95 |
| 3 | Certain | Add keyboard dismiss button (down chevron) to modifiers row | Confirmed from intake #3 — replaces iOS autofill bar checkmark | S:90 R:95 A:85 D:90 |
| 4 | Certain | Use `document.activeElement?.blur()` for keyboard dismiss | Confirmed from intake #4 — standard iOS keyboard dismissal | S:85 R:95 A:90 D:90 |
| 5 | Certain | Remove `▾` arrow from breadcrumb dropdowns, use icon as trigger | Confirmed from intake #5 — user explicitly requested | S:95 R:90 A:90 D:95 |
| 6 | Certain | Pass icon into BreadcrumbDropdown component (approach A) | Confirmed from intake #6 — spec analysis confirms component already owns all dropdown logic | S:85 R:95 A:90 D:85 |
| 7 | Confident | Combined popup uses a `border-t border-border` divider between sections | Standard Tailwind border pattern used elsewhere in codebase | S:65 R:95 A:85 D:75 |
| 8 | Confident | Final row layout: Esc Tab | Ctrl Alt Cmd | ArrowPad F-keys Dismiss | Compose | Confirmed from intake #8 — matches discussed layout | S:80 R:95 A:85 D:80 |
| 9 | Confident | Upload button uses same paperclip emoji (📎) as the current bottom bar button | Visual consistency with command palette "Upload file" action | S:70 R:95 A:80 D:80 |

9 assumptions (6 certain, 3 confident, 0 tentative, 0 unresolved).
