# Quality Checklist: UI Chrome & Layout Refinements

**Change**: 260312-y4ci-ui-chrome-layout-refinements
**Generated**: 2026-03-13
**Spec**: `spec.md`

## Functional Completeness
- [ ] CHK-001 Unified breadcrumb icon: Both session and window BreadcrumbDropdown use `\u276F` (❯), no `›` separators or `⬡` in DOM
- [ ] CHK-002 Top bar border: `<header>` has `border-b border-border`
- [ ] CHK-003 Bottom bar inside terminal column: BottomBar renders as child of terminal column div, not root app-shell
- [ ] CHK-004 Bottom bar border: Bottom bar wrapper has `border-t border-border`
- [ ] CHK-005 Sidebar drag-resizable: Width stored in state from localStorage, drag handle present, min/max clamped
- [ ] CHK-006 Sidebar footer removed: No `+ New Session` button or `border-t` separator at sidebar bottom
- [ ] CHK-007 `+ Session` in top bar line 2: Button visible alongside Rename/Kill, always rendered
- [ ] CHK-008 Sidebar padding: `<nav>` uses `px-3 sm:px-6`
- [ ] CHK-009 Terminal padding: Terminal container has `py-0.5 px-1`
- [ ] CHK-010 Bottom bar padding: `py-1.5` replaces `py-0.5`
- [ ] CHK-011 Design spec updated: `docs/specs/design.md` reflects all layout, breadcrumb, padding, and sidebar changes

## Behavioral Correctness
- [ ] CHK-012 Session dropdown still works: Clicking ❯ before session name opens session dropdown, selection navigates
- [ ] CHK-013 Window dropdown still works: Clicking ❯ before window name opens window dropdown, selection navigates
- [ ] CHK-014 Sidebar resize persists: Dragging sidebar to new width saves to localStorage, reload restores
- [ ] CHK-015 Sidebar resize clamps: Cannot go below 160px or above 400px
- [ ] CHK-016 Terminal refits on sidebar resize: xterm FitAddon refits when sidebar width changes
- [ ] CHK-017 `+ Session` button opens create dialog: Clicking the top bar button triggers the create session dialog

## Removal Verification
- [ ] CHK-018 No `›` separator spans in top-bar.tsx breadcrumb markup
- [ ] CHK-019 No `⬡` (U+2B21) icon reference in top-bar.tsx
- [ ] CHK-020 No sidebar footer div with `+ New Session` button in sidebar.tsx
- [ ] CHK-021 `onCreateSession` prop removed from Sidebar component type

## Scenario Coverage
- [ ] CHK-022 Desktop breadcrumb renders `☰ {logo} ❯ session ❯ window`
- [ ] CHK-023 Bottom bar width matches terminal width (not full viewport)
- [ ] CHK-024 Initial sidebar load with localStorage value uses persisted width
- [ ] CHK-025 Initial sidebar load without localStorage uses 220px default
- [ ] CHK-026 `+ Session` button visible even with no current window selected

## Edge Cases & Error Handling
- [ ] CHK-027 Sidebar drag beyond max (400px) clamps correctly
- [ ] CHK-028 Sidebar drag below min (160px) clamps correctly
- [ ] CHK-029 Mobile drawer unaffected by sidebar resize logic (< 768px)
- [ ] CHK-030 Bottom bar in mobile: spans full width when sidebar hidden

## Code Quality
- [ ] CHK-031 Pattern consistency: New code follows naming and structural patterns of surrounding code
- [ ] CHK-032 No unnecessary duplication: Existing utilities reused where applicable
- [ ] CHK-033 Readability: Drag resize logic is clean and maintainable, not over-engineered
- [ ] CHK-034 No `exec()` or shell string construction (Go anti-pattern check — N/A for frontend-only change)
- [ ] CHK-035 Type narrowing: No `as` casts introduced — prefer type guards
- [ ] CHK-036 No magic numbers: Sidebar min/max/default as named constants

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
