/** Minimal shape required for window-cycle logic. */
export type NavWindow = { index: number; optimistic?: boolean };

/** Minimal shape required for session-cycle logic. */
export type NavSession = { name: string; windows: readonly NavWindow[]; optimistic?: boolean };

/** Returns windows that are confirmed (non-ghost, non-negative index), sorted ascending. */
export function realWindows(windows: readonly NavWindow[]): NavWindow[] {
  return windows
    .filter((w) => !w.optimistic && w.index >= 0)
    .sort((a, b) => a.index - b.index);
}

/**
 * Given the current window list, the URL's windowIndex string, and a direction,
 * returns the index to navigate to, or null if navigation is not possible.
 *
 * Returns null when:
 * - Fewer than 2 confirmed windows exist (nothing to cycle to)
 * - currentWindowIndex doesn't match any confirmed window (e.g. still on a ghost URL)
 */
export function resolveWindowCycle(
  windows: readonly NavWindow[],
  currentWindowIndex: string | undefined,
  direction: "up" | "down",
): number | null {
  const sorted = realWindows(windows);
  if (sorted.length < 2) return null;
  const pos = sorted.findIndex((w) => String(w.index) === currentWindowIndex);
  if (pos === -1) return null;
  const next =
    direction === "down"
      ? sorted[(pos + 1) % sorted.length]
      : sorted[(pos - 1 + sorted.length) % sorted.length];
  return next.index;
}

/**
 * Given the sessions list, the current session name, and a direction,
 * returns { session, windowIndex } to navigate to, or null if not possible.
 *
 * Returns null when:
 * - Fewer than 2 navigable sessions exist (ghost sessions and sessions with no
 *   confirmed windows are excluded)
 * - currentSession is not found among navigable sessions
 */
export function resolveSessionCycle(
  sessions: readonly NavSession[],
  currentSession: string | undefined,
  direction: "left" | "right",
): { session: string; windowIndex: number } | null {
  const navigable = sessions.filter((s) => !s.optimistic && realWindows(s.windows).length > 0);
  if (navigable.length < 2) return null;
  const pos = navigable.findIndex((s) => s.name === currentSession);
  if (pos === -1) return null;
  const next =
    direction === "right"
      ? navigable[(pos + 1) % navigable.length]
      : navigable[(pos - 1 + navigable.length) % navigable.length];
  const first = realWindows(next.windows)[0];
  if (!first) return null;
  return { session: next.name, windowIndex: first.index };
}
