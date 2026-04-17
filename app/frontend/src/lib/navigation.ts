/**
 * Compute where to redirect when the current session or window no longer exists.
 * Returns null when no redirect is needed.
 */
export type RedirectTarget =
  | { to: "dashboard" }
  | { to: "window"; session: string; windowIndex: number };

export function computeKillRedirect(params: {
  sessionName: string | undefined;
  windowIndex: string | undefined;
  currentSessionWindows: { index: number }[] | null;
  currentWindowExists: boolean;
  isConnected: boolean;
  /**
   * True if the URL's (session, window) pair has been observed as VALID at least
   * once in the SSE data since the last server/URL change. Gates "gone" redirects
   * so a stale-cached or partially-populated first SSE payload can't bounce the
   * user to a sibling or the dashboard before fresh data confirms the URL target
   * is truly missing.
   *
   * Valid = session is present AND its windows list contains our windowIndex.
   * Defaults to `true` to preserve prior behavior for callers that don't track it
   * (e.g. legacy unit tests).
   */
  currentWindowEverSeen?: boolean;
}): RedirectTarget | null {
  const {
    sessionName,
    windowIndex,
    currentSessionWindows,
    currentWindowExists,
    isConnected,
    currentWindowEverSeen = true,
  } = params;

  if (!sessionName || !isConnected) return null;

  // Any "gone" redirect must be gated by having previously observed the URL as
  // valid. A missing session or missing window on initial SSE catch-up (or a
  // stale cached payload, or a session with briefly-empty windows while tmux
  // enumeration propagates) is not proof the target is gone.
  if (!currentWindowEverSeen) return null;

  // Session gone entirely
  if (!currentSessionWindows) return { to: "dashboard" };

  // Window gone — find nearest sibling
  if (windowIndex && !currentWindowExists) {
    if (currentSessionWindows.length > 0) {
      const killedIdx = Number(windowIndex);
      const target = currentSessionWindows.reduce((best, w) =>
        Math.abs(w.index - killedIdx) < Math.abs(best.index - killedIdx) ? w : best,
      );
      return { to: "window", session: sessionName, windowIndex: target.index };
    }
    return { to: "dashboard" };
  }

  return null;
}
