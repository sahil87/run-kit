# Spec: Shareable URLs

**Change**: 260325-zbqf-shareable-urls
**Created**: 2026-03-26
**Affected memory**: `docs/memory/run-kit/architecture.md`, `docs/memory/run-kit/ui-patterns.md`

## Non-Goals

- Backend API route changes — relay and REST endpoints already accept `?server=` param
- Window identification by name — stays as numeric index
- Backward compatibility for old `/$session/$window` URLs — clean break
- Authentication or access control on URLs

## Routing: URL Structure

### Requirement: Three-Level Route Hierarchy

The application SHALL define three route levels:

| Route | Component | Purpose |
|---|---|---|
| `/` | `ServerListPage` | Lists available tmux servers |
| `/$server` | `AppShell` with `Dashboard` content | Session dashboard for a specific server |
| `/$server/$session/$window` | `AppShell` with `TerminalClient` content | Terminal view for a specific window |

The TanStack Router route tree SHALL use nested routes: `/$server` as a layout route whose component renders the shared app shell (sidebar, top bar, SSE connection), with child routes for the dashboard (index) and terminal view.

#### Scenario: Navigate to root
- **GIVEN** the user opens `/` in the browser
- **WHEN** the page loads
- **THEN** the `ServerListPage` component renders (no sidebar, no SSE connection)

#### Scenario: Navigate to server dashboard
- **GIVEN** the user opens `/runkit` in the browser
- **WHEN** the page loads
- **THEN** the `AppShell` renders with SSE connected to the `runkit` server
- **AND** the `Dashboard` component renders in the content area showing sessions for `runkit`

#### Scenario: Navigate to terminal
- **GIVEN** the user opens `/runkit/dev/0` in the browser
- **WHEN** the page loads
- **THEN** the `AppShell` renders with SSE connected to `runkit`
- **AND** `TerminalClient` renders for session `dev`, window `0`, server `runkit`

#### Scenario: Unmatched URL
- **GIVEN** the user opens a URL that matches no route (e.g., `/runkit/dev` — 2 segments)
- **WHEN** the router cannot match a route
- **THEN** a not-found page renders with a message and a button/link to `/`

### Requirement: Server Not Found Handling

When the `$server` parameter does not match any known tmux server (fetched from `/api/servers`), the `/$server` and `/$server/$session/$window` routes SHALL display a "Server not found" UI with a button to navigate to `/`.

#### Scenario: Invalid server name
- **GIVEN** the user navigates to `/bogusserver`
- **WHEN** the server list is fetched and `bogusserver` is not in the list
- **THEN** a "Server not found" message renders with the server name shown
- **AND** a button labeled "Go to server list" (or similar) links to `/`

#### Scenario: Invalid server with session/window
- **GIVEN** the user navigates to `/bogusserver/dev/0`
- **WHEN** the server list is fetched and `bogusserver` is not found
- **THEN** the same "Server not found" UI renders

## Routing: Server List Page

### Requirement: Server List at Root

The `/` route SHALL render a `ServerListPage` component that:

1. Fetches available servers from `GET /api/servers`
2. Displays each server as a clickable card/item that navigates to `/$server`
3. Includes a "+" button to create a new server (opens a dialog or inline input)
4. Does NOT establish an SSE connection (no session data needed)

The page SHALL follow the same visual style as the existing Dashboard (cards, grid layout, `bg-bg-card border border-border rounded` pattern).

#### Scenario: Server list renders
- **GIVEN** the backend has servers `["runkit", "myserver"]`
- **WHEN** the user navigates to `/`
- **THEN** two server cards render, one for "runkit" and one for "myserver"
- **AND** a "+" button is visible for creating a new server

#### Scenario: Create server from server list
- **GIVEN** the user is on `/`
- **WHEN** the user clicks "+" and enters a server name
- **THEN** `POST /api/servers` is called
- **AND** the server list refreshes to include the new server

