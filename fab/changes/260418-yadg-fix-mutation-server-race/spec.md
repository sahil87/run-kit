# Spec: Fix Mutation APIs Targeting Wrong tmux Server

**Change**: 260418-yadg-fix-mutation-server-race
**Created**: 2026-04-18
**Affected memory**: `docs/memory/run-kit/tmux-sessions.md`, `docs/memory/run-kit/ui-patterns.md`

## Non-Goals

- Backend changes — `serverFromRequest(r)` and `tmuxExecServer(ctx, server, …)` already route mutations to the correct tmux server at handler time; the query-string contract is unchanged.
- Server-management API signatures (`listServers`, `createServer`, `killServer`) — these intentionally don't scope to a server because they *operate on* the server.
- Theme / server-color global settings endpoints — already server-agnostic.
- SSE and WebSocket URL construction — those already interpolate `server` explicitly per connection and re-open on server change, so the closure race does not apply.
- Window-store keying (`(session, windowId)`) — no cross-tmux-server window-move API exists; `MoveWindowToSession` operates within a single server.
- Introducing a bound-client abstraction (e.g., `new Client(server)`) — explicit first-argument threading is the accepted shape.

## API Client: Explicit Server Parameter

### Requirement: Remove module-level server getter

The file `app/frontend/src/api/client.ts` SHALL NOT export or retain any module-level mutable getter for the tmux server name. Specifically, the symbols `_getServer` and `setServerGetter` MUST be removed. `withServer` SHALL accept the server name as an explicit second argument: `withServer(url: string, server: string): string`.

#### Scenario: Module exposes no ambient server state
- **GIVEN** a grep over `app/frontend/src/api/client.ts`
- **WHEN** searching for `_getServer`, `setServerGetter`, or `let _getServer`
- **THEN** zero matches are returned
- **AND** `withServer` has signature `(url: string, server: string) => string`

#### Scenario: SessionProvider no longer wires a server getter
- **GIVEN** `app/frontend/src/contexts/session-context.tsx`
- **WHEN** searching for `setServerGetter` import or call
- **THEN** zero matches are returned
- **AND** `SessionProvider` still exposes `server` via the `useSessionContext()` return value

### Requirement: Mutation functions take server as the first positional argument

Each of the following exported functions in `api/client.ts` SHALL take `server: string` as its first positional argument, prepended to the existing parameter list: `getSessions`, `createSession`, `renameSession`, `killSession`, `createWindow`, `renameWindow`, `killWindow`, `moveWindow`, `moveWindowToSession`, `sendKeys`, `splitWindow`, `closePane`, `selectWindow`, `updateWindowUrl`, `updateWindowType`, `setWindowColor`, `setSessionColor`, `reloadTmuxConfig`, `uploadFile`, `getKeybindings`.

Each SHALL pass the received `server` to `withServer(url, server)` when constructing the fetch URL.

#### Scenario: renameSession sends the captured server in the query string
- **GIVEN** a test fetch stub recording request URLs
- **WHEN** calling `renameSession("server-B", "foo", "bar")`
- **THEN** the fetched URL contains `?server=server-B` (URL-encoded)
- **AND** the URL path is `/api/sessions/foo/rename`
- **AND** the JSON body is `{"name":"bar"}`

#### Scenario: createSession sends the captured server
- **GIVEN** a test fetch stub
- **WHEN** calling `createSession("server-B", "foo")`
- **THEN** the fetched URL is `/api/sessions?server=server-B`
- **AND** the body is `{"name":"foo"}`

#### Scenario: killSession sends the captured server
- **GIVEN** a test fetch stub
- **WHEN** calling `killSession("server-B", "foo")`
- **THEN** the fetched URL is `/api/sessions/foo/kill?server=server-B`

#### Scenario: renameWindow sends the captured server
- **GIVEN** a test fetch stub
- **WHEN** calling `renameWindow("server-B", "foo", 3, "new-name")`
- **THEN** the fetched URL is `/api/sessions/foo/windows/3/rename?server=server-B`
- **AND** the body is `{"name":"new-name"}`

