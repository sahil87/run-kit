# Quality Checklist: Add Light Theme Support

**Change**: 260318-eseg-add-light-theme-support
**Generated**: 2026-03-18
**Spec**: `spec.md`

## Functional Completeness
- [x] CHK-001 Dual theme palettes: Both dark and light palettes defined with all 8 CSS custom properties (7 existing + bg-inset)
- [x] CHK-002 No-flicker script: Blocking inline script in index.html sets data-theme before first paint
- [x] CHK-003 ThemeProvider: Context provides preference, resolved theme, and setTheme action
- [x] CHK-004 System preference listener: matchMedia change events update resolved theme when preference is "system"
- [x] CHK-005 Theme persistence: setTheme writes to localStorage key "runkit-theme"
- [x] CHK-006 xterm theme: Terminal uses resolved theme at construction and updates live on theme change
- [x] CHK-007 Command palette: Three theme actions present with "(current)" suffix on active preference

## Behavioral Correctness
- [x] CHK-008 color-scheme property: Set to "dark" or "light" per data-theme selector (not hardcoded to dark)
- [x] CHK-009 Fixed-width bg: Uses bg-bg-inset token, not hardcoded #0a0c12
- [x] CHK-010 Default behavior: Absent localStorage treated as "system" preference
- [x] CHK-011 Provider order: ThemeProvider > ChromeProvider > SessionProvider > AppShell
- [x] CHK-012 html class="dark" removed from index.html (replaced by data-theme attribute)

## Scenario Coverage
- [x] CHK-013 First visit + light OS: Page renders light theme without flicker
- [x] CHK-014 Returning visit + stored dark: Page renders dark theme regardless of OS preference
- [x] CHK-015 OS theme change while preference=system: App updates in real-time
- [x] CHK-016 Theme switch via palette: Immediate visual change, localStorage updated, palette closes
- [x] CHK-017 Terminal theme live update: xterm colors change without terminal recreation

## Edge Cases & Error Handling
- [x] CHK-018 localStorage unavailable: Falls back gracefully (defaults to system/dark, no crash)
- [x] CHK-019 Invalid localStorage value: Treated as "system"
- [x] CHK-020 System preference listener cleanup: matchMedia listener removed on unmount or preference change

## Code Quality
- [x] CHK-021 Pattern consistency: ThemeProvider follows split-context pattern from ChromeContext
- [x] CHK-022 No unnecessary duplication: Theme resolution logic shared between blocking script and ThemeProvider
- [x] CHK-023 Existing utilities reused: localStorage pattern matches runkit-sidebar-width and runkit-fixed-width
- [x] CHK-024 Type narrowing: ThemePreference and ResolvedTheme types used instead of bare strings
- [x] CHK-025 No magic strings: localStorage key defined as constant

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
