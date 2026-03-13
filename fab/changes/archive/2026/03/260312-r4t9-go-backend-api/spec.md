# Spec: Go Backend API

**Change**: 260312-r4t9-go-backend-api
**Created**: 2026-03-12
**Affected memory**: `docs/memory/run-kit/architecture.md`

## Non-Goals

- Frontend implementation (Phase 3) — backend API only
- Old code removal from `packages/` (Phase 4) — old code stays as reference
- Frontend E2E tests — backend has handler-level integration tests only
- `internal/worktree/` — dead code, not API-exposed, explicitly excluded by architecture spec

## Module Structure

### Requirement: Go module at `app/backend/`

The Go module SHALL be located at `app/backend/` with module name `run-kit` and Go version 1.22+. The directory structure SHALL match `docs/specs/architecture.md`:

```
app/backend/
  cmd/run-kit/main.go
  api/
    router.go, health.go, sessions.go, windows.go,
    directories.go, upload.go, sse.go, relay.go, spa.go
  internal/
    validate/, config/, tmux/, fab/, sessions/
  go.mod, go.sum
```

Each `api/` handler file SHALL contain only HTTP concerns (parse request, call internal package, write response). Business logic MUST live in `internal/` packages.

#### Scenario: Module compiles
- **GIVEN** the `app/backend/` directory exists with `go.mod` and all source files
- **WHEN** `go build ./...` is run from `app/backend/`
- **THEN** the build succeeds with zero errors

#### Scenario: All tests pass
- **GIVEN** all handler and internal package tests are written
- **WHEN** `go test ./...` is run from `app/backend/`
- **THEN** all tests pass with zero failures

## Internal Packages: Verbatim Ports

### Requirement: Port `internal/validate`

The validate package SHALL be copied verbatim from `packages/api/internal/validate/` to `app/backend/internal/validate/`. All functions (`ValidateName`, `ValidatePath`, `ExpandTilde`, `SanitizeFilename`) and their existing tests MUST be preserved unchanged.

#### Scenario: Name validation rejects forbidden characters
- **GIVEN** the validate package is ported
- **WHEN** `ValidateName("test;cmd", "Session name")` is called
- **THEN** a non-empty error string is returned containing "forbidden characters"

#### Scenario: Tilde expansion security boundary
- **GIVEN** the validate package is ported
- **WHEN** `ExpandTilde("~user/path")` is called
- **THEN** an error is returned rejecting `~user` syntax

### Requirement: Port `internal/config`

The config package SHALL be copied verbatim from `packages/api/internal/config/` to `app/backend/internal/config/`. The `Config` struct, `Load()` function, and resolution order (CLI > YAML > defaults) MUST be preserved. Existing tests MUST be preserved.

#### Scenario: CLI overrides YAML
- **GIVEN** `run-kit.yaml` has `server.port: 8080` and CLI has `-port 9090`
- **WHEN** `config.Load()` is called
- **THEN** `cfg.Port` is `9090`

### Requirement: Port `internal/tmux`

The tmux package SHALL be copied verbatim from `packages/api/internal/tmux/` to `app/backend/internal/tmux/`. All functions (`ListSessions`, `ListWindows`, `CreateSession`, `CreateWindow`, `KillSession`, `KillWindow`, `RenameWindow`, `SendKeys`, `SplitWindow`, `KillPane`, `CapturePane`) and their parse/filter helpers MUST be preserved. Existing tests MUST be preserved.

#### Scenario: Byobu session-group filtering
- **GIVEN** tmux output includes sessions with `session_grouped=1` where `name != group`
- **WHEN** `parseSessions(lines)` is called
- **THEN** only primary sessions are returned (where `name == group` or `grouped == 0`)

#### Scenario: Window activity threshold
- **GIVEN** a window with `window_activity` timestamp 5 seconds ago
- **WHEN** `parseWindows(lines, nowUnix)` is called
- **THEN** the window's `Activity` field is `"active"` (within 10-second threshold)

## Internal Packages: Fab Rewrite

### Requirement: Read `.fab-status.yaml` for fab state

The `internal/fab` package SHALL be completely rewritten (not ported). It MUST read `.fab-status.yaml` from the project root via `os.ReadFile` (which follows symlinks). It SHALL NOT call subprocess scripts (`statusman.sh`, `changeman.sh`). It SHALL NOT read `fab/current`.

