import { useEffect, useState } from "react";
import { useSessionContext } from "@/contexts/session-context";
import { useToast } from "@/components/toast";
import { Tip } from "@/components/tip";
import { deleteCron, getCron, muteCron, type CronEntry } from "@/api/client";
import { formatDuration } from "@/lib/format";
import type { ProjectSession } from "@/types";
import { CardActionList, CardActionRow, useRowFlyout } from "./row-flyout-card";
import { PopupTitleBar, PopupTitleBarSecondary } from "./popup-title-bar";
import { BellIcon, BellOffIcon, CloseIcon } from "./icons";

/**
 * The CLOCK section's body — one condensed row per cron entry on the current
 * server (name, target chip, live backoff rung, human-relative next fire).
 * The panel fetches on mount, on server change, and whenever the server's
 * sessions slice changes identity (every cron mutation wakes the SSE hub,
 * which rebroadcasts the slice — the same SSE-derived signal ServerPanel/
 * WindowPanel re-render on; no polling). On the board route (`server ===
 * null`) it renders the empty state without fetching.
 */
export function ClockPanel({ server }: { server: string | null }) {
  const ctx = useSessionContext();
  const sessionsSlice = server ? ctx.sessionsByServer.get(server) : undefined;
  const [entries, setEntries] = useState<CronEntry[] | null>(null);

  useEffect(() => {
    if (!server) {
      setEntries(null);
      return;
    }
    let cancelled = false;
    getCron(server)
      .then(({ entries: list }) => {
        if (!cancelled) setEntries(list);
      })
      // A failed fetch reads as empty (the Host panel's fail-quiet posture) —
      // the next SSE tick retries.
      .catch(() => {
        if (!cancelled) setEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [server, sessionsSlice]);

  if (server === null || entries === null || entries.length === 0) {
    return <div className="text-xs text-text-secondary">No cron entries</div>;
  }
  return (
    <div className="flex flex-col gap-0.5">
      {entries.map((entry) => (
        <ClockRow key={entry.id} server={server} entry={entry} />
      ))}
    </div>
  );
}

/** The target chip's discriminant: `role: operator`, `session: foo`, or
 *  `pane: %3` — the first target facet the entry carries. */
function targetChip(entry: CronEntry): string {
  const discriminant = entry.target.role ?? entry.target.session ?? entry.target.pane;
  return discriminant ? `${entry.target.kind}: ${discriminant}` : entry.target.kind;
}

function ClockRow({ server, entry }: { server: string; entry: CronEntry }) {
  const { addToast } = useToast();
  const flyout = useRowFlyout({
    content: ({ close }) => (
      <>
        <PopupTitleBar>
          <PopupTitleBarSecondary>Cron </PopupTitleBarSecondary>
          {entry.name ?? entry.id}
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
              void muteCron(server, entry.id, !entry.muted).catch((err: unknown) =>
                addToast(err instanceof Error ? err.message : "Mute failed", "error"),
              );
            }}
          />
          <CardActionRow
            icon={<CloseIcon />}
            label="Delete"
            danger
            testid="row-flyout-delete-action"
            onClick={() => {
              close();
              void deleteCron(server, entry.id).catch((err: unknown) =>
                addToast(err instanceof Error ? err.message : "Delete failed", "error"),
              );
            }}
          />
        </CardActionList>
      </>
    ),
  });

  const dimmed = entry.orphaned === true || entry.muted === true;
  const badge = entry.orphaned === true ? "orphaned" : entry.muted === true ? "muted" : null;
  // Static text derived from the already-fetched entry — the panel holds no
  // clock, so the relative time is as of the last fetch (the flyout card's
  // render-performance contract).
  const nextFireLabel =
    entry.nextFire != null && entry.nextFire > 0
      ? `in ${formatDuration(Math.max(0, Math.floor(entry.nextFire - Date.now() / 1000)))}`
      : "—";

  return (
    <div
      ref={flyout.setReference}
      {...flyout.referenceProps}
      tabIndex={0}
      aria-label={`Cron entry ${entry.name ?? entry.id}`}
      data-testid="clock-row"
      className={`flex items-center gap-1.5 min-w-0 text-xs ${dimmed ? "opacity-50" : ""}`}
    >
      <span className={`truncate ${dimmed ? "line-through" : ""}`}>{entry.name ?? entry.id}</span>
      {badge && (
        <span className="shrink-0 text-[10px] uppercase text-text-secondary">{badge}</span>
      )}
      <span className="shrink-0 text-text-secondary">{targetChip(entry)}</span>
      {entry.schedule.kind === "backoff" && entry.rung != null && (
        <span className="shrink-0 text-text-secondary">{`rung ${entry.rung}`}</span>
      )}
      <span className="ml-auto shrink-0 text-text-secondary">{nextFireLabel}</span>
      {flyout.card}
    </div>
  );
}

/**
 * The CLOCK header's staleness warning — `⚠ operator stale` in the panel's
 * `headerRight` slot whenever any session on the active server carries the
 * server-derived `operatorStale` flag (the same field the row dimming reads —
 * the threshold is never recomputed client-side). The Tip reports the tick
 * age from `operatorLastTickAt`.
 */
export function ClockStaleWarning({ sessions }: { sessions: ProjectSession[] }) {
  const stale = sessions.find((s) => s.operatorStale === true);
  if (!stale) return null;
  const tickAt = stale.operatorLastTickAt ?? 0;
  const ageSeconds = tickAt > 0 ? Math.max(0, Math.floor(Date.now() / 1000) - tickAt) : null;
  return (
    <Tip
      label={ageSeconds !== null ? `Operator last ticked ${formatDuration(ageSeconds)} ago` : "Operator has never ticked"}
      placement="left"
    >
      <span className="text-signal-yellow" data-testid="clock-header-stale-warning">
        ⚠ operator stale
      </span>
    </Tip>
  );
}
