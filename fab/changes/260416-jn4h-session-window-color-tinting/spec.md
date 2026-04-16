# Spec: Session and Window Color Tinting

**Change**: 260416-jn4h-session-window-color-tinting
**Created**: 2026-04-16
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`, `docs/memory/run-kit/architecture.md`

## Non-Goals

- Theme editor or custom color picker beyond ANSI palette — only the theme's 16 ANSI indices are offered
- Per-pane coloring — only session-level, window-level, and server-level
- Color inheritance (windows inheriting session color) — each level is independent
- Persisting session/window colors across tmux restarts — session and window colors are ephemeral by design

## Color Storage: Session Colors

### Requirement: Session color via tmux `@session_color` user option

Session colors SHALL be stored as tmux user options on each session via `@session_color`. The value SHALL be an ANSI palette index (integer 0-15). An unset option means no color.

A distinct option name (`@session_color`) is used instead of `@color` to avoid tmux's option inheritance chain, where `#{@color}` in `list-sessions` would resolve the active window's `@color` value rather than the session's.

The backend SHALL read `@session_color` by adding `#{@session_color}` to the `ListSessions()` tmux format string. The `SessionInfo` struct SHALL have a `Color *int` field.

#### Scenario: Session with color assigned
- **GIVEN** a tmux session with `@session_color` set to `4`
- **WHEN** `ListSessions()` parses the tmux output
- **THEN** `SessionInfo.Color` is `*int(4)`
- **AND** `FetchSessions()` includes `sessionColor: 4` in the `ProjectSession` JSON

#### Scenario: Session with no color
- **GIVEN** a tmux session with no `@session_color` user option
- **WHEN** `ListSessions()` parses the tmux output
- **THEN** `SessionInfo.Color` is `nil`
- **AND** the `ProjectSession` omits `sessionColor`

## Color Storage: Window Colors

### Requirement: Window color storage via tmux `@color` user option

Window colors SHALL be stored as tmux user options on each window via `@color`. The value SHALL be an ANSI palette index (integer 0-15). An unset `@color` option means no color.

The backend SHALL read `@color` by adding `#{@color}` to the `ListWindows()` tmux format string. The `WindowInfo` struct SHALL gain a `Color *int` field (pointer for nullable). No new tmux subprocess calls are needed for reading — the value flows through the existing `list-windows` format string.

#### Scenario: Window with color set
- **GIVEN** a tmux window with `@color` set to `2`
- **WHEN** `ListWindows()` parses the tmux output
- **THEN** `WindowInfo.Color` is `*int(2)`
- **AND** the JSON response includes `"color": 2`

#### Scenario: Window with no color
- **GIVEN** a tmux window with no `@color` user option
- **WHEN** `ListWindows()` parses the tmux output
- **THEN** `WindowInfo.Color` is `nil`
- **AND** the JSON response omits the `color` field (via `omitempty`)

## API: Color Endpoints

### Requirement: Set window color endpoint

The backend SHALL expose `POST /api/sessions/{session}/windows/{index}/color` to set or clear a window's color. The request body SHALL be `{"color": N}` (integer 0-15) to set, or `{"color": null}` to clear.

Setting SHALL execute `tmux set-option -w -t "{session}:{index}" @color {N}` via `exec.CommandContext` with timeout. Clearing SHALL execute `tmux set-option -wu -t "{session}:{index}" @color`.

The endpoint SHALL validate:
- Session name via `validate.ValidateName()`
- Window index is a non-negative integer
- Color value is an integer 0-15 (when not null)

#### Scenario: Set window color
- **GIVEN** session "myproject" with window index 2
- **WHEN** `POST /api/sessions/myproject/windows/2/color` with body `{"color": 4}`
- **THEN** the server executes `tmux set-option -w -t "myproject:2" @color 4`
- **AND** returns `200 {"ok": true}`

#### Scenario: Clear window color
- **GIVEN** session "myproject" with window index 2 that has `@color` set
- **WHEN** `POST /api/sessions/myproject/windows/2/color` with body `{"color": null}`
- **THEN** the server executes `tmux set-option -wu -t "myproject:2" @color`
- **AND** returns `200 {"ok": true}`

#### Scenario: Invalid color value
- **GIVEN** any session and window
- **WHEN** `POST .../color` with body `{"color": 20}`
- **THEN** returns `400` with an error message

### Requirement: Set session color endpoint

The backend SHALL expose `POST /api/sessions/{session}/color` to set or clear a session's color. The request body SHALL be `{"color": N}` (integer 0-15) to set, or `{"color": null}` to clear.

Setting SHALL execute `tmux set-option -t "{session}" @session_color {N}`. Clearing SHALL execute `tmux set-option -u -t "{session}" @session_color`.

#### Scenario: Set session color
- **GIVEN** session "myproject"
- **WHEN** `POST /api/sessions/myproject/color` with body `{"color": 6}`
- **THEN** the server executes `tmux set-option -t "myproject" @session_color 6`
- **AND** returns `200 {"ok": true}`

