# Spec: Web-Based Remote Desktop

**Change**: 260323-a805-web-based-remote-desktop
**Created**: 2026-03-23
**Affected memory**: `docs/memory/run-kit/architecture.md`, `docs/memory/run-kit/tmux-sessions.md`, `docs/memory/run-kit/ui-patterns.md`

## Non-Goals

- GPU-accelerated rendering (virtual GPU, VirtualGL) — software rendering via Xvfb is sufficient for initial scope
- VNC-level authentication — run-kit has no auth layer; desktop windows match existing security posture
- Prescribing a specific window manager — run-kit detects and uses whatever the user has installed
- Dynamic server-side resolution resize on browser window change — client-side scaling handles this

## Backend: Window Type Detection

### Requirement: Window type derived from naming convention

The tmux package SHALL derive window type from the window name prefix. Windows whose name starts with `desktop:` SHALL have `Type: "desktop"`. All other windows SHALL have `Type: "terminal"`. The `desktop:` prefix is the sole discriminator (constitution VII — convention over configuration).

#### Scenario: Desktop window detected
- **GIVEN** a tmux window with name `desktop:dev`
- **WHEN** `ListWindows()` parses the window list
- **THEN** the returned `WindowInfo` has `Type: "desktop"`
- **AND** `Name` is `desktop:dev`

#### Scenario: Terminal window unchanged
- **GIVEN** a tmux window with name `zsh`
- **WHEN** `ListWindows()` parses the window list
- **THEN** the returned `WindowInfo` has `Type: "terminal"`

### Requirement: WindowInfo struct includes Type field

`WindowInfo` in `internal/tmux/tmux.go` SHALL include a `Type string` field with JSON tag `json:"type"`. The field SHALL be populated by `parseWindows()` based on the `desktop:` prefix check.

#### Scenario: Type field serialized in JSON
- **GIVEN** a `WindowInfo` with `Type: "desktop"`
- **WHEN** serialized to JSON (for SSE or API responses)
- **THEN** the JSON includes `"type": "desktop"`

## Backend: Desktop Window Lifecycle

### Requirement: Unified window creation supports desktop type

The existing `POST /api/sessions/{session}/windows` endpoint SHALL accept an optional `type` field in the request body. When `type` is `"desktop"`, the handler SHALL create a desktop window. When `type` is absent or `"terminal"`, existing behavior is unchanged.

#### Scenario: Create desktop window
- **GIVEN** a valid session `devshell` on server `runkit`
- **WHEN** `POST /api/sessions/devshell/windows` with body `{"name": "dev", "type": "desktop"}`
- **THEN** a tmux window named `desktop:dev` is created in session `devshell`
- **AND** a startup script is sent to the window via `send-keys` that launches Xvfb, detects and starts WM, and starts x11vnc
- **AND** response is `201 {"ok": true}` (same shape as terminal creation)

#### Scenario: Create terminal window (unchanged)
- **GIVEN** a valid session `devshell`
- **WHEN** `POST /api/sessions/devshell/windows` with body `{"name": "zsh"}`
- **THEN** existing terminal window creation behavior is unchanged
- **AND** no `type` field defaults to terminal

#### Scenario: Create desktop window with custom resolution
- **GIVEN** a valid session `devshell`
- **WHEN** `POST /api/sessions/devshell/windows` with body `{"name": "hires", "type": "desktop", "resolution": "2560x1440"}`
- **THEN** Xvfb starts with `-screen 0 2560x1440x24`

#### Scenario: Invalid resolution rejected
- **GIVEN** a valid session `devshell`
- **WHEN** `POST /api/sessions/devshell/windows` with body `{"name": "bad", "type": "desktop", "resolution": "foo; rm -rf /"}`
- **THEN** the response is `400 Bad Request` with an error message
- **AND** no tmux window is created

The `resolution` field SHALL be validated against a strict `{width}x{height}` regex (digits only, e.g., `^\d{3,5}x\d{3,5}$`) before use. This prevents shell injection since the resolution value is interpolated into the startup script sent via `send-keys` (constitution I -- security first).
<!-- clarified: resolution validation — resolution is user input interpolated into a shell command via send-keys, so strict validation is mandatory per constitution I -->

