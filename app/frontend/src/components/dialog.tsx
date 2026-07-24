import { useRef, useId } from "react";
import { useFocusTrap } from "@/hooks/use-focus-trap";

type DialogProps = {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Width variant (260724-6j1v): `sm` (default) keeps the phone-card
   *  `max-w-sm` every existing dialog uses; `lg` is the desktop preference-pane
   *  width (`max-w-2xl`, ≈672px) the settings dialog opts into. */
  size?: "sm" | "lg";
};

export function Dialog({ title, onClose, children, size = "sm" }: DialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  // Dialog only mounts while open, so the trap is unconditionally active.
  // The hook owns focus-first-on-mount, Escape → onClose, and Tab wrap.
  useFocusTrap(dialogRef, true, onClose);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="fixed inset-0 bg-black/50" aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        // max-h + overflow-y keep tall dialogs (the lg settings pane) scrollable
        // inside short viewports instead of clipping off-screen; the calc offset
        // matches the container's p-4 so the panel never touches the edges.
        className={`relative bg-bg-primary border border-border rounded-lg p-3 w-full ${size === "lg" ? "max-w-2xl" : "max-w-sm"} max-h-[calc(100vh-2rem)] overflow-y-auto shadow-2xl text-[11px]`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="text-xs font-medium mb-2.5">{title}</h2>
        {children}
      </div>
    </div>
  );
}
