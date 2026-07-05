# Intake: Server Tiles Drag Reorder

**Change**: 260705-bpnr-server-tiles-drag-reorder
**Created**: 2026-07-05

## Origin

Backlog item `[bpnr]` (fab/backlog.md, 2026-07-05), created via `/fab-new bpnr backlog` (interactive):

> Allow reorganizing (dragging/rearranging) servers in the server tiles. This should impact the server tree below in the SESSIONS panel also. Ideally save the order for tiles using tmux server vars

Four design points were resolved in discussion with the user at intake time:

1. **Persistence** — per-server rank var (`@rk_server_rank` on each tmux server), not a replicated JSON list or a filesystem file.
2. **Drag surfaces** — both tile grids (sidebar Server-panel tiles AND the Cockpit `/` TMUX SERVERS grid); the SESSIONS-tree server groups and palette entries follow the order but are not drag surfaces.
3. **Infra servers** — `rk-daemon` / `rk-test-*` are excluded from reordering and stay pinned last as a class (preserving PR #311's de-emphasis).
4. **Keyboard parity** — the user explicitly EXPANDED scope: add command-palette **Move up / Move down** actions not only for servers but **also for sessions and windows**, closing the Constitution V gap that session drag-reorder (PR #240) left open.

The branch was rebased onto `origin/main` at intake time specifically to absorb PR #311 ("De-emphasize Infrastructure Tmux Servers", commit 495d81e), which landed the ordering architecture this change composes with.

## Why

1. **Pain point**: Server tiles and the SESSIONS-panel server tree render in fixed alphabetical order (within #311's regular/infra classes). Operators running several tmux servers cannot put their primary workspace first — the servers they touch most may sort under ones they rarely open. Sessions already got user-controlled ordering (PR #240); servers are the remaining unordered level of the hierarchy.
2. **Consequence of not fixing**: Every sidebar glance and Cockpit visit pays a scan cost; muscle memory can't form because creating/killing a server (e.g. `zebra-api` → sorts last, `alpha-scratch` → sorts first) reshuffles neighbors. The inconsistency with draggable sessions also makes the UI feel arbitrarily half-finished.
3. **Why this approach**: Per-server rank vars keep order data riding with each server (a killed server takes only its own rank; no cross-server merge rule needed), match the backlog's explicit "tmux server vars" preference, satisfy Constitution II (state derived from tmux at request time), and mirror the shipped `@rk_session_order` mechanism. The palette Move up/down commands close a real Constitution V violation ("every user-facing action MUST be reachable via keyboard") that currently exists for all three reorder actions, and incidentally give touch devices a reorder path (HTML5 DnD never fires on touch).

## What Changes

### Backend: `@rk_server_rank` persistence + order endpoint

- New tmux user option **`@rk_server_rank`** (server-scoped, integer as string) on each tmux server, read/written with the exact mechanism of `SessionOrderOption` (`app/backend/internal/tmux/tmux.go:1608-1670`): `show-option -sv` to read, `set-option -s` to write, via `tmuxExecRawServer`. Unset / "no server running" / "failed to connect" are normal first-use states → treated as "no rank", never an error (mirrors `GetSessionOrder`'s error taxonomy).
- **`GET /api/servers`** (`app/backend/api/servers.go`): each `serverInfo` entry gains a `rank` field (`*int` → JSON `rank: 3` or `rank: null` when unset). The rank read joins the existing per-server `ListSessions` fan-out goroutine (one extra tmux call per server, same concurrency pattern, failure → `null` rank, no 5xx). **The array's alphabetical order is unchanged** — it is an asserted API contract (`servers_test.go:143`, established by #311); display order remains a frontend concern.
- New **`POST /api/servers/order`** with body `{"order": ["srv-a", "srv-b", ...]}`: validates each name (`validate.ValidateServerName`), then writes rank `i` to the i-th listed server (fan-out, best-effort per server — one unreachable server logs a warning and skips; the next full write self-heals). Returns `{ok: true}`. POST per Constitution IX. Mirrors the `handleSessionOrderGet/Post` pair (`app/backend/api/sessions.go:125-143`) minus the GET (rank already rides `/api/servers`).
- **SSE echo**: on successful POST, broadcast a server-global **`event: server-order`** carrying `{"order": [names]}` to every connected stream — both the per-server streams and the dedicated `?metrics=1` stream (so the Cockpit at `/` with zero attached servers still hears it). Follows the existing server-global broadcast pattern of `event: services` / `event: metrics` (`app/backend/api/sse.go`), including the connect-time cached snapshot replay (`sse.go:317-348` pattern) so late-joining clients get current order without a fetch race.

### Frontend: order composition at the #311 sort choke point

- `compareServers` (`app/frontend/src/api/client.ts`) or a wrapper gains rank awareness — effective sort key: **(infra-class, rank, name)**. Infra servers (`isInfraServer`) stay pinned last as a class and ignore rank entirely; within the regular class, ranked servers sort by rank ascending, unranked servers sort after all ranked ones (alphabetical among themselves, preserving byte-order semantics).
- The sort still happens **once** at the single ingestion choke point (`fetchServers` in `app/frontend/src/contexts/session-context.tsx:254-260`, established by #311) so all four consumer surfaces inherit it automatically: sidebar Server-panel tile grid, SESSIONS-tree per-server `ServerGroup`s, Cockpit TMUX SERVERS zone, command-palette `Server: Switch to {name}` entries.
- SessionContext listens for `event: server-order` and re-sorts the held `servers` array (state update, no refetch).
- **Optimistic drag feedback** uses the derive-over-store pattern from PR #240 (`sidebar/index.tsx:237-249, 1092-1105`): a render-time override ref holds the dragged order, cleared when the authoritative order (SSE echo / refetch) element-wise equals it. No whole-array watcher effect; no snap-back on drag-end.

### Drag surfaces (two tile grids)

- **Sidebar `ServerPanel` tiles** (`app/frontend/src/components/sidebar/server-panel.tsx`): tiles become draggable with HTML5 DnD using a custom MIME type `application/x-server-reorder` — the exact discrimination pattern of session reorder (`sidebar/index.tsx:657-695`: `setData` on start, `types.includes` guard on over, insert-before semantics, drop commits + POSTs). Infra tiles (`isInfraServer`) are not draggable and are not valid drop targets.
- **Cockpit TMUX SERVERS grid** (`app/frontend/src/components/server-list-page.tsx:272-288`): same drag treatment on the server tile buttons, sharing the reorder handler logic (lift shared pieces rather than duplicating).
- The SESSIONS-tree server groups and palette entries follow the order (via the choke point) but expose **no** server-level drag affordance.
- Touch devices: no drag (HTML5 DnD doesn't fire on touch — same accepted limitation as session reorder); the palette Move commands below are the touch/keyboard path.

### Command palette: Move up / Move down (servers, sessions, windows)

New `PaletteAction` entries in `app/frontend/src/app.tsx` (grouped with their existing action families: `serverActions`, `sessionActions`, `windowActions`), each acting on the **current** route-context entity (matching `Server: Kill` semantics):

- **`Server: Move up` / `Server: Move down`** — moves the current server one position within the regular-class effective order and POSTs the full new order to `/api/servers/order`. Hidden/no-op when the current server is infra or at the boundary.
- **`Session: Move up` / `Session: Move down`** — moves the current session one position in the effective session order and writes it via the existing `setSessionOrder` client call (`POST /api/sessions/order`). Reuses PR #240's effective-order derivation (override ?? SSE order ?? natural).
- **`Window: Move up` / `Window: Move down`** — moves the current window one index within its session via the existing `moveWindow(server, windowId, targetIndex)` client call (`POST /api/windows/{id}/move`).
- Boundary behavior: at the top/bottom of its list the action is a no-op (or filtered out) — no wraparound.

### Tests

- Go: `@rk_server_rank` get/set round-trip + unset taxonomy (`internal/tmux`), `/api/servers` rank field + `POST /api/servers/order` handler (`api/servers_test.go` — the alphabetical-order contract assertion at `servers_test.go:143` must keep passing).
- Vitest: rank-aware comparator (infra pin, rank sort, unranked tail), SessionContext `server-order` event handling, palette Move action order computation.
- Playwright e2e: drag a sidebar server tile and assert the SESSIONS-tree group order follows; palette `Server: Move down` reorders; each new/modified `.spec.ts` ships its sibling `.spec.md` (Constitution: Test Companion Docs).

## Affected Memory

- `run-kit/architecture`: (modify) new `@rk_server_rank` tmux option, `rank` field on `/api/servers`, `POST /api/servers/order`, SSE `event: server-order` (server-global + cached snapshot replay)
- `run-kit/ui-patterns`: (modify) server-tile drag reorder on both grids, rank-aware `compareServers` composition at the fetchServers choke point (extends the #311 § Infra-server de-emphasis entry), palette Move up/down vocabulary for server/session/window
- `run-kit/tmux-sessions`: (modify) `@rk_server_rank` joins the documented `@rk_*` user-option conventions alongside `@rk_session_order`

## Impact

- **Backend**: `internal/tmux/tmux.go` (rank get/set), `api/servers.go` (rank field, order handler), `api/router.go` (route), `api/sse.go` (server-order broadcast + snapshot replay), tests alongside.
- **Frontend**: `api/client.ts` (comparator, `setServerOrder`, rank on `ServerInfo`), `contexts/session-context.tsx` (event listener, sort composition), `components/sidebar/server-panel.tsx` + `components/server-list-page.tsx` (drag surfaces), `components/sidebar/index.tsx` (shared reorder handlers if lifted), `app.tsx` (6 palette actions), tests alongside.
- **No route changes, no new pages** (Constitution IV). All mutations POST (Constitution IX). All tmux calls through `internal/tmux/` with `exec.CommandContext` timeouts (Constitution I, Process Execution).
- Interacts with (and was rebased onto) PR #311; reuses PR #240's order-persistence and optimistic-derive patterns.

## Open Questions

None — all four intake-level design points were resolved in discussion (see Origin). Remaining details (exact comparator wrapper shape, whether the SSE snapshot replay caches per-hub or per-stream, palette action gating on boundaries) are plan-level decisions covered by the assumptions below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Persist order as a per-server integer rank in tmux user option `@rk_server_rank` (`set-option -s`); killed server takes only its own rank; unranked servers sort after ranked, alphabetical | Discussed — user chose per-server rank var over replicated JSON list and filesystem file; mirrors shipped `@rk_session_order` mechanism | S:90 R:70 A:85 D:90 |
| 2 | Certain | Drag surfaces are the sidebar ServerPanel tiles AND the Cockpit TMUX SERVERS grid; SESSIONS-tree groups and palette entries follow order but are not drag surfaces | Discussed — user chose both tile grids | S:90 R:85 A:85 D:90 |
| 3 | Certain | Infra servers (`rk-daemon`, `rk-test-*`) are excluded from reordering and stay pinned last; effective sort key is (infra-class, rank, name) | Discussed — user chose to preserve #311's class pin; infra tiles not draggable, not drop targets | S:90 R:80 A:90 D:90 |
| 4 | Certain | Add palette `Move up`/`Move down` actions for servers AND sessions AND windows (user-directed scope expansion), acting on the current route-context entity | Discussed — user explicitly expanded scope beyond servers to close the Constitution V keyboard gap for all three levels | S:85 R:75 A:85 D:85 |
| 5 | Certain | Drag mechanics reuse the session-reorder pattern verbatim: HTML5 DnD, custom MIME `application/x-server-reorder`, insert-before semantics, optimistic derive-over-store override cleared on authoritative-echo equality; no touch drag | Codebase deterministically answers this — PR #240 shipped the exact pattern at `sidebar/index.tsx:657-695` | S:60 R:85 A:90 D:80 |
| 6 | Confident | `POST /api/servers/order` takes `{order: [names]}` and rewrites ranks 0..N-1 across listed servers, best-effort per server (partial failure warns and self-heals on next write); no GET twin | Mirrors `POST /api/sessions/order` + Constitution IX; rank already rides `/api/servers` so a GET is redundant; best-effort matches servers.go's existing no-5xx fan-out stance | S:60 R:75 A:85 D:75 |
| 7 | Confident | Rank is delivered as a nullable `rank` field on existing `/api/servers` entries (read in the existing ListSessions fan-out); array stays alphabetical preserving the #311 asserted API contract | Strong #311 precedent ("display order is a frontend concern", `servers_test.go:143`); one fetch, no new read endpoint | S:55 R:75 A:80 D:65 |
| 8 | Confident | Multi-client sync via server-global SSE `event: server-order` broadcast on POST (both stream types + connect-time cached snapshot), consumed by SessionContext re-sort | Follows the established `services`/`metrics` server-global event pattern and the `session-order` echo precedent | S:50 R:70 A:75 D:60 |
| 9 | Confident | Palette Move commands: `Session: Move up/down` rewrites `@rk_session_order` via existing `setSessionOrder`; `Window: Move up/down` uses existing `moveWindow(targetIndex±1)`; no new backend for these two; boundary = no-op, no wraparound | All mutation primitives already exist in `client.ts`; palette current-entity semantics match `Server: Kill` | S:55 R:80 A:85 D:75 |

9 assumptions (5 certain, 4 confident, 0 tentative, 0 unresolved).
