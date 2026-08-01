import { useMediaQuery } from "./use-media-query";

/** Pointer TYPE, deliberately NOT viewport width (`useIsMobile()`'s
 * narrow-width-OR-coarse rule): a narrow desktop window still has a hardware
 * keyboard. Consumers: the tooltip suppression (`Tip`) and the chat send
 * form's autofocus skip. (Its Enter-policy role ended with 260801-hsxm —
 * Enter inserts a newline on every pointer type.) */
const COARSE_POINTER_QUERY = "(pointer: coarse)";

/**
 * Returns true while the device's primary pointer is coarse (touch). Live: a
 * matchMedia change listener updates the value mid-session. Returns false in
 * environments without `window.matchMedia`.
 */
export function useCoarsePointer(): boolean {
  return useMediaQuery(COARSE_POINTER_QUERY);
}
