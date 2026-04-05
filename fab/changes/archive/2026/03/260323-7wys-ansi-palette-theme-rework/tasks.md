# Tasks: ANSI Palette Theme Rework

**Change**: 260323-7wys-ansi-palette-theme-rework
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Setup

- [x] T001 Create `app/backend/internal/settings/settings.go` — `Settings` struct, `Default()`, `Load()`, `Save()` with simple key:value parsing, `~/.rk/` directory creation
- [x] T002 [P] Create `app/backend/internal/settings/settings_test.go` — unit tests for Load (missing file, valid file, malformed), Save (creates dir, writes correctly), Default
- [x] T003 [P] Create `app/backend/api/settings.go` — `handleGetTheme` and `handlePutTheme` handlers using `settings.Load()`/`settings.Save()`

## Phase 2: Core Implementation

- [x] T004 Rewrite `app/frontend/src/themes.ts` — define `ThemePalette` and `UIColors` types, implement `deriveUIColors()`, `deriveXtermTheme()`, color helpers (`hexToRgb`, `rgbToHex`, `lightenHex`, `darkenHex`, `blendHex`), replace all 20 theme definitions with full ANSI palettes, remove `Theme.colors`/`Theme.themeColor`, update `Theme` to use `palette: ThemePalette`
- [x] T005 Update `app/frontend/src/contexts/theme-context.tsx` — change `applyThemeToDOM` to use `deriveUIColors(theme.palette, theme.category)` for CSS properties and `theme.palette.background` for theme-color meta tag, update `resolveThemeObject` for new Theme shape
- [x] T006 [P] Update `app/frontend/src/components/terminal-client.tsx` — remove `XTERM_THEMES` constant, import `deriveXtermTheme` from themes, use `useTheme()` to get active theme, apply `deriveXtermTheme(theme.palette)` on init and on theme change
- [x] T007 [P] Update `configs/tmux/default.conf` — replace all hardcoded hex colors with ANSI `colour{N}` indices in status-style, status-left, status-right, window-status-current-format, pane-border-style, pane-active-border-style, and pane-border-format

## Phase 3: Integration & Edge Cases

- [x] T008 Add theme API client functions to `app/frontend/src/api/client.ts` — `getThemePreference()` and `setThemePreference()` (no `withServer()`)
- [x] T009 Register settings routes in `app/backend/api/router.go` — `r.Get("/api/settings/theme", s.handleGetTheme)` and `r.Put("/api/settings/theme", s.handlePutTheme)`
- [x] T010 Update `app/frontend/src/contexts/theme-context.tsx` — add API persistence: `getThemePreference()` on init with localStorage fallback, `setThemePreference()` fire-and-forget in `setTheme`
- [x] T011 [P] Update `app/frontend/src/components/theme-selector.tsx` — replace single-color swatch with multi-color palette preview (bg + representative ANSI colors)

## Phase 4: Tests & Verification

- [x] T012 Update `app/frontend/src/themes.test.ts` — test ThemePalette structure validation, deriveUIColors for dark/light, deriveXtermTheme mapping, color helper functions
- [x] T013 [P] Update `app/frontend/src/contexts/theme-context.test.tsx` — update for new Theme shape (palette instead of colors), API persistence
- [x] T014 Run verification gates: `cd app/backend && go test ./...`, `cd app/frontend && npx tsc --noEmit`, `cd app/frontend && npx vitest run`

---

## Execution Order

- T001 blocks T003 (handlers need settings package)
- T004 blocks T005, T006, T011, T012 (all consume new Theme/palette types)
- T005 blocks T010 (API persistence builds on applyThemeToDOM changes)
- T008 blocks T010 (API client needed by ThemeProvider)
- T003 + T009 can run together (handler + route registration)
- T012, T013 can run after their respective source changes
- T014 runs last (verifies everything)
