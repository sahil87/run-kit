import { useMediaQuery } from "./use-media-query";

/** The one media query both text-input surfaces key their Enter policy on —
 * pointer TYPE, deliberately NOT viewport width (`useIsMobile()`'s
 * narrow-width-OR-coarse rule): a narrow desktop window still has a hardware
 * keyboard, and a tablet with a hardware keyboard still gets the Cmd/Ctrl+Enter
 * escape hatch (260719-mxvw). */
const COARSE_POINTER_QUERY = "(pointer: coarse)";

/**
 * Returns true while the device's primary pointer is coarse (touch). Live: a
 * matchMedia change listener updates the value mid-session (plugging in a
 * mouse/keyboard flips the Enter policy and the `enterkeyhint` together).
 * Returns false in environments without `window.matchMedia`.
 */
export function useCoarsePointer(): boolean {
  return useMediaQuery(COARSE_POINTER_QUERY);
}
