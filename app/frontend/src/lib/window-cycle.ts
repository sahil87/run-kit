/**
 * Cross-session window cycling + session jumps (the `Tab: Previous/Next` and
 * `Session: Previous/Next` palette bodies in app.tsx ride these): pure
 * target resolution over the sessions array — the `tile-chord.ts` /
 * `zen-mode.ts` pure-lib convention, so the boundary/wrap/fallback matrix is
 * unit-test territory, not component-test territory.
 *
 * The `sessions` array order IS the sidebar order (the `useMergedSessions`
 * output) — no re-sorting here. Both resolvers are total: every degenerate
 * shape (empty, missing current window, empty target session) resolves null,
 * and the caller treats null as "no action" (the palette entry is omitted /
 * the chord falls through) rather than throwing.
 */

/** The window slice a cycle resolver needs (structural — SessionInfo's
 *  `windows` rows satisfy it without an import cycle). */
export type CycleWindow = { windowId: string; isActiveWindow: boolean };

/** The session slice a cycle resolver needs. */
export type CycleSession = { windows: readonly CycleWindow[] };

/**
 * The target of a one-row window step over the FLATTENED all-sessions window
 * list (sidebar order): one row in `direction`, wrapping at the ends, so
 * crossing a session boundary lands on the adjacent session's edge window.
 * Null when there is nothing to navigate to: no windows at all, or the
 * current window id resolves nowhere in the list (a stale route param mid
 * SSE refresh — a no-op, never a throw).
 */
export function cycleWindowTarget(
  sessions: readonly CycleSession[],
  currentWindowId: string | null | undefined,
  direction: -1 | 1,
): string | null {
  const flat = sessions.flatMap((s) => s.windows);
  if (currentWindowId == null || flat.length === 0) return null;
  const idx = flat.findIndex((w) => w.windowId === currentWindowId);
  if (idx < 0) return null;
  return flat[(idx + direction + flat.length) % flat.length].windowId;
}

/**
 * The target of a session hop: the ADJACENT session in sidebar order
 * (wraparound), landing on that session's tmux-active window
 * (`isActiveWindow`). A target session whose snapshot carries no active
 * window (the stale-SSE edge) falls back to its first window in sidebar
 * order — never skipped. Sessions with no windows contribute nothing to the
 * ring (no jump can land on them). Null when no OTHER windowed session
 * exists or the current window resolves to no session.
 */
export function sessionJumpTarget(
  sessions: readonly CycleSession[],
  currentWindowId: string | null | undefined,
  direction: -1 | 1,
): string | null {
  if (currentWindowId == null) return null;
  // The jump ring indexes ONLY windowed sessions, so an empty session never
  // swallows a hop (its step continues to the next windowed one).
  const ring = sessions.filter((s) => s.windows.length > 0);
  const curIdx = ring.findIndex((s) =>
    s.windows.some((w) => w.windowId === currentWindowId),
  );
  if (curIdx < 0 || ring.length < 2) return null;
  const target = ring[(curIdx + direction + ring.length) % ring.length];
  return (target.windows.find((w) => w.isActiveWindow) ?? target.windows[0]).windowId;
}
