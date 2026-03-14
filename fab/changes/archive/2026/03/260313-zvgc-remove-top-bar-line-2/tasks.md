# Tasks: Remove Top Bar Line 2

**Change**: 260313-zvgc-remove-top-bar-line-2
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Setup

- [x] T001 Add `action` prop to `BreadcrumbDropdown` component (`app/frontend/src/components/breadcrumb-dropdown.tsx`): extend `Props` type with optional `action: { label: string; onAction: () => void }`. Render the action item before the `items.map()` list with a divider (`border-t border-border`) separating them. Action item uses `text-text-primary` styling, closes dropdown on click, and is excluded from ArrowUp/ArrowDown focus-index tracking.

## Phase 2: Core Implementation

- [x] T002 Remove Line 2 from `TopBar` (`app/frontend/src/components/top-bar.tsx`): delete the entire `<div className="hidden sm:flex ...">` block (lines 143–218) containing `+ Session`, `Rename`, `Kill` buttons, window status display, and `FixedWidthToggle` invocation.
- [x] T003 Remove unused props from `TopBarProps` in `app/frontend/src/components/top-bar.tsx`: remove `onRename` and `onKill` props that were exclusively used by Line 2. Remove the `parseFabChange` and `getWindowDuration` imports (only referenced in Line 2 status display). Retain `currentSession` and `currentWindow` — both are used by Line 1 breadcrumb dropdown logic (building `windowItems` and current-item highlighting). Update the destructured parameters accordingly. <!-- clarified: currentSession and currentWindow are NOT Line-2-only — used in windowItems construction at lines 43-49 -->
- [x] T004 Relocate `FixedWidthToggle` to Line 1 in `app/frontend/src/components/top-bar.tsx`: render `<FixedWidthToggle />` in the right-side `<div>` of Line 1, between the connection label (`<span>{isConnected ? "live" : "disconnected"}</span>`) and the `⌘K` kbd element. Add touch target sizing: `coarse:min-h-[36px] coarse:min-w-[28px]`.
- [x] T005 [P] Wire `+ New Session` action into the session `BreadcrumbDropdown` in `app/frontend/src/components/top-bar.tsx`: pass `action={{ label: "+ New Session", onAction: onCreateSession }}` to the session dropdown. `onCreateSession` remains in `TopBarProps` (T003 only removes `onRename` and `onKill`).
- [x] T006 [P] Wire `+ New Window` action into the window `BreadcrumbDropdown` in `app/frontend/src/components/top-bar.tsx`: pass `action={{ label: "+ New Window", onAction: onCreateWindow }}` to the window dropdown. Add `onCreateWindow` to `TopBarProps` with type `(session: string) => void`, invoked with the current `sessionName`.

## Phase 3: Integration & Edge Cases

- [x] T007 Update parent component(s) that render `TopBar` to remove now-unused prop passes (`onRename`, `onKill`) and add `onCreateWindow` prop. Retain `currentSession` and `currentWindow` passes (still used by Line 1). Find call sites via grep for `<TopBar`. <!-- clarified: currentSession and currentWindow retained — see T003 -->
- [x] T008 [P] Update sidebar empty state in `app/frontend/src/components/sidebar.tsx`: replace the text-only "No sessions" `<div>` with a `+ New Session` button. Add `onCreateSession: () => void` to `SidebarProps`. Render a centered button with consistent styling. Keep "No sessions" as secondary text.
- [x] T009 [P] Update `BreadcrumbDropdownItem` type in `app/frontend/src/contexts/chrome-context.tsx` if needed — verify no orphaned type fields after Line 2 removal.

## Phase 4: Polish

- [x] T010 Run `cd app/frontend && npx tsc --noEmit` to verify no type errors from prop changes.
- [x] T011 Run `cd app/frontend && npx vitest run` to verify existing tests pass. The entire `top-bar.test.tsx` describe block ("TopBar Line 2 enriched status") tests Line 2 elements (`getByTestId("line2-status")`, fab stage badge, pane command, duration) — all of these must be removed or rewritten to test Line 1 behavior instead. The `sidebar.test.tsx` empty-state test ("shows empty state when no sessions") currently asserts only "No sessions" text — update to verify the new `+ New Session` button is present.
- [x] T012 Update `fab/project/context.md` line 77 ("Top bar line 2 (+ Session, Rename, Kill, status, fixed-width toggle) is `hidden sm:flex` — hidden on mobile where it adds no value") — remove or replace with a note that the top bar is a single line. Also update the Touch Targets list (line 139, "Line 2 action buttons (Rename, Kill)") to remove the Line 2 reference. <!-- clarified: context.md is a project-level file read by all skills — stale Line 2 references would mislead future artifact generation -->

---

## Execution Order

- T001 blocks T005 and T006 (dropdown action support needed before wiring)
- T002 and T003 are sequential (remove Line 2 first, then clean up props)
- T004 depends on T002 (toggle needs new home after Line 2 removal)
- T005 and T006 are parallel (independent dropdown wiring)
- T007 depends on T003, T005, T006 (parent prop alignment after all TopBar changes)
- T008 and T009 are parallel and independent of T002–T007
- T010 depends on T001–T009 (all code changes complete)
- T011 depends on T010 (type check first, then test)
- T012 is independent — can run any time after T002
