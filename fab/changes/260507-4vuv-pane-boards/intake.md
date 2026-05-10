# Intake: Pane Boards

**Change**: 260507-4vuv-pane-boards
**Created**: 2026-05-07
**Status**: Draft

## Origin

This change emerged from a `/fab-discuss` exploratory session about a "Pin + Panes" feature framed as a Kanban-like UI for tmux windows. The conversation resolved several major design questions:

1. **Mental model** — Three framings considered: pins as bookmarks (flat global list), pins as workspaces (named savable groupings), pins as Kanban (state-bearing columns). Decision: **named workspaces** — boards are flat-membership view layouts, not state-bearing Kanban columns. Columns are pure visual slots.

2. **Comparison to closed PR #176 (Pane Lanes)** — User referenced PR #176 as a prior attempt. PR #176 implemented similar UX (TweetDeck-style horizontal columns, pin/unpin from sidebar/right-click/palette, live xterm per pane, click/hover/keyboard focus, SSE-driven auto-unpin) but used `localStorage` for storage. **User has decided to close PR #176** and start fresh from this intake. The fixed-width-pane idea from PR #176 is borrowed deliberately; everything else is fresh design.

3. **Storage layer — must reside in tmux (not browser)** — Cross-device continuity is a hard requirement (user explicitly rejected `localStorage`). After exploring tmux option scopes (server, session, window, pane), user landed on **server-scoped options distributed across tmux servers**, with each server storing membership only for its own windows.

4. **Storage format — single `@rk_board` option per server, no separate `@rk_boards` registry** — User rejected duplicating board names in a separate registry option (e.g., `@rk_boards = "main,deploy"`). Boards are **derived** from `@rk_board` membership entries. Tradeoff: empty boards cannot exist. User accepts this — boards materialize on first pin and vanish on last unpin.

5. **Empty boards rejected explicitly** — Considered using a dedicated `rk-daemon` window or a tombstone window ID (`@__empty__`) to declare boards with zero members. User rejected both: the daemon adds infrastructure dependency and re-introduces centralization; the tombstone either lives on one server (centralization) or repeats across all servers (duplication). Conclusion: no empty boards.

6. **Navigation pattern decided** — Sidebar "Boards" section **above** Sessions section, hidden when no boards exist; top-bar breadcrumb dropdown when on a board (`Board ▸ name ▾`); active-board pinned windows subtly highlighted in Sessions tree; one-line hint shown when sidebar Boards section is empty under specific conditions.

> **User input**: "Pane boards — multi-pane horizontal-scroll dashboard view for pinned tmux windows, with named boards persisted as distributed tmux server-scoped @rk_board options."

## Why

### The problem

Running multiple long-running terminal workflows — particularly Claude agents across tmux windows — forces single-window viewing today. Run-kit's current navigation is one-window-at-a-time: navigate to a window, interact, navigate away to check another. Two consequences:

1. **Blind spots** — agents waiting for input go unnoticed because the user is looking at a different window
2. **High switching cost** — checking N agents requires N navigation cycles, breaking flow

### What happens if we don't fix it

The agent-orchestration use case (a primary run-kit use case per the project description "Web based agent orchestration framework") suffers as agent count grows. Users will resort to native tmux windowing or external dashboards, undermining run-kit's value proposition.

### Why this approach over alternatives

- **Boards over single global pinboard**: Multiple workflow contexts coexist (agents on feature X, deploy monitoring, frontend debugging). A single flat list doesn't separate these contexts.
- **Boards over Kanban (state-bearing columns)**: Run-kit doesn't have a workflow state machine to map columns onto. Columns as slots (TweetDeck) is simpler and matches actual usage.
- **Fixed-width panes over variable-width**: tmux has ~80 column minimum. Variable-width with focus-expand creates focus discontinuities; fixed-width with horizontal scroll is honest about the constraint.
- **Tmux storage over `localStorage`**: Cross-device continuity is a hard product requirement. `localStorage` is per-browser-per-device.
- **Tmux storage over filesystem coordinator**: Tmux is the existing state layer; filesystem would add new infrastructure for marginal benefit.
- **Distributed (per-server) storage over designated-server centralization**: Avoids single point of failure; server contributions are independent; matches tmux's natural ownership model (each server owns its windows).
- **Boards derived from membership over separate registry**: Avoids data duplication; eliminates sync concerns between registry and memberships.

## What Changes

