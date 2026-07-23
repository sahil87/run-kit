import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useTheme } from "@/contexts/theme-context";
import { Tip, TipGroup } from "@/components/tip";
import {
  PICKER_COLOR_VALUES,
  MARKER_STATES,
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
  /** Called with the value to STORE. The popover maps a picked NORMAL-shade
   *  family name to its legacy numeric/blend descriptor (familyToLegacy)
   *  before invoking this, so pre-existing stored color values stay in the
   *  legacy vocabulary (zero migration). DARK-shade picks ("orange-dark") have
   *  no legacy form and pass through verbatim — the backend validators accept
   *  the family-name vocabulary alongside the numeric forms. `null` clears the
   *  color. This is the single write seam every color-picking surface
   *  (window/session/server rows + the palette "Set Color" actions) funnels
   *  through. */
  onSelect: (color: string | null) => void;
  /** Dismissal model (260723): selection NEVER dismisses — the picker stays
   *  open so color + marker combos can be toggled and previewed live against
   *  the row. It closes only via the explicit ✕ cell (row 0, col 4), a click
   *  outside, or Escape. Callers therefore must NOT close in their
   *  onSelect/onSelectMarker handlers — closing is this component's contract,
   *  funneled through onClose. */
  onClose: () => void;
  /** ── Combined-label extension ── When `onSelectMarker` is supplied, the
   *  popover renders the side-by-side Label picker: a marker column (∅ /
   *  dotted / dashed / solid / double / thick) LEFT of a vertical hairline,
   *  beside the color grid. Each non-∅ marker cell is a LIVE ROW PREVIEW — a
   *  miniature window row rendered for the currently selected color:
   *  background = that value's `tint.base` (gray sentinel when uncolored),
   *  stripe in the guarded border color with a 2px left inset (so the marker
   *  does not kiss the cell edge and the cell reads as a mini row), plus the
   *  paired row texture (static hazard wedge on thick, static scanline wash on
   *  double). Picking a different swatch repaints the marker column
   *  immediately. PREVIEW CELLS NEVER ANIMATE — motion belongs to real rows
   *  only; the double cell never gets the scanline crawl, even when selected.
   *  Selection calls `onSelectMarker` DIRECTLY (no cycling — any state is one
   *  click) with `""` clearing the marker. Keyboard nav crosses the hairline
   *  (ArrowLeft/Right). When `onSelectMarker` is ABSENT the component renders
   *  the pure color grid (session/server rows + the palette color actions) —
   *  same square style, no marker column, no hairline. */
  selectedMarker?: string;
  onSelectMarker?: (marker: string) => void;
};

/** Colors per row in the color grid. The layout is a conceptual 5-column grid:
 *  marker column (col 0, when shown) + 4 color columns (cols 1–4), 6 rows
 *  (removal row + 5 color rows). The 4-wide layout renders each family's two
 *  shades ADJACENT (row 1: red, red-dark, orange, orange-dark; …) because
 *  PICKER_COLOR_VALUES is in paired order. */
const COLOR_COLS = 4;

/** The marker-cell order shown in the picker column: none / dotted / dashed /
 *  solid / double / thick. Mirrors MARKER_STATES, with `∅` in row 0 (the
 *  removal row) and the five non-empty states beside the five color rows.
 *
 *  DELIBERATE 1:1 PAIRING (supersedes the former "load-bearing coincidence"):
 *  the marker column and the color grid are sized to pair row-for-row —
 *  6 marker cells ↔ 6 grid rows (Clear + 20 colors laid out 4-wide). The
 *  invariant GRID_ROWS === MARKER_CELLS.length is part of the design (and
 *  asserted in swatch-popover.test.tsx): extend MARKER_STATES and
 *  PICKER_COLOR_VALUES together so it holds. */
const MARKER_CELLS = MARKER_STATES;

