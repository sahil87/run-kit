import { useEffect, useRef } from "react";

type ContextMenuProps = {
  x: number;
  y: number;
  pinned: boolean;
  onPin: () => void;
  onUnpin: () => void;
  onClose: () => void;
};

export function ContextMenu({ x, y, pinned, onPin, onUnpin, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Dismiss on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  // Dismiss on Escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="fixed z-50 bg-bg-primary border border-border shadow-2xl rounded py-1 text-sm"
      style={{ left: x, top: y }}
    >
      <button
        className="block w-full text-left px-3 py-1.5 hover:bg-bg-card text-text-primary whitespace-nowrap"
        onClick={() => {
          if (pinned) {
            onUnpin();
          } else {
            onPin();
          }
          onClose();
        }}
      >
        {pinned ? "Unpin from Lanes" : "Pin to Lanes"}
      </button>
    </div>
  );
}
