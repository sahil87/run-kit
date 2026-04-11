# run-kit Architecture

## System Overview

run-kit is a web-based agent orchestration dashboard. In production, a single Go binary runs as a daemon in a dedicated tmux session:

1. **Go backend** (`app/backend/`, default port 3000) — single binary serving REST API, SSE, WebSocket terminal relay, and SPA static files on one port. Cobra CLI with subcommands: `serve` (default, with `-d`/`--restart`/`--stop` daemon flags), `update` (alias: `upgrade`), `doctor`, `status`. Version info via `--version`/`-v` global flag (Cobra built-in)

In development, `just dev` runs two concurrent processes:
- Vite dev server (`:RK_PORT`, default 3000) — HMR, proxies `/api/*` and `/relay/*` to Go backend
- Go backend (`:RK_PORT+1`, default 3001) — API, WebSocket relay, SPA static serving

Configuration via env vars: `.env` (committed) defines `RK_PORT` and `RK_HOST`, `.env.local` (gitignored) for overrides. Go backend and Vite both read `RK_PORT`/`RK_HOST` directly — no intermediate `BACKEND_*` vars. In dev mode, `dev.sh` is the translation layer: it passes `RK_PORT+1` to the Go backend and `RK_PORT` to Vite. `dev.sh` accepts `--port` for ad-hoc overrides. Tmux config defaults to `~/.rk/tmux.conf` (scaffolded by `rk init-conf`), overridable via `RK_TMUX_CONF` env var. The config is embedded in the binary via `go:embed` and written to disk by `init-conf`. All consumers use `tmux.ConfigPath()` getter — no direct env var reads elsewhere. User extensions go in `~/.rk/tmux.d/*.conf` — a drop-in directory sourced via `source-file -q` at the end of the default config. Files load in lexicographic order (numeric prefixes control precedence). The `-q` flag silences errors when the directory is empty or missing.

run-kit connects to **one tmux server at a time**, determined by the URL path segment. The URL hierarchy is `/$server/$session/$window` — the server name is always in the URL, making URLs fully shareable and self-contained. The active server is sent as a `?server=` query parameter on every API request (SSE, REST, WebSocket) by the frontend's `withServer()` helper. The backend is stateless — it defaults to the `default` tmux server when the parameter is absent. Server discovery scans `/tmp/tmux-{uid}/` for socket files. The frontend persists the last-used server in localStorage (`runkit-server`) as a convenience for the server list page, but the URL is always the source of truth. Server lifecycle: create (via server list page or command palette), kill (`tmux kill-server`), switch (navigate to `/$newserver`).

## Repository Structure

Repository layout:

```
app/
  backend/            # Go module — backend
    cmd/rk/           # Cobra CLI entry point
      main.go         # Calls execute()
      root.go         # Root command, version var, --version flag, subcommand registration
      serve.go        # serve subcommand — HTTP server (default when no args)
      upgrade.go      # update subcommand (alias: upgrade) — Homebrew or local update
      doctor.go       # doctor subcommand — runtime dependency checks
      status.go       # status subcommand — tmux session summary
    internal/         # validate, config, tmux, sessions, settings, metrics
    api/              # HTTP handlers — one file per resource domain
      router.go       # chi router, CORS/logger/recovery middleware, route registration
      health.go       # GET /api/health
      sessions.go     # GET /api/sessions, POST /api/sessions, POST .../kill
      windows.go      # POST .../windows (create, kill, move, rename, keys)
      directories.go  # GET /api/directories
      upload.go       # POST /api/sessions/:session/upload
      sse.go          # GET /api/sessions/stream (hub singleton)
      relay.go        # WS /relay/:session/:window
      tmux_config.go  # POST /api/tmux/reload-config
      servers.go      # GET /api/servers, POST /api/servers, POST /api/servers/kill
      keybindings.go  # GET /api/keybindings (curated tmux keybindings via list-keys + whitelist)
      settings.go     # GET /api/settings/theme, PUT /api/settings/theme
      spa.go          # SPA static serving — dual-mode (embedded FS or filesystem)
    frontend/         # Embedded frontend assets
      embed.go        # //go:embed all:dist → embed.FS
      dist/           # Build output copied here at build time (.gitkeep for dev)
    go.mod, go.sum
  frontend/           # Vite + React SPA — single-view UI
config/
  tmux.conf           # tmux config for the runkit server (status bar, keybindings, sources tmux.d/*.conf)
VERSION             # Semver source of truth (e.g., 0.1.0) — injected via ldflags
scripts/
  build.sh          # Production build: frontend → copy dist → copy tmux.conf → go build with ldflags
  release.sh        # Bump VERSION, commit, tag v{version}, push (triggers CI)
.github/
  workflows/
    release.yml     # CI: v* tag → cross-compile 4 targets → GitHub Release with tarballs → update Homebrew tap
  formula-template.rb # Homebrew formula template with placeholders (version, SHA256s)
fab/                # Fab-kit project config + changes
docs/               # Memory files
justfile            # Task runner (dev, verify, test, build, release commands)
```

## Data Model

**No database.** State derived at request time from:
- **tmux server** — `tmux list-sessions`, `tmux list-windows` via `internal/tmux/tmux.go`. Project roots derived from window 0's `pane_current_path`. Read-path functions (`ListSessions`, `ListWindows`, `ListServers`) accept `context.Context` from HTTP handlers for request cancellation propagation. Mutation functions (Create/Kill/Rename) use `context.Background()` — user-initiated actions complete regardless of client disconnect
- **fab-go pane-map** — `internal/sessions` calls `fab-go pane-map --json --all-sessions` to get per-window fab state (change name, pipeline stage, agent state, idle duration). Returns a map keyed by `session:windowIndex` for O(1) lookup during result assembly. Results cached at package level with 5s TTL (`fetchPaneMapCached`) — double-check pattern prevents thundering herd, stale cache preserved on fetch error for graceful degradation

### Performance Caching

Two in-memory caches reduce subprocess spawning on the SSE hot path (justified per code-quality.md performance carve-out — not general-purpose caching):

| Cache | Location | TTL | Key | Purpose |
|-------|----------|-----|-----|---------|
| SSE session cache | `sseHub.cache` (`api/sse.go`) | 500ms | server name | Skip `FetchSessions()` subprocess calls when data is fresh |
| Pane-map cache | package-level (`internal/sessions`) | 5s | (single entry) | Skip `fab-go pane-map` subprocess calls between SSE ticks |

Both caches use `sync.RWMutex` for thread safety. The SSE hub's existing JSON diff-check (`previousJSON`) remains as a separate concern — the session cache prevents redundant subprocess spawning, while the diff prevents redundant SSE broadcasts

## Backend Libraries (Go Modules)

Packages in `app/backend/internal/`:

