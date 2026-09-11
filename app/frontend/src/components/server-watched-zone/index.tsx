import { useIsMobile } from "@/hooks/use-is-mobile";
import type { ProjectSession } from "@/types";
import { WatchedZone } from "./watched-zone";

/**
 * The tmux Server page's WATCHED zone — the operator-watchlist detail table
 * mounted below the Sessions grid via SessionTiles' `footer` slot, inside the
 * same scrolling tile area. Desktop-only: on mobile (`useIsMobile()` — narrow
 * width OR coarse pointer) it renders nothing; the Server page on a phone
 * keeps its tiles unchanged.
 *
 * All data arrives by prop: `sessions` is the server's sessions slice. The
 * zone holds no fetch and no timer — the SSE cadence is the clock.
 */
export function ServerWatchedZone({
  sessions,
  onNavigate,
}: {
  sessions: ProjectSession[];
  onNavigate: (windowId: string) => void;
}) {
  const isMobile = useIsMobile();
  if (isMobile) return null;

  return (
    <div data-testid="server-clock-dashboard">
      <div className="mt-6">
        <WatchedZone sessions={sessions} onNavigate={onNavigate} />
      </div>
    </div>
  );
}
