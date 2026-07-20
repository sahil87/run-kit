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
  /** ── Combined-label extension ── When `onSelectMarker` is supplied, the
   *  popover renders the side-by-side Label picker: a marker column (∅ /
   *  dotted / solid / double as mini stripes) LEFT of a vertical hairline,
   *  beside the color grid. Stripes draw in the theme FOREGROUND — deliberately
   *  NOT the row's guarded family color: the picker's marker cells communicate
   *  shape, the color axis has its own section, and a row-color-dependent
   *  stripe repaints the marker column on color changes (contradicting the
   *  independent-axes model) while rendering near-invisible gray on uncolored
   *  rows. The row gutter itself still renders in the guarded family color.
   *  Selection calls `onSelectMarker` DIRECTLY (no cycling — any state is one
   *  click) with `""` clearing the marker. Keyboard nav crosses the hairline
   *  (ArrowLeft/Right). When `onSelectMarker` is ABSENT the component renders
   *  the pure color grid (session/server rows + the palette color actions) —
   *  same square style, no marker column, no hairline. */
  selectedMarker?: string;
  onSelectMarker?: (marker: string) => void;
};

/** Colors per row in the color grid. The layout is a conceptual 5-column grid:
 *  marker column (col 0, when shown) + 4 color columns (cols 1–4), 4 rows
 *  (removal row + 3 color rows). */
const COLOR_COLS = 4;

/** The marker-cell order shown in the picker column: none / dotted / solid /
 *  double. Mirrors MARKER_STATES (already `["", "dotted", "solid", "double"]`),
 *  with `∅` in row 0 (the removal row) and the three non-empty states beside
 *  the three color rows.
 *
 *  LOAD-BEARING COINCIDENCE: the row pairing works because the 10
 *  PICKER_COLOR_VALUES laid out 4-wide make exactly 3 rows (4/4/2) — the same
 *  count as the 3 non-empty MARKER_STATES. Changing PICKER_COLOR_VALUES' length
 *  or MARKER_STATES breaks the 1:1 marker-row ↔ color-row alignment (and the
 *  keyboard grid below). */
const MARKER_CELLS = MARKER_STATES;

/** Number of grid rows: the removal row + ceil(10 / 4) = 3 color rows. */
const GRID_ROWS = 1 + Math.ceil(PICKER_COLOR_VALUES.length / COLOR_COLS); // 4

/** Keyboard focus position on the conceptual 5-column grid.
 *  - `row`: 0 = removal row (∅ | Clear color), 1–3 = color rows.
 *  - `col`: 0 = marker column (only valid when markers shown); 1–4 = color
 *    columns. The `Clear color` button spans cols 1–4 of row 0 as a SINGLE
 *    focus target, canonicalized to col 1. */
type GridPos = { row: number; col: number };

/** Color-array index for a grid position (rows 1–3, cols 1–4), possibly past
 *  the end (the two dead cells at row 3, cols 3–4). */
function colorIndexAt(row: number, col: number): number {
  return (row - 1) * COLOR_COLS + (col - 1);
}

/** Last valid color column in a color row (row 3 holds only 2 colors). */
function maxColorCol(row: number): number {
  const rowStart = (row - 1) * COLOR_COLS;
  const inRow = Math.min(PICKER_COLOR_VALUES.length - rowStart, COLOR_COLS);
  return inRow; // cols are 1-based, so a full row's last col is 4
}

