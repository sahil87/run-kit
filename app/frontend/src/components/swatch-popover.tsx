import { useState, useEffect, useCallback, useRef } from "react";
import { useTheme } from "@/contexts/theme-context";
import { PICKER_ANSI_INDICES } from "@/themes";

type SwatchPopoverProps = {
  selectedColor?: number;
  onSelect: (color: number | null) => void;
  onClose: () => void;
};

export function SwatchPopover({ selectedColor, onSelect, onClose }: SwatchPopoverProps) {
  const { theme } = useTheme();
  const [focusIndex, setFocusIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Total items = 13 swatches + 1 clear button
  const totalItems = PICKER_ANSI_INDICES.length + 1;

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose]);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    // Use setTimeout to avoid immediately closing from the click that opened it
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClick);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowRight") {
        e.preventDefault();
        setFocusIndex((i) => Math.min(i + 1, totalItems - 1));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setFocusIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        // Move down one row (7 columns)
        setFocusIndex((i) => Math.min(i + 7, totalItems - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusIndex((i) => Math.max(i - 7, 0));
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (focusIndex < PICKER_ANSI_INDICES.length) {
          onSelect(PICKER_ANSI_INDICES[focusIndex]);
        } else {
          onSelect(null);
        }
      }
    },
    [focusIndex, onSelect, totalItems],
  );

  return (
    <div
      ref={containerRef}
      role="listbox"
      aria-label="Color picker"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="bg-bg-primary border border-border rounded-lg shadow-lg p-2 z-50"
      style={{ minWidth: 180 }}
    >
      <div className="grid grid-cols-7 gap-1.5">
        {PICKER_ANSI_INDICES.map((idx, i) => {
          const color = theme.palette.ansi[idx];
          const isSelected = selectedColor === idx;
          return (
            <button
              key={idx}
              role="option"
              aria-selected={isSelected}
              aria-label={`Color ${idx}`}
              onClick={() => onSelect(idx)}
              className={`w-6 h-6 rounded border transition-all flex items-center justify-center text-[10px] ${
                focusIndex === i ? "ring-2 ring-text-primary" : ""
              } ${isSelected ? "border-text-primary" : "border-transparent hover:border-text-secondary"}`}
              style={{ backgroundColor: color }}
            >
              {isSelected && (
                <span style={{ color: theme.palette.background, fontWeight: 700 }}>
                  &#x2713;
                </span>
              )}
            </button>
          );
        })}
      </div>
      <button
        role="option"
        aria-selected={selectedColor == null}
        onClick={() => onSelect(null)}
        className={`mt-1.5 w-full text-xs text-text-secondary hover:text-text-primary py-1 rounded transition-colors ${
          focusIndex === PICKER_ANSI_INDICES.length ? "ring-2 ring-text-primary" : ""
        }`}
      >
        Clear
      </button>
    </div>
  );
}
