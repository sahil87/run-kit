# Quality Checklist: Per-Mode Theme Preferences

**Change**: 260325-vxj6-per-mode-theme-preferences
**Generated**: 2026-03-25
**Spec**: `spec.md`

## Functional Completeness
- [x] CHK-001 Per-mode fields: Settings struct has ThemeDark and ThemeLight with correct defaults
- [x] CHK-002 Parse legacy: Old settings files without new fields load correctly with defaults
- [x] CHK-003 Serialization: All three fields written to settings.yaml
- [x] CHK-004 GET response: API returns theme, theme_dark, theme_light
- [x] CHK-005 PUT partial: API accepts partial updates, merges with existing values
- [x] CHK-006 Frontend API: getThemePreference returns all three fields, setThemePreference accepts partial
- [x] CHK-007 System resolution: System mode uses themeDark/themeLight instead of hard-coded defaults
- [x] CHK-008 Theme selection: Selecting a theme saves to correct per-mode slot and stays in system mode
- [x] CHK-009 localStorage: Per-mode prefs cached under runkit-theme-dark and runkit-theme-light

## Behavioral Correctness
- [x] CHK-010 OS toggle: Switching OS dark/light triggers correct per-mode theme
- [x] CHK-011 Fallback: Invalid stored preference ID falls back to default dark/light theme
- [x] CHK-012 Backward compat: setTheme("system") still works without changing per-mode prefs

## Scenario Coverage
- [x] CHK-013 Fresh install: No settings file → system mode with default dark/light
- [x] CHK-014 Existing user: Legacy settings.yaml with only theme field → per-mode defaults apply
- [x] CHK-015 Select dark theme: User picks Dracula → themeDark saved, system mode preserved
- [x] CHK-016 Select light theme: User picks Solarized Light → themeLight saved, system mode preserved

## Edge Cases & Error Handling
- [x] CHK-017 Empty PUT body: Returns 400 error
- [x] CHK-018 Nonexistent theme ID: Falls back gracefully without crashing

## Code Quality
- [x] CHK-019 Pattern consistency: New settings fields follow existing parse/serialize patterns
- [x] CHK-020 No unnecessary duplication: Reuse existing getThemeById, DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME
- [x] CHK-021 No exec.Command without context: No new subprocess calls in this change
- [x] CHK-022 Type narrowing: Frontend uses proper type guards, no `as` casts

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
