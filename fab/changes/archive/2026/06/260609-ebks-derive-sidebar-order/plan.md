# Plan: Derive sidebar session display-order instead of storing localOrderByServer in state

**Change**: 260609-ebks-derive-sidebar-order
**Status**: In Progress
**Intake**: `intake.md`

## Requirements

### Sidebar Reorder: Display-Order Derivation

#### R1: Eliminate the stored override state and its whole-Map watcher effect
The sidebar `Sidebar` component MUST NOT hold the per-server session display-order in React state, and MUST NOT run a `useEffect` keyed on the entire `ctx.sessionOrderByServer` Map to prune/flush overrides. The `localOrderByServer` `useState` and the watcher `useEffect` (the churn source) SHALL be removed.

- **GIVEN** an active server emitting frequent SSE slice updates (sessions/metrics/connection) that produce fresh `sessionOrderByServer` Map references several times per second
- **WHEN** no session reorder is in progress
- **THEN** no per-tick `setLocalOrderByServer` state update or whole-Map-dependency effect runs in response to those unrelated updates
- **AND** the displayed session order still reflects the authoritative SSE order

#### R2: Hold the transient drag override in a server-keyed ref
The transient per-server drag override SHALL live in a `useRef<Record<string, string[]>>` (not render-triggering state). The reorder handlers (`handleSessionReorderStart`, `handleSessionReorderOver`) SHALL write the override into the ref instead of state. The reorder math (splice from/to) and the debounced PUT MUST be preserved exactly; only the storage target changes.

- **GIVEN** a user begins dragging a session row within a server's group
- **WHEN** the drag-start fires and subsequent drag-over events reorder rows
- **THEN** the override for that server is written to the ref synchronously
- **AND** writing the ref does not by itself trigger a React state update

#### R3: Derive the displayed order at render time
The rendered group SHALL receive `localOrder = overrideRef.current[server] ?? null` and `sessionOrder = ctx.sessionOrderByServer.get(server) ?? []`. The child `ServerGroup` continues to compute `effectiveOrder = localOrder ?? sessionOrder` unchanged. The child prop shape (`sessionOrder`, `localOrder`, `sessionDragSource`, `sessionDropTarget`) MUST remain unchanged.

- **GIVEN** a server with an SSE-delivered session order and no active drag override
- **WHEN** the sidebar renders that server's group
- **THEN** the displayed order follows the SSE order
- **AND** **GIVEN** an active override exists for that server, **WHEN** the group renders, **THEN** the displayed order follows the override

#### R4: Override lifecycle — clear on per-server SSE echo, with a render nudge, no snap-back
A server's override MUST persist from drop until the new order round-trips back via SSE for that server (the debounced PUT then the server echoing the new `session-order`). The override SHALL be cleared when the incoming SSE order for THAT server element-wise equals the stored override (per-server check, not whole-Map). Because clearing a ref does not re-render, clearing SHALL trigger a minimal render nudge (a version counter via `useReducer`/`useState`), NOT a reintroduced broad effect. There MUST be no snap-back during the debounced-PUT window.

- **GIVEN** a reorder produced an override for a server and the debounced PUT is in flight
- **WHEN** the SSE order for that server has not yet echoed the new order
- **THEN** the override remains in effect (no snap-back to the old order)
- **AND** **WHEN** the SSE order for that server arrives and element-wise equals the override
- **THEN** the override for that server is dropped and the row re-renders reading the now-authoritative SSE order

#### R5: Preserve the debounced PUT and snappy drag feedback exactly
The debounced PUT (`orderPutTimerRef` + `SESSION_ORDER_DEBOUNCE_MS = 250`, calling `setSessionOrder(server, orderToPut)` with the existing `addToast` error handling) MUST be preserved verbatim. Snappy visual feedback (the dragged row reorders immediately on hover/drop, before SSE confirms) MUST be preserved. The `sessionDragSource` state and `sessionDragSourceRef` remain.

- **GIVEN** a user reorders sessions within a server
- **WHEN** the drag-over reorder fires
- **THEN** the row reorders immediately for visual feedback
- **AND** after the 250ms debounce window, `setSessionOrder(server, newOrder)` is called exactly once with the reordered names

### Non-Goals

- No backend, API, or SSE-pipeline change — `app/frontend/src/contexts/session-context.tsx` is NOT touched.
- No change to the child window-row / session-row prop shape (preferred unchanged).
- No new dependencies.

### Design Decisions