The package MUST export a function that accepts a project root path and returns:
- The active change name (`name` field from the parsed YAML)
- The current active stage (first stage in the `progress` map with value `active`)
- A nil/zero result if `.fab-status.yaml` does not exist or cannot be parsed

#### Scenario: Active change with active stage
- **GIVEN** `.fab-status.yaml` exists at `{projectRoot}/.fab-status.yaml` with `name: 260312-r4t9-go-backend-api` and `progress.apply: active`
- **WHEN** the state reader is called with `projectRoot`
- **THEN** it returns change name `"260312-r4t9-go-backend-api"` and stage `"apply"`

#### Scenario: No active change
- **GIVEN** `.fab-status.yaml` does not exist at the project root
- **WHEN** the state reader is called
- **THEN** it returns nil (no fab state available)

#### Scenario: Dangling symlink
- **GIVEN** `.fab-status.yaml` is a symlink whose target has been deleted
- **WHEN** the state reader is called
- **THEN** it returns nil gracefully (no panic, no error logged to user)

#### Scenario: All stages done
- **GIVEN** `.fab-status.yaml` exists but all progress stages are `done` or `pending` (none `active`)
- **WHEN** the state reader is called
- **THEN** it returns the change name with an empty stage string

## Internal Packages: Sessions Enrichment

### Requirement: Per-session fab enrichment via `.fab-status.yaml`

The `internal/sessions` package SHALL read `.fab-status.yaml` once per session from window 0's `WorktreePath` (the project root). The resulting fab state (change name and active stage) SHALL be applied to ALL windows in that session. The previous per-window enrichment model (calling `fab.GetCurrentChange` and `fab.GetStatus` per window) is removed.

The `WindowInfo` struct in `internal/tmux` SHALL replace `FabStage`/`FabProgress` fields with:
- `FabChange string` — JSON tag: `"fabChange,omitempty"` — the active change folder name
- `FabStage string` — JSON tag: `"fabStage,omitempty"` — the current active pipeline stage

#### Scenario: All windows share session-level fab state
- **GIVEN** a tmux session "run-kit" with 3 windows, window 0 at `/home/user/code/run-kit` which has `.fab-status.yaml` with change `"260312-abc-feature"` and stage `"apply"`
- **WHEN** `FetchSessions()` is called
- **THEN** all 3 windows have `fabChange: "260312-abc-feature"` and `fabStage: "apply"`

#### Scenario: Session without fab-kit project
- **GIVEN** a tmux session "other" with window 0 at `/home/user/other-project` which has no `fab/project/config.yaml`
- **WHEN** `FetchSessions()` is called
- **THEN** all windows have empty `fabChange` and `fabStage` (omitted from JSON output)

#### Scenario: Parallel enrichment preserves order
- **GIVEN** 5 tmux sessions exist
- **WHEN** `FetchSessions()` is called
- **THEN** sessions are enriched in parallel (goroutines with `sync.WaitGroup`, indexed assignment) and the result preserves tmux session ordering

## API Router

### Requirement: Route registration and middleware stack

`api/router.go` SHALL create a chi router with middleware applied to all `/api/*` routes:
1. **CORS** — allow all origins (`*`), methods `GET POST OPTIONS`, headers `Accept Authorization Content-Type`, no credentials, max-age 300s
2. **Request logger** — chi `middleware.Logger`
3. **Panic recovery** — chi `middleware.Recoverer`

Routes SHALL be registered per the route table in `docs/specs/api.md`. The router creation function SHALL accept dependencies (session fetcher, tmux operations) to enable handler test isolation.

#### Scenario: CORS preflight response
- **GIVEN** the router is configured
- **WHEN** an `OPTIONS /api/sessions` request is sent with `Origin: http://localhost:5173`
- **THEN** the response includes `Access-Control-Allow-Origin: *` and status 200

### Requirement: Consistent JSON response helpers

The router module SHALL export helper functions used by all handler files:
- `writeJSON(w, status, v)` — sets `Content-Type: application/json`, writes status code, JSON-encodes `v`
- `writeError(w, status, msg)` — writes `{"error":"<msg>"}` with given status

#### Scenario: All error responses have consistent shape
- **GIVEN** any handler encounters a validation error
- **WHEN** the error response is sent
- **THEN** it has `Content-Type: application/json` and body matching `{"error":"<message>"}`

