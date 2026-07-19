import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useTheme } from "@/contexts/theme-context";
import { PICKER_COLOR_VALUES, MARKER_STATES, markerStripeStyle, computeRowTints, colorValueToHex, resolveFamily, familyToLegacy } from "@/themes";

type SwatchPopoverProps = {
  /** Currently-selected color value — a family name ("orange") or a legacy
   *  numeric/blend descriptor ("4" / "1+3"); undefined when uncolored. Legacy
   *  values are normalized to their family so the correct swatch highlights. */
  selectedColor?: string;
  /** Called with the value to STORE. The popover maps the picked family name to
   *  its legacy numeric/blend descriptor (familyToLegacy) before invoking this,
   *  so stored color values stay in the legacy vocabulary the backend validates
   *  (zero backend change; R4 zero-migration). `null` clears the color. This is
   *  the single write seam every color-picking surface (window/session/server
   *  rows + the palette "Set Color" actions) funnels through. */
  onSelect: (color: string | null) => void;
  onClose: () => void;
  /** ── Combined-label extension (hwtr) ── When BOTH `onSelectMarker` and
   *  `markerColor` are supplied, the popover renders a second section below the
   *  color grid: a 1px hairline separator followed by 4 marker-state cells
   *  (none / dotted / solid / double) drawn as mini stripes in `markerColor`.
   *  Selection calls `onSelectMarker` DIRECTLY (no cycling — any state is one
   *  click) with `""` clearing the marker. Keyboard nav extends across both
   *  sections. When the marker props are ABSENT the component renders exactly as
   *  a color-only picker (session/server rows + the palette window-color action),
   *  so those callers are unaffected. */
  selectedMarker?: string;
  onSelectMarker?: (marker: string) => void;
  /** The row's guarded family color used to draw the marker-cell stripes (family
   *  hex on colored rows, gray sentinel on uncolored). Required to render the
   *  marker section. */
  markerColor?: string;
  /** Square styling flag (hwtr) — scoped to THIS instance (the window-row Label
   *  picker): zero border-radius on container + cells, a hard offset block shadow
   *  instead of the blurred drop shadow, 1px selection outlines, 3px gaps. Absent
   *  (default) renders the shipped rounded style so other callers are unchanged. */
  square?: boolean;
};

/** Grid columns for the color swatches, keyed to the `square` layout. Nav math
 *  and the Tailwind `grid-cols-*` class both read from this so they never drift.
 *  - `square` (the combined window-row Label picker, intake §2 BINDING layout):
 *    5 columns → the 10 swatches fill a perfect 5×2 grid and Clear is a
 *    full-width row spanning all 5 columns below them.
 *  - default (color-only session/server/palette callers): 4 columns → 10
 *    swatches fill rows 0-1 (cols 0-3) + row 2 cols 0-1, and Clear is a
 *    `col-span-2` cell occupying the remaining bottom-right cells. Unchanged. */
const SQUARE_GRID_COLS = 5;
const DEFAULT_GRID_COLS = 4;

/** The marker-cell order shown in the picker: none / dotted / solid / double.
 *  Mirrors MARKER_STATES (already `["", "dotted", "solid", "double"]`). */
const MARKER_CELLS = MARKER_STATES;

