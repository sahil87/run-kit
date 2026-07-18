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

## Row Color System — Owned Palette + Axis Split

Sidebar rows and server tiles carry a user-assignable color. Rather than deriving
that color from the active theme's ANSI palette (which made a "orange" label read
tan-gray on one theme and brownish-pink on another, and capped the set at what
ANSI offers), run-kit owns **10 fixed hue families** and *adapts* them to the
theme so hue identity stays stable while the colors still feel native.

### Owned hue families

Ten families are defined by fixed **OKLCH hue angle**, placed non-uniformly —
tight through the discriminable red→amber region, with the large gap parked in
teal→blue where human hue discrimination is weakest:

| Family | Hue | Role | Legacy value |
|--------|-----|------|--------------|
| red | 25° | anchor: blocked/urgent | `1` |
| orange | 55° | quiet | `1+3` |
| amber | 90° | anchor: attention/WIP | `3` |
| olive | 120° | quiet | `1+2` |
| green | 150° | anchor: done/good | `2` |
| teal | 185° | quiet | `6` |
| blue | 250° | anchor: default/info | `4` |
| purple | 290° | quiet | `1+4` |
| magenta | 330° | quiet | `5` |
| slate | 250° (chroma-floored) | neutral: parked/archived | `3+4` |

### Theme adaptation

Each family is rendered at the theme's **mean OKLab lightness** and **mean
chroma** over `palette.ansi[1..6]` (chroma floored at 0.05 so near-monochrome
themes stay distinguishable): `family = OKLCH(L_theme, C_theme, ownHue)`. Slate
uses a near-neutral chroma `min(C_theme × 0.2, 0.025)`. Out-of-gamut results are
brought into sRGB by **reducing chroma stepwise** (×0.92, ≤20 iterations) —
never by sRGB channel clamping, which would shift hue and defeat the stable-hue
goal. The helpers (`oklchToHex`, `oklchToHexInGamut`, `themeColorStats`,
`HUE_FAMILIES`) live in `app/frontend/src/themes.ts` and reuse the existing
OKLab conversions. The downstream tint pipeline (saturate ×1.5 → blend into
background → WCAG border guardrail at 3.0) operates on the adapted family hex
unchanged.

### Legacy values (zero migration)

Stored color values keep their existing vocabulary. `colorValueToHex` resolves
each legacy descriptor to its family 1:1 per the table above (e.g. `"1+3"` →
orange). Stored values remain the **legacy vocabulary** end-to-end: the swatch
popover maps each pick back to its legacy descriptor on write (`familyToLegacy`,
e.g. orange → `"1+3"`) because the backend validators accept only numeric/blend
forms. Family names (`"orange"`) are frontend-side read aliases. No storage,
API, or backend change for color.

### Axis split

The row's visual axes are split so labeling and selection never share a channel:

- **Hue = label** — the family color (above).
- **Tint depth = selection** — a selected row deepens to the family tint at 40%
  (rest 14%, hover 22%; uncolored rows use a gray sentinel), plus bold +
  brightened text. There is **no** left selection border (removed in the split).
- **Left-gutter marker = an independent 4-state label axis** — see below.

The board-pin active-board cue (once a 4px accent left border) now rides the
**persistent filled pin glyph**, rendered accent-colored when the row is pinned
to the board currently being viewed.

### Left-gutter marker (`@rk_marker`)

Each **window** row (windows only — session rows and server tiles are out of
scope) carries a ~14px left gutter presenting one of four states, cycled on
click: empty → dotted (3px) → solid (3px) → double (6px double), rendered in the
row's guarded family color (gray for uncolored rows). Semantics are deliberately
unnamed (todo/doing/done for one user, priority for another). Hovering the row
fills the gutter ~20%; hovering the gutter itself steps to ~30% and ghosts a
preview of the next state, with a `cell` cursor. The gutter is inert on coarse
(touch) pointers — the `Window: Cycle Marker` command-palette action is the
touch path (Constitution V).

Marker state persists as the `@rk_marker` **window user option**
(`""`/`dotted`/`solid`/`double`), written through the unified
`POST /api/windows/{id}/options` endpoint (the same allowlist + validate-all path
as `@color`), read back through the sessions enrichment onto the window payload
as `marker`, and wired into the SSE-hub wake seam so the mutation repaints in one
poll pass rather than the 12s safety tick. Marker and color are fully
independent — a window may be any (family, marker) pair.

**Easter egg**: a `double`-marker row wears a static CRT scanline overlay
(`repeating-linear-gradient`, ~14% marker color); when such a row is *also*
selected, the scanlines animate (a slow downward crawl + an occasional CRT
refresh band). Pure CSS utilities (`rk-scanlines` / `rk-scanlines-crawl` in
`globals.css`), fully zeroed under `prefers-reduced-motion` — the effect never
touches the status pyramid's attention channel (the waiting halo stays
unambiguous).

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
