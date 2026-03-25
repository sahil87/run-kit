# Tasks: Per-Mode Theme Preferences

**Change**: 260325-vxj6-per-mode-theme-preferences
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Backend

- [x] T001 Add `ThemeDark` and `ThemeLight` fields to `Settings` struct, update `Default()`, `parse()`, and `serialize()` in `app/backend/internal/settings/settings.go`
- [x] T002 Update `app/backend/internal/settings/settings_test.go` — add tests for new fields: default values, parse with new fields, parse legacy file, serialization of all three fields
- [x] T003 Update `app/backend/api/settings.go` — extend `handleGetTheme` to return all three fields, extend `handlePutTheme` to accept partial updates (load-then-merge)

## Phase 2: Frontend API + Context

- [x] T004 Update `app/frontend/src/api/client.ts` — change `getThemePreference()` return type to `{ theme: string; themeDark: string; themeLight: string }`, change `setThemePreference()` to accept partial object
- [x] T005 Update `app/frontend/src/contexts/theme-context.tsx` — add `themeDark`/`themeLight` state, update `resolveThemeObject` to use per-mode prefs in system mode, update `setTheme` to save per-mode preference by category, update localStorage reads/writes for new keys, update OS media-query listener to use per-mode prefs

## Phase 3: Tests

- [x] T006 [P] Run Go backend tests: `cd app/backend && go test ./...`
- [x] T007 [P] Run frontend type check: `cd app/frontend && npx tsc --noEmit`

---

## Execution Order

- T001 blocks T002 and T003
- T003 blocks T004
- T004 blocks T005
- T006 and T007 are independent, run after T005
