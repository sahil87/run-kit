# Tasks: Sidebar Separator Cursor Fixes

**Change**: 260419-9ufu-sidebar-separator-cursor-fixes
**Spec**: `spec.md`
**Intake**: `intake.md`

<!--
  TASK FORMAT: - [ ] {ID} [{markers}] {Description with file paths}

  Markers:
    [P]   — Parallelizable (different files, no dependencies on other [P] tasks in same group)

  Testing: run via `just` recipes only (never `go test`, `pnpm test`, or `playwright test` directly).
    - Frontend unit: `just test-frontend`
    - E2E: `just test-e2e` (port 3020, isolated tmux server)
    - Ad-hoc Playwright: `just pw test <name>`
-->

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
