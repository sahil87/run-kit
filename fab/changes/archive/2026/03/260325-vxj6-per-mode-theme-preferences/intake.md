# Intake: Per-Mode Theme Preferences

**Change**: 260325-vxj6-per-mode-theme-preferences
**Created**: 2026-03-25
**Status**: Draft

## Origin

> Create new configs - previous-dark-theme, previous-light-theme - so that when you toggle between light and dark mode - you get to "your" dark mode and "your" light mode. Start with the default dark/light themes. But as I make my choices, save those choices.

One-shot request. No prior conversation.

## Why

Today, `"system"` mode hard-codes `DEFAULT_DARK_THEME` and `DEFAULT_LIGHT_THEME` when the OS toggles between dark and light. If you've found a dark theme you love (e.g., Dracula) and a light theme you love (e.g., Solarized Light), there's no way to have both — selecting either one locks you out of automatic OS-driven toggling. You're forced to choose between auto-switching (but only with the defaults) or a specific theme (but only one mode).

Without this change, users who care about both modes must manually open the theme selector every time their OS switches — annoying enough that most people just stay in one mode.

## What Changes

### Per-Mode Preference Storage

Add two new settings fields alongside the existing `theme` preference:

**Backend** (`app/backend/internal/settings/settings.go`):
```go
type Settings struct {
    Theme      string // "system" | specific theme ID (existing)
    ThemeDark  string // preferred dark theme ID (default: "default-dark")
    ThemeLight string // preferred light theme ID (default: "default-light")
}
```

**`~/.rk/settings.yaml`** format becomes:
```yaml
theme: system
theme_dark: dracula
theme_light: solarized-light
```

**API** (`app/backend/api/settings.go`):
- `GET /api/settings/theme` → `{"theme": "system", "theme_dark": "default-dark", "theme_light": "default-light"}`
- `PUT /api/settings/theme` accepts all three fields (partial updates — only provided fields are changed)

**Frontend** (`app/frontend/src/api/client.ts`):
- `getThemePreference()` returns `{ theme: string, themeDark: string, themeLight: string }`
- `setThemePreference()` accepts partial updates

### System Mode Resolution

In `theme-context.tsx`, `resolveThemeObject` changes from:

```typescript
// Before: hard-coded defaults
const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
return prefersDark ? DEFAULT_DARK_THEME : DEFAULT_LIGHT_THEME;
```

to:

```typescript
// After: user's per-mode preferences
const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
return prefersDark ? getThemeById(themeDark) ?? DEFAULT_DARK_THEME
                   : getThemeById(themeLight) ?? DEFAULT_LIGHT_THEME;
```

### Automatic Preference Saving

When the user selects a theme from the theme selector:
1. Apply the theme immediately (existing behavior)
2. Based on the theme's `category` (`"dark"` or `"light"`), update the corresponding per-mode preference
3. If the user was in `"system"` mode, stay in `"system"` mode — don't switch to a specific theme ID

This means: select Dracula → `theme_dark` becomes `"dracula"`, mode stays `"system"`, OS-driven toggling continues. Next time OS goes dark, you get Dracula.

### localStorage Caching

Extend the localStorage cache to include per-mode preferences:
- `runkit-theme` → `"system"` (existing)
- `runkit-theme-dark` → `"dracula"` (new)
- `runkit-theme-light` → `"solarized-light"` (new)

## Affected Memory

- `run-kit/ui-patterns`: (modify) Update theme system description to reflect per-mode preferences

## Impact

- **Backend**: `internal/settings/settings.go` — add fields, parse/serialize
- **Backend**: `api/settings.go` — extend GET/PUT response/request shapes
- **Frontend**: `src/api/client.ts` — update API types and functions
- **Frontend**: `src/contexts/theme-context.tsx` — core resolution logic, state management
- **Frontend**: `src/components/theme-selector.tsx` — confirm action saves per-mode pref
- **Frontend**: `src/themes.ts` — no changes expected (data layer is stable)

## Open Questions

(none)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use `"default-dark"` and `"default-light"` as initial per-mode defaults | These are the existing hard-coded fallbacks in `resolveThemeObject` | S:90 R:95 A:95 D:95 |
| 2 | Certain | Store per-mode prefs in the existing `~/.rk/settings.yaml` file | Constitution says no database; this is the established settings path | S:80 R:90 A:95 D:95 |
| 3 | Certain | Extend existing `GET/PUT /api/settings/theme` rather than new endpoints | Constitution says minimal surface area; same resource, richer representation | S:75 R:90 A:90 D:90 |
| 4 | Confident | Theme selection in system mode auto-saves per-mode preference without leaving system mode | User said "as I make my choices, save those choices" — implies transparent saving while preserving toggle behavior | S:70 R:80 A:70 D:65 |
| 5 | Confident | Use theme `category` field to determine which per-mode slot to update | Each theme already has `"dark"` or `"light"` category — natural slot selector | S:65 R:85 A:80 D:75 |
| 6 | Confident | Add `runkit-theme-dark` and `runkit-theme-light` localStorage keys for per-mode caching | Follows existing pattern (`runkit-theme`); needed for instant load before API responds | S:60 R:90 A:85 D:80 |
| 7 | Certain | No changes to theme palette data (`configs/themes.json`) or derivation functions (`themes.ts`) | This change is about preference storage and resolution, not theme content | S:90 R:95 A:95 D:95 |

7 assumptions (4 certain, 3 confident, 0 tentative, 0 unresolved).
