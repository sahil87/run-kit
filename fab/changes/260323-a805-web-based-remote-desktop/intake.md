# Intake: Web-Based Remote Desktop

**Change**: 260323-a805-web-based-remote-desktop
**Created**: 2026-03-23
**Status**: Draft

## Origin

> User asked about web-friendly alternatives to NoMachine for remote desktop. After discussing options (Guacamole, Kasm, RustDesk, Selkies, neko, noVNC, Xpra), the conversation shifted to integrating desktop streaming directly into run-kit alongside existing tmux terminal windows. A detailed architectural discussion followed, establishing the stack (noVNC + Xvfb + x11vnc), the lifecycle model (tmux-managed VNC servers), and the integration pattern (same WebSocket proxy approach as the terminal relay).

Interaction mode: conversational — multiple rounds of discussion before `/fab-new`.

## Why

run-kit currently streams tmux terminal windows to the browser via xterm.js. This covers CLI-based agent orchestration well, but some workflows require a graphical desktop — browser testing, GUI applications, visual debugging, or running tools that have no CLI equivalent.

Without this, users must maintain a separate remote desktop solution (NoMachine, VNC client, etc.) alongside run-kit, fragmenting their workflow across two tools with different auth, different URLs, and no shared session model.

Adding desktop streaming into run-kit's existing session/window model means users get terminals and desktops in the same UI, managed by the same tmux lifecycle, navigable via the same sidebar and command palette. The approach reuses run-kit's core architectural patterns (WebSocket relay, SSE state, tmux process management) rather than bolting on a separate system.

## What Changes

### Backend: Desktop Window Lifecycle

A "desktop window" is a tmux window whose process is a VNC server stack instead of a shell. The lifecycle:

1. **Create**: Unified window creation endpoint (`POST /api/sessions/{session}/windows` with `type: "desktop"`) spins up a new tmux window running a shell script that starts:
   - `Xvfb :N -screen 0 {width}x{height}x24` — virtual framebuffer (default 1920x1080)
   - The user's installed window manager/desktop environment — detected via `x-session-manager`, `$XDG_CURRENT_DESKTOP`, or common WM lookup in `$PATH`. If nothing found, bare X11 (no WM)
   - `x11vnc -display :N -rfbport {port} -nopw -forever -shared` with `-websocket` or `-websocketport` for direct WebSocket support
   - Display number and VNC port allocated dynamically at creation time (Go `net.Listen(":0")` trick) to avoid collisions

2. **State**: Window appears in `tmux list-windows` like any other window. The naming convention `desktop:{label}` identifies it as a desktop type. The SSE session stream includes `type: "desktop"` for these windows.

3. **Destroy**: Killing the tmux window kills the entire process tree (Xvfb + WM + x11vnc). Same as terminal windows — no special cleanup.

4. **Survive restarts**: tmux owns the processes, so desktops survive Go server restarts (constitution VI).

### Backend: Unified WebSocket Relay

The existing `/relay/{session}/{window}` route detects window type server-side (from the `desktop:` naming convention) and branches:

- **Terminal windows**: existing PTY relay behavior (unchanged)
- **Desktop windows**: WebSocket-to-WebSocket proxy to the x11vnc WebSocket port

```go
// Desktop branch in handleRelay:
// 1. Detect window type from name prefix
// 2. Look up the VNC port for this session:window (from tmux window env or process inspection)
// 3. Dial the local x11vnc WebSocket
// 4. Bidirectional copy (goroutines)
// 5. Cleanup on disconnect
```

Key difference from terminal path: no PTY involved. This is a WebSocket-to-WebSocket proxy. The existing `upgrader` and cleanup patterns apply. Single relay route keeps API surface minimal (constitution IV).

### Backend: Window Type Detection

`internal/tmux/tmux.go` `ListWindows()` already parses `#{window_name}`. Add a `Type` field to `WindowInfo`:

```go
type WindowInfo struct {
    // ... existing fields ...
    Type string // "terminal" or "desktop"
}
```

Derived from window name: if `strings.HasPrefix(name, "desktop:")` then `Type = "desktop"`, else `Type = "terminal"`. The `desktop:` prefix is the sole discriminator — convention over configuration (constitution VII).

### Backend: SSE State Extension

The SSE session stream (`api/sse.go`) already sends window metadata. Add `type` field to the per-window JSON. Frontend uses this to decide which renderer to use.

### Backend: Unified Window Creation

The existing `POST /api/sessions/{session}/windows` endpoint gains an optional `type` field (`"terminal"` default, `"desktop"`). When `type: "desktop"`:
1. Dynamically allocates a free port (VNC) and derives a display number
2. Creates a tmux window named `desktop:{label}` in the target session
3. Sends the startup script to the window via `send-keys` (Xvfb → WM detection → x11vnc)
4. Returns the window index (same response shape as terminal creation)