/** Number of grid rows: the removal row + 20 / 4 = 5 color rows. */
const GRID_ROWS = 1 + Math.ceil(PICKER_COLOR_VALUES.length / COLOR_COLS); // 6

/** Keyboard focus position on the conceptual 5-column grid.
 *  - `row`: 0 = removal row (∅ | Clear | ✕), 1–5 = color rows.
 *  - `col`: 0 = marker column (only valid when markers shown); 1–4 = color
 *    columns. On row 0 the `Clear` button spans cols 1–3 as a SINGLE focus
 *    target canonicalized to col 1, and the ✕ close cell sits at col 4. */
type GridPos = { row: number; col: number };

/** Color-array index for a grid position (rows 1–5, cols 1–4). */
function colorIndexAt(row: number, col: number): number {
  return (row - 1) * COLOR_COLS + (col - 1);
}

/** Last valid color column in a color row. With 20 colors filling 5×4 exactly
 *  there are no dead cells any more — every color row's last column is 4 — but
 *  the clamp is kept generic so a future vocabulary change degrades safely. */
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
  const rowBorders = useMemo(
    () => computeRowBorders(theme.palette, theme.category),
    [theme.palette, theme.category],
  );

  // The marker section is rendered only when a marker write callback is
  // present. Color-only callers omit it and get the pure color grid (same
  // square style, no marker column).
  const showMarkers = !!onSelectMarker;

  // Normalize the incoming selection to its canonical display value
  // ("orange" / "orange-dark") so a legacy-stored value ("1+3") highlights the
  // same swatch as its family, and a dark-stored value highlights the DARK
  // swatch (not its normal sibling). Undefined when uncolored or unrecognized.
  const parsedSelected = parseColorValue(selectedColor);
  const selectedValue = parsedSelected ? formatColorValue(parsedSelected) : undefined;

  // Live preview color for the marker row previews. Derived from the selection
  // prop, but a swatch pick ALSO updates this local override so the marker
  // column repaints immediately regardless of whether (or how fast) the caller
  // echoes the selection back through props — the popover stays open on pick,
  // and the preview must not lag the click. `undefined` = no override;
  // `null` = cleared (gray sentinel).
  const [previewOverride, setPreviewOverride] = useState<string | null | undefined>(undefined);
  const previewValue = previewOverride === undefined ? selectedValue : previewOverride ?? undefined;
  const previewTint =
    (previewValue != null ? rowTints.get(previewValue) : undefined) ??
    rowTints.get(UNCOLORED_SELECTED_KEY);
  const previewStripeColor =
    (previewValue != null ? rowBorders.get(previewValue) : undefined) ??
    rowBorders.get(UNCOLORED_SELECTED_KEY) ??
    theme.palette.foreground;

  // The single write seam: map a picked NORMAL-shade family name ("orange") to
  // its legacy descriptor ("1+3") before handing it to the caller's onSelect,
  // so pre-existing stored color values stay in the legacy vocabulary. Dark
  // picks ("orange-dark") and `null` (Clear) pass through untouched. Also
  // repaints the marker row previews (local override above).
  const emit = useCallback(
    (value: string | null) => {
      setPreviewOverride(value);
      onSelect(familyToLegacy(value));
    },
    [onSelect],
  );

  // Normalize the current marker to one of the known cells ("" when unset).
  const currentMarker = selectedMarker ?? "";

  // Initial focus FOLLOWS SELECTION: the selected color swatch, or the Clear
  // color cell (row 0 — already aria-selected in that state) when uncolored.
  // Never an arbitrary swatch — a focus ring on an unselected color reads as a
  // phantom selection. The marker column is reached via ArrowLeft.
  const [focus, setFocus] = useState<GridPos>(() => {
    const idx = selectedValue != null ? PICKER_COLOR_VALUES.indexOf(selectedValue) : -1;
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
  // to onSelectMarker; row 0's color side is Clear (cols 1–3) and the ✕ close
  // cell (col 4); color cells map to onSelect.
  const activate = useCallback(
    (pos: GridPos) => {
      if (pos.col === 0) {
        // Marker column: MARKER_CELLS[row] — ∅ in row 0, the five non-empty
        // states beside the five color rows (the deliberate 1:1 pairing
        // above). The explicit undefined check guards against that pairing
        // drifting (GRID_ROWS outgrowing MARKER_CELLS) — never emit undefined.
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
    [emit, showMarkers, onSelectMarker, onClose],
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
  // within a column. Moves off a grid edge clamp to the nearest valid cell
  // (no-op at hard edges) — 20 colors fill the 5×4 grid exactly, so there are
  // no dead cells, but the clamp stays for safety.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key.startsWith("Arrow")) setKeyboardActive(true);
      if (e.key === "ArrowRight") {
        e.preventDefault();
        setFocus((f) => {
          if (f.col === 0) return { row: f.row, col: 1 }; // cross the hairline
          if (f.row === 0) return { row: 0, col: COLOR_COLS }; // Clear → ✕ (Clear spans cols 1–3)
          return { row: f.row, col: Math.min(f.col + 1, maxColorCol(f.row)) };
        });
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setFocus((f) => {
          if (f.col === 0) return f; // already at the left edge
          if (f.row === 0 && f.col === COLOR_COLS) return { row: 0, col: 1 }; // ✕ → Clear
          if (f.col === 1) return showMarkers ? { row: f.row, col: 0 } : f; // cross the hairline
          return { row: f.row, col: f.col - 1 };
        });
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocus((f) => {
          if (f.row >= GRID_ROWS - 1) return f; // bottom row
          const row = f.row + 1;
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
    [focus, activate, showMarkers],
  );

  const focusOnClear = keyboardActive && focus.row === 0 && focus.col >= 1 && focus.col < COLOR_COLS;
  const focusOnClose = keyboardActive && focus.row === 0 && focus.col === COLOR_COLS;

  return (
    // TipGroup: the marker cells are a warm-tip cluster (260722-73al) —
    // sweeping down the tiny 18px cells names each marker instantly.
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
        {/* Marker column (col 0) + vertical hairline — Label-picker callers only.
            Each 18px cell + 3px gap row-aligns 1:1 with the color grid beside it:
            ∅ beside Clear color (the removal row), dotted/dashed/solid/double/
            thick beside the five color rows. Non-∅ cells are LIVE ROW PREVIEWS
            of the currently selected color: tint.base background (gray sentinel
            when uncolored), guarded-color stripe with a 2px left inset, and the
            paired row texture (static scanline wash on double, static hazard
            wedge on thick). NEVER animated — no rk-scanlines-crawl here. */}
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
                    {/* Paired row texture — static only (preview cells never
                        animate: no crawl class, even when double is selected). */}
                    {state === "double" && (
                      <span aria-hidden="true" className="rk-scanlines absolute inset-0 pointer-events-none" />
                    )}
                    {state === "thick" && (
                      <span aria-hidden="true" className="rk-hazard absolute inset-0 pointer-events-none" />
                    )}
                    {/* Mini-row stripe: guarded color, 2px inset off the cell's
                        left edge so the marker doesn't kiss the boundary. */}
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
        {/* Color section (cols 1–4): the removal row — Clear (cols 1–3) + the
            ✕ close cell (col 4, the explicit dismiss; selection never closes) —
            then the 20 family/shade swatches laid out 4-wide in PAIRED order —
            each family's normal|dark shades adjacent (5 full rows). */}
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
          {/* ✕ — the explicit dismiss. NOT role=option (it selects nothing);
              Escape and outside-click remain the other two close paths. */}
          <button
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
            // Uniform SOLID square: one fill — the value's selected-tint blend
            // (no more split base/selected halves). The bright selection ring +
            // ✓ glyph keep the picked swatch unambiguous between adjacent
            // same-family shades.
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
        </div>
      </div>
    </div>
    </TipGroup>
  );
}
