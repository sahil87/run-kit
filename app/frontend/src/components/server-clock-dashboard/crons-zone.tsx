import { SectionHeading } from "@/components/section-heading";
import { describeSchedule } from "@/lib/cron-schedule";
import { formatDuration } from "@/lib/format";
import {
  CardActionList,
  CardActionRow,
  useRowFlyout,
} from "@/components/sidebar/row-flyout-card";
import { PopupTitleBar, PopupTitleBarSecondary } from "@/components/sidebar/popup-title-bar";
import { BellIcon, BellOffIcon, CloseIcon } from "@/components/sidebar/icons";
import { PinIcon } from "@/components/pin-icon";
import type { CronEntry } from "@/api/client";
import type { CronActionHandlers } from "@/lib/palette/cron";
import type { ProjectSession } from "@/types";
import { cronStateLabel, isCronDimmed, sortCronEntries, targetChip } from "./model";

/**
 * The CRONS zone — the full cron registry the sidebar CLOCK section trims to
 * a glance: every entry on the server in the deterministic registry order
 * (due → scheduled → undated → orphaned → muted, `sortCronEntries`), with the
 * schedule in plain words, the derived state column (`cronStateLabel` — held/
 * due/muted/orphaned/rung, no new backend field), last/next fire times, and a
 * trailing `…` opening the sidebar's row-flyout-card idiom with the same
 * Mute/Pin/Delete actions the CLOCK row exposes. The handlers are app.tsx's
 * shared `cronHandlers` (delete routes through its confirm dialog); every
 * mutation wakes the SSE hub server-side and the next sessions tick refetches.
 *
 * No clock of its own: all relative times derive from `Date.now()` at render.
 */
export function CronsZone({
  entries,
  sessions,
  onCreate,
  onMute,
  onPin,
  onDelete,
}: {
  entries: CronEntry[];
  sessions: ProjectSession[];
} & CronActionHandlers) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const sorted = sortCronEntries(entries, nowSeconds);

  const mutedCount = entries.filter((e) => e.muted === true).length;
  const orphanedCount = entries.filter((e) => e.orphaned === true).length;
  const sideParts = [`${entries.length} ${entries.length === 1 ? "entry" : "entries"}`];
  if (mutedCount > 0) sideParts.push(`${mutedCount} muted`);
  if (orphanedCount > 0) sideParts.push(`${orphanedCount} orphaned`);

  return (
    <div data-testid="clock-zone-crons">
      <SectionHeading label="Crons" side={sideParts.join(" · ")} className="mb-2" />
      {sorted.length === 0 ? (
        <div className="text-xs text-text-secondary font-mono">No cron entries</div>
      ) : (
        <table className="w-full text-xs font-mono">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-text-secondary">
              <th className="font-normal pr-3 pb-1">name</th>
              <th className="font-normal pr-3 pb-1">target</th>
              <th className="font-normal pr-3 pb-1">schedule</th>
              <th className="font-normal pr-3 pb-1">state</th>
              <th className="font-normal pr-3 pb-1">last</th>
              <th className="font-normal pr-3 pb-1">next</th>
              <th className="font-normal pb-1" aria-label="actions" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((entry) => (
              <CronRow
                key={entry.id}
                entry={entry}
                sessions={sessions}
                nowSeconds={nowSeconds}
                onMute={onMute}
                onPin={onPin}
                onDelete={onDelete}
              />
            ))}
          </tbody>
        </table>
      )}
      {/* The New Session tile's dashed idiom; opens the same CronCreateDialog
          the palette's `Cron: new entry` targets. Renders in the empty state
          too — creation is never gated on existing entries. */}
      <button
        type="button"
        data-testid="crons-new-entry"
        onClick={onCreate}
        className="mt-2 flex w-full items-center justify-center border border-dashed border-border rounded py-1.5 text-xs font-mono text-text-secondary hover:text-text-primary hover:border-text-secondary transition-colors min-h-[36px]"
      >
        + New entry
      </button>
    </div>
  );
}

