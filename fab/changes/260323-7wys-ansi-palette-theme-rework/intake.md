# Intake: ANSI Palette Theme Rework

**Change**: 260323-7wys-ansi-palette-theme-rework
**Created**: 2026-03-23
**Status**: Draft

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

### Theme Palette Data (All 20 Themes)

All 20 themes with canonical ANSI palettes sourced from iTerm2-Color-Schemes / official theme repos:

**Dark themes (14):**

**Default Dark** (matches current globals.css):
- bg: `#0f1117`, fg: `#e8eaf0`, cursor: `#e8eaf0`, cursorText: `#0f1117`, selBg: `#2a3040`, selFg: `#e8eaf0`
- ansi: `#0f1117, #e06c75, #22c55e, #e8a84f, #5b8af0, #c678dd, #56b6c2, #e8eaf0, #7a8394, #e06c75, #22c55e, #e8a84f, #5b8af0, #c678dd, #56b6c2, #ffffff`

**Default Light** (matches current globals.css):
- bg: `#f8f9fb`, fg: `#1a1d24`, cursor: `#1a1d24`, cursorText: `#f8f9fb`, selBg: `#c7d2fe`, selFg: `#1a1d24`
- ansi: `#1a1d24, #e53e3e, #16a34a, #ca8a04, #4a7ae8, #9333ea, #0891b2, #f8f9fb, #6b7280, #e53e3e, #16a34a, #ca8a04, #4a7ae8, #9333ea, #0891b2, #ffffff`

**Dracula**:
- bg: `#282a36`, fg: `#f8f8f2`, cursor: `#f8f8f2`, cursorText: `#282a36`, selBg: `#44475a`, selFg: `#f8f8f2`
- ansi: `#21222c, #ff5555, #50fa7b, #f1fa8c, #bd93f9, #ff79c6, #8be9fd, #f8f8f2, #6272a4, #ff6e6e, #69ff94, #ffffa5, #d6acff, #ff92df, #a4ffff, #ffffff`

**One Dark**:
- bg: `#282c34`, fg: `#abb2bf`, cursor: `#528bff`, cursorText: `#282c34`, selBg: `#3e4452`, selFg: `#abb2bf`
- ansi: `#282c34, #e06c75, #98c379, #e5c07b, #61afef, #c678dd, #56b6c2, #abb2bf, #636d83, #e06c75, #98c379, #e5c07b, #61afef, #c678dd, #56b6c2, #ffffff`

**Nord**:
- bg: `#2e3440`, fg: `#d8dee9`, cursor: `#d8dee9`, cursorText: `#2e3440`, selBg: `#434c5e`, selFg: `#d8dee9`
- ansi: `#3b4252, #bf616a, #a3be8c, #ebcb8b, #81a1c1, #b48ead, #88c0d0, #e5e9f0, #4c566a, #bf616a, #a3be8c, #ebcb8b, #81a1c1, #b48ead, #88c0d0, #eceff4`

**Gruvbox Dark**:
- bg: `#282828`, fg: `#ebdbb2`, cursor: `#ebdbb2`, cursorText: `#282828`, selBg: `#504945`, selFg: `#ebdbb2`
- ansi: `#282828, #cc241d, #98971a, #d79921, #458588, #b16286, #689d6a, #a89984, #928374, #fb4934, #b8bb26, #fabd2f, #83a598, #d3869b, #8ec07c, #ebdbb2`

**Solarized Dark**:
- bg: `#002b36`, fg: `#839496`, cursor: `#839496`, cursorText: `#002b36`, selBg: `#073642`, selFg: `#839496`
- ansi: `#073642, #dc322f, #859900, #b58900, #268bd2, #d33682, #2aa198, #eee8d5, #586e75, #cb4b16, #859900, #b58900, #268bd2, #6c71c4, #2aa198, #fdf6e3`

**Tokyo Night**:
- bg: `#1a1b26`, fg: `#c0caf5`, cursor: `#c0caf5`, cursorText: `#1a1b26`, selBg: `#33467c`, selFg: `#c0caf5`
- ansi: `#15161e, #f7768e, #9ece6a, #e0af68, #7aa2f7, #bb9af7, #7dcfff, #a9b1d6, #414868, #f7768e, #9ece6a, #e0af68, #7aa2f7, #bb9af7, #7dcfff, #c0caf5`