## API Handlers: Health

### Requirement: Health check endpoint

`api/health.go` SHALL handle `GET /api/health` returning `200 {"status":"ok"}`. No authentication, no dependencies.

#### Scenario: Health check succeeds
- **GIVEN** the server is running
- **WHEN** `GET /api/health` is requested
- **THEN** response status is `200` with body `{"status":"ok"}`

## API Handlers: Sessions

### Requirement: List sessions

`api/sessions.go` SHALL handle `GET /api/sessions` by calling the session fetcher and returning the result as a JSON array of `ProjectSession` objects.

#### Scenario: Sessions with fab enrichment
- **GIVEN** tmux has sessions, some with fab-kit projects
- **WHEN** `GET /api/sessions` is requested
- **THEN** response is `200` with a JSON array where fab-enriched sessions include `fabChange` and `fabStage` on each window

### Requirement: Create session

`api/sessions.go` SHALL handle `POST /api/sessions` with JSON body `{"name":"...","cwd":"..."}`.
- `name` is required — validated via `validate.ValidateName()`
- `cwd` is optional — validated via `validate.ValidatePath()` then `validate.ExpandTilde()`
- On success: response `201 {"ok":true}`

#### Scenario: Create session with CWD
- **GIVEN** the server is running
- **WHEN** `POST /api/sessions` with body `{"name":"my-project","cwd":"~/code/my-project"}` is sent
- **THEN** `tmux.CreateSession("my-project", expandedCwd)` is called and response is `201 {"ok":true}`

#### Scenario: Create session validation failure
- **GIVEN** the server is running
- **WHEN** `POST /api/sessions` with body `{"name":""}` is sent
- **THEN** response is `400` with `{"error":"Session name cannot be empty"}`

### Requirement: Kill session

`api/sessions.go` SHALL handle `POST /api/sessions/:session/kill`.
- `:session` URL param validated via `validate.ValidateName()`
- On success: response `200 {"ok":true}`

#### Scenario: Kill session
- **GIVEN** tmux session "test" exists
- **WHEN** `POST /api/sessions/test/kill` is requested
- **THEN** `tmux.KillSession("test")` is called and response is `200 {"ok":true}`

#### Scenario: Kill session with invalid name
- **GIVEN** the server is running
- **WHEN** `POST /api/sessions/test;rm/kill` is requested
- **THEN** response is `400` with validation error (forbidden characters)

## API Handlers: Windows

### Requirement: Create window

`api/windows.go` SHALL handle `POST /api/sessions/:session/windows` with JSON body `{"name":"...","cwd":"..."}`.
- `:session` URL param validated
- `name` required, validated via `validate.ValidateName()`
- `cwd` optional, validated via `validate.ValidatePath()` + `validate.ExpandTilde()`
- On success: response `201 {"ok":true}`

#### Scenario: Create window
- **GIVEN** tmux session "run-kit" exists
- **WHEN** `POST /api/sessions/run-kit/windows` with body `{"name":"feature","cwd":"~/code/run-kit"}` is sent
- **THEN** a new window is created and response is `201 {"ok":true}`

### Requirement: Kill window

`api/windows.go` SHALL handle `POST /api/sessions/:session/windows/:index/kill`.
- `:session` validated, `:index` MUST be a non-negative integer
- On success: response `200 {"ok":true}`

#### Scenario: Kill window
- **GIVEN** session "run-kit" with window at index 1
- **WHEN** `POST /api/sessions/run-kit/windows/1/kill` is requested
- **THEN** `tmux.KillWindow("run-kit", 1)` is called and response is `200 {"ok":true}`

#### Scenario: Invalid window index
- **GIVEN** the server is running
- **WHEN** `POST /api/sessions/run-kit/windows/abc/kill` is requested
- **THEN** response is `400` with `{"error":"Invalid window index"}`

### Requirement: Rename window

`api/windows.go` SHALL handle `POST /api/sessions/:session/windows/:index/rename` with JSON body `{"name":"..."}`.
- `name` required, validated
- On success: response `200 {"ok":true}`

#### Scenario: Rename window
- **GIVEN** session "run-kit" with window at index 1
- **WHEN** `POST /api/sessions/run-kit/windows/1/rename` with body `{"name":"new-name"}` is sent
- **THEN** `tmux.RenameWindow("run-kit", 1, "new-name")` is called and response is `200 {"ok":true}`

