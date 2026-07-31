import { useEffect, useState } from "react";

/**
 * One-shot media-query evaluation for non-hook contexts (state init, event
 * handlers). Returns false in non-browser environments (SSR, jsdom variants,
 * older WebViews) where `window` or `window.matchMedia` may be missing.
 */
export function evaluateMediaQuery(query: string): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(query).matches;
}

/**
 * Subscribe to a media query; updates live via a matchMedia change listener.
 * One MediaQueryList subscription per call; a changed `query` resubscribes.
 * Returns false (with no subscription) in environments without `matchMedia`.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => evaluateMediaQuery(query));

  useEffect(() => {
    // Guard for non-browser environments — mirror `evaluateMediaQuery()` so
    // the hook never throws on mount.
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    // Re-read `mql.matches` rather than trusting an event object — the same
    // handler then also serves the post-subscribe sync below.
    const update = () => setMatches(mql.matches);
    // `addEventListener` on MediaQueryList is the modern API. Older WebKit/IE
    // implementations only have the deprecated `addListener`/`removeListener`
    // — fall back to those when the modern method is missing.
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", update);
    } else if (typeof (mql as MediaQueryList & { addListener?: (fn: () => void) => void }).addListener === "function") {
      (mql as MediaQueryList & { addListener: (fn: () => void) => void }).addListener(update);
    }
    // Sync once after subscribing — catches a change between state init (or a
    // query-prop change) and the effect run.
    update();
    return () => {
      if (typeof mql.removeEventListener === "function") {
        mql.removeEventListener("change", update);
      } else if (typeof (mql as MediaQueryList & { removeListener?: (fn: () => void) => void }).removeListener === "function") {
        (mql as MediaQueryList & { removeListener: (fn: () => void) => void }).removeListener(update);
      }
    };
  }, [query]);

  return matches;
}
