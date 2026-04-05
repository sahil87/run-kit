# Spec: ANSI Palette Theme Rework

**Change**: 260323-7wys-ansi-palette-theme-rework
**Created**: 2026-03-23
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`, `docs/memory/run-kit/architecture.md`

## Non-Goals

- Runtime `tmux set -g` calls for visual theming — ANSI indices in static tmux.conf + xterm.js palette is sufficient
- Adding new themes beyond the existing 20 (14 dark + 6 light)
- Per-server or per-session settings — settings are global

## Theme Data Model

### Requirement: Full ANSI palette type
The system SHALL define a `ThemePalette` type containing all 22 canonical terminal theme colors: `foreground`, `background`, `cursorColor`, `cursorText`, `selectionBackground`, `selectionForeground`, and 16 ANSI colors (indices 0-15) as a fixed-length readonly tuple.

#### Scenario: Theme palette structure
- **GIVEN** a theme definition in `app/frontend/src/themes.ts`
- **WHEN** the theme is loaded
- **THEN** `palette.ansi` SHALL be a 16-element readonly tuple of hex color strings
- **AND** `palette.foreground`, `palette.background`, `palette.cursorColor`, `palette.cursorText`, `palette.selectionBackground`, `palette.selectionForeground` SHALL each be hex color strings

### Requirement: Theme type uses palette instead of colors
The `Theme` type SHALL contain `palette: ThemePalette` replacing the current `colors` property. The `id`, `name`, and `category` fields SHALL remain unchanged. The `themeColor` field SHALL be removed (derivable from `palette.background`).

#### Scenario: Theme object shape
- **GIVEN** a `Theme` object
- **WHEN** accessed by consumers
- **THEN** it SHALL have `{ id, name, category, palette }` shape
- **AND** the `colors` property SHALL NOT exist
- **AND** the `themeColor` property SHALL NOT exist

### Requirement: UIColors type
The system SHALL export a `UIColors` type with the same 8 keys as the current `Theme["colors"]`: `bgPrimary`, `bgCard`, `bgInset`, `textPrimary`, `textSecondary`, `border`, `accent`, `accentGreen`.

#### Scenario: UIColors type shape
- **GIVEN** a `UIColors` object from `deriveUIColors()`
- **WHEN** used to set CSS custom properties
- **THEN** it SHALL have exactly the 8 keys matching `COLOR_CSS_MAP`

### Requirement: 20 theme palettes with canonical ANSI colors
The `THEMES` array SHALL contain exactly 20 themes (14 dark + 6 light) with full ANSI palettes sourced from canonical terminal theme definitions.

#### Scenario: All themes have full palettes
- **GIVEN** the `THEMES` array
- **WHEN** iterated
- **THEN** each theme SHALL have a valid `ThemePalette` with 16 ANSI colors plus 6 special colors

## Color Derivation

### Requirement: UI color derivation function
The system SHALL export `deriveUIColors(palette: ThemePalette, category: "dark" | "light"): UIColors` with the following derivation:

| UIColors key | Derivation |
|-------------|-----------|
| `bgPrimary` | `palette.background` |
| `bgCard` | `lighten(background, 8)` dark / `darken(background, 3)` light |
| `bgInset` | `darken(background, 5)` dark / `darken(background, 6)` light |
| `textPrimary` | `palette.foreground` |
| `textSecondary` | `palette.ansi[8]` (bright black) |
| `border` | `blend(foreground, background, 0.25)` |
| `accent` | `palette.ansi[4]` (blue) |
| `accentGreen` | `palette.ansi[2]` (green) |

#### Scenario: Dark theme UI color derivation
- **GIVEN** the Dracula palette
- **WHEN** `deriveUIColors(palette, "dark")` is called
- **THEN** `bgPrimary` SHALL equal `#282a36`
- **AND** `bgCard` SHALL be a lightened version of `#282a36`
- **AND** `textSecondary` SHALL equal `#6272a4` (ansi[8])
- **AND** `accent` SHALL equal `#bd93f9` (ansi[4])

#### Scenario: Light theme UI color derivation
- **GIVEN** the Solarized Light palette
- **WHEN** `deriveUIColors(palette, "light")` is called
- **THEN** `bgCard` SHALL be a darkened version of background

