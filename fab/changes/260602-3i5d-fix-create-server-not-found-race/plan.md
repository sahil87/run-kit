# Plan: Fix Transient "Server not found" Flash After Server Create

**Change**: 260602-3i5d-fix-create-server-not-found-race
**Status**: In Progress
**Intake**: `intake.md`

## Requirements

### Frontend: Pending-server marker in SessionContext

#### R1: SessionContext exposes a pending-server marker and an explicit loaded flag
`SessionContext` SHALL expose three new fields alongside `servers`/`refreshServers`: a `pendingServer: string | null` value, a `markServerPending(name: string): void` setter that sets `pendingServer = name`, and a `serversLoaded: boolean` that becomes `true` once the first `fetchServers()` call resolves (whether the list is non-empty OR empty). All three SHALL be present in the context type, the live provider value, AND the standalone/fallback provider value as safe no-ops/defaults (matching the existing `refreshServers: () => {}` fallback).

- **GIVEN** a consumer inside `SessionProvider`
- **WHEN** it calls `markServerPending("foo")`
- **THEN** the context's `pendingServer` becomes `"foo"`
- **AND** after the first `fetchServers()` resolves (even to `[]`), `serversLoaded` is `true`

#### R2: serversLoaded is false until the first server fetch resolves
`serversLoaded` SHALL be `false` on initial mount and only flip to `true` after the first `listServers()` promise settles (resolve or the caught failure path — both mean "the fetch attempt completed").

- **GIVEN** a freshly-mounted provider whose `listServers()` promise has not yet resolved
- **WHEN** a consumer reads `serversLoaded`
- **THEN** it is `false`
- **AND** once the promise settles (including the empty-list and error cases), it is `true`

### Frontend: Create flow marks pending, refreshes, then navigates

#### R3: handleCreateServer marks the new server pending and triggers a refresh
After calling `executeCreateServer(trimmed)`, `handleCreateServer` (`app/frontend/src/app.tsx`) SHALL call `markServerPending(trimmed)` and SHALL ensure `refreshServers()` runs on create completion, THEN navigate to `/$server`. The refresh SHALL be hung on the `useOptimisticAction` completion hook (`onAlwaysSettled`, which runs even after the create dialog unmounts on navigation — see Design Decision 1), since that hook exists on the current API.

- **GIVEN** the user submits a valid new server name in the create dialog
- **WHEN** `handleCreateServer` runs
- **THEN** `pendingServer` is set to that name before navigation
- **AND** when the backend create resolves, `refreshServers()` is invoked

#### R4: A failed create does not leave a dangling pendingServer
If the create action rejects (`onError`/rollback path), the pending marker SHALL be cleared so a failed create never strands the UI on the waiting state.

- **GIVEN** a create that the backend rejects
- **WHEN** the optimistic action's rollback/error path runs
- **THEN** `pendingServer` is cleared (set to `null`)

### Frontend: Three-way route guard + ServerWaiting component

#### R5: Route guard distinguishes view / waiting / not-found using serversLoaded
The route guard in `AppShell` (`app/frontend/src/app.tsx`, ~line 1018) SHALL replace the binary `servers.length > 0 && !servers.some(...)` check with three-way logic keyed on `serversLoaded` (NOT `servers.length > 0`): (a) `server` IN `servers` → render the server view; (b) `server` NOT in `servers` AND `server === pendingServer` → render `<ServerWaiting>`; (c) `server` NOT in `servers` AND `server !== pendingServer` AND `serversLoaded` → render `<ServerNotFound>` immediately. Before the first fetch resolves (`!serversLoaded`) and for a non-pending unknown server, neither error nor waiting fires.

- **GIVEN** a just-created server not yet in the refreshed list, equal to `pendingServer`
- **WHEN** the guard evaluates
- **THEN** it renders `ServerWaiting`, never `ServerNotFound`
- **AND GIVEN** a genuinely-unknown server name (not pending) with `serversLoaded === true`, the guard renders `ServerNotFound` immediately
- **AND GIVEN** `serversLoaded === false` for an unknown non-pending name, the guard renders neither (falls through to the server view / loading)

#### R6: ServerWaiting component renders a centered waiting state
A new `ServerWaiting` component SHALL be added as a sibling to `ServerNotFound` (~line 96), reusing the centered full-screen layout idiom (`flex flex-col items-center justify-center h-screen ... bg-bg-primary`) and the existing `LogoSpinner`, showing a brief "Creating…/waiting for `<name>`" message.

- **GIVEN** the guard resolves to the waiting state
- **WHEN** `ServerWaiting` renders
- **THEN** it shows a spinner and a message naming the pending server, using the same centered layout as `ServerNotFound`

### Frontend: Clear pending once the server appears

#### R7: pendingServer is cleared once the refreshed list contains it
Once the refreshed `servers` list contains `pendingServer`, `pendingServer` SHALL be cleared (set to `null`), so the waiting state swaps to the server view automatically and a later genuine deletion of that same server correctly shows `ServerNotFound` again. Clearing SHALL happen via an effect (not during render) to avoid setState-in-render.