### 1. New tmux server-scoped option: `@rk_board`

A single server-scoped option per tmux server holds membership entries for that server's windows.

**Format**:
```
@rk_board = "<window_id>:<board_name>:<order_key>,<window_id>:<board_name>:<order_key>,..."
```

**Example** — three tmux servers, two boards (`main`, `deploy`) split across servers:
```
runkit:   @rk_board = "@1234:main:a,@5678:main:c,@9abc:deploy:a"
default:  @rk_board = "@def0:main:b,@e012:deploy:b"
work:     @rk_board = ""
```

**Resulting board reconstruction**:
- `main`: 4 windows, ordered by `order_key`: `@1234(runkit, a)`, `@def0(default, b)`, `@5678(runkit, c)` — wait, this example needs `b` in default for ordering: re-derived as `[@1234@runkit:a, @def0@default:b, @5678@runkit:c]`
- `deploy`: 2 windows: `[@9abc@runkit:a, @e012@default:b]`

**Read** (per board render):
```bash
# Parallel across all servers from ListServers()
tmux -L runkit show-options -s -v @rk_board   # → "@1234:main:a,..."
tmux -L default show-options -s -v @rk_board  # → "@def0:main:b,..."
tmux -L work    show-options -s -v @rk_board  # → "" or unset
```

**Write** (pin/unpin):
```bash
# Read existing → mutate → write back, on the source server only
tmux -L runkit set-option -s @rk_board "<new comma-joined list>"
```

**Order keys** — lexicographic / fractional indexing (Figma/Linear style):
- Single-character keys initially: `a`, `b`, `c`, ...
- Insert between `b` and `c`: `bm`
- Insert between `b` and `bm`: `bg` or `bf` (any string lexicographically between)
- Inserts never require renumbering existing entries

**Boards are derived** from this option — no separate `@rk_boards` option exists. Listing boards = parallel scan + extract distinct board names from membership entries.

### 2. New backend Go API surface

New file (or addition): `app/backend/internal/tmux/board.go`. Functions:

```go
// Read and parse @rk_board for a single server.
type BoardEntry struct {
    Server   string  // tmux server name (added by run-kit, not in tmux)
    WindowID string  // e.g. "@1234"
    Board    string
    OrderKey string
}
func ListBoardEntries(ctx context.Context, server string) ([]BoardEntry, error)

// Aggregate across all known servers.
func ListAllBoardEntries(ctx context.Context) ([]BoardEntry, error)

// Distinct board names.
func ListBoards(ctx context.Context) ([]BoardSummary, error)
type BoardSummary struct {
    Name      string
    PinCount  int
}

// Render a single board: filtered + sorted entries, with stale entries dropped (and lazy write-back).
func GetBoard(ctx context.Context, name string) ([]BoardEntry, error)

// Mutations.
func Pin(ctx context.Context, server, windowID, board string) error
func Unpin(ctx context.Context, server, windowID, board string) error
func Reorder(ctx context.Context, server, windowID, board, newOrderKey string) error
```

**Implementation notes**:
- Use `tmuxExecServer(ctx, server, "show-options", "-s", "-v", "@rk_board")` for reads
- Use `tmuxExecServer(ctx, server, "set-option", "-s", "@rk_board", "<value>")` for writes
- Format constant: `tab-delimited` is risky inside tmux option values (tmux treats whitespace specially). Use `:` as field separator and `,` as entry separator (chosen because window IDs have `@` prefix and board names are user-input — see Open Questions for character validation).
- Lazy stale cleanup: when reading, intersect with `tmux list-windows -a -F "#{window_id}"` per server. If stale entries found, write back the cleaned list.

### 3. New backend HTTP API

