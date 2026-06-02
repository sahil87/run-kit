# Intake: Multi-Server SessionProvider + Unified Sidebar

**Change**: 260508-dc0t-multiserver-session-provider
**Created**: 2026-05-08
**Status**: Draft

## Origin

Emerged from a `/fab-discuss` session reviewing the just-merged pane-boards feature (`260507-4vuv-pane-boards`, PR #186). The board route renders its own minimal sidebar instead of the main `<Sidebar>`. This was captured as DD-8 in the pane-boards spec:

> AppShell's sidebar (sessions tree), topbar breadcrumbs, FixedWidthToggle, and bottombar are all derived from the URL's `$server` parameter and the SessionProvider scoped to that server. Boards aggregate windows across servers — there is no single `$server` to bind AppShell chrome to. Forcing AppShell would either (a) require non-trivial refactoring of SessionProvider to accept a "multi-server" mode, or (b) display chrome that misleads the user about which server they're viewing. The mini-layout is honest about the cross-server scope.

The user asked to revisit this. After exploring three options (cosmetic parity, hybrid last-viewed-server, full multi-server refactor), the user chose the full multi-server refactor — both because it makes the asymmetry go away naturally and because it unlocks a real capability: seeing sessions from all tmux servers in one tree.

> **User input**: "Refactor SessionProvider and Sidebar to be multi-server aware. ... Then deletes the BoardPage mini-sidebar. Prerequisite: hdjr (rk-relay-* filter must ship first so multi-server aggregation does not surface ephemerals)."

## Why

### The problem

`SessionProvider` is keyed on a single `$server` parameter. State is flat — `sessions: ProjectSession[]`, `sessionOrder: string[]`, `isConnected: boolean`, `metrics: MetricsSnapshot | null` — all scoped to that one server. Switching servers means tearing down the EventSource, clearing state, and reconnecting to a different SSE endpoint.

Two consequences:

1. **The board route cannot reuse `<Sidebar>`** because boards aggregate across servers and no single `$server` value would be honest. The pane-boards feature shipped a separate mini-sidebar component (`board-page.tsx:202–234`) that duplicates the Boards section and adds a degraded "← Sessions" link instead of the full sessions tree. The user-visible asymmetry is the symptom; the architectural cause is the single-server provider.
2. **Server switching is destructive**. Switching from server A to server B closes A's EventSource, drops its state, opens B's. If the user switches back, A's state is rebuilt from scratch. There's no opportunity to render an "all servers" view because the provider has no concept of "all".

### What happens if we don't fix it

The board page mini-sidebar drift becomes permanent. Every future feature that's cross-server-natural (e.g., a search across all sessions, a dashboard view, a "what's idle on every server" overview) will face the same architectural choice and will tend to ship its own duplicated chrome rather than fight the provider. The pattern entrenches.

The asymmetry is also a real product cost: the user cannot, on a board page, see "what windows are pinnable from server X right now" — because the server-tree they need is the AppShell's sidebar that's not mounted on the board route.

### Why this approach over alternatives

Three approaches were considered:

- **Cosmetic parity** (rejected): make the board page's mini-sidebar look like `<Sidebar>` visually but show a muted/disabled Sessions section. Cheapest (~50 LOC) but doesn't add value — the user still cannot pin windows from the sidebar while on a board, which is the actual capability gap.
- **Hybrid last-viewed-server** (rejected): on the board page, render `<Sidebar>` sourced from the user's last-viewed server. Visually identical to the multi-server outcome most of the time. Fails when the user pinned windows from server Y but hasn't recently visited Y — the sidebar wouldn't show Y's tree, so the user couldn't pin more from Y without first navigating away from the board. Subtle failure mode that bites later.
- **Multi-server SessionProvider** (chosen): provider state shape becomes per-server keyed maps; one EventSource per known server, lazy-attached as the server list discovers them; sidebar groups sessions by server header. The board page renders the same `<Sidebar>` with no special-case. Cost: ~300–500 LOC, mostly concentrated in `SessionProvider` + `Sidebar` + tests. Real bounded refactor, ~2–3 days.

The chosen approach matches the natural mental model — run-kit already exposes multiple tmux servers as first-class concepts (Server panel, server colors, per-server SSE) — and removes a special-case rather than adding one.

## What Changes

### 1. `SessionProvider` becomes multi-server-aware

**File**: `app/frontend/src/contexts/session-context.tsx`

**Current state shape**:

```ts
type SessionContextType = {
  sessions: ProjectSession[];
  isConnected: boolean;
  server: string;
  servers: ServerInfo[];
  sessionOrder: string[];
  refreshServers: () => void;
};
```

**New state shape**:

```ts
type SessionContextType = {
  // Per-server state keyed by server name. Servers are added lazily when the
  // server list is discovered; entries persist across "current server" changes
  // so re-visiting a previously-viewed server is instant.
  sessionsByServer: Map<string, ProjectSession[]>;
  sessionOrderByServer: Map<string, string[]>;
  isConnectedByServer: Map<string, boolean>;
  metricsByServer: Map<string, MetricsSnapshot | null>;

  // The user's "active" server for routes that need a single-server context
  // (e.g., AppShell's /$server/$session/$window). Null when on a route that
  // has no implicit current server (e.g., /board/$name).
  currentServer: string | null;

  // Aggregate state. `servers` is the authoritative list (from /api/servers).
  servers: ServerInfo[];
  refreshServers: () => void;
};
```

**SSE management**:

- One `EventSource` per server in `servers`, opened lazily when the server first appears in the list.
- Each event source updates only its own slice of the per-server maps.
- When a server disappears from `/api/servers` (server killed), close its EventSource and remove its entries.
- Reconnect logic per server, mirroring today's single-server logic.

**Backwards-compatible accessor (transitional)**:

```ts
// For consumers that haven't migrated yet — pulls the slice for the current
// server. Components that genuinely need multi-server data should consume the
// new keyed maps directly.
export function useSessionContextForCurrentServer() {
  const ctx = useSessionContext();
  if (!ctx.currentServer) return null;
  return {
    sessions: ctx.sessionsByServer.get(ctx.currentServer) ?? [],
    sessionOrder: ctx.sessionOrderByServer.get(ctx.currentServer) ?? [],
    isConnected: ctx.isConnectedByServer.get(ctx.currentServer) ?? false,
    server: ctx.currentServer,
    servers: ctx.servers,
    refreshServers: ctx.refreshServers,
  };
}
```

This lets us migrate one consumer at a time. Once all consumers are migrated to the new shape, delete the helper.

### 2. `Sidebar` groups sessions by server

**File**: `app/frontend/src/components/sidebar/index.tsx`

Today the sidebar accepts a single `sessions: ProjectSession[]` prop and renders a flat list under the implicit current server. After the refactor, it accepts the multi-server map (or pulls from context) and renders one collapsible group per server, with the current server's group open by default and active.

**Render structure**:

```
[Server panel — unchanged: tile grid of all servers, click to switch]
[Boards section — unchanged: cross-server, already self-contained]
[Sessions — multi-server]
  ├─ Server: runkit (current)  ← collapsible, default open
  │   ├─ session-a
  │   │   ├─ window-1
  │   │   └─ window-2
  │   └─ session-b
  │       └─ window-1
  ├─ Server: work             ← collapsible, default collapsed
  │   └─ ...
  └─ Server: home             ← collapsible, default collapsed
```

**Behavior changes**:

- Each server section uses the existing `CollapsiblePanel` pattern (matches Server / Boards collapsible panels for consistency, including the change just shipped to make Sessions collapsible).
- The "current server" gets a visual marker (matching the Server panel's selected-tile shade) so the user knows which server's chrome the breadcrumbs and `/$server/...` route refer to.
- Clicking a window in a non-current server's tree navigates to `/{otherServer}/{session}/{windowIndex}`, switching the current server as a side effect.
- The "+ New session" affordance moves into each server section header (creating a session targets that section's server).

**Drag-and-drop scope**:

- Within-server window reorder: unchanged.
- Within-server cross-session window move (existing): unchanged.
- Cross-server window move: out of scope for v1. The drag handler rejects the drop with a toast ("Moving windows across tmux servers isn't supported yet"). Adding it is a separate change because tmux's move-window doesn't span servers — it requires `kill-window` + `new-window` + state restoration on the target server, which is a different problem.

### 3. AppShell unchanged at the route layer

**File**: `app/frontend/src/app.tsx`

The `/$server/$session/$window` route still passes `params.server` to `<Sidebar>` as the *current* server (via `currentServer` in the provider). The sidebar component itself doesn't need to know which route mounted it.

The `currentServer` is set by:
- Route mount with a `$server` param: `currentServer = params.server`
- Route mount without a `$server` param (board route): `currentServer = null`
- User clicks a session/window in a non-current server's tree: `currentServer = that server`, then navigate to `/{server}/{session}/{window}`

### 4. BoardPage drops its mini-sidebar

**File**: `app/frontend/src/components/board/board-page.tsx`

Replace lines 202–234 (the mini-sidebar `<aside>`) with `<Sidebar />`. The sidebar already renders all the Boards section + sessions trees — there's no longer any reason for the board page to roll its own.

The `← Sessions` back link disappears from the sidebar because users navigate to a server by clicking that server's tree (or via the Server panel). If we want a literal "back to last server" affordance, the breadcrumbs in the top bar can carry it — minor follow-up.

### 5. Top-bar / breadcrumbs become route-aware

**File**: `app/frontend/src/components/top-bar.tsx` (and breadcrumb component)

- On `/$server/$session/$window`: breadcrumbs read `currentServer` from context.
- On `/board/$name`: breadcrumbs render `Board ▸ {name} ▾` (already implemented in pane-boards, no change).
- On `/`: breadcrumbs render the last-viewed server name with a "no session selected" hint.

### 6. Tests

**Frontend unit tests** affected:

- `contexts/session-context.test.tsx` — rewrite for multi-server state shape; assert per-server SSE attach/detach, currentServer changes, lazy server discovery.
- `components/sidebar/*.test.tsx` — pass multi-server props; assert per-server group rendering, collapse state per server.
- `app.tsx` route-driven tests — pass `currentServer` through the new shape.
- `StandaloneSessionContextProvider` test helper — accept multi-server shape, default to single-entry map for backwards compat.

**E2E tests** affected:

- Existing e2e tests target a single tmux server (`rk-e2e`). They should pass without modification — single-server is just N=1 in the multi-server shape.
- New e2e: open the app with two tmux servers configured, verify both render in the sidebar, verify navigation switches `currentServer` correctly.

### 7. Prerequisite: hdjr (`rk-relay-*` filter)

The hdjr change (relay grouped sessions, `260508-hdjr-relay-grouped-sessions-board-panes`) introduces ephemeral `rk-relay-*` tmux sessions per WebSocket. Those MUST be filtered from `/api/sessions` and the SSE `sessions` event before this change ships, otherwise the multi-server sidebar would aggregate them across servers and surface them as user-visible sessions.

hdjr already commits to this filter (Assumption #10, Certain, mandatory). This change depends on hdjr landing first.

## Affected Memory

- `run-kit/architecture.md`: (modify) — Update the "single SessionProvider per route" description to "single multi-server SessionProvider"; document the per-server EventSource pool; note that AppShell and BoardPage share the same Sidebar.
- `run-kit/ui-patterns.md`: (modify) — Update Sidebar section to describe the per-server grouping pattern and the current-server visual marker.

## Impact

### Frontend (TypeScript/React)

- **Modified files**:
  - `src/contexts/session-context.tsx` — biggest single-file change; per-server state shape, EventSource pool, currentServer tracking
  - `src/components/sidebar/index.tsx` — render per-server groups; consume new context shape
  - `src/components/sidebar/session-row.tsx` — receive server prop (today implicit); used in keys and navigation
  - `src/components/sidebar/window-row.tsx` — same
  - `src/components/board/board-page.tsx` — delete mini-sidebar, render `<Sidebar>`
  - `src/app.tsx` — set `currentServer` via context dispatch on route mount; route components read from new shape
  - `src/components/top-bar.tsx` and breadcrumbs — route-aware rendering
  - All `useSessionContext` consumers (~9 files): migrate to either the keyed shape or the transitional accessor
- **New files**: none expected
- **Tests**: ~5–8 test files updated; the test helper `StandaloneSessionContextProvider` updated centrally

### Backend (Go)

- **No changes**. The SSE protocol, `/api/sessions?server=X`, and `/api/servers` endpoints are already per-server. The frontend just opens N connections instead of 1. Backend already supports this — it's how the Server panel discovers servers today.

### Configuration / Constitution alignment

- **No new env vars, no new config files, no schema changes**.
- **IV. Minimal Surface Area** — does not add routes; reduces UI surface by deleting a duplicate mini-sidebar.
- **VII. Convention Over Configuration** — derives all state from tmux + the existing server-discovery endpoint; no new configuration knob.

## Open Questions

- **EventSource concurrency**: how many SSE connections is "too many"? Browsers cap concurrent HTTP/1.1 connections per origin at 6 (HTTP/2 lifts this). With 4 tmux servers + 1 metrics SSE per server, we're at 8 — likely fine on modern browsers / HTTP/2 servers, but verify in spec. Mitigation if needed: lazy-attach (only open SSE for a server once its sidebar group is expanded for the first time).
- **Server section default collapse state**: should non-current servers default open or closed? Open is more discoverable; closed is quieter and saves DOM. Recommend default-closed-except-current; persist user toggles per-server in localStorage.
- **Drag-and-drop across servers**: explicitly out of scope for v1. Confirm that the rejection toast message is correct UX (vs silent rejection or visual cue during drag).
- **`metricsByServer` memory cost**: metrics snapshots for every server held in state. If a user has 10 servers, that's 10 metrics streams. Probably fine — metrics are small JSON — but verify scaling.
- **Migration order across the 9 consumer files**: do we ship one big PR or stage the migration via the transitional accessor? Default plan: stage via accessor, migrate one consumer per commit, delete the accessor in the final commit. Confirms in spec.
- **Boards SSE separately**: today `useBoards` fetches `/api/boards` cross-server (not server-scoped). Does it need to be wrapped into the multi-server SSE pool, or stay as a separate SWR-like fetch? Keep separate — boards are explicitly cross-server already, no per-server keying needed.

## Clarifications

### Session 2026-05-09 (bulk confirm)

| # | Action | Detail |
|---|--------|--------|
| 10 | Confirmed | — |
| 11 | Confirmed | — |
| 12 | Confirmed | — |
| 13 | Confirmed | — |
| 14 | Confirmed | — |
| 15 | Confirmed | — |
| 16 | Confirmed | — |
| 17 | Confirmed | — |

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | SessionProvider state shape becomes per-server keyed maps (`sessionsByServer`, `sessionOrderByServer`, `isConnectedByServer`, `metricsByServer`) plus a single `currentServer: string \| null` | Discussed — chosen approach (option 2 / multi-server) explicitly | S:95 R:75 A:85 D:90 |
| 2 | Certain | One EventSource per known server, opened lazily as the `/api/servers` list discovers servers | Discussed — already how the backend serves SSE (per-server endpoint); just open N instead of 1 | S:95 R:80 A:90 D:90 |
| 3 | Certain | Sidebar groups sessions by server, one collapsible group per server, current server marked visually | Discussed — natural rendering for multi-server data; matches existing CollapsiblePanel pattern | S:90 R:80 A:85 D:90 |
| 4 | Certain | BoardPage's mini-sidebar (lines 202–234 of `board-page.tsx`) is deleted; BoardPage renders the same `<Sidebar>` as AppShell | Discussed — this is the user-visible payoff of the refactor; the whole change is unjustified without it | S:95 R:80 A:90 D:95 |
| 5 | Certain | Cross-server window drag-and-drop is OUT OF SCOPE for v1 — the drag handler rejects the drop with a toast | Discussed — tmux's move-window doesn't span servers; supporting it is a different problem with its own design | S:90 R:75 A:85 D:90 |
| 6 | Certain | hdjr (rk-relay-* filter) is a hard prerequisite — must land before this change ships | Discussed — without the filter, ephemerals would surface in the multi-server sidebar | S:95 R:90 A:95 D:95 |
| 7 | Certain | `currentServer` is set by the active route: `params.server` for AppShell routes, `null` for `/board/$name` and `/` | Discussed — natural mapping; eliminates the "which server is this" ambiguity on board route | S:90 R:85 A:85 D:90 |
| 8 | Certain | Backend does NOT change — SSE protocol and endpoints are already per-server; frontend just opens more connections | Discussed — backend was designed for this from day one (Server panel already enumerates servers) | S:95 R:95 A:95 D:95 |
| 9 | Certain | Transitional accessor `useSessionContextForCurrentServer` lets consumers migrate one at a time | Discussed — staging the migration reduces blast radius and makes the diff reviewable | S:85 R:85 A:80 D:80 |
| 10 | Certain | Default collapse state: only the current server's group is open by default; non-current servers start collapsed; user toggles persist per-server in localStorage | Clarified — user confirmed | S:95 R:80 A:75 D:75 |
| 11 | Certain | EventSource concurrency is fine for typical N (≤6 servers) on HTTP/2 backends; lazy-attach (open only when a server section is expanded) is the mitigation if it becomes a problem | Clarified — user confirmed | S:95 R:75 A:75 D:75 |
| 12 | Certain | Boards SSE / `useBoards` stays as a separate cross-server fetch — not wrapped into the per-server pool | Clarified — user confirmed | S:95 R:80 A:80 D:80 |
| 13 | Certain | Migration order: stage via the transitional accessor, migrate consumers one commit at a time, delete accessor in final commit | Clarified — user confirmed | S:95 R:85 A:80 D:80 |
| 14 | Certain | Window drag-and-drop within a server (existing behavior) is preserved; only cross-server is rejected | Clarified — user confirmed | S:95 R:90 A:85 D:85 |
| 15 | Certain | Top-bar breadcrumbs are route-aware: read `currentServer` for AppShell routes; `Board ▸ name` for board routes; "no session" hint for `/` | Clarified — user confirmed | S:95 R:85 A:80 D:80 |
| 16 | Certain | All `useSessionContext` consumers (~9 files: app.tsx, sidebar/index.tsx, sidebar/host-panel.tsx, create-session-dialog, iframe-window, keyboard-shortcuts, hooks/use-dialog-state, hooks/use-sessions, session-context.test) migrate either to the keyed shape directly or to the transitional accessor | Clarified — user confirmed | S:95 R:80 A:80 D:80 |
| 17 | Certain | New e2e test exercising multi-server rendering — but the existing single-server e2e suite passes unchanged because single-server is just N=1 in the new shape | Clarified — user confirmed | S:95 R:85 A:80 D:80 |

17 assumptions (17 certain, 0 confident, 0 tentative, 0 unresolved).
