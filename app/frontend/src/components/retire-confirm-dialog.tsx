import { useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/dialog";
import { sendOperatorRequest } from "@/api/client";
import { useToast } from "@/components/toast";

/**
 * The retire-tab confirm dialog (260822-rfz2-operator-digest-stuck-retire) —
 * the per-action confirmation guardrail for the operator seam's first
 * DESTRUCTIVE template, shared by BOTH retire entry points (the palette's
 * `Tab: Retire (ask operator)` and the flyout's `Retire…` row). Confirm fires
 * exactly ONE `retire-tab` operator request behind an in-flight guard (the
 * button disables while the POST is in flight, so re-clicks are no-ops);
 * success toasts the hand-off, failure toasts the server's structured message
 * (the `throwOnError` seam), and the dialog closes on settle either way.
 * Cancel/Escape (the Dialog's own wiring) closes with no request. There is no
 * spinner beyond the guard — the summary + kill arrive via the normal SSE
 * derive tick.
 */
export function RetireConfirmDialog({
  server,
  windowId,
  onClose,
}: {
  server: string;
  windowId: string;
  onClose: () => void;
}) {
  const { addToast } = useToast();
  const [busy, setBusy] = useState(false);
  // The dialog unmounts on close, so a settle after unmount is a real
  // possibility — guard the trailing onClose (the ForkActionRow idiom).
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const confirm = () => {
    // The click is a no-op while a request is in flight — `disabled` already
    // blocks it, this is the belt to that braces.
    if (busy) return;
    setBusy(true);
    sendOperatorRequest(server, windowId, "retire-tab")
      .then(() => addToast("Sent to operator — tab will be summarized and closed", "info"))
      .catch((err: Error) => addToast(err.message || "Failed to reach the operator", "error"))
      .finally(() => {
        if (mountedRef.current) onClose();
      });
  };

  return (
    <Dialog title="Retire tab?" onClose={onClose}>
      <p className="text-text-secondary mb-2.5">
        Ask the operator to summarize and close this tab? The window will be killed.
      </p>
      <div className="flex gap-2">
        <button
          onClick={onClose}
          className="flex-1 py-1.5 border border-border rounded hover:border-text-secondary"
        >
          Cancel
        </button>
        <button
          onClick={confirm}
          disabled={busy}
          className="flex-1 py-1.5 bg-red-900/30 border border-red-900 rounded hover:bg-red-900/50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Retire
        </button>
      </div>
    </Dialog>
  );
}
