import { Dialog } from "@/components/dialog";
import { CONFIRM_DANGER, CONFIRM_NEUTRAL } from "@/components/controls";

type KillDialogProps = {
  killTarget: {
    type: "session" | "window";
    session: string;
    windowId?: string;
    windowCount: number;
  };
  onConfirm: () => void;
  onCancel: () => void;
};

export function KillDialog({ killTarget, onConfirm, onCancel }: KillDialogProps) {
  return (
    <Dialog
      title={killTarget.type === "window" ? "Kill tab?" : "Kill session?"}
      onClose={onCancel}
    >
      <p className="text-sm text-text-secondary mb-3">
        {killTarget.type === "window" ? (
          <>Kill this tab in <strong>{killTarget.session}</strong>?</>
        ) : (
          <>Kill session <strong>{killTarget.session}</strong> and all{" "}
          {killTarget.windowCount} tab
          {killTarget.windowCount !== 1 ? "s" : ""}?</>
        )}
      </p>
      <div className="flex gap-2">
        <button
          onClick={onCancel}
          className={`flex-1 ${CONFIRM_NEUTRAL}`}
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          className={`flex-1 ${CONFIRM_DANGER}`}
        >
          Kill
        </button>
      </div>
    </Dialog>
  );
}