#### Scenario: killWindow sends the captured server
- **GIVEN** a test fetch stub
- **WHEN** calling `killWindow("server-B", "foo", 3)`
- **THEN** the fetched URL is `/api/sessions/foo/windows/3/kill?server=server-B`

#### Scenario: createWindow sends the captured server
- **GIVEN** a test fetch stub
- **WHEN** calling `createWindow("server-B", "foo", "editor")`
- **THEN** the fetched URL is `/api/sessions/foo/windows?server=server-B`

#### Scenario: getSessions sends the captured server
- **GIVEN** a test fetch stub
- **WHEN** calling `getSessions("server-B")`
- **THEN** the fetched URL is `/api/sessions?server=server-B`

### Requirement: Server-management endpoints remain server-parameter-free

The functions `listServers`, `createServer`, and `killServer` SHALL NOT take a first-positional `server` argument. Their URLs SHALL NOT include `?server=`. Theme-settings and server-color-settings endpoints are likewise unchanged.

#### Scenario: killServer targets the server by body, not query string
- **GIVEN** a test fetch stub
- **WHEN** calling `killServer("runkit")`
- **THEN** the fetched URL is `/api/servers/kill` (no query string)
- **AND** the body is `{"name":"runkit"}`

## Call Sites: Capture Server at Action-Trigger Time

### Requirement: React callers capture server at event time, not at render time

Every call site that invokes a mutation API SHALL read `server` from `useSessionContext()` and forward it to the API call at the moment the user-triggered event fires (inside the `onClick` / `onSubmit` / `onKeyDown` / drag-end handler), not baked into a memoized component-level closure that can capture a stale `server`. When the callback is wrapped in `useCallback`, `server` SHALL be listed in the dependency array so the memoized callback is recreated when the server changes.

#### Scenario: Mid-flight server switch during rename does not redirect the request
- **GIVEN** `SessionProvider` mounted with `server = "server-A"` and a rename dialog open for session `foo`
- **WHEN** the user types `bar`, the session provider re-renders with `server = "server-B"`, and then the user presses Enter invoking `handleRename`
- **THEN** `renameSession` is called with `server = "server-B"` (the current context value at trigger time)
- **AND** the fetched URL is `/api/sessions/foo/rename?server=server-B`

> Rationale: the fix eliminates the stale-closure race. The request targets whichever server the UI is currently pointing at when the user actually commits the action — there is no ambient global that could lag behind or race ahead.

#### Scenario: Fast server switch after opening dialog, before submit
- **GIVEN** the user opens a rename dialog on `server-A`
- **WHEN** they switch to `server-B` via Cmd+K before submitting
- **AND** they submit the rename
- **THEN** the request carries `?server=server-B`
- **AND** no request is sent to `server-A`

### Requirement: Optimistic-action wrappers thread server through

`useOptimisticAction` call sites in `app/frontend/src/hooks/use-dialog-state.ts` (and any other file using it for mutations) SHALL include `server: string` in the action's argument tuple such that the `action` callback invokes the API function with the captured server. Rollback / settle callbacks do not need the server.

#### Scenario: executeRenameSession forwards server
- **GIVEN** `executeRenameSession` wired as `useOptimisticAction<[string, string, string]>({ action: (server, oldName, newName) => renameSession(server, oldName, newName), ... })`
- **WHEN** `handleRenameSession` runs with `sessionName = "foo"`, `renameSessionName = "bar"`, and current context `server = "server-B"`
- **THEN** `executeRenameSession` is called with `("server-B", "foo", "bar")`
- **AND** `renameSession("server-B", "foo", "bar")` is invoked

## Optimistic Overlays: Keyed by (server, name)

### Requirement: Optimistic ghost/killed/renamed entries carry and filter by server

