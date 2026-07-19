/**
 * Pure order-computation helpers for board pane reorder — used by the
 * command-palette Move Focused Pane Left/Right actions (`board-page.tsx`). The
 * drag-and-drop hook (`use-board-pane-reorder.ts`) deliberately does NOT import
 * this module: it derives neighbours inline from its final optimistic override
 * (see `computeMoveNeighbors`' note below), which is robust to mid-drag entry
 * churn where index-based arithmetic over the authoritative list is not.
 *
 * The board reorder endpoint (`POST /api/boards/{name}/reorder`) uses fractional
 * indexing: it mints an orderKey strictly between the moved pane's new
 * `before` and `after` neighbours (`ComputeOrderKey` in
 * `app/backend/internal/tmux/board.go`). So a move is expressed as ONE POST
 * carrying the new neighbours' windowIds — `before` is the windowId that ends
 * up immediately BEFORE the moved pane (smaller orderKey), `after` is the one
 * immediately AFTER (larger orderKey); each is `null` at the respective edge.
 *
 * Extracting the neighbour arithmetic here (mirroring `palette-move.ts`) keeps
 * the palette's Move Left/Right math unit-testable without mounting the board.
 */

/** Direction of a palette Move Left/Right action. */
export type MoveDelta = -1 | 1;

/** The moved pane's new neighbours — the reorder POST's `before`/`after`. */
export interface ReorderNeighbors {
  /** windowId immediately before the moved pane (smaller orderKey), or null at the start. */
  before: string | null;
  /** windowId immediately after the moved pane (larger orderKey), or null at the end. */
  after: string | null;
}

/**
 * Compute the moved pane's new `before`/`after` neighbour windowIds for an
 * insert-before move of the element at `fromIdx` to land at position `toIdx`
 * (insert-before semantics, matching `useServerReorder` / the sidebar
 * session-reorder splice). Returns `null` when the move is a no-op: an
 * out-of-range index, or a move that leaves the pane in the same slot.
 *
 * `orderedIds` is the current display order of pane windowIds. The result is
 * derived from the order AFTER the splice, so the neighbours reference the
 * pane's post-move siblings (never the moved pane itself).
 */
export function computeReorderNeighbors(
  orderedIds: string[],
  fromIdx: number,
  toIdx: number,
): ReorderNeighbors | null {
  if (fromIdx < 0 || fromIdx >= orderedIds.length) return null;
  if (toIdx < 0 || toIdx >= orderedIds.length) return null;
  if (fromIdx === toIdx) return null; // no-op: same slot

  const moved = orderedIds[fromIdx];
  const next = [...orderedIds];
  next.splice(fromIdx, 1);
  next.splice(toIdx, 0, moved); // insert-before semantics

  const landedIdx = next.indexOf(moved);
  const before = landedIdx > 0 ? next[landedIdx - 1] : null;
  const after = landedIdx < next.length - 1 ? next[landedIdx + 1] : null;
  return { before, after };
}

/**
 * Compute the neighbours for a palette Move Left/Right of the pane at
 * `currentIdx` by `delta`, gated by the list boundary (no wraparound). Returns
 * `null` at a boundary (index 0 cannot move left; the last index cannot move
 * right) or for an out-of-range index, matching the palette's hidden/no-op
 * gating. A thin wrapper over `computeReorderNeighbors` with the boundary check.
 *
 * This IS `computeReorderNeighbors`' in-repo caller (the palette Move path). The
 * DnD hook (`use-board-pane-reorder.ts`) deliberately does NOT call
 * `computeReorderNeighbors`: it derives before/after inline from its final
 * optimistic override, which is robust to mid-drag entry churn where index-based
 * arithmetic over the authoritative list is not (Plan DD-1, amended cycle 1).
 */
export function computeMoveNeighbors(
  orderedIds: string[],
  currentIdx: number,
  delta: MoveDelta,
): ReorderNeighbors | null {
  if (currentIdx < 0 || currentIdx >= orderedIds.length) return null;
  const target = currentIdx + delta;
  if (target < 0 || target >= orderedIds.length) return null; // boundary: no-op
  return computeReorderNeighbors(orderedIds, currentIdx, target);
}

