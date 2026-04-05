import { Dialog } from "@/components/dialog";

type KillDialogProps = {
  killTarget: {
    type: "session" | "window";
    session: string;
    windowId?: string;
    windowIndex?: number;
    windowCount: number;
  };
  onConfirm: () => void;
  onCancel: () => void;
};

export function KillDialog({ killTarget, onConfirm, onCancel }: KillDialogProps) {
  return (
    <Dialog
      title={killTarget.type === "window" ? "Kill window?" : "Kill session?"}
      onClose={onCancel}
    >
      <p className="text-sm text-text-secondary mb-3">
        {killTarget.type === "window" ? (
          <>Kill this window in <strong>{killTarget.session}</strong>?</>
        ) : (
          <>Kill session <strong>{killTarget.session}</strong> and all{" "}
          {killTarget.windowCount} window
          {killTarget.windowCount !== 1 ? "s" : ""}?</>
        )}
      </p>
      <div className="flex gap-2">
        <button
          onClick={onCancel}
          className="flex-1 text-sm py-1.5 border border-border rounded hover:border-text-secondary"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          className="flex-1 text-sm py-1.5 bg-red-900/30 border border-red-900 rounded hover:bg-red-900/50"
        >
          Kill
        </button>
      </div>
    </Dialog>
  );
}