### Requirement: Send keys

`api/windows.go` SHALL handle `POST /api/sessions/:session/windows/:index/keys` with JSON body `{"keys":"..."}`.
- `keys` MUST be non-empty after trim
- Sends via `tmux.SendKeys(session, index, keys)`
- On success: response `200 {"ok":true}`

#### Scenario: Send keys
- **GIVEN** session "run-kit" with window at index 0
- **WHEN** `POST /api/sessions/run-kit/windows/0/keys` with body `{"keys":"echo hello"}` is sent
- **THEN** `tmux.SendKeys("run-kit", 0, "echo hello")` is called and response is `200 {"ok":true}`

#### Scenario: Empty keys rejected
- **GIVEN** the server is running
- **WHEN** `POST /api/sessions/run-kit/windows/0/keys` with body `{"keys":"  "}` is sent
- **THEN** response is `400` with `{"error":"Keys cannot be empty"}`

## API Handlers: Directories

### Requirement: Directory autocomplete

`api/directories.go` SHALL handle `GET /api/directories?prefix=:path` per `docs/specs/api.md`:
- Tilde expansion via `validate.ExpandTilde()`
- If prefix ends with `/`, list child directories
- Otherwise, match directory names against the basename prefix (case-insensitive)
- Skip hidden directories (`.`-prefixed)
- Return paths with `~/` prefix when under home directory
- Return empty array on invalid path or no matches

#### Scenario: List child directories
- **GIVEN** `~/code/` contains directories `wvrdz/` and `other/` and hidden `.cache/`
- **WHEN** `GET /api/directories?prefix=~/code/` is requested
- **THEN** response includes `["~/code/other/","~/code/wvrdz/"]` and excludes `.cache/`

#### Scenario: Empty prefix
- **GIVEN** the server is running
- **WHEN** `GET /api/directories` is requested (no prefix param)
- **THEN** response is `200` with `{"directories":[]}`

## API Handlers: Upload

### Requirement: Session-scoped file upload

`api/upload.go` SHALL handle `POST /api/sessions/:session/upload` with multipart form data.

Key change from current implementation: session is identified by the `:session` URL parameter, not a `session` form field.

- `:session` URL param validated via `validate.ValidateName()`
- `file` form field required, max 50 MB via `http.MaxBytesReader`
- `window` form field optional, integer string, defaults to `"0"`
- Resolves project root from target window's `WorktreePath` via `tmux.ListWindows()`
- Creates `.uploads/` in project root, auto-adds `.uploads/` to `.gitignore`
- Filename format: `{YYMMDDHHmmss}-{sanitized_name}` where sanitization uses `validate.SanitizeFilename()`
- On success: response `200 {"ok":true,"path":"<absolute-path>"}`

#### Scenario: Upload file to session
- **GIVEN** session "run-kit" exists with window 0 at `/home/user/code/run-kit`
- **WHEN** `POST /api/sessions/run-kit/upload` with multipart file `screenshot.png` is sent
- **THEN** file is saved to `/home/user/code/run-kit/.uploads/{timestamp}-screenshot.png` and response includes the absolute path

#### Scenario: Upload size limit exceeded
- **GIVEN** the server is running
- **WHEN** a file exceeding 50 MB is uploaded to `/api/sessions/run-kit/upload`
- **THEN** response is `413` with `{"error":"File exceeds 50MB limit"}`

#### Scenario: Gitignore auto-management
- **GIVEN** project root has no `.uploads/` entry in `.gitignore`
- **WHEN** a file is uploaded successfully
- **THEN** `.uploads/` is appended to `.gitignore`

## API Handlers: SSE

### Requirement: Session state stream

`api/sse.go` SHALL handle `GET /api/sessions/stream` using a module-level hub singleton. The architecture SHALL be ported from the current `packages/api/api/sse.go`:

- Hub manages a set of connected SSE clients
- Polls `FetchSessions()` every 2500ms, only when clients are connected
- Deduplicates by JSON string comparison — only fans out on change
- New clients receive the cached snapshot immediately on connect
- 30-minute lifetime cap per connection
- Non-blocking fan-out (skip if client buffer full)
- Event format: `event: sessions\ndata: <json>\n\n`

