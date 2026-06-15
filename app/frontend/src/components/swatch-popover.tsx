import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useTheme } from "@/contexts/theme-context";
import { PICKER_COLOR_VALUES, computeRowTints, colorValueToHex } from "@/themes";

type SwatchPopoverProps = {
  /** Currently-selected color value ("4" / "1+3"), or undefined when uncolored. */
  selectedColor?: string;
  onSelect: (color: string | null) => void;
  onClose: () => void;
};

/** Grid columns — must match the Tailwind `grid-cols-3` below for nav math. */
const GRID_COLS = 3;

export function SwatchPopover({ selectedColor, onSelect, onClose }: SwatchPopoverProps) {
  const { theme } = useTheme();
  const rowTints = useMemo(() => computeRowTints(theme.palette), [theme.palette]);
  const colorCount = PICKER_COLOR_VALUES.length; // 10
  // Clear is the item just past the last swatch; total = swatches + 1.
  const clearIndex = colorCount;
  const totalItems = colorCount + 1;

  const [focusIndex, setFocusIndex] = useState(() => {
    if (selectedColor == null) return 0;
    const idx = PICKER_COLOR_VALUES.indexOf(selectedColor);
    return idx >= 0 ? idx : 0;
  });
  const containerRef = useRef<HTMLDivElement>(null);

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
        setFocusIndex((i) => {
          if (i >= clearIndex) return i; // already on Clear
          const next = i + GRID_COLS;
          // Drop past the last grid row → land on Clear.
          return next < colorCount ? next : clearIndex;
        });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusIndex((i) => {
          if (i >= clearIndex) {
            // From Clear, jump back into the last occupied swatch in the grid.
            return colorCount - 1;
          }
          const prev = i - GRID_COLS;
          return prev >= 0 ? prev : i;
        });
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (focusIndex < colorCount) {
          onSelect(PICKER_COLOR_VALUES[focusIndex]);
        } else {
          onSelect(null);
        }
      }
    },
    [focusIndex, onSelect, totalItems, clearIndex, colorCount],
  );

  return (
    <div
      ref={containerRef}
      role="listbox"
      aria-label="Color picker"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="bg-bg-primary border border-border rounded-md shadow-lg p-1.5 z-50 w-max"
    >
      <div className="grid grid-cols-3 gap-1">
        {PICKER_COLOR_VALUES.map((value, i) => {
          const tint = rowTints.get(value);
          const fallback = colorValueToHex(value, theme.palette) ?? theme.palette.foreground;
          const baseColor = tint?.base ?? fallback;
          const selectedColor_ = tint?.selected ?? fallback;
          const isSelected = selectedColor === value;
          return (
            <button
              key={value}
              role="option"
              aria-selected={isSelected}
              aria-label={`Color ${value}`}
              data-color-value={value}
              onClick={() => onSelect(value)}
              className={`w-5 h-5 rounded-sm overflow-hidden transition-all flex flex-col ${
                focusIndex === i ? "ring-1 ring-text-secondary" : ""
              } ${isSelected ? "ring-1 ring-text-secondary" : ""}`}
            >
              <span className="flex-1 w-full" style={{ backgroundColor: baseColor }} />
              <span className="flex-1 w-full flex items-center justify-center" style={{ backgroundColor: selectedColor_ }}>
                {isSelected && (
                  <span style={{ color: theme.palette.foreground, fontWeight: 700, fontSize: 7, lineHeight: 1 }}>
                    &#x2713;
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
      <button
        role="option"
        aria-selected={selectedColor == null}
        onClick={() => onSelect(null)}
        className={`mt-1 w-full text-[10px] text-text-secondary hover:text-text-primary py-0.5 rounded-sm transition-colors ${
          focusIndex === clearIndex ? "ring-1 ring-text-secondary" : ""
        }`}
      >
        Clear
      </button>
    </div>
  );
}
