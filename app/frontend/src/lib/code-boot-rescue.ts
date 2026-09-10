/**
 * Code-tile first-boot rescue decision module (spec docs/specs/right-panel.md
 * § The code lens). Pure and DOM-free — the `code-folder-latch.ts` module
 * contract: `CodeSurface` feeds it events and executes its one verb, all
 * rules live here and are unit-tested without a DOM.
 *
 * The rescue exists for one failure shape: a never-cached `?workspace=` boot
 * that loads zero folders. The signal is POSITIVE, never an absence: the
 * bridge extension is the one process that knows it activated with zero
 * folders, so it writes an empty-boot marker (`cb/boots/<hostId>.json`), and
 * this module reloads only when that marker's stamp — read through
 * `GET /api/windows/{id}/code-bridge` at bounded decision points (a baseline
 * at src adoption, a verdict at wait expiry, at most one re-check) — is
 * strictly newer than the baseline. A slow GOOD boot simply reports no
 * marker; the absence of a host record is never a trigger, because a good
 * boot's record can land later than any fixed window under load. A host
 * record strictly newer than ITS baseline is the good-boot confirmation and
 * only settles the generation early — it never produces a reload.
 */

/** The wait between the iframe's `load` event and the first verdict fetch.
 *  Good boots confirm within ~1–3 s; 10 s leaves margin without a long broken
 *  dwell. */
export const CODE_BOOT_RESCUE_WAIT_MS = 10_000;

/** The wait between a signal-less first verdict and the single re-check. The
 *  marker rides the same slow extension-host activation as the host record
 *  (7 s measured under concurrent-boot load), so one re-check at the same
 *  interval covers it with margin while keeping the per-generation reads
 *  bounded at three. */
export const CODE_BOOT_RESCUE_RECHECK_MS = 10_000;

/** True iff the src carries a `workspace` query param (the
 *  `/code/?workspace=` form). The `?folder=` degrade form can never produce a
 *  tab-keyed marker or host record, so it is never rescued. */
export function isWorkspaceSrc(src: string): boolean {
  const q = src.indexOf("?");
  if (q < 0) return false;
  return new URLSearchParams(src.slice(q + 1)).has("workspace");
}

/** The stamp test: `current` is a positive signal iff it is a parseable,
 *  non-empty stamp strictly newer than `baseline`. An EMPTY baseline ("",
 *  read OK, nothing existed at adoption) accepts any parseable current. A
 *  NULL baseline (the baseline read was unavailable) is NOT confirmable —
 *  erring toward NOT reloading is the posture, and a still-pid-alive marker
 *  from a previous empty boot must never blind-reload this one. Both values
 *  are server-written RFC 3339 stamps compared stamp-vs-stamp via Date.parse
 *  — never against the browser clock, which shares no clock with a remote
 *  host. */
export function newerThanBaseline(baseline: string | null, current: string | null): boolean {
  if (!current) return false;
  const currentMs = Date.parse(current);
  if (Number.isNaN(currentMs)) return false;
  if (baseline === null) return false;
  if (baseline === "") return true;
  const baselineMs = Date.parse(baseline);
  if (Number.isNaN(baselineMs)) return false;
  return currentMs > baselineMs;
}

export type RescueDecision = "reload" | "none" | "skip-not-installed";

/** The decision at a verdict read. Order matters: a non-workspace mount is
 *  never rescued; a bridge that is not installed — or whose status GET failed
 *  (`installed: null`, e.g. an old backend's 404) — fails CLOSED with no
 *  reload; an empty-boot marker newer than its baseline proves THIS boot
 *  activated with zero folders and is rescued with one reload; anything left
 *  (no marker, an equal or older marker) is not the broken boot. The
 *  host-record stamp is never an input here: it can only settle a generation
 *  early (the caller checks it first), never trigger a reload. */
export function decideRescue(args: {
  baselineEmptyBootAt: string | null;
  emptyBootAt: string | null;
  installed: boolean | null;
  isWorkspaceMount: boolean;
}): RescueDecision {
  if (!args.isWorkspaceMount) return "none";
  if (args.installed !== true) return "skip-not-installed";
  if (newerThanBaseline(args.baselineEmptyBootAt, args.emptyBootAt)) return "reload";
  return "none";
}
