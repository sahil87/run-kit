# Intake: Session and Window Color Tinting

**Change**: 260416-jn4h-session-window-color-tinting
**Created**: 2026-04-16
**Status**: Draft

## Origin

> Conversational design session exploring sidebar visual differentiation for sessions and windows.
> The user wants to assign ANSI-palette colors to session rows and window rows in the sidebar,
> creating a full-row background tint at ~10-15% opacity. The feature was discussed extensively
> with specific decisions on storage, color source, picker UX, and visual treatment.

Interaction mode: conversational with explicit design decisions.

## Why

As users accumulate multiple tmux sessions and windows, the sidebar becomes a flat list of text labels with no visual grouping or identity cues beyond names. Color tinting provides an ambient visual signal that helps users:

1. **Scan faster** — color bands create landmarks in the session/window tree without reading every label.
2. **Group related items** — color a "prod" session red and "dev" sessions blue for instant situational awareness.
3. **Reduce misclicks** — color serves as a secondary confirmation that you're targeting the right row.

Without this, users rely entirely on text labels to differentiate sidebar items, which scales poorly as the number of sessions grows. This is particularly important for agent orchestration workflows where 5-10+ concurrent sessions are common.

## What Changes

### 1. ANSI Palette Color Source

Colors come from the active theme's ANSI palette (indices 0-15), not fixed RGB values. This means:
- Colors automatically adapt when the user switches themes
- No new color data needs to be stored in `configs/themes.json`
- The existing `Theme.palette.ansi` array (16 entries) is the color source

The picker exposes 7 ANSI indices: the 6 standard hues (1-6: red, green, yellow, blue, magenta, cyan) plus bright black/gray (8). Excluded: 0 (black), 7 (white), 15 (bright white), and all bright variants (9-14) which are near-identical to normal variants at low blend ratios.

### 2. Session Color Storage — tmux `@session_color` User Option

Session colors are ephemeral, tied to the tmux server lifetime (same as window colors). They are stored as tmux user options on each session via `@session_color`.

```bash
# Set a session color
tmux set-option -t "{session}" @session_color 4

# Clear a session color
tmux set-option -u -t "{session}" @session_color
```

**Why not `run-kit.yaml`**: The original design stored session colors in `run-kit.yaml` at the project root. This was changed because multiple sessions sharing the same project directory (common in agent orchestration) would all read/write the same file, linking their colors. Using a distinct tmux option name (`@session_color` vs window `@color`) avoids tmux's option inheritance chain where `#{@color}` in `list-sessions` would resolve the active window's value.

**Backend changes**:
- `internal/tmux/tmux.go`: `ListSessions` format string includes `#{@session_color}`, parsed into `SessionInfo.Color *int`
- `SetSessionColor`/`UnsetSessionColor` functions use `set-option -t` / `set-option -u -t`
- The session color value is included in the `ProjectSession` struct and sent via SSE

**Frontend changes**:
- `ProjectSession` type gains `sessionColor?: number` field
- Sidebar `SessionRow` component reads `sessionColor` and applies ANSI tint

### 3. Window Color Storage — tmux `@color` User Option

Window colors are ephemeral, tied to the tmux session lifetime. They are stored as tmux user options on each window:

```bash
# Set a window color
tmux set-option -w -t "{session}:{window}" @color 4

# Read a window color
tmux show-options -wv -t "{session}:{window}" @color
# Returns: 4 (or empty if unset)

# Clear a window color
tmux set-option -wu -t "{session}:{window}" @color
```

**Backend changes**:
- `internal/tmux/tmux.go`: `ListWindows` format string gains `#{@color}` to read the user option alongside existing fields
- `WindowInfo` struct gains `Color *int` field (pointer for nullable — nil means no color)
- No new API endpoints needed — the color flows through the existing SSE session stream

**Frontend changes**:
- `WindowInfo` type gains `color?: number` field
- Sidebar `WindowRow` component reads `color` and applies ANSI tint

### 4. Visual Treatment — Full Row Background Tint

The color is applied as a full-width background tint on the sidebar row using a single-axis blend ratio ladder:

Colors are **pre-blended** using the existing `blendHex()` utility, not rgba opacity. This avoids alpha compositing surprises when states layer, and produces deterministic hex values.

```tsx
// Single axis — blend ratio increases with interaction depth:
//   Base:     7%  ANSI color, 93% background
//   Hover:    11% ANSI color, 89% background
//   Selected: 16% ANSI color, 84% background
```

Each state gets its own pre-blended hex — same mechanism at every step, just more color mixed in.

**Interaction with existing states**:
- **Selected window**: Colored rows use 16% blend + left accent border (ANSI color at full saturation). Uncolored rows use `bg-accent/15` + left accent border (`var(--color-accent)`). The left border is the universal selection indicator.
- **Activity dot**: Filled circle = active, hollow ring = idle, always `text-secondary` color — decoupled from row tint.
- **Hover state**: Colored rows use 11% blend. Uncolored rows use `hover:bg-bg-card/50`.

### 5. Color Picker UX — Command Palette + Hover Indicator

Two access paths, both keyboard-first:

**Primary: Command Palette (`Cmd+K`)**
- New actions: "Session: Set Color" and "Window: Set Color"
- These open a swatch popover showing 12-14 ANSI color swatches arranged in a grid
- Each swatch is a small square filled with the ANSI color at full saturation
- A "Clear" option removes the color assignment
- Selecting a color immediately applies it (optimistic update, then persist)

