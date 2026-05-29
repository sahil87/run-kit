/**
 * Compute where to redirect when the current session or window no longer exists.
 * Returns null when no redirect is needed.
 */
export type RedirectTarget =
  | { to: "dashboard" }
  | { to: "window"; session: string; windowId: string };

export function computeKillRedirect(params: {
  sessionName: string | undefined;
  /** The URL's window segment — the tmux window ID (@N) of the viewed window. */
  windowId: string | undefined;
  /**
   * Surviving windows for the current session, in list (index) order. The
   * killed window is already absent here (the SSE snapshot that triggered the
   * redirect removed it).
   */
  currentSessionWindows: { index: number; windowId: string }[] | null;
  currentWindowExists: boolean;
  isConnected: boolean;
  /**
   * True if the URL's (session, window) pair has been observed as VALID at least
   * once in the SSE data since the last server/URL change. Gates "gone" redirects
   * so a stale-cached or partially-populated first SSE payload can't bounce the
   * user to a sibling or the dashboard before fresh data confirms the URL target
   * is truly missing.
   *
   * Valid = session is present AND its windows list contains our windowId.
   * Defaults to `true` to preserve prior behavior for callers that don't track it
   * (e.g. legacy unit tests).
   */
  currentWindowEverSeen?: boolean;
}): RedirectTarget | null {
  const {
    sessionName,
    windowId,
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

  // Window gone — navigate to a surviving neighbor by its list position. The
  // killed window's stable ID is no longer present, and reorder/kill make the
  // numeric index unreliable for distance math, so we pick the first surviving
  // window in list order (a deterministic adjacent neighbor) and target it by
  // its stable windowId.
  if (windowId && !currentWindowExists) {
    if (currentSessionWindows.length > 0) {
      const target = currentSessionWindows[0];
      return { to: "window", session: sessionName, windowId: target.windowId };
    }
    return { to: "dashboard" };
  }

  return null;
}