1. **Override storage: `useRef` keyed by server** — the displayed order is a pure function of (transient override, SSE order); holding it in state forced the reconciling effect that caused the churn. — *Why*: deriving at render eliminates the effect; the override is consumed synchronously at render so it need not trigger renders on write. — *Rejected*: keeping `useState` (the status quo) — that is exactly the churn being removed.
2. **Clear trigger: per-render per-server SSE-equality reconcile + version-counter nudge** — while rendering each visible server group, compare `overrideRef.current[server]` to the SSE order; on element-wise equality delete the override and bump a version counter to force the re-render that reads the authoritative SSE order. — *Why*: a per-server check (not a whole-Map effect) fires only for the relevant server's echo, and a version counter is the minimal render nudge the intake bounds allow. — *Rejected*: a reintroduced broad effect on the whole `sessionOrderByServer` Map (the thing being eliminated); clearing only in `handleSessionReorderEnd` (would snap back before the PUT echoes).

## Tasks

### Phase 1: Core Implementation

- [x] T001 In `app/frontend/src/components/sidebar/index.tsx`, remove the `localOrderByServer` `useState` (line ~216) and add a server-keyed `overrideRef = useRef<Record<string, string[]>>({})` plus a minimal `forceRender` nudge (`useReducer((x) => x + 1, 0)`). Keep `sessionDragSource`/`sessionDragSourceRef`, `orderPutTimerRef`, and `SESSION_ORDER_DEBOUNCE_MS` as-is. <!-- R2 -->
- [x] T002 In `app/frontend/src/components/sidebar/index.tsx`, remove the whole-Map watcher `useEffect` keyed on `[ctx.sessionOrderByServer]` (lines ~225-239). Preserve the unmount cleanup effect for `orderPutTimerRef`. <!-- R1 -->
- [x] T003 In `app/frontend/src/components/sidebar/index.tsx`, rewrite `handleSessionReorderStart` (line ~645) to write `overrideRef.current[server] = orderedNames` (replacing the `setLocalOrderByServer` call) and trigger `forceRender`. <!-- R2 -->
- [x] T004 In `app/frontend/src/components/sidebar/index.tsx`, rewrite `handleSessionReorderOver` (lines ~652-679) so the reorder math reads `base = overrideRef.current[server] ?? naturalNames`, writes the reordered array back to `overrideRef.current[server]`, triggers `forceRender`, and keeps the debounced PUT (`orderPutTimerRef` + `SESSION_ORDER_DEBOUNCE_MS` → `setSessionOrder`) EXACTLY as today. <!-- R5 -->
- [x] T005 In `app/frontend/src/components/sidebar/index.tsx`, add a per-server SSE-echo reconcile: when computing each visible server's props, if `overrideRef.current[server]` exists and element-wise equals `ctx.sessionOrderByServer.get(server) ?? []`, delete the override and schedule a `forceRender` (without causing an infinite render loop). Add a small `arraysEqual(a: string[], b: string[])` helper (shallow element-wise). <!-- R4 -->
- [x] T006 In `app/frontend/src/components/sidebar/index.tsx`, change the rendered group props (lines ~766-767) to `sessionOrder={ctx.sessionOrderByServer.get(srvInfo.name) ?? []}` and `localOrder={overrideRef.current[srvInfo.name] ?? null}`, leaving the rest of the `ServerGroup` prop shape unchanged. <!-- R3 -->

### Phase 2: Tests

- [x] T007 In `app/frontend/src/components/sidebar.test.tsx`, extend the `renderSidebar` harness to (a) accept a `sessionOrderByServer` override and (b) return a re-render helper so a changed SSE order can be injected; mock `setSessionOrder` in the `@/api/client` mock. <!-- R3 -->
- [x] T008 In `app/frontend/src/components/sidebar.test.tsx`, add a `describe("session reorder display-order derivation")` with three tests: (a) displayed order follows SSE order when no override; (b) a drag override persists until the matching SSE order arrives, then is dropped (no snap-back, no stale override); (c) reorder fires the debounced PUT (`setSessionOrder`) once with the reordered names. <!-- R4 R5 -->

## Execution Order

- T001 and T002 before T003-T006 (handlers/render reference the new ref + removal of state).
- T003, T004, T005, T006 all edit the same file; execute sequentially.
- T007 before T008 (T008 depends on the extended harness + mock).

## Acceptance

### Functional Completeness

- [x] A-001 R1: `localOrderByServer` `useState` and the `[ctx.sessionOrderByServer]`-keyed watcher `useEffect` are removed from `sidebar/index.tsx`; no remaining reference to `localOrderByServer` or `setLocalOrderByServer`. <!-- verified: grep shows zero remaining refs; useEffect at old 225-239 deleted -->
- [x] A-002 R2: A `useRef<Record<string, string[]>>` holds the transient per-server override; `handleSessionReorderStart`/`handleSessionReorderOver` write to it. <!-- verified: orderOverrideRef at line 229; writes at 651 and 679 -->
- [x] A-003 R3: Render passes `localOrder = overrideRef.current[server] ?? null` and `sessionOrder = SSE order`; the `ServerGroup` prop shape is unchanged and `effectiveOrder = localOrder ?? sessionOrder` is untouched. <!-- verified: lines 765-784; child prop type line 935; effectiveOrder line 1062 unchanged -->
- [x] A-004 R4: A per-server element-wise SSE-equality check clears the override; a version-counter render nudge (not a broad effect) re-renders on clear. <!-- verified: arraysEqual reconcile at lines 765-771; useReducer forceRender at 238. Note: nudge fires on override SET (drag handlers), not on the render-time clear (clear renders null in-pass, so no nudge needed) — more correct than the plan wording. -->


