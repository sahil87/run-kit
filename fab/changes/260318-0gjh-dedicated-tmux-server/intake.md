# Intake: Dedicated Tmux Server

**Change**: 260318-0gjh-dedicated-tmux-server
**Created**: 2026-03-18
**Status**: Draft

## Origin

> Replace byobu dependency with a dedicated tmux server owned by run-kit. Ship a custom tmux.conf with byobu-like aesthetics but a reduced status bar. Add `-L runkit -f <path>` to all tmux commands. Query both the run-kit server and the default tmux server in ListSessions. Replace the `byobu` bool with a `server` string. In the sidebar, remove the green "b" marker and show a dimmed ↗ arrow icon next to external/default-server sessions. Drop the hasByobu() check and byobu dependency from CreateSession.

This change was preceded by an extensive `/fab-discuss` session exploring the tmux server architecture. Key discussion points and decisions:

- **User wants control over the status bar** — byobu's status bar has too many items and the user wants to reduce it
- **Option B chosen** — dedicated `-L runkit` server for run-kit sessions + default server discovery for visibility into user-created sessions
- **↗ arrow icon chosen over text markers** — run-kit sessions get no marker (home), external sessions get a dimmed `↗`
- **"b" marker to be removed entirely** — byobu field no longer relevant

## Why

1. **No control over status bar**: Byobu manages its own status bar via `~/.byobu/status` and `~/.byobu/statusrc`. run-kit cannot customize it without modifying user-level config files that affect all byobu sessions on the machine.

2. **External dependency**: Byobu must be installed on the host. If missing, sessions fall back to plain tmux with no status bar customization at all. Shipping a tmux.conf in the repo makes the experience self-contained.

3. **No isolation**: Currently all sessions (run-kit-created and user-created) share the default tmux server. This means run-kit can't set server-level tmux options without affecting the user's personal tmux environment.

4. **Session group complexity**: Byobu creates session groups on attach, requiring filtering logic in `ListSessions` to hide derived copies (see `docs/memory/run-kit/tmux-sessions.md`). With a dedicated server and no byobu, this complexity goes away for run-kit-created sessions. (Session group filtering may still be needed for default server sessions if the user runs byobu there.)

## What Changes

### 1. Ship a `tmux.conf` in the repo

Create `config/tmux.conf` with byobu-like aesthetics but a reduced status bar:

- Status bar colors matching the run-kit dark theme (`#0f1117` bg, `#e8eaf0` text, `#5b8af0` accent)
- Minimal `status-left`: session name only
- Minimal `status-right`: hostname + time (or even less — user can iterate)
- `default-terminal "tmux-256color"` for proper color support
- `mouse on` for mouse support
- Key bindings: F2 new-window, F3/F4 prev/next-window (the byobu bindings the user is accustomed to)
- No CPU, memory, network, load average, or other byobu status scripts

### 2. Add `-L runkit -f <path>` to tmux command helpers

In `app/backend/internal/tmux/tmux.go`:

- Read the config path from an environment variable (e.g., `RK_TMUX_CONF`) set by the scaffolding (`just dev`, direnv via `.env`/`.env.local`). The built binary requires the user to set this env var (or eventually pass `--tmux-conf` once CLI flags are implemented). This follows the existing `RK_PORT`/`RK_HOST` pattern — scripts translate user-facing env vars, Go reads them at startup.
- Modify `tmuxExec(ctx, args...)` to prepend `-L runkit -f <configPath>` to all args
- Modify `tmuxExecRaw(ctx, args...)` the same way
- The `-f` flag is only read when the server first starts (first session creation). Subsequent commands just need `-L runkit` to target the right server. However, passing `-f` on every command is harmless — tmux ignores it if the server is already running.

### 3. Update relay.go attach command

In `app/backend/api/relay.go`:

- The `tmux attach-session -t <session>` command (line ~106) needs `-L runkit` added
- This is separate from `tmuxExec` because relay builds its own `exec.CommandContext` directly

### 4. Multi-server session listing

In `app/backend/internal/tmux/tmux.go`:

- `ListSessions()` currently queries one server. Change it to query both:
  1. Query the run-kit server (`-L runkit`) — tag results with `Server: "runkit"`
  2. Query the default server (no `-L` flag) — tag results with `Server: "default"`
  3. Merge results, deduplicating if needed
- For the default server query, use a separate `exec.CommandContext(ctx, "tmux", "list-sessions", ...)` call without the `-L` flag — this must bypass the `tmuxExec` helper which will add `-L runkit`
- Expose a new helper (e.g., `tmuxExecDefault`) or accept a server parameter

### 5. Replace `byobu` bool with `server` string in types

**Backend** (`app/backend/internal/tmux/tmux.go`):
- `SessionInfo` struct: replace `Byobu bool` with `Server string` (values: `"runkit"`, `"default"`)
- JSON tag: `json:"server"`

**Backend** (`app/backend/internal/sessions/sessions.go`):
- `ProjectSession` struct: replace `Byobu bool` with `Server string`
- JSON tag: `json:"server"`

**Frontend** (`app/frontend/src/types.ts`):
- `ProjectSession` type: replace `byobu: boolean` with `server: "runkit" | "default"`

### 6. Update sidebar UI — remove "b" marker, add ↗ for external sessions

