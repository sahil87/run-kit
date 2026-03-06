# Tasks: Navbar Breadcrumb Dropdowns

**Change**: 260307-uzsa-navbar-breadcrumb-dropdowns
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Type Extension

- [x] T001 Extend `Breadcrumb` type in `src/contexts/chrome-context.tsx` — add `BreadcrumbDropdownItem` type (`{ label: string; href: string; current?: boolean }`) and optional `dropdownItems?: BreadcrumbDropdownItem[]` to `Breadcrumb`

## Phase 2: Dropdown Component

- [x] T002 Create `src/components/breadcrumb-dropdown.tsx` — new Client Component that receives `dropdownItems: BreadcrumbDropdownItem[]` and renders a chevron (`▾`) button + dropdown menu. Implement: open/close state, outside-click dismiss (document listener), Escape key dismiss, ArrowUp/ArrowDown keyboard navigation, Enter to select. Style: `bg-bg-card border border-border shadow-lg z-50 min-w-[160px]`, items with `role="menuitem"`, container with `role="menu"`. Current item highlighted with `text-accent`. Use Next.js `Link` for items.

## Phase 3: Integration

- [x] T003 Update `src/components/top-bar-chrome.tsx` — modify breadcrumb rendering loop to render `BreadcrumbDropdown` chevron next to crumbs that have `dropdownItems`. Keep existing label rendering (Link with `href` or static span) unchanged. Import `BreadcrumbDropdown` and render it inline after the label.
- [x] T004 [P] Update `src/app/p/[project]/project-client.tsx` — populate `dropdownItems` on the project breadcrumb. Map `sessions` from `useSessions()` to `BreadcrumbDropdownItem[]` with `label: s.name`, `href: /p/${s.name}`, `current: s.name === projectName`.
- [x] T005 [P] Update `src/app/p/[project]/[window]/terminal-client.tsx` — populate `dropdownItems` on both breadcrumbs. Project breadcrumb: same mapping as T004. Window breadcrumb: map current session's `windows` to items with `label: w.name`, `href: /p/${projectName}/${w.index}?name=${encodeURIComponent(w.name)}`, `current: w.index === windowIndex`.

## Phase 4: Polish

- [x] T006 Verify build — run `npx tsc --noEmit` and `pnpm build` to confirm no type errors or build issues

---

## Execution Order

- T001 blocks T002, T003, T004, T005
- T002 blocks T003
- T004 and T005 are independent (different files)
- T006 runs after all other tasks