/**
 * Resolve which index the focused pane now occupies after the board order may
 * have changed (own reorder echo, or a reorder arriving from another client).
 * Focus is tracked by the pane's `server:windowId` KEY, not by a raw positional
 * index: with `paneRefs` keyed to the authoritative order, a bare index bump
 * routes DOM focus into the DISPLACED NEIGHBOUR's terminal (wrong-terminal
 * keystrokes) before the echo settles, and an index does not survive a reorder
 * from another client. Given the current display order (`orderedKeys`), the
 * focused pane's `focusKey`, and a `fallbackIndex`:
 *
 *   - if `focusKey` is present in `orderedKeys`, return its index (focus follows
 *     the pane wherever it moved);
 *   - otherwise (no key yet, or the focused pane was unpinned/removed), clamp
 *     `fallbackIndex` into range — 0 when it is out of range or the board is
 *     empty-but-nonzero, matching the prior clamp-to-0 behaviour.
 *
 * Pure and unit-testable without mounting the board.
 */
export function focusedIndexForKey(
  orderedKeys: string[],
  focusKey: string | null,
  fallbackIndex: number,
): number {
  if (orderedKeys.length === 0) return 0;
  if (focusKey !== null) {
    const idx = orderedKeys.indexOf(focusKey);
    if (idx >= 0) return idx;
  }
  if (fallbackIndex < 0 || fallbackIndex >= orderedKeys.length) return 0;
  return fallbackIndex;
}

/**
 * Gate for imperative xterm focus on the board: return `true` only when a
 * user-INTENT flag is set AND the focused pane index has actually CHANGED from
 * the previously-focused index.
 *
 * The board's single focus effect runs on every `entries` identity change, and
 * `useBoardEntries` refetches a fresh array on every `board-changed` SSE event
 * from ANY board on ANY server (pin, unpin, remote reorder). Calling
 * `paneRefs.current[focusedIndex].focus()` on every such refetch yanks real DOM
 * focus into a pane's terminal while the user may be typing elsewhere (the
 * pin-popover, palette, a dialog, or the compose buffer) — the "SSE must not
 * steal focus" invariant (`docs/memory/run-kit/ui-patterns.md` § Keyboard
 * Navigation). It also auto-focuses pane 0's terminal on board load.
 *
 * Index change alone is NOT sufficient: a remote reorder — or a remote pin/unpin
 * AHEAD of the focused pane — from another client shifts the focused pane's
 * index via the key-reconcile, which changes the index without any user intent
 * (the focus-steal case the index-change proxy could not distinguish). So the
 * caller passes a true intent flag (`focusIntentRef`, set only at user-driven
 * focus sites: `Cmd+]`/`Cmd+[` cycling, palette cycle, a pane click that moves
 * focus, or an own move's initiation) and imperative focus fires only when that
 * flag rode into the render that changed the index.
 *
 * Intent alone is NOT sufficient either: a same-index render must not re-focus
 * (same-index user actions — single-pane cycle, a click on the already-focused
 * pane — are handled imperatively at the call sites WITHOUT the flag, so no
 * stale flag can linger). An SSE refetch that leaves the focused pane's index
 * unchanged (intent false, index same) and the initial board load (intent
 * false, index 0 unchanged from its seed) both return false.
 *
 * For an own move the flag is set at move INITIATION and survives the async
 * POST→SSE-echo window: the echo's key-reconcile bumps the index, the re-entered
 * settled pass consumes the flag, and R6's own-move follow is preserved.
 *
 * Pure and unit-testable without mounting the board — this is now literally the
 * `focusMovedRef` gate the sidebar keyboard-nav tree uses for the same reason
 * (a true intent flag consumed once, never set by passive re-renders).
 */
export function shouldFocusPane(
  intent: boolean,
  prevFocusedIndex: number,
  focusedIndex: number,
): boolean {
  return intent && prevFocusedIndex !== focusedIndex;
}