**Catppuccin Mocha**:
- bg: `#1e1e2e`, fg: `#cdd6f4`, cursor: `#f5e0dc`, cursorText: `#1e1e2e`, selBg: `#45475a`, selFg: `#cdd6f4`
- ansi: `#45475a, #f38ba8, #a6e3a1, #f9e2af, #89b4fa, #f5c2e7, #94e2d5, #bac2de, #585b70, #f38ba8, #a6e3a1, #f9e2af, #89b4fa, #f5c2e7, #94e2d5, #a6adc8`

**Monokai**:
- bg: `#272822`, fg: `#f8f8f2`, cursor: `#f8f8f0`, cursorText: `#272822`, selBg: `#49483e`, selFg: `#f8f8f2`
- ansi: `#272822, #f92672, #a6e22e, #f4bf75, #66d9ef, #ae81ff, #a1efe4, #f8f8f2, #75715e, #f92672, #a6e22e, #f4bf75, #66d9ef, #ae81ff, #a1efe4, #f9f8f5`

**Material Dark**:
- bg: `#212121`, fg: `#eeffff`, cursor: `#ffcc00`, cursorText: `#212121`, selBg: `#3a3a3a`, selFg: `#eeffff`
- ansi: `#212121, #f07178, #c3e88d, #ffcb6b, #82aaff, #c792ea, #89ddff, #eeffff, #545454, #f07178, #c3e88d, #ffcb6b, #82aaff, #c792ea, #89ddff, #ffffff`

**Ayu Dark**:
- bg: `#0b0e14`, fg: `#bfbdb6`, cursor: `#e6b450`, cursorText: `#0b0e14`, selBg: `#273747`, selFg: `#bfbdb6`
- ansi: `#01060e, #ea6c73, #7fd962, #f9af4f, #59c2ff, #d2a6ff, #73b8ff, #bfbdb6, #484f58, #f07178, #aad94c, #ffb454, #59c2ff, #d2a6ff, #95e6cb, #d9d7ce`

**Everforest Dark**:
- bg: `#2d353b`, fg: `#d3c6aa`, cursor: `#d3c6aa`, cursorText: `#2d353b`, selBg: `#543a48`, selFg: `#d3c6aa`
- ansi: `#343f44, #e67e80, #a7c080, #dbbc7f, #7fbbb3, #d699b6, #83c092, #d3c6aa, #475258, #e67e80, #a7c080, #dbbc7f, #7fbbb3, #d699b6, #83c092, #d3c6aa`

**Rosé Pine**:
- bg: `#191724`, fg: `#e0def4`, cursor: `#524f67`, cursorText: `#e0def4`, selBg: `#2a283e`, selFg: `#e0def4`
- ansi: `#26233a, #eb6f92, #31748f, #f6c177, #9ccfd8, #c4a7e7, #ebbcba, #e0def4, #6e6a86, #eb6f92, #31748f, #f6c177, #9ccfd8, #c4a7e7, #ebbcba, #e0def4`

**Kanagawa**:
- bg: `#1f1f28`, fg: `#dcd7ba`, cursor: `#c8c093`, cursorText: `#1f1f28`, selBg: `#2d4f67`, selFg: `#dcd7ba`
- ansi: `#16161d, #c34043, #76946a, #c0a36e, #7e9cd8, #957fb8, #6a9589, #c8c093, #727169, #e82424, #98bb6c, #e6c384, #7fb4ca, #938aa9, #7aa89f, #dcd7ba`

**Light themes (6):**

**Solarized Light**:
- bg: `#fdf6e3`, fg: `#657b83`, cursor: `#657b83`, cursorText: `#fdf6e3`, selBg: `#eee8d5`, selFg: `#657b83`
- ansi: `#073642, #dc322f, #859900, #b58900, #268bd2, #d33682, #2aa198, #eee8d5, #002b36, #cb4b16, #859900, #b58900, #268bd2, #6c71c4, #2aa198, #fdf6e3`

**Gruvbox Light**:
- bg: `#fbf1c7`, fg: `#3c3836`, cursor: `#3c3836`, cursorText: `#fbf1c7`, selBg: `#d5c4a1`, selFg: `#3c3836`
- ansi: `#fbf1c7, #cc241d, #98971a, #d79921, #458588, #b16286, #689d6a, #7c6f64, #928374, #9d0006, #79740e, #b57614, #076678, #8f3f71, #427b58, #3c3836`

