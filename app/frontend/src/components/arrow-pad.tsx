import { useState, useRef, useCallback, useEffect } from "react";

/** Minimum drag distance (px) to register a swipe vs a tap. */
const DRAG_THRESHOLD = 20;

type ArrowPadProps = {
  onArrow: (code: string) => void;
  className?: string;
};

const ARROW_BTN =
  "min-h-[36px] min-w-[36px] flex items-center justify-center text-sm text-text-secondary border border-border rounded select-none active:bg-bg-card hover:border-text-secondary focus-visible:outline-2 focus-visible:outline-accent";

/**
 * Combined arrow key control:
 * - Tap: opens a popup with 4 directional arrow buttons
 * - Drag/swipe: sends the arrow matching the drag direction
 */
export function ArrowPad({ onArrow, className }: ArrowPadProps) {
  const [open, setOpen] = useState(false);
  const padRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const didDragRef = useRef(false);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    startRef.current = { x: t.clientX, y: t.clientY };
    didDragRef.current = false;
  }, []);

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!startRef.current) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - startRef.current.x;
      const dy = t.clientY - startRef.current.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist >= DRAG_THRESHOLD) {
        didDragRef.current = true;
        if (Math.abs(dx) > Math.abs(dy)) {
          onArrow(dx > 0 ? "C" : "D");
        } else {
          onArrow(dy > 0 ? "B" : "A");
        }
      }
      startRef.current = null;
    },
    [onArrow],
  );

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    startRef.current = { x: e.clientX, y: e.clientY };
    didDragRef.current = false;
  }, []);

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (!startRef.current) return;
      const dx = e.clientX - startRef.current.x;
      const dy = e.clientY - startRef.current.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist >= DRAG_THRESHOLD) {
        didDragRef.current = true;
        if (Math.abs(dx) > Math.abs(dy)) {
          onArrow(dx > 0 ? "C" : "D");
        } else {
          onArrow(dy > 0 ? "B" : "A");
        }
      }
      startRef.current = null;
    },
    [onArrow],
  );

  const handleClick = useCallback(() => {
    if (didDragRef.current) return;
    setOpen((v) => !v);
  }, []);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (padRef.current && !padRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div ref={padRef} className={`relative ${className ?? ""}`}>
      <button
        aria-label="Arrow keys"
        aria-haspopup="true"
        aria-expanded={open}
        className="min-h-[36px] min-w-[36px] flex items-center justify-center px-1 py-0 text-xs border border-border rounded select-none transition-colors hover:border-text-secondary active:bg-bg-card focus-visible:outline-2 focus-visible:outline-accent text-text-secondary touch-none"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onClick={handleClick}
      >
        <kbd aria-hidden="true">{"\u2191"}</kbd>
      </button>

      {open && (
        <div
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 bg-bg-primary border border-border rounded-lg shadow-2xl p-1 z-50"
          role="group"
          aria-label="Arrow keys"
        >
          <div className="flex justify-center mb-0.5">
            <button aria-label="Up arrow" className={ARROW_BTN} onClick={() => { onArrow("A"); setOpen(false); }}>
              {"\u2191"}
            </button>
          </div>
          <div className="flex gap-0.5">
            <button aria-label="Left arrow" className={ARROW_BTN} onClick={() => { onArrow("D"); setOpen(false); }}>
              {"\u2190"}
            </button>
            <button aria-label="Down arrow" className={ARROW_BTN} onClick={() => { onArrow("B"); setOpen(false); }}>
              {"\u2193"}
            </button>
            <button aria-label="Right arrow" className={ARROW_BTN} onClick={() => { onArrow("C"); setOpen(false); }}>
              {"\u2192"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
