/**
 * Code-tile first-boot rescue decision module (spec docs/specs/right-panel.md
 * § The code lens). Pure and DOM-free — the `code-folder-latch.ts` module
 * contract: `CodeSurface` feeds it events and executes its one verb, all
 * rules live here and are unit-tested without a DOM.
 *
 * The rescue exists for one failure shape: a never-cached `?workspace=` boot
 * that loads zero folders (the bridge extension then never activates, so no
 * host record appears). The signal is the bridge host record's `startedAt`,
 * read through `GET /api/windows/{id}/code-bridge` at exactly two points per
 * mount generation — a baseline at src adoption and a verdict at wait expiry
 * (two point-in-time reads, not polling: no interval, no loop). A record
 * strictly NEWER than the baseline proves this boot registered the bridge,
 * hence loaded the folder — the previous boot's record may still be pid-alive
 * at remount, so existence alone is not the signal.
 */

/** The wait between the iframe's `load` event and the verdict fetch. Good
 *  boots confirm within ~1–3 s; 10 s leaves margin without a long broken
 *  dwell. */
export const CODE_BOOT_RESCUE_WAIT_MS = 10_000;

/** True iff the src carries a `workspace` query param (the
 *  `/code/?workspace=` form). The `?folder=` degrade form can never produce a
 *  tab-keyed host record, so it is never rescued. */
export function isWorkspaceSrc(src: string): boolean {
  const q = src.indexOf("?");
  if (q < 0) return false;
  return new URLSearchParams(src.slice(q + 1)).has("workspace");
}

/** The signal test: `current` is a confirmation iff it is a parseable,
 *  non-empty stamp strictly newer than the baseline — or the baseline is
 *  absent/empty (a failed baseline fetch must not blind the verdict; erring
 *  toward NOT reloading is the posture). Both values are server-written RFC
 *  3339 stamps compared stamp-vs-stamp via Date.parse — never against the
 *  browser clock, which shares no clock with a remote host. */
export function bridgeConfirmed(baseline: string | null, current: string | null): boolean {
  if (!current) return false;
  const currentMs = Date.parse(current);
  if (Number.isNaN(currentMs)) return false;
  if (!baseline) return true;
  const baselineMs = Date.parse(baseline);
  if (Number.isNaN(baselineMs)) return false;
  return currentMs > baselineMs;
}

export type RescueDecision = "reload" | "none" | "skip-not-installed";

/** The decision at wait expiry. Order matters: a non-workspace mount is
 *  never rescued; a bridge that is not installed — or whose status GET
 *  failed (`installed: null`, e.g. an old backend's 404) — fails CLOSED with
 *  no reload; a confirmed bridge means the boot succeeded; anything left is
 *  the broken first boot, rescued with one reload. */
export function decideRescue(args: {
  baseline: string | null;
  current: string | null;
  installed: boolean | null;
  isWorkspaceMount: boolean;
}): RescueDecision {
  if (!args.isWorkspaceMount) return "none";
  if (args.installed !== true) return "skip-not-installed";
  if (bridgeConfirmed(args.baseline, args.current)) return "none";
  return "reload";
}
