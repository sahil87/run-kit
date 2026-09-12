import { useState } from "react";
import { StatusDot } from "@/components/status-dot";
import { Tip } from "@/components/tip";
import { NOTE_STALE_SECONDS } from "@/components/sidebar/row-flyout-card";
import { formatDuration } from "@/lib/format";
import type { TrackedRow } from "@/components/server-watched-zone/model";
import type { OperatorTrackedItem, WindowInfo } from "@/types";

/**
 * The watched-workers table — the ONE rendering of the operator watchlist's
 * rows, mounted by the Server page's WATCHED zone
 * (components/server-watched-zone/watched-zone.tsx, which adapts the
 * `collectWatchedRows` derivation into worker rows via ./model.ts's
 * `watchlistStatus`) and by the quake terminal's Operator Tasks segment
 * (components/watched-tasks.tsx, over `collectTrackedRows`). Six columns —
 * status, session, change, awaiting, note, repo — rendered per row species:
 * a `worker` row is a tracked item on a live window (`StatusDot` + the
 * window-name navigate button, change · stage badge, awaiting, note, repo);
 * an `item` row is a pane-less or dead-pane tracked item (kind chip + id,
 * refs, paused/done/`pane gone`, truncated text with expand-in-place toggle,
 * repo + `updated … ago`) and never navigates. Done rows dim
 * (`opacity-50` + `data-done`). Read-only by design: the watchlist is
 * derived, edits are `fab operator` verbs.
 *
 * The table holds no clock: every relative age is computed at render from the
 * already-passed sessions, refreshed by the SSE cadence. A stale watchlist
 * (the server's `operatorStale` verdict) dims the whole table. `dense` is the
 * quake terminal variant: tighter cell/header padding, all six columns kept.
 */
export function WatchedTable({
  rows,
  stale,
  nowSeconds,
  onNavigate,
  dense = false,
}: {
  rows: TrackedRow[];
  stale: boolean;
  nowSeconds: number;
  onNavigate: (windowId: string) => void;
  /** Quake terminal variant: tighter cell/header padding only — no column drop. */
  dense?: boolean;
}) {
  const headPad = dense ? "pr-2" : "pr-3";
  const cellPad = dense ? "pr-2 py-0.5" : "pr-3 py-1";
  const lastCellPad = dense ? "py-0.5" : "py-1";
  return (
    <table
      className={`w-full text-xs font-mono${stale ? " opacity-50" : ""}`}
      data-testid="watched-table"
    >
      <thead>
        <tr className="text-left text-[10px] uppercase tracking-wide text-text-secondary">
          <th className={`font-normal ${headPad} pb-1`}>status</th>
          <th className={`font-normal ${headPad} pb-1`}>session</th>
          <th className={`font-normal ${headPad} pb-1`}>change</th>
          <th className={`font-normal ${headPad} pb-1`}>awaiting</th>
          <th className={`font-normal ${headPad} pb-1`}>note</th>
          <th className="font-normal pb-1">repo</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) =>
          row.kind === "worker" ? (
            <WatchedRow
              key={`worker:${row.item.id}`}
              session={row.session}
              win={row.win}
              done={row.done}
              paused={row.item.paused === true}
              // A done pane-bearing item no longer joins, so its live window
              // carries no monitored* facets — the row reads them from the item.
              facets={
                row.done
                  ? { change: row.item.id, stage: row.item.stage, repo: row.item.repo }
                  : undefined
              }
              stale={stale}
              nowSeconds={nowSeconds}
              onNavigate={onNavigate}
              cellPad={cellPad}
              lastCellPad={lastCellPad}
            />
          ) : (
            <TrackedItemRow
              key={`item:${row.item.id}`}
              item={row.item}
              done={row.done}
              nowSeconds={nowSeconds}
              cellPad={cellPad}
              lastCellPad={lastCellPad}
              dense={dense}
            />
          ),
        )}
      </tbody>
    </table>
  );
}

