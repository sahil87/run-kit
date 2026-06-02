# Intake: Sidebar Separator Cursor Fixes

**Change**: 260419-9ufu-sidebar-separator-cursor-fixes
**Created**: 2026-04-19
**Status**: Draft

## Origin

User-initiated UI polish task. Invoked via `/fab-proceed` with a detailed one-shot description that includes the root-cause analysis, the exact style changes, the prop plumbing, and the visibility constraint for a new corner element. No prior conversation — all design decisions were stated up front in the invocation.

> Fix four inconsistencies in the sidebar's resize separators (horizontal between server and session panels; vertical between sidebar and terminal column).
>
> 1. Hover cursor stops after first drag. Root cause: implicit pointer capture during drag — the pointer leaves the 3/5px handle and `:hover` is lost. Fix: explicit `document.body.style.cursor` override at pointerdown, cleared on pointerup, in both handlers.
> 2. Cursor style inconsistency — horizontal uses `cursor-ns-resize`, vertical uses `cursor-col-resize`. Change horizontal to `cursor-row-resize` so both show the separator-style cursor (double-arrow with a middle bar).
> 3. Hover highlight inconsistency — vertical uses `hover:bg-text-secondary/40`, too subtle. Change to `hover:bg-text-secondary` to match horizontal.
> 4. Add a corner element at the separator intersection (bottom-right of server panel) with `cursor-nwse-resize` that initiates both drags simultaneously. Two handlers use independent document listeners (clientY vs clientX), so they coexist without coordination.

## Why

### The pain point

Four small but compounding polish issues on the sidebar's two resize separators make the resize UX feel unpolished and inconsistent:

1. **Hover feedback dies after first drag.** After dragging either separator once, the resize cursor no longer appears on hover — users cannot tell the separator is still resizable without remembering it is. Every subsequent resize attempt starts with a moment of "is this still draggable?" confusion.
2. **Inconsistent cursor vocabulary.** The horizontal separator uses `cursor-ns-resize` (plain double-arrow) while the vertical uses `cursor-col-resize` (double-arrow with a middle bar). These are semantically close but visually different, and the asymmetry is noticeable when the user moves between them.
3. **Inconsistent hover brightness.** Horizontal highlights at full opacity on hover (`hover:bg-text-secondary`), vertical at 40% (`hover:bg-text-secondary/40`). The vertical separator effectively has no perceptible hover feedback.
4. **No way to resize both axes from the corner where they meet.** The intersection of the two separators is the natural "resize both" affordance in any windowed UI, and it does nothing today — you have to drag them one at a time.

### Consequence of not fixing

Sidebar resizing is a frequently-exercised interaction. Each of these issues is small in isolation but collectively they read as "the sidebar's resize is a bit janky." Per the constitution's IV — Minimal Surface Area and V — Keyboard-First principles, the minimal UI we do ship must feel polished; sloppy resize UX undermines the "precision tool" aesthetic of run-kit.

The #1 issue (hover cursor lost after drag) is a genuine bug — it breaks an affordance. The others are polish. Leaving them accumulates as low-grade UI debt.

### Why this approach

- **`document.body.style.cursor` override during drag** is the standard web-platform workaround for the implicit pointer-capture problem. It enforces the cursor at the document level so it survives the pointer leaving the thin handle. Cleared on pointerup. No library, no ref juggling, no pointer-capture API (which has its own complications in React).
- **`row-resize` + `col-resize` pair** matches the standard "window separator" cursor vocabulary. Both are double-arrow-with-middle-bar, so they visually parallel each other (`─‖─` horizontally, `│═│` vertically in spirit).
- **Corner element that invokes both handlers** leverages the fact that both drag handlers already use independent document-level listeners — horizontal tracks `clientY`, vertical tracks `clientX`, so nothing coordinates between them and nothing collides. The corner just calls both `pointerdown` handlers in sequence.
- **Visibility gated on `showDragHandle` condition** — the corner only exists when both separators are present. If the server panel is collapsed, there's no horizontal handle showing, so there's no intersection, so no corner. This reuses the existing `resizable && isOpen && !isMobile` condition.

### Why not alternatives

