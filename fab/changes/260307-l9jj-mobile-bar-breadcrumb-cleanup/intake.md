# Intake: Mobile Bottom Bar & Breadcrumb Cleanup

**Change**: 260307-l9jj-mobile-bar-breadcrumb-cleanup
**Created**: 2026-03-07
**Status**: Draft

## Origin

> User screenshot of the terminal page on iOS showing four specific UI problems: (1) the iOS autofill/credential suggestion bar consuming vertical space, (2) too many buttons in the modifiers row, (3) the upload button taking a slot that could be used better, (4) breadcrumb dropdown arrows adding visual noise. Conversational — all four changes discussed and agreed before intake.

Interaction mode: conversational (arose from `/fab-discuss` session with screenshot review). All decisions resolved during discussion.

## Why

1. **Vertical space is precious on mobile**: The iOS autofill bar (key/card/pin/checkmark row) appears when input is focused, eating ~44px of already-scarce vertical space. The only useful action in that bar — keyboard dismiss — has no equivalent in our UI.
2. **Bottom bar has too many buttons**: The current modifiers row has 10 interactive elements: `⎋ ⇥ ^ ⌥ ⌘ ↑(arrows) F▲ ⋯ 📎 >_`. On a 390px screen this wraps or crowds. Two buttons (`⋯` extended keys, `📎` upload) can be consolidated elsewhere without losing functionality.
3. **No keyboard dismiss control**: iOS shows a checkmark in the autofill bar to dismiss the keyboard, but if we suppress that bar (or it's not shown), there's no way to dismiss the keyboard from our UI.
4. **Breadcrumb arrows waste space**: Each breadcrumb with a dropdown shows `icon label ▾`. The `▾` arrow is redundant — the icon itself can serve as the dropdown trigger, saving horizontal space in the navbar.

If we don't do this: the modifiers row stays crowded, there's no reliable keyboard dismiss, and the breadcrumb wastes horizontal space that matters on narrow screens.

## What Changes

### 1. Merge Extended Keys into F-Key Dropdown

**Current state** (`src/components/bottom-bar.tsx`):
- `F▲` button opens a 4-column grid popup with F1-F12 (12 items, `FN_KEYS` array)
- `⋯` button opens a 3-column grid popup with PgUp, PgDn, Home, End, Ins, Del (6 items, `EXT_KEYS` array)
- Two separate dropdowns, two refs (`fnRef`, `extRef`), two open states (`fnOpen`, `extOpen`)

**Target state**:
- Single `F▲` button opens a combined popup with two sections:
  - **Top section**: F1-F12 in a 4-column grid (same as current)
  - **Bottom section**: Divider line, then PgUp, PgDn, Home, End, Ins, Del in a 3-column grid
- Remove the `⋯` button, `extRef`, `extOpen` state, and `EXT_KEYS`-specific close handlers
- The `EXT_KEYS` array stays as data — it just renders inside the combined popup

### 2. Move Upload Button into Compose Buffer

**Current state**:
- `📎` button in `bottom-bar.tsx` (lines 283-306) with a hidden `<input type="file">` triggers `onUploadFiles`
- `ComposeBuffer` (`src/components/compose-buffer.tsx`) shows textarea + Send button

**Target state**:
- Remove `📎` button and hidden file input from `bottom-bar.tsx`
- Move file upload into `compose-buffer.tsx`: show an upload button (paperclip icon) to the left of the Send button in the `flex justify-end mt-2` row
- The hidden `<input type="file">` moves to `compose-buffer.tsx`
- `onUploadFiles` prop moves from `BottomBar` to `ComposeBuffer`
- Upload results still append to the textarea via `initialText` / the existing append-on-change effect

### 3. Add Keyboard Dismiss Button

**Target state**:
- New `⌄` (down chevron) button in the modifiers row, positioned after the F▲ dropdown (in the slot freed by removing `⋯`)
- On click: calls `document.activeElement?.blur()` to collapse the iOS software keyboard
- Uses the same `KBD_CLASS` styling as other buttons
- `aria-label="Dismiss keyboard"`

**Final modifiers row layout**: `⎋ ⇥ | ^ ⌥ ⌘ | ↑(arrows) F▲ ⌄ | >_`

That's 9 items (down from 10), with the added benefit of keyboard dismiss.

### 4. Breadcrumb Icons as Dropdown Triggers

**Current state** (`src/components/top-bar-chrome.tsx` + `src/components/breadcrumb-dropdown.tsx`):
- Each breadcrumb renders: `icon label ▾` where `▾` is a separate `<button>` in `BreadcrumbDropdown`
- The icon (`⬡` for project, `❯` for window) is a passive `<span aria-hidden="true">`

**Target state**:
- The `▾` button is removed from `BreadcrumbDropdown`
- Instead, the icon `<span>` in `top-bar-chrome.tsx` becomes the dropdown trigger — wrap it in a `<button>` (or make it the click target that opens the dropdown)
- Two approaches:
  - **(A)** Move the toggle into `BreadcrumbDropdown` but render the icon as the trigger instead of `▾`
  - **(B)** Lift the open state up: icon in `TopBarChrome` controls open/close, `BreadcrumbDropdown` receives `open` as a prop
- Approach (A) is simpler: pass the `icon` into `BreadcrumbDropdown` and render it as the button content instead of `▾`. The component already has the toggle, outside-click, and keyboard handling.

Resulting breadcrumb: `⬡ projectName › ❯ windowName` where `⬡` opens the project dropdown and `❯` opens the window dropdown.

## Affected Memory

- `run-kit/ui-patterns`: (modify) Update bottom bar layout documentation and breadcrumb interaction pattern

## Impact

- **Modified files**:
  - `src/components/bottom-bar.tsx` — merge dropdowns, remove upload button, add dismiss button
  - `src/components/compose-buffer.tsx` — add upload button + hidden file input
  - `src/components/breadcrumb-dropdown.tsx` — render icon as trigger instead of `▾`
  - `src/components/top-bar-chrome.tsx` — pass icon into `BreadcrumbDropdown`, remove passive icon span
- **No new files**: All changes are modifications to existing components
- **Risk**: Low — UI-only changes, no backend/API changes, no state management changes

## Open Questions

None — all decisions resolved during discussion.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Merge EXT_KEYS into FN_KEYS popup as a second section | Discussed — user explicitly requested merging Home/End etc into F-key dropdown | S:95 R:90 A:90 D:95 |
| 2 | Certain | Move upload button from bottom bar into compose buffer, left of Send | Discussed — user explicitly requested this relocation | S:95 R:90 A:90 D:95 |
| 3 | Certain | Add keyboard dismiss button (⌄) to modifiers row | Discussed — replaces iOS autofill bar's checkmark functionality | S:90 R:95 A:85 D:90 |
| 4 | Certain | Use `document.activeElement?.blur()` for keyboard dismiss | Discussed — standard approach for collapsing iOS keyboard | S:85 R:95 A:90 D:90 |
| 5 | Certain | Remove `▾` arrow from breadcrumb dropdowns, use icon as trigger | Discussed — user explicitly requested icons serve as dropdown triggers | S:95 R:90 A:90 D:95 |
| 6 | Confident | Pass icon into BreadcrumbDropdown component (approach A) | Simpler than lifting state — component already has toggle/keyboard/outside-click handling | S:70 R:95 A:85 D:75 |
| 7 | Confident | Combined popup uses divider line between F-keys and nav keys sections | Reasonable visual separation — exact styling is easily adjusted | S:60 R:95 A:80 D:75 |
| 8 | Confident | Final row layout: ⎋ ⇥ | ^ ⌥ ⌘ | ↑ F▲ ⌄ | >_ | Discussed layout — exact ordering follows current pattern with dismiss replacing extended keys slot | S:80 R:95 A:85 D:80 |

8 assumptions (5 certain, 3 confident, 0 tentative, 0 unresolved).