/** The awaiting column: `waiting 6m` (the status-dot amber vocabulary) /
 *  `busy` / `idle 12m`; `—` when the window carries no agent state. The
 *  duration is the server-computed `agentIdleDuration` string. */
function awaitingCell(win: WindowInfo): { text: string; waiting: boolean } | null {
  switch (win.agentState) {
    case "waiting":
      return { text: `waiting ${win.agentIdleDuration ?? ""}`.trim(), waiting: true };
    case "active":
      return { text: "busy", waiting: false };
    case "idle":
      return { text: `idle ${win.agentIdleDuration ?? ""}`.trim(), waiting: false };
    default:
      return null;
  }
}

function repoBasename(repo: string): string {
  return repo ? (repo.split("/").filter(Boolean).pop() ?? repo) : "";
}

function WatchedRow({
  session,
  win,
  done,
  paused,
  facets,
  stale,
  nowSeconds,
  onNavigate,
  cellPad,
  lastCellPad,
}: {
  session: string;
  win: WindowInfo;
  done: boolean;
  paused: boolean;
  facets?: { change?: string; stage?: string; repo?: string };
  stale: boolean;
  nowSeconds: number;
  onNavigate: (windowId: string) => void;
  cellPad: string;
  lastCellPad: string;
}) {
  const awaiting = awaitingCell(win);

  const noteEpoch = win.noteEpoch ?? 0;
  const noteAgeSeconds = noteEpoch > 0 ? Math.max(0, nowSeconds - noteEpoch) : null;
  const noteStale = noteAgeSeconds !== null && noteAgeSeconds > NOTE_STALE_SECONDS;

  // With `facets` the row describes the ITEM, never the window: a done item's
  // window may since have been claimed by a different live item, whose
  // monitored* facets must not leak into this row. Only an un-faceted row
  // reads the window's own join facets.
  const change = facets ? facets.change : win.monitoredChange;
  const stage = facets ? facets.stage : win.monitoredStage;
  const repo = (facets ? facets.repo : win.monitoredRepo) ?? "";
  const repoBase = repoBasename(repo);

  return (
    <tr data-testid="watched-row" data-done={done ? "true" : undefined} className={done ? "opacity-50" : undefined}>
      <td className={cellPad}>
        <button
          type="button"
          data-testid="watched-row-navigate"
          onClick={() => onNavigate(win.windowId)}
          className="flex items-center gap-1.5 min-w-0 max-w-full text-left text-text-primary hover:text-accent-green"
        >
          <StatusDot win={win} watched={{ stale }} />
          <span className="truncate">{win.name}</span>
        </button>
      </td>
      <td className={`${cellPad} text-text-secondary`}>{session}</td>
      <td className={cellPad}>
        {change ? (
          <span className="whitespace-nowrap">
            <span>{change}</span>
            {stage && (
              <>
                {" · "}
                <span className="px-1.5 py-0.5 rounded bg-accent/10 text-accent">
                  {stage}
                </span>
              </>
            )}
            {paused && (
              <>
                {" · "}
                <span className="text-signal-yellow">paused</span>
              </>
            )}
            {done && (
              <>
                {" · "}
                <span className="text-text-secondary">done</span>
              </>
            )}
          </span>
        ) : (
          <span className="text-text-secondary">—</span>
        )}
      </td>
      <td className={`${cellPad} whitespace-nowrap${awaiting?.waiting ? " text-signal-yellow" : ""}`}>
        {awaiting ? awaiting.text : <span className="text-text-secondary">—</span>}
      </td>
      <td className={`${cellPad}${noteStale ? " opacity-50" : ""}`}>
        {win.note ? (
          <Tip label={win.note} placement="top">
            <span className="block truncate max-w-[24ch] text-text-secondary">
              {win.note}
              {noteAgeSeconds !== null && ` · ${formatDuration(noteAgeSeconds)} ago`}
            </span>
          </Tip>
        ) : (
          <span className="text-text-secondary">—</span>
        )}
      </td>
      <td className={lastCellPad}>
        {repoBase ? (
          <Tip label={repo} placement="top">
            <span className="block truncate max-w-[16ch] text-text-secondary">{repoBase}</span>
          </Tip>
        ) : (
          <span className="text-text-secondary">—</span>
        )}
      </td>
    </tr>
  );
}