export function SwatchPopover({
  selectedColor,
  onSelect,
  onClose,
  selectedMarker,
  onSelectMarker,
  markerColor,
  square = false,
}: SwatchPopoverProps) {
  const { theme } = useTheme();
  const rowTints = useMemo(() => computeRowTints(theme.palette), [theme.palette]);

  // Grid width follows the layout: the square (window-row Label) picker uses the
  // intake §2 5×2 layout; color-only callers keep the shipped 4-col grid.
  const gridCols = square ? SQUARE_GRID_COLS : DEFAULT_GRID_COLS;

  // The marker section is rendered only when its two required inputs are present
  // (a write callback + a color to draw the stripes). Color-only callers omit
  // both and get the shipped picker unchanged.
  const showMarkers = !!onSelectMarker && !!markerColor;

  // The single write seam: map the picked family name ("orange") to its legacy
  // descriptor ("1+3") before handing it to the caller's onSelect, so every
  // stored color value stays in the legacy vocabulary the backend accepts.
  // `null` (Clear) passes through untouched.
  const emit = useCallback(
    (value: string | null) => onSelect(familyToLegacy(value)),
    [onSelect],
  );
  const colorCount = PICKER_COLOR_VALUES.length; // 10
  // Clear is the item just past the last swatch.
  const clearIndex = colorCount;
  // Marker cells (when shown) follow Clear, so the total keyboard-navigable item
  // count is swatches + Clear + (4 marker cells | 0).
  const markerBaseIndex = colorCount + 1; // first marker cell's focus index
  const totalItems = markerBaseIndex + (showMarkers ? MARKER_CELLS.length : 0);

  // Normalize the incoming selection to its canonical family name so a
  // legacy-stored value ("1+3") highlights the same swatch as its family
  // ("orange"). Undefined when uncolored or unrecognized.
  const selectedFamily = resolveFamily(selectedColor)?.name;
  // Normalize the current marker to one of the known cells ("" when unset).
  const currentMarker = selectedMarker ?? "";

  const [focusIndex, setFocusIndex] = useState(() => {
    if (selectedFamily == null) return 0;
    const idx = PICKER_COLOR_VALUES.indexOf(selectedFamily);
    return idx >= 0 ? idx : 0;
  });
  const containerRef = useRef<HTMLDivElement>(null);

  // Emit the item at a given focus index (Enter/Space). Colors + Clear map to
  // onSelect; marker cells map to onSelectMarker.
  const activateIndex = useCallback(
    (i: number) => {
      if (i < colorCount) {
        emit(PICKER_COLOR_VALUES[i]);
      } else if (i === clearIndex) {
        emit(null);
      } else if (showMarkers) {
        const cell = i - markerBaseIndex;
        if (cell >= 0 && cell < MARKER_CELLS.length && onSelectMarker) {
          onSelectMarker(MARKER_CELLS[cell]);
        }
      }
    },
    [emit, colorCount, clearIndex, showMarkers, markerBaseIndex, onSelectMarker],
  );

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

  // Autofocus the listbox on mount so keyboard nav works immediately — the
  // `Window: Label` palette action is the only keyboard path to the marker
  // section, and arrow keys are dead until the listbox has focus. Mirrors
  // pin-popover.tsx's mount-focus of its input.
  useEffect(() => {
    containerRef.current?.focus();
  }, []);

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
          // Within the marker row: ArrowDown is a no-op (last row).
          if (i >= markerBaseIndex) return i;
          if (i === clearIndex) {
            // From Clear, step into the marker section (first cell) when shown.
            return showMarkers ? markerBaseIndex : i;
          }
          const next = i + gridCols;
          if (next < colorCount) return next; // lands on a real swatch
          // Past the last swatch row: any downward move lands on Clear (a
          // full-width row in the square layout, the col-span cell otherwise).
          return clearIndex;
        });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusIndex((i) => {
          if (i >= markerBaseIndex) {
            // From a marker cell, step up to Clear (the row directly above).
            return clearIndex;
          }
          if (i === clearIndex) {
            // Clear begins the final swatch-grid row at column `colorCount % gridCols`.
            // Step up one row, same column → the swatch directly above Clear's left edge.
            // (4-col: slot 6, "blue"; 5-col square: slot 5, Clear starts at col 0.)
            const clearCol = colorCount % gridCols;
            const clearRow = Math.floor(colorCount / gridCols);
            return (clearRow - 1) * gridCols + clearCol;
          }
          const prev = i - gridCols;
          return prev >= 0 ? prev : i;
        });
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        activateIndex(focusIndex);
      }
    },
    [focusIndex, activateIndex, totalItems, clearIndex, colorCount, markerBaseIndex, showMarkers, gridCols],
  );

  // Square (hwtr Label picker) vs shipped rounded styling.
  const containerCls = square
    ? "bg-bg-primary border border-border p-1.5 z-50 w-max"
    : "bg-bg-primary border border-border rounded-md shadow-lg p-1.5 z-50 w-max";
  const containerStyle: React.CSSProperties | undefined = square
    ? { boxShadow: "3px 3px 0 rgba(0,0,0,.35)" }
    : undefined;
  const cellRadius = square ? "" : "rounded-sm";
  const gridGap = square ? "gap-[3px]" : "gap-1";
  // Full literal class strings (Tailwind JIT can't see interpolated names).
  // Square (Label picker): 5×2 swatch grid, 18px cells, full-width Clear row.
  // Default (color-only): shipped 4-col grid, 20px cells, col-span-2 Clear.
  const colorGridCls = square ? "grid grid-cols-5" : "grid grid-cols-4";
  const swatchSize = square ? "w-[18px] h-[18px]" : "w-5 h-5";
  const clearSpan = square ? "col-span-5" : "col-span-2";

  return (
    <div
      ref={containerRef}
      role="listbox"
      aria-label={showMarkers ? "Label picker" : "Color picker"}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className={containerCls}
      style={containerStyle}
    >
      <div className={`${colorGridCls} ${gridGap}`}>
        {PICKER_COLOR_VALUES.map((value, i) => {
          const tint = rowTints.get(value);
          const fallback = colorValueToHex(value, theme.palette) ?? theme.palette.foreground;
          const baseColor = tint?.base ?? fallback;
          const selectedColor_ = tint?.selected ?? fallback;
          const isSelected = selectedFamily === value;
          return (
            <button
              key={value}
              role="option"
              aria-selected={isSelected}
              aria-label={`Color ${value}`}
              data-color-value={value}
              onClick={() => emit(value)}
              className={`${swatchSize} ${cellRadius} overflow-hidden transition-all flex flex-col ${
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
        {/* Clear — full-width row in the square layout (spanning all 5 columns),
            the col-span-2 bottom-right cell otherwise. */}
        <button
          role="option"
          aria-selected={selectedFamily == null}
          onClick={() => emit(null)}
          className={`${clearSpan} h-5 text-[10px] text-text-secondary hover:text-text-primary ${cellRadius} transition-colors flex items-center justify-center ${
            focusIndex === clearIndex ? "ring-1 ring-text-secondary" : ""
          }`}
        >
          {square ? "Clear color" : "Clear"}
        </button>
      </div>
      {/* Combined-label extension (hwtr): marker section below a hairline. */}
      {showMarkers && markerColor && (
        <>
          <div className="border-t border-border my-1.5" aria-hidden="true" />
          <div className={`grid grid-cols-4 ${gridGap}`}>
            {MARKER_CELLS.map((state, cell) => {
              const idx = markerBaseIndex + cell;
              const isSelected = currentMarker === state;
              const stripe = markerStripeStyle(state, markerColor);
              return (
                <button
                  key={state || "none"}
                  role="option"
                  aria-selected={isSelected}
                  aria-label={`Marker ${state || "none"}`}
                  data-marker-value={state}
                  onClick={() => onSelectMarker?.(state)}
                  className={`w-5 h-5 ${cellRadius} bg-bg-inset overflow-hidden transition-all relative ${
                    focusIndex === idx ? "ring-1 ring-text-secondary" : ""
                  } ${isSelected ? "ring-1 ring-text-secondary" : ""}`}
                  title={state || "none"}
                >
                  {stripe && <span className="absolute inset-0" style={stripe} />}
                  {state === "" && (
                    <span className="absolute inset-0 flex items-center justify-center text-text-secondary" style={{ fontSize: 8, lineHeight: 1 }}>
                      &#x2205;
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