### Requirement: xterm.js theme derivation function
The system SHALL export `deriveXtermTheme(palette: ThemePalette)` producing an xterm.js `ITheme` with all 22 colors mapped: `background`, `foreground`, `cursor`, `cursorAccent`, `selectionBackground`, `selectionForeground`, and all 16 named ANSI colors.

#### Scenario: Full xterm.js theme
- **GIVEN** any theme palette
- **WHEN** `deriveXtermTheme(palette)` is called
- **THEN** the result SHALL include `black` through `brightWhite` (16 colors)
- **AND** the result SHALL include `cursor`, `cursorAccent`, `selectionBackground`, `selectionForeground`

### Requirement: Color utility helpers
Module-private helper functions SHALL be implemented: `hexToRgb`, `rgbToHex`, `lightenHex`, `darkenHex`, `blendHex`.

#### Scenario: Color helpers produce valid hex
- **GIVEN** a hex color and adjustment amount
- **WHEN** `lightenHex` or `darkenHex` is called
- **THEN** the result SHALL be a valid 7-character hex color string

## xterm.js Integration

### Requirement: Full palette applied to terminal
`TerminalClient` SHALL apply the full 22-color theme via `deriveXtermTheme()`. The `XTERM_THEMES` constant SHALL be removed.

#### Scenario: Terminal init with palette
- **GIVEN** a terminal client mounting
- **WHEN** the xterm.js Terminal is created
- **THEN** the `theme` option SHALL be `deriveXtermTheme(activeTheme.palette)`

#### Scenario: Terminal theme updates on theme change
- **GIVEN** a mounted terminal
- **WHEN** the active theme changes
- **THEN** `xtermRef.current.options.theme` SHALL be updated with `deriveXtermTheme(theme.palette)`

## tmux Configuration

### Requirement: ANSI colour indices replace hardcoded hex
`configs/tmux/default.conf` SHALL use ANSI `colour{N}` indices instead of hardcoded hex for all styling:

| Element | Old | New |
|---------|-----|-----|
| `status-style` | `bg=#1a1d27,fg=#e8eaf0` | `bg=colour0,fg=colour7` |
| `status-left` session name | `fg=#5b8af0` | `fg=colour4` |
| `status-right` | `fg=#e8eaf0` | `fg=colour7` |
| `window-status-current-format` | `fg=#0f1117,bg=#5b8af0` | `fg=colour0,bg=colour4` |
| `pane-border-style` | `fg=#2a2d37` | `fg=colour8` |
| `pane-active-border-style` | `fg=#5b8af0` | `fg=colour4` |

#### Scenario: Status bar uses colour indices
- **GIVEN** the tmux configuration loaded
- **WHEN** tmux renders the status bar
- **THEN** all color references SHALL use `colour{N}` syntax, not hex

#### Scenario: Pane border format uses colour indices
- **GIVEN** the `pane-border-format` string
- **WHEN** rendered by tmux
- **THEN** hex `#5b8af0` SHALL be `colour4`, `#0f1117` SHALL be `colour0`, `#e8eaf0` SHALL be `colour7`, `#2a2d37` SHALL be `colour8`, `#e8a84f` SHALL be `colour3`, `#9ca3af` SHALL be `colour8`

#### Scenario: Auto-theming via xterm.js
- **GIVEN** tmux.conf uses ANSI colour indices and xterm.js has a full ANSI palette
- **WHEN** the user switches theme
- **THEN** tmux chrome SHALL automatically reflect the new theme colors without any runtime `tmux set` calls

## Backend Settings Persistence

### Requirement: Settings package
`app/backend/internal/settings/` SHALL provide:
- `Settings` struct with `Theme string` field
- `Default() Settings` returning `Settings{Theme: "system"}`
- `Load() Settings` reading `~/.rk/settings.yaml`, returning `Default()` if missing
- `Save(s Settings) error` writing `~/.rk/settings.yaml`, creating `~/.rk/` if absent

The file SHALL use simple `key: value` text parsing (not yaml.v3).

#### Scenario: Load returns default when file missing
- **GIVEN** `~/.rk/settings.yaml` does not exist
- **WHEN** `settings.Load()` is called
- **THEN** the result SHALL be `Settings{Theme: "system"}`

#### Scenario: Load reads existing file
- **GIVEN** `~/.rk/settings.yaml` contains `theme: dracula`
- **WHEN** `settings.Load()` is called
- **THEN** the result SHALL be `Settings{Theme: "dracula"}`

