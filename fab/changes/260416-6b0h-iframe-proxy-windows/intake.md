# Intake: Iframe Proxy Windows

**Change**: 260416-6b0h-iframe-proxy-windows
**Created**: 2026-04-16
**Status**: Draft

## Origin

> Conversational exploration via `/fab-discuss`. User proposed extending run-kit to view hosted web pages/servers running on different ports, using the Go backend as a reverse proxy. Discussion covered interception strategies (path-based proxy, response rewriting, subdomain routing, service worker injection), then deep-dived into the state model: how to represent iframe windows alongside terminal windows without introducing a database, using tmux user-defined options as the state layer. Further discussion covered reactivity (SSE polling picks up `@rk_url` changes from Claude or other processes) and a browser-like URL bar for bidirectional URL editing.

## Why

Run-kit currently renders only terminal windows (xterm.js connected to tmux panes via WebSocket/pty). Agents frequently spawn web servers (Vite dev servers, API docs, dashboards) on local ports that users want to view alongside their terminal sessions. Today users must manually open a separate browser tab and track which port maps to which agent — losing the unified session context that run-kit provides.

Adding iframe-based proxy windows lets users view any locally-running web page inside a run-kit window, managed through the same session/window model, with the same keyboard navigation and command palette. The tmux pane backing the iframe window can run the actual server process, so killing the window kills the server — natural lifecycle management with zero new infrastructure.

## What Changes

### 1. Reverse Proxy (Go Backend)

Add a path-based reverse proxy at `/proxy/{port}/*` using Go's `httputil.ReverseProxy`.

- Route pattern: `/proxy/{port}/{path...}` → `http://localhost:{port}/{path...}`
- Must handle WebSocket upgrade (`Connection: Upgrade`) so proxied apps with WebSocket connections work transparently
- One `ReverseProxy` instance per target port (can be created on-demand and cached)
- Timeouts consistent with constitution (5-10s for typical requests, longer for WebSocket upgrades)
- Port parameter must be validated (numeric, reasonable range) before proxying — no open redirect to arbitrary hosts
- Simple HTML response rewriting: scan HTML responses and rewrite `http://localhost:{port}` and `//localhost:{port}` references in `src`, `href`, `action` attributes to `/proxy/{port}/...` paths. Implemented via `ModifyResponse` on `ReverseProxy`. Does not cover URLs constructed in JavaScript (acceptable gap for v1)

### 2. Tmux User-Defined Options as State

Use tmux's `@`-prefixed user-defined window options to store window type metadata:

```bash
# Set window type and URL
tmux set-option -w -t @session:window @rk_type "iframe"
tmux set-option -w -t @session:window @rk_url "http://localhost:8080/docs"

# Read back
tmux show-option -wv -t @session:window @rk_type
```

| Option | Values | Purpose |
|--------|--------|---------|
| `@rk_type` | `iframe`, `xvnc`, or unset | Determines what the frontend renders |
| `@rk_url` | Full URL string | The URL to load in the iframe (proxied through `/proxy/{port}/...`) |

When `@rk_type` is unset (default), the window renders as a terminal — backward compatible with all existing windows.

### 3. Backend API Changes

The existing `GET /api/sessions/{session}/windows` endpoint must include `@rk_type` and `@rk_url` in its response by adding `#{@rk_type}` and `#{@rk_url}` to the `tmux list-windows -F` format string.

Window response schema additions:

```json
{
  "name": "api-docs",
  "index": 2,
  "rk_type": "iframe",
  "rk_url": "http://localhost:8080/docs"
}
```

New endpoint for URL updates from the frontend:

```
PUT /api/sessions/{session}/windows/{window}/url
Body: { "url": "http://localhost:8080/new-path" }
```

This endpoint runs `tmux set-option -w -t {session}:{window} @rk_url "{url}"` and returns 200. The SSE stream confirms the change on the next poll cycle.

### 4. SSE Reactivity

The existing SSE polling mechanism already detects window state changes. By including `@rk_type` and `@rk_url` in the polled format string, any change to these values (whether by a user via the API, by Claude via `tmux set-option`, or by any other process) is automatically pushed to the frontend.

No new polling loop or transport needed — this rides the existing SSE stream.

### 5. Frontend Rendering Branch

The main content area switches renderer based on `window.rk_type`:

```
rk_type === undefined  → xterm.js terminal (current behavior, unchanged)
rk_type === "iframe"   → <iframe> + URL bar chrome
rk_type === "xvnc"     → future: noVNC client (out of scope for this change)
```

### 6. URL Bar Chrome

A thin browser-like toolbar above the iframe:

```
┌─────────────────────────────────────────────────────┐
│  ↻  │ http://localhost:8080/docs        │ ⏎ │ >_ │
├─────────────────────────────────────────────────────┤
│                                                     │
│                    iframe                           │
│                                                     │
└─────────────────────────────────────────────────────┘
```

Components:
- **Refresh button** (↻) — re-sets iframe `src` to force reload
- **URL input field** — shows current `@rk_url`, editable, submits on Enter
- **Submit indicator** (⏎) — visual affordance for Enter-to-navigate
- **Terminal toggle button** (>_) — switches the window to terminal mode

Behavior:
- User edits URL → `PUT /api/.../url` → tmux `@rk_url` updated → SSE confirms
- Claude/process changes `@rk_url` → SSE pushes new value → URL bar text updates
- Frontend must not re-set iframe `src` if the URL hasn't actually changed (avoids unnecessary reloads)

