// Pure derivation helpers for the tmux Server page's WATCHED zone — the row
// collection and the zone-level stale/tick/operator status. Leaf module in
// the lib/cron-schedule.ts mold: no fetch, no timers; every relative time is
// computed by the caller and passed in as `nowSeconds` so the zone re-derives
// on the SSE cadence alone.

import { isGhostWindow } from "@/contexts/optimistic-context";
import type { ProjectSession, WindowInfo } from "@/types";

/** One watched row per non-ghost window with `monitored === true` (the fab
 *  operator state file's monitored map, joined onto windows server-side),
 *  ordered by session order then window index. The single collection loop —
 *  the Server page WATCHED zone and the console's Operator Tasks segment both
 *  render through it, so the two surfaces cannot drift. */
export function collectWatchedRows(
  sessions: ProjectSession[],
): { session: string; win: WindowInfo }[] {
  const rows: { session: string; win: WindowInfo }[] = [];
  for (const session of sessions) {
    const windows = [...session.windows].sort((a, b) => a.index - b.index);
    for (const win of windows) {
      if (win.monitored === true && !isGhostWindow(win)) {
        rows.push({ session: session.name, win });
      }
    }
  }
  return rows;
}

/** The watchlist's zone-level derivations: `stale` = any session reports
 *  `operatorStale` (the server's own 15-minute verdict — the frontend never
 *  re-derives the threshold); `tickAgeSeconds` from the max
 *  `operatorLastTickAt` (`null` when no session carries a tick);
 *  `hasOperator` = a tick exists or any window carries `role === "operator"`. */
export function watchlistStatus(
  sessions: ProjectSession[],
  nowSeconds: number,
): { stale: boolean; tickAgeSeconds: number | null; hasOperator: boolean } {
  const stale = sessions.some((s) => s.operatorStale === true);
  const tickAt = sessions.reduce(
    (latest, s) => Math.max(latest, s.operatorLastTickAt ?? 0),
    0,
  );
  const tickAgeSeconds = tickAt > 0 ? Math.max(0, nowSeconds - tickAt) : null;
  const hasOperator =
    tickAt > 0 || sessions.some((s) => s.windows.some((w) => w.role === "operator"));
  return { stale, tickAgeSeconds, hasOperator };
}