#### Scenario: Save creates directory and file
- **GIVEN** `~/.rk/` may not exist
- **WHEN** `settings.Save(Settings{Theme: "dracula"})` is called
- **THEN** `~/.rk/settings.yaml` SHALL contain `theme: dracula\n`
- **AND** the directory SHALL be created with mode 0755

### Requirement: Theme API endpoints
Routes registered in `app/backend/api/router.go`:
- `GET /api/settings/theme` → `{"theme": "..."}` (reads via `settings.Load()`)
- `PUT /api/settings/theme` ← `{"theme": "..."}` → `{"status": "ok"}` (writes via `settings.Save()`)

These endpoints SHALL NOT use the `?server=` parameter.

#### Scenario: GET returns current preference
- **GIVEN** settings file contains `theme: nord`
- **WHEN** `GET /api/settings/theme`
- **THEN** response SHALL be `200 {"theme": "nord"}`

#### Scenario: GET returns default when no file
- **GIVEN** no settings file
- **WHEN** `GET /api/settings/theme`
- **THEN** response SHALL be `200 {"theme": "system"}`

#### Scenario: PUT saves preference
- **GIVEN** body `{"theme": "dracula"}`
- **WHEN** `PUT /api/settings/theme`
- **THEN** settings file SHALL be updated
- **AND** response SHALL be `200 {"status": "ok"}`

#### Scenario: PUT with empty theme
- **GIVEN** body `{"theme": ""}`
- **WHEN** `PUT /api/settings/theme`
- **THEN** response SHALL be `400` with error message

## Frontend Persistence Flow

### Requirement: API client theme functions
`app/frontend/src/api/client.ts` SHALL export:
- `getThemePreference(): Promise<string>` — `GET /api/settings/theme`, returns the `theme` field
- `setThemePreference(theme: string): Promise<void>` — `PUT /api/settings/theme`

These SHALL NOT use `withServer()`.

#### Scenario: getThemePreference
- **GIVEN** backend returns `{"theme": "dracula"}`
- **WHEN** `getThemePreference()` is called
- **THEN** it SHALL resolve to `"dracula"`

### Requirement: ThemeProvider API persistence
The `ThemeProvider` SHALL:
- On init: call `getThemePreference()`, fall back to localStorage / `"system"` if API fails
- Keep localStorage as synchronous cache — write alongside API call
- `setTheme` SHALL call `setThemePreference(id)` fire-and-forget alongside localStorage write

#### Scenario: Init loads from API
- **GIVEN** backend has `theme: nord`
- **WHEN** ThemeProvider mounts
- **THEN** it SHALL apply "nord" theme once API responds

#### Scenario: Init falls back to localStorage on API failure
- **GIVEN** API call fails
- **WHEN** ThemeProvider mounts
- **THEN** it SHALL use localStorage value, falling back to "system"

#### Scenario: Theme change persists to both stores
- **GIVEN** user selects "dracula"
- **WHEN** `setTheme("dracula")` is called
- **THEN** localStorage SHALL update immediately
- **AND** `setThemePreference("dracula")` SHALL be called fire-and-forget

### Requirement: DOM application uses derived colors
`applyThemeToDOM` SHALL compute CSS values via `deriveUIColors(theme.palette, theme.category)` and set `theme-color` meta tag to `theme.palette.background`.

#### Scenario: CSS properties from derived colors
- **GIVEN** a Dracula theme
- **WHEN** `applyThemeToDOM` runs
- **THEN** CSS custom properties SHALL match `deriveUIColors()` output
- **AND** `theme-color` meta tag SHALL be `#282a36`

## Theme Selector

### Requirement: Palette-based color swatches
Theme rows in `ThemeSelector` SHALL display a multi-color swatch showing background plus representative ANSI colors (red, green, yellow, blue, magenta, cyan) instead of the current single-color swatch.

#### Scenario: Swatch shows palette preview
- **GIVEN** the theme selector is open
- **WHEN** a Dracula theme row renders
- **THEN** the swatch SHALL show multiple colors from the Dracula palette

## Deprecated Requirements

### Theme.colors property
**Reason**: Replaced by `ThemePalette`. Consumers use `deriveUIColors()`.
**Migration**: `theme.colors.X` → `deriveUIColors(theme.palette, theme.category).X`

### Theme.themeColor property
**Reason**: Derivable from `palette.background`.
**Migration**: `theme.themeColor` → `theme.palette.background`

