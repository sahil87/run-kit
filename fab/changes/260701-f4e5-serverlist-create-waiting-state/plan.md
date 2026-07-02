# Plan: ServerListPage Create-Flow Waiting State

**Change**: 260701-f4e5-serverlist-create-waiting-state
**Intake**: `intake.md`

## Requirements

<!-- Derived from the intake design, verified against the CURRENT post-#290 base.
     RFC 2119 keywords. Every requirement carries a GIVEN/WHEN/THEN scenario. -->

### ServerListPage: Create-Flow Waiting State

#### R1: Mark the created server pending before navigating
`ServerListPage.handleCreate` SHALL call `markServerPending(trimmed)` (from `useSessionContext()`) before navigating to `/$server`, so the three-way route guard `resolveServerView` returns `"waiting"` (rendering `ServerWaiting`) for the just-created server instead of `"not-found"`.

- **GIVEN** the user is on `/` and types a valid server name into the "+ New Server" dialog
- **WHEN** they submit (Enter or Create)
- **THEN** `markServerPending` is called with the trimmed name before `navigate({ to: "/$server", params: { server: trimmed } })`
- **AND** on landing at `/$server`, the guard sees `server === pendingServer` and renders the "Creating server…" `ServerWaiting` spinner, not "Server not found"

#### R2: Refresh SessionContext's server list when the create resolves
The create action SHALL refresh SessionContext's server list once it resolves (mirroring `AppShell.handleCreateServer`'s `onAlwaysSettled: () => refreshServers()`), so the pending-clear effect in `session-context.tsx` fires when the new server appears and the guard swaps `waiting → view` automatically without a manual refresh.

- **GIVEN** a create is in flight and the route is showing `ServerWaiting`
- **WHEN** the create resolves and the tmux server has appeared in the backend list
- **THEN** `refreshServers()` runs (even though the create dialog has unmounted on navigation — it only touches root-level SessionContext), SessionContext's `servers` now includes the new server, and the pending-clear effect sets `pendingServer` back to `null`
- **AND** `resolveServerView` returns `"view"` and the normal server view renders

