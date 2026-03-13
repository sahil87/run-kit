# Spec: UI Chrome & Layout Refinements

**Change**: 260312-y4ci-ui-chrome-layout-refinements
**Created**: 2026-03-13
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`, `docs/memory/run-kit/architecture.md`

## Non-Goals

- Changing the BreadcrumbDropdown component internals — only the icon props and surrounding markup in `top-bar.tsx` change
- Changing mobile drawer behavior — the drawer overlay remains as-is
- Changing bottom bar key layout or functionality — only its position in the DOM tree and padding change
- Changing terminal-client.tsx or WebSocket relay behavior

## Top Bar: Simplified Breadcrumbs

### Requirement: Unified Breadcrumb Separator Icon

The top bar breadcrumb SHALL use `❯` (U+276F) as the sole separator/dropdown-trigger icon for both session and window segments. The `›` (U+203A) separator spans and `⬡` (U+2B21) session icon SHALL be removed.

The resulting breadcrumb structure SHALL be: `☰ {logo} ❯ {session} ❯ {window}`

#### Scenario: Desktop breadcrumb rendering
- **GIVEN** a connected session "run-kit" with active window "zsh"
- **WHEN** the top bar renders
- **THEN** the breadcrumb displays: `☰ {logo} ❯ run-kit ❯ zsh`
- **AND** there are no `›` separator spans in the DOM
- **AND** both BreadcrumbDropdown components receive `icon="\u276F"` (❯)

#### Scenario: Session dropdown still functional
- **GIVEN** the simplified breadcrumb
- **WHEN** the user clicks the `❯` icon before the session name
- **THEN** the session dropdown opens listing all sessions
- **AND** selecting a session navigates to that session's first window

### Requirement: Top Bar Border

The `<header>` element in `top-bar.tsx` SHALL have `border-b border-border` applied to create a visible separation between the top bar and the main content area.

#### Scenario: Border visible between top bar and content
- **GIVEN** the app shell is rendered
- **WHEN** viewing the layout
- **THEN** a `border-border` colored line appears at the bottom of the top bar

## Layout: Bottom Bar Scoped to Terminal Column

### Requirement: Bottom Bar Inside Terminal Column

The `<BottomBar>` component SHALL be rendered inside the terminal column (`flex-1 min-w-0 flex flex-col`) rather than as a root-level sibling of the main area. The bottom bar's width SHALL track the terminal width, not the full viewport width.

The new DOM structure SHALL be:

```
app-shell (flex-col)
  ├── TopBar (shrink-0, full width, border-b)
  └── main-area (flex-1, flex-row)
        ├── sidebar (resizable, shrink-0, full height of main-area)
        └── terminal-column (flex-1, flex-col)
              ├── terminal (flex-1)
              └── BottomBar (shrink-0, terminal width, border-t)
