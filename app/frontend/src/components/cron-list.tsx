import { useState } from "react";
import { useCronData } from "@/hooks/use-cron";
import { describeSchedule } from "@/lib/cron-schedule";
import {
  cronEntryLabel,
  isCronDimmed,
  mutedLabel,
  sortCronEntries,
  targetChip,
} from "@/lib/cron-list-model";
import { formatDuration } from "@/lib/format";
import { controlClass } from "@/components/control";
import { CronEntryDetailSheet } from "@/components/cron-entry-detail-sheet";
import { CronCreateDialog } from "@/components/cron-create-dialog";
import type { CronEntry } from "@/api/client";

const ROW_CLASS =
  "flex w-full items-baseline gap-2 px-3 py-2 text-left text-xs coarse:min-h-[44px]";

/**
 * The Cron List tab — the `rk cron list` registry: one dense monospace row
 * per entry (name, target chip, schedule in plain words, relative next fire,
 * backoff rung, the deliver marker for non-immediate policies, and the muted/
 * pinned/orphan flags), sorted soonest-fire-first with undated entries last.
 * Muted and orphaned rows are DIMMED, never omitted. Tapping a row opens the
 * entry detail sheet (the row-action surface); `+ New entry` opens the create
 * dialog. Data rides `useCronData` (mount fetch + the state-socket sessions
 * cadence — no polling); every mutation's confirmation lands on the next tick.
 *
 * `inline` (the desktop drawer mount) makes the root `relative` so the
 * sheet's in-container variant anchors to it, and forwards the flag.
 *
 * An unresolvable server degrades to the operator console's absent/hint state
 * and fires no request.
 */
export function CronList({ server, inline = false }: { server: string; inline?: boolean }) {
  const { entries } = useCronData(server);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const selectedEntry = selectedEntryId
    ? entries.find((e) => e.id === selectedEntryId)
    : undefined;

  const nowSeconds = Math.floor(Date.now() / 1000);
  const sorted = sortCronEntries(entries);

  if (!server) {
    return (
      <div
        className="flex-1 min-h-0 flex items-center justify-center px-4 text-xs text-text-secondary"
        data-testid="cron-list-unresolved"
      >
        no server resolved — cron list unavailable
      </div>
    );
  }

  return (
    <div
      className={`flex-1 min-h-0 flex flex-col${inline ? " relative" : ""}`}
      data-testid="cron-list"
    >
      <div className="shrink-0 border-b border-border px-3 py-1.5 flex">
        <button
          type="button"
          onClick={() => setCreating(true)}
          data-testid="cron-list-new"
          className={controlClass({ variant: "chip" })}
        >
          + New entry
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {sorted.length === 0 ? (
          <div
            className="flex h-full items-center justify-center px-4 text-xs text-text-secondary"
            data-testid="cron-list-empty"
          >
            Agents can schedule prompts too — rk cron add.
          </div>
        ) : (
          sorted.map((entry) => (
            <CronListRow
              key={entry.id}
              entry={entry}
              nowSeconds={nowSeconds}
              onOpen={() => setSelectedEntryId(entry.id)}
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
      {creating && <CronCreateDialog server={server} onClose={() => setCreating(false)} />}
    </div>
  );
}

function CronListRow({
  entry,
  nowSeconds,
  onOpen,
}: {
  entry: CronEntry;
  nowSeconds: number;
  onOpen: () => void;
}) {
  const dimmed = isCronDimmed(entry);
  // The norm (immediate) adds zero chrome — only a non-default policy marks.
  const deliverMarker =
    entry.deliver != null && entry.deliver !== "" && entry.deliver !== "immediate"
      ? entry.deliver
      : null;
  const nextFireLabel =
    entry.nextFire !== undefined
      ? entry.nextFire > nowSeconds
        ? `in ${formatDuration(entry.nextFire - nowSeconds)}`
        : "due"
      : "—";

  const flags: string[] = [];
  if (entry.muted === true) flags.push(mutedLabel(entry, nowSeconds));
  if (entry.pinned === true) flags.push("pinned");
  if (entry.orphaned === true) {
    flags.push(
      entry.orphanedSince
        ? `orphaned ${formatDuration(Math.max(0, nowSeconds - entry.orphanedSince))}`
        : "orphaned",
    );
    if (entry.expiresAt != null && entry.expiresAt > nowSeconds) {
      flags.push(`expires ${formatDuration(entry.expiresAt - nowSeconds)}`);
    }
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid={`cron-list-row-${entry.id}`}
      className={`${ROW_CLASS} font-mono ${dimmed ? "opacity-50" : ""}`}
    >
      <span className="min-w-0 flex-1 truncate text-text-primary">
        {cronEntryLabel(entry)}
        {flags.map((flag) => (
          <span key={flag} className="text-text-secondary">{` · ${flag}`}</span>
        ))}
      </span>
      <span className="shrink-0 text-text-secondary">{targetChip(entry)}</span>
      <span className="min-w-0 flex-[2] truncate text-text-secondary">
        {describeSchedule(entry)}
      </span>
      {entry.schedule.kind === "backoff" && entry.rung != null && (
        <span className="shrink-0 text-text-secondary">{`rung ${entry.rung}`}</span>
      )}
      {deliverMarker && (
        <span className="shrink-0 text-text-secondary" data-testid="cron-list-deliver">
          {deliverMarker}
        </span>
      )}
      <span className="shrink-0 text-text-secondary">{nextFireLabel}</span>
    </button>
  );
}