#### Scenario: Client receives initial snapshot
- **GIVEN** the hub has a cached session snapshot
- **WHEN** a new client connects to `/api/sessions/stream`
- **THEN** the client receives the cached snapshot immediately as an `event: sessions` message

#### Scenario: Deduplication prevents redundant events
- **GIVEN** a client is connected and the hub polls twice with identical tmux state
- **WHEN** the second poll returns the same JSON as the first
- **THEN** no duplicate event is sent to the client

#### Scenario: Polling stops when no clients
- **GIVEN** the hub is polling with one connected client
- **WHEN** the client disconnects
- **THEN** the polling goroutine exits (checks `len(clients) == 0` and stops)

## API Handlers: Relay

### Requirement: WebSocket terminal relay

`api/relay.go` SHALL handle `WS /relay/:session/:window` with the same lifecycle as the current `packages/api/api/relay.go`:

1. Validate `:session` via `validate.ValidateName()` and `:window` as non-negative integer
2. Upgrade HTTP → WebSocket via `gorilla/websocket.Upgrader` (accept all origins)
3. Create independent pane: `tmux.SplitWindow(session, windowIndex)` — agent pane 0 untouched
4. Select target pane, attach via PTY: `exec.CommandContext(ctx, "tmux", "attach-session", "-t", session)` with `creack/pty`
5. Bidirectional relay: goroutine for PTY→WS reads, main loop for WS→PTY writes
6. Handle resize: JSON `{"type":"resize","cols":N,"rows":N}` → `pty.Setsize()`
7. On disconnect: kill PTY, kill process, kill pane via `sync.Once` cleanup

Error close code `4001` for pane creation or attach failure.

#### Scenario: Relay connection lifecycle
- **GIVEN** session "run-kit" with window at index 0
- **WHEN** a WebSocket connection is established to `/relay/run-kit/0`
- **THEN** a new tmux pane is created, PTY is started, and terminal I/O flows bidirectionally

#### Scenario: Resize message handling
- **GIVEN** an active relay connection
- **WHEN** the client sends `{"type":"resize","cols":120,"rows":40}`
- **THEN** the PTY size is updated to 120 columns × 40 rows

#### Scenario: Cleanup on disconnect
- **GIVEN** an active relay connection with spawned pane `%5`
- **WHEN** the WebSocket connection closes
- **THEN** the PTY fd is closed, the attach process is killed, and pane `%5` is killed — all via `sync.Once` (idempotent)

## API Handlers: SPA Fallback

### Requirement: Static file serving with SPA fallback

`api/spa.go` SHALL serve static files from `app/frontend/dist/` (changed from `packages/web/dist/`) with SPA fallback to `index.html`.

- Requests matching actual files in the SPA directory → serve file directly
- All other requests (not `/api/*` or `/relay/*`) → serve `index.html` for client-side routing
- Path traversal MUST be prevented (resolved path must stay within SPA directory)
- Returns 404 if SPA is not built (no `index.html`)

#### Scenario: Static asset served
- **GIVEN** `app/frontend/dist/assets/main.js` exists
- **WHEN** `GET /assets/main.js` is requested
- **THEN** the file is served with appropriate content type

#### Scenario: SPA fallback for client routes
- **GIVEN** no file matches the path `/p/run-kit/0`
- **WHEN** `GET /p/run-kit/0` is requested
- **THEN** `index.html` is served (enabling client-side routing)

#### Scenario: Path traversal blocked
- **GIVEN** the server is running
- **WHEN** `GET /../../etc/passwd` is requested
- **THEN** the request returns 404 (resolved path escapes SPA directory)

## Handler Integration Tests

### Requirement: Test coverage for every handler file

Each handler file in `api/` SHALL have a corresponding `_test.go` file using `httptest.NewRecorder` with the chi router.

Handler tests MUST cover:
- Request/response shape validation (correct JSON structure, status codes)
- Validation error messages (400 responses for invalid input)
- URL parameter parsing (`:session`, `:index`)
- Content-type enforcement (`application/json`)
- Success and error paths

Handler tests SHALL mock `internal/` dependencies (tmux operations, session fetching) via interfaces to run without a live tmux server. The `api/` package SHALL define interfaces for its dependencies and accept them during router construction.

