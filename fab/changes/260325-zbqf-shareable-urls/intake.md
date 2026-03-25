# Intake: Shareable URLs

**Change**: 260325-zbqf-shareable-urls
**Created**: 2026-03-25
**Status**: Draft

## Origin

> Make URLs copy-pasteable so that when I copy a URL and open it somewhere else on the same server, the same window, and the same session opens up. We should also discuss the various possibilities and the frameworks that we can use for this. The various possibilities of the URLs I mean.

Conversational — user wants to explore URL scheme options before committing to an implementation approach.

## Why

1. **Problem**: URLs in run-kit currently lose the server context after initial page load. When you navigate within the app (e.g., click a window in the sidebar), `navigateToWindow` calls `navigate({ to: "/$session/$window", params: ... })` without including the `?server=` search param. The server is maintained in React state and localStorage, but it disappears from the browser address bar. If you copy a URL like `http://host/dev/0` and paste it elsewhere, the recipient gets the default server ("runkit") rather than the server you were actually viewing.

2. **Consequence**: URLs are not self-contained. Sharing a URL or opening it in a different browser (no localStorage) may show the wrong server's sessions, or fail to find the session at all.

3. **Approach**: Make URLs fully encode the current view — server, session, and window — so they are copy-pasteable and self-contained. The user also wants to discuss different URL scheme structures before implementing.

## What Changes

### Current URL Behavior

The existing routing (`app/frontend/src/router.tsx`) defines:
- `/` — dashboard (no session selected)
- `/$session/$window` — terminal view for a specific session and window index

Server is handled separately (`app/frontend/src/contexts/session-context.tsx`):
- On page load, `readStoredServer()` checks `?server=` query param → localStorage → default "runkit"
- After load, the `?server=` param is NOT maintained in the URL during navigation
- `navigateToWindow()` in `app.tsx` navigates without search params

### Decided URL Scheme

**Server as path segment** — hierarchical URL structure:

| Route | Page | Example |
|---|---|---|
| `/` | **Server list** — grid/list of available servers with "+" to create | `/` |
| `/$server` | **Session dashboard** — sessions & windows for that server (current dashboard) | `/runkit` |
| `/$server/$session/$window` | **Terminal view** — specific terminal | `/runkit/dev/0` |

Key decisions from discussion:
- **Server always in path** — no query param, no omitting for default. URLs are always unambiguous and self-contained.
- **Window stays as numeric index** — name-based has uniqueness problems.
- **No backward compatibility for old `/$session/$window` URLs** — if the first path segment isn't a known server, show a "server not found" page with a button to go to `/`. No migration, no guessing.
- **No auto-redirect from `/`** — server list always shows, even with one server. It's also the place to create new servers (via "+" button, matching the session/window creation pattern on the dashboard).

### New Server List Page (`/`)

A new page at `/` that:
- Lists all available tmux servers (fetched from `/api/servers`)
- Each server is clickable, navigating to `/$server`
- Has a "+" button/icon to create a new server (same pattern as session/window creation on the dashboard)
- Replaces the current redirect-to-dashboard behavior

### Session Dashboard Changes (`/$server`)

The current dashboard component at `/` moves to `/$server`:
- Receives the server name from URL params instead of from context/localStorage
- Otherwise functionally identical
- Server switcher in sidebar becomes navigation links to `/$otherserver` (or removed in favor of going back to `/`)

### Navigation & Server Context Changes

- All `navigate()` calls include `server` as a path param — no more `?server=` query param
- `session-context.tsx` reads server from URL path instead of query param/localStorage
- localStorage server preference can be kept as a convenience for remembering last-used server on `/`, but URL is always the source of truth when on `/$server/...`
- The `readStoredServer()` function is no longer needed for URL resolution

### Affected Frontend Files

- `app/frontend/src/router.tsx` — new route tree: `/`, `/$server`, `/$server/$session/$window`
- `app/frontend/src/app.tsx` — all navigation calls include server param; restructure to handle 3 route levels
- `app/frontend/src/contexts/session-context.tsx` — server from URL path, remove query param logic
- `app/frontend/src/components/top-bar.tsx` — breadcrumb navigation links include server
- `app/frontend/src/components/dashboard.tsx` — receives server from URL param
- `app/frontend/src/components/terminal-client.tsx` — WebSocket connection URL (already includes server)
- New: server list page component

## Affected Memory

- `run-kit/architecture`: (modify) URL structure and routing conventions
- `run-kit/ui-patterns`: (modify) Navigation and URL sharing behavior

## Impact

- **Frontend routing**: Route tree changes from 2 routes to 3 (`/`, `/$server`, `/$server/$session/$window`)
- **All navigation code**: Every `navigate()` call must include server as path param
- **No backward compatibility**: Old `/$session/$window` URLs show "server not found" with link to `/`
- **No backend changes**: Backend relay already accepts `?server=` — only frontend routing is affected
- **Constitution**: Route description needs minor update (two routes → three)

## Open Questions

None — all resolved during clarification.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Session name stays as URL path segment | Current convention, works well | S:90 R:90 A:95 D:95 |
| 2 | Certain | No backend route changes needed | Backend relay already handles `?server=` query param correctly | S:85 R:95 A:95 D:90 |
| 3 | Certain | Server always in path, never omitted | Discussed — user chose unambiguous URLs, no special-casing for default server | S:95 R:85 A:95 D:95 |
| 4 | Certain | Window stays identified by numeric index | Discussed — name-based has uniqueness problems; index is stable | S:90 R:75 A:80 D:90 |
| 5 | Certain | URL scheme: server as path segment `/$server/$session/$window` | Discussed — user chose Option A (path) over Option B (query param) | S:95 R:85 A:95 D:95 |
| 6 | Certain | No backward compat for old URLs — show "server not found" with link to `/` | Discussed — user explicitly chose no migration, clean break | S:95 R:80 A:90 D:95 |
| 7 | Certain | New server list page at `/` always shown (no auto-redirect) | Discussed — doubles as server creation point via "+" button | S:95 R:85 A:90 D:95 |
| 8 | Confident | Server list page uses same "+" creation pattern as session dashboard | Matches existing UI pattern for sessions/windows | S:70 R:85 A:80 D:80 |
| 9 | Confident | localStorage keeps last-used server as convenience for `/` page | URL is source of truth; localStorage just remembers preference | S:60 R:90 A:75 D:80 |

9 assumptions (7 certain, 2 confident, 0 tentative, 0 unresolved).
