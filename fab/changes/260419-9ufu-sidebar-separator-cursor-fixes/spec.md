# Spec: Sidebar Separator Cursor Fixes

**Change**: 260419-9ufu-sidebar-separator-cursor-fixes
**Created**: 2026-04-19
**Affected memory**: *(none — presentation-level polish; see Assumption #13)*

<!--
  Scope: fix four compounding UI polish issues on the sidebar's two resize separators
  (horizontal — between server and session panels; vertical — between sidebar and
  terminal column), plus add a corner affordance at their intersection.

  All decisions are inherited from `intake.md`. This spec restates them as RFC 2119
  requirements with GIVEN/WHEN/THEN scenarios, one scenario per requirement minimum.
-->

## Non-Goals

- Keyboard accessibility for the separators or the new corner element — neither separator is keyboard-reachable today; adding `aria-*` / `tabindex` is out of scope and would be a separate a11y change.
- Mobile drag-resize behavior — the mobile drawer has no adjustable width and no drag handle; no affordances change on mobile.
- Touch-device support for the new corner — corner renders only when `!isMobile`, so touch input is not a concern.
- Unifying the two drag handlers into a single resize manager — the existing independent handlers are retained; only shared document-level cursor state is introduced.
- Widening drag-handle hit targets — the 3px / 5px handle widths are preserved; the hover-cursor fix comes from document-level cursor override, not a larger handle.
- Replacing the vertical handler's `mousedown`/`touchstart` pair with Pointer Events.

## UI: Drag Cursor Persistence

### Requirement: Body Cursor Override During Drag

Both resize handlers (horizontal separator in `app/frontend/src/components/sidebar/collapsible-panel.tsx` and vertical separator in `app/frontend/src/app.tsx`) SHALL set `document.body.style.cursor` to the drag cursor at the start of a drag and SHALL clear it (assign `""`) at the end of the drag. This override SHALL be applied at the document level so the cursor persists when the pointer leaves the thin handle during drag.

The horizontal handler SHALL write `"row-resize"` on pointerdown and `""` on pointerup. The vertical handler SHALL write `"col-resize"` on dragstart and `""` on dragend.

#### Scenario: Horizontal separator hover cursor survives a drag

- **GIVEN** the user has never dragged the horizontal separator in the current session
- **WHEN** the user hovers the 3px horizontal handle between the server panel and the session list
- **THEN** the cursor displays `row-resize`
- **AND** after performing one drag (pointerdown, move off the handle, pointerup) and hovering the handle again, the cursor still displays `row-resize` (no regression from the implicit-pointer-capture issue)

#### Scenario: Vertical separator hover cursor survives a drag

- **GIVEN** the user has never dragged the vertical separator in the current session
- **WHEN** the user hovers the 5px vertical handle between the sidebar and the terminal column
- **THEN** the cursor displays `col-resize`
- **AND** after performing one drag (mousedown/touchstart, move, mouseup/touchend) and hovering the handle again, the cursor still displays `col-resize`

#### Scenario: Cursor persists while dragging off the handle

- **GIVEN** the user has initiated a drag on either separator and the pointer has moved off the narrow handle (while still holding down)
- **WHEN** the pointer is anywhere over `document.body` during the drag
- **THEN** the cursor displays the drag cursor (`row-resize` for horizontal, `col-resize` for vertical)
- **AND** does not revert to the default cursor mid-drag

#### Scenario: Cursor cleared on pointerup

- **GIVEN** an active drag is in progress on either separator
- **WHEN** the user releases the pointer (pointerup / mouseup / touchend)
- **THEN** `document.body.style.cursor` is set to `""` (empty string)
- **AND** subsequent hovers over non-handle UI show the default cursor

### Requirement: Preserve Existing `preventDefault` Behavior

The existing `e.preventDefault()` call on horizontal pointerdown SHALL be retained — it blocks text selection during drag and is independent of cursor management.

#### Scenario: Text selection remains suppressed during drag

- **GIVEN** the user initiates a horizontal-separator drag over UI containing selectable text
- **WHEN** the drag is in progress
- **THEN** no text selection occurs across the page
- **AND** `e.preventDefault()` is called at pointerdown as it is today

### Requirement: Unmount Cleanup of Body Cursor

The `CollapsiblePanel` component SHALL clear `document.body.style.cursor` (assign `""`) in the existing unmount cleanup `useEffect` (adjacent to the existing listener cleanup around lines 218–223 of `collapsible-panel.tsx`), so a leaked drag cursor is not left behind if the component unmounts mid-drag.

#### Scenario: Component unmounts mid-drag

- **GIVEN** a horizontal-separator drag is in progress
- **WHEN** `CollapsiblePanel` unmounts before pointerup fires (navigation, hot-reload, error boundary)
- **THEN** the unmount cleanup assigns `document.body.style.cursor = ""`
- **AND** the rest of the UI recovers its default cursor after the remount

## UI: Cursor Style Consistency

### Requirement: Horizontal Separator Uses `cursor-row-resize`

The horizontal separator in `app/frontend/src/components/sidebar/collapsible-panel.tsx` (line 313) SHALL use the Tailwind class `cursor-row-resize` instead of `cursor-ns-resize`. This aligns its cursor vocabulary (double-arrow with middle bar) with the vertical separator's `cursor-col-resize`.

The vertical separator in `app/frontend/src/app.tsx` SHALL retain its existing `cursor-col-resize` class — it is already the target style.

#### Scenario: Horizontal separator cursor on hover

- **GIVEN** the horizontal handle is visible (server panel open on desktop)
- **WHEN** the user hovers the handle
- **THEN** the cursor displays the `row-resize` system cursor (double-arrow with middle bar), not `ns-resize` (plain double-arrow)

#### Scenario: Visual parity between the two separators

- **GIVEN** both separators are visible on desktop
- **WHEN** the user moves the cursor from the horizontal handle to the vertical handle
- **THEN** both handles show the separator-style cursor vocabulary (double-arrow with middle bar) — `row-resize` for horizontal and `col-resize` for vertical
- **AND** there is no plain double-arrow (`ns-resize` / `ew-resize`) visible on either handle

## UI: Hover Highlight Consistency

### Requirement: Vertical Separator Uses Full Hover Opacity

The vertical separator in `app/frontend/src/app.tsx` (line 898) SHALL use `hover:bg-text-secondary` (removing the `/40` opacity suffix). This matches the horizontal separator's existing `hover:bg-text-secondary` and makes hover feedback equally perceptible on both separators.

#### Scenario: Vertical separator hover highlight

- **GIVEN** the vertical handle is visible on desktop
- **WHEN** the user hovers the handle
- **THEN** the handle fills with the full-opacity `text-secondary` color (no 40% opacity)

#### Scenario: Brightness parity on hover

- **GIVEN** both separators are visible
- **WHEN** the user hovers each separator in turn
- **THEN** the hover highlight brightness is visually equivalent on both handles

## UI: Corner Resize Affordance

### Requirement: Corner Element at Separator Intersection

`CollapsiblePanel` SHALL accept a new optional prop `onCornerPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void`. When this prop is supplied AND the internal `showDragHandle` condition (`resizable && isOpen && !isMobile`) is true, the drag-handle row SHALL render as a flex layout containing:

- A `flex-1` handle that retains the existing drag-handle styling and the updated `cursor-row-resize` class.
- A small fixed-width corner element (height matching the 3px handle; width `7px` — see Assumption #15) with `bg-border hover:bg-text-secondary transition-colors select-none` styling and `cursor-nwse-resize`.

When `onCornerPointerDown` is not supplied, `CollapsiblePanel` SHALL render the existing single drag-handle `<div>` exactly as today (no flex row, no corner). This preserves behavior for all current call sites.

The corner SHALL NOT render when `showDragHandle` is false (server panel collapsed, or mobile), even if `onCornerPointerDown` is supplied — the corner is coupled to the horizontal handle's visibility.

#### Scenario: Corner is visible when both axes are active on desktop

- **GIVEN** the server panel is open, the viewport is desktop (>= 768px), and `onCornerPointerDown` is passed down from `app.tsx`
- **WHEN** the sidebar renders
- **THEN** a corner element is visible at the bottom-right edge of the server panel, flush against the right side of the horizontal handle row

#### Scenario: Corner is hidden when server panel collapses

- **GIVEN** the corner is visible
- **WHEN** the user collapses the server panel (horizontal handle disappears per `showDragHandle = false`)
- **THEN** the corner element disappears alongside the horizontal handle

#### Scenario: Corner is hidden on mobile

- **GIVEN** the viewport is mobile (< 768px)
- **WHEN** the sidebar / mobile drawer renders
- **THEN** the corner element is not rendered
- **AND** neither the horizontal nor vertical drag handle is rendered (unchanged from today)

#### Scenario: Default render path preserved for other call sites

- **GIVEN** a consumer of `CollapsiblePanel` does not pass `onCornerPointerDown`
- **WHEN** the panel renders with `showDragHandle = true`
- **THEN** the drag handle renders as a single `<div>` with no flex row and no corner (exactly as before this change)

### Requirement: Corner Initiates Both Drags

The corner's `onPointerDown` handler SHALL invoke the actions in the following exact order:

1. Call the internal horizontal-drag handler (`onHandlePointerDown(e)`), which starts the horizontal drag and writes `document.body.style.cursor = "row-resize"`.
2. Call the external `onCornerPointerDown(e)` prop, which triggers the vertical drag via `handleDragStart(e.clientX)` in `app.tsx` and writes `document.body.style.cursor = "col-resize"`.
3. Write `document.body.style.cursor = "nwse-resize"` — this runs last so it wins over the `row-resize` and `col-resize` writes from steps 1 and 2.

Because both handlers use independent document-level listeners (horizontal tracks `clientY` only; vertical tracks `clientX` only) and independent state refs, they SHALL coexist without coordination or mutual interference.

#### Scenario: Corner drag resizes both axes

- **GIVEN** the corner is visible
- **WHEN** the user pointerdowns on the corner and drags diagonally
- **THEN** the horizontal separator moves vertically in response to `clientY` changes (server panel height adjusts)
- **AND** the vertical separator moves horizontally in response to `clientX` changes (sidebar width adjusts)
- **AND** the cursor displays `nwse-resize` throughout the drag

#### Scenario: Corner cursor on hover

- **GIVEN** the corner is visible and no drag is in progress
- **WHEN** the user hovers the corner (without pressing)
- **THEN** the cursor displays `nwse-resize`
- **AND** the corner's background transitions to `bg-text-secondary` (same hover treatment as the horizontal handle)

#### Scenario: Corner cursor overrides axis-specific writes

- **GIVEN** the corner pointerdown has fired
- **WHEN** steps 1 and 2 complete (handlers have each written their axis cursor to `document.body.style.cursor`)
- **THEN** step 3 writes `nwse-resize` last
- **AND** the user sees `nwse-resize` (not `row-resize` or `col-resize`) for the duration of the diagonal drag

#### Scenario: Corner drag ends cleanly on pointerup

- **GIVEN** a diagonal corner-initiated drag is in progress
- **WHEN** the user releases the pointer
- **THEN** both the horizontal handler's pointerup cleanup and the vertical handler's end cleanup fire independently
- **AND** `document.body.style.cursor` is cleared to `""`
- **AND** subsequent hovers over non-handle UI show the default cursor

## UI: Prop Threading

### Requirement: `onSidebarResizeStart` Threaded Through Sidebar Tree

A new optional callback prop `onSidebarResizeStart?: (e: React.PointerEvent<HTMLDivElement>) => void` SHALL be added to `SidebarProps` (in `app/frontend/src/components/sidebar/index.tsx`) and `ServerPanelProps` (in `app/frontend/src/components/sidebar/server-panel.tsx`).

- `app.tsx` SHALL pass `onSidebarResizeStart={(e) => handleDragStart(e.clientX)}` to `<Sidebar>` in the desktop sidebar JSX (near line 880).
- `app.tsx` SHALL NOT pass `onSidebarResizeStart` to the mobile drawer `<Sidebar>` — the mobile drawer has no adjustable sidebar width (`w-[75vw] max-w-[300px]` overlay), and `showDragHandle` is false on mobile anyway.
- `Sidebar` SHALL destructure `onSidebarResizeStart` and forward it to `<ServerPanel>`.
- `ServerPanel` SHALL destructure `onSidebarResizeStart` and pass it to `<CollapsiblePanel>` as `onCornerPointerDown={onSidebarResizeStart}`.

All three props SHALL remain optional; omitting them at any level SHALL preserve existing behavior (no corner rendered).

#### Scenario: Desktop sidebar receives the callback

- **GIVEN** the app renders on a desktop viewport
- **WHEN** `app.tsx` renders `<Sidebar>` for the desktop layout
- **THEN** `onSidebarResizeStart={(e) => handleDragStart(e.clientX)}` is passed to the `<Sidebar>` component
- **AND** the callback reaches `CollapsiblePanel` as `onCornerPointerDown` via `ServerPanel`

#### Scenario: Mobile drawer does not receive the callback

- **GIVEN** the app renders on a mobile viewport
- **WHEN** `app.tsx` renders `<Sidebar>` inside the mobile drawer
- **THEN** `onSidebarResizeStart` is not passed
- **AND** `CollapsiblePanel` receives no `onCornerPointerDown`
- **AND** no corner is rendered (which would be correct in any case because `showDragHandle = false` on mobile)

#### Scenario: `handleDragStart` receives `clientX` from a PointerEvent

- **GIVEN** the corner invokes `onSidebarResizeStart(e)` during step 2 of its pointerdown sequence
- **WHEN** the adapter `(e) => handleDragStart(e.clientX)` runs
- **THEN** `handleDragStart` is called with the pointer's `clientX` value (same input the existing mouse/touch handlers supply)
- **AND** the vertical drag initializes using the same code path as a direct drag on the 5px vertical handle

## Testing

### Requirement: Playwright Verification on Desktop

Post-implementation verification SHALL cover the nine checkpoints listed in the intake, using Playwright MCP on desktop viewports (>= 1024px). Mobile is out of scope for verification (no drag handles render).

1. Hover each separator — cursor changes to `row-resize` / `col-resize`.
2. Drag each separator once, release, then hover again — cursor still changes (no regression).
3. Drag crosses outside the handle mid-drag — cursor stays as the drag cursor.
4. Hover both separators — hover highlight is the same brightness on both.
5. Corner visible at bottom-right of server panel when server panel is open on desktop.
6. Corner cursor is `nwse-resize`.
7. Dragging the corner resizes both axes in a single gesture.
8. Collapse the server panel — corner disappears with the handle.
9. Mobile viewport — no corner, no handles, mobile layout unchanged.

Tests SHALL be run through `just` recipes per `context.md` (`just test-e2e` or `just pw test <name>`) — never invoke `npx playwright test` directly.

#### Scenario: Checkpoints 1–4 (cursor behavior and hover parity)

- **GIVEN** the app is running on a 1024px+ viewport with a session open
- **WHEN** a verifier exercises the hover and drag sequences described in checkpoints 1–4
- **THEN** each assertion passes (cursor style correct on hover, cursor persists through first drag, cursor holds during off-handle drag movement, hover brightness matches between separators)

#### Scenario: Checkpoints 5–8 (corner visibility and behavior)

- **GIVEN** the server panel is initially open on a desktop viewport
- **WHEN** a verifier exercises checkpoints 5–8 (corner visible, `nwse-resize` cursor on corner, diagonal drag resizes both axes, corner hides on collapse)
- **THEN** each assertion passes

#### Scenario: Checkpoint 9 (mobile unchanged)

- **GIVEN** the viewport is switched to mobile (< 768px)
- **WHEN** a verifier inspects the drawer layout
- **THEN** no drag handles or corner are rendered
- **AND** the mobile drawer layout is identical to pre-change behavior

## Design Decisions

1. **Document-level cursor override vs `setPointerCapture()`**: Use `document.body.style.cursor` string writes on pointerdown/pointerup.
   - *Why*: Standard web-platform workaround for implicit-pointer-capture loss on thin handles. Survives the pointer leaving the handle without needing refs, React-reconciler wiring, or the Pointer Capture API.
   - *Rejected*: `setPointerCapture()` on the handle — more invasive (ref juggling, cross-browser cancellation quirks), and does not cleanly cover fast cross-screen drag motion.

2. **Separate body-cursor lifecycles per handler (vs a shared cursor manager)**: Each of the two handlers writes and clears `document.body.style.cursor` independently; the corner's pointerdown runs both writes then overrides.
   - *Why*: The two drag handlers are already independent (different files, different event models — Pointer Events vs `mousedown`/`touchstart`, different state refs, different axis). Preserving that independence keeps the change surface minimal.
   - *Rejected*: A shared resize-cursor manager / context — over-engineering for a 4-file CSS/DOM-tweak change.

3. **Corner invokes both handlers in sequence, then overrides cursor**: Call horizontal first, then vertical, then write `nwse-resize` last.
   - *Why*: Each sub-handler writes its own axis cursor; the corner's final write wins. Order is explicit and reviewable.
   - *Rejected*: Conditional / guarded cursor writes inside each handler — would couple the sub-handlers to corner semantics.

4. **Corner visibility reuses `showDragHandle`** rather than introducing a new visibility prop.
   - *Why*: The corner's correctness condition is exactly "horizontal handle is rendered". Reusing the existing guard eliminates a separate source of truth.
   - *Rejected*: A dedicated `showCorner` prop — redundant and risks drift if `showDragHandle` logic changes.

5. **Optional-prop threading (vs always-on corner)**: `onCornerPointerDown` / `onSidebarResizeStart` are optional at every level; the corner only renders when they are supplied.
   - *Why*: Preserves existing call sites (other `CollapsiblePanel` instances — WindowPanel, HostPanel — and the mobile drawer `<Sidebar>`) unchanged. No behavior change unless explicitly wired.
   - *Rejected*: Always rendering the corner from `CollapsiblePanel` — would force all consumers to have a vertical drag, which is not true for WindowPanel/HostPanel.

## Assumptions

<!-- Spec-stage review of intake assumptions: all 16 intake assumptions confirmed as written.
     No new assumptions discovered during spec generation — the intake already enumerated
     every non-trivial decision (file paths, line numbers, prop names, ordering, visibility
     guards, pixel dimensions, unmount cleanup, memory impact). -->

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use `document.body.style.cursor` string write + clear on pointerup/mouseup/touchend | Confirmed from intake #1 — explicitly specified; well-known web-platform pattern for cursor persistence during drag | S:95 R:85 A:90 D:95 |
| 2 | Certain | Keep existing `e.preventDefault()` on horizontal pointerdown | Confirmed from intake #2 — blocks text selection, independent of cursor fix | S:98 R:95 A:95 D:98 |
| 3 | Certain | Change horizontal from `cursor-ns-resize` to `cursor-row-resize` | Confirmed from intake #3 — explicit class swap at `collapsible-panel.tsx:313` | S:98 R:95 A:95 D:98 |
| 4 | Certain | Change vertical hover from `hover:bg-text-secondary/40` to `hover:bg-text-secondary` | Confirmed from intake #4 — explicit class change at `app.tsx:898` | S:98 R:95 A:95 D:98 |
| 5 | Certain | Vertical separator keeps `cursor-col-resize` | Confirmed from intake #5 — intake only changes horizontal cursor; vertical already matches target vocabulary | S:95 R:95 A:95 D:95 |
| 6 | Certain | Corner visibility gated on existing `showDragHandle` (`resizable && isOpen && !isMobile`) | Confirmed from intake #6 — reuses condition `CollapsiblePanel` already computes | S:95 R:85 A:90 D:95 |
| 7 | Certain | Corner pointerdown invokes horizontal first, then vertical, then overrides cursor to `nwse-resize` | Confirmed from intake #7 — explicit order: last write wins over axis-specific cursor overrides | S:95 R:80 A:90 D:95 |
| 8 | Certain | New prop names: `onCornerPointerDown` (CollapsiblePanel) and `onSidebarResizeStart` (Sidebar/ServerPanel) | Confirmed from intake #8 — explicit in intake | S:98 R:70 A:95 D:98 |
| 9 | Certain | `onSidebarResizeStart` receives a `React.PointerEvent<HTMLDivElement>`; app.tsx adapts to `clientX` for `handleDragStart` | Confirmed from intake #9 — `onSidebarResizeStart={(e) => handleDragStart(e.clientX)}` | S:95 R:75 A:90 D:95 |
| 10 | Certain | Horizontal and vertical drag handlers coexist naturally — no coordination needed | Confirmed from intake #10 — independent document listeners (clientY-only vs clientX-only) and independent state refs | S:92 R:80 A:95 D:95 |
| 11 | Certain | Corner styling reuses `bg-border hover:bg-text-secondary transition-colors select-none` from the horizontal handle | Confirmed from intake #11 — intake is explicit: "same bg/hover as the handle" | S:95 R:90 A:95 D:95 |
| 12 | Certain | When `onCornerPointerDown` is not provided, render the handle exactly as today (no flex row, no corner) | Confirmed from intake #12 — corner is additive behind the new prop; default path preserves existing call sites (including WindowPanel, HostPanel, and mobile sidebar) | S:90 R:90 A:95 D:95 |
| 13 | Certain | No new memory files and no memory modifications required | Confirmed from intake #13 — constitution II (no DB) and scope analysis: cursor classes, hover opacity, and a corner DOM element are presentation details, not spec-level contracts. `docs/memory/run-kit/ui-patterns.md` already documents sidebar resize at ~line 156; refresh is optional during hydrate only | S:85 R:85 A:95 D:90 |
| 14 | Certain | Mobile drawer `<Sidebar>` in app.tsx is NOT passed `onSidebarResizeStart` | Confirmed from intake #14 — `showDragHandle` already false on mobile; the overlay drawer (`w-[75vw] max-w-[300px]`) has no adjustable width | S:90 R:90 A:95 D:95 |
| 15 | Confident | Corner pixel dimensions: `w-[7px] h-[3px]` (slightly wider than the 5px vertical handle, height matches 3px horizontal handle) | Confirmed from intake #15 — intake says "small fixed-width square" without exact values. Going with 7×3 to stay flush against both handles and avoid visual bulk. Easily tweaked during Playwright verification; low cascade risk | S:60 R:80 A:75 D:65 |
| 16 | Confident | Add an unmount cleanup in `CollapsiblePanel` that resets `document.body.style.cursor` to `""` alongside the existing listener cleanup | Confirmed from intake #16 — cheap insurance against a leaked cursor if the component unmounts mid-drag; standard web pattern | S:70 R:75 A:85 D:80 |

16 assumptions (14 certain, 2 confident, 0 tentative, 0 unresolved).