**Shortcut: Hover Indicator**
- On hover, a subtle color swatch icon appears at the row's left edge
- Clicking the swatch opens the same swatch popover inline
- The swatch is only visible on hover — no visual noise when not interacting
- Touch devices: the swatch could appear on the row's context area or be omitted (command palette is always available)

**Swatch Popover**:
- 7 color swatches in a single-row grid (7 columns)
- Each swatch is split vertically: top half shows base tint (7% blend), bottom half shows selected tint (16% blend) — previews the actual row appearance
- A "Clear" button below the swatches to remove the color
- Current selection indicated with a checkmark in the bottom half
- Focus ring initializes on the currently selected swatch
- Popover dismisses on selection, Escape, or outside click
- Swatches are rendered dynamically from the active theme — they update live during theme preview

### 6. Server Color Storage — `~/.rk/settings.yaml`

Server colors are persistent (survive tmux restarts). They are stored in the user's settings file under a `server_colors` section:

```yaml
# ~/.rk/settings.yaml
theme: system
theme_dark: default-dark
theme_light: default-light
server_colors:
  default: 4
  dev: 10
```

**Backend changes**:
- `internal/settings/settings.go`: `Settings` struct gains `ServerColors map[string]int`, parsed from `server_colors:` nested YAML section
- `GET/PUT /api/settings/server-color` endpoints for reading/writing server colors
- `GET` without `server` param returns all server colors as a map

**Frontend changes**:
- `ServerPanel` shows per-server color tinting on each server row
- Color picker on each server row (hover-reveal swatch icon)
- Server colors fetched once on mount via `getAllServerColors()`

### 7. API Changes for Setting Colors

Dedicated endpoints for each color scope:
- **Window**: `POST /api/sessions/{session}/windows/{index}/color` — sets tmux `@color` window option
- **Session**: `POST /api/sessions/{session}/color` — sets tmux `@session_color` session option
- **Server**: `PUT /api/settings/server-color` — writes to `~/.rk/settings.yaml`

## Affected Memory

- `run-kit/ui-patterns`: (modify) Document color tinting visual treatment, picker UX, state interactions
- `run-kit/architecture`: (modify) Document `@session_color` and `@color` tmux user options, server color in settings.yaml, new API endpoints

## Impact

**Frontend**:
- `app/frontend/src/components/sidebar/session-row.tsx` — background tint styling
- `app/frontend/src/components/sidebar/window-row.tsx` — background tint styling, activity dot interaction
- `app/frontend/src/components/command-palette.tsx` — new "Set Color" actions
- `app/frontend/src/app.tsx` — command palette action registration
- `app/frontend/src/types.ts` — `ProjectSession.sessionColor`, `WindowInfo.color` fields
- New component: swatch popover (shared between command palette and hover indicator)
- `app/frontend/src/themes.ts` — possibly expose ANSI palette for direct consumption

**Backend**:
- `app/backend/internal/tmux/tmux.go` — `ListSessions`/`ListWindows` format strings, `SetSessionColor`/`SetWindowColor` functions
- `app/backend/internal/settings/settings.go` — `ServerColors` in settings struct, `GetServerColor`/`SetServerColor`
- `app/backend/api/windows.go` — window color endpoint
- `app/backend/api/sessions.go` — session color endpoint
- `app/backend/api/settings.go` — server color endpoints
- `app/backend/api/router.go` — route registration, `TmuxOps` interface

## Open Questions

(none remaining)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | ANSI palette indices as color source, not fixed RGB | User explicitly chose ANSI palette for theme adaptation | S:95 R:80 A:90 D:95 |
| 2 | Certain | Session colors in tmux `@session_color`, window colors in tmux `@color` | Changed from `run-kit.yaml` — multiple sessions sharing same project root linked colors. Distinct option name avoids tmux inheritance | S:95 R:80 A:90 D:90 |
| 3 | Certain | Server colors in `~/.rk/settings.yaml` under `server_colors:` | User requested persistent server-level colors; settings.yaml is the existing user prefs store | S:90 R:85 A:85 D:90 |
| 4 | Certain | Full row background tint via single-axis blend ratio ladder (7/11/16%) | User chose pre-blended over rgba; ratios tuned iteratively for subtlety and consistency | S:90 R:85 A:85 D:90 |
| 5 | Certain | 7 colors in picker (indices 1-6 + 8), single row | Bright variants (9-14) dropped — near-identical to normal at low blend ratios | S:90 R:85 A:85 D:90 |
| 6 | Certain | Selected state = higher blend (16%) + left accent border | User chose brightness increase over accent-color blending; left border is universal selection indicator | S:90 R:85 A:85 D:90 |
| 7 | Certain | Swatch preview shows actual tint (split: base top, selected bottom) | User requested swatches show real row appearance, not full-saturation ANSI | S:90 R:85 A:85 D:90 |
| 8 | Certain | Activity dot decoupled from color: filled circle = active, hollow ring = idle | User chose shape-based indicator independent of row tint | S:85 R:80 A:85 D:85 |
| 9 | Certain | Hover indicator as primary color picker access (hover-reveal swatch icon on rows) | Consistent across session, window, and server rows | S:85 R:85 A:85 D:85 |

9 assumptions (9 certain, 0 confident, 0 tentative, 0 unresolved)
