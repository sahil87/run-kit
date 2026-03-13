# Intake: UI Chrome & Layout Refinements

**Change**: 260312-y4ci-ui-chrome-layout-refinements
**Created**: 2026-03-13
**Status**: Draft

## Origin

> Conversational design review via `/fab-discuss`. Went through UI elements one by one — breadcrumbs, layout separators, sidebar resizing, padding consistency, and bottom bar scope. Each decision was discussed with alternatives and rationale. User also requested updating `docs/specs/design.md` to reflect these changes.

Interaction mode: conversational (multi-turn design exploration). All decisions below were explicitly chosen by the user from presented options.

## Why

The current UI chrome has accumulated visual noise and inconsistencies during rapid implementation:

1. **Breadcrumbs are cluttered** — `☰ {logo} › ⬡ run-kit › ❯ zsh` has 4 separator-like glyphs between 3 content items. The `›` separators and `⬡`/`❯` icons both read as separators, creating a wall of punctuation.
2. **Layout regions lack clear boundaries** — no border between top bar and content, no border between bottom bar and content. Only the sidebar has a visible `border-r`.
3. **The sidebar is fixed-width** — `w-[220px]` with no way to resize. Users with long session names or many windows can't widen it; users who want more terminal space can't narrow it.
4. **Padding is inconsistent** — sidebar uses `px-4` while chrome uses `px-3 sm:px-6`. Bottom bar has thin `py-0.5` vs top bar's `py-2`.
5. **Bottom bar spans full width unnecessarily** — the modifier keys are terminal controls but sit below the sidebar too, wasting space and creating a confused hierarchy.

If left as-is, these issues compound as more features land — each inconsistency makes the next harder to spot.

## What Changes

### 1. Simplified Breadcrumbs

Replace the current breadcrumb structure:

```
☰  {logo} › ⬡ run-kit › ❯ zsh
```

With:

```
☰  {logo} ❯ run-kit ❯ zsh
```

Specific changes in `app/frontend/src/components/top-bar.tsx`:
- Remove `›` separator spans (`\u203A`) between breadcrumb segments
- Remove the `⬡` icon (`\u2B21`) from the session `BreadcrumbDropdown`
- Use `❯` (`\u276F`) as the icon for **both** session and window dropdowns — it serves as both separator and dropdown trigger
- Session name and window name remain tappable dropdown triggers (no functional change to `BreadcrumbDropdown` component)

The `breadcrumb-dropdown.tsx` component itself needs no changes — only the icon props and surrounding separator spans in `top-bar.tsx` change.

### 2. Layout Border Lines

Add visible borders between chrome and content:

- **Top bar**: add `border-b border-border` to the `<header>` element in `top-bar.tsx`
- **Bottom bar**: add `border-t border-border` to the bottom bar wrapper (now inside the terminal column — see §5)
- **Sidebar**: keep existing `border-r border-border` (no change)

### 3. Draggable Sidebar Width

Replace the fixed `w-[220px]` sidebar with a drag-resizable panel:

- **State**: sidebar width stored in React state, initialized from `localStorage` (key: e.g., `runkit-sidebar-width`), defaulting to `220`
- **Drag handle**: a thin `div` (4-6px wide) on the sidebar's right edge, replacing or overlaying the `border-r`. Cursor changes to `col-resize` on hover and during drag.
- **Drag behavior**: `onMouseDown` on the handle starts tracking. `mousemove` on `document` updates width. `mouseup` commits to `localStorage`.
- **Touch support**: equivalent `touchstart`/`touchmove`/`touchend` handlers for mobile/tablet, though on mobile the sidebar is a drawer overlay so this primarily matters for tablets.
- **Constraints**: min `160px`, max `400px`. Clamp on every move event.
- **Desktop only**: the drawer overlay on mobile (`<768px`) is unaffected — draggable resize applies only when the sidebar renders as a persistent panel.
- **FitAddon**: the terminal's `ResizeObserver` + `FitAddon.fit()` already handles container size changes, so the terminal will refit automatically as the sidebar width changes.

### 4. Padding Consistency