### Requirement: Desktop startup script

The desktop startup script sent via `send-keys` SHALL execute these steps in order:

1. Allocate a dynamic display number and VNC port using a helper function
2. Start `Xvfb :N -screen 0 {width}x{height}x24` (default 1920x1080)
3. Set `DISPLAY=:N` for subsequent commands
4. Detect and launch the user's window manager:
   - Check `x-session-manager` in `$PATH`
   - If not found, check `$XDG_CURRENT_DESKTOP` and look up corresponding WM binary
   - If not found, probe common WMs in order: `openbox`, `fluxbox`, `i3`, `xfwm4`, `mutter`, `kwin`
   - If nothing found, skip WM (bare X11)
   - Launch WM in background (`&`)
5. Start `x11vnc -display :N -rfbport {port} -nopw -forever -shared -noxdamage -ws` (the `-ws` flag enables WebSocket on the same VNC port)
<!-- clarified: x11vnc -ws flag — x11vnc uses -ws to enable built-in WebSocket support on the VNC listen port, allowing direct browser-to-x11vnc WebSocket connections -->

#### Scenario: System with Openbox installed
- **GIVEN** a host where `openbox` is in `$PATH` and `x-session-manager` is not
- **WHEN** the desktop startup script runs
- **THEN** Xvfb starts, `openbox` is launched in background, x11vnc starts

#### Scenario: System with no window manager
- **GIVEN** a host with no recognized WM in `$PATH`
- **WHEN** the desktop startup script runs
- **THEN** Xvfb starts, no WM is launched, x11vnc starts (bare X11)

### Requirement: Dynamic port and display allocation

The backend SHALL dynamically allocate VNC ports using Go's `net.Listen("tcp", ":0")` pattern to find a free port. The display number SHALL be derived from the allocated port. This avoids collisions in multi-user or multi-desktop scenarios.

#### Scenario: Two desktops created concurrently
- **GIVEN** two desktop creation requests arrive simultaneously
- **WHEN** both allocate ports
- **THEN** each gets a unique port and display number with no collision

### Requirement: Desktop window stores VNC port in tmux environment

The desktop startup script SHALL store the VNC port as a tmux window option using `tmux set-option -w -t {session}:{window} @rk_vnc_port {port}`. User options (prefixed with `@`) are supported per-window in tmux. The relay handler reads this via `tmux show-options -wv -t {session}:{window} @rk_vnc_port` to discover the VNC WebSocket endpoint. Session-level `set-environment` is NOT used because it is scoped per-session, not per-window, and would be overwritten when multiple desktops exist in the same session.
<!-- clarified: tmux set-environment is session-scoped, not window-scoped. Multiple desktops per session would collide. Using tmux user window options (@rk_vnc_port via set-option -w) provides true per-window storage. -->

#### Scenario: Relay discovers VNC port
- **GIVEN** a desktop window with `@rk_vnc_port` window option set to `59234`
- **WHEN** the relay handler looks up the VNC port
- **THEN** it reads `@rk_vnc_port` via `tmux show-options -wv` and connects to `ws://localhost:59234`

### Requirement: Desktop window destruction

Killing a desktop window (via existing `POST /api/sessions/{session}/windows/{index}/kill`) SHALL kill the tmux window, which kills the entire process tree (Xvfb + WM + x11vnc). No special cleanup logic is required beyond existing window kill behavior.

#### Scenario: Desktop window killed
- **GIVEN** a desktop window running Xvfb + x11vnc
- **WHEN** the window is killed via the existing kill endpoint
- **THEN** the tmux window is destroyed, taking all child processes with it

## Backend: Unified WebSocket Relay

### Requirement: Relay auto-detects window type

The existing `/relay/{session}/{window}` WebSocket handler SHALL detect the window type by checking the window name from `ListWindows()`. If the target window has `Type: "desktop"`, the handler branches to VNC proxy mode. If `Type: "terminal"`, existing PTY relay behavior is unchanged.

