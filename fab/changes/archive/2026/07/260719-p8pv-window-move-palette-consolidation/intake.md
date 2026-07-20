# Intake: Consolidate Window Move Palette Entries

**Change**: 260719-p8pv-window-move-palette-consolidation
**Created**: 2026-07-20

## Origin

Backlog item `[p8pv]` (fab/backlog.md), processed by an autonomous backlog-sweep agent:

> Consolidate the Window: Move Left/Move Right palette pair with the newer Window: Move up/Move down entries.

Validity verified against current code: `app/frontend/src/app.tsx:1691-1798` registers **four** window-move palette entries expressing **two** operations. `Window: Move Left` (id `move-window-left`) and `Window: Move up` (id `window-move-up`) are behaviorally identical (delta −1 through `computeWindowMoveTarget`, same `moveWindow` call, same same-windowId navigate with `search: (prev) => prev`, same `index > minWindowIndex` gate); likewise `Move Right` / `Move down` (delta +1, `index < maxWindowIndex` gate). The inline comment and memory (`docs/memory/run-kit/ui-patterns.md:1635` — "four palette entries express two operations") both record the up/down pair as additive-only-to-avoid-regressing — i.e., this consolidation was deliberately deferred.

## Why

1. **Pain point**: the palette lists four entries for two operations. A user typing "move" while on a window sees `Move Left`, `Move Right`, `Move up`, `Move down` — two of which are aliases — plus ~80 lines of duplicated handler code in `app.tsx` that must be kept in sync.
2. **Consequence of not fixing**: every future tweak to the move flow (like the `260714-r7rq` view-preserving `search` addition) must be applied four times; the palette noise grows as more window actions land.
3. **Approach — keep up/down, remove Left/Right**: every other reorder surface in the palette uses up/down vocabulary (`Session: Move up/down`, `Server: Move up/down`, `Board: Move up/down`), and windows render as *vertical* sidebar rows — up/down matches what the user sees. The Left/Right pair is the older naming from when the tmux status-bar mental model dominated. Rejected: keeping Left/Right and dropping up/down (breaks vocabulary parity with the three sibling groups); rejected: label aliases on one entry (palette has no alias mechanism; adding one for this is over-engineering).

## What Changes

### 1. `app.tsx` (~lines 1691-1746): remove the Left/Right entries

Delete the `move-window-left` and `move-window-right` action objects (both conditional spreads). The `window-move-up` / `window-move-down` entries (~lines 1747-1798) remain as the sole move pair — unchanged behavior: `computeWindowMoveTarget(index, ±1, min, max)`, `moveWindow(server, windowId, targetIndex)`, navigate to same `windowId` with `search: (prev) => prev`, boundary = hidden (no wraparound). Update the up/down pair's leading comment (drop "kept alongside them so the existing left/right entries are not regressed" — it now IS the pair).

### 2. `app.test.tsx`: retarget move-action tests to the surviving pair

The existing suite (header comment lines ~11-12, action fixtures ~31-39, and the five tests: middle shows both / hidden at min / hidden at max / single-window hides both / onSelect fires) asserts `Window: Move Left`/`Move Right` labels and `move-window-left`/`-right` ids. Retarget all of them to `Window: Move up`/`Move down` and `window-move-up`/`window-move-down`. Coverage stays equivalent — the tests prove boundary gating and onSelect wiring for the surviving entries; no test should remain that references the removed labels/ids.

### 3. Sweep for other references

`grep -a` sweep (NUL-safe — session-tiles.tsx) for `move-window-left`, `move-window-right`, `Window: Move Left`, `Window: Move Right` across `app/frontend/` — expected hits are only app.tsx + app.test.tsx (verified at intake time; `board-reorder.ts`'s "palette Move Left/Right" comments refer to the Board *pane* actions — a horizontal surface, explicitly out of scope).

## Affected Memory

- `run-kit/ui-patterns`: (modify) § Window move actions (~lines 1629-1635) — rewrite to present truth: one pair (`Window: Move up`/`Move down`, ids `window-move-up`/`-down`), boundary-hidden, via `computeWindowMoveTarget`; drop the "four palette entries express two operations" additive-pair paragraph.

## Impact

- `app/frontend/src/app.tsx` (−~56 lines), `app/frontend/src/app.test.tsx` (label/id retargets), `docs/memory/run-kit/ui-patterns.md` (hydrate).
- User-visible change: the `Window: Move Left`/`Move Right` palette labels disappear; the operations remain under `Move up`/`Move down`. No backend, no routes, no e2e surface (no e2e spec references these labels — grep-verified).

## Open Questions

*(none)*

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Up/down pair survives; Left/Right removed | Vocabulary parity with Session/Server/Board Move up/down; windows are vertical sidebar rows; backlog phrasing ("consolidate with the newer entries") points the same way | S:65 R:80 A:85 D:70 |
| 2 | Certain | Board pane Move Left/Right actions are out of scope | Different surface (horizontal board row); backlog names only the Window: pair | S:80 R:90 A:95 D:90 |
| 3 | Confident | Existing app.test.tsx move tests are retargeted (not duplicated) to the surviving ids/labels | Tests exist to prove gating/wiring of the palette move pair; keeping dead-label tests is impossible (they'd fail), duplicating for both pairs is moot after removal | S:70 R:90 A:90 D:85 |
| 4 | Certain | Removing a palette entry is not a keyboard-reachability regression (Constitution V) | The same operations remain keyboard-reachable via the surviving pair | S:75 R:90 A:95 D:90 |

4 assumptions (2 certain, 2 confident, 0 tentative, 0 unresolved).
