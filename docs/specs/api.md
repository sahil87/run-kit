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
        "worktreePath": "/Users/sahil/code/wvrdz/run-kit",
        "activity": "active",
        "isActiveWindow": true,
        "fabStage": "go-api-redesign",
        "fabProgress": "spec ◷"
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
| `fabStage` | `string?` | Current fab change name (from `fab/current`), omitted if not a fab-kit project |
| `fabProgress` | `string?` | Progress line from `statusman.sh`, omitted if not a fab-kit project |

**Behavior:**
- Filters out byobu session-group copies (keep where `name == group` or `grouped == 0`)
- Enriches with fab-kit state in parallel per window
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
| `name` | `string` | yes | Same rules as session name |
| `cwd` | `string` | no | Same rules as session CWD |

**Response** `201`:
```json
{ "ok": true }
```

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
  "directories": ["~/code/wvrdz/", "~/code/sahil-weaver/"]
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
  "path": "/Users/sahil/code/wvrdz/run-kit/.uploads/260312-143022-screenshot.png"
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

### Terminal Relay

WebSocket endpoint for interactive terminal access.

#### `WS /relay/:session/:window`

**URL params:**

| Param | Type | Validation |
|-------|------|------------|
| `session` | `string` | Name validation |
| `window` | `int` | Non-negative integer |

**Message protocol:**

| Direction | Format | Description |
|-----------|--------|-------------|
| Server → Client | Raw text (bytes) | Terminal output from PTY |
| Client → Server | Raw text | Terminal input, written to PTY |
| Client → Server | JSON `{"type":"resize","cols":N,"rows":N}` | Resize PTY |

**Connection lifecycle:**
1. Upgrade HTTP → WebSocket
2. Create independent pane: `tmux split-window -t {session}:{window}`
3. Attach to pane via PTY: `tmux attach-session -t {session}`
4. Bidirectional relay: goroutine for PTY→WS, main loop for WS→PTY
5. On disconnect: kill PTY process, close PTY fd, kill spawned pane via `sync.Once`

**Error close codes:**
- `4001` — failed to create tmux pane or attach

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
| `WS` | `/relay/:session/:window` | `relay.go` | Terminal relay |
| `GET` | `/*` | `spa.go` | SPA static + fallback |
