# Spec: Session and Window Color Tinting

**Change**: 260416-jn4h-session-window-color-tinting
**Created**: 2026-04-16
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`, `docs/memory/run-kit/architecture.md`

## Non-Goals

- Theme editor or custom color picker beyond ANSI palette — only the theme's 16 ANSI indices are offered
- Per-pane coloring — only session-level and window-level
- Color inheritance (windows inheriting session color) — each level is independent
- Persisting window colors across tmux restarts — window colors are ephemeral by design

## Color Storage: Session Colors

### Requirement: Session color persistence via `run-kit.yaml`

Session colors SHALL be stored in a `run-kit.yaml` file at the project root of each tmux session's working directory. The file SHALL use the following YAML structure:

```yaml
session_color: 4  # ANSI palette index (0-15), absent means no color
```

The backend SHALL read `run-kit.yaml` best-effort — a missing file or missing `session_color` key MUST NOT produce an error. The project root SHALL be derived from window 0's `pane_current_path`, consistent with existing project root detection in `internal/sessions`.

#### Scenario: Session with color assigned
- **GIVEN** a tmux session whose project root contains `run-kit.yaml` with `session_color: 4`
- **WHEN** `FetchSessions()` assembles `ProjectSession` data
- **THEN** the `ProjectSession` includes `sessionColor: 4` in the JSON response
- **AND** the SSE stream broadcasts this value to all connected clients

#### Scenario: Session with no run-kit.yaml
- **GIVEN** a tmux session whose project root has no `run-kit.yaml`
- **WHEN** `FetchSessions()` assembles `ProjectSession` data
- **THEN** the `ProjectSession` omits `sessionColor` (or includes `null`)
- **AND** no error is logged or returned

#### Scenario: Session with run-kit.yaml but no session_color key
- **GIVEN** a tmux session whose project root has `run-kit.yaml` without the `session_color` key
- **WHEN** `FetchSessions()` assembles `ProjectSession` data
- **THEN** the `ProjectSession` omits `sessionColor`

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

Setting SHALL write `session_color: N` to `run-kit.yaml` at the session's project root. Clearing SHALL remove the `session_color` key (or delete the file if it becomes empty).

The project root SHALL be derived from the session's first window's `pane_current_path`, consistent with existing `FetchSessions()` logic.

#### Scenario: Set session color
- **GIVEN** session "myproject" with project root at `~/code/myproject`
- **WHEN** `POST /api/sessions/myproject/color` with body `{"color": 6}`
- **THEN** `~/code/myproject/run-kit.yaml` contains `session_color: 6`
- **AND** returns `200 {"ok": true}`
- **AND** the next SSE tick reflects the updated `sessionColor`

#### Scenario: Clear session color
- **GIVEN** session "myproject" with `run-kit.yaml` containing `session_color: 6`
- **WHEN** `POST /api/sessions/myproject/color` with body `{"color": null}`
- **THEN** `session_color` is removed from `run-kit.yaml`
- **AND** returns `200 {"ok": true}`

## Frontend: Visual Treatment

### Requirement: Pre-blended full-row background tint

Colored sidebar rows SHALL display a full-width background tint using the ANSI palette color blended with the theme background via the existing `blendHex()` utility. Colors SHALL be pre-blended (concrete hex values), not rgba opacity.

The blend ratios SHALL be:

| State | ANSI ratio | Background ratio |
|-------|------------|------------------|
| Base | 12% | 88% |
| Hover | 18% | 82% |
| Selected | 22% | 78% |

Each state gets its own pre-blended hex — no stacking of transparent layers. The `blendHex(ansiColor, background, ratio)` call produces a concrete color for each `(ansiIndex, state)` pair.

When a row has a color assigned, the color-derived background SHALL replace the existing state backgrounds:
- Selected: replaces `bg-accent/10` + `border-accent`
- Hover: replaces `hover:bg-bg-card/50` (or equivalent)

The left border on selected windows SHALL use the ANSI color at full saturation (not blended).

#### Scenario: Colored window row in base state
- **GIVEN** a theme with ANSI[4] (blue) = `#5b8af0` and background = `#0f1117`
- **WHEN** the window has `color: 4`
- **THEN** the row background is `blendHex("#5b8af0", "#0f1117", 0.12)` (approximately `#16192a`)

#### Scenario: Colored window row selected
- **GIVEN** same theme, window with `color: 4`, window is selected
- **WHEN** the sidebar renders the selected colored window row
- **THEN** the row background uses the 22% blend
- **AND** the left border uses ANSI[4] at full saturation (`#5b8af0`)

#### Scenario: Uncolored window row
- **GIVEN** a window with no color assigned
- **WHEN** the sidebar renders the row
- **THEN** existing styling is used unchanged (current `bg-accent/10` for selected, etc.)

### Requirement: ANSI color palette for picker

The color picker SHALL offer 13 ANSI palette colors, excluding indices 0 (black), 7 (white), and 15 (bright white). Index 8 (bright black) SHALL be included — it renders as a usable gray in most themes.

Available indices: 1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14.