| Package | Responsibility |
|---------|---------------|
| `internal/tmux` | All tmux operations via `os/exec.CommandContext` with argument slices + `context.WithTimeout` (10s). Commands target the dedicated `runkit` server via `-L runkit` prefix (built by `runkitPrefix()`); config path defaults to `~/.rk/tmux.conf`, overridable via `RK_TMUX_CONF` env var, resolved to absolute path at init. `ConfigPath()` getter exposes the resolved path. `DefaultConfigBytes()` returns the embedded `internal/tmux/tmux.conf` content (via `go:embed`). Read-path functions accept `context.Context` for request cancellation: `ListSessions(ctx, server)`, `ListWindows(ctx, session, server)`, `ListServers(ctx)`. `ListServers` probes sockets in parallel using a bounded goroutine pool (cap 10, semaphore channel) — N dead sockets cost ~2s instead of 2*N seconds. Mutation functions (`CreateSession`, `KillSession`, `RenameSession`, `CreateWindow`, `KillWindow`, `SwapWindow`, `RenameWindow`, `SendKeys`, `SelectWindow`, `SplitWindow`, `KillActivePane`, `KillPane`) use `withTimeout()` / `context.Background()`. `ListSessions(ctx, server)` queries the specified tmux server, returning `SessionInfo` structs with a `Name` field. `ReloadConfig(server)` hot-reloads the tmux config via `source-file` on the specified server. `ListWindows()` includes `isActiveWindow` flag from `#{window_active}`, `PaneCommand` from `#{pane_current_command}`, and raw `ActivityTimestamp` from `#{window_activity}`. After calling `list-windows`, `ListWindows()` issues a second `list-panes -s -t <session>` call to populate `Panes []PaneInfo` on each `WindowInfo`; pane failure is non-fatal (windows returned with empty `Panes`). `WorktreePath` continues to be sourced from `#{pane_current_path}` in the `list-windows` format string — `list-panes` is additive. `PaneInfo` struct: `PaneID string json:"paneId"`, `PaneIndex int json:"paneIndex"`, `Cwd string json:"cwd"`, `Command string json:"command"`, `IsActive bool json:"isActive"`. Package-level `paneFormat` var joins `#{window_index}`, `#{pane_id}`, `#{pane_index}`, `#{pane_current_path}`, `#{pane_current_command}`, `#{pane_active}` with `listDelim`. `parsePanes(lines []string) map[int][]PaneInfo` parses 6-field tab-delimited `list-panes` output, grouping by window index (field 0); malformed lines silently skipped; returns nil on empty/all-malformed input. `WindowInfo` struct uses `FabChange`/`FabStage` fields, plus `AgentState`/`AgentIdleDuration` (populated by pane-map enrichment in sessions package), plus `Panes []PaneInfo json:"panes,omitempty"`. `EnsureConfig()` writes the embedded default config to `~/.rk/tmux.conf` if absent and creates `~/.rk/tmux.d/` (called at serve startup; directory creation runs even when config already exists). `ListKeys(server)` runs `tmux list-keys` on a server and returns raw output lines (returns nil on "no server running"). The `-f configPath` flag is scoped to `CreateSession` and `ReloadConfig` only via `configArgs()` — not passed on every command. Both `tmuxExec` and `tmuxExecDefault` capture stderr in error messages for diagnostics |
| `internal/sessions` | `FetchSessions(ctx, server)` lists sessions and fetches windows for all of them in parallel for the requested tmux server `server` (passing `server` to `ListWindows`), then enriches with fab state. `ProjectSession` struct has `Name` and `Windows` fields. Per-window enrichment model: pane-map returns per-pane fab state, joined to windows by `session:windowIndex` key. `paneMapEntry` struct uses `*string` for nullable JSON fields (change, stage, agent_state, agent_idle_duration). `fetchPaneMapCached(repoRoot)` wraps `fetchPaneMap()` with 5s TTL cache (package-level `sync.RWMutex`, double-check pattern). On cache miss, calls `fetchPaneMap(repoRoot)` which runs `fab-go` with 10s timeout. Stale cache entry preserved on fetch error for graceful degradation; if pane-map fails on cold start, all windows get empty fab fields |
| `internal/validate` | Input validation for names/paths + tilde expansion with `$HOME` security boundary + filename sanitization for uploads |
| `internal/config` | Server config (port, host) — reads `RK_PORT` and `RK_HOST` env vars with defaults (3000, 127.0.0.1) |
| `internal/daemon` | Daemon lifecycle management — `IsRunning()`, `Start()`, `Stop()`, `Restart()`. Manages `rk serve` in a dedicated tmux server (`rk-daemon`, session `rk`, window `serve`). All tmux calls use `exec.CommandContext` with 5s timeout. Used by `serve.go` (CLI flags) and `upgrade.go` (auto-restart after update) |
| `internal/metrics` | Host-level system metrics collector reading Linux procfs. `Collector` struct with `sync.RWMutex`-protected `MetricsSnapshot`. `NewCollector(pollInterval)` creates collector, caches hostname via `os.Hostname()`, initializes 60-entry CPU ring buffer with zeros. `Start(ctx)` launches background poll goroutine (exits on `ctx.Done()`). `Snapshot()` returns a deep-copied `MetricsSnapshot` under `RLock`. Collects: CPU usage from `/proc/stat` (delta-based, ring buffer), memory from `/proc/meminfo` (`MemTotal` - `MemAvailable`), load from `/proc/loadavg`, disk via `syscall.Statfs("/")`, uptime from `/proc/uptime`. CPU core count from `/proc/stat` `cpu\d+` line count. All procfs readers return zero values on non-Linux (graceful degradation, no crash). `MetricsSnapshot` struct contains `Hostname`, `CPU` (samples `[]float64`, current, cores), `Memory` (used/total bytes), `Load` (avg1/5/15, cpus), `Disk` (used/total bytes), `UptimeSecs` |
| `internal/settings` | Global user settings persisted at `~/.rk/settings.yaml`. `Settings` struct with `Theme string` field. `Default()` returns `Settings{Theme: "system"}`. `Load()` reads the settings file, returns `Default()` if missing. `Save(s Settings)` writes the file, creating `~/.rk/` (mode 0755) if absent. Uses simple `key: value` text parsing (not yaml.v3) — one field, no heavy dependency needed |

### External Go Dependencies

| Module | Purpose |
|--------|---------|
| `github.com/go-chi/chi/v5` | HTTP router with middleware chaining (CORS, logging, recovery) |
| `github.com/go-chi/cors` | CORS middleware (permissive by default for multi-client API) |
| `github.com/gorilla/websocket` | WebSocket handling for terminal relay |
| `github.com/creack/pty` | PTY allocation (replaces node-pty, no native module compilation) |
| `github.com/spf13/cobra` | CLI framework — subcommand management (serve, update, doctor, status) + built-in `--version` flag |
| `gopkg.in/yaml.v3` | YAML parsing (legacy dependency — no longer imported after `internal/fab` removal, candidate for `go mod tidy`). `internal/settings` deliberately uses simple text parsing to avoid re-importing this |

## API Layer

All endpoints served by the single Go binary on one port. POST-only mutations with path-based intent (no multiplexed action field).

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/health` | GET | Returns `200 {"status":"ok","hostname":"..."}` for health checks. Hostname computed once at startup via `os.Hostname()`, stored in `Server` struct; falls back to `""` on error |
| `/api/sessions` | GET | Returns `ProjectSession[]` — one per tmux session, with auto-detected fab enrichment (`fabChange`/`fabStage` on windows) |
| `/api/sessions` | POST | Create session — JSON body `{"name":"...","cwd":"..."}`. Returns `201 {"ok":true}` |
| `/api/sessions/:session/kill` | POST | Kill session — `:session` validated via `validate.ValidateName()`. Returns `200 {"ok":true}` |
| `/api/sessions/:session/windows` | POST | Create window — JSON body `{"name":"...","cwd":"..."}`. Returns `201 {"ok":true}` |
| `/api/sessions/:session/windows/:index/kill` | POST | Kill window — `:index` must be non-negative integer. Returns `200 {"ok":true}` |
| `/api/sessions/:session/windows/:index/move` | POST | Move (swap) window — JSON body `{"targetIndex": N}` where N is a non-negative integer. Calls `tmux swap-window` to exchange source and target window positions. Returns `200 {"ok":true}` |
| `/api/sessions/:session/windows/:index/move-to-session` | POST | Move window to another session — JSON body `{"targetSession":"..."}`. Calls `tmux move-window` to move the source window into the target session (tmux auto-assigns index). Returns `200 {"ok":true}` |
| `/api/sessions/:session/windows/:index/rename` | POST | Rename window — JSON body `{"name":"..."}`. Returns `200 {"ok":true}` |
| `/api/sessions/:session/windows/:index/keys` | POST | Send keys — JSON body `{"keys":"..."}` (non-empty after trim). Returns `200 {"ok":true}` |
| `/api/directories` | GET | Server-side directory listing for autocomplete — `?prefix=~/code/wvr` returns matching dirs under `$HOME` |
| `/api/sessions/:session/upload` | POST | File upload — session from URL path (not form field). Multipart with `file` field, optional `window` field (defaults to `"0"`). Resolves project root via `ListWindows`, writes to `.uploads/{timestamp}-{name}`, auto-manages `.gitignore`. 50MB limit. Returns `200 {"ok":true,"path":"..."}` |
| `/api/sessions/stream` | GET | SSE — hub singleton polls tmux every 2.5s, fans out full snapshots to all connected clients on change. Two event types: `event: sessions` (per-server, deduplicated) and `event: metrics` (server-independent, every tick). Deduplicates polling across browser tabs. 30-minute lifetime cap per connection. Hub clients map is `map[string][]*sseClient` keyed by server name for O(1) server-scoped broadcast. `sync.RWMutex` — `RLock()` for read-only operations in `poll()` (collecting server keys, counting clients), `Lock()` for writes (broadcasting, updating `previousJSON`). Channel buffer 32. Drop logging via `slog.Warn` with per-client boolean debounce (resets on successful send). Hub holds a `*metrics.Collector` reference; on each tick calls `Snapshot()` and broadcasts `event: metrics` with JSON payload to all clients regardless of server. New clients receive cached metrics snapshot immediately on connect (alongside cached sessions). Metrics JSON cached in `cachedMetricsJSON` field for instant delivery to new clients |
| `/api/tmux/reload-config` | POST | Reload tmux config — server from `?server=` param (default `"default"`). Runs `source-file` on the specified server. Returns `200 {"status":"ok"}` |
| `/api/servers` | GET | List available tmux servers — scans socket dir, returns JSON array of names |
| `/api/servers` | POST | Create tmux server — JSON body `{"name":"..."}`. Creates session "0" in `$HOME`. Returns `201 {"ok":true}` |
| `/api/servers/kill` | POST | Kill tmux server — JSON body `{"name":"..."}`. Returns `200 {"ok":true}` |
| `/api/keybindings` | GET | Curated tmux keybindings — runs `tmux list-keys` on `?server=`, filters through a whitelist map, returns JSON array `[{key, table, command, label}]`. Returns `[]` if server not running or on error |
| `/api/settings/theme` | GET | Returns `{"theme": "..."}` — reads via `settings.Load()`. Returns `"system"` when no settings file exists. Not per-server (no `?server=` param) |
| `/api/settings/theme` | PUT | Accepts `{"theme": "..."}` — writes via `settings.Save()`. Returns `{"status": "ok"}` on success, `400` if theme is empty. Not per-server |

### Frontend API Client

`app/frontend/src/api/client.ts` — typed fetch wrappers for all endpoints using POST-only mutations with path-based intent. Uses relative URLs — works with both Vite proxy in dev and same-origin in production. Exports individual functions per endpoint:

| Function | Method | Path |
|----------|--------|------|
| `getHealth()` | GET | `/api/health` |
| `getSessions()` | GET | `/api/sessions` |
| `createSession(name, cwd?)` | POST | `/api/sessions` |
| `killSession(session)` | POST | `/api/sessions/:session/kill` |
| `createWindow(session, name, cwd?)` | POST | `/api/sessions/:session/windows` |
| `killWindow(session, index)` | POST | `/api/sessions/:session/windows/:index/kill` |
| `moveWindow(session, index, targetIndex)` | POST | `/api/sessions/:session/windows/:index/move` |
| `moveWindowToSession(session, index, targetSession)` | POST | `/api/sessions/:session/windows/:index/move-to-session` |
| `renameWindow(session, index, name)` | POST | `/api/sessions/:session/windows/:index/rename` |
| `sendKeys(session, index, keys)` | POST | `/api/sessions/:session/windows/:index/keys` |
| `getDirectories(prefix)` | GET | `/api/directories?prefix=...` |
| `selectWindow(session, index)` | POST | `/api/sessions/:session/windows/:index/select?server=...` |
| `splitWindow(session, index, horizontal)` | POST | `/api/sessions/:session/windows/:index/split` |
| `reloadTmuxConfig()` | POST | `/api/tmux/reload-config?server=...` |
| `uploadFile(session, file, window?)` | POST | `/api/sessions/:session/upload?server=...` |
| `listServers()` | GET | `/api/servers` |
| `createServer(name)` | POST | `/api/servers` |
| `killServer(name)` | POST | `/api/servers/kill` |
| `getKeybindings()` | GET | `/api/keybindings?server=...` |
| `getThemePreference()` | GET | `/api/settings/theme` |
| `setThemePreference(theme)` | PUT | `/api/settings/theme` |

All API functions (except `listServers`, `createServer`, `killServer`, `getDirectories`, `getHealth`, `getThemePreference`, `setThemePreference`) append `?server={active}` via a module-level `setServerGetter()` mechanism. The `SessionProvider` sets the getter on mount. No multiplexed `action` field — each mutation is a separate function with its own URL path.

**Request deduplication**: A module-level `deduplicatedFetch` wrapper maintains a `Map<string, Promise<Response>>` of in-flight GET requests. When a GET to a URL already has an in-flight promise, the existing promise is returned (with `Response.clone()` so each caller can independently consume the body). POST/PUT requests always make fresh `fetch()` calls. Promises are cleaned up via `.finally()` on resolve or reject. All GET functions (`getHealth`, `getSessions`, `getDirectories`, `listServers`, `getKeybindings`, `getThemePreference`) use `deduplicatedFetch`; all mutation functions use plain `fetch`. Deduplication key is the full URL string (after `withServer()` appends `?server=`), so requests scoped to different tmux servers are not incorrectly merged.

## Terminal Relay

WebSocket endpoint at `/relay/{session}/{window}?server=runkit|default` on the same port as the API — no separate relay port. Uses `gorilla/websocket` for WebSocket handling and `creack/pty` for PTY allocation. Implementation in `app/backend/api/relay.go`. The `server` query param determines which tmux server to attach to (defaults to `runkit`).

Per connection:
1. Validates session exists via `ListWindows(session, server)` and selects the target window via `SelectWindowOnServer` — returns WebSocket close code `4004` if session or window not found
2. Spawns `tmux [-L runkit] attach-session -t <session>` via `creack/pty` for real terminal I/O (runkit server includes `-L runkit` and `-f` flags; default server uses plain `tmux`)
3. Relays I/O between WebSocket and pty (goroutine for pty→WS, main loop for WS→pty)
4. Handles resize messages (JSON `{"type":"resize","cols":N,"rows":N}`) via `pty.Setsize`
5. On disconnect: `sync.Once` cleanup cancels context, closes PTY, kills process. PTY reader goroutine calls `cleanup()` (not `conn.Close()`) on read failure — eliminates concurrent WebSocket close race. WebSocket connection closed only by `defer conn.Close()` on the main goroutine

Client-side WebSocket reconnection: exponential backoff (1s, 2s, 4s, 8s, 16s, max 30s) on unexpected close. Shows `[reconnecting...]` in terminal. Re-sends resize on successful reconnect. Skips reconnect on component unmount. On close code `4004` (session/window not found): shows `[session not found]` and navigates to `/` instead of reconnecting. Terminal page connects via `ws://${location.host}/relay/{session}/{window}?server={runkit|default}` — same host, server param from session metadata.

