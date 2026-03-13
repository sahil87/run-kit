# Tasks: UI Chrome & Layout Refinements

**Change**: 260312-y4ci-ui-chrome-layout-refinements
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Breadcrumbs & Borders

- [x] T001 [P] Simplify breadcrumbs in `app/frontend/src/components/top-bar.tsx`: remove `›` separator spans (U+203A), change session BreadcrumbDropdown icon from `\u2B21` to `\u276F`, remove the standalone `<span>` wrappers that contained the `›` separators
- [x] T002 [P] Add `border-b border-border` to the `<header>` element in `app/frontend/src/components/top-bar.tsx`

## Phase 2: Layout Restructure

- [x] T003 Move `<BottomBar>` from root-level `app-shell` to inside the terminal column in `app/frontend/src/app.tsx`. Add `border-t border-border` to the bottom bar wrapper. Remove the outer `shrink-0 px-3 sm:px-6 pb-1` wrapper and apply `px-3 sm:px-6` inside the terminal column
- [x] T004 Add `[+ Session]` button to top bar line 2 in `app/frontend/src/components/top-bar.tsx` — always visible (not gated on `currentWindow`). Add `onCreateSession` prop to TopBar. Wire in `app/frontend/src/app.tsx`
- [x] T005 Remove sidebar footer (`[+ New Session]` button and `border-t` separator) from `app/frontend/src/components/sidebar.tsx`. Remove `onCreateSession` prop from Sidebar type and all call sites in `app/frontend/src/app.tsx`

## Phase 3: Sidebar Resize & Padding

- [x] T006 Implement drag-resizable sidebar in `app/frontend/src/app.tsx`: replace fixed `w-[220px]` with state-driven width from localStorage (`runkit-sidebar-width`, default 220). Add drag handle div (4-6px) on sidebar right edge with `cursor-col-resize`. Implement mouse drag (mousedown/mousemove/mouseup on document) and touch drag handlers. Clamp to min 160px / max 400px. Persist to localStorage on mouseup/touchend. Apply to desktop sidebar only (not mobile drawer)
- [x] T007 [P] Update sidebar padding in `app/frontend/src/components/sidebar.tsx`: change `px-4` to `px-3 sm:px-6` on the `<nav>` element
- [x] T008 [P] Add terminal container padding `py-0.5 px-1` in `app/frontend/src/app.tsx` to the div wrapping `<TerminalClient>`
- [x] T009 [P] Update bottom bar padding from `py-0.5` to `py-1.5` in `app/frontend/src/components/bottom-bar.tsx`

## Phase 4: Tests & Docs

- [x] T010 [P] Update existing tests: fix `app/frontend/src/components/sidebar.test.tsx` to remove assertions about footer/`+ New Session` button. Fix `app/frontend/src/components/breadcrumb-dropdown.test.tsx` or `top-bar` tests if they assert on `⬡` icon or `›` separators
- [x] T011 [P] Update `docs/specs/design.md`: breadcrumb format, layout diagrams (desktop/mobile), CSS skeleton, sidebar drag-resizable, resolved decisions table entries (#12, #13, #18-21), padding values in Visual Consistency Rules

---

## Execution Order

- T001, T002 are independent (Phase 1, parallel)
- T003 must complete before T004 (bottom bar move before adding + Session button to top bar — ensures layout is correct before adding new element)
- T005 can run after T004 (remove sidebar footer after top bar has the button)
- T006 depends on T003 (sidebar resize needs the new layout structure)
- T007, T008, T009 are independent padding changes (parallel after T003)
- T010, T011 are independent (parallel, after implementation)
