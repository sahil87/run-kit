import { useState, useCallback, useRef, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useUpdateNotification } from "@/contexts/session-context";
import { useToast } from "@/components/toast";
import type { UpdateTriggerResult } from "@/api/client";

/** The narrow navigate signature the watch affordance needs — structural, so
 *  TanStack's `useNavigate()` result (and any test stub) satisfies it. */
type WatchNavigate = (opts: {
  to: "/$server/$window";
  params: { server: string; window: string };
}) => void;

type WatchToast = (
  message: string,
  variant?: "error" | "info",
  action?: { label: string; onSelect: () => void },
) => void;

/**
 * Consume an update/restart trigger result's `watch` target (260812-z1ya,
 * intake decision 4 — navigation, no new components):
 *
 *   - `already-running` with a watch target → navigate STRAIGHT to the job
 *     window's terminal route (the second click IS the jump);
 *   - fresh spawn with a watch target → info toast with a "Watch" action that
 *     navigates (auto-navigating on every click would be disruptive);
 *   - no watch target (old daemon) → no-op: today's behavior, unchanged.
 *
 * The window param is the `@N` id verbatim — the terminal route's
 * parse/stringify already maps it to the URL's numeric segment
 * (router.tsx). Shared by useUpdateClick and the palette's restart wrapper so
 * the affordance can never drift between the two.
 */
export function consumeUpdateWatchTarget(
  result: UpdateTriggerResult,
  navigate: WatchNavigate,
  addToast: WatchToast,
): void {
  const watch = result.watch;
  if (!watch) return;
  const jump = () =>
    navigate({ to: "/$server/$window", params: { server: watch.server, window: watch.window_id } });
  if (result.status === "already-running") {
    jump();
    return;
  }
  addToast(`${watch.session}:${watch.window} is running`, "info", { label: "Watch", onSelect: jump });
}

/**
 * Shared one-click-update behavior for the two surfaces that trigger a self
 * update (260715-h1ck): the in-bar `UpdateChip` and the overflow menu's
 * version-row update surface. Extracted so the updating-state + failure
 * catch/toast can NEVER drift between the two — the exact bar↔menu duplication
 * the registry architecture exists to prevent (review M5 / A-021).
 *
 * Clearing `updating` (two paths):
 *   1. RUN-KIT in the spawned scope → the daemon restarts, SSE drops, and the
 *      reconnect's differing version reloads the tab, discarding this state.
 *   2. SIBLINGS-ONLY scope → no daemon restart, so no reload ever comes. The
 *      post-remediation re-check (R17) instead broadcasts a cleared/changed
 *      `update-available` whose composite `key` differs from the key at click
 *      time; observing that key change is the completion signal that clears
 *      `updating` (R13). Without it the chip would sit on `updating…` forever.
 * A FAILED upgrade leaves the key unchanged, so `updating` persists until a
 * page reload / force path — the accepted residual (same envelope as the old
 * rk-only flow, which relied on a reload that never came).
 *
 * On a request FAILURE (409 daemon-down / not-brew / no-update, network) it
 * re-enables immediately and surfaces the error toast so the user can retry or
 * read it.
 *
 * Click routing by feed: a surface lit from the MANUAL check feed
 * (`manualOnly`) triggers `forceUpdateNow()` (full-roster `shll update`) rather
 * than the scoped `updateNow()` — exactly what the check toast's "Update Now"
 * action already runs. The scoped path exists to move only the server's
 * `Snapshot().Matched` set, which a side-channel manual verdict never
 * populates, so a scoped click on a manual-fed chip would find nothing to do.
 * The ambient feed's scoped path is unchanged when the ambient feed is lit.
 */
export function useUpdateClick(): { updating: boolean; triggerUpdate: () => void } {
  const { updateNow, forceUpdateNow, manualOnly, key } = useUpdateNotification();
  const { addToast } = useToast();
  const navigate = useNavigate();
  const [updating, setUpdating] = useState(false);
  // The composite key at the moment the update was triggered. A later
  // `update-available` whose key differs (including the cleared empty key,
  // surfaced here as `null`) is the completion signal for the siblings-only
  // path. `undefined` when not updating.
  const clickKeyRef = useRef<string | null | undefined>(undefined);

  const triggerUpdate = useCallback(() => {
    if (updating) return;
    clickKeyRef.current = key;
    setUpdating(true);
    const run = manualOnly ? forceUpdateNow : updateNow;
    void run()
      .then((result) => consumeUpdateWatchTarget(result, navigate, addToast))
      .catch((err: unknown) => {
        setUpdating(false);
        clickKeyRef.current = undefined;
        addToast(err instanceof Error ? err.message : "Update failed", "error");
      });
  }, [updating, updateNow, forceUpdateNow, manualOnly, key, addToast, navigate]);

  // Clear `updating` once the verdict's composite key changes away from the
  // click-time key — the siblings-only completion signal (R13). Keyed on `key`
  // so it re-evaluates on every `update-available` the context applies.
  useEffect(() => {
    if (!updating) return;
    if (key !== clickKeyRef.current) {
      setUpdating(false);
      clickKeyRef.current = undefined;
    }
  }, [updating, key]);

  return { updating, triggerUpdate };
}
