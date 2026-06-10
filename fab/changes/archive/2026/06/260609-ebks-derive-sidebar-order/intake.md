# Intake: Derive sidebar session display-order instead of storing localOrderByServer in state

**Change**: 260609-ebks-derive-sidebar-order
**Created**: 2026-06-09
**Status**: Draft

## Origin

> Title: derive sidebar session display-order instead of storing localOrderByServer in state
>
> PROBLEM (performance papercut, NOT a correctness bug): In `app/frontend/src/components/sidebar/index.tsx`, the per-server displayed session order is held in React state `localOrderByServer` (around line 216) as a drag-time override layered on the SSE-delivered `ctx.sessionOrderByServer`. A useEffect (around lines 225-239) depends on the WHOLE `ctx.sessionOrderByServer` Map and flushes/prunes overrides. Because that Map gets a fresh reference on ANY slice update for ANY server (sessions/metrics/order/connection events fire several times a second on active servers — see session-context.tsx updateSlice), the effect runs far more often than the order actually changes, doing wasted work each run. It DOES already preserve the active drag's server, so it does NOT break the drag — this is render-efficiency churn, not a reset bug.
>
> CHOSEN FIX ("derive stores"): Eliminate `localOrderByServer` from component state AND remove the watcher effect (lines 225-239). Derive the displayed order at render time: displayed = localOverride ?? sseOrder.

One-shot `/fab-new` invocation with a fully-specified description. No prior `/fab-discuss` session — the description itself carries the problem statement, the chosen fix, the preserve-exactly list, and explicit constraints. change-type declared `refactor`.

## Why

**The pain point.** The sidebar's per-server session display-order is duplicated into React state (`localOrderByServer`) and kept in sync with the authoritative SSE order (`ctx.sessionOrderByServer`) via a watcher `useEffect`. That effect is keyed on the *entire* `sessionOrderByServer` Map. In `session-context.tsx`, `updateSlice` produces a fresh `sessionOrderByServer` Map reference on *any* slice change for *any* server — `sessions`, `metrics`, `session-order`, and connection events all fire several times per second on active servers. So the effect re-runs many times a second even though the session order almost never changes, doing wasted prune/flush work and triggering a `setLocalOrderByServer` state churn on each run.