### 7. Window Creation Flow

Users create iframe windows via the command palette:

1. Command palette action: "New iframe window" (or similar)
2. Prompts for: window name, URL
3. Executes: `tmux new-window -n "{name}" \; set-option -w @rk_type iframe \; set-option -w @rk_url "{url}"`
4. The new window appears in the sidebar, SSE picks it up, frontend renders the iframe

The tmux pane for the iframe window can optionally run the backing server process. If the user creates an iframe window pointing at an already-running server, the pane sits idle (just a shell).

### 8. Iframe/Terminal Toggle

Each iframe window can be toggled between iframe and terminal mode. Toggling changes only `@rk_type` — `@rk_url` is preserved so the URL survives round-trips.

```
iframe mode:  @rk_type="iframe"  @rk_url="http://localhost:8080"
                ↕ toggle
terminal mode: @rk_type=""        @rk_url="http://localhost:8080"  (preserved)
```

Toggle triggers:
1. **URL bar button** (`>_`) — visible in iframe mode, switches to terminal
2. **URL banner** — in terminal mode, when `@rk_url` is set, a clickable banner shows the URL with a `</>` icon; clicking switches back to iframe
3. **Command palette** — "Window: Switch to Terminal" / "Window: Switch to Iframe" (label adapts to current mode)

Backend: `PUT /api/sessions/{session}/windows/{index}/type` with `{"rkType": "iframe"}` to set or `{"rkType": ""}` to unset. SSE propagates the change.

## Affected Memory

- `run-kit/architecture`: (modify) Add proxy layer and iframe window type to architecture documentation
- `run-kit/ui-patterns`: (modify) Add URL bar chrome and iframe rendering patterns

## Impact

- **Backend**: New proxy handler in `api/`, new URL update endpoint, new type update endpoint, modified window list response to include `@rk_type` and `@rk_url`
- **Frontend**: New iframe renderer component, URL bar component with terminal toggle, rendering branch in window view, iframe-available banner in terminal mode, command palette actions for creating and toggling iframe windows
- **Internal/tmux**: Extended `list-windows` format string to include user-defined options
- **Existing behavior**: Zero changes to terminal window rendering — `@rk_type` unset means terminal, fully backward compatible

## Open Questions

- Should there be a visual indicator in the sidebar distinguishing iframe windows from terminal windows (icon, color, badge)?

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Path-based reverse proxy (`/proxy/{port}/*`) as the proxying strategy | Discussed — user agreed on simplest approach first; subdomain routing and service worker injection rejected as too complex for the use case | S:90 R:85 A:90 D:90 |
| 2 | Certain | Tmux user-defined options (`@rk_type`, `@rk_url`) as state model | Discussed — preserves constitution principle II (no database), survives server restarts (principle VI), single source of truth | S:95 R:80 A:95 D:95 |
| 3 | Certain | Tmux pane runs the backing server process for lifecycle management | Discussed — kill window kills server, no orphan cleanup needed | S:85 R:80 A:90 D:90 |
| 4 | Certain | No auto-detection of listening ports | Discussed — user explicitly said no auto-detect; users configure full URLs manually | S:95 R:90 A:85 D:95 |
| 5 | Certain | User configures full URL (not just port) | Discussed — user confirmed this approach | S:95 R:85 A:85 D:90 |
| 6 | Certain | Existing SSE polling picks up `@rk_url` changes for reactivity | Discussed — no new transport, rides existing SSE stream, ~1s latency acceptable | S:90 R:85 A:90 D:90 |
| 7 | Certain | Browser-like URL bar above iframe for bidirectional URL editing | Discussed — user proposed this; serves as type indicator too | S:90 R:85 A:80 D:85 |
| 8 | Certain | Proxy only to localhost (no remote host proxying) | Clarified — user confirmed; non-localhost requests can be made by the browser directly, no proxy needed | S:95 R:70 A:85 D:80 |
| 9 | Certain | Command palette as the creation flow for iframe windows | Clarified — user confirmed | S:95 R:85 A:80 D:75 |
| 10 | Certain | xvnc rendering is out of scope for this change | Clarified — user confirmed | S:95 R:90 A:75 D:80 |
| 11 | Certain | URL bar is minimal — refresh + URL input only, no back/forward | Clarified — user confirmed minimal approach | S:95 R:80 A:65 D:55 |
| 12 | Certain | Simple HTML response rewriting in v1 — rewrite localhost URLs in HTML attributes (src, href, action) to proxy paths; JS-constructed URLs not covered | Clarified — user chose Level 1 (HTML rewriting) over no rewriting or full VS Code style <!-- clarified: simple HTML response rewriting via ModifyResponse on ReverseProxy --> | S:95 R:75 A:70 D:50 |

12 assumptions (12 certain, 0 confident, 0 tentative, 0 unresolved).

## Clarifications

### Session 2026-04-16 (bulk confirm)

| # | Action | Detail |
|---|--------|--------|
| 8 | Confirmed | Non-localhost requests can be made by the browser directly |
| 9 | Confirmed | — |
| 10 | Confirmed | — |

### Session 2026-04-16 (taxonomy)

| # | Action | Detail |
|---|--------|--------|
| 11 | Confirmed | Minimal URL bar — refresh + URL input, no back/forward |
| 12 | Changed | "Simple HTML response rewriting in v1 — rewrite localhost URLs in HTML attributes via ModifyResponse" |
