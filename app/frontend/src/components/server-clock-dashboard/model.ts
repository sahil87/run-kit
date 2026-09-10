// Pure derivation helpers for the tmux Server page clock dashboard — entry
// sorting, the state column, target resolution, delivery-outcome phrasing,
// and day grouping. Leaf module in the lib/cron-schedule.ts mold: no fetch,
// no timers; every relative time is computed by the caller and passed in as
// `nowSeconds`/`nowMs` so the zones re-derive on the SSE cadence alone.

import { formatDuration } from "@/lib/format";
import type { CronDelivery, CronEntry } from "@/api/client";
import type { ProjectSession, WindowInfo } from "@/types";

/** The target chip's discriminant: `role: operator`, `session: foo`, or
 *  `pane: %3` — the first target facet the entry carries. The single
 *  definition; sidebar/clock-panel.tsx re-imports it. */
export function targetChip(entry: CronEntry): string {
  const discriminant = entry.target.role ?? entry.target.session ?? entry.target.pane;
  return discriminant ? `${entry.target.kind}: ${discriminant}` : entry.target.kind;
}

/** The shared muted/orphaned row treatment (dim + line-through) for the CLOCK
 *  panel row and the CRONS zone row — one predicate so the two surfaces never
 *  drift. */
export function isCronDimmed(entry: CronEntry): boolean {
  return entry.orphaned === true || entry.muted === true;
}

/** The mute badge: `muted {lease remaining}` while an unexpired lease is
 *  stored, else `muted`. Lease remaining is as-of-fetch (no clock). An expired
 *  `mutedUntil` is not a live lease — the server already reports `muted: false`
 *  for one, so the plain arm never renders a negative remaining time. */
export function mutedLabel(entry: CronEntry, nowSeconds: number): string {
  return entry.mutedUntil != null && entry.mutedUntil > nowSeconds
    ? `muted ${formatDuration(entry.mutedUntil - nowSeconds)}`
    : "muted";
}

function displayName(entry: CronEntry): string {
  return entry.name ?? entry.id;
}

/** Sort bucket: 0 due (past `nextFire`, unmuted, un-orphaned) → 1 scheduled
 *  (future `nextFire`) → 2 undated → 3 orphaned → 4 muted. Orphaned outranks
 *  muted — the graver operational state — so a muted+orphaned entry lands in
 *  bucket 3. */
function sortBucket(entry: CronEntry, nowSeconds: number): number {
  if (entry.orphaned === true) return 3;
  if (entry.muted === true) return 4;
  const nextFire = entry.nextFire ?? 0;
  if (nextFire <= 0) return 2;
  return nextFire <= nowSeconds ? 0 : 1;
}

/** Registry order for the CRONS zone: due first, then scheduled by ascending
 *  `nextFire`, then undated/orphaned/muted by display name. Pure — the same
 *  `(entries, nowSeconds)` always yields the same order. */
export function sortCronEntries(entries: CronEntry[], nowSeconds: number): CronEntry[] {
  return [...entries].sort((a, b) => {
    const bucketA = sortBucket(a, nowSeconds);
    const bucketB = sortBucket(b, nowSeconds);
    if (bucketA !== bucketB) return bucketA - bucketB;
    if (bucketA === 1) return (a.nextFire ?? 0) - (b.nextFire ?? 0);
    if (bucketA === 0) return 0;
    return displayName(a).localeCompare(displayName(b));
  });
}

/** Resolve an entry's target to a live window from the sessions payload, so
 *  the state column can read the target's `agentState`. `role` matches the
 *  window carrying that `@rk_win_role` value; `session` matches the window
 *  whose agent-session identity is the ref (the backend's resolution), with
 *  a session-name fallback (that session's tmux-active window, else its
 *  first); `pane` matches the window holding that pane id. Unresolvable →
 *  undefined. */
export function resolveTargetWindow(
  entry: CronEntry,
  sessions: ProjectSession[],
): WindowInfo | undefined {
  const { target } = entry;
  switch (target.kind) {
    case "role": {
      if (!target.role) return undefined;
      for (const session of sessions) {
        const win = session.windows.find((w) => w.role === target.role);
        if (win) return win;
      }
      return undefined;
    }
    case "session": {
      for (const session of sessions) {
        const win = session.windows.find((w) => w.agentSessionRef === target.session);
        if (win) return win;
      }
      const byName = sessions.find((s) => s.name === target.session);
      if (!byName) return undefined;
      return byName.windows.find((w) => w.isActiveWindow) ?? byName.windows[0];
    }
    case "pane": {
      if (!target.pane) return undefined;
      for (const session of sessions) {
        const win = session.windows.find((w) =>
          (w.panes ?? []).some((p) => p.paneId === target.pane),
        );
        if (win) return win;
      }
      return undefined;
    }
    default:
      return undefined;
  }
}

