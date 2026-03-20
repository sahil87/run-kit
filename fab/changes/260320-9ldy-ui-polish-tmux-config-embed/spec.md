# Spec: UI Polish, tmux Config Auto-Create, Embed Restructure, and Keyboard Shortcuts

**Change**: 260320-9ldy-ui-polish-tmux-config-embed
**Created**: 2026-03-20
**Affected memory**: `docs/memory/run-kit/architecture.md` (modify), `docs/memory/run-kit/ui-patterns.md` (modify), `docs/memory/run-kit/tmux-sessions.md` (modify)

## Non-Goals

- Custom prefix key for tmux — the default `Ctrl+B` is explicit in config, no user-configurable prefix
- Showing all tmux built-in keybindings — overlay filters to a curated whitelist only
- Caching keybindings on the frontend — fetch on-demand each time, consistent with "derive state at request time" principle

## UI: Breadcrumb Left-Alignment

### Requirement: Session name text MUST be left-aligned with right-side ellipsis

The `BreadcrumbDropdown` trigger button SHALL use default flex alignment (`justify-start`) so that truncated session names show the beginning of the text with ellipsis on the right, not center-cropped.

#### Scenario: Long session name truncation
- **GIVEN** a session name longer than 7 characters (e.g., `my-project-workspace`)
- **WHEN** the breadcrumb renders the session name with `max-w-[7ch]` and `truncate`
- **THEN** the text starts from the left ("my-proj…") not center-cropped

## Embed: Restructure to `app/backend/build/`

### Requirement: Embedded frontend assets SHALL live in `app/backend/build/`

The Go embed package SHALL be `app/backend/build/embed.go` (package `build`) with `//go:embed all:frontend` exposing `build.Frontend`. The `frontend/` subdirectory contains build output, with `.gitkeep` tracked via gitignore negation.

#### Scenario: Fresh worktree compilation
- **GIVEN** a fresh git clone or worktree with no build output
- **WHEN** `go build ./cmd/run-kit` is run
- **THEN** compilation succeeds because `app/backend/build/frontend/.gitkeep` exists in the embed FS

#### Scenario: Production build
- **GIVEN** `scripts/build.sh` has run the frontend build
- **WHEN** the Go binary is built
- **THEN** `build.Frontend` contains the full Vite output under `frontend/`

### Requirement: SPA handler SHALL import from `run-kit/build` package

`api/spa.go` SHALL use `build.Frontend` and sub into `"frontend"` (not `"dist"`).

#### Scenario: SPA serving in production
- **GIVEN** embedded assets are present
- **WHEN** a non-API request arrives
- **THEN** `spa.go` serves from `fs.Sub(build.Frontend, "frontend")` via `http.FS`

## tmux: Config Auto-Create

### Requirement: Server startup SHALL ensure tmux config exists

`tmux.EnsureConfig()` SHALL write the embedded default `config/tmux.conf` to `~/.run-kit/tmux.conf` if the file does not exist. It SHALL be a no-op if the file already exists.

#### Scenario: First run — config file missing
- **GIVEN** `~/.run-kit/tmux.conf` does not exist
- **WHEN** `run-kit serve` starts
- **THEN** `EnsureConfig()` creates `~/.run-kit/` directory (if needed) and writes the embedded config

#### Scenario: Subsequent run — config file present
- **GIVEN** `~/.run-kit/tmux.conf` already exists (possibly user-modified)
- **WHEN** `run-kit serve` starts
- **THEN** `EnsureConfig()` does nothing — user modifications are preserved

## tmux: Config Flag Scoping

### Requirement: `-f configPath` SHALL only be passed on session creation and config reload

The `-f` flag SHALL NOT be passed on every tmux command. Only `CreateSession` (which may start a new server) and `ReloadConfig` (explicit reload) SHALL include it via `configArgs()`.

#### Scenario: Listing sessions
- **GIVEN** the tmux server is running
- **WHEN** `ListSessions()` is called
- **THEN** the command does NOT include `-f configPath`

#### Scenario: Creating a session
- **GIVEN** a new session is being created (may start the server)
- **WHEN** `CreateSession()` is called
- **THEN** the command includes `-f configPath` via `configArgs()`

## tmux: Enhanced Configuration

