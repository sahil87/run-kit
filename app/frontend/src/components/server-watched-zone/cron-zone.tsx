import { useEffect, useRef } from "react";
import { useLocation } from "@tanstack/react-router";
import { CronList } from "@/components/cron-list";
import { CronStaleBanner } from "@/components/cron-stale-banner";
import { SectionHeading } from "@/components/section-heading";
import { useCronData } from "@/hooks/use-cron";
import { sortCronEntries } from "@/lib/cron-list-model";
import { formatDuration } from "@/lib/format";
import type { CronEntry } from "@/api/client";

/** The URL hash the mobile seam arm navigates with so the section scrolls
 *  itself into view; the section's `id` is the same token. */
export const CRON_ZONE_HASH = "cron";

/**
 * The side-slot readout: entry count plus the soonest next fire. Render-time
 * only — the SSE cadence is the clock, never a timer.
 */
export function cronZoneSide(entries: readonly CronEntry[], nowSeconds: number): string {
  if (entries.length === 0) return "no entries";
  const count = `${entries.length} ${entries.length === 1 ? "entry" : "entries"}`;
  const soonest = sortCronEntries([...entries])[0];
  if (soonest?.nextFire === undefined) return count;
  const delta = soonest.nextFire - nowSeconds;
  return delta <= 0 ? `${count} · next due` : `${count} · next in ${formatDuration(delta)}`;
}

/**
 * The CRON zone — the tmux Server page's second content block on MOBILE, where
 * the desktop page carries WATCHED. Cron needs no operator, and a phone has no
 * quake drawer and, without an operator window, no operator route either, so
 * this section is the operator-less cron home: the same `CronList` the
 * operator route's Cron List tab mounts (no `inline` — the modal detail-sheet
 * variant), under the staleness banner. Rendered whenever the mobile Server
 * page renders, operator or not — a deterministic projection of
 * `useCronData(server)`.
 *
 * The section scrolls itself into view once on mount when the location hash
 * is `#cron` (the seam arm's navigation target). Explicit rather than relying
 * on router hash handling: the section lives inside the tiles' own scroll
 * container, not the document scroller.
 */
export function CronZone({ server }: { server: string }) {
  const { entries } = useCronData(server);
  const hash = useLocation({ select: (location) => location.hash });
  const rootRef = useRef<HTMLElement>(null);
  const scrolledRef = useRef(false);

  useEffect(() => {
    if (scrolledRef.current || hash !== CRON_ZONE_HASH) return;
    scrolledRef.current = true;
    rootRef.current?.scrollIntoView({ block: "start" });
  }, [hash]);

  const side = cronZoneSide(entries, Math.floor(Date.now() / 1000));

  return (
    <section ref={rootRef} id={CRON_ZONE_HASH} data-testid="clock-zone-cron" className="flex flex-col">
      <SectionHeading label="Cron" side={side} className="mb-2" />
      <CronStaleBanner server={server} />
      <CronList server={server} />
    </section>
  );
}
