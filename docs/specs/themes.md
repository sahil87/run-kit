# Theme System

## Architecture

Each theme stores a full **22-color ANSI terminal palette** — the canonical color set used by terminal emulators. Three consumers derive from this single palette:

| Consumer | What it uses | How applied |
|----------|-------------|-------------|
| **Web UI** (CSS) | 8 derived colors (bg, text, border, accent) | `document.documentElement.style` inline CSS custom properties |
| **xterm.js** (terminal canvas) | All 22 colors (fg, bg, cursor, selection, 16 ANSI) | `terminal.options.theme = deriveXtermTheme(palette)` |
| **tmux** (status bar, pane borders) | ANSI colour indices in static tmux.conf | Automatic — xterm.js controls what `colour0`–`colour15` look like |

The key insight: tmux renders its chrome as escape sequences that xterm.js interprets. By using `colour0`–`colour15` indices in `configs/tmux/default.conf` instead of hardcoded hex, tmux chrome auto-themes when the xterm.js palette changes. No runtime `tmux set -g` calls needed.

## Palette Structure

```typescript
type ThemePalette = {
  foreground: string;         // Default text
  background: string;         // Default background
  cursorColor: string;        // Cursor appearance
  cursorText: string;         // Text under cursor
  selectionBackground: string; // Selection highlight
  selectionForeground: string; // Text in selection
  ansi: readonly [            // ANSI 0-15
    string, string, string, string,   // black, red, green, yellow
    string, string, string, string,   // blue, magenta, cyan, white
    string, string, string, string,   // bright variants...
    string, string, string, string,
  ];
};
```

### ANSI Semantic Roles

| Index | Name | Semantic role in run-kit |
|-------|------|------------------------|
| 0 | black | Deep background, text-on-accent fallback |
| 1 | red | Errors |
| 2 | green | Success, active indicators → CSS `accentGreen` |
| 3 | yellow | Warnings, worktree badge in tmux |
| 4 | blue | Accent, links, active states → CSS `accent` |
| 5 | magenta | Highlights |
| 6 | cyan | Info |
| 7 | white | Primary text (in terminal) |
| 8 | bright black | Secondary/dim text → CSS `textSecondary`, tmux inactive borders |
| 9–14 | bright colors | Bright variants of 1–6 |
| 15 | bright white | Text on colored backgrounds (tmux pane headings) |

### UI Color Derivation

The 8 CSS custom properties are derived, not stored:

| CSS property | Derived from |
|-------------|-------------|
| `--color-bg-primary` | `palette.background` |
| `--color-bg-card` | `lighten(background, 8%)` dark / `darken(background, 3%)` light |
| `--color-bg-inset` | `darken(background, 5%)` dark / `darken(background, 6%)` light |
| `--color-text-primary` | `palette.foreground` |
| `--color-text-secondary` | `palette.ansi[8]` (bright black) |
| `--color-border` | `blend(foreground, background, 0.25)` |
| `--color-accent` | `palette.ansi[4]` (blue) |
| `--color-accent-green` | `palette.ansi[2]` (green) |

## File Layout

```
configs/themes.json                          # Theme palette definitions (data only)
app/frontend/src/themes.ts                   # Types, derivation functions, re-exports THEMES
app/frontend/scripts/import-theme.ts         # Import script for adding themes
app/frontend/src/contexts/theme-context.tsx   # React context (state, preview, persistence)
app/frontend/src/components/theme-selector.tsx # Theme picker UI
configs/tmux/default.conf                     # tmux config using ANSI colour indices
```

## Theme Data Source

Theme palettes are sourced from [iTerm2-Color-Schemes](https://github.com/mbadolato/iTerm2-Color-Schemes) (Windows Terminal JSON format). Each theme entry in `configs/themes.json` has a `source` field for provenance:

- `"source": "iterm2:Dracula"` — fetched from iTerm2-Color-Schemes
- `"source": "custom"` — hand-defined (Default Dark, Default Light)

The canonical mapping from Windows Terminal JSON to our format:

| WT JSON key | Our field |
|-------------|-----------|
| `background` | `palette.background` |
| `foreground` | `palette.foreground` |
| `cursorColor` | `palette.cursorColor` |
| *(not provided)* | `palette.cursorText` = background |
| `selectionBackground` | `palette.selectionBackground` |
| *(not provided)* | `palette.selectionForeground` = foreground |
| `black` | `palette.ansi[0]` |
| `red` | `palette.ansi[1]` |
| `purple` | `palette.ansi[5]` (= magenta) |
| ... | ... |

## Adding Themes

### Import Script

```bash
# Search available themes (485+ in the repo)
npx tsx app/frontend/scripts/import-theme.ts --search "night"

# Import a theme (auto-detects dark/light from background luminance)
npx tsx app/frontend/scripts/import-theme.ts "Catppuccin Frappe"

# Import with explicit ID or category
npx tsx app/frontend/scripts/import-theme.ts "Night Owl" --id night-owl --category dark

# List all available themes
npx tsx app/frontend/scripts/import-theme.ts --list
```

The script:
1. Fetches the Windows Terminal JSON from GitHub
2. Auto-detects `dark`/`light` category from background luminance
3. Generates a kebab-case ID from the theme name
4. Fills in `cursorText` (= background) and `selectionForeground` (= foreground) defaults
5. Inserts into `configs/themes.json` in the right position (dark before light)
6. Sets `source` to `"iterm2:{name}"` for provenance

### Manual Themes

For themes not in iTerm2-Color-Schemes, add an entry directly to `configs/themes.json` with `"source": "custom"` and the full 22-color palette.

## tmux Colour Index Mapping

`configs/tmux/default.conf` uses these semantic mappings:

| tmux element | colour index | Semantic |
|-------------|-------------|----------|
| Status bar bg | `colour0` | Black/deep bg |
| Status bar fg | `colour7` | White/primary text |
| Session name | `colour4` | Blue/accent |
| Active window tab bg | `colour4` | Blue/accent |
| Active window tab fg | `colour15` | Bright white (high contrast on accent) |
| Pane border (inactive) | `colour8` | Bright black/dim |
| Pane border (active) | `colour4` | Blue/accent |
| Pane heading active bg | `colour4` | Blue/accent |
| Pane heading active fg | `colour15` | Bright white |
| Path segment bg | `colour8` | Bright black/dim |
| Git branch | `colour4` | Blue/accent |
| Worktree badge bg | `colour3` | Yellow/warning |
| Worktree badge fg | `colour15` | Bright white |
| Inactive pane text | `colour8` | Bright black/dim |

## Persistence

Theme preference is stored in two places:

1. **Backend** (canonical): `~/.rk/settings.yaml` via `GET/PUT /api/settings/theme`
2. **Frontend** (cache): `localStorage` key `"runkit-theme"` for instant reads before API responds

On init, the frontend calls the API. If it fails, falls back to localStorage, then to `"system"`. The `"system"` value auto-selects Default Dark or Default Light based on OS `prefers-color-scheme`.
