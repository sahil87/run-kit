import { useRef, useId } from "react";
import { useFocusTrap } from "@/hooks/use-focus-trap";

type DialogProps = {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
};

export function Dialog({ title, onClose, children }: DialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  // Dialog only mounts while open, so the trap is unconditionally active.
  // The hook owns focus-first-on-mount, Escape → onClose, and Tab wrap.
  useFocusTrap(dialogRef, true, onClose);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center"
      onClick={onClose}
    >
      <div className="fixed inset-0 bg-black/50" aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative bg-bg-primary border border-border rounded-lg p-3 w-full max-w-sm shadow-2xl text-[11px]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="text-xs font-medium mb-2.5">{title}</h2>
        {children}
      </div>
    </div>
  );
}
