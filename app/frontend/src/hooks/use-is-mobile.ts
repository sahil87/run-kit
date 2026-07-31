import { evaluateMediaQuery, useMediaQuery } from "./use-media-query";

/** Project-wide breakpoint for mobile layout (matches tailwind `sm:` 640px). */
export const MOBILE_BREAKPOINT_PX = 640;

const NARROW_QUERY = `(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`;
const COARSE_QUERY = "(pointer: coarse)";

/**
 * Returns true when the viewport is below the mobile breakpoint OR the device
 * has a coarse pointer (e.g., touch). Updates live via matchMedia listeners.
 */
export function useIsMobile(): boolean {
  // Two separate subscriptions (width, pointer) ORed — deliberately not one
  // combined query string.
  const narrow = useMediaQuery(NARROW_QUERY);
  const coarse = useMediaQuery(COARSE_QUERY);
  return narrow || coarse;
}

/**
 * One-shot evaluation of the same mobile rule, for non-hook contexts (e.g.
 * `chrome-context.tsx` state init). Returns false where `matchMedia` is
 * unavailable.
 */
export function evaluateIsMobile(): boolean {
  return evaluateMediaQuery(NARROW_QUERY) || evaluateMediaQuery(COARSE_QUERY);
}
