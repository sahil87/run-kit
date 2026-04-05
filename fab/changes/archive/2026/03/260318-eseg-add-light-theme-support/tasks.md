# Tasks: Add Light Theme Support

**Change**: 260318-eseg-add-light-theme-support
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Setup

- [x] T001 Restructure `app/frontend/src/globals.css` — move color values from `@theme` block into `html[data-theme="dark"]` and `html[data-theme="light"]` selectors. Keep `@theme` block with token names only (initial values from dark palette for Tailwind registration). Add `--color-bg-inset` token. Set `color-scheme` per selector. Update scrollbar styles per theme.

- [x] T002 Add blocking theme script to `app/frontend/index.html` — inline `<script>` in `<head>` before other scripts. Reads `localStorage("runkit-theme")`, resolves system preference, sets `data-theme`. Change static default from `class="dark"` to `data-theme="dark"`. Keep `fullbleed` class.

## Phase 2: Core Implementation

- [x] T003 Create `app/frontend/src/contexts/theme-context.tsx` — ThemeProvider with split context (ThemeStateContext, ThemeActionsContext). Types: `ThemePreference`, `ResolvedTheme`, `ThemeState`, `ThemeActions`. Hooks: `useTheme()`, `useThemeActions()`. Reads localStorage on mount, resolves system preference, listens to `matchMedia` change events when preference is "system". `setTheme()` writes localStorage, updates `data-theme` attribute, updates state.

- [x] T004 Wire ThemeProvider into `app/frontend/src/app.tsx` — wrap as outermost provider (ThemeProvider > ChromeProvider > SessionProvider > AppShell). Replace `bg-[#0a0c12]` with `bg-bg-inset` for the fixed-width outer background.

- [x] T005 Update `app/frontend/src/components/terminal-client.tsx` — import `useTheme()`, define dark/light xterm theme objects, use resolved theme at Terminal construction. Add `useEffect` to update `terminal.options.theme` when resolved theme changes.

- [x] T006 Add theme actions to `app/frontend/src/components/command-palette.tsx` (via `app/frontend/src/app.tsx` palette actions) — three actions: "Theme: System", "Theme: Light", "Theme: Dark" with "(current)" suffix on active preference. Call `setTheme()` from `useThemeActions()`.

## Phase 3: Integration & Edge Cases

- [x] T007 Add unit tests for ThemeProvider — `app/frontend/src/contexts/theme-context.test.tsx`. Test: default to system, reads localStorage, setTheme persists, system preference listener fires, explicit preference ignores OS changes.

- [x] T008 [P] Add unit tests for command palette theme actions — extend `app/frontend/src/components/command-palette.test.tsx` (or create if not existing). Test: theme actions appear, current theme has "(current)" suffix, selecting action calls setTheme.

- [x] T009 [P] Add unit test for xterm theme switching — `app/frontend/src/components/terminal-client.test.tsx` (or extend if existing). Test: terminal constructed with correct theme based on resolved theme.

---

## Execution Order

- T001 and T002 are independent, can run in parallel
- T003 depends on T001 (needs CSS custom property structure in place)
- T004 depends on T003 (needs ThemeProvider)
- T005 depends on T003 (needs useTheme hook)
- T006 depends on T003 (needs useThemeActions hook)
- T004, T005, T006 can run in parallel after T003
- T007, T008, T009 can run in parallel after T004-T006
