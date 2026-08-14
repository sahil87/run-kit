import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useTheme } from "@/contexts/theme-context";
import { Tip, TipGroup } from "@/components/tip";
import {
  PICKER_COLOR_VALUES,
  MARKER_STATES,
  FLAIR_STATES,
  UNCOLORED_SELECTED_KEY,
  markerStripeStyle,
  computeRowTints,
  computeRowBorders,
  colorValueToHex,
  parseColorValue,
  formatColorValue,
  familyToLegacy,
} from "@/themes";

type SwatchPopoverProps = {
  /** Currently-selected color value — a family/shade name ("orange" /
   *  "orange-dark") or a legacy numeric/blend descriptor ("4" / "1+3");
   *  undefined when uncolored. Legacy values are normalized to their family
   *  (normal shade) so the correct swatch highlights. */
  selectedColor?: string;
  /** Called with the value to STORE — the single write seam every
   *  color-picking surface (window/session/server rows + the palette "Set
   *  Color" actions) funnels through. A picked NORMAL-shade family name is
   *  mapped to its legacy numeric/blend descriptor (familyToLegacy) first, so
   *  pre-existing stored values stay in the legacy vocabulary (zero
   *  migration); DARK-shade picks ("orange-dark") have no legacy form and
   *  pass through verbatim — the backend validators accept both
   *  vocabularies. `null` clears the color. */
  onSelect: (color: string | null) => void;
  /** Dismissal model: selection NEVER dismisses — the picker stays open so
   *  color + marker combos can be previewed live against the row. It closes
   *  only via the explicit ✕ cell, a click outside, or Escape; callers must
   *  NOT close in their onSelect/onSelectMarker handlers. */
  onClose: () => void;
  /** When `onSelectMarker` is supplied, the popover renders the side-by-side
   *  Label picker: a marker column (∅ / dotted / dashed / solid / double /
   *  thick) LEFT of a vertical hairline. Non-∅ cells are LIVE ROW PREVIEWS of
   *  the currently selected color, mirroring the row's RESTING look (details
   *  at the marker-column JSX). Selection calls `onSelectMarker` DIRECTLY —
   *  any state is one click, `""` clears. Keyboard nav crosses the hairline
   *  (ArrowLeft/Right). When ABSENT, the pure color grid renders — same
   *  square style, no marker column, no hairline. */
  selectedMarker?: string;
  onSelectMarker?: (marker: string) => void;
  /** When `onSelectFlair` is supplied, a flair row (∅ / nyan / naruto /
   *  onepiece) renders below the color grid behind a horizontal hairline —
   *  live row previews like the marker column, each carrying its always-on
   *  rk-flair-* overlay. Selection calls `onSelectFlair` DIRECTLY — `""`
   *  clears, no cycling. ArrowDown from the bottom color row enters it as an
   *  extra grid row (FLAIR_ROW). Offered on window and session rows; NOT
   *  server group headers. */
  selectedFlair?: string;
  onSelectFlair?: (flair: string) => void;
};

/** Colors per row. The layout is a conceptual 5-column grid: marker column
 *  (col 0, when shown) + 4 color columns (cols 1–4), 6 rows (removal row + 5
 *  color rows). The 4-wide layout renders each family's two shades ADJACENT
 *  because PICKER_COLOR_VALUES is in paired order. */
const COLOR_COLS = 4;

/** DELIBERATE 1:1 PAIRING: the marker column and the color grid pair
 *  row-for-row — the invariant GRID_ROWS === MARKER_CELLS.length is part of
 *  the design (asserted in swatch-popover.test.tsx). Extend MARKER_STATES and
 *  PICKER_COLOR_VALUES together so it holds. */
const MARKER_CELLS = MARKER_STATES;

/** Number of grid rows: the removal row + 20 / 4 = 5 color rows. */
const GRID_ROWS = 1 + Math.ceil(PICKER_COLOR_VALUES.length / COLOR_COLS); // 6

/** The flair row index: one row below the color grid, cells at cols 1–4. The
 *  marker column does NOT extend into it — ArrowLeft from its first cell is a
 *  no-op. */
const FLAIR_ROW = GRID_ROWS;

/** Keyboard focus position on the conceptual grid. row 0 = removal row
 *  (∅ | Clear | ✕), 1–5 = color rows, FLAIR_ROW = flair row; col 0 = marker
 *  column, 1–4 = color columns. On row 0 the Clear button spans cols 1–3 as a
 *  SINGLE focus target canonicalized to col 1; the ✕ cell sits at col 4. */
type GridPos = { row: number; col: number };

