# Spec: Per-Mode Theme Preferences

**Change**: 260325-vxj6-per-mode-theme-preferences
**Created**: 2026-03-25
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`

## Backend: Settings Model

### Requirement: Per-Mode Theme Fields

The `Settings` struct (`app/backend/internal/settings/settings.go`) SHALL include `ThemeDark` and `ThemeLight` fields alongside the existing `Theme` field. `ThemeDark` defaults to `"default-dark"`. `ThemeLight` defaults to `"default-light"`.

#### Scenario: Default settings

- **GIVEN** no `~/.rk/settings.yaml` file exists
- **WHEN** `Load()` is called
- **THEN** `Settings.Theme` is `"system"`, `Settings.ThemeDark` is `"default-dark"`, `Settings.ThemeLight` is `"default-light"`

#### Scenario: Parse existing file with new fields

- **GIVEN** `settings.yaml` contains `theme: system\ntheme_dark: dracula\ntheme_light: solarized-light\n`
- **WHEN** `parse()` is called
- **THEN** `Theme` is `"system"`, `ThemeDark` is `"dracula"`, `ThemeLight` is `"solarized-light"`

#### Scenario: Parse legacy file without new fields

- **GIVEN** `settings.yaml` contains only `theme: dracula\n`
- **WHEN** `parse()` is called
- **THEN** `Theme` is `"dracula"`, `ThemeDark` is `"default-dark"`, `ThemeLight` is `"default-light"`

### Requirement: Serialize All Fields

`serialize()` MUST write all three fields to the settings file: `theme`, `theme_dark`, and `theme_light`.

#### Scenario: Full serialization

- **GIVEN** `Settings{Theme: "system", ThemeDark: "dracula", ThemeLight: "solarized-light"}`
- **WHEN** `serialize()` is called
- **THEN** output is `"theme: system\ntheme_dark: dracula\ntheme_light: solarized-light\n"`

## Backend: API

### Requirement: Extended Theme GET Response

`GET /api/settings/theme` SHALL return all three fields as a JSON object: `{"theme": "...", "theme_dark": "...", "theme_light": "..."}`.

#### Scenario: Full response

- **GIVEN** settings contain `Theme: "system"`, `ThemeDark: "dracula"`, `ThemeLight: "default-light"`
- **WHEN** `GET /api/settings/theme`
- **THEN** response is `{"theme": "system", "theme_dark": "dracula", "theme_light": "default-light"}`

### Requirement: Partial Theme PUT

`PUT /api/settings/theme` SHALL accept a JSON body with any combination of `theme`, `theme_dark`, and `theme_light` fields. Only provided fields are updated; omitted fields retain their current values. At least one field MUST be provided.

#### Scenario: Update only per-mode dark preference

- **GIVEN** current settings are `{theme: "system", theme_dark: "default-dark", theme_light: "default-light"}`
- **WHEN** `PUT /api/settings/theme` with `{"theme_dark": "dracula"}`
- **THEN** saved settings are `{theme: "system", theme_dark: "dracula", theme_light: "default-light"}`

#### Scenario: Update all fields at once

- **GIVEN** any current settings
- **WHEN** `PUT /api/settings/theme` with `{"theme": "system", "theme_dark": "nord", "theme_light": "github-light"}`
- **THEN** all three fields are saved as provided

#### Scenario: Empty body rejected

- **GIVEN** any state
- **WHEN** `PUT /api/settings/theme` with `{}`
- **THEN** 400 response with error

## Frontend: API Client

### Requirement: Updated API Types

`getThemePreference()` in `app/frontend/src/api/client.ts` SHALL return `{ theme: string; themeDark: string; themeLight: string }`. `setThemePreference()` SHALL accept a partial object `{ theme?: string; themeDark?: string; themeLight?: string }`.

#### Scenario: Fetch all preferences

- **GIVEN** API returns `{"theme": "system", "theme_dark": "dracula", "theme_light": "default-light"}`
- **WHEN** `getThemePreference()` resolves
- **THEN** result is `{ theme: "system", themeDark: "dracula", themeLight: "default-light" }`

## Frontend: Theme Context

### Requirement: Per-Mode State

`ThemeProvider` (`app/frontend/src/contexts/theme-context.tsx`) SHALL track `themeDark` and `themeLight` state in addition to the existing `preference`. These are initialized from the API response (or localStorage cache) with defaults `"default-dark"` and `"default-light"`.

#### Scenario: Initial load from API

- **GIVEN** API returns `{theme: "system", theme_dark: "dracula", theme_light: "solarized-light"}`
- **WHEN** `ThemeProvider` mounts
- **THEN** internal state holds `preference: "system"`, `themeDark: "dracula"`, `themeLight: "solarized-light"`

### Requirement: System Mode Uses Per-Mode Preferences

When `preference` is `"system"`, `resolveThemeObject` SHALL use the `themeDark` preference when OS prefers dark and the `themeLight` preference when OS prefers light, falling back to `DEFAULT_DARK_THEME` / `DEFAULT_LIGHT_THEME` if the stored ID is not found.

#### Scenario: OS dark mode with custom dark preference

- **GIVEN** `preference` is `"system"`, `themeDark` is `"dracula"`, OS prefers dark
- **WHEN** theme is resolved
- **THEN** active theme is Dracula

#### Scenario: OS light mode with custom light preference

- **GIVEN** `preference` is `"system"`, `themeLight` is `"solarized-light"`, OS prefers light
- **WHEN** theme is resolved
- **THEN** active theme is Solarized Light

#### Scenario: Invalid stored preference falls back to default

- **GIVEN** `preference` is `"system"`, `themeDark` is `"nonexistent-theme"`, OS prefers dark
- **WHEN** theme is resolved
- **THEN** active theme is Default Dark

#### Scenario: OS toggles between modes

- **GIVEN** `preference` is `"system"`, `themeDark` is `"dracula"`, `themeLight` is `"solarized-light"`
- **WHEN** OS switches from dark to light
- **THEN** active theme changes from Dracula to Solarized Light

### Requirement: Theme Selection Saves Per-Mode Preference

When a user selects a theme via `setTheme`, the system SHALL:
1. Apply the theme immediately
2. Update the per-mode preference matching the theme's `category` (`"dark"` → `themeDark`, `"light"` → `themeLight`)
3. Set `preference` to `"system"` (enabling auto-toggle)
4. Persist all three values to API and localStorage

#### Scenario: Select a dark theme

- **GIVEN** current state is `{preference: "system", themeDark: "default-dark", themeLight: "default-light"}`
- **WHEN** user selects Dracula (category: dark)
- **THEN** state becomes `{preference: "system", themeDark: "dracula", themeLight: "default-light"}`
- **AND** Dracula is the active theme
- **AND** API is called with `{theme: "system", theme_dark: "dracula"}`

#### Scenario: Select a light theme while in dark mode

- **GIVEN** current state is `{preference: "system", themeDark: "dracula", themeLight: "default-light"}`, OS prefers dark
- **WHEN** user selects Solarized Light (category: light)
- **THEN** state becomes `{preference: "system", themeDark: "dracula", themeLight: "solarized-light"}`
- **AND** Solarized Light is the active theme (temporarily showing light, will switch back to Dracula when OS is dark)

### Requirement: localStorage Per-Mode Cache

The frontend SHALL cache per-mode preferences in localStorage under keys `runkit-theme-dark` and `runkit-theme-light`, alongside the existing `runkit-theme` key. On mount, these are read as initial values before the API responds.

#### Scenario: Fast load from cache

- **GIVEN** localStorage has `runkit-theme: "system"`, `runkit-theme-dark: "dracula"`, `runkit-theme-light: "solarized-light"`
- **WHEN** ThemeProvider mounts before API responds
- **THEN** theme resolves using cached per-mode values

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Default per-mode values are `"default-dark"` and `"default-light"` | Confirmed from intake #1 — these are the existing hard-coded fallbacks | S:90 R:95 A:95 D:95 |
| 2 | Certain | Store in existing `~/.rk/settings.yaml` | Confirmed from intake #2 — constitution prohibits database | S:80 R:90 A:95 D:95 |
| 3 | Certain | Extend existing `GET/PUT /api/settings/theme` | Confirmed from intake #3 — minimal surface area principle | S:75 R:90 A:90 D:90 |
| 4 | Certain | Theme selection in system mode saves per-mode pref and stays in system mode | Confirmed from intake #4 — user wants transparent saving with toggle preservation | S:85 R:80 A:85 D:80 |
| 5 | Certain | Use theme `category` field to route to correct per-mode slot | Confirmed from intake #5 — every theme has category | S:80 R:85 A:90 D:85 |
| 6 | Certain | Add `runkit-theme-dark` and `runkit-theme-light` localStorage keys | Confirmed from intake #6 — follows existing caching pattern | S:75 R:90 A:85 D:80 |
| 7 | Certain | No changes to `configs/themes.json` or `themes.ts` derivation | Confirmed from intake #7 — this is preference storage only | S:90 R:95 A:95 D:95 |
| 8 | Confident | PUT endpoint uses partial merge (load-then-update) rather than full replace | PUT should not require all fields — frontend may update only `theme_dark` after a selection | S:70 R:75 A:80 D:70 |
| 9 | Confident | YAML keys use `theme_dark`/`theme_light` (snake_case) matching existing `theme` convention | Existing settings file uses simple `key: value` without nesting | S:65 R:85 A:80 D:75 |
| 10 | Certain | `setTheme("system")` is still supported and resets to system mode without changing per-mode prefs | Backward compatibility — existing "system" selection should work as before | S:85 R:90 A:90 D:90 |

10 assumptions (8 certain, 2 confident, 0 tentative, 0 unresolved).
