# Plan: Sidebar Separator Cursor Fixes

**Change**: 260419-9ufu-sidebar-separator-cursor-fixes
**Status**: In Progress
**Intake**: `intake.md`
**Spec**: `spec.md`

## Tasks

## Phase 1: Setup

<!-- No setup required — no new deps, no config, no scaffolding. Source files already exist. -->

_(none)_

## Phase 2: Core Implementation

<!-- Per-file CSS/cursor/prop work. T001 and T002 touch different files and are independent.
     T003 and T007 both touch collapsible-panel.tsx — keep them in T001's wake, sequential. -->

- [x] T001 [P] In `app/frontend/src/components/sidebar/collapsible-panel.tsx`, change the horizontal drag-handle cursor class at line 313 from `cursor-ns-resize` to `cursor-row-resize` (Item 2 in intake; spec: "UI: Cursor Style Consistency / Horizontal Separator Uses `cursor-row-resize`"). Also add `document.body.style.cursor = "row-resize"` at the start of the drag in `onHandlePointerDown` (~line 200, after `e.preventDefault()` / drag-state setup) and `document.body.style.cursor = ""` at the top of the `onPointerUp` cleanup block (~line 183). **Acceptance**: hovering the handle shows the `row-resize` system cursor; after a full drag cycle, hovering still shows `row-resize` (no regression).

- [x] T002 [P] In `app/frontend/src/app.tsx`, fix the vertical drag-handle hover class at line 898 by removing the `/40` opacity suffix (`hover:bg-text-secondary/40` → `hover:bg-text-secondary`) (Item 3 in intake; spec: "UI: Hover Highlight Consistency"). In the same file, add `document.body.style.cursor = "col-resize"` in `handleDragStart` immediately after `isDraggingRef.current = true` (~line 198), and `document.body.style.cursor = ""` inside the `handleEnd` cleanup alongside `isDraggingRef.current = false` (~line 212) (Item 1 in intake; spec: "UI: Drag Cursor Persistence / Body Cursor Override During Drag"). **Acceptance**: vertical handle highlights at full opacity on hover; drag cursor survives mid-drag when the pointer leaves the handle; cursor clears on mouseup / touchend.

- [x] T003 In `app/frontend/src/components/sidebar/collapsible-panel.tsx`, add the optional prop `onCornerPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void` to `CollapsiblePanelProps` and destructure it in the component signature. When `showDragHandle` is true AND `onCornerPointerDown` is supplied, render the drag-handle block (lines 307–316) as a flex row containing: (a) a `flex-1` handle div retaining the existing `role="separator"`, `aria-*`, `onPointerDown={onHandlePointerDown}`, `touchAction: "none"`, and all current classes including the `cursor-row-resize` from T001; (b) a corner `<div>` sized `w-[7px] h-[3px]` with classes `bg-border hover:bg-text-secondary transition-colors select-none cursor-nwse-resize` and `style={{ touchAction: "none" }}`. The corner's `onPointerDown` SHALL, in this exact order: (1) call `onHandlePointerDown(e)`, (2) call `onCornerPointerDown(e)`, (3) set `document.body.style.cursor = "nwse-resize"`. When `onCornerPointerDown` is not supplied, render the handle exactly as today (single `<div>`, no flex row, no corner). Spec refs: "UI: Corner Resize Affordance / Corner Element at Separator Intersection" and "Corner Initiates Both Drags". **Acceptance**: prop is optional; default render path is byte-identical to current (no flex wrapper, no corner); when supplied, corner renders flush against the right edge of the handle row and invokes both drags.

- [x] T004 In `app/frontend/src/components/sidebar/server-panel.tsx`, add the optional prop `onSidebarResizeStart?: (e: React.PointerEvent<HTMLDivElement>) => void` to `ServerPanelProps`, destructure it in the `ServerPanel` signature, and forward it to the rendered `<CollapsiblePanel>` (line 101) as `onCornerPointerDown={onSidebarResizeStart}`. Spec ref: "UI: Prop Threading / `onSidebarResizeStart` Threaded Through Sidebar Tree". **Acceptance**: omitting the prop leaves `<CollapsiblePanel>` receiving no `onCornerPointerDown` (same as today); supplying it wires the corner callback through.

