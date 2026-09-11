import { useState } from "react";
import { useCronData } from "@/hooks/use-cron";
import { formatDuration } from "@/lib/format";
import { CronEntryDetailSheet } from "@/components/cron-entry-detail-sheet";
import type { CronDelivery } from "@/api/client";

const ROW_CLASS =
  "flex w-full items-baseline gap-2 px-3 py-2 text-left text-xs coarse:min-h-[44px]";

/**
 * The Cron Log tab — the server's delivery log, nothing else: every line of
 * `useCronData(server).deliveries` (fires, `missed`, `skipped-absent`,
 * `rate-capped`, `rescheduled`, respawn outcomes) in the API's
 * most-recent-first order, rendered as-is. No upcoming fires, no "now"
 * divider — the registry half lives in the Cron List tab. Data rides the
 * mount fetch + state-socket sessions cadence — no polling.
 *
 * Tapping a row whose entry still exists opens the entry detail sheet; a line
 * for a since-deleted entry stays valid history but opens nothing (the sheet
 * needs the live entry). `inline` (the desktop drawer mount) makes the root
 * `relative` so the sheet's in-container variant anchors to it, and forwards
 * the flag.
 *
 * An unresolvable server degrades to the operator console's absent/hint state
 * (a centered hint line) and fires no request.
 */
export function CronLog({ server, inline = false }: { server: string; inline?: boolean }) {
  const { entries, deliveries } = useCronData(server);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);

  const selectedEntry = selectedEntryId
    ? entries.find((e) => e.id === selectedEntryId)
    : undefined;

  const nowMs = Date.now();

  if (!server) {
    return (
      <div
        className="flex-1 min-h-0 flex items-center justify-center px-4 text-xs text-text-secondary"
        data-testid="cron-log-unresolved"
      >
        no server resolved — cron log unavailable
      </div>
    );
  }

  return (
    <div
      className={`flex-1 min-h-0 flex flex-col${inline ? " relative" : ""}`}
      data-testid="cron-log"
    >
      <div className="flex-1 min-h-0 overflow-y-auto">
        {deliveries.length === 0 ? (
          <div
            className="flex h-full items-center justify-center px-4 text-xs text-text-secondary"
            data-testid="cron-log-empty"
          >
            No deliveries yet on {server}.
          </div>
        ) : (
          deliveries.map((delivery, i) => (
            <DeliveryRow
              key={`${delivery.ts}-${delivery.entry}-${i}`}
              delivery={delivery}
              nowMs={nowMs}
              entryKnown={entries.some((e) => e.id === delivery.entry)}
              onOpen={() => setSelectedEntryId(delivery.entry)}
            />
          ))
        )}
      </div>
      {selectedEntry && (
        <CronEntryDetailSheet
          server={server}
          entry={selectedEntry}
          onClose={() => setSelectedEntryId(null)}
          inline={inline}
        />
      )}
    </div>
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