#### Scenario: Relay connects to desktop window
- **GIVEN** a WebSocket connection to `/relay/devshell/2?server=runkit`
- **AND** window 2 in session `devshell` is named `desktop:dev`
- **WHEN** the relay handler processes the connection
- **THEN** it reads `@rk_vnc_port` via `tmux show-options -wv -t {session}:{window}`
- **AND** dials a WebSocket connection to `ws://localhost:{port}`
- **AND** bidirectionally copies data between browser and VNC WebSockets

#### Scenario: Relay connects to terminal window (unchanged)
- **GIVEN** a WebSocket connection to `/relay/devshell/0?server=runkit`
- **AND** window 0 in session `devshell` is named `zsh`
- **WHEN** the relay handler processes the connection
- **THEN** existing PTY relay behavior executes (unchanged)

### Requirement: VNC WebSocket proxy cleanup

When either side (browser or x11vnc) disconnects, the proxy SHALL close both WebSocket connections and release all resources. The cleanup pattern SHALL use `sync.Once` consistent with the existing terminal relay cleanup.

#### Scenario: Browser disconnects from desktop
- **GIVEN** an active VNC proxy connection
- **WHEN** the browser WebSocket closes
- **THEN** the proxy closes the x11vnc WebSocket connection
- **AND** goroutines exit cleanly

## Backend: SSE State Extension

### Requirement: SSE includes window type

The SSE session stream SHALL include the `type` field for each window in the JSON payload. The `type` field is already present on `WindowInfo` via the JSON tag and populated by `parseWindows()`, so SSE automatically includes it without additional changes to `sse.go`.

#### Scenario: SSE delivers desktop window type
- **GIVEN** a session with windows `[{name: "zsh", type: "terminal"}, {name: "desktop:dev", type: "desktop"}]`
- **WHEN** the SSE poll delivers session data
- **THEN** the JSON payload includes `"type": "terminal"` and `"type": "desktop"` on respective windows

## Frontend: noVNC Integration

### Requirement: DesktopClient component

A new `DesktopClient` component (`src/components/desktop-client.tsx`) SHALL render a noVNC canvas for desktop windows. It SHALL use the `@novnc/novnc` package with `scaleViewport: true` to scale the VM display to fit the container while maintaining aspect ratio.

#### Scenario: Desktop window renders noVNC
- **GIVEN** the user navigates to `/:session/:window` where the window type is `"desktop"`
- **WHEN** the component mounts
- **THEN** a noVNC `RFB` instance connects to `/relay/{session}/{window}?server={server}`
- **AND** the canvas scales to fill the available space with correct aspect ratio

#### Scenario: Desktop on mobile
- **GIVEN** a 375px-wide mobile viewport
- **WHEN** viewing a 1920x1080 desktop window
- **THEN** noVNC scales the output to fit with letterboxing/pillarboxing
- **AND** the aspect ratio is preserved

### Requirement: Window type switch in app.tsx

`app.tsx` SHALL check the `type` field from the current window's metadata and render `DesktopClient` for desktop windows or `TerminalClient` for terminal windows. The bottom bar SHALL be hidden for desktop windows (terminal-specific controls are not applicable).

#### Scenario: Route to desktop window
- **GIVEN** the user navigates to `/devshell/2` where window 2 has `type: "desktop"`
- **WHEN** the route renders
- **THEN** `DesktopClient` is rendered instead of `TerminalClient`
- **AND** the terminal bottom bar is not rendered

#### Scenario: Route to terminal window (unchanged)
- **GIVEN** the user navigates to `/devshell/0` where window 0 has `type: "terminal"`
- **WHEN** the route renders
- **THEN** `TerminalClient` is rendered (unchanged behavior)
- **AND** the terminal bottom bar is rendered

## Frontend: Desktop Controls

### Requirement: Desktop bottom bar

When a desktop window is active, a desktop-specific bottom bar SHALL replace the terminal bottom bar. It SHALL include:
- **Clipboard paste** button — pastes clipboard text into the VNC session
- **Resolution picker** — dropdown or command palette action to change VM resolution
- **Fullscreen** toggle — enters/exits browser fullscreen for the desktop area

