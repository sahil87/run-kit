# Intake: ANSI Palette Theme Rework

**Change**: 260323-7wys-ansi-palette-theme-rework
**Created**: 2026-03-23
**Status**: In Progress

## Origin

> Rework theme system to use full ANSI terminal palettes (22 colors per theme) sourced from canonical terminal theme definitions. Three consumers from same palette: (1) Web UI CSS via 8 derived colors, (2) xterm.js canvas with full 16 ANSI + fg/bg/cursor/selection, (3) tmux chrome automatically themed via ANSI colour indices in tmux.conf. Add backend settings persistence at ~/.rk/settings.yaml with GET/PUT /api/settings/theme endpoints. Rework tmux.conf to use colour0-colour15 indices instead of hardcoded hex so pane borders, status bar, and pane-border-format auto-theme when xterm.js palette changes.

Conversational evolution from the theme selector change (260323-3tfo). Discussion covered: terminal theme color anatomy (16 ANSI + fg/bg/cursor/selection = 22 colors), Ghostty/iTerm2-Color-Schemes as canonical sources, the xterm.js→tmux rendering chain where ANSI indices in tmux.conf auto-theme through xterm.js, and persistence architecture (settings file over localStorage).

## Why

1. **Problem**: The current theme implementation (PR #78, change 3tfo) uses 8 hand-picked colors per theme. This is a lossy abstraction — terminal themes define 22 colors that serve distinct semantic roles (ANSI red for errors, green for success, yellow for warnings, etc.). The 8-color model can't theme the xterm.js terminal canvas or tmux chrome, so the terminal always looks the same regardless of which theme is selected. The theme only affects the web UI surrounding the terminal.

2. **Consequence without fix**: Users select "Dracula" but the terminal stays in default colors. tmux status bars, pane borders, and pane format all use hardcoded hex from the default dark theme. The theme feels half-applied — the chrome changes but the terminal (the primary content area) doesn't match.

3. **Why this approach**: Store the full canonical ANSI palette per theme, then derive application-specific colors for each consumer. This means:
   - The terminal content (syntax highlighting, colored prompts, git diff output) matches the theme because xterm.js gets the full ANSI palette
   - tmux chrome (status bar, pane borders, pane-border-format) auto-themes because tmux.conf uses ANSI colour indices that render through xterm.js
   - The web UI continues to work via 8 derived CSS colors
   - No runtime `tmux set -g` calls needed — tmux.conf is static, xterm.js is the single control point

## What Changes

### Theme Data Model Rework

Replace the current `Theme` type in `app/frontend/src/themes.ts`. The current model:

```typescript
// CURRENT (being replaced)
type Theme = {
  id: string;
  name: string;
  category: "dark" | "light";
  colors: { bgPrimary, bgCard, bgInset, textPrimary, textSecondary, border, accent, accentGreen };
  themeColor: string;
};
```

New model with full ANSI palette:

```typescript
export type ThemePalette = {
  foreground: string;
  background: string;
  cursorColor: string;
  cursorText: string;
  selectionBackground: string;
  selectionForeground: string;
  // ANSI 0-15: black, red, green, yellow, blue, magenta, cyan, white,
  //            brightBlack, brightRed, brightGreen, brightYellow, brightBlue, brightMagenta, brightCyan, brightWhite
  ansi: readonly [string, string, string, string, string, string, string, string,
                   string, string, string, string, string, string, string, string];
};

export type UIColors = {
  bgPrimary: string;
  bgCard: string;
  bgInset: string;
  textPrimary: string;
  textSecondary: string;
  border: string;
  accent: string;
  accentGreen: string;
};

export type Theme = {
  id: string;
  name: string;
  category: "dark" | "light";
  palette: ThemePalette;
};
```

### Derivation Layer

Exported functions that map from full palette to consumer-specific color sets:

**`deriveUIColors(palette, category)`** — produces the 8 CSS colors:

| UIColors key | Derivation | Semantic role |
|-------------|-----------|---------------|
| `bgPrimary` | `palette.background` | Page background |
| `bgCard` | `lighten(background, 8)` dark / `darken(background, 3)` light | Card/elevated surfaces |
| `bgInset` | `darken(background, 5)` dark / `darken(background, 6)` light | Inset/recessed areas |
| `textPrimary` | `palette.foreground` | Primary text |
| `textSecondary` | `palette.ansi[8]` (bright black) | Secondary/dim text |
| `border` | `blend(foreground, background, 0.25)` | Borders, separators |
| `accent` | `palette.ansi[4]` (blue) | Accent color, links, active states |
| `accentGreen` | `palette.ansi[2]` (green) | Success indicators, active dots |

Helper functions (module-private): `hexToRgb`, `rgbToHex`, `lightenHex`, `darkenHex`, `blendHex`.

**`deriveXtermTheme(palette)`** — produces the xterm.js `ITheme` object:

```typescript
{
  background: palette.background,
  foreground: palette.foreground,
  cursor: palette.cursorColor,
  cursorAccent: palette.cursorText,
  selectionBackground: palette.selectionBackground,
  selectionForeground: palette.selectionForeground,
  black: palette.ansi[0],
  red: palette.ansi[1],
  green: palette.ansi[2],
  yellow: palette.ansi[3],
  blue: palette.ansi[4],
  magenta: palette.ansi[5],
  cyan: palette.ansi[6],
  white: palette.ansi[7],
  brightBlack: palette.ansi[8],
  brightRed: palette.ansi[9],
  brightGreen: palette.ansi[10],
  brightYellow: palette.ansi[11],
  brightBlue: palette.ansi[12],
  brightMagenta: palette.ansi[13],
  brightCyan: palette.ansi[14],
  brightWhite: palette.ansi[15],
}
```

### Theme Palette Data

70 themes (56 dark + 14 light) with canonical ANSI palettes sourced from iTerm2-Color-Schemes. Palette data lives in `configs/themes.json` (data-only JSON, imported by `themes.ts` via `@configs` Vite alias). Each entry has a `source` field for provenance (`"iterm2:ThemeName"` or `"custom"`).

Individual palette hex values are NOT listed in this intake — they are maintained in `configs/themes.json` as the single source of truth. See `docs/specs/themes.md` for the full architecture.

### Import Script

`app/frontend/scripts/import-theme.ts` — fetches from iTerm2-Color-Schemes (485+ themes available), auto-detects dark/light category from background luminance, generates kebab-case ID, fills in `cursorText`/`selectionForeground` defaults, inserts into `configs/themes.json` in correct position.

```bash
npx tsx app/frontend/scripts/import-theme.ts "Theme Name"
npx tsx app/frontend/scripts/import-theme.ts --search "query"
npx tsx app/frontend/scripts/import-theme.ts --list
```

### xterm.js Integration

Current state in `app/frontend/src/components/terminal-client.tsx`:
- `XTERM_THEMES` constant hardcodes 4 colors (bg, fg, cursor, selectionBackground) for `"dark"` and `"light"` only
- Theme is applied on init (line 166) and on resolved theme change (line 272)
- Uses `resolvedTheme` ("dark" | "light") as lookup key

New behavior:
- Remove `XTERM_THEMES` constant
- Import `deriveXtermTheme` from `themes.ts`
- Use `useTheme()` to get the active `Theme` object (not just resolved)
- On init: `theme: deriveXtermTheme(activeTheme.palette)`
- On theme change: `xtermRef.current.options.theme = deriveXtermTheme(theme.palette)`
- This passes all 22 colors to xterm.js, meaning terminal content (colored prompts, syntax highlighting, git diff, etc.) will match the selected theme

### tmux.conf Rework

Both `app/backend/build/tmux.conf` and `configs/tmux/default.conf` (they should stay identical) reworked from hardcoded hex to ANSI colour indices:

**Current (hardcoded hex):**
```
set -g status-style "bg=#1a1d27,fg=#e8eaf0"
set -g status-left " #[fg=#5b8af0,bold]#S #[default]"
set -g status-right " #[fg=#e8eaf0]%H:%M "
set -g window-status-current-format "#[fg=#0f1117,bg=#5b8af0,bold] #I:#W #[default]"
set -g pane-border-style "fg=#2a2d37"
set -g pane-active-border-style "fg=#5b8af0"
```

**New (ANSI colour indices):**
```
set -g status-style "bg=colour0,fg=colour7"
set -g status-left " #[fg=colour4,bold]#S #[default]"
set -g status-right " #[fg=colour7]%H:%M "
set -g window-status-current-format "#[fg=colour0,bg=colour4,bold] #I:#W #[default]"
set -g pane-border-style "fg=colour8"
set -g pane-active-border-style "fg=colour4"
```

Semantic colour mapping:

| ANSI Index | tmux keyword | Semantic role | Example (Dracula) | Example (Nord) |
|-----------|-------------|---------------|-------------------|----------------|
| 0 | `colour0` | Deep bg, text-on-accent | `#21222c` | `#3b4252` |
| 2 | `colour2` | Green / success | `#50fa7b` | `#a3be8c` |
| 3 | `colour3` | Yellow / warning (worktree badge) | `#f1fa8c` | `#ebcb8b` |
| 4 | `colour4` | Blue / accent | `#bd93f9` | `#81a1c1` |
| 7 | `colour7` | Primary text | `#f8f8f2` | `#e5e9f0` |
| 8 | `colour8` | Dim text, inactive borders | `#6272a4` | `#4c566a` |

The complex `pane-border-format` string also needs hex→colour index replacement:
- `#5b8af0` (accent blue) → `colour4`
- `#0f1117` (dark bg) → `colour0`
- `#e8eaf0` (light text) → `colour7`
- `#2a2d37` (dim bg) → `colour8`
- `#e8a84f` (amber/warning) → `colour3`
- `#9ca3af` (gray text) → `colour8`

**Key insight**: Because tmux renders its chrome as escape sequences that xterm.js interprets, changing the xterm.js ANSI palette automatically changes how tmux borders/status look. No runtime `tmux set -g` calls needed. The tmux.conf is static.

### Backend Settings Persistence

New package `app/backend/internal/settings/`:

```go
// settings.go
type Settings struct {
    Theme string `yaml:"theme"`
}

func Default() Settings          // returns {Theme: "system"}
func Load() Settings             // reads ~/.rk/settings.yaml, returns Default() if missing
func Save(s Settings) error      // writes ~/.rk/settings.yaml
```

Settings file at `~/.rk/settings.yaml`:
```yaml
theme: dracula
```

Use simple string parsing (key: value format) to avoid adding yaml.v3 dependency if not already present. The file currently has only one field.

New API handler `app/backend/api/settings.go`:

```go
GET  /api/settings/theme  → {"theme": "dracula"}
PUT  /api/settings/theme  ← {"theme": "dracula"} → {"status": "ok"}
```

These endpoints are **not** per-server (no `withServer()` on the frontend) — settings are global.

Routes registered in `app/backend/api/router.go` alongside keybindings.

### Frontend Persistence Flow

`app/frontend/src/api/client.ts` adds:
- `getThemePreference(): Promise<string>` — `GET /api/settings/theme`
- `setThemePreference(theme: string): Promise<void>` — `PUT /api/settings/theme`

`theme-context.tsx` changes:
- On init: call `getThemePreference()` from API, fall back to `"system"` if API fails
- Keep localStorage as **synchronous cache** — write alongside API call for instant reads on page reloads before API responds
- `setTheme` calls `setThemePreference(id)` fire-and-forget alongside localStorage write
- Backend is the canonical source of truth; localStorage is the fast fallback

### Theme Selector Updates

The `theme-selector.tsx` color swatch updates to show palette colors instead of the 8 derived colors. Show background, foreground, and a representative subset of the ANSI palette (e.g., red, green, yellow, blue, magenta, cyan).

## Affected Memory

- `run-kit/ui-patterns`: (modify) Update theme system documentation — palette model, xterm.js integration, tmux ANSI indices
- `run-kit/architecture`: (modify) Document settings.yaml persistence, new API endpoints

## Progress

### Done (in current branch)

- [x] Theme data model rework: `ThemePalette` (22 colors), `UIColors` (8 derived), `Theme` type with `source` field
- [x] Derivation layer: `deriveUIColors()`, `deriveXtermTheme()`, color utility helpers
- [x] Theme palette data extracted to `configs/themes.json` (70 themes: 56 dark + 14 light)
- [x] Palettes fixed to canonical iTerm2-Color-Schemes values with `source` provenance
- [x] Vite alias `@configs` for importing JSON from `configs/`
- [x] tmux.conf reworked: hex → ANSI colour indices (both `build/` and `configs/`)
- [x] colour15 (bright white) for text-on-accent in tmux pane headings
- [x] Theme selector: palette swatches showing ANSI colors, keyboard scroll fix
- [x] Command palette: VSCode-style prefixes (Session:, Window:, View:, Theme:, etc.)
- [x] Import script: `app/frontend/scripts/import-theme.ts`
- [x] Theme spec: `docs/specs/themes.md`

### Remaining

- [ ] xterm.js integration: replace `XTERM_THEMES` constant with `deriveXtermTheme(palette)` in `terminal-client.tsx`
- [ ] Backend settings: `internal/settings/` package, `~/.rk/settings.yaml`, `GET/PUT /api/settings/theme`
- [ ] Frontend persistence: `theme-context.tsx` calls API, localStorage as sync cache
- [ ] Frontend API client: `getThemePreference()`, `setThemePreference()` in `client.ts`
- [ ] Update tests for new palette model and API persistence

## Impact

### Already modified
- **`app/frontend/src/themes.ts`** — Rewritten: types + derivation + JSON import (palette data in `configs/themes.json`)
- **`app/frontend/src/components/theme-selector.tsx`** — Palette swatches, keyboard scroll fix
- **`app/frontend/src/app.tsx`** — Command palette prefixes
- **`app/frontend/vite.config.ts`** — `@configs` alias
- **`app/frontend/tsconfig.json`** — `@configs` path mapping
- **`configs/tmux/default.conf`** — ANSI colour indices
- **`app/backend/build/tmux.conf`** — ANSI colour indices
- **New: `configs/themes.json`** — 70 theme palette definitions
- **New: `app/frontend/scripts/import-theme.ts`** — Theme import script
- **New: `docs/specs/themes.md`** — Theme system spec

### Still to modify
- **`app/frontend/src/components/terminal-client.tsx`** — Remove XTERM_THEMES, use deriveXtermTheme
- **`app/frontend/src/contexts/theme-context.tsx`** — API persistence
- **`app/frontend/src/contexts/theme-context.test.tsx`** — Update for API persistence
- **`app/frontend/src/api/client.ts`** — Add getThemePreference/setThemePreference
- **New: `app/backend/internal/settings/settings.go`** — Settings package
- **New: `app/backend/api/settings.go`** — Theme API handlers
- **`app/backend/api/router.go`** — Register new routes

## Open Questions

(None — all decisions made in conversation)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Full ANSI palette: 22 colors per theme (16 ANSI + fg/bg/cursor/cursorText/selBg/selFg) | Discussed — user explicitly said "don't skimp on colors, keep all from source" | S:95 R:85 A:90 D:95 |
| 2 | Certain | Three consumers from same palette: CSS (derived), xterm.js (full), tmux (auto via indices) | Discussed — agreed architecture after exploring tmux rendering chain | S:95 R:80 A:90 D:90 |
| 3 | Certain | tmux.conf uses ANSI colour0-colour15 indices instead of hardcoded hex | Discussed — user asked if pane borders could auto-theme; confirmed via xterm.js rendering | S:95 R:75 A:90 D:95 |
| 4 | Certain | Backend persistence at ~/.rk/settings.yaml via internal/settings/ package | Discussed — user chose Option B (settings file) over C (localStorage only) and A (tmux.conf rewrite) | S:95 R:80 A:85 D:90 |
| 5 | Certain | GET/PUT /api/settings/theme endpoints (not per-server) | Discussed — settings are global, not per tmux server | S:90 R:85 A:85 D:90 |
| 6 | Certain | internal/settings/ as separate package (not internal/config/) | Discussed — user confirmed; config is env-var based per convention | S:95 R:90 A:90 D:95 |
| 7 | Certain | Derive UI colors: bgPrimary=bg, textSecondary=ansi[8], accent=ansi[4], accentGreen=ansi[2] | Discussed — agreed derivation mapping in conversation | S:90 R:85 A:85 D:80 |
| 8 | Certain | xterm.js gets full 22-color theme via deriveXtermTheme() | Discussed — replaces current 4-color XTERM_THEMES constant | S:95 R:85 A:90 D:95 |
| 9 | Certain | localStorage kept as synchronous cache alongside API persistence | Discussed — provides instant reads before API responds on page load | S:85 R:90 A:85 D:85 |
| 10 | Certain | Separate branch (260323-7wys) reworking on top of 3tfo PR | Discussed — user chose option 1 (rework); implemented as new branch building on 3tfo | S:95 R:70 A:90 D:95 |
| 11 | Certain | Color palettes sourced from canonical terminal theme definitions (iTerm2-Color-Schemes, official theme repos) | Discussed — user suggested Ghostty; research showed canonical source is iTerm2-Color-Schemes | S:90 R:90 A:80 D:85 |
| 12 | Certain | bgCard derived via lighten/darken of background (not from palette) | Discussed — terminal palettes don't have a "card" concept; must be computed | S:85 R:85 A:80 D:75 |
| 13 | Certain | border derived via blend(foreground, background, 0.25) | Discussed — terminal palettes don't have a "border" concept; must be computed | S:85 R:85 A:80 D:75 |
| 14 | Certain | No runtime tmux set -g calls for visual theming | Discussed — ANSI indices in static tmux.conf + xterm.js palette is sufficient | S:90 R:80 A:90 D:90 |
| 15 | Certain | Simple key:value format for settings.yaml (avoid yaml.v3 dep if not present) | Discussed — only one field currently; simple parsing sufficient | S:80 R:90 A:85 D:85 |
| 16 | Certain | pane-border-format hex colors map to: accent→colour4, bg→colour0, text→colour7, dim→colour8, warning→colour3 | Discussed — semantic mapping agreed in conversation | S:90 R:75 A:85 D:85 |
| 17 | Certain | 70 themes (56 dark + 14 light) — original 20 + 50 imported from iTerm2-Color-Schemes | User requested "next 50 most popular themes"; batch-imported via import script | S:95 R:90 A:90 D:95 |
| 18 | Certain | Theme palette data lives in configs/themes.json, not inline in themes.ts | User requested "keep theme definitions in configs/"; implemented via @configs Vite alias | S:95 R:90 A:95 D:95 |
| 19 | Certain | Import script at app/frontend/scripts/import-theme.ts for adding themes from iTerm2-Color-Schemes | User requested scalable way to add themes; script fetches, converts, and appends | S:95 R:90 A:95 D:95 |
| 20 | Certain | colour15 (bright white) for text on accent backgrounds in tmux.conf | User reported grey-on-blue readability issue; switched from colour0 to colour15 | S:95 R:85 A:90 D:95 |
| 21 | Certain | Command palette uses VSCode-style prefixes (Session:, Window:, View:, Theme:, Server:, Config:, Help:) | User requested grouping; agreed on prefix scheme | S:95 R:90 A:90 D:95 |

21 assumptions (21 certain, 0 confident, 0 tentative, 0 unresolved).