- **`setPointerCapture()` on the handle** — works but is more invasive (needs ref juggling; cancellation behavior differs between browsers; doesn't cover the "cursor changes while moving fast across the whole screen" case as cleanly).
- **Wider drag handles** — would mask the hover problem but not fix it. Also conflicts with the minimal-chrome aesthetic.
- **A single unified resize manager** — over-engineering for four CSS/DOM-tweak issues. The two drag handlers already work correctly in isolation; we just need to share a cursor override at the document level and add a corner element.

## What Changes

### 1. Body cursor override during drag (both handlers)

**File**: `app/frontend/src/components/sidebar/collapsible-panel.tsx`

In `onHandlePointerDown` (~line 200), after the existing `e.preventDefault()` and drag state setup, add:

```ts
document.body.style.cursor = "row-resize";
```

In `onPointerUp` (~line 183), at the start of the cleanup block:

```ts
document.body.style.cursor = "";
```

**File**: `app/frontend/src/app.tsx`

In `handleDragStart` (~line 198), after `isDraggingRef.current = true`, add:

```ts
document.body.style.cursor = "col-resize";
```

In `handleEnd` (~line 212), alongside `isDraggingRef.current = false`:

```ts
document.body.style.cursor = "";
```

The existing `e.preventDefault()` on pointerdown is kept — it blocks text selection during drag and is independent of cursor management.

### 2. Horizontal separator cursor class change

**File**: `app/frontend/src/components/sidebar/collapsible-panel.tsx`

Line 313, change:

```tsx
className="relative z-10 h-[3px] bg-border hover:bg-text-secondary transition-colors cursor-ns-resize select-none"
```

to:

```tsx
className="relative z-10 h-[3px] bg-border hover:bg-text-secondary transition-colors cursor-row-resize select-none"
```

Only the `cursor-*` token changes.

### 3. Vertical separator hover opacity fix

**File**: `app/frontend/src/app.tsx`

Line 898, change:

```tsx
className="w-[5px] shrink-0 cursor-col-resize bg-border hover:bg-text-secondary/40 transition-colors"
```

to:

```tsx
className="w-[5px] shrink-0 cursor-col-resize bg-border hover:bg-text-secondary transition-colors"
```

Only the `/40` opacity suffix is removed.

### 4. Corner element at separator intersection

#### 4a. CollapsiblePanel — optional prop + corner rendering

**File**: `app/frontend/src/components/sidebar/collapsible-panel.tsx`

Add optional prop:

```ts
/** When set, renders a small corner element at the right edge of the drag handle.
 *  The corner calls this callback on pointerdown in addition to the internal
 *  horizontal-drag start, then overrides the body cursor to `nwse-resize`.
 *  Only rendered when `showDragHandle` is true (resizable + open + !mobile). */
onCornerPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void;
```

Replace the single drag-handle `<div>` (lines 307–316) with a flex row when `onCornerPointerDown` is supplied:

- Handle: `flex-1`, retains all current classes except cursor changes to `cursor-row-resize` (Item 2).
- Corner: small fixed-width square (`w-[7px]` — slightly wider than the 5px vertical handle so it extends flush with its right edge; height matches the 3px handle), same `bg-border hover:bg-text-secondary transition-colors select-none` styling, and `cursor-nwse-resize`.
- Corner `onPointerDown`:
  1. Call the internal `onHandlePointerDown(e)` (starts horizontal drag).
  2. Call `onCornerPointerDown(e)` (starts vertical drag via app.tsx's callback).
  3. `document.body.style.cursor = "nwse-resize"` — runs last, overrides the `row-resize` and `col-resize` writes from steps 1–2.

When `onCornerPointerDown` is not supplied, render exactly as today (single handle, no corner, no flex row).

#### 4b. app.tsx — pass corner start callback through Sidebar

**File**: `app/frontend/src/app.tsx`

In the desktop sidebar JSX block (line 880), add new prop to `<Sidebar>`:

```tsx
onSidebarResizeStart={(e) => handleDragStart(e.clientX)}
```

The callback invokes the existing `handleDragStart` with the pointer's `clientX` (same input the mouse/touch handlers already feed in). `handleDragStart` now also sets `document.body.style.cursor = "col-resize"` (Item 1), which will be overridden a tick later by the corner's `nwse-resize` write — that's the intended behavior.

#### 4c. Sidebar — thread prop through

**File**: `app/frontend/src/components/sidebar/index.tsx`

Add to `SidebarProps`:

```ts
onSidebarResizeStart?: (e: React.PointerEvent<HTMLDivElement>) => void;
```

Destructure in the component signature and pass to `<ServerPanel>` (line 494).

#### 4d. ServerPanel — thread prop through

**File**: `app/frontend/src/components/sidebar/server-panel.tsx`

Add to `ServerPanelProps`:

```ts
onSidebarResizeStart?: (e: React.PointerEvent<HTMLDivElement>) => void;
```

Destructure and pass to `<CollapsiblePanel>` as `onCornerPointerDown={onSidebarResizeStart}`.

### Visibility constraint

The corner is rendered iff the horizontal drag handle is rendered — same `resizable && isOpen && !isMobile` guard already inside `CollapsiblePanel`. When the server panel is collapsed, there is no horizontal handle and no corner. On mobile, neither the drag handle nor the corner render (consistent with the existing mobile layout where drag-resize is disabled).

Even if parents pass `onSidebarResizeStart` in other contexts, `CollapsiblePanel` only renders the corner when its own `showDragHandle` is true, so the two affordances stay coupled correctly.

## Affected Memory

No memory updates required. This is implementation-level UI polish:

- Cursor classes and hover opacity are visual presentation details, not spec-level behavior.
- The corner-element affordance is a minor visual addition that doesn't change the sidebar's architectural contract (sidebar still has two independent resize axes; the corner just invokes both at once).
- `docs/memory/run-kit/ui-patterns.md` may already describe sidebar resize behavior; if so, it can be refreshed optionally during hydrate, but no new memory file is needed and no existing file requires modification for correctness.

## Impact

### Files modified (4)

- `app/frontend/src/components/sidebar/collapsible-panel.tsx` — cursor class, body-cursor overrides in `onHandlePointerDown`/`onPointerUp`, new optional `onCornerPointerDown` prop, corner render branch.
- `app/frontend/src/app.tsx` — vertical handle hover class, body-cursor overrides in `handleDragStart`/`handleEnd`, new `onSidebarResizeStart` prop passed to `<Sidebar>`.
- `app/frontend/src/components/sidebar/index.tsx` — accept and thread `onSidebarResizeStart` prop.
- `app/frontend/src/components/sidebar/server-panel.tsx` — accept and thread `onSidebarResizeStart` prop, pass as `onCornerPointerDown` to `<CollapsiblePanel>`.

### APIs / contracts

- `CollapsiblePanelProps` gains one optional prop (`onCornerPointerDown`). Existing call sites not passing it are unaffected.
- `SidebarProps` and `ServerPanelProps` each gain one optional prop (`onSidebarResizeStart`). Existing call sites (there is one desktop and one mobile drawer render in `app.tsx`; only desktop gets the new prop) continue to work — mobile drawer renders `<Sidebar>` without the prop and behaves identically to today.

### No impact

- Backend: zero changes.
- Tmux / sessions / navigation: zero changes.
- localStorage persistence for sidebar width and panel height: unchanged.
- Keyboard shortcuts and command palette: unchanged.

### Risks / edge cases

- **Body cursor leak on crash.** If the drag handler is interrupted mid-drag (component unmount, JS error in pointermove), the body cursor could stick as `row-resize` / `col-resize` / `nwse-resize`. Mitigation: the existing unmount cleanup `useEffect` in `collapsible-panel.tsx` (lines 218–223) should also clear `document.body.style.cursor`. The vertical handler in `app.tsx` uses listeners attached to document which are already removed in `handleEnd`; we trust `handleEnd` always fires on pointerup — it's the same trust the existing code depends on for `isDraggingRef`.
- **Corner pointerdown ordering.** The corner calls horizontal first, then vertical, then writes cursor. If horizontal's pointerdown somehow throws before vertical starts, the vertical listeners never attach and only horizontal drag works — a partial-failure state. Given both are simple synchronous ref assignments, the risk is near-zero, but worth noting for review.
- **Touch devices.** The horizontal handler uses Pointer Events (unified mouse+touch). The vertical handler in `app.tsx` uses separate `mousedown`/`touchstart` handlers. The new corner callback will pass a `React.PointerEvent` to `handleDragStart(e.clientX)` — `clientX` is present on `PointerEvent`, so this works. No touch concern because the corner is only rendered when `!isMobile`.
- **Visibility of the corner at pixel-boundary.** A 7px × 3px corner sitting at the right edge of the 3px horizontal handle and flush against the 5px vertical handle needs to not look glitchy. Alignment depends on the sidebar's flex-row laying out `[sidebar content] [5px vertical handle]` and the corner rendering at the right edge of the server panel's horizontal handle. Since the horizontal handle lives inside the sidebar content area (not the 5px rail), the corner will sit at `[content right edge - 7px] × [handle row]`, which is just inside the sidebar. This is a visual detail to verify in Playwright at desktop widths.
- **Hover highlight on the corner.** The corner uses the same `hover:bg-text-secondary` as the handles, so hovering the corner lights up only the corner (not both handles). That's fine — it's the correct scope.

### Testing

Per `context.md`, run all tests through `just` recipes. Verify visually with Playwright MCP on desktop viewports (1024px+) — mobile is out of scope (no drag handles on mobile).

Targeted checks:
1. Hover each separator — cursor changes to `row-resize` / `col-resize`.
2. Drag each separator once, release, then hover again — cursor still changes (no regression).
3. Drag crosses outside the handle mid-drag — cursor stays as the drag cursor (no revert to default while moving).
4. Hover both separators — hover highlight is the same brightness on both.
5. Corner visible at bottom-right of server panel when server panel is open on desktop.
6. Corner cursor is `nwse-resize`.
7. Dragging the corner resizes both axes in a single gesture.
8. Collapse the server panel — corner disappears with the handle.
9. Mobile viewport — no corner, no handles, mobile layout unchanged.

## Open Questions

- **Corner exact size** — is `7px × 3px` (extends one pixel past the horizontal handle thickness, matches the vertical handle width plus 2px) the right default, or should it be a slightly larger touch target like `9px × 5px`? The description says "small fixed-width square" without an exact pixel value. Tentatively going with a small square flush against both handles; review during Playwright verification.
- **Constitution check on keyboard-first**: is the corner reachable via keyboard? Neither the horizontal nor vertical handle is keyboard-reachable today (they have `role="separator"` but no `tabindex`), so adding the corner without keyboard access is consistent with existing behavior. Adding `aria-*` attributes is worth considering but out of scope — would be a separate a11y change.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use `document.body.style.cursor` string write + clear on pointerup/mouseup/touchend | Explicitly specified in description; well-known web-platform pattern for cursor-persistence during drag | S:95 R:85 A:90 D:95 |
| 2 | Certain | Keep existing `e.preventDefault()` on horizontal pointerdown | Explicitly specified in description — blocks text selection, independent of cursor fix | S:98 R:95 A:95 D:98 |
| 3 | Certain | Change horizontal from `cursor-ns-resize` to `cursor-row-resize` | Explicit class swap specified in description | S:98 R:95 A:95 D:98 |
| 4 | Certain | Change vertical hover from `hover:bg-text-secondary/40` to `hover:bg-text-secondary` | Explicit class swap specified in description | S:98 R:95 A:95 D:98 |
| 5 | Certain | Vertical separator keeps `cursor-col-resize` | Description only changes horizontal; explicitly says this matches vertical's existing style | S:95 R:95 A:95 D:95 |
| 6 | Certain | Corner visibility gated on existing `showDragHandle` (`resizable && isOpen && !isMobile`) | Explicit in description; reuses the condition `CollapsiblePanel` already computes | S:95 R:85 A:90 D:95 |
| 7 | Certain | Corner pointerdown invokes horizontal first, then vertical, then overrides cursor to `nwse-resize` | Explicit order specified — described as "runs last, so it wins over the individual cursor overrides" | S:95 R:80 A:90 D:95 |
| 8 | Certain | New prop names: `onCornerPointerDown` (CollapsiblePanel) and `onSidebarResizeStart` (Sidebar/ServerPanel) | Explicit in description | S:98 R:70 A:95 D:98 |
| 9 | Certain | `onSidebarResizeStart` receives a `React.PointerEvent<HTMLDivElement>`; app.tsx adapts to `clientX` for `handleDragStart` | Explicit: `onSidebarResizeStart={(e) => handleDragStart(e.clientX)}` | S:95 R:75 A:90 D:95 |
| 10 | Certain | Horizontal and vertical drag handlers coexist naturally — no coordination needed | Explicit in description; verified by reading the code (clientY-only vs clientX-only document listeners, independent state refs) | S:92 R:80 A:95 D:95 |
| 11 | Certain | Corner styling reuses `bg-border hover:bg-text-secondary transition-colors select-none` from the horizontal handle | Description is explicit: "same bg/hover as the handle" | S:95 R:90 A:95 D:95 |
| 12 | Certain | When `onCornerPointerDown` is not provided, render the handle exactly as today (no flex row, no corner) | Description frames the corner as additive behind the new prop; default path preserves existing call sites | S:90 R:90 A:95 D:95 |
| 13 | Certain | No new memory files and no memory modifications required | Constitution II (no DB) and scope analysis: cursor classes, hover opacity, and a corner DOM element are presentation details, not spec-level contracts | S:85 R:85 A:95 D:90 |
| 14 | Certain | Mobile drawer `<Sidebar>` in app.tsx is NOT passed `onSidebarResizeStart` | `showDragHandle` (`resizable && isOpen && !isMobile`) already hides handles on mobile; the mobile drawer has no adjustable sidebar width (it's a `w-[75vw] max-w-[300px]` overlay), so the corner would have nothing to drive | S:90 R:90 A:95 D:95 |
| 15 | Confident | Corner pixel dimensions: a small rectangle roughly matching the 3px handle thickness in height and a few pixels wider (e.g., `w-[7px] h-[3px]`) | Description says "small fixed-width square" without exact values — going with minimal size matching existing handle thickness to avoid visual bulk; verify in Playwright | S:60 R:80 A:75 D:65 |
| 16 | Confident | Add an unmount cleanup that resets `document.body.style.cursor` to `""` alongside the existing listener cleanup | Cheap insurance against a leaked cursor if the component unmounts mid-drag; standard web pattern | S:70 R:75 A:85 D:80 |

16 assumptions (14 certain, 2 confident, 0 tentative, 0 unresolved).
