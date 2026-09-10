import { useCallback, useEffect, useRef } from "react";
import { useIsMobile } from "@/hooks/use-is-mobile";
import type { CronListResponse } from "@/api/client";
import type { CronActionHandlers } from "@/lib/palette/cron";
import type { ProjectSession } from "@/types";
import {
  CRONS_SCROLL_EVENT,
  consumePendingCronsScroll,
} from "@/lib/server-clock-dashboard-scroll";
import { WatchedZone } from "./watched-zone";
import { CronsZone } from "./crons-zone";
import { DeliveriesZone } from "./deliveries-zone";

/**
 * The tmux Server page's clock dashboard — the three zones WATCHED / CRONS /
 * RECENT DELIVERIES (descending operational urgency) mounted below the
 * Sessions grid via SessionTiles' `footer` slot, inside the same scrolling
 * tile area. Desktop-only: on mobile (`useIsMobile()` — narrow width OR
 * coarse pointer) it renders nothing; the mobile answer is the console
 * sheet's Activity feed.
 *
 * All data arrives by prop: `cronData` is app.tsx's single `useCronData`
 * response (no second hook, no fetch, no timer here), `sessions` the server's
 * sessions slice. The `Server: Clock dashboard` palette entry navigates to
 * `/$server` and fires the `CRONS_SCROLL_EVENT` document seam; this root
 * listens for it (plus the mount-time pending-flag consume for the
 * mount-after-dispatch race) and scrolls the CRONS heading into view.
 */
export function ServerClockDashboard({
  sessions,
  cronData,
  onNavigate,
  cronHandlers,
}: {
  sessions: ProjectSession[];
  cronData: CronListResponse;
  onNavigate: (windowId: string) => void;
  cronHandlers: CronActionHandlers;
}) {
  const isMobile = useIsMobile();
  const cronsRef = useRef<HTMLDivElement | null>(null);
  const scrollToCrons = useCallback(() => {
    cronsRef.current?.scrollIntoView({ block: "start" });
  }, []);

  useEffect(() => {
    document.addEventListener(CRONS_SCROLL_EVENT, scrollToCrons);
    if (consumePendingCronsScroll()) scrollToCrons();
    return () => document.removeEventListener(CRONS_SCROLL_EVENT, scrollToCrons);
  }, [scrollToCrons]);

  if (isMobile) return null;

  return (
    <div data-testid="server-clock-dashboard">
      <div className="mt-6">
        <WatchedZone sessions={sessions} onNavigate={onNavigate} />
      </div>
      <div className="mt-6" ref={cronsRef}>
        <CronsZone entries={cronData.entries} sessions={sessions} {...cronHandlers} />
      </div>
      <div className="mt-6">
        <DeliveriesZone deliveries={cronData.deliveries} />
      </div>
    </div>
  );
}
