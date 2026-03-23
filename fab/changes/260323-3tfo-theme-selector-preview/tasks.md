# Tasks: Theme Selector with Live Preview

**Change**: 260323-3tfo-theme-selector-preview
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Setup

- [x] T001 [P] Create theme data model and built-in themes in `app/frontend/src/themes.ts` — define `Theme` interface, all 20 theme color palettes (14 dark + 6 light), `THEMES` array, `getThemeById()`, `DEFAULT_DARK_THEME`, `DEFAULT_LIGHT_THEME` exports
- [x] T002 [P] Add unit tests for theme data in `app/frontend/src/themes.test.ts` — verify all 20 themes have valid 8-property color objects, default themes match globals.css values, `getThemeById` lookups work

## Phase 2: Core Implementation

- [x] T003 Refactor `app/frontend/src/contexts/theme-context.tsx` — expand `ThemePreference` to `string`, add `previewTheme`/`cancelPreview` to actions, resolve theme by ID via `getThemeById`, apply colors via inline `document.documentElement.style` properties, handle `"system"` → Default Dark/Light, treat unrecognized localStorage values as `"system"`
- [x] T004 Add tests for theme context in `app/frontend/src/contexts/theme-context.test.tsx` — test `setTheme` with theme IDs, preview/cancel flow, system preference resolution, unrecognized localStorage fallback
- [x] T005 Create `app/frontend/src/components/theme-selector.tsx` — modal overlay with search input, scrollable theme list grouped by Dark/Light category headers, arrow key navigation (wrapping, skipping headers), mouse hover preview, Enter to confirm, Escape/outside-click to cancel and revert, opens via `"theme-selector:open"` custom event listener

## Phase 3: Integration & Edge Cases

- [x] T006 [P] Update `ThemeToggle` in `app/frontend/src/components/top-bar.tsx` — add Ctrl/Cmd+Click detection (`e.ctrlKey || e.metaKey`) to dispatch `"theme-selector:open"` event, normal click cycles system → default-light → default-dark
- [x] T007 [P] Update command palette actions in `app/frontend/src/app.tsx` — add "Theme: Select Theme" action that dispatches `"theme-selector:open"`, update existing theme cycle actions to use new theme IDs (`"default-light"`, `"default-dark"`, `"system"`), mount `<ThemeSelector />` component
- [x] T008 Add integration tests for theme selector in `app/frontend/src/components/theme-selector.test.tsx` — test open/close, search filtering, keyboard navigation, preview on navigate, confirm persists, cancel reverts

## Phase 4: Polish

- [x] T009 Verify type-check passes (`npx tsc --noEmit`) and all tests pass (`npx vitest run`) — fix any type errors from the ThemePreference type change

---

## Execution Order

- T001 and T002 are parallel (T002 imports from T001 but tests can be written alongside)
- T003 depends on T001 (imports theme data)
- T004 depends on T003
- T005 depends on T003 (uses previewTheme/cancelPreview from context)
- T006, T007 are parallel, both depend on T005 being available
- T008 depends on T005, T006, T007
- T009 depends on all above