## Daemon Lifecycle

The Go binary manages its own daemon lifecycle via `run-kit serve` flags. The daemon runs in a dedicated tmux server (`rk-daemon`, session `rk`, window `serve`) — separate from the `runkit` server used for agent sessions. Daemon helpers live in `internal/daemon/`.

- `run-kit serve -d` — start daemon (errors if already running)
- `run-kit serve --restart` — idempotent: stop existing daemon (C-c → wait 5s) then start new one; starts fresh if no daemon running
- `run-kit serve --stop` — graceful shutdown via C-c to the tmux pane
- `run-kit update` — auto-restarts daemon after successful `brew upgrade` using `RestartWithBinary(brewBinPath)` where `brewBinPath` is `<brewPrefix>/bin/rk` derived from the resolved Cellar path (resolves to the new Cellar version post-upgrade, avoiding stale `os.Executable()` path from the running process)

Binary resolution: `Start()` uses `os.Executable()` + `filepath.EvalSymlinks()` (works for `serve -d` / `--restart` where the running binary is valid). `StartWithBinary(path)` accepts an explicit binary path and resolves its symlinks (used by `update` after `brew upgrade` deletes the old Cellar directory). Both delegate to shared `startSession(exe)` for tmux session creation.

Detection: `tmux -L rk-daemon has-session -t rk`. No polling loop, no signal files, no supervisor script.

## SPA Static Serving

Dual-mode SPA serving in `app/backend/api/spa.go`. `hasEmbeddedAssets()` checks if the `embed.FS` contains real build output (more than `.gitkeep`):

- **Production** (`mountEmbeddedSPA`): serves from `embed.FS` via `fs.Sub(build.Frontend, "frontend")` + `http.FS`. SPA fallback rewrites to `index.html`.
- **Development** (`mountFilesystemSPA`): serves from `app/frontend/dist/` on the local filesystem. Path traversal prevented (resolved path must stay within SPA directory).

Both modes: any request not matching `/api/*` or `/relay/*` serves `index.html` for client-side routing. In development, Vite handles SPA fallback natively.

## Chrome Architecture

**Lazy-loaded components**: `CommandPalette`, `ThemeSelector`, and `CreateSessionDialog` are loaded via `React.lazy()` with dynamic `import()` (not static imports). Each uses `.then(m => ({ default: m.X }))` to re-wrap named exports for `React.lazy()` compatibility. Render sites wrapped in per-component `<Suspense fallback={null}>` boundaries. These components are overlays/dialogs that render conditionally — lazy loading keeps them out of the initial bundle for faster first paint.

The root layout (`app/frontend/src/app.tsx`) owns a fixed chrome skeleton (height: `var(--app-height, 100vh)`) with three zones:

1. **Top chrome** (`shrink-0, border-b border-border`) — `TopBarChrome`, always-rendered two-line top bar
2. **Main area** (`flex-1 flex flex-row min-h-0`) — sidebar + terminal column side by side
   - **Sidebar** (drag-resizable, default 220px, min 160, max 400, `shrink-0 overflow-y-auto`, hidden on mobile < 768px) — session/window tree. Width persisted to `localStorage` key `runkit-sidebar-width`. Full height of main area (top bar to viewport bottom)
   - **Terminal column** (`flex-1 min-w-0 flex flex-col`) — contains terminal + bottom bar OR Dashboard
     - When `/:session/:window` params present: **Terminal** (`flex-1`) + **Bottom bar** (`shrink-0, border-t border-border`)
     - When on `/` (no params): **Dashboard** component renders in place of terminal + bottom bar

No `max-w-4xl` constraint — all zones span full width. Terminal fills all available space right of the sidebar. The Dashboard renders inline in the terminal area via `{sessionName && windowIndex ? <TerminalClient/> : <Dashboard/>}` branch in `app.tsx`.

**ThemeProvider** (`app/frontend/src/contexts/theme-context.tsx`) — outermost provider. Split into ThemeStateContext (preference + resolved theme) and ThemeActionsContext (setTheme). Three modes: system, light, dark. Preference persisted to `localStorage` key `runkit-theme`. System mode listens to `matchMedia("(prefers-color-scheme: dark)")` change events. Theme applied via `data-theme` attribute on `<html>`. Blocking inline script in `index.html` `<head>` reads localStorage and sets `data-theme` before first paint (no-flicker initialization).

**ChromeProvider** (`app/frontend/src/contexts/chrome-context.tsx`) — split into two React contexts: `ChromeStateContext` (read-only state: current session:window selection, sidebar open/collapsed, drawer state, isConnected, fullbleed) and `ChromeDispatchContext` (stable setter functions). Chrome derives its content from the current selection — no slot injection. `setLine2Left`, `setLine2Right`, `setBottomBar` removed; top bar and bottom bar read the selection directly. `Breadcrumb` type includes optional `dropdownItems` for session/window switching.

**SessionProvider** (`app/frontend/src/contexts/session-context.tsx`) — layout-level React Context that owns the single `EventSource` connection to `/api/sessions/stream`. Exposes `{ sessions, isConnected, metrics }` via `useSessions()` hook. Listens for both `sessions` and `metrics` SSE event types; `metrics` state is `MetricsSnapshot | null` (typed in `types.ts`). Forwards `isConnected` to `ChromeProvider` internally. Provider tree order: `ThemeProvider > ChromeProvider > SessionProvider > AppShell`.

**Window state (Zustand)** — window optimistic state is managed by a Zustand store at `app/frontend/src/store/window-store.ts`, keyed by the immutable tmux `windowId` (`@N`). `zustand` is a production dependency in `app/frontend/package.json`. The store tracks `killed` and `pendingName` overrides per window ID, and ghost windows awaiting SSE confirmation. `AppShell` drives `setWindowsForSession` from SSE `rawSessions`. `OptimisticContext` retains session and server optimistic state only (name-based keys, not index-based). See ui-patterns.md "Zustand Window Store" section for full shape and action surface.

