/**
 * Command-palette attention navigation (260706-y1ar; status-pyramid.md
 * § Attention Propagation — the `Agent: Next waiting` action, the keyboard-first
 * attention nav per Constitution V). Pure cycle-selection arithmetic, extracted
 * so it is unit-testable without mounting the app shell — mirroring the
 * `palette-move.ts` pattern (do not extend that module; its charter is reorder
 * arithmetic, which deliberately does NOT wrap).
 */

/** A waiting window in cycle order (current server's windows first, then
 *  other attached servers'), identified by (server, windowId). */
export type WaitingTarget = { server: string; windowId: string };

/**
 * Pick the NEXT waiting target to navigate to, cycling with wraparound.
 *
 * `ordered` is the waiting list in cycle order (current server first, then
 * others — the caller builds it). `currentServer`/`currentWindowId` identify
 * the window the user is on. Returns:
 *   - `null` when the list is empty (caller shows the "no agents waiting" hint).
 *   - the FIRST target when the current window is not itself in the list
 *     (jump into the waiting set).
 *   - the target after the current one (wrapping past the end) when the current
 *     window IS a waiting target (advance to the next waiting window).
 *
 * A single-element list returns that element (self-cycle is a no-op navigation,
 * which is harmless and keeps "next" meaningful for a lone waiting window).
 */
export function nextWaitingTarget(
  ordered: WaitingTarget[],
  currentServer: string | undefined,
  currentWindowId: string | undefined,
): WaitingTarget | null {
  if (ordered.length === 0) return null;
  const idx = ordered.findIndex(
    (t) => t.server === currentServer && t.windowId === currentWindowId,
  );
  if (idx < 0) return ordered[0];
  return ordered[(idx + 1) % ordered.length];
}