**The consequence if not fixed.** This is a render-efficiency papercut, not a correctness bug: the drag is not broken today (the effect explicitly preserves the active drag's server). Leaving it means the sidebar keeps paying per-tick state-update cost proportional to SSE traffic on every server the user has open, scaling poorly with active-server count and SSE event rate.

**Why this approach (derive over store).** The displayed order is a pure function of two inputs: the transient drag override and the SSE order. Holding it in component state forces an effect to reconcile the two, which is exactly the source of the churn. Deriving `displayed = localOverride ?? sseOrder` at render time eliminates the reconciling effect entirely — the render reads both sources directly. The drag override no longer needs to live in render-triggering state (it is consumed synchronously at render), so it moves to a `useRef`, and its lifecycle is driven by the drag events plus a *per-server* SSE-order equality check rather than a whole-Map-dependency effect. This is the minimal, idiomatic React fix: stop storing derived state.

## What Changes

Scope is a **pure frontend refactor** of one component plus its test. No backend, no API, no SSE-pipeline change. `session-context.tsx` is explicitly NOT touched — the SSE pipeline is fine; the inefficiency is entirely in the sidebar's consumption of it.

### Change area 1 — Remove the stored override state and its watcher effect

In `app/frontend/src/components/sidebar/index.tsx`:

- **Remove** `const [localOrderByServer, setLocalOrderByServer] = useState<Record<string, string[] | null>>({});` (around line 216).
- **Remove** the watcher `useEffect` (around lines 225-239) that depends on `[ctx.sessionOrderByServer]` and prunes/flushes overrides:

  ```ts
  // (lines ~225-239 today — to be deleted)
  useEffect(() => {
    setLocalOrderByServer((prev) => {
      if (sessionDragSourceRef.current === null) {
        if (Object.keys(prev).length === 0) return prev;
        return {};
      }
      const activeServer = sessionDragSourceRef.current.server;
      const next: Record<string, string[] | null> = {};
      for (const [s, v] of Object.entries(prev)) {
        if (s === activeServer) next[s] = v;
      }
      return next;
    });
  }, [ctx.sessionOrderByServer]);
  ```

  This effect is the churn source — it is the thing being eliminated.

### Change area 2 — Hold the transient drag override in a ref keyed by server

- Introduce a `useRef` keyed by server name, e.g. `const overrideRef = useRef<Record<string, string[]>>({});` (a ref, NOT state, so writing it does not trigger a render).
- The reorder handlers set the override for that server:
  - `handleSessionReorderStart` (around line 645-650) currently does `setLocalOrderByServer((prev) => ({ ...prev, [server]: orderedNames }))` → set `overrideRef.current[server] = orderedNames` instead.
  - `handleSessionReorderOver` (around line 652-679) currently computes the reordered `next` array inside a `setLocalOrderByServer` updater, with the debounced PUT armed inside that updater. The reorder math (splice from/to) and the debounced PUT MUST be preserved EXACTLY; only the storage target changes from `setLocalOrderByServer` state to `overrideRef.current[server]`. The `base` source becomes `overrideRef.current[server] ?? naturalNames` (mirroring today's `prev[server] ?? naturalNames`).

### Change area 3 — Derive the displayed order at render time

- Where the rendered group currently passes props to the child window/session row (around lines 766-767):

  ```tsx
  sessionOrder={ctx.sessionOrderByServer.get(srvInfo.name) ?? []}
  localOrder={localOrderByServer[srvInfo.name] ?? null}
  ```

  the render now reads the override from the ref:

  ```tsx
  sessionOrder={ctx.sessionOrderByServer.get(srvInfo.name) ?? []}
  localOrder={overrideRef.current[srvInfo.name] ?? null}
  ```

  PREFER not changing the child row's prop shape (`sessionOrder`, `localOrder`, `sessionDragSource`, `sessionDropTarget` stay as-is). The child still computes `effectiveOrder = localOrder ?? sessionOrder` (around line 1044) unchanged. Effectively the displayed order per server is `overrideRef.current[server] ?? (ctx.sessionOrderByServer.get(server) ?? [])`.

### Change area 4 — Override lifecycle: clear on SSE echo (no snap-back), with a render trigger

The override MUST persist from drop until the new order round-trips back via SSE (the debounced PUT then the server echoing the new `session-order`), so the row does NOT snap back during the debounced PUT window. Replace the whole-Map-dependency effect with per-server equality:

- Clear a server's override (`delete overrideRef.current[server]`) when the incoming SSE order for THAT server deep-equals the stored override (the echo has landed). The check is **per-server**, not over the whole Map, so it does not fire for unrelated `metrics`/`sessions` churn on other servers.
- Because refs do not trigger a re-render when cleared, when the override is dropped the component needs a minimal render nudge so the row re-renders reading the now-authoritative SSE order. Use a minimal mechanism — a small version counter (`useState` incremented) or `forceUpdate` — NOT a reintroduced broad effect. The apply/plan agent picks the cleanest within these bounds (e.g. a tiny per-render reconcile that, while rendering each group, compares `overrideRef.current[server]` to the SSE order and, on equality, deletes the override + bumps the version counter; or driving the clear from `handleSessionReorderEnd` after the PUT settles combined with the per-server SSE-equality guard). The lifecycle is driven by **drag events + per-server SSE-order equality**, never by a global-Map-dependency effect.
- Array equality is a shallow element-wise compare of two `string[]` (same length, same elements in order) — order arrays are flat string lists, so no deep-structure recursion is needed.

### Preserve exactly (do not regress)

- **Debounced PUT** of the new order: `orderPutTimerRef` + `SESSION_ORDER_DEBOUNCE_MS = 250` (around lines 668-675), calling `setSessionOrder(server, orderToPut)` with the existing `addToast` error handling. Reorder still persists to backend identically, on the same 250ms debounce.
- **Snappy visual feedback during drag**: the dragged row reorders immediately on hover/drop, before SSE confirms (the override is applied synchronously in the over-handler and read at render).
- **Drag handlers** `handleSessionReorderStart` / `handleSessionReorderOver` / `handleSessionReorderEnd` (and the window-row `handleDragStart`/`handleDragOver`/`handleDragEnd`/`handleSessionDrop` around lines 552-675 they sit beside) keep their external behavior. PREFER NOT changing the child window-row prop shape (`sessionOrder`, `localOrder`, `sessionDragSource`, `sessionDropTarget`). Touch the child row component ONLY if a prop shape genuinely must change.
- **No snap-back**: the override outlives the PUT until SSE echoes the new order for that server.
- The `sessionDragSource` state and `sessionDragSourceRef` remain as needed for confining the drag to one server; only the *order-storage* mechanism moves from state to ref.

## Affected Memory

`docs/memory/run-kit/ui-patterns.md` documents the sidebar's URL/selection patterns but does NOT currently document the session-reorder override mechanism. This is an implementation-level render-efficiency refactor with no spec-level behavior change (the user-visible reorder behavior — snappy drag, debounced persist, no snap-back — is preserved exactly). No memory file create/modify/remove is required.

- _(none — implementation-only change; no spec-level behavior change)_

## Impact

- **Code touched**: `app/frontend/src/components/sidebar/index.tsx` (remove state + watcher effect, add override ref, derive at render, per-server clear) and `app/frontend/src/components/sidebar.test.tsx` (unit coverage). The colocated `app/frontend/src/components/sidebar/index.test.tsx` may also be relevant; the priority test target is the reorder-persistence behavior in `sidebar.test.tsx`.
- **Child row component** (`window-row.tsx` / session-row rendering): prop shape preferred unchanged; touch only if genuinely required.
- **NOT touched**: `app/frontend/src/contexts/session-context.tsx` (SSE pipeline / `updateSlice` is fine).
- **APIs / dependencies**: none added (constraint: no new dependencies). The `setSessionOrder` client call and SSE `session-order` event are reused unchanged.
- **Verification gates**: Vitest via `just test-frontend` (scoped to the sidebar test first), then full sidebar tests green; frontend `tsc --noEmit`. UI changes SHOULD also get an e2e where feasible (reorder persistence), but the reorder-persistence unit test is the priority. Per context.md, NEVER run vitest/playwright directly — always via `just` recipes.

## Open Questions

- _(none — the description fully specifies the fix bounds, the preserve-exactly list, and the test obligations. The single open implementation choice — the exact render-trigger mechanism when the override clears — is explicitly delegated to the apply/plan agent within stated bounds (minimal version counter / forceUpdate, NOT a broad effect), which is a Confident low-blast-radius decision, not a clarification.)_

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | change-type is `refactor` | Explicitly declared in the description; keyword "refactor"/"derive...instead of storing" matches the refactor classifier. Sets `expected_min = 6`. | S:98 R:90 A:95 D:95 |
| 2 | Certain | Scope is `app/frontend/src/components/sidebar/index.tsx` + its test only; `session-context.tsx` untouched | Description states "Pure frontend refactor. Scope: ... Do NOT touch session-context.tsx — the SSE pipeline is fine." | S:98 R:85 A:95 D:95 |
| 3 | Certain | Eliminate `localOrderByServer` state and remove the watcher effect (lines 225-239) | Description's CHOSEN FIX states both removals explicitly. | S:98 R:75 A:95 D:95 |
| 4 | Certain | Hold the transient drag override in a `useRef` keyed by server, not state | Description's "Suggested implementation" prescribes a useRef keyed by server set in reorder/drop handlers. | S:95 R:75 A:90 D:90 |
| 5 | Certain | Derive displayed order at render: `overrideRef.current[server] ?? (sessionOrderByServer.get(server) ?? [])` | Description gives the exact render expression. Child still computes `effectiveOrder = localOrder ?? sessionOrder`. | S:96 R:75 A:92 D:92 |
| 6 | Certain | Preserve the debounced PUT (`orderPutTimerRef` + `SESSION_ORDER_DEBOUNCE_MS = 250`, `setSessionOrder`) exactly | Listed in PRESERVE EXACTLY; verified at source lines 668-675. | S:98 R:80 A:96 D:96 |
| 7 | Certain | No snap-back: override outlives the PUT until per-server SSE echo of the new order | Stated in PRESERVE EXACTLY and in the lifecycle subtlety; the whole point of the override persisting. | S:96 R:70 A:92 D:90 |
| 8 | Certain | Tests via `just test-frontend` scoped to sidebar test first; never invoke vitest/playwright directly | Description constraint + context.md "Always run tests through `just` recipes." | S:98 R:90 A:98 D:96 |
| 9 | Certain | No new dependencies; type narrowing over type assertions; follow existing sidebar patterns | Description CONSTRAINTS + code-quality.md frontend principle. | S:95 R:85 A:95 D:95 |
| 10 | Confident | Clear a server's override when incoming SSE order for THAT server deep-equals the override (per-server equality, shallow element-wise on flat `string[]`) | Description's primary suggested clear-trigger; alternative (clear on drag-end after successful PUT) is offered as an "or", so one front-runner with a named fallback. | S:85 R:65 A:80 D:70 |
| 11 | Confident | When the ref clears, trigger a render via a minimal mechanism (small version counter or forceUpdate), NOT a reintroduced broad effect | Description explicitly bounds the mechanism this way and delegates the exact choice to apply/plan. Low blast radius, one obvious family of solutions. | S:88 R:70 A:82 D:72 |
| 12 | Confident | Prefer NOT changing the child window-row prop shape (`sessionOrder`, `localOrder`, `sessionDragSource`, `sessionDropTarget`); touch the child only if a prop shape genuinely must change | Description states the preference twice; the override-in-ref design keeps the parent-passed `localOrder` prop semantics intact. | S:90 R:75 A:85 D:80 |
| 13 | Confident | Primary test target is `app/frontend/src/components/sidebar.test.tsx`; add/adjust unit coverage for (a) order follows SSE with no override, (b) override persists until matching SSE arrives then drops, (c) reorder still fires the debounced PUT | Description names the test file and the three required cases; e2e is "where feasible" with the unit test as priority. | S:90 R:85 A:85 D:82 |
| 14 | Confident | No memory file changes required | Implementation-only render-efficiency change with no spec-level behavior change; ui-patterns.md does not document the reorder override today. | S:82 R:80 A:80 D:78 |

14 assumptions (9 certain, 5 confident, 0 tentative, 0 unresolved).