**`WindowInfo` type** (`app/frontend/src/types.ts`) — includes `windowId: string` (non-optional) as the immutable tmux `@N` identifier, alongside `index: number` (tmux ordering, display-only, not used as a store key). Backend populates `windowId` from `#{window_id}` in the `ListWindows()` format string. `panes?: PaneInfo[]` is an optional field (undefined when absent — existing fixtures omit it without type error). `PaneInfo` type: `{ paneId: string; paneIndex: number; cwd: string; command: string; isActive: boolean }`. `WindowEntry` in `window-store.ts` gains `panes: PaneInfo[]` (non-optional, defaults to `[]` when absent from incoming `WindowInfo`); `setWindowsForSession` syncs panes from incoming data on every SSE tick.

**`MetricsSnapshot` type** (`app/frontend/src/types.ts`) — mirrors the backend `metrics.MetricsSnapshot` struct. Fields: `hostname` (string), `cpu` (`{ samples: number[], current: number, cores: number }`), `memory` (`{ used: number, total: number }` bytes), `load` (`{ avg1, avg5, avg15: number, cpus: number }`), `disk` (`{ used: number, total: number }` bytes), `uptime` (number, seconds). Consumed by `HostPanel` via `SessionProvider` context.

**TopBarChrome** (`app/frontend/src/components/top-bar-chrome.tsx`) — reads from ChromeProvider. Single line (`border-b border-border`). Left: hamburger icon (☰, animates to ✕ when sidebar/drawer open) + session name (dropdown trigger, max 7ch) + `/` separator + window name (dropdown trigger). Right (desktop): logo (decorative) + "Run Kit" text + green dot (no text label) + FixedWidthToggle + ThemeToggle (cycles system → light → dark) + >_ compose. Right (mobile): ⋯ + >_. `onOpenCompose` callback received as prop.

**Sidebar** (`app/frontend/src/components/sidebar/`) — session/window tree with bottom-aligned collapsible panels. Desktop: drag-resizable (default 220px, min 160, max 400, persisted to `localStorage`), collapsible via `☰`. Mobile (< 768px): drawer overlay from the left, triggered by `☰`. Layout: server selector -> session list (`flex-1 overflow-y-auto`) -> WindowPanel (collapsible, `storageKey="runkit-panel-window"`) -> HostPanel (collapsible, `storageKey="runkit-panel-host"`). Accepts `metrics` and `isConnected` props from `SessionProvider` for the HostPanel.

**BottomBar** (`app/frontend/src/components/bottom-bar.tsx`) — rendered only on terminal pages (`/:session/:window`), hidden on Dashboard (`/`). Single row of `<kbd>` buttons: modifier toggles (Ctrl/Alt with sticky armed state — Cmd removed), Esc, Tab, arrow keys, Fn dropdown (F1-F12, PgUp/PgDn, Home/End). No compose button (moved to top bar). Buttons: 36px desktop (`min-h-[36px] min-w-[36px]`), 44px touch (`coarse:min-h-[44px] coarse:min-w-[36px]`). Sends ANSI escape sequences through the WebSocket ref. Modifier state managed by `useModifierState` hook (Ctrl/Alt only).

**ComposeBuffer** (`app/frontend/src/components/compose-buffer.tsx`) — native `<textarea>` overlay triggered by the compose button or file upload. Supports iOS dictation, autocorrect, paste, multiline. Send button (or Cmd/Ctrl+Enter) transmits entire text as a single WebSocket message. Terminal dims (`opacity-50`) while compose is open. Escape dismisses without sending. Accepts optional `initialText` prop for pre-populating with uploaded file paths; appends on subsequent updates while open.

**iOS Keyboard Support** — `useVisualViewport` hook (`app/frontend/src/hooks/use-visual-viewport.ts`) listens to both `resize` and `scroll` events on `window.visualViewport`, setting `--app-height` CSS custom property from `visualViewport.height`. In the single-view model (fullbleed always on), `globals.css` applies `position: fixed; inset: 0; height: var(--app-height, 100vh)` to the app shell. The bottom bar stays pinned above the keyboard; the terminal shrinks via `flex-1` and xterm refits via `ResizeObserver`.

**iOS Touch Scroll Prevention** — Fullbleed is always active in the single-view model. The `fullbleed` class is added to `<html>` by `useVisualViewport` on mount (also present as a static default in `index.html` for FOUC prevention). `globals.css` applies `overflow: hidden` and `overscroll-behavior: none` to both `html` and `body` via `html.fullbleed` selectors, preventing iOS Safari elastic bounce scrolling. The terminal container div uses `touch-none` (`touch-action: none`) so the browser yields touch gestures to xterm.js for scrollback handling.

**Browser title** — `useBrowserTitle` hook sets `document.title` dynamically based on hostname (fetched once from `GET /api/health` on app init) and route params. Dashboard: `RunKit — {hostname}`. Terminal: `{session}/{window} — {hostname}`. Omits hostname suffix when empty. Static `<title>RunKit</title>` in `index.html` remains as pre-hydration fallback.

Single-view model: there are no page transitions or per-page chrome injection. The chrome reads the current selection and renders directly.

## CLI Subcommands (Cobra)

`app/backend/cmd/run-kit/` uses `spf13/cobra` for CLI management. `root.go` declares `var version = "dev"` (overridden by ldflags) and registers all subcommands. `main.go` just calls `execute()`.

| Subcommand | File | Behavior |
|------------|------|----------|
| *(none)* | `root.go` | Defaults to `serve` (backwards compat) |
| `serve` | `serve.go` | Start HTTP server — loads config from env vars, chi router, graceful shutdown via SIGINT/SIGTERM. Flags: `-d`/`--daemon` (start as daemon in tmux), `--restart` (idempotent restart), `--stop` (graceful stop). Uses `internal/daemon/` helpers |
| `version` | `version.go` | Print `run-kit version {version}` — version injected at build time via `-X main.version=...` |
| `update` | `upgrade.go` | Alias: `upgrade`. Detect Homebrew install (`os.Executable()` path contains `/Cellar/rk/`). If Homebrew: `brew update --quiet`, check latest version via `brew info --json=v2`, skip if already up to date, else `brew upgrade sahil87/tap/rk` + auto-restart daemon via `daemon.RestartWithBinary(brewBinPath)` where `brewBinPath` is derived from the Cellar path (`<brewPrefix>/bin/rk`), not stale `os.Executable()`. Non-Homebrew: print reinstall instructions |
| `doctor` | `doctor.go` | Check runtime dependencies only — `exec.LookPath("tmux")`. Exit 1 if any check fails |
| `status` | `status.go` | List tmux sessions with window counts via `internal/tmux.ListSessions()` + `ListWindows()`. No server required |
| `init-conf` | `initconf.go` | Scaffold default tmux.conf to `~/.rk/tmux.conf` from embedded config and create `~/.rk/tmux.d/` drop-in directory. `--force` to overwrite config (tmux.d contents untouched) |

## Embedded Frontend Assets

`app/backend/build/embed.go` exposes `//go:embed all:frontend` as `build.Frontend` (`embed.FS`). During development, `frontend/` contains only `.gitkeep` (empty FS). Production builds copy `app/frontend/dist/` into `app/backend/build/frontend/` before `go build`.

`api/spa.go` uses dual-mode serving:
- **Production**: `hasEmbeddedAssets()` detects real build output (more than `.gitkeep`), serves from `embed.FS` via `mountEmbeddedSPA()`
- **Development**: Falls back to filesystem-based serving from `app/frontend/dist/` via `mountFilesystemSPA()` (Vite dev server handles frontend)

Both modes include SPA fallback (serve `index.html` for non-matching paths) and API/relay route guards.

## Version Management

- **Source of truth**: `VERSION` file at repo root — plain semver string (e.g., `0.1.0`), no `v` prefix
- **Build injection**: `scripts/build.sh` reads `VERSION` and passes `-X main.version=$(cat VERSION)` via ldflags
- **Go variable**: `var version = "dev"` in `root.go` — defaults to `"dev"` for local `go build` without ldflags
- **Used by**: `run-kit version` (display), `run-kit update` (shows current version, compares with latest via `brew info --json=v2`)

## Build Pipeline

`scripts/build.sh` encapsulates the full production build (frontend-first for embed):

1. `cd app/frontend && pnpm build` — produces `app/frontend/dist/` (with vendor chunk splitting: `xterm` chunk for `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-web-links`; `router` chunk for `@tanstack/react-router`; plus lazy-loaded component chunks for `CommandPalette`, `ThemeSelector`, `CreateSessionDialog`). `zustand` is bundled as a production dependency.
2. Copy `app/frontend/dist/` → `app/backend/build/frontend/` (Go embed cannot reference `../` paths)
3. Read version from `VERSION` file
4. `CGO_ENABLED=0 go build -ldflags "-X main.version=${VERSION}" -o ../../dist/run-kit ./cmd/run-kit`

Output: `dist/run-kit` — single static binary with embedded frontend assets, tmux config, and baked-in version.

`justfile` recipes: `build` delegates to `scripts/build.sh`, `release` delegates to `scripts/release.sh`.

## PWA Layer

`vite-plugin-pwa` (devDependency) adds Progressive Web App support to the Vite build. Configured in `app/frontend/vite.config.ts` with `registerType: "autoUpdate"`.

**Manifest**: Generated from the `VitePWA` plugin config in `vite.config.ts` — no separate `manifest.json` file. Specifies `display: "standalone"`, `start_url: "/"`, dark theme colors (`background_color` and `theme_color` set to `#0f1117`), and an icon array (192px, 512px, 512px maskable). The plugin injects a `<link rel="manifest">` tag into the built `index.html` automatically.

**Service worker**: Workbox-generated (`sw.js`). Precaches all static assets (JS, CSS, HTML) from the Vite build output. Runtime caching rules:
- `NetworkOnly` for URL patterns matching `/api/` and `/relay/` — SSE streams and WebSocket connections always hit the server
- `navigateFallback: "/index.html"` — ensures TanStack Router client-side routes work when served from cache (e.g., homescreen launch to `/{session}/{window}`)