### Requirement: tmux config SHALL include agent-optimized defaults

`config/tmux.conf` SHALL set:
- `escape-time 0` — eliminates WebSocket relay lag
- `history-limit 50000` — agents produce large output
- `renumber-windows on` — no gaps when windows close
- `base-index 1` / `pane-base-index 1` — human-friendly numbering
- `prefix C-b` — explicit default prefix key

#### Scenario: WebSocket relay responsiveness
- **GIVEN** the tmux config is loaded on the runkit server
- **WHEN** a key is sent via the WebSocket relay
- **THEN** escape-time 0 ensures no buffering delay

### Requirement: tmux config SHALL include pane and window management keybindings

Beyond the existing byobu-style F2/F3/F4, the config SHALL include:
- `prefix + |` — vertical split (`split-window -h`)
- `prefix + -` — horizontal split (`split-window -v`)
- `Shift+F3` — previous pane (`select-pane -t :.-`)
- `Shift+F4` — next pane (`select-pane -t :.+`)
- `F8` — rename window (`command-prompt -I "#W" "rename-window -- '%%'"`)
- `Shift+F7` — copy/scroll mode (`copy-mode`)

#### Scenario: Pane splitting via prefix key
- **GIVEN** a terminal is connected to a tmux session
- **WHEN** the user presses `Ctrl+B` then `|`
- **THEN** the window splits vertically (side by side)

## UI: Server Dropdown Create Action

### Requirement: Sidebar server dropdown SHALL include a create server action

The server selector dropdown SHALL include a `+ tmux server` button at the top, separated by a divider, matching the breadcrumb dropdown action pattern.

#### Scenario: Creating a server from sidebar
- **GIVEN** the sidebar server dropdown is open
- **WHEN** the user clicks `+ tmux server`
- **THEN** the create server dialog opens (reuses existing command palette dialog)

## UI: Hostname in Bottom Bar

### Requirement: Hostname SHALL be displayed in the bottom bar

The `BottomBar` component SHALL accept an optional `hostname` prop and render it right-aligned in `text-xs text-text-secondary`. Hidden on mobile (`hidden sm:inline`).

#### Scenario: Desktop display
- **GIVEN** a hostname is available from `/api/health`
- **WHEN** the terminal page is rendered on desktop
- **THEN** the hostname appears right-aligned in the bottom bar

#### Scenario: Mobile display
- **GIVEN** a hostname is available
- **WHEN** the terminal page is rendered on mobile (< 640px)
- **THEN** the hostname is hidden

## UI: Bottom Bar Border Alignment

### Requirement: Sidebar footer and bottom bar SHALL have matching heights

Both the sidebar server footer and the terminal bottom bar wrapper SHALL use explicit `h-[48px]` to ensure their `border-t` borders align horizontally.

#### Scenario: Visual alignment
- **GIVEN** the sidebar and terminal column are side by side
- **WHEN** the page renders
- **THEN** the bottom borders of the sidebar footer and terminal bottom bar are at the same vertical position

## UI: Server Label

### Requirement: Sidebar server label SHALL use lowercase "tmux"

The sidebar server selector label SHALL read `tmux server:` (lowercase `tmux` matches official project styling).

#### Scenario: Label rendering
- **GIVEN** the sidebar renders
- **WHEN** the server footer is visible
- **THEN** the label reads "tmux server:" not "Server:"

## Kill Server: Error Handling

### Requirement: Kill server endpoint SHALL handle socket teardown gracefully

`KillServer()` SHALL return nil (success) when the server socket disappears during or after the kill command. The tmux process may exit non-zero when the socket it's killing goes away mid-operation. Additionally, `POST /api/servers/kill` SHALL probe for stale sockets before attempting the kill.

#### Scenario: Server socket gone during kill
- **GIVEN** a tmux server is running
- **WHEN** `KillServer()` executes `tmux -L <name> kill-server`
- **AND** tmux returns non-zero because the socket disappeared
- **THEN** `KillServer()` returns nil (not an error)

#### Scenario: Stale socket
- **GIVEN** a tmux socket file exists but the server process is dead
- **WHEN** `POST /api/servers/kill` is called
- **THEN** the stale socket is cleaned up without error

## UI: Dropdown Density

