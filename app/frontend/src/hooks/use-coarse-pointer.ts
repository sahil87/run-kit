import { useMediaQuery } from "./use-media-query";

/** Pointer TYPE, deliberately NOT viewport width (`useIsMobile()`'s
 * narrow-width-OR-coarse rule): a narrow desktop window still has a hardware
 * keyboard. Consumers: the tooltip suppression (`Tip`). (Its Enter-policy role
 * ended with 260801-hsxm — Enter inserts a newline on every pointer type.)
 *
 * EXPORTED as the shared coarse-pointer query literal: non-hook consumers
 * (terminal-client's per-event capture-phase suppressors) evaluate it via
 * `evaluateMediaQuery` so there is ONE definition of "coarse" — a change to
 * the query (e.g. a `pointer:` → `any-pointer:` switch) applies everywhere.
 * `any-pointer` (not `pointer`): iPadOS reports a FINE primary pointer when a
 * trackpad/mouse is paired, which would drop every touch affordance on a
 * touch-capable device — this must stay in lockstep with the Tailwind
 * `coarse:` variant (globals.css) and use-is-mobile's COARSE_QUERY. */
export const COARSE_POINTER_QUERY = "(any-pointer: coarse)";

/**
 * Returns true while the device has any coarse (touch) pointer available.
 * Live: a matchMedia change listener updates the value mid-session. Returns
 * false in environments without `window.matchMedia`.
 */
export function useCoarsePointer(): boolean {
  return useMediaQuery(COARSE_POINTER_QUERY);
}
