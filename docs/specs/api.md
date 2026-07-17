# run-kit API Specification

> Defines the HTTP, SSE, and WebSocket surface for run-kit's Go backend.
> This is the **target spec** — the source of truth for what the API should be.
> Implementation and tests conform to this document, not the other way around.

---

## Design Principles

1. **POST for all mutations** — every write operation uses POST. Intent communicated by URL path, not HTTP method. Simplifies the client, avoids CORS preflight for non-simple methods.
2. **GET for all reads** — session listing, directory autocomplete, SSE stream, health check.
3. **Consistent error shape** — every error returns `{ "error": "<message>" }` with an appropriate HTTP status.
4. **Validated at the boundary** — all user input validated before reaching tmux; invalid input never touches a subprocess.
5. **No database** — all state derived from tmux + filesystem at request time.
6. **Single port** — API, SSE, WebSocket relay, and SPA static files served on one port.

---

## Base Configuration

| Setting | Default | Override order |
|---------|---------|----------------|
| Port | `3000` | defaults → `run-kit.yaml` (`server.port`) → CLI `-port` |
| Host | `127.0.0.1` | defaults → `run-kit.yaml` (`server.host`) → CLI `-host` |

---

## Middleware

Applied in order to all `/api/*` routes:

1. **CORS** — allow all origins, methods `GET POST OPTIONS`, headers `Accept Authorization Content-Type`, no credentials, 300s max-age
2. **Request logger** — structured log to stderr
3. **Panic recovery** — catches panics, returns 500

---

## Endpoints

### Health

#### `GET /api/health`

Supervisor health check. No authentication.

**Response** `200`:
```json
{ "status": "ok" }
```

---

### Sessions

A session maps 1:1 to a tmux session. Each session is a "project".

#### `GET /api/sessions`

Returns all tmux sessions with their windows, enriched with fab-kit state where detected.

**Response** `200`:
```json
[
  {
    "name": "run-kit",
    "windows": [
      {
        "index": 0,
        "name": "main",
        "worktreePath": "/Users/sahil/code/sahil87/run-kit",
        "activity": "active",
        "isActiveWindow": true,
        "fabChange": "260312-jz77-scaffold-app-structure",
        "fabStage": "review-pr",
        "fabDisplayState": "done"
      }
    ]
  }
]
```

**Window fields:**

| Field | Type | Description |
|-------|------|-------------|
| `index` | `int` | 0-based tmux window index |
| `name` | `string` | Window name |
| `worktreePath` | `string` | Absolute path from `pane_current_path` |
| `activity` | `"active" \| "idle"` | Active if tmux activity within last 10 seconds |
| `isActiveWindow` | `bool` | Whether this is the currently selected tmux window |
| `fabChange` | `string?` | Active change name from `.fab-status.yaml`, omitted if no active change |
| `fabStage` | `string?` | Current active stage (first `active` entry in `.fab-status.yaml` `progress` map), omitted if no active change |
| `fabDisplayState` | `string?` | Pipeline state of the displayed stage from `fab pane map` `display_state` — one of `active`, `ready`, `done`, `failed`, `pending`, `skipped`; omitted when fab reports `null` or the field is absent (fab < 2.1.7) |

