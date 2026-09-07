import { useMemo, useState } from "react";
import { useSessionContext } from "@/contexts/session-context";
import { useCronData } from "@/hooks/use-cron";
import { describeSchedule } from "@/lib/cron-schedule";
import { formatDuration } from "@/lib/format";
import { CronEntryDetailSheet } from "@/components/cron-entry-detail-sheet";
import type { CronDelivery, CronEntry } from "@/api/client";

/**
 * The mobile Activity feed — one time-ordered triage timeline for the
 * server's cron clock (the healthchecks.io agenda pattern), mounted in place
 * of the terminal on the operator route's `?tab=activity`. Data rides
 * `useCronData` (mount fetch + the existing state-socket sessions cadence —
 * no new polling loop).
 *
 * Anatomy: the pinned staleness banner (rendered exactly when the server's
 * sessions report `operatorStale`, derived from the already-shipped
 * `operatorLastTickAt` — no new fetch), then the scrollable timeline:
 * upcoming fires (every entry, muted/orphaned included but DIMMED, never
 * omitted; farthest at the top so the SOONEST sits adjacent to the divider;
 * entries the evaluator gave no `nextFire` — cron-kind, unresolved — carry no
 * fabricated time), a single "now" divider, then recent deliveries
 * (newest-first, so the newest sits adjacent to the divider). Tapping a row
 * opens the entry detail sheet scoped to that entry.
 *
 * An unresolvable server degrades to the operator console's absent/hint state
 * (a centered hint line) and fires no request.
 */
export function CronActivityFeed({ server }: { server: string }) {
  const { sessionsByServer } = useSessionContext();
  const sessions = useMemo(() => sessionsByServer.get(server) ?? [], [sessionsByServer, server]);
  const { entries, deliveries } = useCronData(server);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);

  const staleSession = sessions.find((s) => s.operatorStale === true);
  const selectedEntry = selectedEntryId
    ? entries.find((e) => e.id === selectedEntryId)
    : undefined;

  const nowMs = Date.now();

  if (!server) {
    return (
      <div
        className="flex-1 min-h-0 flex items-center justify-center px-4 text-xs text-text-secondary"
        data-testid="cron-activity-empty"
      >
        no server resolved — cron activity unavailable
      </div>
    );
  }

  // Display order top→bottom: farthest future first, soonest LAST (adjacent
  // to the divider). Entries without a nextFire sort to the far (top) end —
  // they stay listed (dimmed when muted/orphaned) but show no time.
  const upcoming = [...entries].sort(
    (a, b) => (b.nextFire ?? Number.MAX_SAFE_INTEGER) - (a.nextFire ?? Number.MAX_SAFE_INTEGER),
  );
  // Deliveries arrive most-recent-first from the API — rendered as-is so the
  // newest sits adjacent to the divider.
  const past = deliveries;

  const empty = upcoming.length === 0 && past.length === 0;

  return (
    <div className="flex-1 min-h-0 flex flex-col" data-testid="cron-activity-feed">
      {staleSession && (
        <div
          className="shrink-0 border-b border-border px-3 py-2 text-xs text-signal-yellow"
          data-testid="cron-activity-banner"
          role="status"
        >
          {staleSession.operatorLastTickAt
            ? `operator tick — last seen ${formatDuration(Math.max(0, Math.floor(nowMs / 1000 - staleSession.operatorLastTickAt)))} ago`
            : "operator tick — no recent tick"}
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {empty ? (
          <div className="flex h-full items-center justify-center px-4 text-xs text-text-secondary">
            no cron entries on this server
          </div>
        ) : (
          <>
            {upcoming.map((entry) => (
              <UpcomingRow
                key={entry.id}
                entry={entry}
                nowMs={nowMs}
                onOpen={() => setSelectedEntryId(entry.id)}
              />
            ))}
            <div
              className="flex items-center gap-2 px-3 py-1.5 text-[10px] uppercase tracking-wider text-text-secondary select-none"
              data-testid="cron-activity-now"
              aria-hidden="true"
            >
              <span className="h-px flex-1 bg-border" />
              now
              <span className="h-px flex-1 bg-border" />
            </div>
            {past.map((delivery, i) => (
              <DeliveryRow
                key={`${delivery.ts}-${delivery.entry}-${i}`}
                delivery={delivery}
                nowMs={nowMs}
                entryKnown={entries.some((e) => e.id === delivery.entry)}
                onOpen={() => setSelectedEntryId(delivery.entry)}
              />
            ))}
          </>
        )}
      </div>
      {selectedEntry && (
        <CronEntryDetailSheet
          server={server}
          entry={selectedEntry}
          onClose={() => setSelectedEntryId(null)}
        />
      )}
    </div>
  );
}

const ROW_CLASS =
  "flex w-full items-baseline gap-2 px-3 py-2 text-left text-xs coarse:min-h-[44px]";

function UpcomingRow({
  entry,
  nowMs,
  onOpen,
}: {
  entry: CronEntry;
  nowMs: number;
  onOpen: () => void;
}) {
  const dimmed = entry.muted === true || entry.orphaned === true;
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid={`cron-upcoming-row-${entry.id}`}
      className={`${ROW_CLASS} ${dimmed ? "opacity-50" : ""}`}
    >
      <span className="min-w-0 flex-1 truncate text-text-primary">
        {entry.name || entry.id}
        {entry.muted === true && <span className="text-text-secondary"> · muted</span>}
        {entry.orphaned === true && <span className="text-text-secondary"> · orphaned</span>}
      </span>
      <span className="min-w-0 flex-[2] truncate text-text-secondary">
        {describeSchedule(entry)}
      </span>
      <span className="shrink-0 text-text-secondary">
        {entry.nextFire !== undefined
          ? entry.nextFire * 1000 > nowMs
            ? `in ${formatDuration(Math.floor(entry.nextFire - nowMs / 1000))}`
            : "due"
          : ""}
      </span>
    </button>
  );
}

function DeliveryRow({
  delivery,
  nowMs,
  entryKnown,
  onOpen,
}: {
  delivery: CronDelivery;
  nowMs: number;
  /** The detail sheet needs the live entry — a delivery for a since-deleted
   *  entry stays valid history but opens nothing. */
  entryKnown: boolean;
  onOpen: () => void;
}) {
  const elapsed = Math.max(0, Math.floor(nowMs / 1000 - delivery.ts));
  const body = (
    <>
      <span className="min-w-0 flex-1 truncate text-text-primary">
        {delivery.name || delivery.entry}
      </span>
      <span className="min-w-0 flex-[2] truncate text-text-secondary">{delivery.outcome}</span>
      <span className="shrink-0 text-text-secondary">{formatDuration(elapsed)} ago</span>
    </>
  );
  if (!entryKnown) {
    return (
      <div data-testid={`cron-delivery-row-${delivery.entry}`} className={ROW_CLASS}>
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid={`cron-delivery-row-${delivery.entry}`}
      className={ROW_CLASS}
    >
      {body}
    </button>
  );
}