`app/frontend/src/contexts/optimistic-context.tsx` SHALL extend each entry in its `ghosts`, `killed`, and `renamed` collections with a `server` field. All mutator APIs (`addGhostSession`, `addGhostServer`, `markKilled`, `markRenamed`, `unmarkKilled`, `unmarkRenamed`, `removeGhost`) SHALL accept `server` as an argument (except `addGhostServer` / server-level `markKilled`, which target server entities and continue as-is). Consumers that render overlays SHALL filter by both the current `server` (from `useSessionContext()`) and the entity name before applying the overlay.

#### Scenario: Rename overlay applied only on originating server
- **GIVEN** a rename marked optimistically as `{server: "server-A", oldName: "foo", newName: "bar"}`
- **WHEN** the UI renders the session list for `server = "server-B"`
- **THEN** session `foo` on `server-B` is NOT shown as `bar`
- **AND** the same rename is still applied when the UI renders for `server-A`

#### Scenario: Kill overlay bounded to originating server
- **GIVEN** a kill optimistically marked as `{server: "server-A", type: "session", name: "foo"}`
- **WHEN** the UI renders the session list for `server = "server-B"`
- **THEN** session `foo` on `server-B` (if any) is NOT hidden
- **AND** session `foo` on `server-A` is hidden until reconciliation

#### Scenario: Ghost session overlay bounded to originating server
- **GIVEN** an optimistic ghost session `{server: "server-A", name: "pending"}`
- **WHEN** the UI renders for `server-B`
- **THEN** no ghost appears in the `server-B` session list
- **AND** the ghost appears in the `server-A` session list

### Requirement: Server-scoped ghosts (for ghost servers themselves) are unaffected

Ghost *servers* (as opposed to ghost sessions) are rendered in the server list, which is itself global. `addGhostServer` SHALL continue to take only a name, and server-level kill overlays SHALL continue to filter by name alone.

#### Scenario: Ghost server visible in server list regardless of current server selection
- **GIVEN** `addGhostServer("new-server")` called
- **WHEN** the server list is rendered
- **THEN** the ghost `"new-server"` is shown
- **AND** the current-server selection does not affect visibility

## Tests

### Requirement: Unit tests assert the explicit-server contract

`app/frontend/src/api/client.test.ts` SHALL include at least one test per mutation function that verifies the `?server=<arg>` query parameter reflects the argument passed in. The existing tests SHALL be updated to the new signature (server as first arg).

#### Scenario: Updated client test signature
- **GIVEN** the existing test case `renameWindow sends POST /api/sessions/:session/windows/:index/rename`
- **WHEN** the test invokes `renameWindow("runkit", "run-kit", 0, "renamed")`
- **THEN** the assertion verifies the fetched URL is `/api/sessions/run-kit/windows/0/rename?server=runkit`

### Requirement: Regression test for the stale-closure bug

The suite SHALL include a React-level regression test (in `use-dialog-state.test.tsx` or an equivalent location) that demonstrates switching the `server` prop on `SessionProvider` between opening a rename dialog and submitting it causes the request to go to the new server.

#### Scenario: Server switch between openRenameDialog and handleRename
- **GIVEN** a test renderer with `SessionProvider server="server-A"` and the `useDialogState` hook mounted
- **AND** `openRenameSessionDialog("foo")` has been called
- **WHEN** the provider rerenders with `server="server-B"` and `setRenameSessionName("bar")` then `handleRenameSession()` runs
- **THEN** the spy on `renameSession` observes the call `("server-B", "foo", "bar")`
- **AND** no call is observed with `server === "server-A"`

## Design Decisions

1. **Thread `server` as explicit first argument vs. bind a per-component client instance**
   - *Why*: matches the backend pattern (`tmuxExecServer(ctx, server, …)`); keeps the call site's server visible inline for reviewers; no new abstraction layer; tests don't need setup/teardown for a bound client.
   - *Rejected*: a `new ApiClient(server)` object adds a construction site (which component builds it? once per render? memoized?) without removing the underlying requirement that each call fix its server at event time — the abstraction just hides the capture point.