**Behavior:**
- Filters out byobu session-group copies (keep where `name == group` or `grouped == 0`)
- Fab enrichment is per-session (not per-window): reads `.fab-status.yaml` once from the project root (window 0's `pane_current_path`). All windows in a session share the same fab state.
- Project root derived from window 0's `pane_current_path`

#### `POST /api/sessions`

Create a new tmux session.

**Request:**
```json
{
  "name": "my-project",
  "cwd": "~/code/my-project"
}
```

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `name` | `string` | yes | Non-empty, max 128 chars, no shell metacharacters (`;& \| \` $ (){}[]<>!#*?`), no colons, no periods, no whitespace control chars |
| `cwd` | `string` | no | Max 1024 chars, must resolve under `$HOME`, supports `~` expansion. Defaults to server CWD if omitted. |

**Response** `201`:
```json
{ "ok": true }
```

**Errors:**
- `400` — validation failure
- `500` — tmux command failed

#### `POST /api/sessions/:session/kill`

Kill an entire tmux session and all its windows.

**URL params:**

| Param | Validation |
|-------|------------|
| `session` | Same name validation as create |

**Response** `200`:
```json
{ "ok": true }
```

**Errors:**
- `400` — invalid session name
- `500` — tmux command failed

---

### Windows

Windows live within a session. They map to tmux windows.

#### `POST /api/sessions/:session/windows`

Create a new window in a session.

**Request:**
```json
{
  "name": "feature-branch",
  "cwd": "~/code/my-project"
}
```

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `name` | `string` | no | When present and non-empty, same rules as session name. Omitted or empty ⇒ tmux auto-names the window to its folder basename via `automatic-rename-format '#{b:pane_current_path}'` (see below). |
| `cwd` | `string` | no | Same rules as session CWD |
| `rkType` | `string` | no | Marks an rk-managed window (e.g. `iframe`). When present, `name` becomes **required** (a non-empty validated name) — see Errors. |
| `rkUrl` | `string` | no | Target URL for an `rkType` window |

**Behavior:**
- **Name is optional.** An omitted or empty `name` (with no `rkType`) creates the window without `-n`, so tmux applies the global `automatic-rename-format '#{b:pane_current_path}'` and the window displays — and live-updates — its pane's folder basename. A non-empty `name` is validated and pins the window (automatic-rename off).
- **`rkType`-present requires a name.** When `rkType` is set, an empty/omitted `name` is rejected (400) so an rk-managed window is never pinned to an empty name with automatic-rename disabled.

**Response** `201`:
```json
{ "ok": true }
```

**Errors:**
- `400` — non-empty `name` fails validation, or `rkType` present with an empty/omitted `name`
- `500` — tmux command failed

#### `POST /api/sessions/:session/windows/:index/kill`

Kill a specific window.

**URL params:**

| Param | Type | Validation |
|-------|------|------------|
| `session` | `string` | Name validation |
| `index` | `int` | Non-negative integer |

**Response** `200`:
```json
{ "ok": true }
```

#### `POST /api/sessions/:session/windows/:index/rename`

Rename a window.

**Request:**
```json
{
  "name": "new-name"
}
```

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `name` | `string` | yes | Same rules as session name |

**Response** `200`:
```json
{ "ok": true }
```

#### `POST /api/sessions/:session/windows/:index/keys`

Send keystrokes to a window.

**Request:**
```json
{
  "keys": "echo hello"
}
```

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `keys` | `string` | yes | Non-empty after trim |

**Behavior:**
- Sends via `tmux send-keys -t {session}:{index} {keys} Enter`

**Response** `200`:
```json
{ "ok": true }
```

---

### Directories

Server-side directory autocomplete for the session creation dialog.

#### `GET /api/directories?prefix=:path`

**Query params:**

| Param | Type | Validation |
|-------|------|------------|
| `prefix` | `string` | Supports `~` expansion, must resolve under `$HOME` |

**Response** `200`:
```json
{
  "directories": ["~/code/sahil87/"]
}
```

**Behavior:**
- If prefix ends with `/`, lists child directories
- Otherwise, matches directory names against the basename prefix
- Skips hidden directories (`.`-prefixed)
- Returns paths with `~/` prefix when under home directory
- Returns empty array on invalid path

---

### File Upload

Upload files to a project's `.uploads/` directory.

#### `POST /api/sessions/:session/upload`

**Content-Type:** `multipart/form-data`

**Form fields:**

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `file` | `file` | yes | Max 50 MB |
| `window` | `string` | no | Integer string, defaults to `"0"` |

**Response** `200`:
```json
{
  "ok": true,
  "path": "/Users/sahil/code/sahil87/run-kit/.uploads/260312-143022-screenshot.png"
}
```

**Behavior:**
- Resolves project root from the target window's `worktreePath`
- Creates `.uploads/` in project root if needed
- Auto-adds `.uploads/` to `.gitignore`
- Filename: `{YYMMDDHHmmss}-{sanitized_name}`
- Sanitization: strip null bytes, replace `/\` with `-`, strip leading dots, remove `..`, collapse dashes

---

### Server-Sent Events

Real-time session state stream.

#### `GET /api/sessions/stream`

**Event format:**
```
event: sessions
data: [{"name":"run-kit","windows":[...]}]
```

**Behavior:**
- Module-level hub singleton manages all connected clients
- Polls `FetchSessions()` every 2500ms (only when clients connected)
- Deduplicates by JSON comparison — only sends on change
- New clients receive the cached snapshot immediately
- 30-minute lifetime cap per connection
- Non-blocking fan-out (drops if client buffer full)

---

### Terminals Mux

A single WebSocket per browser tab carrying ALL pane relay streams (the retired
per-pane `WS /relay/{windowId}` was consolidated onto this mux in
`260717-803u-relay-mux`). A board with N panes holds ONE terminals socket, not N.

#### `WS /ws/terminals`

No URL params — every stream is opened in-band via an `open` control op. Stream
ids are client-allocated `u32`s, unique within a socket connection.

**Wire protocol:**

Binary data frames `[u32 BE streamId][payload]` in both directions (server→client
PTY output, client→server keystrokes). JSON text frames for control:

| Direction | Frame |
|-----------|-------|
| Client → Server | `{"op":"open","id":7,"server":"<tmux server>","windowId":"@42","cols":120,"rows":32}` |
| Client → Server | `{"op":"resize","id":7,"cols":100,"rows":40}` |
| Client → Server | `{"op":"close","id":7}` |
| Server → Client | `{"op":"opened","id":7}` |
| Server → Client | `{"op":"closed","id":7,"code":4004\|4001\|1000,"reason":"..."}` |

**Per-stream lifecycle** (each `open` reproduces the former `handleRelay`
per-connection semantics, per stream):
1. Validate `windowId` (shared `validate.ValidateWindowID`) — a bad id yields a
   per-stream `closed` 4004, never a socket teardown.
2. `ResolveWindowSession` (5s) → session-scoped `SelectWindowInSession` (the
   move-based model: each window lives in exactly one session — home or
   `_rk-pin-*` — and select+attach must agree).
3. `forceTERM` (`TERM=xterm-256color`), best-effort `tmux.ReloadConfig`, then
   `pty.StartWithSize` at the open op's initial `cols`/`rows` (no
   wait-for-first-resize dance).
4. On success: reply `opened` (delivered before the stream's first data frame),
   then pump PTY output as binary data frames.
5. On stream close (client `close` op, PTY EOF, or socket teardown): cancel the
   attach context, close the PTY fd, kill the attach process (`sync.Once`), and
   reply `closed` (1000 graceful).

**Write path:** per-stream bounded send queues (8 × 4096B) drained by a single
writer goroutine scheduling control/short frames ahead of bulk output,
round-robin across ready streams (never FIFO across streams). A full per-stream
queue pauses that stream's PTY reader (backpressure), never dropping bytes.

**Per-stream `closed` codes** (the socket itself stays open for stream-level
failures):
- `4004` — window not found (resolve/select failed) or malformed window id
- `4001` — failed to attach to the tmux session (`pty.StartWithSize`)
- `1000` — graceful close (client `close` op or PTY EOF)

---

### SPA Fallback

#### `GET /*` (catch-all, lowest priority)

- Requests matching files in `app/frontend/dist/` → serve file directly
- All other requests → serve `index.html` (client-side routing)
- Path traversal prevented
- Returns 404 if SPA not built

---

## Input Validation Summary

### Name Rules (sessions, windows)

| Rule | Detail |
|------|--------|
| Non-empty | After trimming whitespace |
| Max length | 128 characters |
| Forbidden chars | `` ; & | ` $ ( ) { } [ ] < > ! # * ? `` |
| Forbidden chars | `: .` (tmux target separator, path separator) |
| Forbidden chars | `\n \r \t` (control characters) |

### Path Rules (CWD, upload targets)

| Rule | Detail |
|------|--------|
| Non-empty | After trimming whitespace |
| Max length | 1024 characters |
| Forbidden chars | `\0 \n \r` |
| Security boundary | Must resolve under `$HOME` |
| Tilde expansion | `~` → `$HOME`, `~/path` → `$HOME/path`, `~user` → error |

### Filename Sanitization (uploads)

| Step | Transform |
|------|-----------|
| 1 | Strip null bytes |
| 2 | Replace `/` and `\` with `-` |
| 3 | Strip leading dots |
| 4 | Remove `..` sequences |
| 5 | Collapse consecutive dashes |
| 6 | Trim leading/trailing dashes and whitespace |
| 7 | Default to `"upload"` if empty |

---

## Changes from Current Implementation

| Current (multiplexed POST) | New (POST + path intent) | Rationale |
|---------------------------|------------------------|-----------|
| `POST /api/sessions { action: "createSession" }` | `POST /api/sessions` | POST to collection creates resource |
| `POST /api/sessions { action: "killSession" }` | `POST /api/sessions/:session/kill` | Intent in path, not action field |
| `POST /api/sessions { action: "createWindow" }` | `POST /api/sessions/:session/windows` | Sub-resource creation |
| `POST /api/sessions { action: "killWindow" }` | `POST /api/sessions/:session/windows/:index/kill` | Intent in path |
| `POST /api/sessions { action: "renameWindow" }` | `POST /api/sessions/:session/windows/:index/rename` | Intent in path |
| `POST /api/sessions { action: "sendKeys" }` | `POST /api/sessions/:session/windows/:index/keys` | Action as sub-resource |
| `POST /api/upload` (session in form field) | `POST /api/sessions/:session/upload` | Upload scoped to session in URL |

---

## Route Summary

| Method | Path | Handler file | Purpose |
|--------|------|-------------|---------|
| `GET` | `/api/health` | `health.go` | Health check |
| `GET` | `/api/sessions` | `sessions.go` | List all sessions + windows |
| `GET` | `/api/sessions/stream` | `sse.go` | SSE real-time stream |
| `POST` | `/api/sessions` | `sessions.go` | Create session |
| `POST` | `/api/sessions/:session/kill` | `sessions.go` | Kill session |
| `POST` | `/api/sessions/:session/windows` | `windows.go` | Create window |
| `POST` | `/api/sessions/:session/windows/:index/kill` | `windows.go` | Kill window |
| `POST` | `/api/sessions/:session/windows/:index/rename` | `windows.go` | Rename window |
| `POST` | `/api/sessions/:session/windows/:index/keys` | `windows.go` | Send keystrokes |
| `POST` | `/api/sessions/:session/upload` | `upload.go` | File upload |
| `GET` | `/api/directories` | `directories.go` | Directory autocomplete |
| `WS` | `/ws/terminals` | `terminals_ws.go` | Terminals mux (all pane relays, one socket/tab) |
| `GET` | `/*` | `spa.go` | SPA static + fallback |
