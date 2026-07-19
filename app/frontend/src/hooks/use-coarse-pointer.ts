import { useEffect, useState } from "react";

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
  const [coarse, setCoarse] = useState(() => evaluateCoarsePointer());

  useEffect(() => {
    // Guard for non-browser environments (SSR, jsdom variants, older WebViews)
    // — mirror `evaluateCoarsePointer()` so the hook never throws on mount.
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(COARSE_POINTER_QUERY);
    const update = () => setCoarse(mql.matches);
    // `addEventListener` on MediaQueryList is the modern API; older WebKit
    // implementations only have the deprecated `addListener`/`removeListener`
    // — fall back to those when the modern method is missing (the
    // `use-is-mobile.ts` pattern).
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", update);
    } else if (typeof (mql as MediaQueryList & { addListener?: (fn: () => void) => void }).addListener === "function") {
      (mql as MediaQueryList & { addListener: (fn: () => void) => void }).addListener(update);
    }
    update();
    return () => {
      if (typeof mql.removeEventListener === "function") {
        mql.removeEventListener("change", update);
      } else if (typeof (mql as MediaQueryList & { removeListener?: (fn: () => void) => void }).removeListener === "function") {
        (mql as MediaQueryList & { removeListener: (fn: () => void) => void }).removeListener(update);
      }
    };
  }, []);

  return coarse;
}

function evaluateCoarsePointer(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(COARSE_POINTER_QUERY).matches;
}
