import { StatusDot } from "@/components/status-dot";
import { Tip } from "@/components/tip";
import { NOTE_STALE_SECONDS } from "@/components/sidebar/row-flyout-card";
import { formatDuration } from "@/lib/format";
import type { WindowInfo } from "@/types";

/**
 * The watched-workers table — the ONE rendering of the operator watchlist's
 * rows, mounted by the Server page's WATCHED zone
 * (components/server-clock-dashboard/watched-zone.tsx, which derives the rows
 * and status via ./model.ts's `collectWatchedRows`/`watchlistStatus`) and by
 * the operator console's Operator Tasks segment (components/watched-tasks.tsx).
 * Six columns — status (`StatusDot` + the window-name navigate button),
 * session, change (`monitoredChange` · `monitoredStage` badge), awaiting
 * (`waiting {dur}` amber / `busy` / `idle {dur}` / `—`), note (truncated +
 * `Tip`, `· {age} ago`, dimmed past `NOTE_STALE_SECONDS`), repo (basename +
 * `Tip`). Read-only by design: the watchlist is derived, edits are
 * `fab operator` verbs — the only interaction is row-name navigation.
 *
 * The table holds no clock: every relative age is computed at render from the
 * already-passed sessions, refreshed by the SSE cadence. A stale watchlist
 * (the server's `operatorStale` verdict) dims the whole table. `dense` is the
 * console variant: tighter cell/header padding, all six columns kept.
 */
export function WatchedTable({
  rows,
  stale,
  nowSeconds,
  onNavigate,
  dense = false,
}: {
  rows: { session: string; win: WindowInfo }[];
  stale: boolean;
  nowSeconds: number;
  onNavigate: (windowId: string) => void;
  /** Console variant: tighter cell/header padding only — no column drop. */
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
        {rows.map(({ session, win }) => (
          <WatchedRow
            key={win.windowId}
            session={session}
            win={win}
            stale={stale}
            nowSeconds={nowSeconds}
            onNavigate={onNavigate}
            cellPad={cellPad}
            lastCellPad={lastCellPad}
          />
        ))}
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

function WatchedRow({
  session,
  win,
  stale,
  nowSeconds,
  onNavigate,
  cellPad,
  lastCellPad,
}: {
  session: string;
  win: WindowInfo;
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

  const repo = win.monitoredRepo ?? "";
  const repoBase = repo ? (repo.split("/").filter(Boolean).pop() ?? repo) : "";

  return (
    <tr data-testid="watched-row">
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
        {win.monitoredChange ? (
          <span className="whitespace-nowrap">
            <span>{win.monitoredChange}</span>
            {win.monitoredStage && (
              <>
                {" · "}
                <span className="px-1.5 py-0.5 rounded bg-accent/10 text-accent">
                  {win.monitoredStage}
                </span>
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
