import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";

type ToastVariant = "error" | "info";

type ToastEntry = {
  id: string;
  message: string;
  variant: ToastVariant;
};

type ToastContextType = {
  addToast: (message: string, variant?: ToastVariant) => void;
};

const ToastContext = createContext<ToastContextType | null>(null);

let nextId = 0;

const TOAST_DURATION = 4000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);

  const addToast = useCallback((message: string, variant: ToastVariant = "error") => {
    const id = String(++nextId);
    setToasts((prev) => [...prev, { id, message, variant }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextType {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

function ToastContainer({ toasts, onRemove }: { toasts: ToastEntry[]; onRemove: (id: string) => void }) {
  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <Toast key={toast.id} entry={toast} onDismiss={() => onRemove(toast.id)} />
      ))}
    </div>
  );
}

function Toast({ entry, onDismiss }: { entry: ToastEntry; onDismiss: () => void }) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    timerRef.current = setTimeout(() => onDismissRef.current(), TOAST_DURATION);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const accentColor = entry.variant === "error" ? "var(--color-ansi-1)" : "var(--color-ansi-4)";

  return (
    <div
      role="alert"
      className="pointer-events-auto bg-bg-card border border-border text-text-primary font-mono text-xs px-3 py-2 rounded shadow-lg max-w-xs"
      style={{ borderLeftWidth: 3, borderLeftColor: accentColor }}
    >
      {entry.message}
    </div>
  );
}
