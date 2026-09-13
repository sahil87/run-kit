import { useIsMobile } from "@/hooks/use-is-mobile";
import type { ProjectSession } from "@/types";
import { CronZone } from "./cron-zone";
import { WatchedZone } from "./watched-zone";

/**
 * The tmux Server page's second content block, mounted below the Sessions
 * grid via SessionTiles' `footer` slot inside the same scrolling tile area.
 * One root, two form factors (`useIsMobile()` — narrow width OR coarse
 * pointer): desktop carries the WATCHED zone (the operator-watchlist detail
 * table — the phone's watchlist home is the operator route's `?tab=tasks`),
 * mobile carries the CRON zone (the cron registry — the phone has no quake
 * drawer, and without an operator window no operator route, so this is its
 * operator-less cron home; desktop's is the drawer).
 *
 * Data arrives by prop or by the shared hooks; the zones hold no fetch loop
 * and no timer — the SSE cadence is the clock.
 */
export function ServerWatchedZone({
  server,
  sessions,
  onNavigate,
}: {
  server: string;
  sessions: ProjectSession[];
  onNavigate: (windowId: string) => void;
}) {
  const isMobile = useIsMobile();

  return (
    <div data-testid="server-clock-dashboard">
      <div className="mt-6">
        {isMobile ? (
          <CronZone server={server} />
        ) : (
          <WatchedZone sessions={sessions} onNavigate={onNavigate} />
        )}
      </div>
    </div>
  );
}
