/**
 * Breadcrumb min-useful-width collapse — the pure derivation behind the
 * top bar's collapse rung (crumbs truncate → crumbs collapse into one `… ▾`
 * crumb → breakpoint-hidden). The component owns all DOM measurement
 * (ResizeObserver + a hidden min-useful-width probe row); this module owns
 * the decision, so the threshold/hysteresis behavior is unit-testable
 * without layout (jsdom has no layout engine).
 */

/** Minimum useful content width per crumb, in `ch` — below this a truncated
 *  crumb carries no information (the `ru…` fragment class), so the pair
 *  collapses into a single `… ▾` crumb instead. */
export const CRUMB_MIN_USEFUL_CH = 6;

/** One-sided hysteresis on the EXPAND edge, in px: a collapsed section
 *  re-expands only once the available width clears the threshold by this
 *  margin, so a resize hovering on the boundary cannot flap the rendering. */
export const CRUMB_COLLAPSE_HYSTERESIS_PX = 24;

/**
 * Collapse decision for the server+session crumb section.
 *
 * - `availablePx`  — the section wrapper's `clientWidth` (the wrapper is
 *   `flex-1 min-w-0`, so this is the space the crumbs may occupy in BOTH the
 *   collapsed and expanded states).
 * - `requiredPx`   — the hidden probe row's `scrollWidth`: the crumbs rendered
 *   at their min-useful form (real text, `max-w-[6ch]` truncation), i.e. the
 *   smallest width at which every crumb still renders ≥6ch of content.
 * - `prevCollapsed`— the current state; collapse is stateful so the expand
 *   edge can carry hysteresis.
 *
 * Unmeasured environments (jsdom, pre-mount, hidden probes reading 0) keep
 * the previous state — the expanded default is the safe cold answer.
 */
export function deriveCrumbsCollapsed(
  availablePx: number,
  requiredPx: number,
  prevCollapsed: boolean,
  hysteresisPx: number = CRUMB_COLLAPSE_HYSTERESIS_PX,
): boolean {
  if (availablePx <= 0 || requiredPx <= 0) return prevCollapsed;
  if (prevCollapsed) return availablePx < requiredPx + hysteresisPx;
  return availablePx < requiredPx;
}
