# Intake: Shell-Titlebar Arrow-Key Release Flake Root Fix

**Change**: 260811-fgzi-shell-titlebar-arrow-release-flake
**Created**: 2026-08-11

## Origin

Backlog item `[fgzi]` (fab/backlog.md, 2026-08-11), invoked one-shot via `/fab-new fgzi`:

> Fix the shell-titlebar host-switcher arrow-key release flake at its root: handleKey in shell-titlebar-strip.tsx:141 closes over hostCount from the render that subscribed it, so the emptied-list guard at :154 only fires once the effect has re-subscribed — in the window after the menu unmounts but before passive effects flush, the stale handler still preventDefaults ArrowDown/ArrowUp app-wide. Read the live row count from a ref inside handleKey instead. Surfaces as a CI-only flake in shell-titlebar-strip.test.tsx:346 (seen on main 1329aa3 and PR #553)

The flake was previously diagnosed as pre-existing on main (proven on clean `1329aa3`, 2026-08-01) — the standing guidance was "rerun, don't bisect". This change removes the root cause so that guidance can be retired.

## Why

1. **The pain point**: `shell-titlebar-strip.test.tsx:346` ("closes and releases key handling when the open-time refetch empties the list") fails intermittently in CI. The assertion `expect(fireEvent.keyDown(document.body, { key: "ArrowDown" })).toBe(true)` occasionally observes `false` — a capture-phase handler called `preventDefault` even though the menu is gone.

2. **The root cause is a real (if tiny) production bug, not a test artifact**: the capture-phase keydown effect in `shell-titlebar-strip.tsx` (lines 135–167) captures `hostCount = rows.length` in its closure at subscription time. When the open-time refetch resolves with an empty list, React commits a render in which `interactive` flips false and the trigger + menu unmount — but the previously subscribed handler (with the stale non-zero `hostCount`) stays attached to `document` until the effect cleanup runs at passive-effect flush. Any ArrowDown/ArrowUp dispatched in that commit→flush window is swallowed app-wide (`preventDefault` + `stopPropagation`): the `:154` emptied-list guard reads the *captured* count, so it cannot fire until the effect has re-subscribed with the new value. The existing guard was added exactly for the emptied-list scenario but only covers the post-flush steady state, not the flush window itself.

3. **Consequence of not fixing**: a permanently flaky CI assertion that trains people to rerun (and has already required a memory note to prevent mis-bisection of unrelated PRs), plus the app-wide arrow-swallow window in the real Electron shell whenever a host-list refetch empties the list while the menu is open.

4. **Why this approach**: reading the live row count from a ref inside `handleKey` makes the guard reflect the *committed* row count regardless of which subscription the handler came from — the stale-closure window ceases to exist as a behavioral window. Alternatives (e.g., forcing synchronous effect teardown, or wrapping test timing in `act`) would either fight React's effect model or fix the test while leaving the production window in place.

## What Changes

### `app/frontend/src/components/shell-titlebar-strip.tsx` — live-count ref in the keydown guard

Current shape (the bug):

```tsx
useEffect(() => {
  if (!open) return;
  const hostCount = rows.length;            // captured at subscription time
  const count = hostCount + (canAdd ? 1 : 0);
  function handleKey(e: KeyboardEvent) {
    ...
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (hostCount === 0) return;          // :154 — reads the STALE capture
      e.preventDefault();
      ...
    }
  }
  document.addEventListener("keydown", handleKey, { capture: true });
  return () => document.removeEventListener("keydown", handleKey, { capture: true });
}, [open, rows.length, canAdd]);
```

New shape: introduce a ref that always holds the committed row count (e.g., `hostCountRef`), updated so it is current by commit time — before any keydown processed after that render can reach the handler. Inside `handleKey`, the emptied-list guard reads `hostCountRef.current` instead of the closure capture; the wraparound modulus (`count`) derives from the same live read plus `canAdd`, so a shrunk-but-non-empty list also cycles over the live count rather than the stale one (a stale modulus today merely no-ops on a null `itemRefs` slot, but reading live makes the whole branch consistent):

```tsx
const hostCountRef = useRef(0);
// kept current at commit — the stale-handler window between a commit and
// its passive-effect flush must observe the NEW count
hostCountRef.current = rows.length;   // or via useLayoutEffect; apply decides
...
function handleKey(e: KeyboardEvent) {
  ...
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    const hostCount = hostCountRef.current;
    if (hostCount === 0) return;      // fires even from a stale subscription
    const count = hostCount + (canAdd ? 1 : 0);
    e.preventDefault();
    ...
  }
}
```

The update mechanism must make the ref current **no later than commit** (a render-time latest-ref write or a `useLayoutEffect` both satisfy this; a passive `useEffect` would NOT — it flushes in the same phase as the subscription swap it is meant to beat). Choice of mechanism is an apply-stage decision; `canAdd` may stay closure-captured (it only changes when the bridge shape changes, never mid-window) or ride a ref for uniformity — apply decides.

Behavior explicitly preserved:

- Escape handling, focus return to trigger, and `stopPropagation` on handled arrows are unchanged.
- The effect's existing comment block at :150–153 (explaining why the guard exists) should be updated to describe the ref-read mechanism.
- The close-on-empty effect (`:116–118`), the clamp effect (`:189–198`), and the open-transition-only focus-seed effect (`:170–182`) are untouched — they handle the post-flush steady state correctly today.

### `app/frontend/src/components/shell-titlebar-strip.test.tsx` — existing test becomes deterministic

`shell-titlebar-strip.test.tsx:322–348` ("closes and releases key handling when the open-time refetch empties the list") is already the regression test for exactly this window: its `waitFor` observes the DOM at commit and the synchronous `fireEvent.keyDown` can beat the passive-effect flush — which is the flake. With the ref-read guard, the keydown is released regardless of whether the stale handler is still attached, so the test passes deterministically with **no test changes required**. If apply finds the test still racy for a different reason, that is new information to surface, not something to patch around (Test Integrity: tests conform to spec).

### Memory-note retirement (outside the repo — informational)

The operator's auto-memory note "shell-titlebar arrow-release CI flake — rerun, don't bisect" becomes obsolete once this merges; it is session tooling, not repo content, and is not part of this change's diff.

## Affected Memory

- `run-kit/ui-patterns`: (modify) § Desktop-Shell Titlebar Strip — the "three guards make an open-time refetch safe" paragraph currently claims the arrow branch's zero-count return covers "the one render where an emptied list has unmounted the rows but `open` is still true"; that claim is what this change corrects. Update it to describe the live-count ref read (guard is subscription-staleness-proof, not just steady-state-correct).

## Impact

- **Code**: one component, `app/frontend/src/components/shell-titlebar-strip.tsx` — a ref addition and a guard/modulus read change inside one effect. No API, routing, backend, or shell (Electron) surface touched. The strip is Electron-shell-only chrome (`isShell()`-gated), invisible to every browser and to Playwright.
- **Tests**: covered by the existing colocated vitest suite `shell-titlebar-strip.test.tsx` (the `:346` assertion is the regression test). No e2e involvement — no Playwright spec can see the strip, so no `.spec.md` obligations arise.
- **Risk**: very low — the change narrows an over-broad `preventDefault` window; keyboard behavior with a live menu is unchanged (same guard threshold, same wraparound arithmetic, values read one commit fresher).
- **CI**: retires a known flaky assertion (`shell-titlebar-strip.test.tsx:346`), previously observed on main `1329aa3` and PR #553.

## Open Questions

None — the backlog entry prescribes the root cause, the fix mechanism, and the affected lines; code inspection confirms all three.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Root cause is the stale-closure window: the capture-phase handler subscribed with a non-zero `hostCount` stays attached from commit until passive-effect flush after the emptied-list render | Code inspection confirms the backlog diagnosis (`shell-titlebar-strip.tsx:135–167`); flake proven pre-existing on clean main `1329aa3` (2026-08-01), so it is not PR-induced | S:90 R:80 A:95 D:95 |
| 2 | Certain | Fix is a live row-count ref read inside `handleKey` — the emptied-list guard and the wraparound modulus key on `hostCountRef.current` instead of the closure capture | Backlog entry prescribes exactly this; it removes the window itself rather than patching test timing | S:95 R:85 A:90 D:90 |
| 3 | Confident | The ref update mechanism must be current no later than commit (render-time latest-ref write or `useLayoutEffect`); a passive `useEffect` write is insufficient. Exact mechanism chosen at apply | Both valid options close the window; passive-effect update would flush in the same phase as the subscription swap and reintroduce the race | S:60 R:90 A:80 D:70 |
| 4 | Certain | The keydown effect's subscription and dependency list (`[open, rows.length, canAdd]`) stay as-is; the ref read alone closes the window. Narrowing deps is an optional simplification left to apply | Re-subscription churn is harmless; the correctness fix is independent of it | S:70 R:95 A:85 D:75 |
| 5 | Certain | `shell-titlebar-strip.test.tsx:346` remains the regression test unchanged; no new e2e (the strip is `isShell()`-gated and invisible to Playwright) | The test already asserts exactly the released-keydown behavior; it flakes only because the window exists | S:80 R:90 A:95 D:90 |
| 6 | Certain | Hydrate modifies `run-kit/ui-patterns` § Desktop-Shell Titlebar Strip to replace the now-corrected zero-count-guard claim with the ref-read mechanism | The memory paragraph documents the exact guard this change replaces; leaving it would contradict the code | S:75 R:95 A:90 D:85 |

6 assumptions (5 certain, 1 confident, 0 tentative, 0 unresolved).
