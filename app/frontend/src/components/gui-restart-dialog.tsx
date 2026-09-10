import { useState } from "react";
import { restartGui } from "@/api/client";
import { useToast } from "@/components/toast";
import { GuiConfirmShell, useGuiStatusOnOpen } from "@/components/gui-confirm-shell";
import { guiRestartBody } from "@/lib/gui-desktop";

/**
 * GuiRestartDialog — the desktop-pick restart confirm (spec docs/specs/gui.md
 * § Switching desktops). Mounted once at AppLayout behind the GuiRestartRequest
 * context; both picker doors (the Settings `gui.wm` row, the palette's
 * `GUI: Desktop…`) reach it through `useDesktopPick` AFTER their settings
 * write, so the pin stands whatever the verdict. `Restart` POSTs
 * `/api/gui/host/restart` itself; `Later` (and dismiss) resolves `false` and
 * calls nothing further. The body copy comes from the shared
 * `guiRestartBody` (lib/gui-desktop.ts).
 */
export function GuiRestartDialog({ onClose }: { onClose: (confirmed: boolean) => void }) {
  const { addToast } = useToast();
  const { status, loaded } = useGuiStatusOnOpen();
  const [busy, setBusy] = useState(false);

  const restart = () => {
    setBusy(true);
    restartGui()
      .then((r) => {
        // A 409 (the GUI flipped off between the check and the POST) is a
        // resolved result, not an error — the written pin still applies on
        // the next start.
        if (!r.ok) addToast("The GUI is off — the new desktop starts when it turns on", "info");
        onClose(true);
      })
      .catch((err: unknown) => {
        addToast(
          err instanceof Error && err.message ? err.message : "Failed to restart the desktop",
          "error",
        );
        onClose(true);
      });
  };

  const body = loaded ? { line: guiRestartBody(status) } : null;

  return (
    <GuiConfirmShell
      title="Restart the desktop now?"
      body={body}
      cancelLabel="Later"
      confirmLabel="Restart"
      busy={busy}
      onCancel={() => onClose(false)}
      onConfirm={restart}
    />
  );
}