New file: `app/backend/api/boards.go`. Endpoints:

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/api/boards` | — | `[{name, pin_count}]` |
| `GET` | `/api/boards/{name}` | — | `[{server, window_id, session, window_index, window_name, order_key, panes}]` (joined with live window data) |
| `POST` | `/api/boards/{name}/pin` | `{"server": "...", "window_id": "@1234"}` | `{"ok": true}` |
| `POST` | `/api/boards/{name}/unpin` | `{"server": "...", "window_id": "@1234"}` | `{"ok": true}` |
| `POST` | `/api/boards/{name}/reorder` | `{"server": "...", "window_id": "@1234", "before": "@5678" or null, "after": "@9abc" or null}` | `{"ok": true, "new_order_key": "bm"}` |

**Note**: The reorder endpoint takes neighbor IDs and computes the new order key server-side via fractional indexing. Frontend doesn't generate keys.

### 4. New frontend route: `/board/$name`

Add to `app/frontend/src/router.tsx`. Route renders `BoardPage` component.

**Layout**:
- AppShell preserved (sidebar + top bar + bottom bar all visible — unlike the closed PR #176 which used a standalone page)
- Main content area: horizontally-scrollable container with pane "cards"
- Each pane card: **default 480px wide, drag-to-resize between 280px (min) and viewport-minus-sidebar (max)**, full available height, contains live xterm + pane header (`window-name · server` + unpin button) <!-- clarified: pane width 480px default, drag-to-resize in v1, 280px min -->
- Pane widths persisted per-board in browser `localStorage` key `runkit:board-widths:<board-name>` as `{<window_id>: <px>, ...}`. Pin state remains in tmux (cross-device); pane widths are intentionally browser-local view state. <!-- clarified: pane widths in localStorage, not cross-device -->
- Empty state: "No panes pinned to this board yet. Pin a window from the sidebar."

**Top bar (when on `/board/$name`)**:
- Breadcrumbs replaced with: `Board ▸ <name> ▾`
- The `▾` opens a dropdown listing other boards + `← Sessions` option
- Connection status, FixedWidthToggle, command palette trigger remain unchanged

### 5. New sidebar "Boards" section

New file: `app/frontend/src/components/sidebar/boards-section.tsx`. Modify: `app/frontend/src/components/sidebar/index.tsx` to render the section.

**Placement**: above the Sessions section.

**Visibility**:
- **Hidden entirely** when zero boards exist across all servers
- **Visible** the moment the first pin creates the first board
- One-line hint "Pin a window to start a board" shown only under specific conditions (TBD — see Open Questions; default behavior is full-hide when empty)

**Each row**:
- Board name (left-aligned)
- Pin count (right-aligned, muted)
- Active state (highlighted when current route is `/board/$name`)

**Click**: navigate to `/board/$name`.

### 6. Pin/unpin entry points

| Entry point | Location | Action |
|---|---|---|
| Sidebar pin icon | New: pin icon on each window row in `app/frontend/src/components/sidebar/window-row.tsx` | Hover-revealed; filled when pinned to ANY board. Click → small popover with existing boards + "Pin to new board…" inline text input. |
| Command palette | Modify: action set construction in `app/frontend/src/app.tsx` (new `boardActions` group); palette component itself unchanged | New `Board:` prefix with multiple actions — see Section 7 for full inventory |
| Board view header | New: `app/frontend/src/components/board/board-page.tsx` (board view) | Per-pane unpin button in pane header |

> Right-click context menu was considered and **rejected** to limit blast radius — there is no existing context-menu pattern in the sidebar; introducing one would be a new component category orthogonal to the board feature itself. Three entry points (icon, palette, header) cover all common interaction surfaces.

### 7. Command palette (`Cmd+K`) surface

The existing palette (`app/frontend/src/components/command-palette.tsx`) is a generic action list — categories are encoded as `<Category>:` label prefixes. Existing prefixes: `Session:`, `Window:`, `View:`, `Theme:`, `Config:`, `Server:`, `Terminal:`, `Help:`. Action groups are constructed in `app/frontend/src/app.tsx` via `useMemo` and concatenated into a single `paletteActions` array (see `sessionActions`, `windowActions`, `viewActions`, `themeActions`, `configActions`, `serverActions`, `terminalActions` at `app.tsx:540-833`).

**New prefix**: `Board:`. Add a new `boardActions: PaletteAction[]` `useMemo` block in `app.tsx`, fold into `paletteActions`. Mirror the structure of `serverActions` (which combines management actions + dynamic switch-to-X entries) since boards behave similarly: a small fixed set of actions plus one entry per existing board.

**New palette entries**:

| Entry | Visibility | Action |
|---|---|---|
| `Board: Switch to <name>` *(one entry per existing board)* | Always — one per board derived from `@rk_board` scan; appended `(current)` when on that board | Navigate to `/board/<name>` |
| `Board: Pin Current Window…` | Only when on a window route (`sessionName && currentWindow`); fuzzy-matchable | Open the same picker popover used by sidebar pin icon — existing boards + "Pin to new board…" inline input |
| `Board: Unpin Current Window` | Only when current window is pinned to ≥1 board | If pinned to one board: unpin directly. If pinned to multiple: show a small picker for which board(s) to unpin from. |
| `Board: Leave Board View` | Only when on `/board/<name>`; navigates back to last window or sessions root | Navigate to last viewed window route, or `/` if none |
| `Board: Cycle Pane Focus →` | Only when on `/board/<name>` | Equivalent to `Cmd+]`; useful for users who don't remember the shortcut |
| `Board: Cycle Pane Focus ←` | Only when on `/board/<name>` | Equivalent to `Cmd+[` |
| `Board: Reorder Pane…` | Only when on `/board/<name>` and ≥2 panes | Open a small picker — choose pane → choose target position → reorder via API. Defer to v1.1 if scope-pressured. |

**Consistency rules** (matching existing prefix conventions in `app.tsx`):

1. Use sentence-case after the colon: `Board: Pin Current Window…` (not `Board: pin current window`)
2. Append `(current)` when an entry refers to the active context (matches `Server: Switch to runkit (current)` and `Theme: Dark (current)` patterns)
3. Use `…` ellipsis when the action opens a follow-up picker/dialog (matches `Window: Set Color`, `Session: Rename` … wait, those don't use ellipsis; review codebase pattern. Actually: existing palette uses no ellipsis even for dialog-opening actions. Drop the ellipses to match — `Board: Pin Current Window`, `Board: Reorder Pane`)
4. Conditional entries follow the same `...(condition ? [...] : [])` spread pattern visible in `sessionActions` and `windowActions`
5. Dynamic per-board entries follow the same `...boards.map(...)` pattern as `serverActions` switch-to-X entries

**Final palette ordering** in `paletteActions`: `[...sessionActions, ...windowActions, ...boardActions, ...viewActions, ...themeActions, ...configActions, ...serverActions, ...terminalActions]` — boards are inserted between window and view actions (logically grouped with content-navigation rather than chrome).

### 8. Active-board indication in Sessions tree

When viewing `/board/<name>`, modify `window-row.tsx` to subtly highlight (e.g., colored left border, or background tint) windows that are pinned to the current board. This provides a visual link between the sidebar and the main board view.

The highlight is **scoped to the current board** — pins to other boards don't trigger the highlight. The pin icon (filled/unfilled state) is independent and reflects "pinned to ANY board."

### 9. Pane focus & keyboard interaction

- **Click-to-focus** — clicking a pane card sends focus to its xterm
- **Hover-to-focus is OFF by default in v1** to avoid accidental keystroke retargeting when mousing across the board. May be added later as a per-board toggle if requested. <!-- clarified: hover-to-focus off by default -->
- **Keyboard cycling** — `Cmd+[` / `Cmd+]` cycle focus across panes in left-right order. Add to keybindings registry.
- **Visual focus indication** — focused pane has a distinct border/glow; unfocused panes are visibly de-emphasized
- **Single-pane keyboard input** — typing only goes to the focused pane (xterm-level, naturally enforced)

### 10. SSE-driven auto-unpin and board updates

Pinned windows can die (window killed, session killed, server killed). Stale entries in `@rk_board` should be cleaned up. Multi-device sync (the reason we picked tmux storage) needs SSE-driven board-state push.

**SSE event shape**: extend the existing per-server SSE stream with a new `board_changed` event type. <!-- clarified: SSE extension over new endpoint -->

```json
{
  "type": "board_changed",
  "board": "main",
  "change": "pin" | "unpin" | "reorder" | "cleanup",
  "server": "runkit",
  "window_id": "@1234",
  "order_key": "bm"
}
```

When the frontend is viewing a board that spans multiple servers, it opens SSE connections for each contributing server (existing per-server SSE infrastructure handles this; multiple concurrent SSE connections are already supported for the dashboard view).

**Two-tier stale cleanup**:
1. **Eager** — SSE per-server polling already detects window kills. When a kill is detected, scan `@rk_board` for the killed `window_id` and remove it. Emit `board_changed` with `change: "cleanup"`.
2. **Lazy** — when reading `@rk_board` in `GetBoard`, intersect with current `list-windows -a` results. Drop stale entries; write back the cleaned list. Belt-and-suspenders for the case where a kill happened while no SSE poller was active.

### 11. Mobile adaptation

Horizontal scroll with fixed-width 480px panes does not fit a 375px screen. Mobile board view uses a **single-pane swipe carousel**: one pane fills the viewport, swipe left/right cycles through pinned panes in board order. Drag-to-resize is disabled on mobile (one pane, viewport-width). Pin order = swipe order. <!-- clarified: mobile uses swipe carousel -->

Implementation notes:
- Detect viewport via existing `coarse:` Tailwind variant or `min-width: 640px` breakpoint per existing project conventions
- Pinned panes still render lazily — only the visible pane has an active WebSocket; off-screen panes pause their WebSocket and resume on swipe-in (mirrors how the desktop board may want to handle large pin counts in v1.1)
- Active pane indicator: small dot pagination strip at the bottom or top of the carousel

## Affected Memory

- `run-kit/architecture.md`: (modify) — Add `/board/$name` route to URL space; add board feature to navigation overview
- `run-kit/tmux-sessions.md`: (modify) — Add `@rk_board` server-scoped option section: format, distributed storage model, cross-server union pattern, lazy stale-cleanup, lexicographic order keys
- `run-kit/ui-patterns.md`: (modify) — Add sidebar Boards section, top-bar board breadcrumb, board view layout, pin entry points (icon, context menu, palette), active-board highlight in Sessions tree
- `run-kit/board-feature.md`: (new — possibly) — If the board concept warrants its own memory file rather than scattering across three existing files. Decision deferred to hydrate stage.

## Impact

### Backend (Go)

- **New files**: `app/backend/internal/tmux/board.go`, `app/backend/internal/tmux/board_test.go`, `app/backend/api/boards.go`, `app/backend/api/boards_test.go`
- **Modified files**: `app/backend/api/router.go` (route registration), `app/backend/api/sse.go` (board-membership events on window kill)
- **Dependencies**: none new (lexicographic indexing is ~30 lines of pure Go)
- **No database, no migrations** (per Constitution II)

### Frontend (TypeScript/React)

- **New files**:
  - `app/frontend/src/components/board/board-page.tsx` — main board view route component
  - `app/frontend/src/components/board/board-pane.tsx` — single pane card with live xterm
  - `app/frontend/src/components/board/board-header.tsx` — pane header with unpin button
  - `app/frontend/src/components/sidebar/boards-section.tsx` — sidebar board list
  - `app/frontend/src/hooks/use-boards.ts` — board data hook (list + active board)
  - `app/frontend/src/hooks/use-pin-actions.ts` — pin/unpin/reorder mutations
  - `app/frontend/src/api/boards.ts` (or extend `client.ts`) — board API client functions

- **Modified files**:
  - `app/frontend/src/router.tsx` — register `/board/$name` route
  - `app/frontend/src/components/sidebar/index.tsx` — render boards section above sessions
  - `app/frontend/src/components/sidebar/window-row.tsx` — pin icon, active-board highlight
  - `app/frontend/src/app.tsx` — new `boardActions: PaletteAction[]` `useMemo` block; folded into `paletteActions`. Palette component itself (`command-palette.tsx`) unchanged — it's a generic action list, categories are encoded as label prefixes.
  - `app/frontend/src/components/top-bar/breadcrumbs.tsx` (or equivalent) — board breadcrumb mode
  - Tests for each modified file

### Configuration / Constitution alignment

- **No new env vars, no new config files** — board state lives in tmux exclusively
- Aligns with **Constitution II (No Database)** — state derived from tmux
- Aligns with **Constitution VII (Convention Over Configuration)** — no config required
- Adds one route (`/board/$name`) — consistent with **Constitution IV (Minimal Surface Area)**: a curated multi-pane view is a use case existing pages cannot accommodate
- **Constitution V (Keyboard-First)**: every new action reachable via keyboard (Cmd+K palette entries, Cmd+[/Cmd+] focus cycle, sidebar nav)
- **Constitution VI (Tmux Sessions Survive Server Restarts)**: pin state persists with tmux server; survives run-kit server restart

## Open Questions

- **Empty Boards section hint** — when sidebar has Boards section visible but empty (e.g., briefly during board deletion), show "Pin a window to start a board" hint? Or simply hide the section the moment the last board vanishes? Defer to spec.
- **Window ID stability across `move-window`** — confirm `tmux move-window` preserves `window_id` (the `@N` form), only changing `window_index` (the `:N` form). Architecture memory implies yes; verify in spec.
- **Whether boards need their own memory file (`run-kit/board-feature.md`) or fit into the three existing files**. Defer to hydrate.

## Clarifications

### Session 2026-05-07

| # | Question | Resolution |
|---|----------|------------|
| 22, 23 | Pane sizing — fixed 480px or drag-to-resize in v1? | Drag-to-resize in v1, default 480px / min 280px, widths persisted per-board in browser localStorage (intentionally not cross-device) |
| 24 | Hover-to-focus default state? | Off by default; may be added later as a per-board toggle |
| 25, 26 | Mobile board layout? | Single-pane swipe carousel (pin order = swipe order); off-screen panes pause their WebSocket |
| 27 | Board name validation rules? | Slug rules — alphanumeric + hyphen + underscore, 1–32 chars |
| 28 | SSE event shape for board updates? | Extend existing per-server SSE stream with `board_changed` events |
| 29 | Pane header content? | `window-name · server` (server tag necessary because boards span servers) |
| 30 | Cmd+K surface area for boards? | Inspected existing palette (`app.tsx:540-833`) — categories are label prefixes, action groups are `useMemo` blocks. Adding new `boardActions` group with `Board:` prefix entries: switch-to-board (one per board), pin/unpin current window, leave board view, cycle pane focus, reorder pane. Palette component unchanged. |

### Session 2026-05-07 (bulk confirm)

| # | Action | Detail |
|---|--------|--------|
| 15 | Confirmed | — |
| 16 | Changed | "Sidebar icon, command palette, board pane header (right-click menu dropped to reduce blast radius — no existing context-menu pattern in sidebar)" |
| 17 | Confirmed | Note: hover-to-focus had already been removed in earlier clarify (#24); rationale text in row was stale |
| 18 | Confirmed | Auto-resolved per user instruction |
| 19 | Confirmed | Auto-resolved per user instruction |
| 20 | Confirmed | Auto-resolved per user instruction |
| 21 | Confirmed | Auto-resolved per user instruction |

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Storage layer is tmux server-scoped options (`@rk_board`), not browser localStorage | Discussed — user explicitly rejected `localStorage` due to cross-device continuity requirement; tmux is the existing state layer per Constitution II | S:95 R:90 A:90 D:95 |
| 2 | Certain | Distributed storage: each tmux server stores membership only for its own windows | Discussed — user rejected single-designated-server model in favor of distributed; aligns with tmux's natural ownership model | S:95 R:80 A:90 D:90 |
| 3 | Certain | Boards are derived from `@rk_board` membership; no separate `@rk_boards` registry | Discussed — user rejected data duplication; "boards are their members" is the explicit decision | S:95 R:75 A:90 D:95 |
| 4 | Certain | Empty boards are not supported (board materializes on first pin, vanishes on last unpin) | Discussed — user rejected daemon-window and tombstone-ID approaches; ephemeral boards is the explicit design | S:95 R:70 A:90 D:90 |
| 5 | Certain | Columns are visual slots, not state-bearing Kanban columns | Discussed — user accepted "TweetDeck-style" framing over "Kanban" framing | S:90 R:80 A:90 D:95 |
| 6 | Certain | Sidebar "Boards" section placed above Sessions section | Discussed — user explicitly chose "above" | S:100 R:95 A:100 D:100 |
| 7 | Certain | Active-board pinned windows are subtly highlighted in Sessions tree | Discussed — user accepted the visual link | S:95 R:95 A:90 D:95 |
| 8 | Certain | Sidebar Boards section uses one-line hint when empty (under specific conditions) | Discussed — user chose "one-line hint" over "hide entirely" | S:95 R:95 A:90 D:90 |
| 9 | Certain | New route `/board/$name` (peer to `/$session/$window`) | Discussed — chosen over `/$session/$window?board=` and `/board` (single route) for shareability and refresh-stability | S:90 R:60 A:85 D:90 |
| 10 | Certain | Top bar shows board breadcrumb dropdown (`Board ▸ name ▾`) when on a board | Discussed — chosen as mode-switch affordance to complement sidebar discovery | S:90 R:80 A:85 D:90 |
| 11 | Certain | Fixed-width panes (480px default) in horizontally-scrollable container | Discussed — borrowed from closed PR #176; necessary because tmux ~80 col minimum and variable-width with focus-expand creates focus discontinuities | S:90 R:70 A:85 D:90 |
| 12 | Certain | Lexicographic / fractional order keys for cross-server ordering | Discussed — chosen over global integer ordering with renumbering; ~30 lines of well-known algorithm | S:85 R:70 A:85 D:85 |
| 13 | Certain | Lazy stale-entry cleanup at read time + eager cleanup via SSE on window-kill | Discussed — belt-and-suspenders for stale entries | S:85 R:80 A:80 D:80 |
| 14 | Certain | Concurrent-edit handling is last-write-wins; SSE re-broadcast for reconciliation; v1-acceptable | Discussed — user accepted the tradeoff for v1 | S:90 R:60 A:80 D:80 |
| 15 | Certain | Field separator `:` and entry separator `,` for `@rk_board` value format | Clarified — user confirmed | S:95 R:70 A:80 D:75 |
| 16 | Certain | Pin entry points: sidebar icon, command palette, board pane header (right-click context menu dropped to reduce blast radius — no existing context menu pattern in sidebar) | Clarified — user changed: dropped right-click menu | S:95 R:80 A:75 D:75 |
| 17 | Certain | Click-to-focus + Cmd+[/Cmd+] keyboard cycling (hover-to-focus already removed in #24) | Clarified — user confirmed | S:95 R:85 A:80 D:75 |
| 18 | Certain | Each pane is an independent live xterm with its own WebSocket relay | Clarified — user confirmed after explanation (auto-resolved with default) | S:95 R:80 A:85 D:80 |
| 19 | Certain | Backend exposes `/api/boards`, `/api/boards/{name}`, `/api/boards/{name}/{pin,unpin,reorder}` | Clarified — user confirmed after explanation (auto-resolved with default) | S:95 R:75 A:80 D:75 |
| 20 | Certain | New Go file `internal/tmux/board.go` for option I/O + parsing; new `api/boards.go` for HTTP | Clarified — user confirmed after explanation (auto-resolved with default) | S:95 R:80 A:85 D:80 |
| 21 | Certain | No new memory file in v1; modifications spread across architecture / tmux-sessions / ui-patterns | Clarified — user confirmed after explanation (auto-resolved with default) | S:95 R:80 A:75 D:70 |
| 22 | Certain | Default pane width 480px, minimum 280px | Clarified — user confirmed | S:95 R:75 A:60 D:65 |
| 23 | Certain | Drag-to-resize per-pane width is in v1; widths persisted per-board in browser localStorage | Clarified — user chose v1 inclusion with localStorage persistence; cross-device pin state remains in tmux but pane widths are intentionally browser-local view state | S:95 R:80 A:65 D:55 |
| 24 | Certain | Hover-to-focus is OFF by default in v1 | Clarified — user confirmed | S:95 R:90 A:60 D:55 |
| 25 | Certain | Mobile layout: single-pane swipe carousel | Clarified — user confirmed (consolidates with #26) | S:95 R:70 A:55 D:55 |
| 26 | Certain | Mobile carousel: pin order = swipe order; off-screen panes pause WebSocket and resume on swipe-in | Clarified — user confirmed mobile direction; implementation detail captured during clarification | S:95 R:60 A:55 D:55 |
| 27 | Certain | Board name validation: alphanumeric + hyphens + underscores, length 1–32 | Clarified — user confirmed | S:95 R:75 A:75 D:65 |
| 28 | Certain | SSE event shape: extend existing per-server stream with `board_changed` events carrying `{board, change, server, window_id, order_key}` | Clarified — user confirmed | S:95 R:70 A:70 D:60 |
| 29 | Certain | Pane header content: `window-name · server` (compact, server tag necessary because boards span servers) | Clarified — user confirmed | S:95 R:90 A:65 D:65 |
| 30 | Certain | Command palette gets new `Board:` prefix with multiple actions: `Switch to <name>` (one per board), `Pin Current Window`, `Unpin Current Window`, `Leave Board View`, `Cycle Pane Focus →/←`, `Reorder Pane`. Implemented as new `boardActions` `useMemo` block in `app.tsx`; palette component unchanged. | Confirmed via codebase inspection of existing palette pattern (`app.tsx:540-833`) — categories are label prefixes, action groups are `useMemo` blocks concatenated into `paletteActions`. Pattern explicitly matches existing `serverActions` (combines fixed actions + dynamic switch-to-X entries). | S:95 R:80 A:90 D:85 |

30 assumptions (30 certain, 0 confident, 0 tentative, 0 unresolved).