### Behavioral Correctness

- [x] A-005 R3: Unit test proves the displayed order follows the SSE order when no override is set. <!-- verified: test (a) green -->
- [x] A-006 R4: Unit test proves an override persists across unrelated re-renders (no snap-back) until the matching SSE order arrives, after which the override is dropped (authoritative SSE order shown, no stale override). <!-- verified: test (b) green — asserts persist-through-unrelated-rerender, drop-on-echo, and that a subsequent SSE revert now takes effect (proves clear) -->
- [x] A-007 R5: Unit test proves a reorder still fires the debounced PUT (`setSessionOrder`) once with the reordered names. <!-- verified: test (c) green — fake timers, 1 call with ["ao-server","run-kit"] after 250ms -->

### Removal Verification

- [x] A-008 R1: No reintroduced whole-`sessionOrderByServer`-Map dependency effect; the only `sessionOrderByServer` reads are the per-server `.get(server)` calls at render/reconcile time. <!-- verified: only useEffect dep arrays are [] (unmount cleanup); sessionOrderByServer accessed via .get only -->

### Code Quality

- [x] A-009 Pattern consistency: New code follows the sidebar's existing naming/structure (ref naming, handler shape, `useReducer`/version-counter for the nudge). <!-- verified: ref naming matches orderPutTimerRef/sessionDragSourceRef; useReducer forceUpdate is idiomatic -->
- [x] A-010 No unnecessary duplication: The `arraysEqual` helper is local and minimal; no existing utility is reimplemented; `setSessionOrder` client call reused unchanged. <!-- verified: arraysEqual is a 7-line local fn; setSessionOrder import unchanged -->
- [x] A-011 Type narrowing over assertions: No new `as` casts introduced; types narrowed via guards (per `code-quality.md` frontend principle). <!-- verified: grep of added lines shows no new `as` cast -->


## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)

## Deletion Candidates

- None — this refactor removed the redundant code inline (the `localOrderByServer` `useState` and the whole-Map watcher `useEffect`) rather than leaving it dead; no remaining files, functions, branches, or config were made redundant or unused by the change.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Remove `localOrderByServer` state + the `[ctx.sessionOrderByServer]` watcher effect | Intake CHOSEN FIX states both removals explicitly; verified at source lines 216 and 225-239. | S:98 R:75 A:95 D:95 |
| 2 | Certain | Hold the override in `useRef<Record<string, string[]>>` keyed by server | Intake prescribes a useRef keyed by server; consumed synchronously at render. | S:95 R:75 A:90 D:90 |
| 3 | Certain | Derive at render `overrideRef.current[server] ?? (sessionOrderByServer.get(server) ?? [])`; keep child prop shape | Intake gives the exact render expression; child still computes `effectiveOrder = localOrder ?? sessionOrder`. | S:96 R:75 A:92 D:92 |
| 4 | Certain | Preserve the debounced PUT (`orderPutTimerRef` + 250ms `setSessionOrder`) and snappy drag exactly | Listed PRESERVE EXACTLY; verified at source lines 668-675. | S:98 R:80 A:96 D:96 |
| 5 | Confident | Clear the override via a per-render per-server SSE-equality reconcile (element-wise on flat `string[]`) | Intake's primary suggested clear-trigger; per-server (not whole-Map) so unrelated churn does not fire it; a named drag-end fallback exists. | S:85 R:65 A:80 D:70 |
| 6 | Confident | Render nudge on clear/set is a version counter via `useReducer((x)=>x+1,0)` | Intake bounds the mechanism to a minimal counter/forceUpdate and delegates the exact choice; `useReducer` is the idiomatic React minimal forceUpdate. | S:88 R:70 A:82 D:72 |
| 7 | Confident | Schedule the clear's `forceRender` so it does not loop (clear inside render is guarded by override-presence, so a second render finds no override and does not re-clear) | Standard derive-and-reconcile pattern; the override is deleted before the nudge so the follow-up render is idempotent. Mechanism choice delegated to apply by intake. | S:84 R:70 A:80 D:72 |
| 8 | Confident | Extend the test harness to inject `sessionOrderByServer` and support re-render; mock `setSessionOrder` | The existing `renderSidebar` hardcodes empty orders and does not mock `setSessionOrder`; the three required test cases need both. Low-blast-radius test-infra change. | S:86 R:85 A:85 D:80 |

8 assumptions (4 certain, 4 confident, 0 tentative).
