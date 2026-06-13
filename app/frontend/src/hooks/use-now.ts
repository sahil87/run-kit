import { useEffect, useState } from "react";

/**
 * Returns the current epoch seconds, re-rendering the calling component once
 * per second.
 *
 * Scope this to leaf components that display elapsed durations (e.g. the
 * per-window duration text node) so the per-second tick re-renders only the
 * leaf, not its ancestors. This is what lets the memoized sidebar tree stay
 * static across the clock tick — the `now` value is read at the leaf instead
 * of being threaded down as a prop that changes every render.
 *
 * The `setInterval` here drives a local display clock; it is NOT data polling
 * (the "no client polling — use the SSE stream" anti-pattern is about fetching
 * state, which this does not do). The interval is cleared on unmount.
 */
export function useNow(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}