function CronRow({
  entry,
  sessions,
  nowSeconds,
  onMute,
  onPin,
  onDelete,
}: {
  entry: CronEntry;
  sessions: ProjectSession[];
  nowSeconds: number;
  onMute: (entry: CronEntry) => void;
  onPin: (entry: CronEntry) => void;
  onDelete: (entry: CronEntry) => void;
}) {
  const name = entry.name ?? entry.id;
  const dimmed = isCronDimmed(entry);
  // The norm (immediate) adds zero chrome — only a non-default policy marks.
  const deliverMarker =
    entry.deliver != null && entry.deliver !== "" && entry.deliver !== "immediate"
      ? entry.deliver
      : null;
  const flyout = useRowFlyout({
    content: ({ close }) => (
      <>
        <PopupTitleBar>
          <PopupTitleBarSecondary>Cron </PopupTitleBarSecondary>
          {name}
        </PopupTitleBar>
        {/* No body between the title bar and the actions — `flush` drops the
            gap the card would otherwise reserve for one. */}
        <CardActionList flush>
          <CardActionRow
            icon={entry.muted ? <BellIcon /> : <BellOffIcon />}
            label={entry.muted ? "Unmute" : "Mute"}
            testid="row-flyout-mute-action"
            onClick={() => {
              close();
              onMute(entry);
            }}
          />
          <CardActionRow
            icon={<PinIcon filled={entry.pinned === true} />}
            label={entry.pinned ? "Unpin" : "Pin"}
            testid="row-flyout-pin-action"
            onClick={() => {
              close();
              onPin(entry);
            }}
          />
          <CardActionRow
            icon={<CloseIcon />}
            label="Delete"
            danger
            testid="row-flyout-delete-action"
            onClick={() => {
              close();
              onDelete(entry);
            }}
          />
        </CardActionList>
      </>
    ),
  });

  const lastLabel =
    entry.lastFired > 0
      ? `${formatDuration(Math.max(0, nowSeconds - entry.lastFired))} ago ✓`
      : "—";
  const nextFire = entry.nextFire ?? 0;
  const nextLabel =
    nextFire > 0
      ? nextFire > nowSeconds
        ? `in ${formatDuration(nextFire - nowSeconds)}`
        : "due"
      : "—";

  return (
    <tr
      ref={flyout.setReference}
      {...flyout.referenceProps}
      data-testid="crons-row"
      className={dimmed ? "opacity-50" : ""}
    >
      <td className="pr-3 py-1">
        <span className={`block truncate max-w-[24ch]${dimmed ? " line-through" : ""}`}>
          {name}
        </span>
      </td>
      <td className="pr-3 py-1 whitespace-nowrap text-text-secondary">{targetChip(entry)}</td>
      <td className="pr-3 py-1 text-text-secondary">
        <span className="block truncate max-w-[32ch]">
          {describeSchedule(entry)}
          {deliverMarker && (
            <span
              className="ml-1 text-[10px] uppercase text-text-secondary"
              data-testid="crons-row-deliver"
            >
              {deliverMarker}
            </span>
          )}
        </span>
      </td>
      <td className="pr-3 py-1 whitespace-nowrap" data-testid="crons-row-state">
        {cronStateLabel(entry, sessions, nowSeconds)}
      </td>
      <td className="pr-3 py-1 whitespace-nowrap text-text-secondary">{lastLabel}</td>
      <td className="pr-3 py-1 whitespace-nowrap text-text-secondary">{nextLabel}</td>
      <td className="py-1 text-right">
        <button
          type="button"
          aria-label={`Actions for ${name}`}
          data-testid="crons-row-actions"
          // The row's useFocus trigger listens for focusin BUBBLING from
          // descendants — a tab stop's focus must not pop the card; this
          // button opens it explicitly on click (the keyboard path is
          // Tab → … → Enter).
          onFocus={(e) => e.stopPropagation()}
          onClick={flyout.openNow}
          className="px-1.5 text-text-secondary hover:text-text-primary"
        >
          …
        </button>
        {flyout.card}
      </td>
    </tr>
  );
}
