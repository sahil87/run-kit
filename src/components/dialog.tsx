"use client";

type DialogProps = {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
};

export function Dialog({ title, onClose, children }: DialogProps) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center"
      onClick={onClose}
    >
      <div className="fixed inset-0 bg-black/50" />
      <div
        className="relative bg-bg-primary border border-border rounded-lg p-4 w-full max-w-sm shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-medium mb-3">{title}</h2>
        {children}
      </div>
    </div>
  );
}
