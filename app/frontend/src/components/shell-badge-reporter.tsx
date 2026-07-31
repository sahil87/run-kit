import { useEffect, useMemo, useRef } from "react";
import { useSessionContext } from "@/contexts/session-context";
import { setShellBadge } from "@/lib/shell";
import { countWaitingAcrossServers } from "@/lib/waiting";

/**
 * Desktop-shell dock/taskbar badge subscriber (260731-ofws): mirrors the
 * waiting-agent count to the OS badge via the shell's `badge.set` bridge.
 * Renders nothing; callers gate the mount on `isShell()` (no-op in browsers).
 *
 * The count derives from the already-streamed SSE session state — WAITING
 * only (the status pyramid's attention tier: busy/idle never badge, so a
 * non-zero badge always means "act now"), summed across everything the
 * connected instance's stream covers (`sessionsByServer` — other registered
 * hosts' agents are not counted; the badge describes the window's host,
 * matching the titlebar strip's identity claim). No polling, no new endpoint
 * (Constitution II).
 *
 * Reports on CHANGE only (the derived count is the effect dependency, and a
 * ref guards re-mount duplicates), and reports `0` explicitly so clears
 * propagate. `setShellBadge` never throws — an older shell without the badge
 * group simply resolves false.
 */
export function ShellBadgeReporter() {
  const { sessionsByServer } = useSessionContext();
  const count = useMemo(() => countWaitingAcrossServers(sessionsByServer), [sessionsByServer]);
  const lastReportedRef = useRef<number | null>(null);

  useEffect(() => {
    if (lastReportedRef.current === count) return;
    lastReportedRef.current = count;
    void setShellBadge(count);
  }, [count]);

  return null;
}
