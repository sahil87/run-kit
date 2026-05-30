# Spec: Fix Transient "Server not found" Flash After Server Create

**Change**: 260530-df8y-fix-create-server-not-found-race
**Created**: 2026-05-30
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`

<!--
  Frontend-only fix. Backend POST /api/servers is synchronous and correct; the tmux
  server exists by the time the POST resolves. The bug is two stacked frontend defects:
  (1) the server list is never refreshed after create; (2) the route guard uses
  `servers.length > 0` as a "loaded" proxy, which is already true when the user has
  pre-existing servers, so the not-found screen fires immediately for the just-created
  server. Fix: a `pendingServer` marker + an explicit `serversLoaded` flag + a three-way
  route guard. Requirements use RFC 2119 keywords; every requirement has at least one
  GIVEN/WHEN/THEN scenario.
-->

## Non-Goals

- **Backend changes** — `POST /api/servers` (`app/backend/api/servers.go` `handleServerCreate`) → `CreateSession` (`app/backend/internal/tmux/tmux.go`) is synchronous and correct; the tmux server exists by the time the POST resolves. The backend is NOT touched.
- **Bounded-fallback timeout** — a ~5s "give up waiting and show an error" timer is explicitly OMITTED for v1 (Assumption #7). The synchronous, near-instant backend makes it speculative, and a polling loop would violate the no-client-polling anti-pattern (`code-quality.md`). If real latency ever appears it MAY be added later as a single `setTimeout` guard — never a polling loop.
- **Optimistic insert into the server list** — the alternative "instant, no spinner" UX (insert the new server into `servers` optimistically so the view renders immediately) was explicitly rejected (Assumption #1); the user chose a brief waiting state instead.
- **Server list over SSE** — the server list stays a one-time fetch plus explicit `refreshServers()` (it is NOT part of the per-server SSE stream, which carries sessions only). This change does not move the list onto SSE.
- **Reworking `ServerNotFound` into a generic waiting+timeout for all unknown servers** — `ServerNotFound` is preserved as-is for genuinely-bad URLs and continues to fire immediately for them (Assumption #2).

---

## Context: the verified defect

`AppShell` (`app/frontend/src/app.tsx`) derives the current server at line 122 (`ctx.currentServer ?? params.server ?? ""`) and reads `servers = ctx.servers` (line 125). The route guard at lines 1018–1021 is:

```ts
// Server not found check — once server list loads, verify server exists
if (servers.length > 0 && !servers.some((s) => s.name === server)) {
  return <ServerNotFound serverName={server} />;
}
```

`servers` is populated by `fetchServers()` in `SessionProvider` (`app/frontend/src/contexts/session-context.tsx:158-165`), called once on mount (empty-dep `useEffect`, lines 167–169) and re-run only when `refreshServers` (alias of `fetchServers`, line 372) is invoked. `handleCreateServer` (`app.tsx:606-613`) calls `executeCreateServer(trimmed)` then `navigate(...)` — it never refreshes the list and never marks the new server pending. Because `executeCreateServer` is built from `useOptimisticAction` (`app.tsx:587`) and `handleCreateServer` navigates immediately, `AppShell` unmounts, so any **mount-guarded** success callback (`onSettled`) would NOT fire — only the **always** variants (`onAlwaysSettled` / `onAlwaysRollback`, `app/frontend/src/hooks/use-optimistic-action.ts:6-9,47,53`) run after unmount.

Consequently, after navigating to a just-created server while other servers already exist, `servers.length > 0` is `true` and the new name is absent → `ServerNotFound` renders immediately. This spec repairs both the missing refresh and the mis-typed "loaded" signal, and adds a provisioning state.

---

## Frontend: SessionContext provisioning state

### Requirement: `serversLoaded` flag

`SessionContext` SHALL expose a boolean `serversLoaded`, initialized `false`, set to `true` after the **first** `fetchServers()` settles — including when it resolves to an empty list and including the catch/error path. Once `true`, it MUST NOT revert to `false` on subsequent refreshes. The flag MUST be added to the `SessionContextType` (`session-context.tsx:29`), the provider `value` memo (line 364) and its dependency array, and the `StandaloneSessionContextProvider` defaults (line 438, defaulting to `false`).

Rationale: `servers.length > 0` conflates "the list has loaded" with "the list is non-empty". A user with pre-existing servers trips the not-found branch before a post-create refresh lands. An explicit "has the first fetch settled" signal is the root-cause fix.

#### Scenario: First fetch resolves with servers

- **GIVEN** a freshly mounted `SessionProvider`
- **WHEN** the initial `fetchServers()` resolves with a non-empty list
- **THEN** `serversLoaded` transitions `false → true`
- **AND** `servers` holds the returned entries

#### Scenario: First fetch resolves empty

- **GIVEN** a freshly mounted `SessionProvider` on a host with zero tmux servers
- **WHEN** the initial `fetchServers()` resolves with `[]`
- **THEN** `serversLoaded` is `true`
- **AND** `servers` is `[]`

#### Scenario: First fetch fails

- **GIVEN** a freshly mounted `SessionProvider`
- **WHEN** the initial `fetchServers()` rejects (the existing silent-catch path)
- **THEN** `serversLoaded` is still set `true` (the fetch settled; the guard must not hang in a loading state forever)
- **AND** no error is surfaced to the user (the catch stays silent, preserving current behavior)

#### Scenario: Loaded never reverts

- **GIVEN** `serversLoaded === true`
- **WHEN** `refreshServers()` is invoked again (e.g., after a create)
- **THEN** `serversLoaded` remains `true` throughout

---

### Requirement: `pendingServer` marker

`SessionContext` SHALL expose `pendingServer: string | null` (initialized `null`) and `markServerPending: (name: string) => void` (sets `pendingServer = name`). Both MUST be added to `SessionContextType`, the provider `value` memo + deps, and the `StandaloneSessionContextProvider` defaults (`markServerPending` defaulting to a no-op `() => {}`, matching the existing `refreshServers`/`attachServer` fallbacks). `pendingServer` represents "a server the user just created and navigated to, not yet reflected in `servers`".

`pendingServer` SHALL be cleared (set to `null`) when **either**:
1. the server named by `pendingServer` appears in `servers` (creation reconciled — success path), **or**
2. the create action fails (rollback path).

Rationale: the marker is what lets the route guard distinguish "provisioning the server I just made" from "this server genuinely does not exist". Clearing on appearance (not on a timer) is what swaps waiting → view automatically when the refresh lands; clearing on failure prevents a dangling spinner after a rejected create.

#### Scenario: Mark pending

- **GIVEN** `pendingServer === null`
- **WHEN** `markServerPending("test2")` is called
- **THEN** `pendingServer === "test2"`
- **AND** the value is observable through `useSessionContext()`

#### Scenario: Fallback no-op outside provider shape

- **GIVEN** a `StandaloneSessionContextProvider` given a partial value omitting `markServerPending`
- **WHEN** a consumer calls `markServerPending(...)`
- **THEN** it is a safe no-op (no throw), matching the existing `refreshServers` fallback contract

---

## Frontend: create flow wires refresh + pending

### Requirement: `handleCreateServer` marks pending, refreshes, then navigates

`handleCreateServer` (`app.tsx:606`) SHALL, after invoking `executeCreateServer(trimmed)`: call `markServerPending(trimmed)` AND trigger `refreshServers()`, THEN `navigate(...)`, THEN close the dialog and clear the input (preserving current behavior). The validation guard (non-empty, `^[a-zA-Z0-9_-]+$`) MUST be unchanged. `markServerPending`/`refreshServers` MUST be read from `useSessionContext()` and added to the handler's `useCallback` dependency array.

Because `AppShell` unmounts on navigate, the post-create refresh that fires on actual create success SHALL be hung on `useOptimisticAction`'s **`onAlwaysSettled`** hook of `executeCreateServer` (which runs after unmount, per `use-optimistic-action.ts:47`), calling `refreshServers()`. The pending-clear-on-failure SHALL be hung on **`onAlwaysRollback`** (runs after unmount, line 53), clearing `pendingServer` (e.g. `markServerPending` is insufficient for clearing — the context MUST also support setting it back to `null`; expose this via `markServerPending` accepting the value set in the success/failure reconciliation, OR via the appearance-based clear in the guard plus a rollback path that nulls it). Both hooks interact only with root-level `SessionProvider` context, satisfying the "safe to call after unmount" contract documented on those options.

> Implementation note (Assumption #5, resolved): `onAlwaysSettled`/`onAlwaysRollback` are the correct sites precisely because the owning component unmounts on navigate; the mount-guarded `onSettled`/`onRollback` would silently not fire. An immediate `refreshServers()` call inside `handleCreateServer` (before navigate) MAY additionally be issued, but the authoritative post-success refresh MUST be on `onAlwaysSettled` so the list reflects the server even if the immediate fetch raced ahead of tmux. A failed create MUST NOT leave a dangling `pendingServer`.

#### Scenario: Create marks pending and refreshes

- **GIVEN** the create-server dialog with a valid name `test2` and ≥1 pre-existing server
- **WHEN** the user submits (`handleCreateServer` runs)
- **THEN** `executeCreateServer("test2")` is invoked
- **AND** `pendingServer` becomes `"test2"`
- **AND** a `refreshServers()` is triggered (immediately and/or via `onAlwaysSettled` on success)
- **AND** the router navigates to `/$server` with `server: "test2"`
- **AND** the dialog closes and the input clears

#### Scenario: Invalid name is rejected before any side effect

- **GIVEN** the create-server dialog with an invalid name (empty, or containing characters outside `[a-zA-Z0-9_-]`)
- **WHEN** the user submits
- **THEN** `executeCreateServer` is NOT called, `markServerPending` is NOT called, and no navigation occurs

#### Scenario: Failed create clears pending

- **GIVEN** a create that the backend rejects (`createServer` rejects)
- **WHEN** the action settles via `onError` / `onAlwaysRollback`
- **THEN** `pendingServer` is cleared to `null` (no dangling spinner)
- **AND** the existing failure toast ("Failed to create server") still shows

---

## Frontend: three-way route guard + `ServerWaiting`

### Requirement: Three-way guard distinguishes loading / provisioning / not-found

The guard at `app.tsx:1018-1021` SHALL be replaced so that, when `server` is **not** present in `servers`, the render branch is decided as:

1. **`!serversLoaded`** → render neither `ServerWaiting` nor `ServerNotFound` for the not-found reason; fall through to the normal loading/dashboard render path (the list hasn't settled yet — the guard MUST NOT condemn a server before the first fetch resolves). Using `serversLoaded` here replaces the buggy `servers.length > 0` proxy.
2. **`serversLoaded` AND `server === pendingServer`** → render the new `ServerWaiting` component (provisioning state).
3. **`serversLoaded` AND `server !== pendingServer`** → render `ServerNotFound` immediately (genuinely-bad URL — typo'd or deleted server — fails fast, no artificial delay).

When `server` **is** present in `servers`, the guard does not short-circuit; the server view renders, and `pendingServer` is cleared if it matches `server` (see next requirement).

#### Scenario: Just-created server shows waiting then the view

- **GIVEN** the user created `test2` (so `pendingServer === "test2"`), `serversLoaded === true`, and `test2` is not yet in `servers`
- **WHEN** `AppShell` renders for `/$server` with `server === "test2"`
- **THEN** `ServerWaiting` is rendered (not `ServerNotFound`)
- **WHEN** a subsequent `refreshServers()` resolves and `servers` now includes `test2`
- **THEN** the guard no longer short-circuits and the normal server view renders
- **AND** `pendingServer` is cleared to `null`

#### Scenario: Typo'd URL fails fast

- **GIVEN** `serversLoaded === true`, `pendingServer === null`, and the user navigates to `/typo` where `typo` is not in `servers`
- **WHEN** `AppShell` renders with `server === "typo"`
- **THEN** `ServerNotFound` renders immediately (no waiting state, no artificial delay)

#### Scenario: Deleted server (not the pending one) fails fast

- **GIVEN** `serversLoaded === true`, `pendingServer === "test2"`, and the user opens a bookmark `/old` where `old` was killed and is absent from `servers`
- **WHEN** `AppShell` renders with `server === "old"` (`old !== pendingServer`)
- **THEN** `ServerNotFound` renders immediately for `old`

#### Scenario: Before first fetch, nothing condemns an unknown name

- **GIVEN** `serversLoaded === false` (initial mount, list not yet settled)
- **WHEN** `AppShell` renders with a `server` not (yet) in `servers`
- **THEN** neither `ServerWaiting` (unless it is the pending server) nor `ServerNotFound` renders for the not-found reason — the guard falls through to the normal render path until the first fetch settles

---

### Requirement: `ServerWaiting` component

A new `ServerWaiting` component SHALL be added as a sibling to `ServerNotFound` (`app.tsx:96-112`). It SHALL render a brief provisioning state (e.g. "Creating… / waiting for `<name>`") and SHOULD reuse the centered full-screen layout idiom of `ServerNotFound` (`flex flex-col items-center justify-center h-screen ... bg-bg-primary`) and an existing spinner (`LogoSpinner`, the same spinner `ServerPanel` uses for its refreshing state — see `docs/memory/run-kit/ui-patterns.md` § Sidebar / ServerPanel). It MUST accept the server name as a prop for the message. It MUST NOT introduce new layout primitives or a polling timer.

#### Scenario: Waiting renders the pending server name

- **GIVEN** the guard selects the provisioning branch for `pendingServer === "test2"`
- **WHEN** `ServerWaiting` renders
- **THEN** it shows a waiting/creating message referencing `test2` and a spinner
- **AND** it uses the same centered full-screen container styling as `ServerNotFound`

---

### Requirement: Clear pending on appearance

When `servers` comes to include `pendingServer`, `pendingServer` SHALL be cleared to `null`. This MAY be implemented inside the guard's "server present" branch or as a dedicated `useEffect` keyed on `servers` + `pendingServer`. Clearing MUST be idempotent and MUST NOT depend on a timer.

Rationale: clearing on appearance is what swaps the waiting state to the live view automatically. Leaving a stale `pendingServer` would mean a *later* genuine deletion of that same server would show `ServerWaiting` (spinning forever) instead of `ServerNotFound`.

#### Scenario: Later deletion of a previously-pending server shows not-found

- **GIVEN** `test2` was created, appeared in `servers`, and `pendingServer` was cleared to `null`
- **WHEN** `test2` is later killed (removed from `servers`) and the user navigates to `/test2`
- **THEN** with `serversLoaded === true` and `pendingServer === null`, `ServerNotFound` renders for `test2` (not `ServerWaiting`)

---

## Tests

Per `code-quality.md` (new/changed behavior MUST include tests) and the constitution's Test Integrity rule (tests conform to this spec).

### Requirement: SessionContext unit tests

A colocated `session-context` unit test (`*.test.tsx`) SHALL assert:
- `serversLoaded` is `false` before the first fetch settles and `true` after it settles (covering resolve-with-servers, resolve-empty, and reject paths);
- `markServerPending(name)` sets `pendingServer`, and the value (plus a safe no-op fallback in `StandaloneSessionContextProvider`) is exposed through the context.

#### Scenario: Context exposes provisioning state

- **GIVEN** a mounted provider (or standalone test provider)
- **WHEN** the test reads `serversLoaded`, `pendingServer`, and calls `markServerPending`
- **THEN** the values behave per the SessionContext requirements above

### Requirement: Route-guard tests

An `app.tsx`/route-guard test SHALL assert the three-way behavior via `StandaloneSessionContextProvider`:
- (a) `serversLoaded: true`, `pendingServer: "test2"`, `servers` excluding then including `test2` → `ServerWaiting` first, then the server view, with `pendingServer` cleared;
- (b) `serversLoaded: true`, `pendingServer: null`, unknown `server` → `ServerNotFound` immediately;
- (c) `serversLoaded: false`, unknown `server` → neither error nor (non-pending) waiting renders for the not-found reason.

#### Scenario: Guard test matrix

- **GIVEN** the standalone provider configured per each case (a)/(b)/(c)
- **WHEN** `AppShell` renders for the configured `server`
- **THEN** the rendered branch matches the three-way guard requirement

### Requirement: E2E (SHOULD)

A Playwright e2e SHOULD cover create → waiting → view if feasible (`code-quality.md`: "UI changes SHOULD include Playwright e2e tests"). Any new `*.spec.ts` MUST ship with a sibling `*.spec.md` in the same commit (constitution: Test Companion Docs). If a reliable assertion on the brief waiting frame proves flaky, the e2e MAY assert the end state (navigates to the new server's view without a `ServerNotFound` screen) and the waiting-frame assertion is left to the unit/route-guard tests.

#### Scenario: Create flow lands on the server view, never on not-found

- **GIVEN** an isolated e2e tmux server with ≥1 pre-existing server
- **WHEN** the user creates a new server via the command palette and the UI navigates to it
- **THEN** the user lands on the new server's view (dashboard), and the `ServerNotFound` screen is never the terminal state

---

## Affected Memory

- `docs/memory/run-kit/ui-patterns.md` — (modify) Under § URL Structure (the "Server not found" note) add the create-server → `markServerPending` → `ServerWaiting` → view pattern and the three-way route-guard distinction (loading vs provisioning vs genuinely-not-found), the `serversLoaded` / `pendingServer` context fields, the `onAlwaysSettled`/`onAlwaysRollback` wiring rationale (owning component unmounts on navigate), and the server-list fetch lifecycle (one-time fetch + explicit `refreshServers()`, not SSE). `docs/memory/run-kit/architecture.md` is touched only if it documents the server-list fetch lifecycle and needs the post-create-refresh contract — to be confirmed at hydrate; ui-patterns is the primary home.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Landing UX is a brief waiting state (`ServerWaiting`) that swaps to the view once the server appears; optimistic-insert (no spinner) was rejected. | Discussed — user explicitly chose "Brief waiting state". Verified against the real guard/component sites. | S:95 R:75 A:90 D:95 |
| 2 | Certain | `ServerNotFound` is preserved for genuinely-bad URLs and fires immediately for them; only the transient-during-create case is fixed. | Discussed — user chose "Keep, but fix the race". The three-way guard fires not-found fast for `server !== pendingServer`. | S:95 R:70 A:90 D:95 |
| 3 | Certain | Mechanism = `pendingServer` marker + `serversLoaded` flag + three-way route guard. | Discussed; grounded in verified code (guard `app.tsx:1019`, `ServerNotFound` `:97`, server derivation `:122`, provider value `session-context.tsx:364`). | S:95 R:60 A:90 D:90 |
| 4 | Certain | Frontend-only; backend `POST /api/servers` → `CreateSession` is synchronous and correct, untouched. | Confirmed by reading `servers.go` `handleServerCreate` + `tmux.go` `CreateSession`. | S:95 R:80 A:95 D:95 |
| 5 | Certain | Hang the post-success `refreshServers()` on `useOptimisticAction`'s `onAlwaysSettled`, and the pending-clear-on-failure on `onAlwaysRollback`, because AppShell unmounts on navigate so mount-guarded `onSettled`/`onRollback` would not fire. | Clarified — user confirmed the "hook if present, else imperative" resolution; reading `use-optimistic-action.ts` showed the `onAlways*` variants are exactly the post-unmount-safe hooks, removing the ambiguity. | S:95 R:70 A:85 D:80 |
| 6 | Certain | Add an explicit `serversLoaded` boolean (true after first `fetchServers()` settles, even empty/error) and gate the not-found branch on it instead of `servers.length > 0`. | Clarified — user confirmed; the proxy is the root cause of the immediate misfire. | S:95 R:65 A:75 D:70 |
| 7 | Certain | Omit the ~5s bounded-fallback timeout for v1; waiting persists until the refreshed list contains the server. | Clarified — user confirmed; synchronous near-instant backend; a polling loop is an anti-pattern. | S:95 R:75 A:75 D:70 |
| 8 | Confident | `ServerWaiting` reuses `ServerNotFound`'s centered full-screen layout idiom + `LogoSpinner`. | Strong codebase signal; one obvious interpretation; cheap to adjust. | S:80 R:80 A:80 D:80 |
| 9 | Confident | Tests = session-context unit test + app.tsx route-guard test (three-way) + optional Playwright e2e (with sibling `.spec.md`). | `code-quality.md` mandates tests; shape described concretely. Standard project conventions answer the "how". | S:80 R:85 A:85 D:80 |
| 10 | Confident | Memory impact = modify `run-kit/ui-patterns`; touch `run-kit/architecture` only if it documents the server-list fetch. | Discussed affected-memory mapping; ui-patterns already documents "Server not found" and URL structure. | S:80 R:80 A:80 D:75 |

10 assumptions (7 certain, 3 confident, 0 tentative, 0 unresolved).