#### Scenario: Clear session color
- **GIVEN** session "myproject" with `@session_color` set
- **WHEN** `POST /api/sessions/myproject/color` with body `{"color": null}`
- **THEN** the server executes `tmux set-option -u -t "myproject" @session_color`
- **AND** returns `200 {"ok": true}`

### Requirement: Server color endpoints

The backend SHALL expose `GET /api/settings/server-color` and `PUT /api/settings/server-color` for server colors stored in `~/.rk/settings.yaml`.

`GET` with `?server=xxx` returns `{"color": N}` or `{"color": null}`. `GET` without params returns `{"colors": {"default": 4, ...}}`.

`PUT` accepts `{"server": "xxx", "color": N}` or `{"server": "xxx", "color": null}` to set or clear.

## Frontend: Visual Treatment

### Requirement: Pre-blended full-row background tint

Colored sidebar rows SHALL display a full-width background tint using the ANSI palette color blended with the theme background via the existing `blendHex()` utility. Colors SHALL be pre-blended (concrete hex values), not rgba opacity. A single-axis blend ratio ladder increases prominence with interaction depth:

| State | ANSI ratio | Background ratio |
|-------|------------|------------------|
| Base | 7% | 93% |
| Hover | 11% | 89% |
| Selected | 16% | 84% |

Each state uses the same mechanism — just more color mixed in.

**Selection indicator**: All selected rows (colored and uncolored) get a left accent border:
- Colored rows: `3px solid {ANSI color at full saturation}` + 16% tint background
- Uncolored rows: `3px solid var(--color-accent)` + `bg-accent/15` background

#### Scenario: Colored window row in base state
- **GIVEN** a theme with ANSI[4] (blue) = `#5b8af0` and background = `#0f1117`
- **WHEN** the window has `color: 4`
- **THEN** the row background is `blendHex("#5b8af0", "#0f1117", 0.07)`

#### Scenario: Colored window row selected
- **GIVEN** same theme, window with `color: 4`, window is selected
- **WHEN** the sidebar renders the selected colored window row
- **THEN** the row background uses the 16% blend
- **AND** the left border uses ANSI[4] at full saturation (`#5b8af0`)

#### Scenario: Uncolored window row selected
- **GIVEN** a window with no color assigned, window is selected
- **WHEN** the sidebar renders the row
- **THEN** the row background uses `bg-accent/15`
- **AND** the left border uses `var(--color-accent)`

### Requirement: ANSI color palette for picker

The color picker SHALL offer 7 ANSI palette colors: the 6 standard hues (1-6) plus bright black/gray (8). Excluded: 0 (black), 7 (white), 15 (bright white), and all bright variants (9-14) which are near-identical to normal variants at low blend ratios.

Available indices: 1, 2, 3, 4, 5, 6, 8.

#### Scenario: Picker color set
- **GIVEN** the user opens the color picker
- **WHEN** the picker renders swatches
- **THEN** exactly 7 swatches are displayed in a single row
- **AND** indices 0, 7, 9-15 are excluded (except 8)
- **AND** each swatch shows a split preview: top half = base tint (7% blend), bottom half = selected tint (16% blend)

### Requirement: Activity dot decoupled from row color

Window activity dots SHALL indicate activity independently of row tint color. The dot SHALL use a shape-based indicator:
- **Active window**: filled circle (`●`)
- **Idle window**: hollow ring (`○`)

The dot color SHALL always be `text-secondary` — never influenced by the row's assigned color. This replaces the current green/gray color-based activity indicator.

#### Scenario: Active window with row color
- **GIVEN** a window with `color: 2` (green) that is active
- **WHEN** the sidebar renders the window row
- **THEN** the activity indicator is a filled circle in `text-secondary` color
- **AND** the row background uses the green-tinted blend

#### Scenario: Idle window without row color
- **GIVEN** a window with no color that is idle
- **WHEN** the sidebar renders the window row
- **THEN** the activity indicator is a hollow ring in `text-secondary` color

## Frontend: Color Picker UX

### Requirement: Command palette color actions

The command palette SHALL include "Session: Set Color" and "Window: Set Color" actions. These actions SHALL open a swatch popover showing the 13 available ANSI colors plus a "Clear" option.

"Window: Set Color" SHALL only appear when a window is selected. "Session: Set Color" SHALL only appear when a session is selected.

#### Scenario: Set window color via command palette
- **GIVEN** the user is on `/:server/:session/:window`
- **WHEN** the user opens command palette and selects "Window: Set Color"
- **THEN** a swatch popover opens showing 7 ANSI color swatches + Clear
- **AND** selecting a color calls `POST /api/sessions/:session/windows/:index/color`
- **AND** the row background updates immediately (optimistic update)

#### Scenario: Clear session color via command palette
- **GIVEN** session "myproject" has `sessionColor: 4`
- **WHEN** the user selects "Session: Set Color" then clicks "Clear"
- **THEN** the session row background returns to default
- **AND** `POST /api/sessions/myproject/color` is called with `{"color": null}`

### Requirement: Swatch popover component

A new `SwatchPopover` component SHALL render 7 color swatches in a single-row grid (7 columns) plus a "Clear" action.