#### Scenario: Clipboard paste into desktop
- **GIVEN** the user has text on their clipboard and a desktop window is active
- **WHEN** the user clicks the clipboard paste button
- **THEN** the clipboard text is sent to the VNC session via noVNC's clipboard API

### Requirement: Resolution change via command palette

The command palette SHALL include a "Change desktop resolution" action when a desktop window is active. Selecting it SHALL present resolution options (e.g., 1280x720, 1920x1080, 2560x1440). The selected resolution SHALL be sent to the backend via `POST /api/sessions/{session}/windows/{index}/resolution` with body `{"resolution": "2560x1440"}`. The handler SHALL send a shell script to the tmux window via `send-keys` that kills the existing Xvfb and x11vnc, then restarts them at the new resolution (reusing the same display number and port from the `@rk_vnc_port` window option).
<!-- clarified: resolution change API endpoint — follows existing pattern of POST to /api/sessions/{session}/windows/{index}/... The restart script reuses the existing display/port rather than reallocating -->

#### Scenario: Change resolution
- **GIVEN** a desktop window running at 1920x1080
- **WHEN** the user selects "Change desktop resolution" -> "2560x1440" from the command palette
- **THEN** `POST /api/sessions/{session}/windows/{index}/resolution` is called with `{"resolution": "2560x1440"}`
- **AND** the backend sends a restart script to the tmux window that kills Xvfb+x11vnc and relaunches at 2560x1440
- **AND** the frontend noVNC session reconnects and scales the new resolution

## Frontend: Desktop Creation UX

### Requirement: Three creation entry points

Desktop windows SHALL be creatable from three UI locations, all triggering the same API call (`POST /api/sessions/{session}/windows` with `type: "desktop"`):

1. Window breadcrumb dropdown — `+ New Desktop` action item
2. Dashboard session cards — `+ New Desktop` button
3. Command palette — "New Desktop Window" action

#### Scenario: Create desktop from command palette
- **GIVEN** the user has session `devshell` active
- **WHEN** they open the command palette and select "New Desktop Window"
- **THEN** a desktop window is created in session `devshell`
- **AND** the user navigates to the new desktop window

#### Scenario: Create desktop from breadcrumb dropdown
- **GIVEN** the user is viewing session `devshell`
- **WHEN** they click the window breadcrumb and select `+ New Desktop`
- **THEN** a desktop window is created in session `devshell`

#### Scenario: Create desktop from dashboard
- **GIVEN** the user is on the dashboard with session `devshell` expanded
- **WHEN** they click `+ New Desktop`
- **THEN** a desktop window is created in session `devshell`

## Frontend: Dashboard Cards

### Requirement: Desktop badge on window cards

Dashboard window cards for desktop windows SHALL display a visual indicator (icon or badge) to distinguish them from terminal windows. The badge SHALL use the existing `bg-accent/10 text-accent` styling pattern.

#### Scenario: Desktop card in dashboard
- **GIVEN** a session with both terminal and desktop windows
- **WHEN** the dashboard renders the session's window cards
- **THEN** desktop windows show a "Desktop" badge
- **AND** terminal windows show no special badge (unchanged)

## Design Decisions

1. **Unified relay route over separate desktop route**: Single `/relay/{session}/{window}` handles both types
   - *Why*: Keeps API surface minimal (constitution IV). The server already knows the window type from the naming convention, so the client doesn't need to specify it.
   - *Rejected*: Separate `/relay/{session}/{window}/desktop` — adds API surface for no functional gain

2. **Unified window creation over separate endpoint**: `type` parameter on existing endpoint
   - *Why*: Same API shape, same response, just adds a field. Avoids new route registration.
   - *Rejected*: `POST /api/sessions/{session}/desktop` — duplicates validation/error handling