/** The CRONS zone's state column, in priority order: `orphaned` →
 *  `muted {lease}`/`muted` → `held (busy)` (a when-idle entry past due whose
 *  resolved target reads `active`/`waiting`) → `due` → `rung N` (backoff) →
 *  `—`. An orphan whose `expiresAt` is still ahead reads `orphaned · expires
 *  {remaining}` (the orphan-TTL reap time), else bare `orphaned`. An expired
 *  lease never renders a negative remaining time (the server already reports
 *  `muted: false` for one — the guard is belt-and-braces). */
export function cronStateLabel(
  entry: CronEntry,
  sessions: ProjectSession[],
  nowSeconds: number,
): string {
  if (entry.orphaned === true) {
    return entry.expiresAt != null && entry.expiresAt > nowSeconds
      ? `orphaned · expires ${formatDuration(entry.expiresAt - nowSeconds)}`
      : "orphaned";
  }
  if (entry.muted === true) return mutedLabel(entry, nowSeconds);
  const nextFire = entry.nextFire ?? 0;
  const pastDue = nextFire > 0 && nextFire <= nowSeconds;
  if (entry.deliver === "when-idle" && pastDue) {
    const target = resolveTargetWindow(entry, sessions);
    if (target && (target.agentState === "active" || target.agentState === "waiting")) {
      return "held (busy)";
    }
  }
  if (pastDue) return "due";
  if (entry.schedule.kind === "backoff" && entry.rung != null) return `rung ${entry.rung}`;
  return "—";
}

/** The delivery outcome rendered for the log: a display label plus whether
 *  it takes the error color. Failure is a string predicate over the log's
 *  outcome vocabulary (`respawn-failed: …`, `failed: …`, anything carrying
 *  `fail`/`error`) — unknown outcomes pass through verbatim, never a
 *  fabricated phrasing. */
export function describeOutcome(outcome: string): { label: string; error: boolean } {
  const error = outcome.startsWith("respawn-failed") || /fail|error/.test(outcome);
  // Prefix match: the wire string carries the agent state (`skipped-busy: active`).
  if (outcome.startsWith("skipped-busy")) return { label: "skipped (busy)", error: false };
  switch (outcome) {
    case "delivered":
      return { label: "delivered ✓", error: false };
    case "skipped-absent":
      return { label: "skipped (absent)", error: false };
    case "notified-absent":
      return { label: "notified (absent)", error: false };
    default:
      return { label: outcome, error };
  }
}

/** Local wall-clock `HH:MM` (24h, zero-padded) for a unix-seconds timestamp. */
export function formatClockTime(tsSeconds: number): string {
  const d = new Date(tsSeconds * 1000);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export type DeliveryDayGroup = { label: string; rows: CronDelivery[] };

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function dayLabel(tsSeconds: number, nowMs: number): string {
  const day = new Date(tsSeconds * 1000);
  if (sameLocalDay(day, new Date(nowMs))) return "today";
  const yesterday = new Date(nowMs);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameLocalDay(day, yesterday)) return "yesterday";
  const month = String(day.getMonth() + 1).padStart(2, "0");
  const date = String(day.getDate()).padStart(2, "0");
  return `${day.getFullYear()}-${month}-${date}`;
}

/** Group the (most-recent-first) deliveries by local calendar day, preserving
 *  the served order within and across groups. Labels: `today` / `yesterday` /
 *  `YYYY-MM-DD`. The zone renders a divider per group only when the log spans
 *  more than one day. */
export function groupDeliveriesByDay(
  deliveries: CronDelivery[],
  nowMs: number = Date.now(),
): DeliveryDayGroup[] {
  const groups: DeliveryDayGroup[] = [];
  for (const delivery of deliveries) {
    const label = dayLabel(delivery.ts, nowMs);
    const current = groups[groups.length - 1];
    if (current && current.label === label) {
      current.rows.push(delivery);
    } else {
      groups.push({ label, rows: [delivery] });
    }
  }
  return groups;
}
