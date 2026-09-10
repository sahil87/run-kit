import { SectionHeading } from "@/components/section-heading";
import { StatusDot } from "@/components/status-dot";
import { Tip } from "@/components/tip";
import { NOTE_STALE_SECONDS } from "@/components/sidebar/row-flyout-card";
import { isGhostWindow } from "@/contexts/optimistic-context";
import { formatDuration } from "@/lib/format";
import type { ProjectSession, WindowInfo } from "@/types";

/**
 * The WATCHED zone — the detail table of the server's operator watchlist that
 * the sidebar CLOCK section trims to a glance. One row per window with
 * `monitored === true` (the fab operator state file's monitored map, joined
 * onto windows server-side; ghost windows excluded), ordered by session order
 * then window index. Read-only by design: the watchlist is derived, edits are
 * `fab operator` verbs — the only interaction is row-name navigation to the
 * window's terminal route.
 *
 * The table holds no clock: every relative age is computed at render from the
 * already-passed sessions, refreshed by the SSE cadence. When any session
 * reports `operatorStale` the side slot flips to the yellow `⚠ stale` variant
 * and the whole table dims (the sidebar's watched-indicator dimming, applied
 * to the zone).
 */
export function WatchedZone({
  sessions,
  onNavigate,
}: {
  sessions: ProjectSession[];
  onNavigate: (windowId: string) => void;
}) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const stale = sessions.some((s) => s.operatorStale === true);
  const tickAt = sessions.reduce(
    (latest, s) => Math.max(latest, s.operatorLastTickAt ?? 0),
    0,
  );
  const tickAgeSeconds = tickAt > 0 ? Math.max(0, nowSeconds - tickAt) : null;
  const hasOperator =
    tickAt > 0 || sessions.some((s) => s.windows.some((w) => w.role === "operator"));

  const rows: { session: string; win: WindowInfo }[] = [];
  for (const session of sessions) {
    const windows = [...session.windows].sort((a, b) => a.index - b.index);
    for (const win of windows) {
      if (win.monitored === true && !isGhostWindow(win)) {
        rows.push({ session: session.name, win });
      }
    }
  }

  const side = stale ? (
    <span className="text-signal-yellow" data-testid="watched-stale">
      ⚠ stale{tickAgeSeconds !== null ? ` ${formatDuration(tickAgeSeconds)}` : ""}
    </span>
  ) : (
    `${rows.length} watched · ${tickAgeSeconds !== null ? `tick ${formatDuration(tickAgeSeconds)} ago` : "no operator tick"}`
  );

  return (
    <div data-testid="clock-zone-watched">
      <SectionHeading label="Watched" side={side} className="mb-2" />
      {rows.length === 0 ? (
        <div className="text-xs text-text-secondary font-mono">
          {hasOperator ? "No watched workers" : "No operator on this server"}
        </div>
      ) : (
        <table
          className={`w-full text-xs font-mono${stale ? " opacity-50" : ""}`}
          data-testid="watched-table"
        >
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-text-secondary">
              <th className="font-normal pr-3 pb-1">status</th>
              <th className="font-normal pr-3 pb-1">session</th>
              <th className="font-normal pr-3 pb-1">change</th>
              <th className="font-normal pr-3 pb-1">awaiting</th>
              <th className="font-normal pr-3 pb-1">note</th>
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
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
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
}: {
  session: string;
  win: WindowInfo;
  stale: boolean;
  nowSeconds: number;
  onNavigate: (windowId: string) => void;
}) {
  const awaiting = awaitingCell(win);

  const noteEpoch = win.noteEpoch ?? 0;
  const noteAgeSeconds = noteEpoch > 0 ? Math.max(0, nowSeconds - noteEpoch) : null;
  const noteStale = noteAgeSeconds !== null && noteAgeSeconds > NOTE_STALE_SECONDS;

  const repo = win.monitoredRepo ?? "";
  const repoBase = repo ? (repo.split("/").filter(Boolean).pop() ?? repo) : "";

  return (
    <tr data-testid="watched-row">
      <td className="pr-3 py-1">
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
      <td className="pr-3 py-1 text-text-secondary">{session}</td>
      <td className="pr-3 py-1">
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
      <td className={`pr-3 py-1 whitespace-nowrap${awaiting?.waiting ? " text-signal-yellow" : ""}`}>
        {awaiting ? awaiting.text : <span className="text-text-secondary">—</span>}
      </td>
      <td className={`pr-3 py-1${noteStale ? " opacity-50" : ""}`}>
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
      <td className="py-1">
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
