# Intake: Sidebar Render Performance (memoize tree + leaf-scope the now-tick)

**Change**: 260613-ect6-sidebar-render-perf
**Created**: 2026-06-13

## Origin

Backlog item `[ect6]` (Sidebar improvements WAVE 2), created 2026-06-13. One-shot `/fab-new ect6` — no prior `/fab-discuss` in the conversation; the backlog entry itself carries the full design intent, which is reproduced here verbatim where it specifies values.

> [ect6] Sidebar improvements WAVE 2 — sidebar-render-perf (M, depends on Wave 1 change A merging first; one /fab-new intake). The render-perf pair that MUST travel together. Today every SSE sessions tick (fires several times/sec — session-context rebuilds slice Maps as fresh refs) re-renders the ENTIRE sidebar tree (every ServerGroup/SessionRow/WindowRow); grep confirms NO React.memo anywhere in the frontend. (1) Lift nowSeconds out of render bodies: `const nowSeconds=Math.floor(Date.now()/1000)` at index.tsx:697 and :907 is threaded as a prop into every WindowRow (index.tsx:803,1211) + WindowPanel, so it changes every render and would defeat memo — move the 'now' tick into a leaf useNow() hook used only inside duration-showing components (getWindowDuration at window-row.tsx:85), or precompute duration strings. (2) Wrap WindowRow/SessionRow/ServerGroup in React.memo AND stabilize per-row closures (index.tsx ~804-871 builds ~30 arrow handlers per ServerGroup per render; ~1223-1236 per WindowRow) via a useCallback factory keyed by id or by passing server/session/windowId as props. DO NOT undo the derive-over-store session-order pattern (orderOverrideRef ?? SSE order + render-time arraysEqual reconcile, index.tsx ~757-771) — deliberate prior fix 260609-ebks. Files: index.tsx, window-row.tsx, session-row.tsx, new useNow hook. COORDINATION: rebase after Wave-1 change A (both edit window-row.tsx); land BEFORE Wave 3 so keyboard-nav builds on memoized stable-prop rows.

**Coordination resolved at intake time**: Wave-1 change A (`sidebar-triage-signal`) **has already merged** — it is commit `3a59c5e` (`feat: Sidebar Triage Signal (#259)`) in the current history, and it touched `window-row.tsx` (it added the `fabDisplayState === "failed"` red treatment and the `isFailish` PR-failure dot around `window-row.tsx:229`). The "rebase after Wave-1 A" dependency is therefore satisfied; this change builds on the post-#259 `window-row.tsx`. The memoization work MUST preserve #259's failure-signal rendering.

## Why

**Problem.** The session SSE stream fires several times per second. Each tick lands in `SessionProvider` (`app/frontend/src/contexts/session-context.tsx`) and calls a slice updater that produces a fresh `slicesByServer` Map. Three derived per-field Maps — `sessionsByServer`, `sessionOrderByServer`, `isConnectedByServer` (`session-context.tsx:406–422`) — are each `useMemo`'d on `[slicesByServer]`, so a fresh `slicesByServer` makes **all three a fresh reference on every tick** (this is documented as intentional in the file's comment at :401–405). The context `value` then changes, every `Sidebar` consumer re-renders, and because **there is no `React.memo` anywhere in the frontend** (confirmed by grep), the entire sidebar subtree re-renders: every `ServerGroup`, every `SessionRow`, every `WindowRow`, on every tick — even for servers whose data did not change and even when nothing visible changed.

**Consequence if unfixed.** On an operator box with many servers/sessions/windows this is a continuous several-times-per-second full-tree reconcile. It wastes CPU, causes input jank (the tree is the keyboard-nav target Wave 3 will build on), and the cost scales with the number of rows — exactly the boxes where the sidebar matters most. It also makes the upcoming Wave-3 keyboard navigation build on an unstable, churning tree.

**Why this approach.** Two coupled moves, which is why the backlog says they "MUST travel together":

