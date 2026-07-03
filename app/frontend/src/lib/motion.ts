/**
 * True when the user prefers reduced motion. Only called from browser event
 * handlers / effects (never SSR), so `window` is always defined here — but
 * jsdom lacks `matchMedia`, so keep the capability guard for the unit-test
 * environment.
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