#### Scenario: Handler test with mock dependencies
- **GIVEN** a handler test for `sessions.go` with a mock session fetcher returning canned data
- **WHEN** `GET /api/sessions` is tested via `httptest.NewRecorder`
- **THEN** the response has status `200`, `Content-Type: application/json`, and body matching the canned session data

#### Scenario: Validation error test
- **GIVEN** a handler test for `POST /api/sessions`
- **WHEN** the request body has `{"name":"test;hack"}`
- **THEN** the response has status `400` and body `{"error":"Session name contains forbidden characters"}`

## Server Entry Point

### Requirement: Server binary with graceful shutdown

`cmd/run-kit/main.go` SHALL:
1. Load config via `config.Load()` (CLI > YAML > defaults)
2. Create slog logger writing to stderr
3. Create router via `api.NewRouter(logger)` (or equivalent, with production dependencies)
4. Start HTTP server on `{host}:{port}` from config
5. Handle graceful shutdown on SIGINT/SIGTERM with 5-second timeout via `signal.NotifyContext`

#### Scenario: Server starts and serves
- **GIVEN** `run-kit.yaml` has `server.port: 8080`
- **WHEN** the binary is started
- **THEN** the server listens on `127.0.0.1:8080` and responds to `GET /api/health`

#### Scenario: Graceful shutdown
- **GIVEN** the server is running with active connections
- **WHEN** SIGTERM is received
- **THEN** the server drains in-flight requests and exits within 5 seconds

## Design Decisions

1. **Dependency injection via interfaces for handler testability**: Handlers receive dependencies (session fetcher, tmux operations) as interfaces on a server/router struct, rather than calling package-level functions directly. This enables mock injection in `_test.go` files without requiring a live tmux server.
   - *Why*: Handler tests need isolation from tmux. Package-level functions can't be swapped in tests without build tags.
   - *Rejected*: Build-tag test doubles — fragile, splits code across files, easy to forget.

2. **Session URL param (not form field) for upload**: Upload endpoint uses `:session` in the URL path (`POST /api/sessions/:session/upload`) rather than a `session` form field. All session-scoped operations use the same URL pattern.
   - *Why*: Consistency with all other session-scoped endpoints; URL routing is declarative.
   - *Rejected*: Form field approach (current implementation) — inconsistent with other endpoints.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | POST-only mutations | Confirmed from intake #1 — routes enumerated in api.md | S:95 R:80 A:95 D:95 |
| 2 | Certain | Port internal packages verbatim (except fab) | Confirmed from intake #2 — code review confirms stable, well-tested packages | S:90 R:90 A:95 D:95 |
| 3 | Certain | No internal/worktree | Confirmed from intake #3 — architecture spec excludes it | S:90 R:90 A:90 D:95 |
| 4 | Certain | Handler files split by resource domain | Confirmed from intake #4 — architecture spec maps each resource to a file | S:90 R:85 A:90 D:90 |
| 5 | Certain | chi router with CORS, logger, recovery middleware | Confirmed from intake #5 — same stack as current, proven | S:90 R:85 A:90 D:95 |
| 6 | Certain | SSE hub architecture unchanged | Upgraded from intake #7 — code review confirms sse.go is clean, portable as-is | S:90 R:85 A:90 D:95 |
| 7 | Certain | WebSocket relay architecture unchanged | Upgraded from intake #8 — code review confirms relay.go is clean, portable as-is | S:90 R:80 A:90 D:95 |
| 8 | Certain | Go module name `run-kit`, version 1.22+ | Same as current go.mod, no reason to change | S:95 R:90 A:95 D:95 |
| 9 | Confident | Handler tests use httptest.NewRecorder + chi router | Confirmed from intake #6 — standard Go HTTP testing pattern, mock internal interfaces | S:80 R:85 A:85 D:85 |
| 10 | Confident | `app/backend/` directory created as part of this change | Phase 1 scaffold not done; creating directories is trivial and easily reversed | S:70 R:90 A:80 D:80 |
| 11 | Confident | Server struct with interfaces for handler testability | Standard Go DI pattern; handlers need mockable dependencies for test isolation | S:75 R:85 A:85 D:80 |
| 12 | Confident | FabState reads via `os.ReadFile` following symlink | Go's os.ReadFile follows symlinks by default; simplest correct approach | S:80 R:90 A:90 D:90 |

12 assumptions (8 certain, 4 confident, 0 tentative, 0 unresolved).