#### Scenario: No servers exist
- **GIVEN** no tmux servers are running
- **WHEN** the user navigates to `/`
- **THEN** the page shows the "+" button to create a server
- **AND** no server cards are shown

## Routing: Navigation Updates

### Requirement: All Navigation Includes Server

Every `navigate()` call that produces a `/$server/...` URL SHALL include the `server` parameter from the current route context. This includes:

- `navigateToWindow()` in `app.tsx`
- Sidebar window clicks
- Breadcrumb dropdown selections
- Session rename redirect
- Kill session/window redirects
- Active window sync (SSE-driven URL update)

#### Scenario: Sidebar navigation preserves server
- **GIVEN** the user is viewing `/runkit/dev/0`
- **WHEN** the user clicks window "1" in session "myapp" in the sidebar
- **THEN** the URL changes to `/runkit/myapp/1`

#### Scenario: Session rename preserves server
- **GIVEN** the user is viewing `/runkit/dev/0`
- **WHEN** the user renames session "dev" to "main"
- **THEN** the URL changes to `/runkit/main/0`

### Requirement: Dashboard Navigation to Terminal

From the session dashboard at `/$server`, clicking a window card SHALL navigate to `/$server/$session/$window`.

#### Scenario: Dashboard window card click
- **GIVEN** the user is on `/runkit` viewing the session dashboard
- **WHEN** the user clicks window "0" in session "dev"
- **THEN** the URL changes to `/runkit/dev/0`

### Requirement: Server Context from URL

The `SessionProvider` SHALL derive the active server from the URL path parameter (`$server`) instead of from `?server=` query params or `localStorage`.

- The `readStoredServer()` function and its `?server=` query param logic SHALL be removed
- The `setServerGetter` pattern in `api/client.ts` SHALL continue to work — the getter returns the server from the current URL context
- `localStorage` (`runkit-server`) MAY be retained for remembering the last-used server (used on the server list page to highlight or auto-scroll), but SHALL NOT be the source of truth for API calls

#### Scenario: Server determined from URL
- **GIVEN** the user navigates to `/myserver/dev/0`
- **WHEN** the `SessionProvider` initializes
- **THEN** SSE connects to `/api/sessions/stream?server=myserver`
- **AND** all API calls use `?server=myserver`

## Routing: Top Bar Updates

### Requirement: Breadcrumb Links Include Server

Breadcrumb dropdown items in `TopBar` SHALL generate href values that include the server segment. Session dropdown items link to `/$server/$session/0`. Window dropdown items link to `/$server/$session/$window`.

#### Scenario: Session dropdown href
- **GIVEN** the user is on `/runkit/dev/0`
- **WHEN** the session dropdown renders
- **THEN** each session item's href is `/$server/$session/0` (e.g., `/runkit/myapp/0`)

### Requirement: Top Bar on Server Dashboard

On the `/$server` route (dashboard), the top bar SHALL show:
- Hamburger toggle
- "Dashboard" text label (same as current `/` behavior)
- Connection indicator, theme toggle, and command palette trigger

The `/$server` top bar SHALL NOT show session/window breadcrumbs.

#### Scenario: Dashboard top bar
- **GIVEN** the user is on `/runkit`
- **WHEN** the top bar renders
- **THEN** "Dashboard" text appears after the hamburger
- **AND** no session/window breadcrumb dropdowns render

### Requirement: Top Bar on Server List

On the `/` route, the top bar from the app shell does NOT render (no `AppShell` wrapping the server list page). The server list page MAY include its own minimal header.

#### Scenario: Server list has no app shell chrome
- **GIVEN** the user is on `/`
- **WHEN** the page renders
- **THEN** no sidebar, no top bar breadcrumbs, no SSE connection indicator appear

## Routing: Redirect Behavior

### Requirement: Kill/Not-Found Redirects Go to Server Dashboard

