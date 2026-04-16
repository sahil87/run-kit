# Spec: Iframe Proxy Windows

**Change**: 260416-6b0h-iframe-proxy-windows
**Created**: 2026-04-16
**Affected memory**: `docs/memory/run-kit/architecture.md`, `docs/memory/run-kit/ui-patterns.md`

## Non-Goals

- xvnc rendering — future feature, not part of this change
- Auto-detection of listening ports — users configure URLs explicitly
- Remote host proxying — proxy targets localhost only
- Response rewriting in JavaScript — only HTML attribute rewriting in v1
- Back/forward navigation history in the URL bar

## Backend: Reverse Proxy

### Requirement: Path-Based Reverse Proxy

The Go backend SHALL expose a reverse proxy at `/proxy/{port}/{path...}` that forwards requests to `http://localhost:{port}/{path...}`. The proxy MUST be implemented using Go's `httputil.ReverseProxy` in a new file `app/backend/api/proxy.go`.

The `{port}` parameter MUST be validated as a numeric value in range 1–65535 before proxying. Invalid port values SHALL return `400 Bad Request`.

The proxy MUST handle WebSocket upgrade requests (`Connection: Upgrade` header) transparently so proxied applications with WebSocket connections work through the proxy.

In development, the Vite dev server config (`app/frontend/vite.config.ts`) MUST add a proxy rule for `/proxy` to forward to the Go backend, alongside the existing `/api` and `/relay` rules. Without this, `/proxy/*` requests hit Vite's SPA fallback in dev mode.
<!-- clarified: Vite dev proxy for /proxy/* — existing proxy rules cover /api and /relay but not /proxy; pattern is clear from vite.config.ts -->

One `ReverseProxy` instance per target port SHOULD be cached (created on-demand) to avoid per-request allocation.
<!-- clarified: no cache eviction needed — expected port count is single-digit; sync.Map entries are negligible -->

#### Scenario: Successful Proxy Request
- **GIVEN** a dev server running on `localhost:8080` serving `/docs`
- **WHEN** a request is made to `/proxy/8080/docs`
- **THEN** the response from `localhost:8080/docs` is returned to the client

#### Scenario: WebSocket Upgrade Through Proxy
- **GIVEN** a dev server on `localhost:3000` with a WebSocket endpoint at `/ws`
- **WHEN** the client sends a request to `/proxy/3000/ws` with `Connection: Upgrade` header
- **THEN** the proxy upgrades the connection and relays WebSocket frames bidirectionally

#### Scenario: Invalid Port
- **GIVEN** a request to `/proxy/abc/path` or `/proxy/99999/path`
- **WHEN** the proxy handler validates the port parameter
- **THEN** `400 Bad Request` is returned with `{"error": "invalid port"}`

#### Scenario: Target Server Not Running
- **GIVEN** no server is running on `localhost:9999`
- **WHEN** a request is made to `/proxy/9999/`
- **THEN** the proxy returns `502 Bad Gateway` (standard `ReverseProxy` behavior)

### Requirement: HTML Response Rewriting

The proxy SHALL rewrite `localhost:{port}` references in HTML responses to route through the proxy path. This applies to `src`, `href`, and `action` attributes in HTML elements.

The rewriting MUST be implemented via `ModifyResponse` on the `ReverseProxy` instance. Rewriting SHALL only apply to responses with `Content-Type` containing `text/html`. If the response has `Content-Encoding: gzip`, the rewriter MUST decompress before scanning, rewrite, and re-compress (or strip the encoding header and let the client handle uncompressed). Dev servers commonly gzip HTML responses.
<!-- clarified: gzip handling required — Go's ReverseProxy does not auto-decompress, so ModifyResponse receives compressed bytes; without decompression the regex/string replacement would silently fail on gzip'd HTML -->

The rewriter SHALL replace:
- `http://localhost:{port}` → `/proxy/{port}`
- `//localhost:{port}` → `/proxy/{port}`
- `http://127.0.0.1:{port}` → `/proxy/{port}`
- `//127.0.0.1:{port}` → `/proxy/{port}`

URLs constructed in JavaScript are NOT rewritten (acceptable v1 gap).

#### Scenario: HTML With Absolute localhost Links
- **GIVEN** a proxied HTML response from port 8080 containing `<a href="http://localhost:8080/api">`
- **WHEN** the response passes through `ModifyResponse`
- **THEN** the response contains `<a href="/proxy/8080/api">`

#### Scenario: Non-HTML Response Passthrough
- **GIVEN** a proxied response with `Content-Type: application/json`
- **WHEN** the response passes through `ModifyResponse`
- **THEN** the response body is unchanged

## Backend: Tmux State Model

### Requirement: User-Defined Window Options

Window type metadata SHALL be stored using tmux's `@`-prefixed user-defined window options. Two options are used:

| Option | Values | Purpose |
|--------|--------|---------|
| `@rk_type` | `"iframe"`, or unset | Determines frontend renderer |
| `@rk_url` | Full URL string | The URL to load in the iframe |

When `@rk_type` is unset (default), the window MUST render as a terminal — fully backward compatible with all existing windows.

#### Scenario: Terminal Window (Default)
- **GIVEN** a tmux window with no `@rk_type` set
- **WHEN** the frontend queries window metadata
- **THEN** `rkType` is empty and the window renders as a terminal (xterm.js)

#### Scenario: Iframe Window
- **GIVEN** a tmux window with `@rk_type` set to `"iframe"` and `@rk_url` set to `"http://localhost:8080/docs"`
- **WHEN** the frontend queries window metadata
- **THEN** `rkType` is `"iframe"` and `rkUrl` is `"http://localhost:8080/docs"`

### Requirement: Extended ListWindows Format String

The `ListWindows` function in `app/backend/internal/tmux/tmux.go` SHALL include `#{@rk_type}` and `#{@rk_url}` in its format string, appending them as additional fields to the existing 7-field format.

The `WindowInfo` struct SHALL gain two new fields:
```go
RkType string `json:"rkType,omitempty"` // "iframe" or empty
RkUrl  string `json:"rkUrl,omitempty"`  // URL for iframe windows
```

The `parseWindows` function SHALL parse the two new fields from the extended format string. Empty values (when tmux options are unset) SHALL result in empty strings (Go zero value).

#### Scenario: Parsing Mixed Window Types
- **GIVEN** a tmux session with 3 windows: terminal, iframe (localhost:8080/docs), terminal
- **WHEN** `ListWindows` is called
- **THEN** the returned `[]WindowInfo` has `RkType=""` for windows 0 and 2, `RkType="iframe"` and `RkUrl="http://localhost:8080/docs"` for window 1

## Backend: API

### Requirement: URL Update Endpoint

A new endpoint SHALL be added:

```
PUT /api/sessions/{session}/windows/{index}/url
Body: { "url": "<url>" }
```

This endpoint SHALL:
1. Validate the session name and window index
2. Run `tmux set-option -w -t {session}:{window} @rk_url "{url}"` on the target server
3. Return `200 {"ok": true}`

The URL value MUST be non-empty after trimming. Empty URLs SHALL return `400 Bad Request`.

#### Scenario: Update Iframe URL
- **GIVEN** an iframe window at session "dev", index 2
- **WHEN** `PUT /api/sessions/dev/windows/2/url` with `{"url": "http://localhost:8080/new-path"}`
- **THEN** tmux option `@rk_url` is set to the new URL and `200 {"ok": true}` is returned

#### Scenario: Empty URL Rejected
- **GIVEN** a request to update window URL
- **WHEN** the body contains `{"url": ""}`
- **THEN** `400 Bad Request` is returned

### Requirement: Window Response Schema Extension

The `GET /api/sessions` response SHALL include `rkType` and `rkUrl` fields on each window object. These are populated from the extended `ListWindows` format string. Empty values are omitted from JSON via `omitempty`.

#### Scenario: Sessions Response With Iframe Window
- **GIVEN** a session with one terminal window and one iframe window
- **WHEN** `GET /api/sessions` is called
- **THEN** the terminal window has no `rkType`/`rkUrl` fields; the iframe window has `"rkType": "iframe"` and `"rkUrl": "http://localhost:8080/docs"`

## Backend: SSE Reactivity

### Requirement: Automatic Change Propagation

The existing SSE polling mechanism SHALL automatically detect changes to `@rk_type` and `@rk_url` because these are included in the `ListWindows` format string. No new polling loop or transport is required.

Any change to `@rk_url` (whether by the API endpoint, by Claude via `tmux set-option`, or by any other process) SHALL be pushed to the frontend on the next SSE poll cycle (~2.5s).

#### Scenario: URL Changed by External Process
- **GIVEN** an iframe window with `@rk_url = "http://localhost:8080/docs"`
- **WHEN** Claude runs `tmux set-option -w -t dev:2 @rk_url "http://localhost:8080/api"`
- **THEN** the frontend receives the updated URL within the next SSE poll cycle

## Frontend: Window Rendering

### Requirement: Rendering Branch

The main content area in `app.tsx` SHALL switch renderer based on the window's `rkType`:

- `rkType` undefined/empty → xterm.js terminal (current behavior, unchanged)
- `rkType === "iframe"` → `<IframeWindow>` component with URL bar chrome

The rendering branch MUST be in the existing conditional in `app.tsx` where `TerminalClient` is rendered.

#### Scenario: Terminal Window Rendering
- **GIVEN** navigating to `/{server}/{session}/{window}` where the window has no `rkType`
- **WHEN** the component renders
- **THEN** `TerminalClient` (xterm.js) is rendered as before

#### Scenario: Iframe Window Rendering
- **GIVEN** navigating to `/{server}/{session}/{window}` where the window has `rkType === "iframe"`
- **WHEN** the component renders
- **THEN** `IframeWindow` component is rendered with the URL bar and iframe

### Requirement: IframeWindow Component

A new component `app/frontend/src/components/iframe-window.tsx` SHALL render:

1. A URL bar toolbar above the iframe
2. An `<iframe>` element filling the remaining space (`flex-1`)

The iframe `src` MUST be set from the window's `rkUrl`. The component MUST NOT re-set iframe `src` if the URL has not actually changed (avoids unnecessary reloads when SSE pushes identical data).

#### Scenario: URL Unchanged on SSE Tick
- **GIVEN** an iframe window showing `http://localhost:8080/docs`
- **WHEN** SSE pushes window data with the same `rkUrl`
- **THEN** the iframe is NOT reloaded

#### Scenario: URL Changed via SSE
- **GIVEN** an iframe window showing `http://localhost:8080/docs`
- **WHEN** SSE pushes window data with `rkUrl = "http://localhost:8080/api"`
- **THEN** the iframe `src` updates and the page reloads to the new URL

## Frontend: URL Bar Chrome

### Requirement: URL Bar Component

The URL bar SHALL be a thin toolbar rendered above the iframe:

- **Refresh button** (↻) — re-sets iframe `src` to force reload
- **URL input field** — shows current `rkUrl`, editable, submits on Enter
- **Submit indicator** (⏎) — visual affordance

Styling SHALL follow existing chrome conventions: `border-b border-border`, `text-text-secondary` for controls, `bg-bg-primary` background.

#### Scenario: User Edits URL
- **GIVEN** the URL bar showing `http://localhost:8080/docs`
- **WHEN** the user changes the URL to `http://localhost:8080/api` and presses Enter
- **THEN** `PUT /api/sessions/{session}/windows/{index}/url` is called with the new URL
- **AND** the iframe navigates to the new URL after SSE confirmation

#### Scenario: Refresh Button
- **GIVEN** an iframe showing a page
- **WHEN** the user clicks the refresh button
- **THEN** the iframe reloads the current URL

#### Scenario: External URL Update
- **GIVEN** the URL bar showing `http://localhost:8080/docs`
- **WHEN** an external process changes `@rk_url` and SSE pushes the update
- **THEN** the URL bar text updates to the new URL

## Frontend: Window Creation

### Requirement: Command Palette Action

A new command palette action "Window: New Iframe Window" SHALL be added. This action SHALL:

1. Prompt for window name (text input) and URL (text input)
2. Execute: `tmux new-window -n "{name}" \; set-option -w @rk_type iframe \; set-option -w @rk_url "{url}"` via a new API endpoint or by composing existing API calls

The action MUST appear in the command palette alongside existing window actions.

#### Scenario: Create Iframe Window via Palette
- **GIVEN** the user opens the command palette with Cmd+K
- **WHEN** the user selects "Window: New Iframe Window", enters name "api-docs" and URL "http://localhost:8080/docs"
- **THEN** a new tmux window is created with `@rk_type=iframe` and `@rk_url` set
- **AND** the sidebar shows the new window, and the frontend renders the iframe

### Requirement: Create Iframe Window API

A new backend endpoint SHALL support creating iframe windows:

```
POST /api/sessions/{session}/windows
Body: { "name": "api-docs", "rkType": "iframe", "rkUrl": "http://localhost:8080/docs" }
```

The existing `handleWindowCreate` in `app/backend/api/windows.go` SHALL be extended to accept optional `rkType` and `rkUrl` fields. When `rkType` is `"iframe"`:
1. Create the window via `tmux new-window -n "{name}"`
2. Set `@rk_type` via `tmux set-option -w -t {session}:{window} @rk_type iframe`
3. Set `@rk_url` via `tmux set-option -w -t {session}:{window} @rk_url "{url}"`

When `rkType` is empty or absent, behavior is unchanged (standard terminal window).

The three tmux commands (new-window, set @rk_type, set @rk_url) MUST be executed as a single `\;`-chained tmux invocation to avoid a race where the SSE poll sees the window before its metadata is set.
<!-- clarified: atomicity via tmux command chaining — intake already specified this pattern; the API section's step-by-step listing is the logical sequence, not separate subprocess calls -->

#### Scenario: Create Iframe Window via API
- **GIVEN** a session "dev" exists
- **WHEN** `POST /api/sessions/dev/windows` with `{"name": "docs", "rkType": "iframe", "rkUrl": "http://localhost:8080"}`
- **THEN** a new window is created with iframe metadata set
- **AND** SSE picks up the new window with `rkType` and `rkUrl`

## Frontend: API Client

### Requirement: New API Functions

The API client (`app/frontend/src/api/client.ts`) SHALL add:

1. `updateWindowUrl(session, index, url)` → `PUT /api/sessions/{session}/windows/{index}/url`
2. Extend `createWindow` signature to accept optional `rkType` and `rkUrl` parameters

#### Scenario: Update URL Client Call
- **GIVEN** an iframe window at session "dev", index 2
- **WHEN** `updateWindowUrl("dev", 2, "http://localhost:8080/new")` is called
- **THEN** a PUT request is sent with `{"url": "http://localhost:8080/new"}`

## Frontend: Types

### Requirement: WindowInfo Type Extension

The `WindowInfo` type in `app/frontend/src/types.ts` SHALL gain:

```typescript
rkType?: string;  // "iframe" or undefined
rkUrl?: string;   // URL for iframe windows
```

These are optional fields — terminal windows omit them (backward compatible).

## Design Decisions

1. **Path-based proxy over subdomain routing**: `/proxy/{port}/*` keeps all traffic on one origin, avoiding CORS complexity and DNS configuration. Subdomain routing (`port8080.localhost`) would require wildcard DNS or hosts file entries.
   - *Rejected*: Subdomain routing — requires DNS/hosts setup, complex CORS
   - *Rejected*: Service worker injection — fragile, hard to debug

2. **Tmux user-defined options over external state**: `@rk_type` and `@rk_url` as tmux window options preserve constitution principle II (no database) and VI (sessions survive restarts). State is co-located with the tmux window lifecycle.
   - *Rejected*: Database/config file — violates constitution, separate lifecycle from window
   - *Rejected*: Window name encoding — fragile, limits window naming

3. **Extend existing create endpoint over new endpoint**: Adding optional `rkType`/`rkUrl` to `POST /api/sessions/{session}/windows` reuses the existing creation flow. The frontend already calls this endpoint, and the backend can conditionally set tmux options when `rkType` is present.
   - *Rejected*: Separate `POST .../windows/iframe` endpoint — unnecessary surface area, breaks the convention that window creation is one endpoint

4. **Simple HTML rewriting over no rewriting**: `ModifyResponse` scans HTML responses and replaces localhost URLs in `src`/`href`/`action` attributes. Catches the common case (static HTML links) without the complexity of full JS/CSS rewriting.
   - *Rejected*: No rewriting — breaks common dev servers with absolute URLs
   - *Rejected*: Full response rewriting (JS/CSS) — excessive complexity for v1

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Path-based reverse proxy (`/proxy/{port}/*`) | Confirmed from intake #1 — user agreed, simplest approach | S:95 R:85 A:90 D:90 |
| 2 | Certain | Tmux user-defined options (`@rk_type`, `@rk_url`) as state | Confirmed from intake #2 — preserves constitution principles II/VI | S:95 R:80 A:95 D:95 |
| 3 | Certain | Tmux pane runs backing server for lifecycle management | Confirmed from intake #3 — kill window kills server | S:95 R:80 A:90 D:90 |
| 4 | Certain | No auto-detection of listening ports | Confirmed from intake #4 — users configure full URLs | S:95 R:90 A:85 D:95 |
| 5 | Certain | User configures full URL (not just port) | Confirmed from intake #5 | S:95 R:85 A:85 D:90 |
| 6 | Certain | Existing SSE polling picks up `@rk_url` changes | Confirmed from intake #6 — no new transport | S:95 R:85 A:90 D:90 |
| 7 | Certain | Browser-like URL bar above iframe | Confirmed from intake #7 — user proposed this | S:95 R:85 A:80 D:85 |
| 8 | Certain | Proxy only to localhost | Confirmed from intake #8 — browser can make non-localhost requests directly | S:95 R:70 A:85 D:80 |
| 9 | Certain | Command palette as creation flow | Confirmed from intake #9 — constitution principle V | S:95 R:85 A:80 D:75 |
| 10 | Certain | xvnc out of scope | Confirmed from intake #10 | S:95 R:90 A:75 D:80 |
| 11 | Certain | Minimal URL bar — refresh + URL input, no back/forward | Confirmed from intake #11 — user confirmed | S:95 R:80 A:65 D:55 |
| 12 | Certain | Simple HTML response rewriting in v1 | Confirmed from intake #12 — user chose Level 1 (HTML attributes only) | S:95 R:75 A:70 D:50 |
| 13 | Certain | Extend existing create endpoint with optional rkType/rkUrl | Codebase signal — `handleWindowCreate` already accepts JSON body with name/cwd; adding optional fields is the minimal-surface-area approach per constitution IV | S:85 R:90 A:90 D:85 |
| 14 | Certain | New fields use `omitempty` JSON tags | Codebase pattern — existing optional fields (FabChange, FabStage, AgentState) use omitempty; terminal windows produce no extra payload | S:90 R:95 A:95 D:95 |
| 15 | Certain | Proxy handler registered in router.go alongside existing routes | Codebase pattern — all routes registered in `NewRouter()`, one handler file per domain | S:90 R:95 A:95 D:95 |
| 16 | Certain | IframeWindow as a new component file | Codebase pattern — components are separate files in `src/components/`; mixing into terminal-client.tsx would bloat that file | S:85 R:90 A:90 D:90 |
| 17 | Confident | Per-port ReverseProxy caching via sync.Map | Performance — avoid allocating a new ReverseProxy on every request; sync.Map is appropriate for concurrent read-heavy access with rare writes. Not explicitly discussed but follows existing caching patterns (pane-map cache) | S:70 R:90 A:85 D:80 |

17 assumptions (16 certain, 1 confident, 0 tentative, 0 unresolved).