export function SwatchPopover({
  selectedColor,
  onSelect,
  onClose,
  selectedMarker,
  onSelectMarker,
}: SwatchPopoverProps) {
  const { theme } = useTheme();
  const rowTints = useMemo(() => computeRowTints(theme.palette), [theme.palette]);

  // The marker section is rendered only when a marker write callback is
  // present. Color-only callers omit it and get the pure color grid (same
  // square style, no marker column).
  const showMarkers = !!onSelectMarker;

  // The single write seam: map the picked family name ("orange") to its legacy
  // descriptor ("1+3") before handing it to the caller's onSelect, so every
  // stored color value stays in the legacy vocabulary the backend accepts.
  // `null` (Clear) passes through untouched.
  const emit = useCallback(
    (value: string | null) => onSelect(familyToLegacy(value)),
    [onSelect],
  );

  // Normalize the incoming selection to its canonical family name so a
  // legacy-stored value ("1+3") highlights the same swatch as its family
  // ("orange"). Undefined when uncolored or unrecognized.
  const selectedFamily = resolveFamily(selectedColor)?.name;
  // Normalize the current marker to one of the known cells ("" when unset).
  const currentMarker = selectedMarker ?? "";

  // Initial focus FOLLOWS SELECTION: the selected color swatch, or the Clear
  // color cell (row 0 — already aria-selected in that state) when uncolored.
  // Never an arbitrary swatch — a focus ring on an unselected color reads as a
  // phantom selection. The marker column is reached via ArrowLeft.
  const [focus, setFocus] = useState<GridPos>(() => {
    const idx = selectedFamily != null ? PICKER_COLOR_VALUES.indexOf(selectedFamily) : -1;
    if (idx < 0) return { row: 0, col: 1 };
    return { row: Math.floor(idx / COLOR_COLS) + 1, col: (idx % COLOR_COLS) + 1 };
  });
  // Focus-visible semantics: the focus ring renders only after the keyboard
  // has actually been used (first arrow key). The listbox autofocuses on
  // mount, so an always-on ring would show mouse users a phantom highlight
  // they never asked for.
  const [keyboardActive, setKeyboardActive] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Activate the cell at a grid position (Enter/Space). The marker column maps
  // to onSelectMarker; row 0's color side is Clear; color cells map to onSelect.
  const activate = useCallback(
    (pos: GridPos) => {
      if (pos.col === 0) {
        // Marker column: MARKER_CELLS[row] — ∅ in row 0, dotted/solid/double
        // beside the three color rows (the load-bearing alignment above). The
        // explicit undefined check guards against that alignment drifting
        // (GRID_ROWS outgrowing MARKER_CELLS) — never emit undefined.
        const marker = MARKER_CELLS[pos.row];
        if (onSelectMarker && marker !== undefined) onSelectMarker(marker);
      } else if (pos.row === 0) {
        emit(null); // Clear color
      } else {
        const idx = colorIndexAt(pos.row, pos.col);
        if (idx >= 0 && idx < PICKER_COLOR_VALUES.length) emit(PICKER_COLOR_VALUES[idx]);
      }
    },
    [emit, showMarkers, onSelectMarker],
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

  // Arrow-key movement on the conceptual grid. ArrowLeft/ArrowRight cross the
  // vertical hairline (marker column ↔ color columns); ArrowUp/ArrowDown move
  // within a column. Moves off a grid edge — and into the two dead cells at
  // row 3, cols 3–4 — clamp to the nearest valid cell (no-op at hard edges),
  // consistent with the previous implementation's clamping.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key.startsWith("Arrow")) setKeyboardActive(true);
      if (e.key === "ArrowRight") {
        e.preventDefault();
        setFocus((f) => {
          if (f.col === 0) return { row: f.row, col: 1 }; // cross the hairline
          if (f.row === 0) return f; // Clear spans to the right edge
          return { row: f.row, col: Math.min(f.col + 1, maxColorCol(f.row)) };
        });
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setFocus((f) => {
          if (f.col === 0) return f; // already at the left edge
          if (f.col === 1) return showMarkers ? { row: f.row, col: 0 } : f; // cross the hairline
          return { row: f.row, col: f.col - 1 };
        });
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocus((f) => {
          if (f.row >= GRID_ROWS - 1) return f; // bottom row
          const row = f.row + 1;
          if (f.col === 0) return { row, col: 0 }; // within the marker column
          // Clamp into the shorter last color row (dead cells at row 3, cols 3–4).
          return { row, col: Math.min(f.col, maxColorCol(row)) };
        });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocus((f) => {
          if (f.row === 0) return f; // top row
          const row = f.row - 1;
          if (f.col === 0) return { row, col: 0 }; // within the marker column
          if (row === 0) return { row: 0, col: 1 }; // Clear — single spanning target
          return { row, col: f.col };
        });
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        activate(focus);
      }
    },
    [focus, activate, showMarkers],
  );

  const focusOnClear = keyboardActive && focus.row === 0 && focus.col >= 1;

  return (
    <div
      ref={containerRef}
      role="listbox"
      aria-label={showMarkers ? "Label picker" : "Color picker"}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="bg-bg-primary border border-border p-1.5 z-50 w-max"
      style={{ boxShadow: "3px 3px 0 rgba(0,0,0,.35)" }}
    >
      <div className="flex">
        {/* Marker column (col 0) + vertical hairline — Label-picker callers only.
            Each 18px cell + 3px gap row-aligns 1:1 with the color grid beside it:
            ∅ beside Clear color (the removal row), dotted/solid/double beside
            the three color rows. */}
        {showMarkers && (
          <>
            <div className="flex flex-col gap-[3px]">
              {MARKER_CELLS.map((state, row) => {
                const isSelected = currentMarker === state;
                const isFocused = keyboardActive && focus.col === 0 && focus.row === row;
                // Theme foreground, NOT the row's guarded family color — see
                // the prop docs on the combined-label extension.
                const stripe = markerStripeStyle(state, theme.palette.foreground);
                return (
                  <button
                    key={state || "none"}
                    role="option"
                    aria-selected={isSelected}
                    aria-label={`Marker ${state || "none"}`}
                    data-marker-value={state}
                    onClick={() => onSelectMarker?.(state)}
                    className={`w-[18px] h-[18px] bg-bg-inset overflow-hidden transition-all relative ${
                      isFocused ? "ring-1 ring-text-secondary" : ""
                    } ${isSelected ? "ring-1 ring-text-primary" : ""}`}
                    title={state || "none"}
                  >
                    {stripe && <span className="absolute inset-0" style={stripe} />}
                    {state === "" && (
                      <span className="absolute inset-0 flex items-center justify-center text-text-secondary" style={{ fontSize: 10, lineHeight: 1 }}>
                        &#x2205;
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="w-px bg-border mx-1.5 self-stretch" aria-hidden="true" />
          </>
        )}
        {/* Color section (cols 1–4): the removal row's full-width Clear color,
            then the 10 family swatches laid out 4-wide (rows of 4/4/2). */}
        <div className="grid grid-cols-4 gap-[3px]">
          <button
            role="option"
            aria-selected={selectedFamily == null}
            onClick={() => emit(null)}
            className={`col-span-4 h-[18px] text-[10px] text-text-secondary hover:text-text-primary transition-colors flex items-center justify-center ${
              focusOnClear ? "ring-1 ring-text-secondary" : ""
            } ${selectedFamily == null ? "ring-1 ring-text-primary" : ""}`}
          >
            Clear color
          </button>
          {PICKER_COLOR_VALUES.map((value, i) => {
            const tint = rowTints.get(value);
            const fallback = colorValueToHex(value, theme.palette) ?? theme.palette.foreground;
            const baseColor = tint?.base ?? fallback;
            const selectedColor_ = tint?.selected ?? fallback;
            const isSelected = selectedFamily === value;
            const isFocused =
              keyboardActive &&
              focus.row === Math.floor(i / COLOR_COLS) + 1 && focus.col === (i % COLOR_COLS) + 1;
            return (
              <button
                key={value}
                role="option"
                aria-selected={isSelected}
                aria-label={`Color ${value}`}
                data-color-value={value}
                onClick={() => emit(value)}
                className={`w-[18px] h-[18px] overflow-hidden transition-all flex flex-col ${
                  isFocused ? "ring-1 ring-text-secondary" : ""
                } ${isSelected ? "ring-1 ring-text-primary" : ""}`}
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
      </div>
    </div>
  );
}