/** Color-array index for a grid position (rows 1–5, cols 1–4). */
function colorIndexAt(row: number, col: number): number {
  return (row - 1) * COLOR_COLS + (col - 1);
}

/** Last valid color column in a color row. 20 colors fill the 5×4 grid
 *  exactly, but the clamp is kept generic so a future vocabulary change
 *  degrades safely. */
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
  selectedFlair,
  onSelectFlair,
}: SwatchPopoverProps) {
  const { theme } = useTheme();
  const rowTints = useMemo(() => computeRowTints(theme.palette), [theme.palette]);
  const rowBorders = useMemo(
    () => computeRowBorders(theme.palette, theme.category),
    [theme.palette, theme.category],
  );

  const showMarkers = !!onSelectMarker;
  const showFlair = !!onSelectFlair;

  // Normalize the selection to its canonical display value so a legacy-stored
  // value ("1+3") highlights its family swatch and a dark-stored value
  // highlights the DARK swatch (not its normal sibling).
  const parsedSelected = parseColorValue(selectedColor);
  const selectedValue = parsedSelected ? formatColorValue(parsedSelected) : undefined;

  // Preview color for the marker/flair cells. A swatch pick updates this
  // local override so the previews repaint immediately regardless of whether
  // (or how fast) the caller echoes the selection back through props — the
  // popover stays open on pick, and the preview must not lag the click.
  // `undefined` = no override; `null` = cleared (gray sentinel).
  const [previewOverride, setPreviewOverride] = useState<string | null | undefined>(undefined);
  const previewValue = previewOverride === undefined ? selectedValue : previewOverride ?? undefined;
  const previewTint =
    (previewValue != null ? rowTints.get(previewValue) : undefined) ??
    rowTints.get(UNCOLORED_SELECTED_KEY);
  const previewStripeColor =
    (previewValue != null ? rowBorders.get(previewValue) : undefined) ??
    rowBorders.get(UNCOLORED_SELECTED_KEY) ??
    theme.palette.foreground;

  // The write seam: legacy mapping per the onSelect prop doc, plus the
  // immediate preview repaint (local override above).
  const emit = useCallback(
    (value: string | null) => {
      setPreviewOverride(value);
      onSelect(familyToLegacy(value));
    },
    [onSelect],
  );

  const currentMarker = selectedMarker ?? "";
  const currentFlair = selectedFlair ?? "";

  // Initial focus FOLLOWS SELECTION: the selected swatch, or the Clear cell
  // when uncolored — never an arbitrary swatch, whose focus ring would read
  // as a phantom selection.
  const [focus, setFocus] = useState<GridPos>(() => {
    const idx = selectedValue != null ? PICKER_COLOR_VALUES.indexOf(selectedValue) : -1;
    if (idx < 0) return { row: 0, col: 1 };
    return { row: Math.floor(idx / COLOR_COLS) + 1, col: (idx % COLOR_COLS) + 1 };
  });
  // The focus ring renders only after the first arrow key: the listbox
  // autofocuses on mount, so an always-on ring would show mouse users a
  // phantom highlight.
  const [keyboardActive, setKeyboardActive] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Activate the cell at a grid position (Enter/Space).
  const activate = useCallback(
    (pos: GridPos) => {
      if (pos.row === FLAIR_ROW) {
        const flair = FLAIR_STATES[pos.col - 1];
        if (onSelectFlair && flair !== undefined) onSelectFlair(flair);
      } else if (pos.col === 0) {
        // The undefined check guards against the 1:1 pairing drifting
        // (GRID_ROWS outgrowing MARKER_CELLS) — never emit undefined.
        const marker = MARKER_CELLS[pos.row];
        if (onSelectMarker && marker !== undefined) onSelectMarker(marker);
      } else if (pos.row === 0) {
        if (pos.col === COLOR_COLS) onClose(); // ✕ — the explicit dismiss
        else emit(null); // Clear color
      } else {
        const idx = colorIndexAt(pos.row, pos.col);
        if (idx >= 0 && idx < PICKER_COLOR_VALUES.length) emit(PICKER_COLOR_VALUES[idx]);
      }
    },
    [emit, showMarkers, onSelectMarker, onSelectFlair, onClose],
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

  // Autofocus the listbox on mount — the `Window: Label` palette action is
  // the only keyboard path to the marker section, and arrow keys are dead
  // until the listbox has focus.
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

  // Arrow-key movement: ArrowLeft/Right cross the hairline (marker ↔ color),
  // ArrowUp/Down move within a column; edge moves clamp to the nearest valid
  // cell.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key.startsWith("Arrow")) setKeyboardActive(true);
      if (e.key === "ArrowRight") {
        e.preventDefault();
        setFocus((f) => {
          if (f.col === 0) return { row: f.row, col: 1 }; // cross the hairline
          if (f.row === 0) return { row: 0, col: COLOR_COLS }; // Clear → ✕ (Clear spans cols 1–3)
          if (f.row === FLAIR_ROW) return { row: f.row, col: Math.min(f.col + 1, FLAIR_STATES.length) };
          return { row: f.row, col: Math.min(f.col + 1, maxColorCol(f.row)) };
        });
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setFocus((f) => {
          if (f.col === 0) return f; // already at the left edge
          if (f.row === 0 && f.col === COLOR_COLS) return { row: 0, col: 1 }; // ✕ → Clear
          // Cross the hairline — but the marker column does not extend into
          // the flair row, so ArrowLeft from the flair row's first cell clamps.
          if (f.col === 1) return showMarkers && f.row < GRID_ROWS ? { row: f.row, col: 0 } : f;
          return { row: f.row, col: f.col - 1 };
        });
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocus((f) => {
          const lastRow = showFlair ? FLAIR_ROW : GRID_ROWS - 1;
          if (f.row >= lastRow) return f; // bottom row
          const row = f.row + 1;
          // Into the flair row: the marker column has no cell there, so col 0
          // lands on the row's first cell (∅, col 1).
          if (row === FLAIR_ROW) return { row, col: f.col === 0 ? 1 : f.col };
          if (f.col === 0) return { row, col: 0 }; // within the marker column
          return { row, col: Math.min(f.col, maxColorCol(row)) };
        });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocus((f) => {
          if (f.row === 0) return f; // top row
          const row = f.row - 1;
          if (f.col === 0) return { row, col: 0 }; // within the marker column
          // Into the removal row: cols 1–3 land on Clear (single spanning
          // target, canonical col 1); col 4 lands on the ✕ close cell.
          if (row === 0) return { row: 0, col: f.col === COLOR_COLS ? COLOR_COLS : 1 };
          return { row, col: f.col };
        });
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        activate(focus);
      }
    },
    [focus, activate, showMarkers, showFlair],
  );

  const focusOnClear = keyboardActive && focus.row === 0 && focus.col >= 1 && focus.col < COLOR_COLS;
  const focusOnClose = keyboardActive && focus.row === 0 && focus.col === COLOR_COLS;

  return (
    // TipGroup: the marker cells are a warm-tip cluster — sweeping down the
    // tiny 18px cells names each marker instantly.
    <TipGroup>
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
        {/* Marker column (col 0) + vertical hairline. Each 18px cell + 3px gap
            row-aligns 1:1 with the color grid beside it. Non-∅ cells are LIVE
            ROW PREVIEWS of the currently selected color: tint.base background
            (gray sentinel when uncolored), guarded-color stripe, and the
            paired row texture. */}
        {showMarkers && (
          <>
            <div className="flex flex-col gap-[3px]">
              {MARKER_CELLS.map((state, row) => {
                const isSelected = currentMarker === state;
                const isFocused = keyboardActive && focus.col === 0 && focus.row === row;
                const isPreview = state !== "";
                const stripe = markerStripeStyle(state, previewStripeColor);
                return (
                  <Tip key={state || "none"} label={state || "none"}>
                  <button
                    role="option"
                    aria-selected={isSelected}
                    aria-label={`Marker ${state || "none"}`}
                    data-marker-value={state}
                    onClick={() => onSelectMarker?.(state)}
                    className={`w-[18px] h-[18px] overflow-hidden transition-all relative ${
                      isPreview ? "" : "bg-bg-inset "
                    }${isFocused ? "ring-1 ring-text-secondary" : ""} ${
                      isSelected ? "ring-1 ring-text-primary" : ""
                    }`}
                    style={
                      isPreview
                        ? ({
                            backgroundColor: previewTint?.base,
                            "--rk-marker-color": previewStripeColor,
                          } as React.CSSProperties)
                        : undefined
                    }
                  >
                    {/* Paired row texture — the row's RESTING look: the dashed
                        rain animates (always-on on real rows) but never the
                        crawl (selected-state motion), even when double is
                        selected. The thick cell drops the hazard's left-wedge
                        mask — masked at 18px the weave is invisible under the
                        6px stripe. */}
                    {state === "double" && (
                      <span aria-hidden="true" className="rk-scanlines absolute inset-0 pointer-events-none" />
                    )}
                    {state === "dashed" && (
                      <span aria-hidden="true" className="rk-dash-rain absolute inset-0 pointer-events-none" />
                    )}
                    {state === "thick" && (
                      <span aria-hidden="true" className="rk-hazard rk-hazard-preview absolute inset-0 pointer-events-none" />
                    )}
                    {/* Stripe inset 2px so the marker doesn't kiss the edge. */}
                    {stripe && (
                      <span className="absolute inset-y-0 right-0" style={{ left: 2, ...stripe }} />
                    )}
                    {state === "" && (
                      <span className="absolute inset-0 flex items-center justify-center text-text-secondary" style={{ fontSize: 10, lineHeight: 1 }}>
                        &#x2205;
                      </span>
                    )}
                  </button>
                  </Tip>
                );
              })}
            </div>
            <div className="w-px bg-border mx-1.5 self-stretch" aria-hidden="true" />
          </>
        )}
        {/* Color section (cols 1–4): the removal row (Clear + ✕), then the 20
            family/shade swatches 4-wide in PAIRED order. */}
        <div className="grid grid-cols-4 gap-[3px]">
          <button
            role="option"
            aria-selected={selectedValue == null}
            onClick={() => emit(null)}
            className={`col-span-3 h-[18px] text-[10px] text-text-secondary hover:text-text-primary transition-colors flex items-center justify-center ${
              focusOnClear ? "ring-1 ring-text-secondary" : ""
            } ${selectedValue == null ? "ring-1 ring-text-primary" : ""}`}
          >
            Clear
          </button>
          {/* ✕ — the explicit dismiss. role=option (never aria-selected) so
              the listbox holds only ARIA-valid children. */}
          <button
            role="option"
            aria-selected={false}
            aria-label="Close picker"
            onClick={onClose}
            className={`w-[18px] h-[18px] text-[10px] text-text-secondary hover:text-text-primary transition-colors flex items-center justify-center ${
              focusOnClose ? "ring-1 ring-text-secondary" : ""
            }`}
          >
            &#x2715;
          </button>
          {PICKER_COLOR_VALUES.map((value, i) => {
            const tint = rowTints.get(value);
            const fallback = colorValueToHex(value, theme.palette) ?? theme.palette.foreground;
            // One solid fill (the value's selected-tint blend); the ring + ✓
            // keep the picked swatch unambiguous between adjacent same-family
            // shades.
            const fill = tint?.selected ?? fallback;
            const isSelected = selectedValue === value;
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
                className={`w-[18px] h-[18px] overflow-hidden transition-all flex items-center justify-center ${
                  isFocused ? "ring-1 ring-text-secondary" : ""
                } ${isSelected ? "ring-1 ring-text-primary" : ""}`}
                style={{ backgroundColor: fill }}
              >
                {isSelected && (
                  <span style={{ color: theme.palette.foreground, fontWeight: 700, fontSize: 7, lineHeight: 1 }}>
                    &#x2713;
                  </span>
                )}
              </button>
            );
          })}
          {/* Flair row: live row previews of the selected color, each carrying
              its always-on rk-flair-* overlay. */}
          {showFlair && (
            <>
              <div className="col-span-4 h-px bg-border self-center" aria-hidden="true" />
              {FLAIR_STATES.map((state, i) => {
                const isSelected = currentFlair === state;
                const isFocused = keyboardActive && focus.row === FLAIR_ROW && focus.col === i + 1;
                const isPreview = state !== "";
                return (
                  <Tip key={state || "none"} label={state || "none"}>
                  <button
                    role="option"
                    aria-selected={isSelected}
                    aria-label={`Flair ${state || "none"}`}
                    data-flair-value={state}
                    onClick={() => onSelectFlair?.(state)}
                    className={`w-[18px] h-[18px] overflow-hidden transition-all relative ${
                      isPreview ? "" : "bg-bg-inset "
                    }${isFocused ? "ring-1 ring-text-secondary" : ""} ${
                      isSelected ? "ring-1 ring-text-primary" : ""
                    }`}
                    style={
                      isPreview
                        ? { backgroundColor: previewTint?.base }
                        : undefined
                    }
                  >
                    {isPreview && (
                      <span aria-hidden="true" className={`rk-flair-${state} absolute inset-0 pointer-events-none`} />
                    )}
                    {state === "" && (
                      <span className="absolute inset-0 flex items-center justify-center text-text-secondary" style={{ fontSize: 10, lineHeight: 1 }}>
                        &#x2205;
                      </span>
                    )}
                  </button>
                  </Tip>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
    </TipGroup>
  );
}
