import { useCallback } from "react";
import { fetchGuiStatus } from "@/api/client";
import { useToast } from "@/components/toast";
import { useGuiRestartRequest } from "@/contexts/gui-restart-context";
import { DESKTOP_SET_OFF_TOAST } from "@/lib/gui-desktop";

/**
 * The shared desktop-pick flow behind both doors (the Settings `gui.wm` row
 * and the palette's `GUI: Desktop…` sub-list): the caller's settings write
 * first, then a fresh one-shot status fetch decides the ending — a disabled
 * GUI skips the confirm and toasts that the pin takes effect on the next turn
 * on (a restart would 409); otherwise the GuiRestartRequest confirm opens and
 * its Restart button owns the restart POST. A failed status fetch reads as
 * enabled/unknown, so the confirm still opens (it renders its generic line).
 * The write's own rejection propagates before any of this runs.
 */
export function useDesktopPick(): (
  name: string,
  write: (name: string) => Promise<void> | void,
) => Promise<void> {
  const { addToast } = useToast();
  const restartRequest = useGuiRestartRequest();

  return useCallback(
    async (name, write) => {
      await write(name);
      let enabled = true;
      try {
        enabled = (await fetchGuiStatus()).enabled;
      } catch {
        // Unknown reads as enabled: the confirm renders its generic line.
      }
      if (!enabled) {
        addToast(DESKTOP_SET_OFF_TOAST, "info");
        return;
      }
      await restartRequest?.request();
    },
    [addToast, restartRequest],
  );
}