Each swatch SHALL:
- Display a split preview: top half shows the base tint (7% blend), bottom half shows the selected tint (16% blend)
- Be a clickable button (keyboard accessible via arrow keys)
- Show a checkmark in the bottom half for the currently selected color
- Initialize focus on the currently selected swatch (not always index 0)
- Update dynamically during theme preview (swatches re-render when theme changes)

The popover SHALL dismiss on selection, Escape, or outside click.

#### Scenario: Swatch popover in theme preview
- **GIVEN** the swatch popover is open
- **WHEN** the user previews a different theme via the theme selector
- **THEN** the swatch colors update live to reflect the previewed theme's ANSI palette

### Requirement: Hover indicator on sidebar rows

On hover, a subtle color icon SHALL appear at the row's trailing edge (right side). Clicking the icon SHALL open the swatch popover inline, anchored to the row.

The hover indicator SHALL:
- Be visible only on hover (desktop) or always visible on touch devices (`coarse:opacity-100`)
- Not interfere with existing hover-reveal controls (kill button, info button)
- Use a small palette/swatch icon

#### Scenario: Set color via hover indicator
- **GIVEN** the user hovers over a window row in the sidebar
- **WHEN** a color swatch icon appears and the user clicks it
- **THEN** the swatch popover opens inline, anchored near the row
- **AND** selecting a color immediately applies it

## Frontend: Type Changes

### Requirement: Frontend type extensions

`ProjectSession` in `types.ts` SHALL gain a `sessionColor?: number` field.

`WindowInfo` in `types.ts` SHALL gain a `color?: number` field.

#### Scenario: SSE data with colors
- **GIVEN** the SSE stream delivers session data with color fields
- **WHEN** `SessionProvider` parses the data
- **THEN** `session.sessionColor` and `window.color` are available to all consumers

## Design Decisions

1. **Pre-blended hex via `blendHex()` over rgba opacity**:
   - *Why*: Produces deterministic hex values that avoid alpha compositing surprises when states layer (hover on selected). Enables WCAG contrast testing at compile/test time.
   - *Rejected*: rgba opacity — layered alphas produce hard-to-predict composited colors; contrast ratio varies with stacking.

2. **Three-tier storage: tmux session option + tmux window option + settings.yaml**:
   - *Why*: Session and window colors are ephemeral (tmux-native user options). Server colors persist across restarts (settings.yaml). Session uses `@session_color` (not `@color`) to avoid tmux option inheritance resolving window values.
   - *Rejected*: `run-kit.yaml` at project root for sessions — multiple sessions sharing the same project directory would link their colors.

3. **7 colors (single row) over 13 colors (two rows)**:
   - *Why*: Normal (1-6) and bright (9-14) ANSI variants are near-identical at low blend ratios. Two rows of near-duplicates was confusing. 7 distinct hues in one row is cleaner.
   - *Rejected*: 13 colors in 7+6 grid — visually redundant, "nauseous" at low opacity.

4. **Single-axis blend ratio ladder (7/11/16%) over mixed mechanisms**:
   - *Why*: Consistent ideology — prominence increases via one dimension (more color mixed in). Earlier implementation mixed blend ratio (hover) with lightness adjustment (selected), which felt inconsistent.
   - *Rejected*: 12/18/22% — too saturated, muddy tints on dark themes. Lightness-based selected — different mechanism from hover.

5. **Split swatch preview over full-saturation swatches**:
   - *Why*: Full-saturation swatches don't represent the actual subtle tint. Split preview (top: base, bottom: selected) shows what the row will actually look like.

6. **Universal left accent border for selection**:
   - *Why*: Consistent selection indicator across colored and uncolored rows. Colored rows use ANSI hue, uncolored use theme accent.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | ANSI palette indices as color source, not fixed RGB | User explicitly chose ANSI palette for theme adaptation | S:95 R:80 A:90 D:95 |
| 2 | Certain | Session `@session_color`, window `@color`, server in settings.yaml | Three-tier storage: tmux options for ephemeral (session/window), settings.yaml for persistent (server) | S:95 R:80 A:90 D:90 |
| 3 | Certain | Single-axis blend ratio ladder: 7/11/16% | User iterated from 12/18/22% down to 7/11/16% for subtlety; single mechanism throughout | S:90 R:85 A:85 D:90 |
| 4 | Certain | 7 colors in picker (indices 1-6, 8) | Bright variants dropped — near-identical at low blend ratios | S:90 R:85 A:85 D:90 |
| 5 | Certain | Split swatch preview (base top, selected bottom) | User requested swatches show actual row appearance | S:90 R:85 A:85 D:90 |
| 6 | Certain | Universal left accent border for selection | Colored rows use ANSI hue, uncolored use theme accent — consistent indicator | S:90 R:85 A:85 D:90 |
| 7 | Certain | Activity dot: filled circle = active, hollow ring = idle, always text-secondary | Shape-based, decoupled from row color | S:85 R:80 A:85 D:85 |
| 8 | Certain | SwatchPopover shared across session, window, and server rows | Same hover-reveal swatch icon pattern at all three levels | S:85 R:85 A:85 D:85 |

8 assumptions (8 certain, 0 confident, 0 tentative, 0 unresolved)
