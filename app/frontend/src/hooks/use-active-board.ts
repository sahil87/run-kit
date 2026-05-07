import { useRouterState } from "@tanstack/react-router";

/**
 * Detect the currently-active board from the URL pathname (`/board/<name>`).
 * Returns null when not on a board route.
 *
 * Reads from TanStack Router's reactive location state — no popstate listeners
 * or history monkey-patches.
 */
export function useActiveBoardName(): string | null {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (!pathname.startsWith("/board/")) return null;
  const tail = pathname.slice("/board/".length);
  // Strip any trailing path segment (defensive — board route is currently leaf).
  const slash = tail.indexOf("/");
  const raw = slash === -1 ? tail : tail.slice(0, slash);
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
