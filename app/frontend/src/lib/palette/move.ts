/**
 * Pure order-computation helpers for the command-palette Move up/down actions
 * (Server / Session / Window). Extracted from app.tsx so the boundary gating,
 * effective-order derivation, and swap arithmetic are unit-testable without
 * mounting the whole shell. The palette action bodies are thin wrappers that
 * call these and then invoke the corresponding client mutation
 * (setServerOrder / setSessionOrder / moveWindow).
 */

/** Direction of a Move up/down (or Move Left/Right) action. */
export type MoveDelta = -1 | 1;

/**
 * Derive the effective session display order for a server: the persisted SSE
 * order (`@rk_session_order`) filtered to live session names, with any live
 * sessions not present in the persisted order appended in their natural order.
 * This is the "SSE order ?? natural" derivation the palette Session: Move
 * actions gate on (the sidebar's transient drag override is component-local and
 * not visible to the palette). Byte-order of `liveNames` is preserved for the
 * appended tail.
 */
export function deriveEffectiveSessionOrder(
  liveNames: string[],
  sseOrder: string[],
): string[] {
  const liveSet = new Set(liveNames);
  const ordered = sseOrder.filter((n) => liveSet.has(n));
  const orderedSet = new Set(ordered);
  const appended = liveNames.filter((n) => !orderedSet.has(n));
  return [...ordered, ...appended];
}

/**
 * Compute the new full order after moving the element at `currentIdx` by
 * `delta` (insert-before semantics via splice). Returns `null` when the move is
 * a no-op: the index is out of range, or the target crosses a list boundary (no
 * wraparound). Shared by Server: Move and Session: Move.
 */
export function computeMoveOrder(
  order: string[],
  currentIdx: number,
  delta: MoveDelta,
): string[] | null {
  if (currentIdx < 0 || currentIdx >= order.length) return null;
  const target = currentIdx + delta;
  if (target < 0 || target >= order.length) return null; // boundary: no-op
  const name = order[currentIdx];
  const next = [...order];
  next.splice(currentIdx, 1);
  next.splice(target, 0, name);
  return next;
}

/**
 * Compute the target tmux window index for a Window: Move (up/down or
 * left/right) — `index + delta`, gated by the session's `[minIndex, maxIndex]`
 * range. Returns `null` at a boundary (no wraparound), matching the palette's
 * hidden/no-op gating. The window's stable ID is unchanged by the move; only
 * its index shifts.
 */
export function computeWindowMoveTarget(
  index: number,
  delta: MoveDelta,
  minIndex: number,
  maxIndex: number,
): number | null {
  const target = index + delta;
  if (target < minIndex || target > maxIndex) return null; // boundary: no-op
  return target;
}