- **GIVEN** `pendingServer === "foo"` and a refresh that adds `foo` to `servers`
- **WHEN** the effect observes `foo` in the list
- **THEN** `pendingServer` is cleared to `null`
- **AND** if `foo` is later deleted (removed from `servers`) while it is no longer pending, the guard shows `ServerNotFound`

### Non-Goals

- The optional ~5s bounded-fallback timeout is OMITTED for v1 (intake Assumption #7): no timer, no polling. Waiting persists until the refreshed list contains the server. A polling loop (`setInterval` + fetch) would violate the no-client-polling anti-pattern.
- No backend changes — `POST /api/servers` → `CreateSession` is already synchronous and correct.
- No new routes, no SSE changes, no persisted state.

### Design Decisions

1. **Refresh hook = `onAlwaysSettled`, not `onSettled`**: `handleCreateServer` navigates to `/$server` immediately, which unmounts the create dialog but NOT `AppShell` (where the hook lives). `onSettled` is guarded by `mountedRef` and only fires if still mounted; `onAlwaysSettled` always fires on success. Since the refresh must run regardless and only touches root-level `SessionContext` (safe per the hook's documented contract), `onAlwaysSettled` is the correct site. — *Why*: ties the refresh to actual create success and is unmount-safe. — *Rejected*: imperative `refreshServers()` in `handleCreateServer` (fires before the create completes, refreshing a stale list — the intake's accepted fallback only); `onSettled` (could be skipped if AppShell ever unmounts mid-create).
2. **Pending-clear on failure via `onAlwaysRollback` + `onError`**: clearing `pendingServer` on the rollback path (R4) is hung on `onAlwaysRollback` (unmount-safe, root-context-only) so a failed create never strands the waiting state.
3. **Guard logic extracted to a pure `resolveServerView` helper**: the three-way decision is extracted into a pure, exported function returning a discriminated `"view" | "waiting" | "not-found"` result, used by the guard and unit-tested directly. — *Why*: matches the existing `app.test.tsx` convention of testing extracted pure logic rather than rendering the full router-bound `AppShell`; honors the code-quality "type narrowing / discriminated unions over `as` casts" principle. — *Rejected*: testing the guard only via a full `AppShell` render (heavy router/provider setup, brittle).

## Tasks

### Phase 1: Core Context Changes

- [x] T001 Add `pendingServer: string | null`, `markServerPending: (name: string) => void`, and `serversLoaded: boolean` to `SessionContextType`, the `SessionProvider` state + provider value (set `serversLoaded` true after the first `fetchServers()` settles, including the empty/error paths), and the `StandaloneSessionContextProvider` fallback (`pendingServer: null`, `markServerPending: () => {}`, `serversLoaded: false`) in `app/frontend/src/contexts/session-context.tsx` <!-- R1 --> <!-- R2 -->

### Phase 2: App Shell Wiring

- [x] T002 Extract a pure exported `resolveServerView(server, servers, pendingServer, serversLoaded)` helper returning `"view" | "waiting" | "not-found"` and add the `ServerWaiting` component (sibling to `ServerNotFound`, reusing the centered layout + `LogoSpinner`) in `app/frontend/src/app.tsx` <!-- R5 --> <!-- R6 -->
- [x] T003 In `app/frontend/src/app.tsx`: read `pendingServer`/`markServerPending`/`serversLoaded` from context; in `handleCreateServer` call `markServerPending(trimmed)` after `executeCreateServer`; hang `refreshServers()` on the create action's `onAlwaysSettled` and clear pending on `onAlwaysRollback`; replace the binary route guard (~line 1018) with `resolveServerView(...)`; add an effect clearing `pendingServer` once `servers` contains it (clear-effect implemented in SessionContext per R7) <!-- R3 --> <!-- R4 --> <!-- R5 --> <!-- R7 -->

### Phase 3: Tests

- [x] T004 [P] Extend `app/frontend/src/contexts/session-context.test.tsx`: assert `markServerPending` sets `pendingServer`, the fallback no-op is exposed via `StandaloneSessionContextProvider`, and `serversLoaded` toggles false→true after the first fetch resolves (including empty list) <!-- R1 --> <!-- R2 -->
- [x] T005 [P] Add route-guard unit tests for `resolveServerView` to `app/frontend/src/app.test.tsx`: (a) just-created server (=== pending, not in list) → `"waiting"`, then `"view"` once in list; (b) genuinely-unknown name (!== pending, loaded) → `"not-found"`; (c) unknown non-pending name before load (`serversLoaded false`) → not `"not-found"` <!-- R5 --> <!-- R7 -->
- [x] T006 Add a Playwright e2e `app/frontend/tests/e2e/create-server-waiting.spec.ts` + sibling `create-server-waiting.spec.md` covering create → waiting → view via the command palette / create dialog (best-effort; gracefully cleans up the created server) <!-- R3 --> <!-- R5 -->

### Phase 4: Verification

- [x] T007 Run scoped frontend unit tests (session-context + app) via `just`, `cd app/frontend && npx tsc --noEmit`, and the new e2e via `just test-e2e` <!-- R1 --> <!-- R3 --> <!-- R5 --> <!-- R7 -->

## Execution Order

- T001 blocks T002, T003, T004 (context fields must exist first)
- T002 blocks T003 (guard wiring uses the helper) and T005 (tests the helper)
- T003, T004, T005, T006 all precede T007 (verification gate)

## Acceptance

### Functional Completeness

- [ ] A-001 R1: `SessionContext` exposes `pendingServer`, `markServerPending`, and `serversLoaded` in the type, live provider value, and standalone/fallback provider value
- [ ] A-002 R2: `serversLoaded` is `false` before the first fetch resolves and `true` after it settles (including empty-list and error paths)
- [ ] A-003 R3: `handleCreateServer` marks the new server pending before navigating and triggers `refreshServers()` on create completion
- [ ] A-004 R5: the route guard uses `serversLoaded` (not `servers.length > 0`) and resolves three-way: in-list→view, not-in-list & ===pending→waiting, not-in-list & !==pending & loaded→not-found
- [ ] A-005 R6: a `ServerWaiting` component exists as a sibling to `ServerNotFound`, reusing the centered full-screen layout and `LogoSpinner`
- [ ] A-006 R7: `pendingServer` is cleared (via effect) once the refreshed `servers` list contains it

### Behavioral Correctness

- [ ] A-007 R5: a just-created server shows `ServerWaiting` while absent from the list, then swaps to the server view once the refreshed list includes it (and `pendingServer` clears)
- [ ] A-008 R5: a genuinely-unknown server name shows `ServerNotFound` immediately when the list is loaded
- [ ] A-009 R5: before the first fetch resolves, neither error nor waiting fires for an unknown non-pending name

### Edge Cases & Error Handling

- [ ] A-010 R4: a failed create (rollback/error path) clears `pendingServer` — no dangling waiting state
- [ ] A-011 R7: after `pendingServer` is cleared, a later genuine deletion of that same server shows `ServerNotFound` again

### Code Quality

- [ ] A-012 Pattern consistency: new code follows naming and structural patterns of surrounding code (context field threading, component layout idiom, pure-helper test style)
- [ ] A-013 No unnecessary duplication: reuses `LogoSpinner`, the `ServerNotFound` layout idiom, and the existing `refreshServers`/`useOptimisticAction` plumbing
- [ ] A-014 Type narrowing over assertions: the guard helper returns a discriminated string union; no new `as` casts introduced (code-quality principle)
- [ ] A-015 No client polling: the waiting→view swap is event-driven (refresh + effect on list change), with NO `setInterval`/timer (no-client-polling anti-pattern, intake Assumption #7)
- [ ] A-016 Test companion docs: the new `create-server-waiting.spec.ts` ships with a sibling `create-server-waiting.spec.md` (constitution: Test Companion Docs)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Refresh is hung on `useOptimisticAction`'s `onAlwaysSettled` (not `onSettled`), and pending-clear-on-failure on `onAlwaysRollback`. | Read the hook implementation: `onSettled`/`onRollback` are mount-guarded; the create dialog unmounts on navigation while `AppShell` stays mounted. The refresh/clear must run regardless and touches only root `SessionContext`, satisfying the hooks' documented "safe after unmount" contract. Intake #5 explicitly deferred the exact hook to apply. | S:90 R:80 A:85 D:80 |
| 2 | Certain | The "default/fallback context value" the intake references is the `StandaloneSessionContextProvider` fallback (session-context.tsx ~line 438-448); the React context default is `null` (consumers throw outside a provider). New no-op fallbacks added there. | Confirmed by reading session-context.tsx — there is no separate default-object; `useSessionContext` throws on `null`. The test fallback provider is the only place with `() => {}` no-ops, matching the intake's "matching the existing `refreshServers: () => {}` fallback" wording. | S:90 R:85 A:90 D:85 |
| 3 | Certain | The route-guard three-way logic is extracted into a pure exported `resolveServerView` helper and unit-tested directly, rather than rendering the full `AppShell`. | `app/frontend/src/app.test.tsx` already tests extracted/replicated pure logic (palette action builders) rather than mounting `AppShell` (which needs a full TanStack router + provider stack). Extraction keeps the guard testable and honors the discriminated-union code-quality principle. Low blast radius. | S:80 R:80 A:85 D:75 |
| 4 | Confident | `serversLoaded` is set `true` in both the success and the `catch` branches of `fetchServers()` — a settled (even failed) fetch means "the load attempt completed", so the not-found branch is allowed to fire. | Intake says "after the first `fetchServers()` resolves, even to an empty list". A network failure that leaves `serversLoaded` permanently false would hang the guard forever; treating the caught error as "settled" matches the existing silent-catch pattern and the intended semantics. | S:75 R:75 A:80 D:70 |

4 assumptions (3 certain, 1 confident, 0 tentative).