When a session or window is killed or no longer exists, the redirect SHALL go to `/$server` (the server's dashboard) instead of `/` (the server list).

#### Scenario: Session killed redirects to server dashboard
- **GIVEN** the user is viewing `/runkit/dev/0`
- **WHEN** session "dev" is killed
- **THEN** the URL changes to `/runkit`

#### Scenario: Window killed redirects to server dashboard
- **GIVEN** the user is viewing `/runkit/dev/2` and window 2 is killed
- **WHEN** the SSE update reflects the killed window
- **THEN** the URL changes to `/runkit`

## Deprecated Requirements

### Old Index Route Redirect Behavior

**Reason**: The `/` route no longer redirects to a session dashboard. It renders the server list page.
**Migration**: N/A — clean break. The server list page replaces the old dashboard-at-root behavior.

### Query Parameter Server Selection

**Reason**: Server is now a URL path segment, not a query parameter. `?server=` is no longer read from the frontend URL.
**Migration**: N/A — backend `?server=` param on API calls continues to work unchanged. Only the frontend URL convention changes.

## Design Decisions

1. **Nested routes over flat routes**: The `/$server` route is a layout route that renders `AppShell` with `<Outlet />`. This avoids duplicating the app shell (sidebar, top bar, SSE, dialogs) across the dashboard and terminal routes.
   - *Why*: Shared UI between `/$server` and `/$server/$session/$window` is substantial (~700 lines). Flat routes would require extracting all shared logic into a wrapper, which is effectively the same thing but less idiomatic with TanStack Router.
   - *Rejected*: Monolithic component with conditional rendering based on params — current approach, works but doesn't leverage the router properly.

2. **Server list page outside AppShell**: The `/` route renders standalone without the app shell chrome.
   - *Why*: The server list has no SSE connection, no sidebar, no session/window context. Wrapping it in `AppShell` would create unnecessary complexity and an SSE connection to a server that hasn't been chosen yet.
   - *Rejected*: Rendering server list inside AppShell with a "no server" state — adds conditional branches to already-complex component.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Session name stays as URL path segment | Confirmed from intake #1 | S:90 R:90 A:95 D:95 |
| 2 | Certain | No backend route changes needed | Confirmed from intake #2 — relay and API already accept `?server=` | S:85 R:95 A:95 D:90 |
| 3 | Certain | Server always in path, never omitted | Confirmed from intake #3 — user chose unambiguous URLs | S:95 R:85 A:95 D:95 |
| 4 | Certain | Window stays identified by numeric index | Confirmed from intake #4 | S:90 R:75 A:80 D:90 |
| 5 | Certain | URL scheme: `/$server/$session/$window` | Confirmed from intake #5 | S:95 R:85 A:95 D:95 |
| 6 | Certain | No backward compat — not-found for old URLs | Confirmed from intake #6 | S:95 R:80 A:90 D:95 |
| 7 | Certain | Server list always shown at `/` | Confirmed from intake #7 | S:95 R:85 A:90 D:95 |
| 8 | Certain | Server list uses "+" creation pattern | Confirmed from intake #8 — upgraded from Confident after spec analysis confirms pattern consistency | S:85 R:85 A:85 D:90 |
| 9 | Confident | localStorage for last-used server preference | Confirmed from intake #9 — optional convenience, not source of truth | S:60 R:90 A:75 D:80 |
| 10 | Certain | Nested routing with `/$server` as layout route | Codebase analysis — AppShell has ~700 lines of shared UI; flat routes would duplicate | S:80 R:70 A:90 D:85 |
| 11 | Certain | Kill/not-found redirects go to `/$server` not `/` | Logical — user should stay in their server context | S:80 R:85 A:85 D:90 |
| 12 | Confident | Server list page has its own minimal header or none | ServerListPage is standalone; could have branding but no app shell chrome | S:55 R:90 A:70 D:70 |

12 assumptions (10 certain, 2 confident, 0 tentative, 0 unresolved).