3. **VNC port stored in tmux user window option**: The relay discovers VNC port via `tmux show-options -wv -t {session}:{window} @rk_vnc_port`
   - *Why*: Fits the "state from tmux" constitution principle (II). No file-based state needed. The startup script sets it; the relay reads it. Uses per-window user options (`@` prefix) instead of session-scoped `set-environment` to support multiple desktops per session without collisions.
   - *Rejected*: `set-environment` — session-scoped, overwrites when multiple desktops exist in same session. PID file with port, separate port registry — adds state management complexity.
<!-- clarified: switched from set-environment to set-option -w with @rk_vnc_port for per-window scoping -->

4. **Client-side scaling via noVNC scaleViewport**: VM resolution is fixed; browser scales
   - *Why*: Avoids server-side `xrandr` complexity. Works on any screen size including mobile. Same mental model as NoMachine/RDP.
   - *Rejected*: Dynamic server-side resize — fragile with rapid browser resize events, apps reflow constantly

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use noVNC (`@novnc/novnc`) for frontend desktop rendering | Confirmed from intake #1 — user chose noVNC after evaluating alternatives | S:95 R:60 A:90 D:90 |
| 2 | Certain | Use Xvfb + x11vnc as VNC server stack | Confirmed from intake #2 — standard, well-tested stack | S:90 R:65 A:85 D:85 |
| 3 | Certain | Manage VNC lifecycle via tmux windows | Confirmed from intake #3 — preserves constitution II, VI, III | S:95 R:70 A:95 D:95 |
| 4 | Certain | `desktop:` window name prefix for type discrimination | Upgraded from intake Confident #4 — only viable convention, no alternatives needed | S:90 R:85 A:85 D:90 |
| 5 | Certain | Unified relay route auto-detects window type | Confirmed from intake #9 — server knows window type from naming convention | S:95 R:85 A:85 D:95 |
| 6 | Certain | Same `/$session/$window` route, type-switched renderer | Confirmed from intake #6 | S:90 R:80 A:90 D:90 |
| 7 | Certain | SSE includes `type` field via WindowInfo JSON tag | Confirmed from intake #7 — automatic from struct tag, no SSE code changes | S:95 R:90 A:95 D:95 |
| 8 | Certain | Unified window creation with `type` parameter | Confirmed from intake #8 | S:95 R:85 A:85 D:95 |
| 9 | Certain | Software rendering (Xvfb) only | Confirmed from intake #10 | S:95 R:80 A:60 D:65 |
| 10 | Certain | No VNC-level auth | Confirmed from intake #11 | S:95 R:70 A:55 D:60 |
| 11 | Certain | User's installed WM/DE, no prescribed dependency | Confirmed from intake #12 — detect via standard mechanisms | S:95 R:85 A:90 D:95 |
| 12 | Certain | Fixed resolution + client-side scaleViewport | Confirmed from intake #13 | S:95 R:80 A:85 D:90 |
| 13 | Certain | Dynamic port/display allocation | Confirmed from intake #14 | S:95 R:85 A:85 D:95 |
| 14 | Certain | Multiple desktops per session, no limit | Confirmed from intake #15 | S:95 R:90 A:90 D:95 |
| 15 | Certain | Three desktop creation entry points | Confirmed from intake #16 | S:95 R:85 A:90 D:95 |
| 16 | Certain | VNC port stored in tmux user window option (`@rk_vnc_port` via `set-option -w`) | Spec-level decision — fits constitution II (state from tmux). Relay reads `@rk_vnc_port` from `tmux show-options -wv`. Uses per-window options instead of session-scoped `set-environment` to support multiple desktops per session | S:85 R:80 A:90 D:85 |
| 17 | Confident | Desktop startup script as shell script sent via send-keys | Follows existing window creation pattern. Script is inline, not a separate file. May need adjustment for robustness | S:75 R:80 A:80 D:75 |
| 18 | Confident | Bottom bar hidden for desktop windows, desktop-specific controls shown | Terminal controls (Ctrl/Alt/Tab) not applicable to desktop. Need desktop-specific bar | S:80 R:85 A:80 D:80 |

18 assumptions (16 certain, 2 confident, 0 tentative, 0 unresolved).