#### Scenario: Picker color set
- **GIVEN** the user opens the color picker
- **WHEN** the picker renders swatches
- **THEN** exactly 13 swatches are displayed
- **AND** indices 0, 7, 15 are excluded
- **AND** each swatch shows the ANSI color from the active theme at full saturation

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
- **THEN** a swatch popover opens showing 13 ANSI color swatches + Clear
- **AND** selecting a color calls `POST /api/sessions/:session/windows/:index/color`
- **AND** the row background updates immediately (optimistic update)

#### Scenario: Clear session color via command palette
- **GIVEN** session "myproject" has `sessionColor: 4`
- **WHEN** the user selects "Session: Set Color" then clicks "Clear"
- **THEN** the session row background returns to default
- **AND** `POST /api/sessions/myproject/color` is called with `{"color": null}`

### Requirement: Swatch popover component

A new `SwatchPopover` component SHALL render 13 color swatches in a compact grid layout (e.g., 7+6 or similar two-row arrangement) plus a "Clear" action.

Each swatch SHALL:
- Display the ANSI color from `theme.palette.ansi[N]` at full saturation
- Be a clickable button (keyboard accessible via arrow keys)
- Show a checkmark or ring indicator for the currently selected color
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

2. **Dual storage (run-kit.yaml + tmux @color) over unified storage**:
   - *Why*: Session colors need persistence across tmux restarts (file-based). Window colors are ephemeral and tmux-native (user options survive session lifetime but not server restart).
   - *Rejected*: All in run-kit.yaml — would require tracking per-window state in a file, complex synchronization with tmux window lifecycle.

3. **Dedicated POST endpoints over reusing sendKeys**:
   - *Why*: Follows existing POST-per-mutation pattern (one endpoint per resource action). Clean separation of concerns.
   - *Rejected*: Generic tmux option setter — over-abstraction for a single use case.

4. **Shape-based activity indicator over color-based**:
   - *Why*: Decouples activity from row tint. Filled circle vs hollow ring is unambiguous regardless of background color.
   - *Rejected*: Color-based indicator that changes with tint — would create confusing visual hierarchy when tint and dot overlap.

5. **Command palette + hover indicator over right-click context menu**:
   - *Why*: Keyboard-first (constitution V). Hover indicator provides quick mouse access. Both converge on the same swatch popover component.
   - *Rejected*: Right-click context menu — platform-dependent behavior, conflicts with browser context menu on some OS/browser combos.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | ANSI palette indices as color source, not fixed RGB | Confirmed from intake #1 — user explicitly chose ANSI palette for theme adaptation | S:95 R:80 A:90 D:95 |
| 2 | Certain | Session colors in `run-kit.yaml`, window colors in tmux `@color` | Confirmed from intake #2 — dual storage for persistence semantics | S:95 R:70 A:85 D:90 |
| 3 | Certain | Full row background tint at ~12% base opacity | Confirmed from intake #3 — user chose this over color dot or pseudo-element | S:90 R:85 A:80 D:90 |
| 4 | Certain | Command palette as primary picker, hover indicator as shortcut | Confirmed from intake #4 — keyboard-first per constitution V | S:90 R:85 A:85 D:90 |
| 5 | Certain | 13 ANSI colors in picker (exclude 0, 7, 15) | Confirmed from intake #8 — include bright black (8) as usable gray | S:85 R:85 A:80 D:85 |
| 6 | Confident | Dedicated API endpoints for setting colors | Confirmed from intake #6 — follows existing POST-per-mutation pattern | S:75 R:80 A:85 D:80 |
| 7 | Confident | `run-kit.yaml` at project root, gitignored by convention | Confirmed from intake #7 — file-based preferences, not server config | S:70 R:65 A:70 D:70 |
| 8 | Certain | Activity dot: filled circle = active, hollow ring = idle, always text-secondary | Confirmed from intake #9 — shape-based, decoupled from color | S:85 R:80 A:85 D:85 |
| 9 | Certain | Pre-blended colors via `blendHex()` at 12/18/22% ratios | Confirmed from intake #10 — deterministic contrast, testable | S:90 R:85 A:85 D:90 |
| 10 | Confident | `run-kit.yaml` reading is best-effort — missing file means no color | Confirmed from intake #11 — consistent with "derive state" principle | S:75 R:90 A:85 D:85 |
| 11 | Confident | Swatch popover is a shared component used by both palette and hover indicator | Codebase pattern: shared dialog/modal components (Dialog, KillDialog, CreateSessionDialog) | S:70 R:85 A:80 D:75 |
| 12 | Certain | `#{@color}` added to ListWindows format string — no separate tmux call | Codebase pattern: ListWindows already uses multi-field format string; adding a field is trivial | S:90 R:90 A:90 D:95 |
| 13 | Confident | Session color read by FetchSessions enrichment, alongside pane-map | Follows existing enrichment pattern in internal/sessions — parallel per-session data fetching | S:70 R:80 A:80 D:75 |

13 assumptions (7 certain, 6 confident, 0 tentative, 0 unresolved)
