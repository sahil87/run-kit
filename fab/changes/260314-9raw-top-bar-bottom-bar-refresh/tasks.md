# Tasks: Top Bar & Bottom Bar UI Refresh

**Change**: 260314-9raw-top-bar-bottom-bar-refresh
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Bottom Bar Cleanup

- [x] T001 Remove `cmd` from `ModifierSnapshot` type and all state/logic in `app/frontend/src/hooks/use-modifier-state.ts` — remove `cmd` from type, `useRef` initial state, `useMemo` return, and deps array
- [x] T002 Remove Cmd button, compose button, and `onOpenCompose` prop from `app/frontend/src/components/bottom-bar.tsx` — remove `cmd` from modifier array, `MODIFIER_LABELS.cmd`, `modParam()` cmd branch, `hasModifiers()` cmd check, compose `<button>`, and update `BottomBarProps`
- [x] T003 Increase button sizes in `app/frontend/src/components/bottom-bar.tsx` — update `KBD_CLASS` from `min-h-[32px] min-w-[32px] coarse:min-h-[36px] coarse:min-w-[28px]` to `min-h-[36px] min-w-[36px] coarse:min-h-[44px] coarse:min-w-[36px]`

## Phase 2: Top Bar Restructure

- [x] T004 Create hamburger/X icon component in `app/frontend/src/components/top-bar.tsx` — SVG with 3 lines that transform to X via CSS `transition-transform`, driven by `isOpen` prop (from `sidebarOpen`/`drawerOpen`)
- [x] T005 Restructure top bar left section in `app/frontend/src/components/top-bar.tsx` — replace logo `<img>` toggle with hamburger icon, change `❯` separators to `/` plain text, make session/window name text the dropdown triggers (refactor `BreadcrumbDropdown` usage), add `max-w-[7ch] truncate` to session name
- [x] T006 Restructure top bar right section in `app/frontend/src/components/top-bar.tsx` — add logo `<img>` (decorative), "Run Kit" text, remove "live"/"disconnected" text from connection indicator, keep FixedWidthToggle + ⌘K + ⋯, add compose button (`>_`) as rightmost. Add `onOpenCompose` to `TopBarProps`. Mobile: hide all except ⋯ and >_ via `hidden sm:flex`

## Phase 3: App Shell Wiring

- [x] T007 Update `app/frontend/src/app.tsx` — pass `onOpenCompose` to `<TopBar>`, remove `onOpenCompose` from `<BottomBar>` props. Pass `sidebarOpen` and `drawerOpen` to `<TopBar>` for hamburger animation state

## Phase 4: Tests

- [x] T008 [P] Update `app/frontend/src/components/top-bar.test.tsx` — update tests for new breadcrumb format (no ❯, `/` separator, name-text triggers), add test for compose button, update connection status test (dot only, no text), add hamburger icon test
- [x] T009 [P] Verify `app/frontend/src/hooks/use-modifier-state.ts` has no `cmd` references — run TypeScript type check to confirm no compile errors from `cmd` removal

---

## Execution Order

- T001 blocks T002 (modifier state type change needed before bottom-bar can remove cmd button)
- T002 and T003 can run together after T001
- T004 blocks T005 (hamburger component needed before top bar restructure)
- T005 and T006 can run together after T004
- T007 depends on T002 (BottomBar props change) and T006 (TopBar props change)
- T008 and T009 are independent of each other, depend on T005-T007
