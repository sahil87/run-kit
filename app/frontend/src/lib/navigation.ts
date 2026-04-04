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
}): RedirectTarget | null {
  const { sessionName, windowIndex, currentSessionWindows, currentWindowExists, isConnected } = params;

  if (!sessionName || !isConnected) return null;

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