**Catppuccin Latte**:
- bg: `#eff1f5`, fg: `#4c4f69`, cursor: `#dc8a78`, cursorText: `#eff1f5`, selBg: `#ccd0da`, selFg: `#4c4f69`
- ansi: `#5c5f77, #d20f39, #40a02b, #df8e1d, #1e66f5, #8839ef, #179299, #acb0be, #6c6f85, #d20f39, #40a02b, #df8e1d, #1e66f5, #8839ef, #179299, #bcc0cc`

**GitHub Light**:
- bg: `#ffffff`, fg: `#24292e`, cursor: `#044289`, cursorText: `#ffffff`, selBg: `#c8c8fa`, selFg: `#24292e`
- ansi: `#24292e, #d73a49, #22863a, #b08800, #0366d6, #6f42c1, #1b7c83, #6a737d, #959da5, #cb2431, #28a745, #dbab09, #2188ff, #8a63d2, #3192aa, #d1d5da`

**Rosé Pine Dawn**:
- bg: `#faf4ed`, fg: `#575279`, cursor: `#9893a5`, cursorText: `#575279`, selBg: `#dfdad9`, selFg: `#575279`
- ansi: `#f2e9e1, #b4637a, #286983, #ea9d34, #56949f, #907aa9, #d7827e, #575279, #9893a5, #b4637a, #286983, #ea9d34, #56949f, #907aa9, #d7827e, #575279`

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

## Impact

- **`app/frontend/src/themes.ts`** — Complete rewrite: ThemePalette type, derivation functions, all 20 theme palettes
- **`app/frontend/src/themes.test.ts`** — Rewrite: test palette structure, derivation functions
- **`app/frontend/src/contexts/theme-context.tsx`** — Refactor: use derived colors, API persistence
- **`app/frontend/src/contexts/theme-context.test.tsx`** — Update for new API persistence
- **`app/frontend/src/components/terminal-client.tsx`** — Remove XTERM_THEMES, use deriveXtermTheme
- **`app/frontend/src/components/theme-selector.tsx`** — Update swatch for palette preview
- **`app/frontend/src/api/client.ts`** — Add getThemePreference/setThemePreference
- **`app/backend/build/tmux.conf`** — Hex → ANSI colour indices
- **`configs/tmux/default.conf`** — Same as build/tmux.conf
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
| 10 | Certain | Rework existing PR branch (260323-3tfo-theme-selector-preview) | Discussed — user chose option 1 (rework) over option 2 (follow-up) | S:95 R:70 A:90 D:95 |
| 11 | Certain | Color palettes sourced from canonical terminal theme definitions (iTerm2-Color-Schemes, official theme repos) | Discussed — user suggested Ghostty; research showed canonical source is iTerm2-Color-Schemes | S:90 R:90 A:80 D:85 |
| 12 | Certain | bgCard derived via lighten/darken of background (not from palette) | Discussed — terminal palettes don't have a "card" concept; must be computed | S:85 R:85 A:80 D:75 |
| 13 | Certain | border derived via blend(foreground, background, 0.25) | Discussed — terminal palettes don't have a "border" concept; must be computed | S:85 R:85 A:80 D:75 |
| 14 | Certain | No runtime tmux set -g calls for visual theming | Discussed — ANSI indices in static tmux.conf + xterm.js palette is sufficient | S:90 R:80 A:90 D:90 |
| 15 | Certain | Simple key:value format for settings.yaml (avoid yaml.v3 dep if not present) | Discussed — only one field currently; simple parsing sufficient | S:80 R:90 A:85 D:85 |
| 16 | Certain | pane-border-format hex colors map to: accent→colour4, bg→colour0, text→colour7, dim→colour8, warning→colour3 | Discussed — semantic mapping agreed in conversation | S:90 R:75 A:85 D:85 |
| 17 | Certain | Same 20 themes as current PR (14 dark + 6 light) | Carries forward from change 3tfo; user confirmed theme list | S:90 R:90 A:90 D:95 |

17 assumptions (17 certain, 0 confident, 0 tentative, 0 unresolved).
