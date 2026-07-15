import { useState, useCallback } from "react";
import { useUpdateNotification } from "@/contexts/session-context";
import { useToast } from "@/components/toast";

/**
 * Shared one-click-update behavior for the two surfaces that trigger a self
 * update (260715-h1ck): the in-bar `UpdateChip` and the overflow menu's
 * version-row update surface. Extracted so the updating-state + failure
 * catch/toast can NEVER drift between the two — the exact bar↔menu duplication
 * the registry architecture exists to prevent (review M5 / A-021).
 *
 * On success the daemon restarts, SSE drops, and the reconnect's differing
 * version reloads the tab — so `updating` is intentionally never cleared on the
 * happy path. On failure (409 not-brew / no-update, network) it re-enables and
 * surfaces the error toast so the user can retry or read the message.
 */
export function useUpdateClick(): { updating: boolean; triggerUpdate: () => void } {
  const { updateNow } = useUpdateNotification();
  const { addToast } = useToast();
  const [updating, setUpdating] = useState(false);

  const triggerUpdate = useCallback(() => {
    if (updating) return;
    setUpdating(true);
    void updateNow().catch((err: unknown) => {
      setUpdating(false);
      addToast(err instanceof Error ? err.message : "Update failed", "error");
    });
  }, [updating, updateNow, addToast]);

  return { updating, triggerUpdate };
}
