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
    const widthMql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`);
    const pointerMql = window.matchMedia("(pointer: coarse)");
    const update = () => setIsMobile(widthMql.matches || pointerMql.matches);
    widthMql.addEventListener("change", update);
    pointerMql.addEventListener("change", update);
    update();
    return () => {
      widthMql.removeEventListener("change", update);
      pointerMql.removeEventListener("change", update);
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
