# Intake: Fix sidebar non-current group expand (mss7)

**Change**: 260602-mss7-fix-sidebar-group-expand
**Created**: 2026-06-02
**Status**: Draft

## Origin

> Can you check the issue mss7 - does it still exist, if so, how to fix it?

One-shot investigation request against backlog item `mss7`. The investigation was performed live during `/fab-discuss` → `/fab-new` (not assumed): the failing e2e test was reproduced, the page state was probed in a real browser, a candidate fix was applied and re-verified green, then reverted so the actual fix lands during the apply stage.

**Key finding — the backlog's theorized root cause is WRONG.** `mss7` (written 2026-06-02) attributed the failure to an attach→SSE→sessions-arrive race: `attachServer(B)` called as an impure side-effect inside the `setServerSectionsOpen` updater, with the EventSource for B never opening or desyncing under StrictMode. Direct probing disproved this:

- B's EventSource (`/api/sessions/stream?server=B`) **opens on page load**, before any expand click — confirmed via captured network requests. B is attached and streaming the whole time. The attach/SSE path is not the failure.
- After clicking B's "Expand" button, the group's `aria-expanded` is **still `false`** and the `{isOpen && …}` body never renders. **The group never opens at all** — so the missing session rows are a downstream symptom, not the bug.

The bug is in the toggle itself, not the attach path.

## Why

1. **Problem**: Clicking the Expand chevron on a *non-current* server group in the sidebar Sessions area does nothing — the group stays collapsed, so the user cannot reach sessions on any server other than the one in the URL. `multi-server-sidebar.spec.ts:70` fails deterministically (verified 3/3, reproduced fresh on 2026-06-02 against the isolated `:3020` harness).