Updates are silent (`registerType: "autoUpdate"`) — the service worker detects new builds and caches updated assets without user interaction or reload prompts.

**Build output**: `app/frontend/dist/` gains `sw.js` and `manifest.webmanifest` alongside the existing Vite output. These files are copied into `app/backend/build/frontend/` by `scripts/build.sh` and served by the Go backend via the existing SPA static serving — no backend changes required.

**Icons**: Canonical SVG mark at `app/frontend/public/icon.svg` (hexagonal cube, transparent background). Generated variants in `app/frontend/public/generated-icons/`: `favicon.svg` (copy of icon.svg), `icon-192.png`, `icon-512.png`, `icon-512-maskable.png` (PNGs have solid `#0f1117` dark background with 20% padding, maskable has 40%). Generated by `scripts/generate-icons.sh` (uses `sharp` Node library). Run via `just icons`.

## Release Flow & CI/CD

**Release script** (`scripts/release.sh`): accepts bump level (`patch`/`minor`/`major`), increments `VERSION` file semver, commits with message `v{version}`, creates git tag `v{version}`, pushes commit + tag. Tag push triggers CI.

**GitHub Actions** (`.github/workflows/release.yml`): triggers on `v*` tag push. Steps: checkout → setup Go (from `go.mod`) → setup Node 20 + pnpm → install frontend deps → build frontend → copy dist to backend → cross-compile 4 targets → create GitHub Release with tarballs → update Homebrew tap.

Cross-compile targets: `darwin/arm64`, `darwin/amd64`, `linux/arm64`, `linux/amd64`. Each target built with `CGO_ENABLED=0` and ldflags. Output: `run-kit-{os}-{arch}.tar.gz` tarballs uploaded to GitHub Release via `softprops/action-gh-release`.

**Homebrew tap update** (final CI step): computes SHA256 for all 4 tarballs, clones `sahil87/homebrew-tap` via `BUILD_TOKEN` secret, generates `Formula/rk.rb` from `.github/formula-template.rb` (placeholder substitution via `sed`), commits and pushes.

## Homebrew Distribution

**Formula**: `Formula/rk.rb` in `sahil87/homebrew-tap` (generated by CI from `.github/formula-template.rb`). Public repo — plain URL downloads, no auth token needed. Platform detection via `on_macos`/`on_linux` + `on_arm`/`on_intel`. Version and SHA256 values substituted by CI.

Install flow: `brew tap sahil87/tap && brew install rk`. Update: `rk update`.

## Design Decisions

- **Go backend + Vite SPA over Next.js monolith** — decouples frontend and backend for independent iteration. Go backend is a stable, long-lived API that outlives any individual frontend. Multi-client API support (web, mobile, CLI) without split API surface
- **Single port architecture** — Go serves API, WebSocket relay, and SPA static files on one port. The two-port split (Next.js :3000, relay :3001) was a Node.js artifact — separate processes required separate ports. Go serves everything in one binary
- **chi over stdlib ServeMux** — chi for middleware chaining (CORS, logging, recovery). Go 1.22+ ServeMux has pattern matching but lacks ergonomic middleware composition
- **TanStack Router over React Router** — type-safe params and search params, built-in loader pattern. Single route `/:session/:window` in the new frontend
- **Vite proxy in dev (not CORS)** — single browser URL, no CORS config needed. WebSocket upgrade works transparently. Go includes chi CORS middleware for production/non-browser clients
- **SPA fallback in Go** — Go serves standalone; TLS termination handled externally via Tailscale Serve when needed
- **SSE (not WebSocket) for session state** — simpler, server-push only, naturally resilient. Module-level hub deduplicates polling across tabs (one `FetchSessions()` per server per interval). Clients indexed by server name (`map[string][]*sseClient`) — broadcast iterates only the target server's slice. `sync.RWMutex` with `RLock` for read-only poll operations, `Lock` for writes. SSE data includes `isActiveWindow` per window, enabling UI sync when users switch tmux/byobu windows via terminal shortcuts
- **Full snapshots (not diffs)** — small payload (<100 sessions), simple client logic
- **Independent panes per browser client** — no cursor fights, agent pane untouched. The relay pty follows tmux window switches natively (runs `tmux -L runkit attach-session`)
- **Every tmux session is a project** — no config, no "Other" bucket. Project root derived from window 0's `pane_current_path`
- **Config via env vars (not YAML)** — `.env` committed with defaults (`RK_PORT`, `RK_HOST`), `.env.local` for overrides, loaded via `.envrc` (direnv). Go and Vite read `RK_PORT`/`RK_HOST` directly. `dev.sh` translates `RK_PORT+1` for the backend subprocess. No relay port — single port serves everything
- **Dedicated tmux server (`-L runkit`)** — run-kit sessions live on a named tmux server `runkit` with its own config (`internal/tmux/tmux.conf` loaded via `-f`). The default tmux server is also queried for session discovery (read-only display of external sessions). This replaces byobu integration: `CreateSession()` uses plain `tmux new-session` on the runkit server (no byobu dependency). The `runkit` server provides isolation, a custom status bar matching run-kit's dark theme, and byobu-style F-key keybindings (F2/F3/F4). `SessionInfo` carries a `Name` field; `ProjectSession` has `Name` and `Windows` fields. The caller passes the target server name to each tmux operation
- **Multi-server session enumeration** — `ListSessions(ctx, server)` queries the specified tmux server. The API layer calls it once per server (e.g., `runkit` and `default`), merging results. Session-group filtering applies to both servers. See `docs/memory/run-kit/tmux-sessions.md`
- **Derived chrome (not slot injection)** — Single-view model means only one chrome state (terminal-focused). Top bar and bottom bar derive content from the current session:window selection. No `setLine2Left`/`setLine2Right`/`setBottomBar` setters. Split React Context preserved for performance (state vs dispatch).
- **Layout-level SessionProvider (not per-page SSE)** — Single `EventSource` connection at layout level. Eliminates redundant connections and per-page `isConnected` forwarding boilerplate.
- **Single-view layout (sidebar + terminal/dashboard) replaces three pages** — Dashboard and Project page functionality subsumed by the sidebar + Dashboard view. Terminal is the main content on `/:session/:window`; Dashboard renders on `/`. No page transitions.
- **Dashboard as inline component in app.tsx (not separate route layout)** — The Dashboard renders in the terminal area via a conditional branch (`sessionName && windowIndex ? <TerminalClient/> : <Dashboard/>`). This reuses the existing chrome skeleton (top bar, sidebar) and avoids duplicating the app shell layout. Rejected: separate route with dedicated layout — would require lifting sidebar/chrome into a shared layout component and restructuring the route tree.
- **POST-only API client with path-based intent** — Each mutation is a separate function with its own URL (e.g., `killSession(session)` → `POST /api/sessions/:session/kill`). No multiplexed `action` field in request bodies.
- **Sidebar + drawer pattern on mobile** — Desktop sidebar is drag-resizable (default 220px, min 160, max 400, localStorage persist), collapsible. Mobile (< 768px) uses a left-side drawer overlay triggered by `☰`. Preserves session/window tree layout across breakpoints.
- **Prebuilt binaries over build-from-source Homebrew formula** — ship cross-compiled binaries via GitHub Release. Zero build dependencies on user's machine (no Go, Node.js, pnpm). Faster install. Rejected: build-from-source formula (like tu) which requires all build tools. (`260317-ukyz-homebrew-deployment`)
- **`embed.FS` with copy step over restructuring repo** — copy `app/frontend/dist/` into `app/backend/build/frontend/` at build time because Go's `//go:embed` cannot reference files outside the package directory. Simple build-time operation. Rejected: colocating frontend output with Go source (breaks dev workflow). (`260317-ukyz-homebrew-deployment`)
- **VERSION file + ldflags over Go constant** — version sourced from `VERSION` file, injected via `-X main.version=...`. Shell scripts can read/write plain text. No code changes for version bumps. Rejected: Go constant (requires code change per release). (`260317-ukyz-homebrew-deployment`)
- **Cobra over custom CLI parsing** — industry standard, auto-generates help, 5 subcommands is the sweet spot. Rejected: stdlib `flag` (no subcommand support), custom parsing (unnecessary). (`260317-ukyz-homebrew-deployment`)
- **SPA handler dual-mode (embedded FS vs filesystem)** — `hasEmbeddedAssets()` checks whether `frontend/` contains more than `.gitkeep`. Production uses `embed.FS`, dev uses filesystem (Vite handles frontend). Automatic detection, no build tags or env vars needed. (`260317-ukyz-homebrew-deployment`)
- **Active window sync via `history.replaceState` (not `router.replace()`)** — When byobu switches windows, the terminal relay pty already shows the correct content. The UI syncs breadcrumb, URL, and action targets via SSE polling (2.5s). URL updates use `window.history.replaceState()` which is invisible to the router — no re-render, no terminal reinitialization.
- **Sticky modifier state via useRef + forceUpdate** — `useModifierState` uses a ref for the authoritative state and a counter state to trigger re-renders. Ensures `consume()` reads the latest value atomically without stale closure issues.
- **Compose buffer as native textarea (not xterm input)** — xterm renders to `<canvas>`, blocking OS-level input features. The compose buffer provides a real `<textarea>` where dictation, autocorrect, paste, and IME all work. Text sent as a single WebSocket message.
- **Armed modifiers bridge to physical keyboard** — When bottom-bar modifiers (Ctrl/Alt) are armed, a capture-phase `keydown` listener intercepts physical keypresses, translates them to terminal escape sequences (Ctrl+letter → control characters, Alt → ESC prefix), and sends via WebSocket. Prevents xterm from receiving the unmodified key. Ignores real Cmd/Ctrl/Alt held by the OS.
- **File upload via server filesystem (not terminal binary injection)** — Browser uploads file to `POST /api/sessions/:session/upload`, server writes to `.uploads/` in project root, path auto-inserted into compose buffer. Works because run-kit server and tmux are always co-located; the browser is the remote part. Session identified by URL param (consistent with other session-scoped endpoints, replaces legacy form field approach)
- **Handler files split by resource domain (not monolithic routes.go)** — Each handler file owns one resource: `sessions.go`, `windows.go`, `directories.go`, `upload.go`, `sse.go`, `relay.go`, `spa.go`, `health.go`. `router.go` owns middleware, dependency interfaces, and route registration only. (`260312-r4t9-go-backend-api`)
- **Dependency injection via interfaces for handler testability** — `Server` struct holds `SessionFetcher` and `TmuxOps` interfaces, plus `hostname` (computed via `os.Hostname()` in `NewRouter()`, empty string on failure) and `*metrics.Collector` (created and started in `NewRouter()` with the server context). `NewRouter()` wires production implementations; `NewTestRouter()` accepts mocks (including hostname). Enables `httptest.NewRecorder` tests without live tmux. (`260312-r4t9-go-backend-api`)
- **Hostname via health endpoint (not a dedicated endpoint)** — hostname is an OS-level value computed once at startup and stored in `Server` struct. Exposed via `/api/health` response (adding a field to an existing endpoint) rather than a new `GET /api/hostname` route. Minimal surface area, consistent with the single-port architecture. (`260320-uq0k-hostname-browser-title`)
- **Per-window fab enrichment via `fab-go pane-map` (replaces per-session file reading)** — Single `fab-go pane-map --json --all-sessions` subprocess call per SSE tick replaces per-session `.fab-status.yaml` + `.fab-runtime.yaml` file reads. Provides per-window resolution (each worktree window shows its own change/stage) instead of per-session (all windows inherited session-level state). Decouples from internal file formats. `internal/fab` package deleted entirely. (`260313-3vlx-pane-map-enrichment`, supersedes `260312-r4t9-go-backend-api` and `260313-txna-rich-sidebar-window-status` decisions)
- **Backend settings file over localStorage-only** — `~/.rk/settings.yaml` via `internal/settings/` package + `GET/PUT /api/settings/theme` endpoints. Survives browser cache clears, works across devices accessing the same server. localStorage kept as synchronous cache for instant reads before API responds on page load. Simple `key: value` text parsing (not yaml.v3) — one field currently, avoids re-adding a heavyweight dependency. Settings are global (not per-server, no `?server=` param). (`260323-7wys-ansi-palette-theme-rework`)
- **Full ANSI palette over minimal color set** — 22 canonical terminal colors per theme enables three consumers from one source: CSS (8 derived colors via `deriveUIColors`), xterm.js (full 22-color theme via `deriveXtermTheme`), and tmux (auto-themed via ANSI colour indices in static tmux.conf). Rejected: 8-color model with separate xterm colors (duplicative, inconsistent). (`260323-7wys-ansi-palette-theme-rework`)
- **Static tmux.conf with ANSI indices over runtime `tmux set -g`** — tmux.conf uses `colour0`-`colour15` indices. Changing xterm.js palette auto-themes tmux chrome (status bar, pane borders, pane-border-format). Zero backend involvement for theme switching. Rejected: runtime tmux commands (complex, fragile, requires backend communication). (`260323-7wys-ansi-palette-theme-rework`)
- **Separate SSE event type for metrics (`event: metrics`) over embedding in sessions payload** — Metrics are server-wide (one payload for all clients), while sessions are per-tmux-server and deduplicated. CPU samples change every tick (dedup logically impossible). Separation avoids inflating session payloads and allows independent evolution. Rejected: embedding in sessions payload (sent N times per server, complicates dedup). (`260411-z63r-sidebar-host-window-panels`)
- **Server-side ring buffer with full history per tick over client-side accumulation** — New SSE clients immediately get complete 60-sample CPU sparkline history. No reconnection logic needed to rebuild history. At 60 float64s, ~500 bytes per tick is negligible. Rejected: client-side accumulation from deltas (reconnection complexity, frontend state management). (`260411-z63r-sidebar-host-window-panels`)
- **procfs direct reading over external monitoring tools** — `internal/metrics` reads `/proc/stat`, `/proc/meminfo`, `/proc/loadavg`, `/proc/uptime` directly. No dependency on `top`, `htop`, or monitoring agents. `syscall.Statfs` for disk. All readers return zero values on non-Linux (macOS dev graceful degradation). No new Go dependencies. (`260411-z63r-sidebar-host-window-panels`)

