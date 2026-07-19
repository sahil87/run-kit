import { useState, useCallback, useRef, useEffect } from "react";
import { useUpdateNotification } from "@/contexts/session-context";
import { useToast } from "@/components/toast";

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
 * On a request FAILURE (409 not-brew / no-update, network) it re-enables
 * immediately and surfaces the error toast so the user can retry or read it.
 */
export function useUpdateClick(): { updating: boolean; triggerUpdate: () => void } {
  const { updateNow, key } = useUpdateNotification();
  const { addToast } = useToast();
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
    void updateNow().catch((err: unknown) => {
      setUpdating(false);
      clickKeyRef.current = undefined;
      addToast(err instanceof Error ? err.message : "Update failed", "error");
    });
  }, [updating, updateNow, key, addToast]);

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
