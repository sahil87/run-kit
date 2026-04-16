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

The picker should expose 12-14 ANSI indices, excluding black (0) and white (7) which would clash with backgrounds in dark and light themes respectively. Bright black (8) and bright white (15) should also likely be excluded. The exact exclusion set needs validation against several themes to ensure all offered colors are visually distinguishable at 10% opacity.

### 2. Session Color Storage — `run-kit.yaml`

Session colors are persistent across tmux restarts. They are stored in a new `run-kit.yaml` config file at the project root of each tmux session's working directory.

```yaml
# run-kit.yaml (in project root, e.g., ~/code/myproject/run-kit.yaml)
session_color: 4  # ANSI palette index (0-15), absent means no color
```

**Important context**: A previous `run-kit.yaml` config file was removed early in run-kit's history (see architecture changelog 2026-03-13). That file stored port/host configuration, which was replaced by env vars. This new `run-kit.yaml` serves a different purpose: per-project run-kit preferences. The constitution says "Configuration lives in environment variables" for server config, but session color is a per-project user preference, not server configuration. The file should be gitignored by convention.

**Backend changes**:
- `internal/config/` or new package reads `run-kit.yaml` from the project root (derived from window 0's `pane_current_path`, same as existing project root detection)
- The session color value is included in the `ProjectSession` struct and sent via SSE
- Reading `run-kit.yaml` is best-effort — missing file means no color

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

The color is applied as a full-width background tint on the sidebar row at ~10-15% opacity:

Colors are **pre-blended** using the existing `blendHex()` utility (already used for `--color-border` derivation in `theme-context.tsx`), not rgba opacity. This avoids alpha compositing surprises when states layer, and produces deterministic hex values that can be validated for contrast at test time.

```tsx
// Computed once at theme load per ANSI color
const tint = blendHex(ansiColor, background, ratio); // ratio varies by state

// State ladder (blend ratios):
//   Base:     12%  ANSI color, 88% background
//   Hover:    18%  ANSI color, 82% background
//   Selected: 22%  ANSI color, 78% background
```

Each state gets its own pre-blended hex — no stacking. The `blendHex` call produces a concrete color for each (ansiIndex, state) pair.

**Interaction with existing states**:
- **Selected window**: Currently uses `bg-accent/15`. A colored selected row uses the 22% blend instead — one concrete background, not two layered alphas.
- **Activity dot**: Window rows have green/gray activity dots. When a window has a color set, the color replaces the activity dot color. Activity state would need an alternative indicator (e.g., pulsing animation, brightness difference, or a separate shape indicator).
- **Hover state**: Uses the 18% blend, replacing the current `hover:bg-bg-card/50`.
- **Contrast safety**: Since all tints are concrete hex values, a test can assert WCAG contrast ratios between each tint and `text-primary`/`text-secondary` across all 70 themes.

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
- 12-14 color swatches in a 2-row grid (or similar compact layout)
- Swatches show colors from `theme.palette.ansi[N]` at full saturation
- A "Clear" button/icon to remove the color
- Current selection indicated with a checkmark or ring
- Popover dismisses on selection or Escape
- Swatches are rendered dynamically from the active theme — they update live during theme preview

### 6. API Changes for Setting Window Color

Setting a window color requires a tmux command execution. Two approaches:

**Option A**: New dedicated endpoint `POST /api/sessions/:session/windows/:index/color` with body `{"color": 4}` (or `{"color": null}` to clear).

**Option B**: Reuse the existing `sendKeys` mechanism or add a generic tmux option setter.

Option A is cleaner and follows the existing pattern of one-endpoint-per-mutation. The handler calls `tmux set-option -w @color <value>` on the target window.

For session colors, the backend needs a new endpoint to write `run-kit.yaml`. Something like `POST /api/sessions/:session/color` with body `{"color": 4}` (or `null`).

## Affected Memory

- `run-kit/ui-patterns`: (modify) Document color tinting visual treatment, picker UX, state interactions
- `run-kit/architecture`: (modify) Document `run-kit.yaml` config file, new API endpoints, `@color` tmux user option, `WindowInfo.Color` field

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
- `app/backend/internal/tmux/tmux.go` — `ListWindows` format string addition, `set-option`/`set-option -wu` calls
- `app/backend/internal/config/` or new package — `run-kit.yaml` reading
- `app/backend/api/windows.go` — new color endpoint
- `app/backend/api/sessions.go` — new session color endpoint
- `app/backend/api/router.go` — route registration
- `app/backend/internal/sessions/` — pass through session color from config

**Config**:
- New `run-kit.yaml` file convention (per-project, gitignored)

## Open Questions

- Should `run-kit.yaml` support any other per-project preferences beyond `session_color`, or is it strictly single-purpose for now?

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | ANSI palette indices as color source, not fixed RGB | Discussed — user explicitly chose ANSI palette for theme adaptation | S:95 R:80 A:90 D:95 |
| 2 | Certain | Session colors in `run-kit.yaml`, window colors in tmux `@color` | Discussed — user chose this dual storage approach for persistence semantics | S:95 R:70 A:85 D:90 |
| 3 | Certain | Full row background tint at ~10-15% opacity | Discussed — user explicitly chose this over color dot or pseudo-element | S:90 R:85 A:80 D:90 |
| 4 | Certain | Command palette as primary picker, hover indicator as shortcut | Discussed — user chose this UX over right-click context menu | S:90 R:85 A:85 D:90 |
| 5 | Certain | Swatch popover with 12-14 ANSI colors plus Clear | Discussed — user specified excluding black/white which clash with backgrounds | S:85 R:85 A:80 D:85 |
| 6 | Confident | Dedicated API endpoints for setting colors (not reusing sendKeys) | Follows existing POST-per-mutation pattern; one endpoint per resource action | S:75 R:80 A:85 D:80 |
| 7 | Confident | `run-kit.yaml` at project root, gitignored by convention | Constitution says "no database" — file-based is allowed. Previous `run-kit.yaml` was removed for config, but this is per-project preferences | S:70 R:65 A:70 D:70 |
| 8 | Certain | Include bright black (8) in picker; exclude only 0 (black), 7 (white), 15 (bright white) — 13 colors total | Discussed — user chose to include bright black; it renders as a usable gray in most themes | S:85 R:85 A:80 D:85 |
| 9 | Certain | Activity dot decoupled from color: filled circle = active, hollow ring = idle, always text-secondary color | Discussed — user chose option B; dot indicates activity independently of row tint | S:85 R:80 A:85 D:85 |
| 10 | Certain | Pre-blended colors via `blendHex()` at 12% base / 18% hover / 22% selected | Discussed post-draft — user chose Option 3 (pre-blended) over rgba opacity for deterministic contrast and testability | S:90 R:85 A:85 D:90 |
| 11 | Confident | `run-kit.yaml` reading is best-effort — missing file means no color | Consistent with constitution's "derive state" principle; no error on missing config | S:75 R:90 A:85 D:85 |

11 assumptions (8 certain, 3 confident, 0 tentative, 0 unresolved)
