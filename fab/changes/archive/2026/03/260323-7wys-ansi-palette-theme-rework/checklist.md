# Quality Checklist: ANSI Palette Theme Rework

**Change**: 260323-7wys-ansi-palette-theme-rework
**Generated**: 2026-03-23
**Spec**: `spec.md`

## Functional Completeness
- [x] CHK-001 ThemePalette type: 22-color type with 16-element ansi tuple defined in themes.ts
- [x] CHK-002 Theme type: uses `palette: ThemePalette` (no `colors`, no `themeColor`)
- [x] CHK-003 UIColors type: 8 keys exported from themes.ts
- [x] CHK-004 deriveUIColors: returns correct UIColors for dark and light themes
- [x] CHK-005 deriveXtermTheme: returns ITheme with all 22 colors mapped
- [x] CHK-006 Color helpers: hexToRgb, rgbToHex, lightenHex, darkenHex, blendHex implemented
- [x] CHK-007 20 theme palettes: all themes have full ANSI palettes (14 dark + 6 light)
- [x] CHK-008 XTERM_THEMES removed: terminal-client uses deriveXtermTheme
- [x] CHK-009 tmux.conf: all hex colors replaced with colour{N} indices
- [x] CHK-010 Settings package: Load/Save/Default with simple key:value parsing
- [x] CHK-011 GET /api/settings/theme: returns current preference
- [x] CHK-012 PUT /api/settings/theme: saves preference
- [x] CHK-013 API client: getThemePreference and setThemePreference exported
- [x] CHK-014 ThemeProvider: loads from API on init, falls back to localStorage
- [x] CHK-015 ThemeProvider: setTheme persists to both localStorage and API
- [x] CHK-016 Theme selector: multi-color palette swatch

## Behavioral Correctness
- [x] CHK-017 applyThemeToDOM: uses deriveUIColors() for CSS custom properties
- [x] CHK-018 applyThemeToDOM: sets theme-color meta to palette.background
- [x] CHK-019 Terminal init: uses deriveXtermTheme(activeTheme.palette)
- [x] CHK-020 Terminal theme update: reacts to theme changes with full palette
- [x] CHK-021 Settings API: not scoped by ?server= parameter

## Removal Verification
- [x] CHK-022 Theme.colors property: removed from type and all 20 theme objects
- [x] CHK-023 Theme.themeColor property: removed from type and all 20 theme objects
- [x] CHK-024 XTERM_THEMES constant: removed from terminal-client.tsx

## Scenario Coverage
- [x] CHK-025 Load settings when file missing → returns default "system"
- [x] CHK-026 Load settings when file exists → returns stored theme
- [x] CHK-027 Save settings when directory missing → creates ~/.rk/ and writes
- [x] CHK-028 Dark theme derivation produces correct accent/textSecondary from palette
- [x] CHK-029 Light theme derivation uses darken (not lighten) for bgCard

## Edge Cases & Error Handling
- [x] CHK-030 API failure on init: ThemeProvider falls back to localStorage gracefully
- [x] CHK-031 PUT with empty theme body: returns 400 error
- [x] CHK-032 setThemePreference failure: fire-and-forget, does not block UI

## Code Quality
- [x] CHK-033 Pattern consistency: new Go code follows exec.CommandContext with timeouts pattern
- [x] CHK-034 No unnecessary duplication: settings Load/Save are the only file I/O (no duplicate)
- [x] CHK-035 Readability: color derivation functions are clear with named helpers
- [x] CHK-036 No shell strings: settings package uses os.ReadFile/os.WriteFile
- [x] CHK-037 No database imports: settings uses filesystem only

## Security
- [x] CHK-038 Settings file path: uses os.UserHomeDir, no user-controlled path components
- [x] CHK-039 PUT body validation: theme field required, non-empty

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