### Requirement: All dropdowns SHALL use consistent density

All dropdowns (breadcrumb, server selector) SHALL use `text-sm py-2` styling for items, matching the top-bar breadcrumb dropdown density.

#### Scenario: Sidebar server dropdown density
- **GIVEN** the sidebar server dropdown is open
- **WHEN** items render
- **THEN** each item uses `text-sm py-2` (not a different density)

## API: Keyboard Shortcuts Endpoint

### Requirement: Backend SHALL expose a keybindings endpoint

`GET /api/keybindings` SHALL run `tmux -L <server> list-keys` on the active tmux server (from `?server=` param), parse the output, and return only bindings matching a curated whitelist.

#### Scenario: Fetching keybindings
- **GIVEN** the runkit tmux server is running with the default config
- **WHEN** `GET /api/keybindings?server=runkit` is called
- **THEN** the response is a JSON array of objects:
  ```json
  [
    { "key": "F2", "table": "root", "command": "new-window", "label": "New window" },
    { "key": "|", "table": "prefix", "command": "split-window -h", "label": "Split vertically" }
  ]
  ```

#### Scenario: Filtering to whitelist only
- **GIVEN** the tmux server has ~50+ default prefix bindings
- **WHEN** `GET /api/keybindings` is called
- **THEN** only bindings with a friendly label in the whitelist are returned (no `prefix + D`, `prefix + x`, etc.)

#### Scenario: Prefix key display
- **GIVEN** a binding is in the `prefix` key table
- **WHEN** the response is assembled
- **THEN** the `table` field is `"prefix"` (frontend renders as `Ctrl+B, <key>`)

#### Scenario: No tmux server running
- **GIVEN** the specified tmux server is not running
- **WHEN** `GET /api/keybindings` is called
- **THEN** the endpoint returns `200` with an empty array `[]`

### Requirement: Whitelist SHALL serve as both filter and label source

The backend SHALL maintain a map of tmux command patterns to human-friendly labels. A `list-keys` entry is included in the response if and only if its command matches a whitelist entry. The same map provides the `label` field.

Whitelist entries:
| Command pattern | Label |
|----------------|-------|
| `new-window` | New window |
| `previous-window` | Previous window |
| `next-window` | Next window |
| `split-window -h` | Split vertically |
| `split-window -v` | Split horizontally |
| `select-pane -t :.-` | Previous pane |
| `select-pane -t :.+` | Next pane |
| `copy-mode` | Scroll / copy mode |
| `command-prompt` ... `rename-window` | Rename window |

## UI: Keyboard Shortcuts Modal

### Requirement: Command palette SHALL include a "Keyboard Shortcuts" action

A new command palette action labeled "Keyboard Shortcuts" SHALL fetch `GET /api/keybindings` and display the results in a modal overlay.

#### Scenario: Opening the shortcuts modal
- **GIVEN** the user is on any page
- **WHEN** the user opens Cmd+K and selects "Keyboard Shortcuts"
- **THEN** a modal opens showing the filtered keybindings

### Requirement: Shortcuts modal SHALL group bindings by key table

Bindings from the `prefix` table SHALL be displayed as `Ctrl+B, <key>`. Bindings from the `root` table SHALL be displayed as just `<key>`. The modal SHALL also include the app-level `Cmd+K` shortcut (hardcoded, not from tmux).

#### Scenario: Mixed binding display
- **GIVEN** the modal is open with both root and prefix bindings
- **WHEN** the user views the list
- **THEN** root bindings show `F2` / `Shift+F3` etc., prefix bindings show `Ctrl+B, |` / `Ctrl+B, -` etc.

### Requirement: Shortcuts modal SHALL fetch on-demand

The keybindings SHALL be fetched each time the modal opens. No caching. Loading state shown while fetching.

#### Scenario: Fresh fetch on each open
- **GIVEN** the user closed and reopened the shortcuts modal
- **WHEN** the modal opens
- **THEN** a new `GET /api/keybindings` request is made

## Deprecated Requirements

### `-f` flag on every tmux command
**Reason**: tmux only reads `-f` when starting a new server. Passing it on every command is unnecessary and can fail if the config doesn't exist.
**Migration**: `configArgs()` helper, used only in `CreateSession()` and `ReloadConfig()`.