- [x] T005 In `app/frontend/src/components/sidebar/index.tsx`, add the optional prop `onSidebarResizeStart?: (e: React.PointerEvent<HTMLDivElement>) => void` to `SidebarProps` (near line 19), destructure it in the `Sidebar` signature, and pass it to the `<ServerPanel>` render (near line 494). Spec ref: same as T004. **Acceptance**: the prop flows Sidebar → ServerPanel → CollapsiblePanel unchanged; existing call sites that omit it compile without changes.

- [x] T006 In `app/frontend/src/app.tsx`, wire the desktop `<Sidebar>` render (near line 880) to pass `onSidebarResizeStart={(e) => handleDragStart(e.clientX)}`. Do NOT pass it to the mobile drawer `<Sidebar>` (near line 978) — the mobile drawer has no adjustable width and `showDragHandle` is false on mobile anyway. Spec ref: "UI: Prop Threading" scenarios for desktop and mobile drawer. **Acceptance**: corner resizes the sidebar width during a diagonal drag on desktop; mobile drawer renders unchanged.

## Phase 3: Integration & Edge Cases

- [x] T007 In `app/frontend/src/components/sidebar/collapsible-panel.tsx`, extend the existing unmount cleanup `useEffect` (lines 218–223) to also assign `document.body.style.cursor = ""` in its returned cleanup function, alongside the two `document.removeEventListener` calls. Spec ref: "UI: Drag Cursor Persistence / Unmount Cleanup of Body Cursor" (Confident assumption #16). **Acceptance**: if the component unmounts mid-drag (navigation, hot-reload, error boundary), the body cursor does not leak as `row-resize` / `nwse-resize`.

## Phase 4: Polish

- [x] T008 [P] Run `just test-frontend` and confirm the existing `app/frontend/src/components/sidebar/collapsible-panel.test.tsx` suite still passes unchanged. The default-render path (no `onCornerPointerDown`) preserves the existing single `<div role="separator">` handle, so `getByRole("separator", ...)` queries in the drag tests continue to match. No test changes are required by this task — if a test fails, treat it as a regression and fix the implementation. **Acceptance**: `just test-frontend` exits green.

- [x] T009 [P] (Optional — only if T003 is non-trivial) Add one unit test to `app/frontend/src/components/sidebar/collapsible-panel.test.tsx` under the existing `describe("resizable", ...)` block asserting that when `onCornerPointerDown` is supplied and the panel is open+resizable, a second element with `cursor-nwse-resize` class renders alongside the `role="separator"` handle, AND that pointerdown on the corner invokes both `onCornerPointerDown` (spied) and writes `document.body.style.cursor === "nwse-resize"`. Skip if the behavior is better covered by Playwright in review. **Acceptance**: new test passes via `just test-frontend`.

- [ ] T010 Playwright verification (covered during `/fab-continue` review stage, may not need a dedicated task). Exercise the nine checkpoints from the spec's "Testing / Playwright Verification on Desktop" section on a ≥1024px viewport: (1) hover cursors, (2) hover post-drag still works, (3) cursor persists mid-drag off-handle, (4) hover brightness parity, (5) corner visible, (6) corner `nwse-resize`, (7) diagonal drag resizes both axes, (8) corner hides on server-panel collapse, (9) mobile viewport unchanged. Run via `just pw test <name>` or `just test-e2e`. **Acceptance**: all nine checkpoints pass; screenshots captured for the review report.

---

## Execution Order

- **Phase 2 parallelism**: T001 and T002 touch different files (`collapsible-panel.tsx` vs `app.tsx`) and have no cross-dependency — run in parallel.
- **T003 depends on T001**: both edit `collapsible-panel.tsx`; T003 consumes the `cursor-row-resize` class introduced in T001 (serialize to avoid merge conflicts on the same handle `<div>`).
- **T005 depends on T004**: both are pure prop-threading passes and don't strictly conflict, but reading them in order (ServerPanel → Sidebar) matches the data-flow direction and keeps review linear.
- **T006 depends on T003, T004, T005**: `app.tsx` wiring requires the full prop chain to exist so the callback reaches `CollapsiblePanel`.
- **T007 depends on T001**: both edit `collapsible-panel.tsx` and T007 extends the same unmount effect; sequence them to avoid merge conflicts.
- **Phase 3 (T007) runs after Phase 2 completes** so the unmount cleanup sees the body-cursor writes introduced in T001/T002.
- **Phase 4**:
  - T008 and T009 are both test tasks and parallelizable (different concerns), though they run against the same file; do T008 first to confirm baseline, then T009 to add the new assertion if warranted.
  - T010 is a manual/automated Playwright sweep — runs last, after all code changes land.

## Acceptance

## Functional Completeness
<!-- Every requirement in spec.md has working implementation -->
- [ ] CHK-001 Body Cursor Override During Drag: Horizontal handler writes `document.body.style.cursor = "row-resize"` at pointerdown start in `onHandlePointerDown` (~`collapsible-panel.tsx:200`) and clears to `""` in `onPointerUp` (~line 183).
- [ ] CHK-002 Body Cursor Override During Drag: Vertical handler writes `document.body.style.cursor = "col-resize"` after `isDraggingRef.current = true` in `handleDragStart` (~`app.tsx:198`) and clears to `""` in `handleEnd` (~line 212).
- [ ] CHK-003 Preserve `preventDefault`: Existing `e.preventDefault()` call on horizontal pointerdown is retained unchanged — text selection is still blocked during drag.
- [ ] CHK-004 Unmount Cleanup of Body Cursor: `CollapsiblePanel` unmount cleanup `useEffect` (~`collapsible-panel.tsx:218–223`) assigns `document.body.style.cursor = ""` alongside existing listener cleanup.
- [ ] CHK-005 Horizontal Cursor Class: `collapsible-panel.tsx` line 313 uses `cursor-row-resize` (replacing `cursor-ns-resize`); no other cursor class on this handle.
- [ ] CHK-006 Vertical Cursor Class Retained: `app.tsx` vertical separator keeps `cursor-col-resize` — unchanged from today.
- [ ] CHK-007 Vertical Hover Opacity: `app.tsx` line 898 uses `hover:bg-text-secondary` (the `/40` opacity suffix has been removed).
- [ ] CHK-008 Corner Element Rendering: `CollapsiblePanel` accepts optional `onCornerPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void`. When supplied AND `showDragHandle` is true, the handle block renders as a flex row with a `flex-1` handle plus a `w-[7px] h-[3px]` corner (`bg-border hover:bg-text-secondary transition-colors select-none cursor-nwse-resize`).
- [ ] CHK-009 Corner Invocation Order: Corner `onPointerDown` invokes exactly in order: (1) `onHandlePointerDown(e)`, (2) `onCornerPointerDown(e)`, (3) `document.body.style.cursor = "nwse-resize"` — verified in code.
- [ ] CHK-010 Default Render Preserved: When `onCornerPointerDown` is not supplied, `CollapsiblePanel` renders the handle exactly as before (single `<div>`, no flex row, no corner) — byte-equivalent to pre-change for existing call sites.
- [ ] CHK-011 Prop Threading (Sidebar): `SidebarProps` in `components/sidebar/index.tsx` gains optional `onSidebarResizeStart?: (e: React.PointerEvent<HTMLDivElement>) => void`; destructured and forwarded to `<ServerPanel>` (~line 494).
- [ ] CHK-012 Prop Threading (ServerPanel): `ServerPanelProps` in `components/sidebar/server-panel.tsx` gains optional `onSidebarResizeStart`; destructured and passed to `<CollapsiblePanel>` as `onCornerPointerDown={onSidebarResizeStart}` (~line 101).
- [ ] CHK-013 Desktop Sidebar Wiring: `app.tsx` desktop sidebar JSX (~line 880) passes `onSidebarResizeStart={(e) => handleDragStart(e.clientX)}` to `<Sidebar>`.
- [ ] CHK-014 Mobile Drawer NOT Wired: `app.tsx` mobile drawer `<Sidebar>` (~line 978) does NOT receive `onSidebarResizeStart` — mobile drawer is unaffected.

## Behavioral Correctness
<!-- Changed requirements behave as specified, not as before -->
- [ ] CHK-015 Horizontal cursor vocabulary change: On hover of the horizontal handle, the OS cursor displays `row-resize` (double-arrow with middle bar), NOT `ns-resize` (plain double-arrow) as before.
- [ ] CHK-016 Vertical hover brightness change: Hovering the vertical handle now shows full-opacity `text-secondary` fill — perceptibly brighter than the previous 40% opacity.
- [ ] CHK-017 Post-drag hover regression fixed: After completing a drag on either separator and releasing, hovering the handle again still changes the cursor to `row-resize` / `col-resize` (no loss of cursor feedback after first drag).

## Removal Verification
<!-- Every deprecated requirement is actually gone -->
- [ ] CHK-018 `cursor-ns-resize` removed: Grep `collapsible-panel.tsx` — no remaining occurrences of `cursor-ns-resize` on the horizontal drag handle.
- [ ] CHK-019 `/40` opacity suffix removed: Grep `app.tsx` vertical separator line — no remaining `hover:bg-text-secondary/40`.

## Scenario Coverage
<!-- Key scenarios from spec.md have been exercised -->
- [ ] CHK-020 Scenario: Horizontal cursor survives a drag — after one full pointerdown/move/up cycle, re-hovering the horizontal handle still shows `row-resize` (Playwright or manual).
- [ ] CHK-021 Scenario: Vertical cursor survives a drag — after one full mousedown-or-touchstart/move/up cycle, re-hovering the vertical handle still shows `col-resize`.
- [ ] CHK-022 Scenario: Cursor persists while dragging off the handle — mid-drag, moving the pointer anywhere over `document.body` keeps the drag cursor visible (no revert to default).
- [ ] CHK-023 Scenario: Cursor cleared on pointerup — after any drag ends, hovering non-handle UI shows the default cursor (no stuck `row-resize` / `col-resize` / `nwse-resize`).
- [ ] CHK-024 Scenario: Text selection suppressed during horizontal drag — no page-level text selection occurs during the drag gesture.
- [ ] CHK-025 Scenario: Visual parity between separators on hover — both separators show separator-style cursors (double-arrow + middle bar); no plain `ns-resize` / `ew-resize` visible on either.
- [ ] CHK-026 Scenario: Brightness parity on hover — both separators' hover highlights are visually equivalent in brightness.
- [ ] CHK-027 Scenario: Corner visible on desktop with server panel open — corner element renders at the bottom-right edge of the server panel, flush against the horizontal handle row.
- [ ] CHK-028 Scenario: Corner hides when server panel collapses — collapsing the server panel removes the horizontal handle AND the corner (coupled via `showDragHandle`).
- [ ] CHK-029 Scenario: Corner hidden on mobile — on a mobile viewport (< 768px), neither drag handles nor the corner render; mobile drawer layout unchanged.
- [ ] CHK-030 Scenario: Corner cursor on hover — hovering the corner (without pressing) shows `nwse-resize` and the corner background transitions to `bg-text-secondary`.
- [ ] CHK-031 Scenario: Diagonal drag resizes both axes — pointerdown on corner + diagonal drag adjusts server-panel height (via `clientY`) AND sidebar width (via `clientX`) simultaneously; cursor shows `nwse-resize` throughout.
- [ ] CHK-032 Scenario: Corner cursor overrides axis-specific writes — mid corner-drag, `document.body.style.cursor` reads `nwse-resize` (not `row-resize` or `col-resize`).
- [ ] CHK-033 Scenario: Corner drag ends cleanly on pointerup — both horizontal and vertical cleanup paths fire independently; `document.body.style.cursor` clears to `""`.
- [ ] CHK-034 Scenario: Default render path preserved for other call sites — `WindowPanel`, `HostPanel`, and mobile drawer `<Sidebar>` all render `CollapsiblePanel` without a flex wrapper or corner (no visible diff).
- [ ] CHK-035 Scenario: `handleDragStart` receives `clientX` — the `(e) => handleDragStart(e.clientX)` adapter correctly passes the `PointerEvent`'s `clientX` into the existing vertical-drag entry point.

## Edge Cases & Error Handling
<!-- Error states, boundary conditions, failure modes -->
- [ ] CHK-036 Component unmounts mid-drag: If `CollapsiblePanel` unmounts while a drag is active (navigation, hot-reload, error boundary), the unmount cleanup clears `document.body.style.cursor`; no leaked cursor on remount.
- [ ] CHK-037 Partial corner-handler failure tolerance: If the horizontal handler's pointerdown throws, the vertical handler would not start — verified that both sub-calls are simple synchronous ref assignments (near-zero throw risk) and the order is documented.
- [ ] CHK-038 Corner pixel alignment at boundaries: At `1024px+` viewports, the `7px × 3px` corner does not overlap the vertical 5px handle unnaturally and does not create a visible gap (verify in Playwright).
- [ ] CHK-039 Hover scope on corner: Hovering the corner lights up only the corner (not both handles) — correct scope for the `hover:bg-text-secondary` treatment.

## Code Quality
<!-- One item per relevant code-quality principle + relevant anti-pattern, plus baseline items -->
- [ ] CHK-040 Pattern consistency: New code (prop naming, destructuring, optional-prop threading, JSX structure) follows the existing conventions in `sidebar/` components.
- [ ] CHK-041 No unnecessary duplication: Corner reuses existing handle styling tokens (`bg-border hover:bg-text-secondary transition-colors select-none`) rather than introducing parallel classes; corner invocation reuses `onHandlePointerDown` and the existing `handleDragStart` — no forked drag logic.
- [ ] CHK-042 Readability over cleverness: Flex-row conditional render (corner present vs absent) is implemented with a straightforward `if`/ternary branch, not a clever higher-order abstraction or context.
- [ ] CHK-043 Type narrowing over `as` casts: New callbacks typed as `React.PointerEvent<HTMLDivElement>` without `as` coercions; no new `any` introduced in the prop chain.
- [ ] CHK-044 No in-memory caches: The change derives state only from existing refs, props, and DOM — no new module-level or component-level caches introduced.
- [ ] CHK-045 Tests for changed behavior: Existing `collapsible-panel.test.tsx` still passes on the default render path; if the corner branch is non-trivial, a new unit test covers it (per T009) — or corner behavior is covered by Playwright.
- [ ] CHK-046 Playwright verification run on desktop: `just pw test <name>` or `just test-e2e` exercises the nine checkpoints from the spec's Testing section on ≥1024px viewport; never invoked via `npx playwright test` directly.
- [ ] CHK-047 No magic strings/numbers without context: Cursor strings (`"row-resize"`, `"col-resize"`, `"nwse-resize"`) and corner dimensions (`w-[7px] h-[3px]`) are self-descriptive in context; no unexplained numeric literals.
- [ ] CHK-048 No polling from client / no database imports: Change touches frontend UI only — no new `setInterval`/`fetch` polling, no ORM/DB imports (not expected for this scope, but verified).
- [ ] CHK-049 No new routes added without spec justification: Change does not add any routes (constitution IV — Minimal Surface Area).
- [ ] CHK-050 Go backend verification (`go test ./...` under `app/backend/`) passes — no backend changes, but verify the repo still builds clean.
- [ ] CHK-051 Frontend type check (`npx tsc --noEmit` under `app/frontend/`) passes — new optional props typed correctly across all three components.
- [ ] CHK-052 Production build (`just build`) succeeds — no type or build regressions introduced by the optional-prop additions.

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-### **N/A**: {reason}`
- Security category omitted — no authentication, authorization, exec, WebSocket, or SSE surface touched by this change (frontend presentation polish only).
