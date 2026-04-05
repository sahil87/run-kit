# Quality Checklist: Theme Selector with Live Preview

**Change**: 260323-3tfo-theme-selector-preview
**Generated**: 2026-03-23
**Spec**: `spec.md`

## Functional Completeness
- [x] CHK-001 Theme Type Definition: `Theme` interface exists in `themes.ts` with all 8 color properties, category, and themeColor
- [x] CHK-002 Built-in Theme Collection: `THEMES` array contains exactly 20 themes (14 dark + 6 light)
- [x] CHK-003 Default themes match globals.css: Default Dark/Light colors exactly match current CSS custom property values
- [x] CHK-004 Theme lookup helpers: `getThemeById`, `DEFAULT_DARK_THEME`, `DEFAULT_LIGHT_THEME` are exported and work
- [x] CHK-005 Expanded ThemeProvider: `useTheme()` returns `{ preference, resolved, theme }`, `useThemeActions()` returns `{ setTheme, previewTheme, cancelPreview }`
- [x] CHK-006 Inline style application: Theme colors set via `document.documentElement.style`, `data-theme` set to category, `color-scheme` updated, meta theme-color updated
- [x] CHK-007 Theme Selector Modal: Opens via `"theme-selector:open"` event, has search input, grouped list, checkmark on active theme
- [x] CHK-008 Live Preview: Arrow key navigation and mouse hover trigger `previewTheme()`, UI updates in real-time
- [x] CHK-009 Confirm/Cancel: Enter persists to localStorage, Escape/outside-click reverts to original theme
- [x] CHK-010 Search Filtering: Case-insensitive substring match, category headers hidden when empty, "No matching themes" when no results
- [x] CHK-011 Dual-Action ThemeToggle: Normal click cycles system→default-light→default-dark, Ctrl/Cmd+Click dispatches theme-selector:open
- [x] CHK-012 Command Palette Integration: "Theme: Select Theme" action exists and opens theme selector

## Behavioral Correctness
- [x] CHK-013 ThemePreference type change: No TypeScript errors from expanding `ThemePreference` from union to `string`
- [x] CHK-014 Unrecognized localStorage: Old values ("dark", "light", garbage) fall back to "system" on read
- [x] CHK-015 System preference: "system" correctly resolves to Default Dark/Light based on OS `prefers-color-scheme`

## Removal Verification
- [x] CHK-016 Old ThemePreference type: Old `"system" | "light" | "dark"` union type is removed, replaced by `string`

## Scenario Coverage
- [x] CHK-017 Ctrl+Click opens selector: Clicking ThemeToggle with Ctrl/Cmd opens modal, does not cycle
- [x] CHK-018 Arrow key preview: Navigating themes with arrows applies preview immediately
- [x] CHK-019 Cancel reverts: Pressing Escape after previewing restores original theme
- [x] CHK-020 Keyboard wrap: ArrowDown on last item wraps to first, ArrowUp on first wraps to last

## Edge Cases & Error Handling
- [x] CHK-021 localStorage unavailable: ThemeProvider gracefully handles missing/throwing localStorage
- [x] CHK-022 Empty search results: Typing unmatched text shows "No matching themes"

## Code Quality
- [x] CHK-023 Pattern consistency: ThemeSelector follows CommandPalette structural patterns (overlay, backdrop, keyboard nav, ARIA)
- [x] CHK-024 No unnecessary duplication: Theme application logic centralized in context, not duplicated in components
- [x] CHK-025 Type narrowing: No `as` casts for theme types — use proper type guards
- [x] CHK-026 No magic strings: Theme IDs and CSS property names use constants

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
