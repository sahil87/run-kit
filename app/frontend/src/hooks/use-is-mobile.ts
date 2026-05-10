import { useEffect, useState } from "react";

/** Project-wide breakpoint for mobile layout (matches tailwind `sm:` 640px). */
export const MOBILE_BREAKPOINT_PX = 640;

/**
 * Returns true when the viewport is below the mobile breakpoint OR the device
 * has a coarse pointer (e.g., touch). Updates live via matchMedia listeners.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => evaluateIsMobile());

  useEffect(() => {
    // Guard for non-browser environments (SSR, jsdom variants, older WebViews)
    // where `window` or `window.matchMedia` may be missing — mirror the same
    // check used in `evaluateIsMobile()` so the hook never throws on mount.
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const widthMql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`);
    const pointerMql = window.matchMedia("(pointer: coarse)");
    const update = () => setIsMobile(widthMql.matches || pointerMql.matches);
    // `addEventListener` on MediaQueryList is the modern API. Older WebKit/IE
    // implementations only have the deprecated `addListener`/`removeListener`
    // — fall back to those when the modern method is missing.
    const addListener = (mql: MediaQueryList, fn: () => void) => {
      if (typeof mql.addEventListener === "function") {
        mql.addEventListener("change", fn);
      } else if (typeof (mql as MediaQueryList & { addListener?: (fn: () => void) => void }).addListener === "function") {
        (mql as MediaQueryList & { addListener: (fn: () => void) => void }).addListener(fn);
      }
    };
    const removeListener = (mql: MediaQueryList, fn: () => void) => {
      if (typeof mql.removeEventListener === "function") {
        mql.removeEventListener("change", fn);
      } else if (typeof (mql as MediaQueryList & { removeListener?: (fn: () => void) => void }).removeListener === "function") {
        (mql as MediaQueryList & { removeListener: (fn: () => void) => void }).removeListener(fn);
      }
    };
    addListener(widthMql, update);
    addListener(pointerMql, update);
    update();
    return () => {
      removeListener(widthMql, update);
      removeListener(pointerMql, update);
    };
  }, []);

  return isMobile;
}

function evaluateIsMobile(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return (
    window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`).matches ||
    window.matchMedia("(pointer: coarse)").matches
  );
}