/** The item-species row: a pane-less or dead-pane tracked item. It carries no
 *  terminal, so nothing navigates — the only interaction is the note cell's
 *  expand-in-place toggle (a native button, so Enter/Space work and the row
 *  is keyboard-reachable). */
function TrackedItemRow({
  item,
  done,
  nowSeconds,
  cellPad,
  lastCellPad,
  dense,
}: {
  item: OperatorTrackedItem;
  done: boolean;
  nowSeconds: number;
  cellPad: string;
  lastCellPad: string;
  dense: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  const refs = (item.refs ?? []).join(", ");
  const repo = item.repo ?? "";
  const repoBase = repoBasename(repo);
  const stamp =
    item.updatedAt !== undefined && item.updatedAt > 0
      ? `updated ${formatDuration(Math.max(0, nowSeconds - item.updatedAt))} ago`
      : item.addedAt !== undefined && item.addedAt > 0
        ? `added ${formatDuration(Math.max(0, nowSeconds - item.addedAt))} ago`
        : null;

  return (
    <tr data-testid="tracked-item-row" data-done={done ? "true" : undefined} className={done ? "opacity-50" : undefined}>
      <td className={cellPad}>
        <span className="flex items-center gap-1.5 min-w-0 max-w-full">
          <span className="px-1.5 py-0.5 rounded bg-accent/10 text-accent">
            {item.kind || "item"}
          </span>
          <span className="truncate text-text-primary">{item.id}</span>
        </span>
      </td>
      <td className={`${cellPad} text-text-secondary`}>{item.session || "—"}</td>
      <td className={cellPad}>
        {refs ? (
          <Tip label={refs} placement="top">
            <span className="block truncate max-w-[24ch]">{refs}</span>
          </Tip>
        ) : (
          <span className="text-text-secondary">—</span>
        )}
      </td>
      <td className={`${cellPad} whitespace-nowrap`}>
        {item.paused === true ? (
          <span className="text-signal-yellow">paused</span>
        ) : done ? (
          <span>done</span>
        ) : item.pane ? (
          <span className="text-text-secondary">pane gone</span>
        ) : (
          <span className="text-text-secondary">—</span>
        )}
      </td>
      <td className={cellPad}>
        {item.text ? (
          expanded ? (
            <button
              type="button"
              aria-expanded="true"
              data-testid="tracked-item-expand"
              onClick={() => setExpanded(false)}
              className="block w-full text-left whitespace-pre-wrap text-text-secondary"
            >
              {item.text}
            </button>
          ) : (
            <Tip label={item.text} placement="top">
              <button
                type="button"
                aria-expanded="false"
                data-testid="tracked-item-expand"
                onClick={() => setExpanded(true)}
                className={`block truncate text-left text-text-secondary ${dense ? "max-w-[40ch]" : "max-w-[24ch]"}`}
              >
                {item.text}
              </button>
            </Tip>
          )
        ) : (
          <span className="text-text-secondary">—</span>
        )}
      </td>
      <td className={lastCellPad}>
        {repoBase || stamp ? (
          <span className="block truncate text-text-secondary whitespace-nowrap">
            {repoBase && (
              <Tip label={repo} placement="top">
                <span>{repoBase}</span>
              </Tip>
            )}
            {repoBase && stamp && " · "}
            {stamp}
          </span>
        ) : (
          <span className="text-text-secondary">—</span>
        )}
      </td>
    </tr>
  );
}