## Testing

### Go Unit Tests

Go `testing` package with table-driven tests. Test files co-located with source using `_test.go` suffix. Test scripts: `go test ./...` from `app/backend/`.

Current Go test coverage (`app/backend/`):
- **Internal packages**: `internal/validate` (input validation + tilde expansion + filename sanitization), `internal/config` (env var reading, port validation, defaults), `internal/tmux` (listSessions parsing + byobu filtering, listWindows activity computation), `internal/sessions` (pane-map JSON parsing, per-window fab field join, graceful degradation on pane-map failure, nonexistent binary error)
- **CLI command tests**: `cmd/run-kit/root_test.go` (no-args defaults to serve), `cmd/run-kit/version_test.go` (version output format), `cmd/run-kit/doctor_test.go` (LookPath-based dependency check)
- **Handler integration tests**: `api/health_test.go`, `api/sessions_test.go`, `api/windows_test.go`, `api/directories_test.go`, `api/upload_test.go`, `api/sse_test.go`, `api/spa_test.go` — all use `httptest.NewRecorder` with the chi router and mock `SessionFetcher`/`TmuxOps` interfaces for tmux isolation. Cover response shapes, validation errors, URL param parsing, content-type enforcement. `api/relay.go` has no unit test (requires live tmux + PTY)

### Frontend Unit Tests (app/frontend/)

Vitest with jsdom environment. Config at `app/frontend/vitest.config.ts`. MSW mocks all API endpoints and the SSE stream (`app/frontend/tests/msw/handlers.ts`). Test files co-located with source using `.test.{ts,tsx}` suffix.

Test coverage includes: sidebar (expand/collapse, window selection, kill session, activity dots, duration display, info popover), breadcrumb dropdowns (open/close, selection), drawer (open via hamburger, close on selection), command palette (Cmd+K), modifier state, touch targets (44px on `coarse`), API client (correct URL construction for each endpoint).

### Playwright E2E Tests (app/frontend/tests/e2e/)

Thin suite (3-5 tests) for API round-trip validation. Config at `app/frontend/playwright.config.ts`. Self-managed tmux sessions in `beforeAll`/`afterAll` hooks.

E2E test coverage: create/kill session via UI, SSE stream delivers real data, sidebar navigation, sidebar window sync (external window creation/rename reflected within 5000ms, kill-then-create at same index does not suppress new window via stale optimistic context).

## Security

- All subprocess calls use `os/exec.CommandContext` with argument slices (never `sh -c` or shell strings)
- All `exec.CommandContext` calls include timeout via `context.WithTimeout` (10s tmux, 30s build). Terminal relay attach uses `context.WithCancel` (long-lived, cancelled on disconnect)
- User input validated via `internal/validate` before reaching any subprocess
- Directory listing restricted to `$HOME` via `ExpandTilde()` — rejects `..` traversal, absolute paths outside home, and `~username` syntax. Symlinks under `$HOME` are not resolved (accepted risk for local dev tool)
- File uploads: filename sanitized via `SanitizeFilename()` (strips path separators, null bytes, leading dots, collapses dot sequences); 50MB size limit enforced server-side via `http.MaxBytesReader`; writes via `os.Create` (not subprocess)
- CORS: permissive by default (`*` origin) for multi-client API flexibility. TLS handled by Tailscale Serve in production

## Changelog