2. **Consequence if unfixed**: Multi-server navigation via the sidebar is broken — a core affordance of the multi-server sidebar (#192) is dead for every non-current server. The e2e suite also stays red, which (per the standing "E2E red on main since ≥#214" pattern) keeps masking new regressions.

3. **Root cause**: `toggleServerSection` (`app/frontend/src/components/sidebar/index.tsx:149-173`) performs side-effects **inside** the `setServerSectionsOpen` state updater — specifically `localStorage.setItem(...)` (line 161-162) and `attachServer(...)` (line 168-169). React 19 StrictMode (active via `main.tsx:8`, in dev and e2e) **double-invokes state updaters** to surface impurity. The trace through a single click on a collapsed group:
   - **Invocation 1**: `prev[server]` is `undefined` → reads localStorage (unset) → `current = false` → `next = true` → **writes `localStorage["runkit-panel-sessions-B"] = "true"`** → returns `{B: true}`. React *discards* this result (StrictMode).
   - **Invocation 2** (same `prev`): `prev[server]` still `undefined` → reads localStorage, which **now reads `"true"`** (invocation 1's write persisted) → `current = true` → `next = false` → writes `"false"` → returns `{B: false}`. React **keeps this result**.
   - Net effect: the click is a no-op. The group never opens.

   The impurity is the `localStorage.setItem` *inside* the updater: the second pass observes the first pass's write and inverts the decision. (The `attachServer` call is a second, independent impurity — also worth removing — but it is not what breaks this test.)

4. **Why it was thought "sound"**: The Vitest unit test (`index.test.tsx`) does **not** wrap the component in `<StrictMode>`, so the updater runs once and the bug is invisible. The unit tests also only exercise the *Server Pane* toggle (`runkit-panel-server`) and the *static* (localStorage-seeded) expand path — never a *click* on a per-server group's Expand button under StrictMode, which is the one broken path.

## What Changes

### Make `toggleServerSection` pure (the fix)

Move both side-effects out of the `setServerSectionsOpen` updater. Compute the next state from the current source of truth (`readServerOpen`, which already falls back to localStorage), perform side-effects once, then commit a pure functional update.

`app/frontend/src/components/sidebar/index.tsx` — replace the updater-with-side-effects (lines 149-173) with:

```tsx
const toggleServerSection = useCallback((server: string) => {
  // The state updater MUST be pure: under React 19 StrictMode it is invoked
  // twice. A side-effect inside it (localStorage.setItem, attachServer) runs
  // twice and — worse — the second invocation observes the first's localStorage
  // write and inverts `next`, making a single click a no-op (the group never
  // opened). Read once and act once OUTSIDE the updater, then commit purely.
  const current = readServerOpen(server);
  const next = !current;
  try {
    localStorage.setItem(`runkit-panel-sessions-${server}`, String(next));
  } catch {
    // localStorage unavailable
  }
  if (next && server !== currentServer) {
    attachServer(server);
  }
  setServerSectionsOpen((prev) => ({ ...prev, [server]: next }));
}, [currentServer, attachServer, readServerOpen]);
```

This was prototyped during intake and verified: `multi-server-sidebar.spec.ts` (both tests) pass, and all 7 `index.test.tsx` unit tests still pass.

### Add a regression test that runs under StrictMode

The escaped bug is precisely "a click toggle under StrictMode." Add a Vitest test in `index.test.tsx` that renders the sidebar wrapped in `<StrictMode>`, clicks a non-current group's Expand button once, and asserts `aria-expanded` flips to `true` (and ideally that a *second* click collapses it). This is the unit-level guard that the existing suite lacks; it would fail against the current impure updater and pass after the fix. Without it, the only protection is the e2e — which is the layer that has been chronically red.

## Affected Memory

- `run-kit/ui-patterns`: (modify) — note the StrictMode purity constraint on sidebar state updaters (no localStorage writes / no `attachServer` inside a `setState` updater), so the pattern isn't reintroduced. Only if the reviewer judges this a spec-level behavior note; otherwise this is implementation-local and no memory update is needed.

## Impact

- **Code**: `app/frontend/src/components/sidebar/index.tsx` (`toggleServerSection`, ~lines 149-173) — the only production change.
- **Tests**: `app/frontend/src/components/sidebar/index.test.tsx` (add StrictMode click-toggle regression test). `app/frontend/tests/e2e/multi-server-sidebar.spec.ts:70` flips from red to green — no test change needed there, but its `.spec.md` companion needs no change (behavior unchanged from the test's perspective).
- **No backend changes.** The `RK_SERVER_ALLOWLIST` prefix-match correctly admits server B (`rk-test-e2e-msb-*` has prefix `rk-test-e2e`), so server enumeration is not implicated.
- **Blast radius**: tiny. One callback, side-effects reordered, no API/contract change. The `attachServer`-inside-updater removal is a latent-correctness improvement riding along with the fix.

## Open Questions

- Should the `run-kit/ui-patterns` memory be updated with the StrictMode-purity constraint, or is this implementation-local enough to skip? (Leaning skip; defer to reviewer.)
- Should the regression test also assert collapse-on-second-click, or is open-on-first-click sufficient? (Leaning: assert both for a complete toggle cycle.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Bug still exists — `multi-server-sidebar.spec.ts:70` fails deterministically | Reproduced fresh 2026-06-02 on the isolated `:3020` harness (`just test-e2e`) | S:98 R:90 A:95 D:95 |
| 2 | Certain | Root cause is the impure `setServerSectionsOpen` updater (localStorage write inside it) inverting under StrictMode double-invocation — NOT the attach/SSE race the backlog theorized | Browser probe showed B's ES opens on load and `aria-expanded` stays false after click; StrictMode trace explains the no-op exactly | S:95 R:85 A:92 D:90 |
| 3 | Certain | Fix = move localStorage write + `attachServer` out of the updater; compute `next` via `readServerOpen` and commit a pure update | Prototyped and verified green (both e2e tests + 7 unit tests) during intake, then reverted | S:95 R:88 A:92 D:88 |
| 4 | Confident | Add a StrictMode-wrapped click-toggle regression test in `index.test.tsx` | code-quality.md requires tests for bug fixes; the gap that let this escape is the missing StrictMode click test | S:80 R:85 A:85 D:80 |
| 5 | Confident | No backend change needed; allowlist prefix-match admits server B | Verified `matchesServerAllowlist` uses HasPrefix and `rk-test-e2e-msb-*` matches `rk-test-e2e` | S:85 R:90 A:90 D:85 |
| 6 | Tentative | Skip the `run-kit/ui-patterns` memory update (treat as implementation-local) | Defensible either way; deferred to reviewer at hydrate <!-- assumed: memory update likely unnecessary for an impl-local purity fix; reviewer may decide otherwise --> | S:55 R:70 A:50 D:55 |

6 assumptions (3 certain, 2 confident, 1 tentative, 0 unresolved).