1. **Lift the `now` tick into a leaf hook.** `nowSeconds = Math.floor(Date.now() / 1000)` is computed in the `Sidebar` render body (`index.tsx:697`) and in `BottomPanels` (`index.tsx:907`), then threaded as a prop down through `ServerGroup` → `WindowRow` (`index.tsx:803`, `:1211`) and into the bottom `WindowPanel`. Because it is recomputed on every render and passed by value, it changes on every render — which would **defeat `React.memo`** (the memo'd child sees a new `nowSeconds` prop every time and re-renders anyway). The fix is to stop passing `now` as a prop and instead read it from a leaf `useNow()` hook **only inside the components that actually display a duration** (`getWindowDuration` at `window-row.tsx:86`, and the duration display in `WindowPanel`). Then the per-second tick re-renders only the handful of duration-showing leaves, not the tree.

2. **Memoize the row components AND stabilize their props.** Wrapping `WindowRow` / `SessionRow` / `ServerGroup` in `React.memo` only helps if their props are referentially stable across ticks. Today `index.tsx` builds ~30 fresh arrow handlers per `ServerGroup` per render (`index.tsx ~804–871`) and fresh per-`WindowRow` closures (`~1223–1236`), so memo would be a no-op. The closures must be stabilized — via `useCallback` factories and/or by passing identity props (`server`, `session`, `windowId`) down so the leaf calls a stable handler with its own identity rather than receiving a pre-bound closure.

Doing only one half is pointless: memo without prop stability is a no-op; lifting `now` without memo still re-renders the whole tree on every SSE tick. Both are required for the tree to stop churning.

## What Changes

### 1. New `useNow()` leaf hook

Add a small hook (file: `app/frontend/src/hooks/use-now.ts`, or the project's existing hooks location — match the repo convention) that returns the current `nowSeconds` and self-updates on an interval, triggering a re-render **only of the component that calls it**.

Shape (illustrative — final form follows existing hook conventions):

```ts
import { useEffect, useState } from "react";

/** Returns current epoch seconds, re-rendering the calling component once per
 *  second. Scope this to leaf components that display elapsed durations so the
 *  tick does not re-render their ancestors. */
export function useNow(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}
```

Notes:
- The 1s cadence matches the existing display granularity — `formatDuration` (`lib/format.ts`) renders `Ns`/`Nm`/`Nh`, so a coarser tick would lag the seconds display. (See Assumptions for the cadence decision.)
- `setInterval` here is **display-only**, not data polling — it does not violate the "no polling from the client; use the SSE stream" anti-pattern in `code-quality.md`, which is about fetching state. A 1s `setInterval` driving a local clock is a standard React idiom and is the backlog-sanctioned approach ("move the 'now' tick into a leaf useNow() hook").

### 2. Remove `nowSeconds` prop threading

- Delete `const nowSeconds = Math.floor(Date.now() / 1000)` at `index.tsx:697` (Sidebar body) and `index.tsx:907` (BottomPanels).
- Drop `nowSeconds` from `ServerGroupProps` (`index.tsx:956`) and from the `ServerGroup` JSX (`index.tsx:803`).
- Drop `nowSeconds` from `WindowRowProps` (`window-row.tsx:20`) and from the `WindowRow` call site (`index.tsx:1211`).
- Inside `WindowRow`, replace the prop with `const nowSeconds = useNow()` and keep the existing `getWindowDuration(win, nowSeconds)` call (`window-row.tsx:86`). **Refinement**: only the rows that actually show a duration need the tick — `getWindowDuration` returns `""` for `activity === "active"`. To avoid every window row re-rendering each second, prefer computing duration in a tiny dedicated leaf (e.g. a `<WindowDuration win={win} />` subcomponent that calls `useNow()` internally), so `WindowRow` itself stays static and only the duration text node re-renders. (See Assumptions — this is the recommended refinement over a bare `useNow()` in `WindowRow`.)
- Do the same for the bottom `WindowPanel` (the status-panel component fed `nowSeconds` from `BottomPanels`): read `useNow()` (or a duration leaf) inside it instead of receiving the prop.

### 3. `React.memo` the row components + stabilize props

**`WindowRow`** (`window-row.tsx`):
- Wrap the exported component in `React.memo`.
- The remaining props after removing `nowSeconds` must be referentially stable. The per-window closures built at the call site (`index.tsx ~1223–1236`: `onSelectWindow`, `onDoubleClickName`, `onKillClick`, `onDragStart`, `onDragOver`, `onDrop`, `onDragEnd`, `onColorChange`, `isPinnedToBoard`) are the obstacle. Stabilize by passing identity props (`server`, `session`, `win.windowId`, `win.index` are already passed) and lifting the handlers to stable `useCallback`s in `Sidebar` that take identity as arguments — then `WindowRow` invokes them. Where a closure must remain (e.g. it needs `win.name`), thread the raw identity and reconstruct inside the leaf.
- Map/array props (`rowTints`, `ansiPalette`, `boards`) must already be stable refs or be stabilized (they originate from context/`useMemo` upstream — verify they don't churn per tick).

**`SessionRow`** (`session-row.tsx`):
- Wrap the exported component in `React.memo`.
- Stabilize the call-site closures (`index.tsx ~1147–1166`: `onDragStart`, `onDragEnd`, `onToggleCollapse`, `onSelectFirstWindow`, `onCreateWindow`, `onKillClick`, `onDoubleClickName`, `onDragOver`, `onDragLeave`, `onDrop`, `onColorChange`) the same way — identity-arg `useCallback`s + identity props.

**`ServerGroup`** (`index.tsx:986`, currently a local function):
- Wrap in `React.memo` (extract to a `const ServerGroup = React.memo(function ServerGroup(props){…})` or equivalent).
- The ~30 arrow handlers built per `ServerGroup` per render (`index.tsx ~804–871`) are the main obstacle. Convert the `Sidebar`-level handlers to stable `useCallback`s. Several already take `srvInfo.name` from the closure — rework them to accept `server` as a leading argument so a single stable callback serves all groups, and have `ServerGroup` bind its own `server` when calling. The existing `toggleSession` (`index.tsx:687`) is already a `useCallback` and is the pattern to follow.
- Props that are themselves derived per render (`rawSessions`, `sessionOrder`, `localOrder`, the various `editingX`/`dragSource`/`dropTarget` slices computed inline at `index.tsx:782–797`) will still change identity when their underlying data changes — that is correct and desired (the group SHOULD re-render when its own data changes). The memo's job is to skip groups whose inputs are unchanged on an unrelated server's tick. Confirm the per-group slice props are computed such that an unchanged group gets stable values (e.g. passing `null` for a non-matching `editingWindow` already yields a stable `null`).

### 4. Invariants to preserve (do NOT break)

- **Derive-over-store session order** (`index.tsx ~757–771`): `orderOverrideRef.current[server] ?? sseOrder`, with the render-time `arraysEqual` reconcile that clears the override when SSE echoes it back. This is a deliberate prior fix (`260609-ebks`; see memory [[sidebar-session-order-derive-over-store]]). Memoization MUST NOT reintroduce a whole-Map watcher effect or change this derivation. Mutating `orderOverrideRef` during render stays as-is.
- **#259 triage signal** (`window-row.tsx ~229`): the `fabDisplayState === "failed"` red text treatment and the `isFailish` PR-failure dot must still render after memoization.
- **Single-source selection** (`index.tsx ~1192–1197`): `isSelected` derivation (URL window-id first, `isActiveWindow` fallback) is unchanged.
- **Existing per-component `useMemo`s** in `window-row.tsx` (`tint`, `uncoloredSelectedTint`, `borderColor`) stay; they are intra-component and orthogonal.

### 5. Tests

- Unit: `window-row.test.tsx` and `session-row.test.tsx` already render these components directly — update for the removed `nowSeconds` prop (rows now get `now` from `useNow()` internally; tests using fake timers or a fixed clock may need `vi.useFakeTimers()` for the duration display). Add a test asserting a row does NOT re-render when an unrelated prop reference is stable (memo behavior) — e.g. render with a stable handler set, rerender with the same props, assert the inner work (a spy on a render-counting child or `getWindowDuration`) did not re-run.
- Existing sidebar tests (`index.test.tsx`) must continue to pass — the public behavior (rows render, selection, drag, kill, rename, color, pin) is unchanged.
- Per the constitution's **Test Companion Docs** rule, any `*.spec.ts` touched needs its `*.spec.md` updated in the same commit — this change is expected to touch only unit tests (`*.test.tsx`), which are exempt, but if an e2e spec is added/changed the companion `.spec.md` is required.

## Affected Memory

- `run-kit/ui-patterns`: (modify) The `## Sidebar` section documents the sidebar component structure and conventions. Add the memoization + leaf-`useNow` render-perf contract: `ServerGroup`/`SessionRow`/`WindowRow` are `React.memo`'d; the per-second `now` tick lives in a leaf `useNow()` (not threaded as a prop); per-row handlers are stabilized via identity-arg `useCallback`s so memo is effective. Cross-link the derive-over-store order invariant.
- `run-kit/architecture`: (modify, possibly) The SSE-hub / data-flow section may warrant a note that the several-times-per-second `slicesByServer` rebuild (intentional fresh refs) is now absorbed by sidebar memoization rather than re-rendering the whole tree — decide at hydrate whether this rises to spec-level.

## Impact

- **Frontend only.** No backend, no API, no SSE-protocol changes. No new route (Minimal Surface Area constitution principle satisfied).
- **Files**: `app/frontend/src/components/sidebar/index.tsx` (Sidebar, ServerGroup, BottomPanels), `app/frontend/src/components/sidebar/window-row.tsx`, `app/frontend/src/components/sidebar/session-row.tsx`, the bottom `WindowPanel` (in `status-panel.tsx` — verify which file holds the `nowSeconds`-consuming panel), new `app/frontend/src/hooks/use-now.ts`, and the colocated `*.test.tsx` files.
- **Risk areas**: (a) prop-stabilization regressions — a handler that silently dropped a needed closure variable would break drag/kill/rename/color/pin; the existing unit tests are the guard. (b) `useNow` interval leaks if a duration leaf mounts/unmounts rapidly — the `useEffect` cleanup clears the interval. (c) memo comparison false-negatives (a prop that still churns) → no perf win but no correctness break; (d) memo comparison false-positives (a stale prop that should have updated) → a row shows stale data; the identity-prop approach avoids this because real data changes still change the relevant prop.
- **Verification gates** (per `code-quality.md`): `cd app/backend && go test ./...` (unaffected, sanity), `cd app/frontend && npx tsc --noEmit`, `just test` (frontend + e2e), `just build`. Optional: a Playwright/manual check that the tree no longer re-renders on idle SSE ticks (React DevTools "highlight updates" or a render-count probe) is the most direct proof of the perf goal.

## Open Questions

- None blocking. The cadence (1s) and the closure-stabilization mechanism (identity-arg `useCallback`s vs. a keyed factory) are recorded as Confident/Tentative assumptions below rather than asked, because the backlog prescribes the approach and both are low-blast-radius (reversible, codebase-determined).

## Assumptions

<!-- STATE TRANSFER table — sole continuity to the apply-entry agent. -->

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Wrap `WindowRow`/`SessionRow`/`ServerGroup` in `React.memo` and lift the `now` tick into a leaf `useNow()` hook instead of prop-threading `nowSeconds`. | Backlog prescribes both moves verbatim and states they MUST travel together; grep confirms no existing `React.memo` to conflict with. Template/config-determined approach. | S:95 R:75 A:95 D:95 |
| 2 | Certain | Preserve the derive-over-store session-order pattern (`orderOverrideRef ?? sseOrder` + render-time `arraysEqual` reconcile, `index.tsx ~757–771`); do not reintroduce a whole-Map watcher effect. | Explicit backlog directive + prior deliberate fix `260609-ebks` + memory [[sidebar-session-order-derive-over-store]]. Non-negotiable invariant. | S:95 R:70 A:95 D:95 |
| 3 | Certain | Wave-1 change A (`sidebar-triage-signal`) is already merged (#259, commit `3a59c5e`); proceed without waiting, and preserve #259's `fabDisplayState==="failed"` red treatment + `isFailish` PR dot in `window-row.tsx`. | Verified in git history at intake time; the stated coordination dependency is satisfied. | S:90 R:80 A:95 D:90 |
| 4 | Confident | `useNow()` ticks at 1 second via `setInterval`. | Display granularity is seconds (`formatDuration` floors to `Ns`/`Nm`/`Nh`); a coarser tick would lag the seconds readout, a finer one wastes renders. Matches the existing per-render `Math.floor(Date.now()/1000)` precision. Trivially reversible. | S:70 R:90 A:85 D:80 |
| 5 | Confident | Stabilize per-row handlers via identity-arg `useCallback`s in `Sidebar` (callbacks take `server`/`session`/`windowId` as arguments; leaves bind their own identity), following the existing `toggleSession` (`index.tsx:687`) pattern. | The codebase already uses this pattern; it keeps one stable callback per logical action rather than N keyed closures. Reversible refactor confined to `index.tsx`. | S:65 R:85 A:80 D:70 |
| 6 | Confident | The leaf that consumes `useNow()` is a tiny duration subcomponent (e.g. `<WindowDuration>`), not `WindowRow` itself, so only duration text nodes re-render per second rather than whole rows. | Backlog offers this as one of two options ("a leaf useNow() hook used only inside duration-showing components … or precompute duration strings"); the subcomponent maximizes the memo benefit. Easily adjusted if it complicates the row markup. | S:70 R:85 A:80 D:65 |
| 7 | Tentative | Place the new hook at `app/frontend/src/hooks/use-now.ts`. | Standard React hooks-dir convention, but the repo's existing hook location should be confirmed at apply time and matched; if the project keeps hooks elsewhere (e.g. colocated or under `lib/`), follow that instead. | S:55 R:90 A:60 D:60 |

7 assumptions (3 certain, 3 confident, 1 tentative, 0 unresolved).
