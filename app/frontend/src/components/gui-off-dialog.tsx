import { useState } from "react";
import { postSettings, type GuiStatus } from "@/api/client";
import { useToast } from "@/components/toast";
import { GuiConfirmShell, useGuiStatusOnOpen } from "@/components/gui-confirm-shell";

/**
 * GuiOffDialog — the GUI off-confirm (spec docs/specs/gui.md § The switch:
 * "the off direction opens the confirm listing running apps"). Opened by the
 * palette's `GUI: Turn off` and by the settings seam's `gui.enabled` off
 * interception; the mount-on-open grammar (a boolean in the caller gates the
 * mount) matches the server dialogs.
 *
 * On open it fetches `GET /api/gui/host` once (never polled) and renders from
 * its `apps`/`display`/`uptime_seconds`/`backend` fields — the stream payload
 * carries no apps, so the confirm copy cannot derive from it. Confirm POSTs
 * exactly `{"gui.enabled": false}` — the settings side effect kills the
 * rk-gui session; the dialog never calls a kill route itself. The fetch/body/
 * buttons shell is shared with the restart confirm (gui-confirm-shell.tsx).
 */

/** Format the supervisor uptime: `4h 12m` / `3m` / `12s`. */
export function formatGuiUptime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

/** The confirm body per status shape — the CLI confirm's copy grammar. */
export function guiOffBody(status: GuiStatus): { line: string; detail?: string } {
  if (status.backend === "screen-sharing") {
    return {
      line: "Turning the GUI off stops the Screen Sharing mirror; nothing on your Mac is closed.",
    };
  }
  if (!status.display) {
    return { line: "Turning the GUI off kills the rk-gui session." };
  }
  if (status.apps.length === 0) {
    return {
      line: "Turning the GUI off kills the rk-gui session.",
      detail: `No apps are running on display ${status.display}.`,
    };
  }
  const names = status.apps.map((a) => `${a.name} ×${a.count}`).join(", ");
  const up = status.uptime_seconds > 0 ? `  (up ${formatGuiUptime(status.uptime_seconds)})` : "";
  return {
    line: `Turning the GUI off kills the rk-gui session and every app on display ${status.display}:`,
    detail: `${names}${up}`,
  };
}

export function GuiOffDialog({
  onClose,
  postOnConfirm = true,
}: {
  onClose: (confirmed: boolean) => void;
  /** When false the caller owns the settings POST (the settings seam's
   *  interception, which must `updateEntryValue` with the same write) — the
   *  dialog only resolves the verdict. Default true (the palette path). */
  postOnConfirm?: boolean;
}) {
  const { addToast } = useToast();
  // null + !loaded = the GET is in flight; null + loaded = it failed (the
  // dialog still confirms — the copy just lacks the apps list).
  const { status, loaded } = useGuiStatusOnOpen();
  const [busy, setBusy] = useState(false);

  const confirm = () => {
    if (!postOnConfirm) {
      onClose(true);
      return;
    }
    setBusy(true);
    postSettings({ "gui.enabled": false })
      .then(() => onClose(true))
      .catch((err: unknown) => {
        addToast(err instanceof Error && err.message ? err.message : "Failed to save", "error");
        setBusy(false);
      });
  };

  // A failed GET leaves the confirm with the generic copy (never a throw).
  const body = status
    ? guiOffBody(status)
    : loaded
      ? { line: "Turning the GUI off kills the rk-gui session." }
      : null;

  return (
    <GuiConfirmShell
      title="Turn the GUI off?"
      body={body}
      cancelLabel="Cancel"
      confirmLabel="Turn off"
      busy={busy}
      onCancel={() => onClose(false)}
      onConfirm={confirm}
    />
  );
}
