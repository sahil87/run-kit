import { useEffect, useRef, useId, useCallback } from "react";

type DialogProps = {
  title: string;
  onClose: () => void;
  onConfirm?: () => void;
  children: React.ReactNode;
};

export function Dialog({ title, onClose, onConfirm, children }: DialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  // Stable refs so keydown handler always calls the latest callbacks
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onConfirmRef = useRef(onConfirm);
  onConfirmRef.current = onConfirm;

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") {
      onCloseRef.current();
      return;
    }
    if (e.key === "Enter" && onConfirmRef.current) {
      const tag = (e.target as HTMLElement)?.tagName;
      // Let inputs/textareas handle their own Enter (submit, newline, etc.)
      if (tag !== "INPUT" && tag !== "TEXTAREA") {
        e.preventDefault();
        onConfirmRef.current();
        return;
      }
    }
    const dialog = dialogRef.current;
    if (!dialog || e.key !== "Tab") return;
    const focusable = dialog.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  }, []);

  // Focus first focusable element on mount; attach keydown listener
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog) {
      const first = dialog.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      first?.focus();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

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