In `app/frontend/src/components/sidebar.tsx`:

- Remove the existing byobu marker:
  ```tsx
  // REMOVE:
  {session.byobu && (
    <span className="text-[10px] text-accent-green/70 shrink-0" aria-label="byobu session">b</span>
  )}
  ```

- Add external session marker:
  ```tsx
  {session.server === "default" && (
    <span className="text-[10px] text-text-tertiary shrink-0" aria-label="external session">↗</span>
  )}
  ```

- Run-kit sessions (`server === "runkit"`) get no marker — they are the "home" sessions.

### 7. Drop byobu dependency from CreateSession

In `app/backend/internal/tmux/tmux.go`:

- Remove the `hasByobu` `sync.OnceValue` variable
- Remove the byobu branch in `CreateSession()` — always use `tmuxExec(ctx, "new-session", "-d", "-s", name, ...)` which will route through the `-L runkit` server
- The `exec.LookPath("byobu")` import can be removed

### 8. Update session group filtering

- For run-kit server sessions: byobu session groups won't exist (no byobu), so the `session_grouped` filtering is unnecessary for these. However, keep the filtering logic active since it's harmless and the default server may still have byobu groups.
- The `SessionInfo.Byobu` field was used to display the "b" marker — this is replaced by the `Server` field logic.

### 9. Update tests

- `app/backend/internal/tmux/tmux_test.go`: Update `parseSessions` tests to verify `Server` field instead of `Byobu` field
- `app/backend/internal/sessions/sessions_test.go`: Update `ProjectSession` assertions for `Server` field
- `app/frontend/src/components/sidebar.test.tsx`: Remove byobu marker test, add external session marker test
- MSW handlers (`app/frontend/tests/msw/handlers.ts`): Update mock session data to use `server` field

### 10. Update Dashboard component

`app/frontend/src/components/dashboard.tsx` may reference `session.byobu` — update to use `session.server` if applicable.

## Affected Memory

- `run-kit/architecture`: (modify) Update design decisions (byobu session creation → dedicated tmux server), update `internal/tmux` package description, add tmux.conf to repo structure
- `run-kit/tmux-sessions`: (modify) Update session enumeration to reflect multi-server approach, update `CreateSession` description (no more byobu), note session group filtering changes
- `run-kit/ui-patterns`: (modify) Update sidebar session rows (remove "b" marker, add ↗ for external sessions)

## Impact

- **Backend**: `internal/tmux/tmux.go` (major — command helpers, session listing, session creation), `api/relay.go` (minor — add `-L runkit` to attach), `internal/sessions/sessions.go` (minor — type change)
- **Frontend**: `types.ts` (type change), `sidebar.tsx` (marker change), `dashboard.tsx` (type change), MSW handlers (mock data)
- **New file**: `config/tmux.conf`
- **Dependencies**: Byobu is no longer required on the host. tmux is still required.
- **Breaking**: The `byobu` field in the API response changes to `server`. Any external consumers of `/api/sessions` would need to update. (Currently no known external consumers.)

## Open Questions

- What specific status bar items should the tmux.conf include? (Session name + time is the minimum discussed. User can iterate after seeing the initial version.)
- ~~Should the config path be relative to CWD or derived from the binary location?~~ Resolved: env var (`RK_TMUX_CONF`), set by scaffolding (just/direnv), overridable by the user for the built binary.
- Should we include F-key bindings in the tmux.conf to match byobu's UX, or keep it minimal? (Discussed including F2/F3/F4 — these are the most commonly used byobu bindings.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use `-L runkit` named socket for server isolation | Discussed — user explicitly chose option B (dedicated server + default server discovery) | S:95 R:80 A:95 D:95 |
| 2 | Certain | Remove byobu "b" marker from sidebar | Discussed — user explicitly said "b marker can be removed" | S:95 R:90 A:95 D:95 |
| 3 | Certain | Use ↗ arrow icon for external sessions, no marker for run-kit sessions | Discussed — user explicitly chose "Arrow icon better" over text markers | S:95 R:90 A:95 D:95 |
| 4 | Certain | Drop byobu dependency from CreateSession | Discussed — always use plain tmux with `-L runkit` | S:90 R:70 A:90 D:90 |
| 5 | Confident | Config file at `config/tmux.conf` relative to repo root | Repo convention — config files go in a config directory. CWD-relative path is simplest | S:60 R:85 A:75 D:70 |
| 6 | Confident | Include F2/F3/F4 byobu-style keybindings in tmux.conf | Discussed — user wants behavior "close to byobu" with further changes on top | S:70 R:90 A:70 D:75 |
| 7 | Confident | Keep session group filtering for default server sessions | Defensive — default server may still have byobu groups. Filtering is harmless | S:60 R:85 A:80 D:80 |
| 8 | Confident | Status bar colors match run-kit dark theme tokens | Consistent with project's visual design language. Easily changed later | S:65 R:90 A:80 D:75 |
| 9 | Certain | Config path via env var (`RK_TMUX_CONF`), set by scaffolding, overridable by user | Discussed — user clarified: rely on env vars (consistent with RK_PORT/RK_HOST pattern), scaffolding sets them, binary user overrides | S:95 R:85 A:90 D:95 |

9 assumptions (5 certain, 4 confident, 0 tentative, 0 unresolved).
