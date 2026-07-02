# Intake: ServerListPage Create-Flow Waiting State

**Change**: 260701-f4e5-serverlist-create-waiting-state
**Created**: 2026-07-01

## Origin

Discovered during local testing of the Cockpit host-console change (PR #290, unrelated). The user ran `just dev --port 3500`, created a tmux server named `testServer2` from the `/` home page, and landed on `http://localhost:3500/testServer2` showing a terminal **"Server not found — No tmux server named testServer2 was found"** error screen with a "Go to server list" button. A manual page refresh fixes it — because by then the tmux server has finished starting and appears in the server list.

The user correctly noted this is a UX bug, not expected behavior: starting a tmux server legitimately takes a moment, and during that wait the app should show a **waiting animation**, not a terminal-looking "not found" error. Interaction mode: conversational — the root cause was traced live in the session by reading the route-guard code.

## Why

1. **Problem**: Creating a server from the `/` home page (`ServerListPage`'s "+ New Server") navigates to `/$server` and immediately renders the **"Server not found"** error state, because the newly-created tmux server hasn't finished starting and isn't in the server list yet. The error reads as a hard failure when the operation actually succeeded and is just in flight.

2. **Consequence if unfixed**: Every server created from the home page flashes a scary "not found" error until the user manually refreshes. It looks broken, contradicts the "creating succeeded" reality, and trains users to distrust/refresh. The `/` page is the primary create entry point, so this hits the common path.

3. **Why this approach**: The correct behavior — a **"Creating server…" waiting spinner** (`ServerWaiting`) that auto-swaps to the server view once the server appears — **already fully exists** and is wired for the *other* create path (the in-app `AppShell` "Server: Create" dialog). The bug is purely that the `/` home-page create path was never connected to that machinery. So the fix is to connect an existing, proven mechanism, not to build a new one. This is the minimal, lowest-risk fix and keeps a single source of truth for the waiting behavior.

## What Changes

### Root cause (verified against the current `main` base)

The three-way route guard `resolveServerView(server, servers, pendingServer, serversLoaded)` in `app/frontend/src/app.tsx` (lines ~144-154) decides between three states:

```ts
export function resolveServerView(server, servers, pendingServer, serversLoaded):
  "view" | "waiting" | "not-found" {
  if (servers.some((s) => s.name === server)) return "view";
  if (server === pendingServer) return "waiting";   // ← ServerWaiting spinner
  if (serversLoaded) return "not-found";             // ← "Server not found" error
  return "view";
}
```

The waiting branch fires only when `server === pendingServer`. `pendingServer` is set exclusively via `markServerPending(name)` (SessionContext). The **AppShell** in-app create path does this correctly — `handleCreateServer` (app.tsx ~684-695) calls `markServerPending(trimmed)` before navigating, and also refreshes the server list (`refreshServers` via the create action's `onAlwaysSettled`), so the guard shows `ServerWaiting` until the refreshed list includes the new server, at which point the pending-clear effect (SessionContext ~233-237) clears the marker and the guard returns `"view"`.

**But** `ServerListPage.handleCreate` (`app/frontend/src/components/server-list-page.tsx`, lines ~57-67) does neither:
- It never calls `markServerPending` → `pendingServer` stays `null`.
- It manages its **own local** server-list state (`useState<ServerInfo[]>` + a local `fetchServers`) that is entirely separate from SessionContext's `servers`/`serversLoaded`/`pendingServer`.

So after navigating to `/$server`, the guard sees the server absent from SessionContext's list, `pendingServer === null`, and `serversLoaded === true` (the list was fetched when `/` mounted) → returns **`"not-found"`** immediately. A manual refresh works only because the server has finished starting by then and is present in the freshly-fetched list.

### The fix — connect `ServerListPage`'s create to the existing waiting machinery

In `app/frontend/src/components/server-list-page.tsx`, mirror what `AppShell.handleCreateServer` does:

1. Consume `markServerPending` and `refreshServers` from `useSessionContext()` (the page is already inside `SessionProvider`, mounted in `RootWrapper` above all routes).
2. In `handleCreate`, **before navigating**, call `markServerPending(trimmed)` so the route guard shows `ServerWaiting` for the just-created server.
3. Ensure the SessionContext server list is refreshed once the create resolves (mirror AppShell's `onAlwaysSettled: () => refreshServers()` on the create action) so the pending-clear effect fires when the new server appears and the guard swaps `waiting → view` automatically.
4. On the failure/rollback path, clear the pending marker (`markServerPending("")`, mirroring AppShell's `onAlwaysRollback`) so a failed create never strands the UI on the spinner.

**Local-state consolidation (design decision, see Assumptions):** `ServerListPage` currently keeps its own `servers`/`ghostServers`/`loading` state. The cleanest fix consumes SessionContext's `servers`/`serversLoaded` (the same source the guard reads), so "what the page shows" and "what the guard checks" can't diverge. A more conservative variant keeps the local list for display and only *additionally* calls `markServerPending` + a SessionContext refresh. Both fix the flash; the consolidation is preferred (single source of truth) but is the one judgment call — recorded as a Confident assumption, resolvable at apply/clarify time based on how cleanly the local ghost-server UX maps onto SessionContext.

### Expected behavior after the fix

- Create a server from `/` → navigate to `/$server` → the **"Creating server…" `ServerWaiting` spinner** shows (not "Server not found").
- Once the tmux server finishes starting and appears in the refreshed list, the view **auto-swaps** to the normal server view — no manual refresh.
- A genuinely non-existent server (typed URL, deleted server) still correctly shows "Server not found" (the `serversLoaded && !pending` branch is unchanged).
- A failed create clears the pending marker (no stranded spinner).

## Affected Memory

- `run-kit/ui-patterns`: (modify) — the three-way server route guard + create-server/server-gone lifecycle is already documented here. Update it to note that BOTH create entry points (the in-app AppShell "Server: Create" dialog AND the `/` home-page `ServerListPage` "+ New Server") drive the `pendingServer` → `ServerWaiting` → auto-swap flow, so the waiting state is not specific to one path. (Only if the documented behavior actually changes; if the memory already describes the guard generically without implying a single entry point, this may be a no-op — verify at hydrate.)

## Impact

**Frontend (only):**
- `app/frontend/src/components/server-list-page.tsx` — consume `markServerPending`/`refreshServers` (and likely `servers`/`serversLoaded`) from `useSessionContext()`; call `markServerPending` + refresh on create; clear on failure. Possibly retire the local server-list state in favor of SessionContext's.
- `app/frontend/src/contexts/session-context.tsx` — **no change expected** (`markServerPending`, `refreshServers`, `pendingServer`, the pending-clear effect all already exist and are exported).
- `app/frontend/src/app.tsx` — **no change expected** (`resolveServerView`, `ServerWaiting`, the guard are all already correct; the bug is that one caller didn't feed them).

**Backend:** none — this is purely a frontend wiring fix; server creation and the tmux-start latency are unchanged (the latency is expected and is exactly what the waiting state is for).

**Tests:**
- Unit: extend/add a `resolveServerView` and/or `ServerListPage` test asserting that a just-created server yields the `waiting` state (not `not-found`) and swaps to `view` once it appears in the list. `resolveServerView` is already a pure exported function — ideal for a direct unit test of the state transition.
- E2E (optional): a Playwright spec creating a server from `/` and asserting the "Creating server…" affordance appears rather than "Server not found". If added, ships with a sibling `.spec.md` (Constitution: Test Companion Docs).

**Constitution touchpoints:** IV (minimal surface — reuse existing UI, no new route/page), V (keyboard-first — unaffected), Test Companion Docs (if an e2e spec is added). No security/DB/process-exec surface touched.

## Open Questions

- None blocking. The one judgment call (consolidate `ServerListPage`'s local server-list state into SessionContext vs. keep local list and only add the pending-marker + refresh) is a Confident assumption, not an unresolved blocker — both approaches fix the flash and the choice is reversible at apply time.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Root cause = `ServerListPage.handleCreate` never calls `markServerPending` and uses local (non-SessionContext) server state, so `resolveServerView` returns `not-found` while the tmux server starts | Verified live against the current `main` base: the guard, `ServerWaiting`, and `markServerPending` all exist; `ServerListPage` has zero `markServerPending` references and its own `useState` server list (grep + file read confirmed) | S:95 R:85 A:95 D:95 |
| 2 | Certain | Fix = wire the `/` create path into the EXISTING waiting machinery (call `markServerPending` + refresh SessionContext's list on create; clear on failure), mirroring `AppShell.handleCreateServer` (app.tsx ~684-695) — do NOT build a new waiting UI | The mechanism (pending marker, pending-clear effect, `ServerWaiting`, three-way guard) already exists and is proven on the AppShell path; only the connection is missing | S:90 R:80 A:95 D:90 |
| 3 | Certain | No backend change; the tmux-start latency is expected and is exactly what the waiting state covers | User explicitly stated the wait is expected; the fix is presentational/wiring only | S:95 R:85 A:100 D:95 |
| 4 | Confident | Prefer consolidating `ServerListPage`'s server-list display onto SessionContext's `servers`/`serversLoaded` (single source of truth with the guard) over keeping a separate local list | Removes the divergence that caused the bug class; strong signal, but the local ghost-server UX must map cleanly onto SessionContext — reversible, so Confident not Certain | S:70 R:60 A:80 D:65 |
| 5 | Confident | Add a unit test on the state transition (a just-created server → `waiting`, then → `view` once listed), leveraging the already-pure exported `resolveServerView`; an e2e spec is optional (with `.spec.md` if added) | `resolveServerView` is already unit-test-shaped; matches the project's test conventions and Constitution Test Integrity/Companion Docs | S:75 R:80 A:85 D:70 |

5 assumptions (3 certain, 2 confident, 0 tentative, 0 unresolved).
