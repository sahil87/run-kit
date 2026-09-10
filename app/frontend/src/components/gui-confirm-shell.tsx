import { useEffect, useState } from "react";
import { fetchGuiStatus, type GuiStatus } from "@/api/client";
import { Dialog } from "@/components/dialog";
import { controlClass } from "@/components/control";

/**
 * The shared GUI confirm-dialog shell (spec docs/specs/gui.md § The switch) —
 * the one-shot status fetch plus the body/buttons layout behind both the
 * off-confirm (`gui-off-dialog.tsx`) and the desktop restart confirm
 * (`gui-restart-dialog.tsx`). The stream payload carries no apps, so every
 * consumer fetches `GET /api/gui/host` once on open (never polled); a failed
 * GET leaves the confirm with the caller's generic copy, never a throw.
 */

/** Fetch the status document once on mount. `loaded` flips true on either
 *  outcome — `status` null with `loaded` true is the failed-GET case. */
export function useGuiStatusOnOpen(): { status: GuiStatus | null; loaded: boolean } {
  const [status, setStatus] = useState<GuiStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    fetchGuiStatus()
      .then((s) => {
        if (alive) {
          setStatus(s);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);
  return { status, loaded };
}

/** The body/buttons half: a one- or two-line body (the checking placeholder
 *  while `body` is null), then the cancel/confirm pair on the confirm recipe. */
export function GuiConfirmShell({
  title,
  body,
  cancelLabel,
  confirmLabel,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: { line: string; detail?: string } | null;
  cancelLabel: string;
  confirmLabel: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog title={title} onClose={onCancel}>
      {body ? (
        <p className="text-text-secondary mb-2.5">
          {body.line}
          {body.detail ? (
            <>
              <br />
              <span className="pl-4">{body.detail}</span>
            </>
          ) : null}
        </p>
      ) : (
        <p className="text-text-secondary mb-2.5">Checking what the GUI is running…</p>
      )}
      <div className="flex gap-2">
        <button onClick={onCancel} className={`flex-1 ${controlClass({ variant: "confirm" })}`}>
          {cancelLabel}
        </button>
        <button
          onClick={onConfirm}
          disabled={busy}
          className={`flex-1 ${controlClass({ variant: "confirm", danger: true })}`}
        >
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