#### R3: Clear the pending marker on a failed create
The create action SHALL clear the pending marker on the failure/rollback path (`markServerPending("")`, mirroring `AppShell`'s `onAlwaysRollback`), so a failed create never strands the UI on the `ServerWaiting` spinner.

- **GIVEN** a create is in flight and the route is showing `ServerWaiting`
- **WHEN** the create request rejects
- **THEN** `markServerPending("")` runs, clearing `pendingServer` to `null`
- **AND** the guard no longer matches `server === pendingServer`; with `serversLoaded === true` and the server absent, it correctly returns `"not-found"` (and the existing toast surfaces the error)

#### R4: Consolidate the page's server-list display onto SessionContext
`ServerListPage` SHALL read its displayed server list from SessionContext's `servers` / `serversLoaded` (the same source the guard reads) rather than maintaining its own separate `listServers()` fetch, removing the local-vs-context divergence that is the root of this bug class. The self-contained local `ghostServers` optimistic-tile UX and the Cockpit HOST HEALTH zone SHALL be preserved unchanged.

- **GIVEN** the page mounts
- **WHEN** it renders the server tiles and the count/loading line
- **THEN** it renders from `ctx.servers` and gates the loading text on `!ctx.serversLoaded`, so "what the page shows" and "what the guard checks" cannot diverge
- **AND** the ghost-card pulsing tiles (local `ghostServers` state) and the host-metrics `<HostMetrics>` section render exactly as before

### Non-Goals

- No backend change — the tmux-start latency is expected and is exactly what the waiting state covers.
- No new waiting UI — `ServerWaiting`, `resolveServerView`, `markServerPending`, and the pending-clear effect already exist; this change only connects the `/` create path to them.
- No change to `app.tsx` guard logic or `session-context.tsx` (both already correct and exported).
- Not migrating the local `ghostServers` optimistic tiles onto the OptimisticContext `addGhostServer` mechanism (those server-level ghosts are rendered nowhere; the local array is the actual on-`/` affordance and is out of scope).

### Design Decisions

1. **Consolidate display onto SessionContext, keep local ghost tiles** (intake assumption #4, resolved Confident→adopted): Drop `ServerListPage`'s own `servers`/`loading`/`fetchServers` state; read `ctx.servers`/`ctx.serversLoaded`. Retain the local `ghostServers` array for the optimistic pulsing tile. — *Why*: single source of truth with the guard eliminates the divergence bug class, while the local ghost tiles are self-contained and unrelated to the guard (the OptimisticContext server-level ghosts are rendered nowhere, so there is nothing to unify with). — *Rejected*: keeping a separate local list and only additionally calling `markServerPending`+refresh — fixes the flash but leaves the divergence that caused the class of bug.
2. **Use `onAlwaysSettled`/`onAlwaysRollback` (not `onSettled`/`onRollback`) for the pending/refresh side effects**: — *Why*: the create dialog navigates away immediately, so the component subtree owning the guarded callbacks may unmount before the request settles; `markServerPending`/`refreshServers` only touch root-level SessionContext, which stays mounted, so they must run via the unmount-safe `onAlways*` hooks — exactly the contract `AppShell.handleCreateServer` already relies on. — *Rejected*: `onSettled`/`onRollback` (guarded on mount) would silently no-op after navigation and never clear/refresh.

## Tasks

### Phase 2: Core Implementation

- [x] T001 In `app/frontend/src/components/server-list-page.tsx`, consume `servers`, `serversLoaded`, `refreshServers`, and `markServerPending` from `useSessionContext()` (add the import alongside the existing `useHostMetrics`); remove the local `servers`/`loading`/`fetchServers` state and the mount `useEffect`, rendering the tile grid and count/loading line from `ctx.servers`/`ctx.serversLoaded` instead. Keep the local `ghostServers` state and the HOST HEALTH zone intact. <!-- R4 -->
- [x] T002 In the same file, add `onAlwaysSettled: () => refreshServers()` and `onAlwaysRollback: () => markServerPending("")` to the `useOptimisticAction` create-server config, mirroring `AppShell.handleCreateServer`. <!-- R2 R3 -->
- [x] T003 In `handleCreate`, call `markServerPending(trimmed)` immediately before `navigate({ to: "/$server", ... })`, and add `markServerPending`/`refreshServers` to the `useCallback` deps. <!-- R1 -->

### Phase 3: Integration & Edge Cases

- [x] T004 Verify/extend the `resolveServerView` unit coverage in `app/frontend/src/app.test.tsx` so the just-created→`waiting` and refreshed→`view` transitions (and the failed-create→`not-found` clear) are asserted. <!-- R1 R2 R3 -->

## Execution Order

- T001 → T002 → T003 are the same-file wiring, applied in order.
- T004 is independent of the source edits (tests the already-pure `resolveServerView`).

## Acceptance

### Functional Completeness

- [x] A-001 R1: `ServerListPage.handleCreate` calls `markServerPending(trimmed)` before navigating to `/$server`.
- [x] A-002 R2: The create action refreshes SessionContext's server list on resolve via `onAlwaysSettled: () => refreshServers()`.
- [x] A-003 R3: The create action clears the pending marker on failure via `onAlwaysRollback: () => markServerPending("")`.
- [x] A-004 R4: `ServerListPage` renders its server tiles and count/loading line from `ctx.servers`/`ctx.serversLoaded`; the local `servers`/`loading`/`fetchServers` state is removed.

### Behavioral Correctness

- [x] A-005 R1: Creating a server from `/` renders the "Creating server…" `ServerWaiting` spinner (not "Server not found") while the tmux server starts — proven by `resolveServerView("newsrv", [existing], "newsrv", true) === "waiting"`.
- [x] A-006 R2: Once the refreshed list includes the new server, the view auto-swaps to the normal server view — proven by `resolveServerView("newsrv", [..., "newsrv"], "newsrv", true) === "view"`.
- [x] A-007 R4: The Cockpit HOST HEALTH zone and the local ghost-card pulsing tiles render unchanged.

### Edge Cases & Error Handling

- [x] A-008 R3: A failed create clears the pending marker so the spinner is not stranded; a genuinely-unknown server name (typo/deleted) still shows "Server not found" (`serversLoaded && !pending` branch unchanged) — proven by `resolveServerView("typo", [existing], null, true) === "not-found"`.

### Code Quality

- [x] A-009 Pattern consistency: The create wiring mirrors `AppShell.handleCreateServer`'s `onAlwaysSettled`/`onAlwaysRollback`/`markServerPending` shape; no new waiting UI or ad-hoc mechanism introduced.
- [x] A-010 No unnecessary duplication: The page reuses SessionContext's `servers`/`serversLoaded`/`refreshServers` instead of duplicating a `listServers()` fetch; `tsc --noEmit` passes.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Post-#290, `ServerListPage` already consumes `useHostMetrics()` from SessionContext but still keeps its OWN `servers`/`loading`/`fetchServers` state and never calls `markServerPending` — so the guard (reading SessionContext's list) returns `not-found` while the tmux server starts. Intake assumption #1 was partially outdated (page is already a partial SessionContext consumer); the essential fix is unchanged. | Verified by reading the current `server-list-page.tsx`, `app.tsx`, and `session-context.tsx` — grep + full-file read confirmed the local state and zero `markServerPending` references | S:95 R:85 A:95 D:95 |
| 2 | Confident | Consolidate the page's server-list DISPLAY onto SessionContext's `servers`/`serversLoaded`, dropping the local fetch, while KEEPING the self-contained local `ghostServers` optimistic tiles and the HOST HEALTH zone (intake assumption #4, preferred variant). | The OptimisticContext server-level ghosts (`addGhostServer`) are rendered nowhere — `useMergedSessions` handles only session ghosts — so the local `ghostServers` array is the real on-`/` affordance and has nothing to unify with; consolidating only the guard-relevant list removes the divergence bug class with minimal surface. Reversible. | S:75 R:65 A:80 D:70 |
| 3 | Confident | Use `onAlwaysSettled`/`onAlwaysRollback` (not the mount-guarded `onSettled`/`onRollback`) for `refreshServers`/`markServerPending("")`, matching `AppShell.handleCreateServer`. | The create dialog unmounts on navigation before the request settles; `onAlways*` are the documented unmount-safe hooks for root-context-only side effects (see `use-optimistic-action.ts` doc comments) | S:85 R:80 A:90 D:85 |
| 4 | Confident | Reuse the EXISTING `resolveServerView` unit tests in `app.test.tsx` (which already assert waiting/view/not-found transitions) rather than adding a redundant new suite; no e2e spec added (intake assumption #5 marks it optional). | `resolveServerView` is unchanged by this wiring fix, and its state-transition coverage (just-created→waiting, refreshed→view, unknown→not-found) already exists at `app.test.tsx:508-537`; adding a duplicate suite would be noise | S:70 R:85 A:80 D:65 |

4 assumptions (1 certain, 3 confident, 0 tentative).
</content>
</invoke>