## Design Decisions

1. **`list-keys` + whitelist over parsing `tmux.conf`**: Chosen to keep state derived at request time (constitution principle). The whitelist doubles as the label map — if a command has no label, it's excluded.
   - *Why*: Consistent with run-kit's "no persistent state" principle. Always reflects actual tmux state.
   - *Rejected*: Parsing `tmux.conf` directly — would drift if user modifies config outside run-kit.

2. **Explicit `Ctrl+B` prefix over no prefix**: Making the default explicit in the config file documents the choice and makes it easy to find and change.
   - *Why*: Users interacting via xterm.js rarely need a prefix key, but documenting the choice avoids confusion.
   - *Rejected*: Custom prefix (Ctrl+A, Ctrl+Space) — adds friction for rare SSH-in case.

3. **`h-[48px]` explicit height for bottom bar alignment**: Both sidebar footer and terminal bottom bar get matching explicit heights rather than relying on content-based sizing.
   - *Why*: Content-based heights led to 1-2px misalignment from different padding/content combinations.
   - *Rejected*: Shared CSS variable — over-engineering for two elements.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Remove `justify-center` from breadcrumb trigger | Confirmed from intake #1 — user showed screenshot, fix is CSS-only | S:95 R:90 A:95 D:95 |
| 2 | Certain | Move embed to `app/backend/build/` package | Confirmed from intake #2 — user evaluated alternatives, chose `build/` | S:95 R:80 A:90 D:95 |
| 3 | Certain | Track `.gitkeep` via gitignore negation | Confirmed from intake #3 — user chose option 1 over build tags | S:90 R:85 A:90 D:90 |
| 4 | Certain | Auto-create tmux config on serve startup | Confirmed from intake #4 — user chose auto-create over conditional skip | S:90 R:80 A:85 D:90 |
| 5 | Certain | Pass `-f` only on CreateSession and ReloadConfig | Confirmed from intake #5 — tmux only reads `-f` on server start | S:90 R:75 A:90 D:90 |
| 6 | Certain | Add `+ tmux server` to sidebar dropdown | Confirmed from intake #6 — reuses existing create server dialog | S:90 R:90 A:90 D:95 |
| 7 | Certain | Show hostname in bottom bar, hidden on mobile | Confirmed from intake #7 — explicit mobile-hide requirement | S:90 R:90 A:85 D:90 |
| 8 | Certain | Explicit `h-[48px]` on both bottom bars | Confirmed from intake #8 — user measured pixel heights | S:95 R:90 A:90 D:95 |
| 9 | Certain | Use lowercase `tmux` in server label | Confirmed from intake #9 — official styling is lowercase | S:90 R:95 A:95 D:95 |
| 10 | Certain | Dropdown density: `text-sm py-2` for all | Confirmed from intake #10 — user tested both densities | S:85 R:90 A:85 D:85 |
| 11 | Certain | Kill server handles socket teardown gracefully | Upgraded from intake Tentative — codebase shows `KillServer()` already returns nil on socket-gone | S:85 R:70 A:85 D:80 |
| 12 | Certain | Use `list-keys` + whitelist for keybindings | Confirmed from intake #12 — user chose dynamic approach filtered by friendly-label map | S:95 R:90 A:90 D:95 |
| 13 | Certain | Fetch keybindings on-demand, no caching | Confirmed from intake #13 — aligns with "derive state at request time" | S:85 R:95 A:90 D:90 |
| 14 | Certain | tmux config: escape-time 0, history-limit 50000, renumber-windows, base-index 1 | User approved all high-value agent-specific settings during discussion | S:95 R:90 A:90 D:95 |
| 15 | Certain | tmux config: prefix+|/-, S-F3/S-F4, F8, S-F7 keybindings | User specified each binding explicitly during discussion, including Ctrl+F2 browser limitation workaround | S:95 R:90 A:90 D:95 |
| 16 | Certain | Keybindings response includes `table` field for prefix/root distinction | Frontend uses this to render `Ctrl+B, <key>` vs bare `<key>` — straightforward from `list-keys` output | S:90 R:95 A:90 D:95 |

16 assumptions (16 certain, 0 confident, 0 tentative, 0 unresolved).