| Date | Change | Reference |
|------|--------|-----------|
| 2026-03-02 | Initial architecture — greenfield v1 | `260302-fl88-web-agent-dashboard` |
| 2026-03-03 | Removed `run-kit.yaml` config — derive project state from tmux | `260303-yohq-drop-config-derive-from-tmux` |
| 2026-03-03 | Added `killSession` API action — kills entire tmux session | `260303-vag8-unified-top-bar` |
| 2026-03-03 | Configurable port/host binding via `config.ts` + `run-kit.yaml` | `260303-q8a9-configurable-port-host` |
| 2026-03-03 | Relay port via server component prop (replaced build-time env var) | — |
| 2026-03-03 | Filter byobu session-group copies from `listSessions()` | — |
| 2026-03-05 | Added Vitest testing infrastructure with validate, config, and command-palette tests | `260303-07iq-setup-vitest` |
| 2026-03-05 | Added feature tests for tmux.ts, use-keyboard-nav.ts, and api/sessions POST handler | `260305-vq7h-feature-tests-tmux-keyboard-api` |
| 2026-03-05 | Added `/api/directories` endpoint, `createSession` CWD support, `expandTilde` security boundary | `260305-zkem-session-folder-picker` |
| 2026-03-06 | Chrome architecture — layout-owned flex-col skeleton, ChromeProvider context, TopBarChrome, icon breadcrumbs, always-visible kill buttons | `260305-emla-fixed-chrome-architecture` |
| 2026-03-06 | Bottom bar (modifier toggles, arrow keys, Fn dropdown, compose buffer), iOS keyboard support via visualViewport, `i` key compose toggle | `260305-fjh1-bottom-bar-compose-buffer` |
| 2026-03-06 | Performance: parallel session enrichment, SSE pub/sub singleton, split ChromeContext, layout-level SessionProvider, ResizeObserver debounce, useModifierState memoization, WS reconnection | `260306-0ahl-perf-sse-chrome-sessions` |
| 2026-03-07 | iOS touch scroll prevention — fullbleed class toggle on html, touch-none on terminal container | `260307-8n60-fix-ios-terminal-touch-scroll` |
| 2026-03-07 | File upload: `/api/upload` endpoint, clipboard paste/drag-drop/file picker triggers, compose buffer integration, `.uploads/` auto-gitignore | `260307-kqio-image-upload-claude-terminal` |
| 2026-03-07 | iOS keyboard viewport overlap fix — visualViewport scroll listener, fixed positioning in fullbleed mode | `260307-f3o9-ios-keyboard-viewport-overlap` |
| 2026-03-07 | Sync byobu active tab — `isActiveWindow` on `WindowInfo`, breadcrumb/URL/action sync via SSE + `history.replaceState` | `260307-f3li-sync-byobu-active-tab` |
| 2026-03-07 | Breadcrumb type extended with `dropdownItems` for project/window switching dropdowns | `260307-uzsa-navbar-breadcrumb-dropdowns` |
| 2026-03-07 | Playwright E2E tests — chrome stability, breadcrumbs, bottom bar, compose buffer, kill button, mobile viewport | `260305-r7zs-playwright-e2e-design-spec` |
| 2026-03-10 | **Go backend + Vite SPA split** — replaced Next.js monolith with Go backend + Vite React SPA. Single-port architecture (API, SSE, WebSocket relay, SPA static serving on one Go binary). chi router, gorilla/websocket, creack/pty. TanStack Router for client-side routing. Typed API client module. Go table-driven tests ported from Vitest. E2E tests updated for Go + Vite dev servers. | `260310-8xaq-go-backend-vite-spa-split` |
| 2026-03-12 | **Go backend API at `app/backend/`** — handler files split by resource domain (sessions.go, windows.go, etc.). POST-only mutations with path-based intent. `internal/fab` rewritten to read `.fab-status.yaml` directly (no subprocess). Per-session fab enrichment model. `WindowInfo` fields changed: `FabChange`/`FabStage` replace `FabStage`/`FabProgress`. Upload endpoint session from URL path. Handler integration tests via `httptest.NewRecorder` + mock interfaces. SPA serves from `app/frontend/dist/`. | `260312-r4t9-go-backend-api` |
| 2026-03-12 | **Vite/React frontend at `app/frontend/`** — single-view UI (sidebar + terminal, one route `/:session/:window`), POST-only API client with path-based intent, ChromeProvider derives from selection (no slot injection), sidebar with session/window tree + mobile drawer, MSW-backed Vitest, Playwright E2E at `app/frontend/tests/e2e/` | `260312-ux92-vite-react-frontend` |
| 2026-03-12 | **Cleanup old implementation** — removed legacy backend and frontend directories, `e2e/`, root `playwright.config.ts`. Updated `pnpm-workspace.yaml` to `["app/frontend"]`. Removed legacy test sections and stale path references from memory. | `260312-n11e-cleanup-old-implementation` |
| 2026-03-12 | **UI chrome layout refinements** — bottom bar moved inside terminal column (width tracks terminal, not viewport). Sidebar drag-resizable (default 220px, min 160, max 400, localStorage persist). Top bar `border-b`, bottom bar `border-t`. Breadcrumbs simplified to `☰ {logo} ❯ session ❯ window`. `[+ Session]` button added to top bar line 2. | `260312-y4ci-ui-chrome-layout-refinements` |
| 2026-03-13 | **Rich sidebar window status** — Backend: `internal/tmux` adds `PaneCommand` + `ActivityTimestamp` to `WindowInfo` via 6-field tmux format string. New `internal/fab/runtime.go` reads `.fab-runtime.yaml` for agent idle state. `internal/sessions` enriches with runtime state (cached per project root via `sync.Map`). Frontend: sidebar window rows gain activity dot ring, idle duration, info popover. Top bar Line 2 enriched with paneCommand, duration, fab change ID+slug. Shared helpers in `lib/format.ts`. | `260313-txna-rich-sidebar-window-status` |
| 2026-03-13 | **Env var config** — replaced `run-kit.yaml` with `.env`/`.env.local` (direnv). Go and Vite read `RK_PORT`/`RK_HOST` directly. Dev mode: Vite on `RK_PORT`, Go on `PORT+1` (translated by `dev.sh`). Prod: Go on `RK_PORT`. All entry points accept `--port`. Removed CLI flag parsing and YAML config from Go. | — |
| 2026-03-13 | **Removed single-key shortcuts** — deleted `useKeyboardNav` (j/k/Enter sidebar nav), `useAppShortcuts` (c/r/Esc Esc), sidebar `focusedIndex` prop and focus ring styling. Cmd+K is now the sole keyboard shortcut. Palette actions no longer display shortcut hints. | `260313-3brm-remove-single-key-shortcuts` |
| 2026-03-14 | **Relay session validation** — relay handler validates session/window exist before attaching PTY. Returns WebSocket close code `4004` for missing session or window (distinct from `4001` PTY failure). Frontend handles `4004` by navigating to `/` instead of reconnecting. Prevents infinite reconnect loops when navigating to a non-existent tmux session. | — |
| 2026-03-14 | **Pane-map enrichment** — replaced per-session `.fab-status.yaml` + `.fab-runtime.yaml` file reading with single `fab-go pane-map --json --all-sessions` subprocess call. Per-window fab state (change, stage, agent state, idle duration) instead of per-session. Deleted `internal/fab/` package (4 files). `internal/sessions` simplified: removed `enrichSession()`, `hasFabKit()`, `runtimeCache sync.Map`. New `fetchPaneMap(repoRoot)` + map join. | `260313-3vlx-pane-map-enrichment` |
| 2026-03-14 | ~~**Byobu session creation**~~ — Superseded by dedicated tmux server (`260318-0gjh-dedicated-tmux-server`). `CreateSession()` now uses plain `tmux new-session` on the `runkit` server with its own config (`internal/tmux/tmux.conf`). | — |
| 2026-03-14 | **Top bar & bottom bar refresh** — Top bar: hamburger icon (☰→✕ animation) replaces logo as toggle, `/` separator replaces `❯`, session/window names are dropdown triggers, session name max 7ch. Right section: logo (decorative) + "Run Kit" + green dot (no text) + toggle + ⌘K + >_ compose. Mobile: ⋯ + >_. Bottom bar: removed Cmd modifier and compose button, sizes increased to 36px/44px. `onOpenCompose` moved from BottomBarProps to TopBarProps. | `260314-9raw-top-bar-bottom-bar-refresh` |
| 2026-03-15 | **Dashboard view** — `/` renders `Dashboard` component inline in `app.tsx` terminal area (not a separate route layout). Expandable session cards with window cards, stats line, create buttons. Bottom bar conditionally rendered (terminal pages only). Top bar adapts: shows "Dashboard" text on `/`, breadcrumbs on `/:session/:window`. Sidebar session name click navigates to first window; chevron toggles expand/collapse. All kill operations and stale URL detection redirect to `/`. Auto-redirect from `/` to first session removed. | `260313-ll1j-dashboard-project-page-views` |
| 2026-03-15 | **Per-region scroll behavior** — Dashboard restructured: pinned stats line (`shrink-0`) + scrollable card area (`flex-1 min-h-0 overflow-y-auto`). `useVisualViewport` hook manages `fullbleed` class lifecycle on `<html>` (add on mount, remove on cleanup). Static `fullbleed` in `index.html` serves as FOUC prevention. | `260315-lnrb-dashboard-scroll-behavior` |
| 2026-03-17 | **Homebrew deployment system** — Cobra CLI with subcommands. `embed.FS` bundles frontend into single binary. `VERSION` file + ldflags injection. `scripts/build.sh` (frontend-first build), `scripts/release.sh` (semver bump + tag). GitHub Actions CI/CD cross-compiles 4 targets (darwin/linux x arm64/amd64) on `v*` tag push, creates GitHub Release with tarballs. SPA handler dual-mode: embedded FS (production) or filesystem (dev). | `260317-ukyz-homebrew-deployment` |
| 2026-03-18 | **Light theme support** — ThemeProvider context (outermost, split pattern) with three modes (system/light/dark). CSS `data-theme` attribute on `<html>` switches color tokens via `globals.css` selectors. Blocking inline script in `index.html` for no-flicker init. xterm terminal theme updates live. Theme switcher in command palette. Provider tree: `ThemeProvider > ChromeProvider > SessionProvider > AppShell`. | `260318-eseg-add-light-theme-support` |
| 2026-03-18 | **Dedicated tmux server** — All run-kit sessions live on a named tmux server `runkit` (via `tmux -L runkit`). `internal/tmux` commands prefixed with `-L runkit` and optional `-f` from `RK_TMUX_CONF` env var. `ListSessions()` queries both runkit and default servers, returning `SessionInfo` with `Server` field. `ListWindows()` accepts server parameter. `CreateSession()` uses plain `tmux new-session` on runkit server (byobu dependency removed, `sync.OnceValue` detection deleted). `ProjectSession` type gains `Server` field. Relay attaches to runkit server. New `internal/tmux/tmux.conf` with dark-themed status bar and F2/F3/F4 keybindings. Frontend: `ProjectSession` type gains `server` field, sidebar shows `↗` marker for default-server sessions. | `260318-0gjh-dedicated-tmux-server` |
| 2026-03-20 | **Multi-server relay + config reload** — `RK_TMUX_CONF` resolved to absolute path at init (fixes CWD-dependent config loading). Relay and select-window endpoints accept `?server=` query param to route to runkit or default tmux server (fixes default-server sessions not connecting). `SelectWindowOnServer()` added. `ReloadConfig(server)` hot-reloads tmux config via `source-file`. New `POST /api/tmux/reload-config` endpoint + `reloadTmuxConfig(server)` client function + "Reload tmux config" command palette action (targets current session's server). `tmuxExec`/`tmuxExecDefault` capture stderr in error messages. `TerminalClient` accepts `server` prop. | `260318-0gjh-dedicated-tmux-server` |
| 2026-03-20 | **Hostname in browser title** — `Server` struct gains `hostname` field (computed once via `os.Hostname()` in `NewRouter()`, empty string fallback). `/api/health` response extended to `{"status":"ok","hostname":"..."}`. New `getHealth()` API client function. `useBrowserTitle` hook sets `document.title` dynamically: `RunKit — {hostname}` on Dashboard, `{session}/{window} — {hostname}` on terminal pages. Hostname suffix omitted when empty. | `260320-uq0k-hostname-browser-title` |
| 2026-03-20 | **PWA compliance** — `vite-plugin-pwa` with autoUpdate, manifest from plugin config (standalone display, dark theme colors), Workbox service worker (precache static, NetworkOnly for API/WebSocket), iOS meta tags, theme-color sync. No backend changes. | `260320-j9a2-pwa-compliance` |
| 2026-03-20 | **Release pipeline + update command** — `release.sh` rewritten (fab-kit/tu style). CI generates `Formula/rk.rb` in `sahil87/homebrew-tap` from `.github/formula-template.rb` (sed placeholder substitution for version + SHA256s) via `BUILD_TOKEN` secret. Public repo — plain URL downloads, no auth token needed. `upgrade` subcommand renamed to `update` (alias: `upgrade`): checks latest via `brew info --json=v2 sahil87/tap/rk`, skips if up-to-date, shows version transition. | — |
| 2026-03-20 | **Single-active-server model** — Replaced dual-server merge with single-server-at-a-time. Backend stateless: `?server=` on every request, defaults to `"default"`. Unified `tmuxExec`/`tmuxExecDefault` into `tmuxExecServer`. All tmux functions accept `server` param. `serverFromRequest()` validates names. New `ListServers()` (socket scan), `KillServer()`. SSE hub polls per-server. Removed `SessionInfo.Server`, `ProjectSession.Server`. New `GET/POST /api/servers`, `POST /api/servers/kill`. Frontend: `SessionProvider` manages server state (localStorage `runkit-server`), sidebar server dropdown, palette commands (Create/Kill/Switch server). `setServerGetter()` mechanism appends `?server=` to all API calls. | `260320-1335-tmux-server-switcher` |
| 2026-03-20 | **Daemon lifecycle** — Replaced `supervisor.sh` (polling loop + `.restart-requested` signal file) with CLI-driven daemon management. New `internal/daemon/` package with `IsRunning`/`Start`/`Stop`/`Restart` helpers using `exec.CommandContext`. `run-kit serve` gains `-d` (start daemon, errors if running), `--restart` (idempotent stop+start), `--stop` (graceful C-c) flags — mutually exclusive. Daemon runs in dedicated tmux server `rk-daemon` (session `rk`, window `serve`), separate from agent `runkit` server. `run-kit update` auto-restarts daemon after successful `brew upgrade`. Justfile `up`/`down`/`restart` recipes updated. Constitution Self-Improvement Safety section rewritten. | `260320-hkm8-daemon-lifecycle-serve` |
| 2026-03-20 | **UI polish, tmux config, keyboard shortcuts** — Embed restructured from `app/backend/frontend/` to `app/backend/build/` (package `build`, `//go:embed all:frontend`). Breadcrumb left-aligned (removed `justify-center`). `EnsureConfig()` auto-creates `~/.run-kit/tmux.conf` on serve startup. `-f` config flag scoped to `CreateSession`/`ReloadConfig` via `configArgs()`. Enhanced `internal/tmux/tmux.conf`: `escape-time 0`, `history-limit 50000`, `renumber-windows on`, `base-index 1`, explicit `prefix C-s`, pane splits (`prefix+\|`/`prefix+-`), pane navigation (`S-F3`/`S-F4`), `F8` rename, `S-F7` copy-mode. Sidebar server dropdown gains `+ tmux server` action. Hostname in bottom bar (hidden on mobile). Aligned sidebar footer and bottom bar heights (`h-[48px]`). Server label changed to "tmux server:". Kill server handles socket teardown gracefully. New `GET /api/keybindings` endpoint — runs `tmux list-keys`, filters via whitelist map, returns `[{key, table, command, label}]`. New "Keyboard Shortcuts" command palette action opens modal showing curated bindings grouped by key table (prefix vs root). | `260320-9ldy-ui-polish-tmux-config-embed` |
| 2026-03-23 | **ANSI palette theme rework** — New `internal/settings/` package for backend settings persistence at `~/.rk/settings.yaml` (simple key:value parsing, no yaml.v3). New `GET/PUT /api/settings/theme` endpoints in `api/settings.go`. Frontend: `getThemePreference()`/`setThemePreference()` API client functions (not per-server). ThemeProvider uses API as canonical source with localStorage as synchronous cache. tmux.conf reworked from hardcoded hex to ANSI `colour{N}` indices for auto-theming via xterm.js palette. | `260323-7wys-ansi-palette-theme-rework` |
| 2026-03-27 | **Bundle & loading performance** — Lazy-load `CommandPalette`, `ThemeSelector`, `CreateSessionDialog` via `React.lazy()` + `<Suspense fallback={null}>` (named export re-wrapping). Vite `manualChunks` splits xterm family and TanStack Router into separate vendor chunks. API request deduplication via `deduplicatedFetch` wrapper with in-flight `Map<string, Promise<Response>>` — GET-only, URL-keyed, `.finally()` cleanup, `Response.clone()` for multi-consumer safety. | `260327-uyj5-perf-bundle-loading` |
| 2026-03-28 | **tmux prefix key change** — Changed tmux prefix from `C-b` to `C-s` in `configs/tmux/default.conf` and `configs/tmux/simple.conf` to avoid conflict with Claude Code's `Ctrl+B` shortcuts. Added `unbind C-b` and `bind-key C-s send-prefix`. Frontend keyboard shortcuts label updated from `Ctrl+B, ` to `Ctrl+S, `. `byobu.conf` (`C-a`) and `poweruser.conf` (`C-s`) unchanged. | `260328-d7s5-change-tmux-prefix` |
| 2026-03-28 | **Multi-file tmux config sourcing** — `~/.rk/tmux.d/` drop-in directory for user extensions. `configs/tmux/default.conf` appends `source-file -q ~/.rk/tmux.d/*.conf` (lexicographic order, `-q` silences empty/missing dir). `EnsureConfig()`, `ForceWriteConfig()`, and `rk init-conf` all create the directory idempotently. `EnsureConfig()` creates `tmux.d/` even when config already exists. `ReloadConfig()` unchanged — transitive sourcing picks up new drop-ins. | `260328-wxrh-source-rk-tmux-configs` |
| 2026-04-04 | **Window move & reorder** — New `SwapWindow(session, srcIndex, dstIndex, server)` in `internal/tmux` wrapping `tmux swap-window`. New `POST /api/sessions/:session/windows/:index/move` endpoint (`handleWindowMove` in `windows.go`) with `{"targetIndex": N}` body. `TmuxOps` interface extended with `SwapWindow`. New `moveWindow(session, index, targetIndex)` client function. CmdK "Window: Move Left/Right" actions (excluded at boundary). Sidebar drag-and-drop window reordering via native HTML5 DnD (same-session only). | `260404-29qz-window-move-reorder` |
| 2026-04-05 | **Left panel window sync fix + E2E** — `use-optimistic-action.ts` fix: `onSettled`/`onRollback` moved before `mountedRef` guard so they always fire, preventing stale `killed` entries when the sidebar component unmounts before the kill API resolves. New E2E test `sidebar-window-sync.spec.ts` (3 scenarios: external window creation, rename, kill-then-create at same index). | `260405-2a2k-left-panel-window-sync` |
| 2026-04-05 | **Sidebar window state Zustand** — Window optimistic state migrated from index-based `OptimisticContext` to Zustand store (`app/frontend/src/store/window-store.ts`). `zustand` added as production dependency in `app/frontend/package.json`. `WindowInfo` type gains `windowId: string` (non-optional); backend adds `#{window_id}` as first field in `ListWindows()` format string (7 fields total, field 0 = `WindowID`). `OptimisticContext` slimmed to session/server scope. `MergedWindow` moved to `window-store.ts`. Ghost reconciliation uses `snapshotWindowIds` set-difference. Frontend unit tests: `window-store.test.ts` added, `optimistic-context.test.tsx` stripped of window test cases. | `260405-x3yt-sidebar-window-state-zustand` |
| 2026-04-11 | **Sidebar Host & Window panels + metrics collector** — New `internal/metrics/` package reads procfs for CPU (ring buffer 60 samples), memory, load, disk, uptime; `Collector` runs background goroutine at `ssePollInterval`. SSE hub gains `event: metrics` event type broadcast to all clients every tick (server-independent, not deduplicated). `Server` struct holds `*metrics.Collector`, created and started in `NewRouter()`. Frontend: `SessionProvider` listens for `metrics` SSE event, exposes `MetricsSnapshot | null` via context. New sidebar components: `CollapsiblePanel` (reusable), `WindowPanel` (refactored from StatusPanel), `HostPanel` (5-line metrics display with braille sparkline, gauge bar, load percentages, disk+uptime). New utility modules: `lib/sparkline.ts` (braille 8-level mapping), `lib/gauge.ts` (block gauge + color thresholds + byte formatting). Hostname removed from bottom bar — now in HostPanel exclusively. | `260411-z63r-sidebar-host-window-panels` |