2. **Also thread `server` through read APIs (`getSessions`, `getKeybindings`)**
   - *Why*: keeping a vestigial ambient getter just for reads leaves the same closure-race shape in the codebase — a future refactor could quietly reintroduce the bug by using the ambient for a mutation.
   - *Rejected*: leaving `getSessions()` ambient is marginally less typing at ~2 call sites but strictly worse for long-term hygiene.

3. **Optimistic overlays keyed by (server, name) rather than name alone**
   - *Why*: the closure race at the overlay layer produces the same visible symptom (rename/kill "visible" on the wrong server) even after the API fix; shipping the API fix alone leaves a visible partial fix that confuses users.
   - *Rejected*: splitting into two PRs (API fix then overlay keying) would leave a known-bad intermediate on `main` for however long it takes to land the second PR.

4. **Capture `server` at event time, not at render via `useMemo`**
   - *Why*: React's natural event-capture idiom — the callback closure already runs in the render environment where `server` is fresh if listed in `useCallback` deps. Alternative schemes (server ref snapshotted at dialog-open) add bookkeeping without changing the final behavior.
   - *Rejected*: an explicit "snapshot at dialog-open" ref would work but requires every caller to remember to install the ref; listing `server` in callback deps scales trivially.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Root cause is stale module-level `_getServer` closure in `api/client.ts` reading `serverRef.current` at fetch time | Confirmed from intake; directly visible in `api/client.ts:5-16` and `session-context.tsx:32-36` | S:95 R:90 A:95 D:95 |
| 2 | Certain | Fix threads `server` as explicit first positional argument through every mutation and read API function listed above | Confirmed in intake clarify; matches backend `tmuxExecServer(ctx, server, …)` pattern | S:95 R:70 A:85 D:75 |
| 3 | Certain | Reads (`getSessions`, `getKeybindings`) also take explicit `server` — no ambient getter remains in `api/client.ts` | Confirmed in intake clarify — keeps the module entirely free of mutable request-parameter state | S:95 R:80 A:75 D:70 |
| 4 | Certain | `optimistic-context.tsx` overlays (ghosts/killed/renamed) MUST carry and filter by `server` for session-level entries; server-level entries (ghost servers) remain global | Confirmed in intake clarify; required to close the visible-symptom half of the bug | S:95 R:55 A:75 D:70 |
| 5 | Certain | `server` is captured at the user-event handler (submit/click/drag-end) via `useSessionContext()`, with `server` in `useCallback` deps | Confirmed; matches React idiom and existing `lastRenameSessionRef` capture pattern | S:95 R:65 A:80 D:70 |
| 6 | Certain | Scope is frontend-only — backend handlers and `tmuxExecServer` are untouched | Confirmed; backend reads `?server=` per request correctly today | S:95 R:85 A:90 D:85 |
| 7 | Certain | Window-store keying stays at `(session, windowId)` — no cross-tmux-server window-move API exists; `MoveWindowToSession` stays within one server | Confirmed in intake clarify after reviewing `tmux.go:MoveWindowToSession` and `api/windows.go:handleWindowMoveToSession` | S:95 R:50 A:55 D:55 |
| 8 | Certain | API and overlay fixes ship in the same PR | Confirmed in intake clarify — same bug class at two layers; splitting would leave a partial-fix intermediate on `main` | S:95 R:60 A:55 D:50 |
| 9 | Certain | Server-management endpoints (`listServers`, `createServer`, `killServer`) and settings endpoints are unchanged | Confirmed; they operate on the server itself rather than scoping to one | S:95 R:85 A:95 D:90 |
| 10 | Certain | The regression test uses a rerender of `SessionProvider` with a changed `server` prop between dialog open and submit to demonstrate the captured-at-trigger behavior | New at spec — chosen because it's the minimum failure mode that reproduces the bug and exercises every layer (context → hook → callback → client) | S:90 R:70 A:80 D:80 |
| 11 | Certain | URL-encoding of the `server` query parameter is preserved via `encodeURIComponent` in `withServer(url, server)` | New at spec — default behavior must be preserved to match existing backend expectations | S:95 R:90 A:95 D:95 |

11 assumptions (11 certain, 0 confident, 0 tentative, 0 unresolved).