### XTERM_THEMES constant
**Reason**: Replaced by `deriveXtermTheme()` with all 22 colors.
**Migration**: `XTERM_THEMES[resolved]` → `deriveXtermTheme(theme.palette)`

## Design Decisions

1. **Full ANSI palette over minimal color set**: 22 canonical colors per theme enables three consumers from one source.
   - *Why*: Terminal themes define semantic color roles. Full palette themes xterm.js canvas and tmux chrome automatically.
   - *Rejected*: Keep 8-color model + separate xterm colors — duplicative, inconsistent.

2. **Static tmux.conf with ANSI indices over runtime `tmux set -g`**: `colour0`-`colour15` indices render through xterm.js.
   - *Why*: Changing xterm.js palette auto-themes tmux. Zero backend involvement.
   - *Rejected*: Runtime tmux commands — complex, fragile, requires backend communication.

3. **Backend settings file over localStorage-only**: `~/.rk/settings.yaml` via API.
   - *Why*: Survives cache clears, works across devices, consistent with server-side state.
   - *Rejected*: localStorage-only — lost on clear. yaml.v3 — heavyweight for one field.

4. **Simple key:value parsing**: Manual text parsing for settings file.
   - *Why*: One field. Avoids re-adding yaml.v3 dependency.
   - *Rejected*: yaml.v3 import.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Full ANSI palette: 22 colors per theme | Confirmed from intake #1 — user specified | S:95 R:85 A:90 D:95 |
| 2 | Certain | Three consumers from same palette: CSS, xterm.js, tmux | Confirmed from intake #2 — agreed architecture | S:95 R:80 A:90 D:90 |
| 3 | Certain | tmux.conf uses ANSI colour indices | Confirmed from intake #3 — xterm.js rendering chain | S:95 R:75 A:90 D:95 |
| 4 | Certain | Backend persistence at ~/.rk/settings.yaml | Confirmed from intake #4 — user chose approach | S:95 R:80 A:85 D:90 |
| 5 | Certain | GET/PUT /api/settings/theme (not per-server) | Confirmed from intake #5 — global settings | S:90 R:85 A:85 D:90 |
| 6 | Certain | internal/settings/ as separate package | Confirmed from intake #6 — config is env-var based | S:95 R:90 A:90 D:95 |
| 7 | Certain | UI derivation: bg→bgPrimary, ansi[8]→textSecondary, ansi[4]→accent, ansi[2]→accentGreen | Confirmed from intake #7 | S:90 R:85 A:85 D:80 |
| 8 | Certain | xterm.js gets full 22-color theme via deriveXtermTheme() | Confirmed from intake #8 | S:95 R:85 A:90 D:95 |
| 9 | Certain | localStorage as synchronous cache alongside API | Confirmed from intake #9 | S:85 R:90 A:85 D:85 |
| 10 | Certain | Canonical palettes from iTerm2-Color-Schemes | Confirmed from intake #11 | S:90 R:90 A:80 D:85 |
| 11 | Certain | bgCard via lighten/darken (not from palette) | Confirmed from intake #12 | S:85 R:85 A:80 D:75 |
| 12 | Certain | border via blend(fg, bg, 0.25) | Confirmed from intake #13 | S:85 R:85 A:80 D:75 |
| 13 | Certain | No runtime tmux set -g calls | Confirmed from intake #14 | S:90 R:80 A:90 D:90 |
| 14 | Certain | Simple key:value format for settings.yaml | Confirmed from intake #15 | S:80 R:90 A:85 D:85 |
| 15 | Certain | pane-border-format hex→colour index mapping | Confirmed from intake #16 | S:90 R:75 A:85 D:85 |
| 16 | Certain | 20 themes (14 dark + 6 light) | Confirmed from intake #17 | S:90 R:90 A:90 D:95 |
| 17 | Certain | UIColors type exported for deriveUIColors output | Spec derivation — same 8 keys as current colors | S:85 R:90 A:85 D:85 |
| 18 | Certain | configs/tmux/default.conf is canonical source | Codebase — header says "copied to build at build time" | S:95 R:90 A:95 D:95 |
| 19 | Certain | COLOR_CSS_MAP retained for CSS property mapping | Spec derivation — still needed by applyThemeToDOM | S:85 R:90 A:90 D:90 |

19 assumptions (19 certain, 0 confident, 0 tentative, 0 unresolved).