### Frontend: noVNC Integration

Add `@novnc/novnc` npm package. Create a `DesktopClient` component (parallel to `TerminalClient`) that:

1. Reads `type` from the window metadata (via SSE/sessions context)
2. If `type === "desktop"`: renders noVNC canvas with `scaleViewport: true` (scales to fit container, maintains aspect ratio), connects to the existing `/relay/{session}/{window}` WebSocket endpoint
3. If `type === "terminal"`: renders xterm.js (existing behavior)

The switch happens in `app.tsx` where the terminal/dashboard branch currently lives:

```tsx
{sessionName && windowIndex ? (
  windowType === "desktop" ? <DesktopClient /> : <TerminalClient />
) : (
  <Dashboard />
)}
```

**Scaling behavior**: The VM display stays at its fixed native resolution. noVNC's `scaleViewport` scales the output to fit the browser viewport with correct aspect ratio. On mobile, the desktop is letterboxed/pillarboxed to fit. No server-side resize needed — pure client-side scaling.

### Frontend: Desktop Controls

Desktop windows need controls that terminals don't:
- **Clipboard sync** — noVNC supports clipboard events; wire to a paste/copy flow
- **Resolution picker** — command palette action to change the VM's native resolution (restarts Xvfb at new size). Not dynamic resize — user explicitly selects a resolution
- Potentially a **fullscreen** toggle

These controls render in the bottom bar (or top bar) when a desktop window is active, replacing the terminal-specific controls (Ctrl, Alt, Tab, arrow keys, etc.).

### Frontend: Desktop Creation UX

Desktop windows are created from three places (all call the same unified endpoint with `type: "desktop"`):
1. **Window breadcrumb dropdown** — `+ New Desktop` action item alongside existing `+ New Window`
2. **Dashboard session cards** — `+ New Desktop` button alongside existing `+ New Window`
3. **Command palette** (`Cmd+K`) — "New Desktop Window" action (primary discovery, constitution V)

### Frontend: Dashboard Cards

Desktop windows appear in the dashboard alongside terminal windows. The window card shows a desktop icon or badge to distinguish type. Clicking navigates to `/:session/:window` which renders the noVNC viewer.

## Affected Memory

- `run-kit/architecture`: (modify) Add desktop streaming architecture — VNC proxy handler, desktop lifecycle, display/port allocation
- `run-kit/tmux-sessions`: (modify) Document desktop window type, `desktop:` naming convention, VNC process lifecycle within tmux
- `run-kit/ui-patterns`: (modify) Document DesktopClient component, window type switching, desktop-specific controls

## Impact

**Backend files**:
- `api/relay.go` — add desktop branch (VNC WebSocket proxy) alongside existing PTY relay
- `api/windows.go` — extend window creation handler to accept `type: "desktop"`
- `api/sse.go` — include `type` field in window data
- `internal/tmux/tmux.go` — `WindowInfo.Type` field, type detection from window name

**Frontend files**:
- `src/components/desktop-client.tsx` — new noVNC wrapper component
- `src/app.tsx` — window type switch (DesktopClient vs TerminalClient)
- `src/api/client.ts` — desktop creation API call
- `src/components/dashboard.tsx` — desktop badge on window cards
- `src/components/bottom-bar.tsx` — desktop-specific controls when desktop window active

**Dependencies**:
- `@novnc/novnc` — frontend npm package
- System: `Xvfb`, `x11vnc` — must be installed on the host. Window manager optional (uses whatever user has installed)

**API surface** (no new routes — extends existing):
- `POST /api/sessions/{session}/windows` — gains `type: "desktop"` parameter
- `WS /relay/{session}/{window}` — auto-detects desktop windows, branches to VNC proxy
- SSE: `type` field added to window objects

## Open Questions

All original open questions have been resolved via `/fab-clarify`. See Clarifications section below.

## Clarifications

### Session 2026-03-23

