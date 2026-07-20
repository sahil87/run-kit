# Intake: Board Pane Focus Intent Flag

**Change**: 260719-6dh9-board-focus-intent-flag
**Created**: 2026-07-20

## Origin

<!-- Backlog item [6dh9], picked up by the backlog-bugs sweep (BUG scope). One-shot dispatch; validity re-verified against current code before intake creation. -->

> [6dh9] Board pane focus residual (should-fix): the index-change gate cannot tell an own-move follow from a REMOTE-driven index reconcile — a board-changed from another client that shifts the focused pane's index fires .focus() into the xterm. Fix: a true intent flag mirroring the sidebar focusMovedRef. (relocated from docs/memory/run-kit/ui-patterns.md by /docs-distill-memory)

**Verification (2026-07-20)**: still valid. Trace in `app/frontend/src/components/board/board-page.tsx` (single focus effect, ~lines 226–257): a remote `board-changed` SSE refetch produces a fresh `entries` array; when the reorder shifts the focused pane's index, the `orderChanged` pass calls `setFocusedIndex(j)` (key-reconcile via `focusedIndexForKey`) and returns; the effect re-enters with `orderChanged=false`; `shouldFocusPane(prevFocusedIndexRef.current, focusedIndex)` (`src/lib/board-reorder.ts:146`) returns true because the index genuinely changed; `paneRefs.current[focusedIndex]?.focus()` yanks real DOM focus into the pane's xterm while the user may be typing elsewhere (palette, compose buffer, another app window's form…). The gate keys on "index changed", which is satisfied equally by an own-move follow (wanted) and a remote-driven reconcile (focus steal). The same steal fires when a remote **pin/unpin** ahead of the focused pane shifts its index, not just remote reorders.

## Why

1. **The pain point**: the board's imperative-focus gate (`shouldFocusPane`) approximates *user intent* with *index change*. The approximation is wrong exactly when another client mutates the shared board (reorder, pin, unpin) in a way that shifts the focused pane's index: the key-reconcile bumps `focusedIndex`, the gate sees a change, and DOM focus is stolen into an xterm. This violates the established "SSE must not steal focus" invariant (`docs/memory/run-kit/ui-patterns.md` § Keyboard Navigation) that the rest of the UI honors — the sidebar solved the identical problem with a true intent flag (`focusMovedRef`, `src/components/sidebar/index.tsx:852`).

2. **The consequence if unfixed**: on multi-client boards (the whole point of link-based board pinning), keystrokes destined for the palette/compose/another pane land in a terminal — worst case into a live agent composer, where stray text can be typed into (and with an Enter, submitted to) an agent session. Frequency scales with how actively other clients rearrange shared boards.

3. **Why this approach**: replace the index-change *proxy* with a true intent flag, mirroring the proven sidebar `focusMovedRef` pattern (set at every user-intent site, consumed exactly once by the focus effect, never set by passive re-renders). Alternatives rejected: suppressing focus on ALL order-changed re-entries (breaks the own-move follow — R6 of the board-reorder change deliberately focuses the moved pane after an own move's echo); debouncing/time-windowing SSE-adjacent focus (heuristic, racy, unprincipled when a true intent signal is available).

## What Changes

### `app/frontend/src/components/board/board-page.tsx` — intent flag

1. **Add the flag**: `const focusIntentRef = useRef(false);` beside `focusedKeyRef`, with a comment mirroring the sidebar's: gates the imperative `.focus()` to user-driven focus movement only; a passive `board-changed` refetch (remote reorder/pin/unpin) reconciles the index but never sets the flag, so it never steals focus.

2. **Set the flag at every user-intent site** (each site changes `focusedIndex` or initiates an own move whose echo will):
   - Keyboard cycle `Cmd/Ctrl + ]` / `[` (the `onKey` handler, ~line 267): set `focusIntentRef.current = true` before `setFocusedIndex(...)`. Guard: skip the set when `entries.length < 2` (a modulo cycle over one pane leaves the index unchanged — no re-render, and the flag would go stale).
   - Palette actions `Board: Cycle Pane Focus →` / `←` (~lines 608–622): same treatment.
   - Pane click (`onPaneClick={setFocusedIndex}` on both DesktopRow and the mobile carousel usage, ~lines 985/1001): replace with a `handlePaneClick` callback: if `idx !== focusedIndex`, set the flag then `setFocusedIndex(idx)`; if `idx === focusedIndex`, imperatively `paneRefs.current[idx]?.focus()` WITHOUT setting the flag (no state change ⇒ effect will not run ⇒ a set flag would go stale — this mirrors the sidebar's same-key imperative branch in `moveRovingTo`).
   - Own reorder — **palette move** (`moveFocusedPane`, ~line 684) and **DnD drop** (the `reorder` prop threaded to DesktopRow, ~line 994): wrap `reorder` from `usePinActions` in a board-page-level callback (e.g. `reorderWithFollow`) that sets `focusIntentRef.current = true` before delegating, and clears it (`false`) in the failure path (`.catch`) since no echo will arrive. Both own-move paths then set intent through one seam. The flag being set *asynchronously ahead* of the SSE echo is the deliberate design: the echo's reconcile pass bumps the index, the re-entered pass consumes the flag, and the own-move follow (R6) is preserved.

3. **Consume the flag in the focus effect**: the settled pass (after the key-reconcile) replaces
   `if (shouldFocusPane(prevFocusedIndexRef.current, focusedIndex))` with the intent-aware form, and clears the flag exactly when consumed. The `orderChanged` early-return pass must NOT clear the flag (it must survive to the re-entered settled pass — this is how the own-move follow works). The flag is cleared whenever the settled pass runs with the flag set — whether or not the index changed — so a stale flag cannot linger past its triggering render.

### `app/frontend/src/lib/board-reorder.ts` — gate helper

4. Extend `shouldFocusPane` to carry the intent dimension so it stays the unit-testable single authority:

```ts
export function shouldFocusPane(
  intent: boolean,
  prevFocusedIndex: number,
  focusedIndex: number,
): boolean {
  return intent && prevFocusedIndex !== focusedIndex;
}
```

Update its doc comment: index change alone is no longer sufficient (a remote-driven reconcile also changes the index); intent alone is not sufficient either (a same-index render must not re-focus; same-index user actions are handled imperatively at the call sites). Keep the "mirrors the sidebar focusMovedRef gate" note — it is now literal.

### Tests

5. **Unit** (`src/lib/board-reorder.test.ts`): update the `shouldFocusPane` suite for the new signature — the existing index-change cases all get `intent: true`; add the remote-reconcile case (`intent: false`, index changed → false) and the passive-refetch case (`intent: false`, index same → false).
6. **Component/behavioral coverage** (best effort, follow existing patterns in the board test files): if board-page has component tests exercising the focus effect, add a case asserting a remote-style `entries` reorder (no intent) does NOT call the pane handle's `focus()`, while a cycle action does. If only e2e covers this area, extend the existing board e2e spec + its `.spec.md` companion per the constitution (run via `just test-e2e "<spec>"` — never raw Playwright; note `just pw` is unreliable in this environment, prefer `just test-e2e`).

## Affected Memory

- `run-kit/ui-patterns`: (modify) — the board focus model: imperative focus is gated on a true user-intent flag (mirroring the sidebar `focusMovedRef`), not on index change; remote-driven reconciles (reorder/pin/unpin from another client) never move DOM focus; the own-move follow is preserved via the intent flag set at move initiation. This closes the "focus residual" noted when the item was relocated to the backlog.

## Impact

- `app/frontend/src/components/board/board-page.tsx` — one ref, flag-sets at ~5 intent sites (cycle keyboard, cycle palette ×2, pane click wrapper, wrapped reorder), gate consumption in the focus effect.
- `app/frontend/src/lib/board-reorder.ts` + `board-reorder.test.ts` — `shouldFocusPane` signature + tests.
- No backend change, no API change, no route change.
- Type check: `cd app/frontend && npx tsc --noEmit`; unit: `just test-frontend`.

## Open Questions

_None._

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | The bug is valid: remote-driven index reconcile fires `.focus()`; traced through the two-pass effect and `shouldFocusPane` | Code-verified 2026-07-20; the gate's own doc comment admits index change is the only signal | S:90 R:90 A:95 D:90 |
| 2 | Certain | Fix = true intent ref consumed by the focus gate, mirroring sidebar `focusMovedRef` | The backlog names the fix; the sidebar precedent is in-repo and battle-tested; `shouldFocusPane`'s comment already cites it as the mirror | S:90 R:90 A:90 D:85 |
| 3 | Confident | Intent sites = keyboard cycle, palette cycle ×2, pane click, own reorder (palette move + DnD) via one wrapped `reorder` seam | Enumerated from the five `setFocusedIndex` call sites + the two own-move initiators; a missed site degrades to "no focus follow" (safe direction, easily patched) | S:75 R:85 A:85 D:70 |
| 4 | Confident | Stale-flag discipline: set only when the action will change `focusedIndex` (single-pane cycle guard; same-index click focuses imperatively without the flag); clear on consumption and on reorder failure | Derived from React render semantics (no state change ⇒ no effect run ⇒ flag lingers); mirrors the sidebar's same-key imperative branch | S:70 R:85 A:85 D:70 |
| 5 | Certain | `focusedKeyRef` identity-reconcile machinery is untouched — only the imperative-focus gate changes | Identity tracking (which pane is focused) is correct today; the bug is exclusively in when DOM focus fires | S:85 R:90 A:95 D:90 |
| 6 | Confident | The intent flag deliberately survives the async POST→SSE-echo window for own moves; a remote event racing into that window could consume it early | Inherent to preserving R6's own-move follow without a request-id correlation protocol; the race window is one echo round-trip and the failure mode is a single benign focus-follow | S:70 R:80 A:80 D:65 |

6 assumptions (3 certain, 3 confident, 0 tentative, 0 unresolved).
