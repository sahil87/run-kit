import { SectionHeading } from "@/components/section-heading";
import { formatDuration } from "@/lib/format";
import type { CronDelivery } from "@/api/client";
import { describeOutcome, formatClockTime, groupDeliveriesByDay } from "./model";

/**
 * The RECENT DELIVERIES zone — the server's delivery log as a compact
 * newest-first timeline: `{HH:MM} · {entry name} → {outcome}`. The API owns
 * the cap and the order (served most-recent-first, rendered as-is — no client
 * sort, no pagination, no fetch). A delivery for a since-deleted entry reads
 * `(deleted entry)` — the log stays valid history. Failure outcomes take the
 * signal-red text (`describeOutcome`); everything else renders verbatim.
 *
 * Day dividers appear only when the log spans more than one local calendar
 * day. The side slot reports the newest delivery's age at render time (the
 * SSE cadence is the clock — no timer).
 */
export function DeliveriesZone({ deliveries }: { deliveries: CronDelivery[] }) {
  const nowMs = Date.now();
  const groups = groupDeliveriesByDay(deliveries, nowMs);
  const side =
    deliveries.length > 0
      ? `last ${formatDuration(Math.max(0, Math.floor(nowMs / 1000) - deliveries[0].ts))} ago`
      : undefined;

  return (
    <div data-testid="clock-zone-deliveries">
      <SectionHeading label="Recent Deliveries" side={side} className="mb-2" />
      {deliveries.length === 0 ? (
        <div className="text-xs text-text-secondary font-mono">No deliveries yet</div>
      ) : (
        <div className="text-xs font-mono">
          {groups.map((group) => (
            <div key={group.label}>
              {groups.length > 1 && (
                <div
                  data-testid="delivery-day-divider"
                  className="mt-2 border-t border-border pt-1 text-[10px] uppercase tracking-wide text-text-secondary"
                >
                  {group.label}
                </div>
              )}
              {group.rows.map((delivery, i) => {
                const outcome = describeOutcome(delivery.outcome);
                return (
                  <div
                    key={`${delivery.ts}-${delivery.entry}-${i}`}
                    data-testid="delivery-row"
                    className="truncate py-0.5"
                  >
                    <span className="text-text-secondary">{formatClockTime(delivery.ts)}</span>
                    {" · "}
                    <span className="text-text-primary">
                      {delivery.name || "(deleted entry)"}
                    </span>
                    {" → "}
                    <span className={outcome.error ? "text-signal-red" : "text-text-secondary"}>
                      {outcome.label}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