| # | Action | Detail |
|---|--------|--------|
| Q1 | Resolved | WM: use whatever user has installed — detect via `x-session-manager`, `$XDG_CURRENT_DESKTOP`, WM lookup in PATH. Bare X11 if nothing found |
| Q2 | Resolved | API: unified endpoints — `type` param on existing window creation, relay auto-detects window type server-side |
| Q3 | Resolved | Desktop creation UX: breadcrumb dropdown + dashboard button + command palette (all three) |
| Q4 | Resolved | Resolution: fixed at creation (default 1920x1080), noVNC `scaleViewport` for client-side scaling with aspect ratio. Command palette action to change resolution |
| Q5 | Resolved | Port/display: dynamic allocation via `net.Listen(":0")` |
| Q6 | Resolved | Multiple desktops per session: allowed, no artificial limit |

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use noVNC (`@novnc/novnc`) for frontend desktop rendering | Discussed — user chose noVNC after evaluating Guacamole, Kasm, RustDesk, Selkies, neko. noVNC mirrors the xterm.js pattern (JS library, WebSocket, canvas) | S:95 R:60 A:90 D:90 |
| 2 | Certain | Use Xvfb + x11vnc as the VNC server stack | Discussed — Xvfb provides virtual framebuffer, x11vnc exposes it over VNC with WebSocket support. Standard, well-tested stack | S:90 R:65 A:85 D:85 |
| 3 | Certain | Manage VNC server lifecycle via tmux windows | Discussed — a desktop window is a tmux window whose process is the VNC stack. Preserves constitution II (no database), VI (survives restarts), III (wrap don't reinvent) | S:95 R:70 A:95 D:95 |
| 4 | Confident | Use `desktop:` window name prefix for type discrimination | Discussed — convention over configuration (constitution VII). Specific prefix proposed but exact format not explicitly confirmed by user | S:80 R:85 A:85 D:75 |
| 5 | Certain | WebSocket proxy pattern mirrors existing terminal relay | Discussed — same upgrade/proxy/cleanup pattern as relay.go, but WebSocket-to-WebSocket instead of WebSocket-to-PTY | S:90 R:80 A:90 D:90 |
| 6 | Certain | Same `/$session/$window` route renders noVNC or xterm.js based on type | Discussed — same chrome, same navigation, just the content area swaps based on window type | S:90 R:80 A:90 D:90 |
| 7 | Confident | SSE stream adds `type` field to window objects | Follows from architecture — SSE already sends window metadata, type is a natural extension. Not explicitly discussed but architecturally obvious | S:70 R:90 A:90 D:90 |
| 8 | Certain | Unified window creation — `type` param on existing `POST /api/sessions/{session}/windows` | Clarified — user chose unified over separate endpoint. Keeps API surface minimal (constitution IV) | S:95 R:85 A:85 D:95 |
<!-- clarified: Unified window creation endpoint — user explicitly chose this over separate desktop endpoint -->
| 9 | Certain | Unified relay route — `/relay/{session}/{window}` auto-detects window type | Clarified — user chose unified over separate route. Server-side type detection, single route | S:95 R:85 A:85 D:95 |
<!-- clarified: Unified relay route — user explicitly chose this over separate desktop relay route -->
| 10 | Certain | Software rendering (Xvfb) for initial implementation | Clarified — user confirmed. GPU support deferred to future work | S:95 R:80 A:60 D:65 |
<!-- clarified: Software rendering confirmed — GPU deferred -->
| 11 | Certain | No VNC-level authentication (rely on run-kit access controls) | Clarified — user confirmed. Consistent with current run-kit security posture | S:95 R:70 A:55 D:60 |
<!-- clarified: No VNC auth confirmed — matches existing posture -->
| 12 | Certain | Use user's installed WM/DE — no prescribed dependency | Clarified — detect via `x-session-manager`, `$XDG_CURRENT_DESKTOP`, PATH lookup. Bare X11 fallback | S:95 R:85 A:90 D:95 |
<!-- clarified: WM detection, not prescription — user explicitly requested this -->
| 13 | Certain | Fixed resolution with client-side scaling via noVNC `scaleViewport` | Clarified — VM stays at native resolution (default 1920x1080), browser scales with aspect ratio. Works on mobile via letterboxing. Command palette action to change resolution | S:95 R:80 A:85 D:90 |
<!-- clarified: Fixed resolution + scaleViewport — user explicitly requested scaling with aspect ratio -->
| 14 | Certain | Dynamic port/display allocation | Clarified — `net.Listen(":0")` to find free ports. Avoids collisions in shared environments | S:95 R:85 A:85 D:95 |
<!-- clarified: Dynamic allocation confirmed over convention-based -->
| 15 | Certain | Multiple desktop windows per session allowed | Clarified — no artificial limit, same as terminal windows | S:95 R:90 A:90 D:95 |
<!-- clarified: Multiple desktops confirmed — no limit -->
| 16 | Certain | Desktop creation from 3 UI locations: breadcrumb dropdown, dashboard card, command palette | Clarified — all three trigger same unified endpoint with `type: "desktop"` | S:95 R:85 A:90 D:95 |
<!-- clarified: Three creation entry points confirmed -->

16 assumptions (14 certain, 2 confident, 0 tentative, 0 unresolved).