| Component | Current | New |
|-----------|---------|-----|
| Sidebar `<nav>` | `px-4` | `px-3 sm:px-6` (match chrome) |
| Terminal container | none | `py-0.5 px-1` (breathing room against new borders) |
| Bottom bar wrapper | `pb-1`, inner `py-0.5` | `py-1.5` (closer symmetry with top bar's `py-2`) |

### 5. Layout Restructure: Bottom Bar Scoped to Terminal

Current structure (bottom bar is a root-level sibling):

```
app-shell (flex-col)
  ├── TopBar (shrink-0, full width)
  ├── main-area (flex-1, flex-row)
  │     ├── sidebar (w-[220px], shrink-0)
  │     └── terminal (flex-1)
  └── BottomBar (shrink-0, full width)    ← spans under sidebar too
```

New structure (bottom bar inside terminal column):

```
app-shell (flex-col)
  ├── TopBar (shrink-0, full width)
  └── main-area (flex-1, flex-row)
        ├── sidebar (resizable, shrink-0, full height of main-area)
        └── terminal-column (flex-1, flex-col)
              ├── terminal (flex-1)
              └── BottomBar (shrink-0, terminal width)    ← scoped
```

This means:
- In `app.tsx`, the `<BottomBar>` moves from the root `app-shell` flex column into the terminal's flex column
- The sidebar naturally extends the full height between top bar and viewport bottom
- The sidebar's footer section (`border-t`, `[+ New Session]` button) is **removed**
- The bottom bar width tracks the terminal width — resizing the sidebar resizes both terminal and bottom bar together

### 6. "+ New Session" Relocation

Move `[+ New Session]` from the sidebar footer to the top bar's line 2 (actions area):

- In `top-bar.tsx` line 2, add a `[+ Session]` button alongside `[Rename]` and `[Kill]`
- The `[+ Session]` button should always be visible (not gated on `currentWindow`) since creating a session is a global action
- In `sidebar.tsx`, remove the footer `<div>` containing the `[+ New Session]` button and its `border-t` separator
- The `onCreateSession` prop on `Sidebar` can be removed (the top bar already receives this via `dialogs.openCreateDialog`)

### 7. Update Design Spec

Update `docs/specs/design.md` to reflect all changes:
- Breadcrumb format in layout diagrams and Top Bar section
- Layout architecture diagrams (desktop and mobile) showing new bottom bar position
- CSS skeleton reflecting new structure
- Sidebar section noting drag-resizable behavior
- Resolved Decisions table — update existing entries and add new ones
- Padding values in Visual Consistency Rules

## Affected Memory

- `run-kit/ui-patterns`: (modify) Update breadcrumb format, layout structure, sidebar behavior, padding values
- `run-kit/architecture`: (modify) Update layout hierarchy description (bottom bar now inside terminal column)

## Impact

- **Frontend components**: `top-bar.tsx`, `sidebar.tsx`, `app.tsx`, `bottom-bar.tsx` (wrapper in app.tsx)
- **Tests**: `breadcrumb-dropdown.test.tsx` (icon prop changes), `sidebar.test.tsx` (footer removal)
- **Spec**: `docs/specs/design.md` (layout diagrams, resolved decisions, CSS skeleton)
- **No backend changes**
- **No API changes**
- **No new dependencies**

## Open Questions

None — all decisions were resolved during the design discussion.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Breadcrumb format: `☰ {logo} ❯ run-kit ❯ zsh` | Discussed — user explicitly chose this over 3 alternatives | S:95 R:90 A:90 D:95 |
| 2 | Certain | Add `border-b` on top bar, `border-t` on bottom bar | Discussed — user said "yes, add lines" for both | S:95 R:95 A:90 D:95 |
| 3 | Certain | Sidebar drag-resizable, persist to localStorage | Discussed — user requested VSCode-style draggable, chose persist | S:90 R:85 A:85 D:90 |
| 4 | Certain | Sidebar padding matches chrome: `px-3 sm:px-6` | Discussed — user chose "Match chrome" over "Keep px-4" | S:95 R:95 A:90 D:95 |
| 5 | Certain | Terminal gets `py-0.5 px-1` padding | Discussed — user chose "Tiny padding" over "No padding" | S:95 R:95 A:90 D:95 |
| 6 | Certain | Bottom bar padding increases to `py-1.5` | Discussed — user chose "Increase to py-1.5" over "Keep thin" | S:95 R:95 A:90 D:95 |
| 7 | Certain | Bottom bar scoped to terminal column width | Discussed — user proposed this layout change | S:95 R:80 A:85 D:90 |
| 8 | Certain | "+ New Session" moves from sidebar footer to top bar line 2 | Discussed — user said "can join the other buttons in the Top Bar" | S:95 R:85 A:85 D:90 |
| 9 | Confident | Drag handle width: 4-6px, min 160px / max 400px sidebar | Reasonable defaults — user specified "like VSCode" but not exact values | S:70 R:90 A:80 D:75 |
| 10 | Confident | localStorage key: `runkit-sidebar-width` | Standard naming convention, easily changed | S:60 R:95 A:85 D:80 |

10 assumptions (8 certain, 2 confident, 0 tentative, 0 unresolved).