```

#### Scenario: Bottom bar width matches terminal
- **GIVEN** the sidebar is open at 220px width on a 1200px viewport
- **WHEN** the layout renders
- **THEN** the bottom bar spans 980px (viewport minus sidebar)
- **AND** the sidebar extends the full height of the main area (top bar to viewport bottom)

#### Scenario: Bottom bar width adjusts with sidebar resize
- **GIVEN** the user drags the sidebar from 220px to 300px
- **WHEN** the drag completes
- **THEN** the bottom bar width decreases by 80px to match the narrower terminal area

### Requirement: Bottom Bar Border

The bottom bar wrapper SHALL have `border-t border-border` applied to create a visible separation between the terminal and the bottom bar.

#### Scenario: Border visible between terminal and bottom bar
- **GIVEN** the bottom bar is rendered inside the terminal column
- **WHEN** viewing the layout
- **THEN** a `border-border` colored line appears at the top of the bottom bar

## Sidebar: Drag-Resizable Width

### Requirement: Resizable Sidebar Panel

The sidebar SHALL be drag-resizable on desktop (≥768px) with the following behavior:

- Width stored in React state, initialized from `localStorage` key `runkit-sidebar-width`, defaulting to `220` if absent
<!-- assumed: localStorage key name "runkit-sidebar-width" — standard naming convention, easily changed -->
- A drag handle (4–6px wide) on the sidebar's right edge, replacing the static `border-r`
- Cursor changes to `col-resize` on hover and during drag
- `mousedown` on handle starts tracking; `mousemove` on `document` updates width; `mouseup` commits to `localStorage`
- Touch support via equivalent `touchstart`/`touchmove`/`touchend` handlers
<!-- assumed: drag handle width of 4-6px and min/max constraints 160/400px — reasonable defaults matching VSCode-style behavior -->
- Minimum width: 160px, maximum width: 400px (clamped on every move event)
- The mobile drawer overlay (<768px) is unaffected

#### Scenario: Initial load with persisted width
- **GIVEN** localStorage contains `runkit-sidebar-width: "280"`
- **WHEN** the app loads on desktop
- **THEN** the sidebar renders at 280px width

#### Scenario: Initial load without persisted width
- **GIVEN** localStorage has no `runkit-sidebar-width` entry
- **WHEN** the app loads on desktop
- **THEN** the sidebar renders at the default 220px width

#### Scenario: Drag to resize
- **GIVEN** the sidebar is at 220px
- **WHEN** the user mousedown on the drag handle and drags right to 300px
- **THEN** the sidebar width updates to 300px in real-time
- **AND** the terminal refits via the existing ResizeObserver + FitAddon
- **AND** on mouseup, `localStorage` is updated with `"300"`

#### Scenario: Drag beyond constraints
- **GIVEN** the sidebar is at 200px
- **WHEN** the user drags left to 100px
- **THEN** the sidebar width clamps to 160px (minimum)

#### Scenario: Touch drag on tablet
- **GIVEN** a tablet viewport ≥768px
- **WHEN** the user touchstart on the drag handle and drags
- **THEN** the sidebar resizes following the touch position (same constraints)

### Requirement: Drag Handle Styling

The drag handle SHALL be visually subtle: a thin region on the sidebar's right edge that shows `col-resize` cursor. It SHOULD overlay or replace the existing `border-r border-border`. During active drag, the handle MAY show a highlighted state.

#### Scenario: Cursor changes on hover
- **GIVEN** the sidebar is rendered with the drag handle
- **WHEN** the user hovers over the drag handle region
- **THEN** the cursor changes to `col-resize`

## Sidebar: Footer Removal

### Requirement: Remove Sidebar Footer

The sidebar footer section (containing the `[+ New Session]` button and its `border-t` separator) SHALL be removed. The `onCreateSession` prop on the Sidebar component MAY be removed since the top bar will own this action.

#### Scenario: Sidebar has no footer
- **GIVEN** the sidebar renders
- **WHEN** viewing the sidebar
- **THEN** there is no `[+ New Session]` button at the bottom of the sidebar
- **AND** there is no `border-t` separator at the bottom of the sidebar

## Top Bar: "+ Session" Button

### Requirement: Create Session Button in Top Bar Line 2

A `[+ Session]` button SHALL be added to the top bar's line 2 (action bar) alongside the existing `[Rename]` and `[Kill]` buttons. The button SHALL always be visible (not gated on `currentWindow`) since creating a session is a global action.

#### Scenario: Button visible with no current window
- **GIVEN** no session/window is selected
- **WHEN** the top bar renders
- **THEN** the `[+ Session]` button is visible in line 2

#### Scenario: Button visible alongside Rename/Kill
- **GIVEN** a session and window are selected
- **WHEN** the top bar renders on desktop
- **THEN** `[+ Session]`, `[Rename]`, and `[Kill]` buttons are all visible in line 2

#### Scenario: Button triggers create session dialog
- **GIVEN** the `[+ Session]` button is visible
- **WHEN** the user clicks it
- **THEN** the create session dialog opens

## Padding: Consistency

### Requirement: Sidebar Padding Matches Chrome

The sidebar `<nav>` element SHALL use `px-3 sm:px-6` padding to match the top bar and bottom bar chrome padding (replacing current `px-4`).

#### Scenario: Sidebar horizontal padding
- **GIVEN** the sidebar renders on desktop (≥640px)
- **WHEN** inspecting the sidebar `<nav>` element
- **THEN** the horizontal padding is `px-6` (matching top bar)

### Requirement: Terminal Container Padding

The terminal container SHALL have `py-0.5 px-1` padding for breathing room against the new border lines.

#### Scenario: Terminal padding against borders
- **GIVEN** the terminal renders inside the terminal column
- **WHEN** viewing the terminal
- **THEN** there is a small gap between the terminal content and the top bar border above / bottom bar border below

### Requirement: Bottom Bar Padding

The bottom bar wrapper SHALL use `py-1.5` padding (replacing current `py-0.5`) for closer symmetry with the top bar's `py-2`.

#### Scenario: Bottom bar vertical padding
- **GIVEN** the bottom bar renders
- **WHEN** inspecting the bottom bar wrapper
- **THEN** the vertical padding is `py-1.5`

## Documentation: Design Spec Update

### Requirement: Update Design Spec

`docs/specs/design.md` SHALL be updated to reflect all changes made in this change:
- Breadcrumb format in layout diagrams and Top Bar section
- Layout architecture diagrams (desktop and mobile) showing new bottom bar position
- CSS skeleton reflecting new structure
- Sidebar section noting drag-resizable behavior
- Resolved Decisions table entries for new decisions
- Visual Consistency Rules padding values

#### Scenario: Design spec reflects new breadcrumb format
- **GIVEN** the design spec is updated
- **WHEN** reading the Top Bar section
- **THEN** the breadcrumb format shows `☰ {logo} ❯ run-kit ❯ zsh` with no `›` or `⬡`

#### Scenario: Design spec reflects layout structure
- **GIVEN** the design spec is updated
- **WHEN** reading the CSS skeleton
- **THEN** the bottom bar appears inside the terminal column, not at root level

## Deprecated Requirements

### Sidebar Footer (+ New Session button)

**Reason**: The `[+ Session]` action moves to the top bar's line 2, making the sidebar footer redundant.
**Migration**: Top bar line 2 hosts the `[+ Session]` button. The `onCreateSession` prop on Sidebar is removed.

### Breadcrumb `›` Separator Spans

**Reason**: Replaced by `❯` as the unified separator/dropdown icon.
**Migration**: `❯` (U+276F) serves as both separator and dropdown trigger icon for all breadcrumb segments.

### Breadcrumb `⬡` Session Icon

**Reason**: Redundant — `❯` serves as the unified dropdown trigger for both session and window.
**Migration**: Both session and window BreadcrumbDropdown components use `icon="\u276F"`.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Breadcrumb format: `☰ {logo} ❯ run-kit ❯ zsh` | Confirmed from intake #1 — user explicitly chose this | S:95 R:90 A:90 D:95 |
| 2 | Certain | Add `border-b` on top bar, `border-t` on bottom bar | Confirmed from intake #2 — user explicitly requested | S:95 R:95 A:90 D:95 |
| 3 | Certain | Sidebar drag-resizable, persist to localStorage | Confirmed from intake #3 — user requested VSCode-style | S:90 R:85 A:85 D:90 |
| 4 | Certain | Sidebar padding matches chrome: `px-3 sm:px-6` | Confirmed from intake #4 — user chose "Match chrome" | S:95 R:95 A:90 D:95 |
| 5 | Certain | Terminal gets `py-0.5 px-1` padding | Confirmed from intake #5 — user chose "Tiny padding" | S:95 R:95 A:90 D:95 |
| 6 | Certain | Bottom bar padding increases to `py-1.5` | Confirmed from intake #6 — user chose "Increase to py-1.5" | S:95 R:95 A:90 D:95 |
| 7 | Certain | Bottom bar scoped to terminal column width | Confirmed from intake #7 — user proposed this layout | S:95 R:80 A:85 D:90 |
| 8 | Certain | "+ New Session" moves to top bar line 2 | Confirmed from intake #8 — user explicitly requested | S:95 R:85 A:85 D:90 |
| 9 | Confident | Drag handle width: 4-6px, min 160px / max 400px sidebar | Reasonable defaults — user said "like VSCode" but not exact values | S:70 R:90 A:80 D:75 |
| 10 | Confident | localStorage key: `runkit-sidebar-width` | Standard naming convention, easily changed | S:60 R:95 A:85 D:80 |

10 assumptions (8 certain, 2 confident, 0 tentative, 0 unresolved).
