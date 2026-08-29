// ── Marker pad (3×3 mode × stage grid) ───────────────────────────────────────
// The spring-loaded marker pad: one component, two chromes — `popover` (the
// row's press target, anchored at the well's right edge, clamped inside the
// sidebar by the ROW) and `inline` (the flyout card's Marker action row).
// The grid is 3 mode rows × (one ∅ cell spanning the three rows + 3 stage
// cells); each stage cell is a mini well (12% wash + 30% edge + the shared
// markerFillStyle/MarkerChevrons fill). The pad owns the grid math
// (selectCell), the rendering, and the keyboard model; the GESTURES live with
// the consumers (window-row.tsx owns the press-drag-release strip, the card
// owns plain click mode).

import { useEffect, useRef, useState } from "react";
import {
  MARKER_MODES,
  MARKER_STAGES,
  MARKER_STAGE_GLOSS,
  MARKER_STAGE_WIDTHS,
  markerFillStyle,
  MarkerChevrons,
  type Marker,
} from "@/themes";

/** The well wash / edge alphas — one definition shared by the row well and
 *  every pad cell so previews and committed markers cannot drift visually. */
export const MARKER_WELL_BACKGROUND =
  "color-mix(in srgb, var(--color-marker-ink) 12%, transparent)";
export const MARKER_WELL_EDGE =
  "1px solid color-mix(in srgb, var(--color-marker-ink) 30%, transparent)";

/**
 * Relative 2D select: the highlighted cell follows the pointer's DISPLACEMENT
 * from the press point, not its position (the pad clamps inside the sidebar
 * box, so it can never sit the current cell under a pointer that is 0–22px
 * from the sidebar's left edge — one pitch right = +1 stage holds regardless
 * of where the pad lands). Columns: left past stage 1 = ∅; rows: down = next
 * mode. Clamped to the grid edges — over-drag sticks to the edge cell. On an
 * unmarked row the reference row for the first vertical step is `manual` (the
 * grid's first mode).
 */
export function selectCell(current: Marker | null, dx: number, dy: number, pitch: number): Marker | null {
  const cols = Math.round(dx / pitch);
  const rows = Math.round(dy / pitch);
  // Columns: the ∅ cell sits LEFT of stage 1, so an unmarked row's reference
  // column is 0 (one pitch right enters at stage 1; left past stage 1 = ∅).
  // A purely VERTICAL move off the ∅ column re-enters the grid at stage 1 —
  // the mode axis must not strand the highlight on a column it already left.
  let stageIndex = (current ? current.stage : 0) + cols;
  if (stageIndex < 1) {
    if (current === null && rows !== 0) stageIndex = 1;
    else return null;
  }
  const clampedStage = MARKER_STAGES[Math.min(stageIndex, MARKER_STAGES.length) - 1];
  // Rows: a marked row moves relative to its own mode. The ∅ cell spans all
  // three mode rows, so an unmarked row has no row of its own — the FIRST
  // vertical pitch (in either direction) enters the grid at `manual`, the
  // grid's first mode, and only further downward pitches advance the mode.
  const modeIndex = current ? MARKER_MODES.indexOf(current.mode) + rows : Math.max(rows - 1, 0);
  const clampedMode = MARKER_MODES[Math.min(Math.max(modeIndex, 0), MARKER_MODES.length - 1)];
  return { mode: clampedMode, stage: clampedStage };
}

/** Step the stage on wheel (`deltaY > 0` = next) — clamped, mode unchanged. */
export function stepStage(marker: Marker, direction: 1 | -1): Marker {
  const next = MARKER_STAGES[Math.min(Math.max(marker.stage + direction, 1), MARKER_STAGES.length) - 1];
  return { ...marker, stage: next };
}

type MarkerPadProps = {
  /** The committed marker — the pad opens with this cell highlighted. */
  value: Marker | null;
  /** Live preview: called whenever the highlighted cell changes (hover, drag,
   *  arrows) — the row repaints from it until commit/cancel. */
  onPreview: (marker: Marker | null) => void;
  /** Commit the highlighted cell. `null` = ∅ (clear). */
  onCommit: (marker: Marker | null) => void;
  /** Cancel WITHOUT committing (Escape / outside pointerdown). The pad has
   *  already reverted its own highlight to `value` by the time this fires; the
   *  handler owns whatever closing the chrome needs (the popover closes; the
   *  inline card pad has nothing of its own to close). */
  onCancel: () => void;
  /** `popover`: the row strip's chrome (positioned by the caller).
   *  `inline`: chromeless, embedded in the flyout card's Marker row. */
  mode: "popover" | "inline";
  /** Cell edge in px — available-width-aware in popover mode, 28 in the
   *  inline card. Also the gesture pitch. */
  cellPx: number;
  /** Popover border-box width after fitting it to the sidebar. */
  popoverWidth?: number;
  /** Popover label-track width; shrinks before cells drop below their floor. */
  labelPx?: number;
  /** Cell selection override (the strip's drag computes cells itself via
   *  selectCell and pushes them in here); when omitted the pad owns its
   *  highlight from `value`. Changing this prop re-highlights the pad. */
  highlight?: Marker | null;
};

/** True when two cells are the same grid position (null = the ∅ column). */
export function sameCell(a: Marker | null, b: Marker | null): boolean {
  if (a === null || b === null) return a === b;
  return a.mode === b.mode && a.stage === b.stage;
}

/** The pad's header line: `<mode> · <stage gloss>`, or `∅` on the clear cell. */
export function padHeader(marker: Marker | null): string {
  return marker === null ? "∅" : `${marker.mode} · ${MARKER_STAGE_GLOSS[marker.stage]}`;
}

/** Popover-mode cell edge in pixels; inline card cells are 28. The strip's
 *  relative-drag pitch follows the cell-size contract. */
const GAP_PX = 3;
export const MARKER_PAD_POPOVER_CELL_PX = 26;
export const MARKER_PAD_INLINE_CELL_PX = 28;
export const MARKER_PAD_POPOVER_INSET_PX = 8;
export const MARKER_PAD_POPOVER_PREFERRED_WIDTH_PX = 180;
export const MARKER_PAD_POPOVER_MIN_CELL_PX = 22;
export const MARKER_PAD_LABEL_PREFERRED_WIDTH_PX = 54;

// Border plus 10px p-1 chrome and four 12px inter-track gaps. Keeping
// this named makes the width equation match the rendered flex tracks.
const MARKER_PAD_POPOVER_NON_TRACK_PX = 22;

export type MarkerPadPopoverLayout = {
  width: number;
  cellPx: number;
  labelPx: number;
};

/** Fit the popover to the available sidebar while preserving the 26px cells
 *  at normal widths. The supported 160px minimum yields a 152px pad, 22px
 *  cells, and a 42px truncating label track. */
export function markerPadPopoverLayout(sidebarWidth: number): MarkerPadPopoverLayout {
  const resolvedSidebarWidth =
    Number.isFinite(sidebarWidth) && sidebarWidth > 0
      ? sidebarWidth
      : MARKER_PAD_POPOVER_PREFERRED_WIDTH_PX + MARKER_PAD_POPOVER_INSET_PX;
  const width = Math.min(
    MARKER_PAD_POPOVER_PREFERRED_WIDTH_PX,
    Math.max(0, resolvedSidebarWidth - MARKER_PAD_POPOVER_INSET_PX),
  );
  const preferredCellPx =
    (width - MARKER_PAD_POPOVER_NON_TRACK_PX - MARKER_PAD_LABEL_PREFERRED_WIDTH_PX) / 4;
  const cellPx = Math.min(
    MARKER_PAD_POPOVER_CELL_PX,
    Math.max(MARKER_PAD_POPOVER_MIN_CELL_PX, preferredCellPx),
  );
  const labelPx = Math.max(0, width - MARKER_PAD_POPOVER_NON_TRACK_PX - cellPx * 4);
  return { width, cellPx, labelPx };
}

type MarkerPadRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/** Place a fitted pad relative to its row, centered vertically when possible
 *  and clamped to every edge of the sidebar. */
export function placeMarkerPad(
  sidebar: MarkerPadRect,
  row: MarkerPadRect,
  pad: { width: number; height: number },
  anchorLeft: number,
): { left: number; top: number } {
  const sidebarRight = sidebar.left + sidebar.width;
  const sidebarBottom = sidebar.top + sidebar.height;
  const idealTop = row.top + (row.height - pad.height) / 2;
  const clampedTop = Math.min(
    Math.max(idealTop, sidebar.top),
    Math.max(sidebarBottom - pad.height, sidebar.top),
  );
  const minLeft = sidebar.left - row.left;
  const maxLeft = Math.max(sidebarRight - row.left - pad.width, minLeft);
  const clampedLeft = Math.min(Math.max(anchorLeft, minLeft), maxLeft);
  return { left: clampedLeft, top: clampedTop - row.top };
}

/** One mini-well stage cell: 12% wash + 30% right edge + the mode's fill,
 *  all in the marker ink. */
function PadCell({
  marker,
  cellPx,
  highlighted,
  onHover,
  onPick,
  cellRef,
}: {
  marker: Marker;
  cellPx: number;
  highlighted: boolean;
  onHover: () => void;
  onPick: () => void;
  cellRef: (el: HTMLButtonElement | null) => void;
}) {
  const fill = markerFillStyle(marker);
  return (
    <button
      ref={cellRef}
      type="button"
      role="option"
      aria-selected={highlighted}
      aria-label={`Marker ${marker.mode}:${marker.stage}`}
      data-testid={`marker-pad-cell-${marker.mode}-${marker.stage}`}
      onMouseEnter={onHover}
      onClick={(e) => {
        e.stopPropagation();
        onPick();
      }}
      className={`relative shrink-0 overflow-hidden cursor-pointer ${
        highlighted ? "ring-1 ring-text-primary" : ""
      }`}
      style={{
        width: cellPx,
        height: cellPx,
        background: MARKER_WELL_BACKGROUND,
        borderRight: MARKER_WELL_EDGE,
      }}
    >
      {fill && <span aria-hidden className="absolute inset-y-0 left-0" style={fill} />}
      {marker.mode === "auto" && (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 flex items-center"
          style={{ width: MARKER_STAGE_WIDTHS[3] }}
        >
          <MarkerChevrons count={marker.stage} />
        </span>
      )}
    </button>
  );
}

/** The marker pad grid. See the module header for the two-chrome split. */
export function MarkerPad({
  value,
  onPreview,
  onCommit,
  onCancel,
  mode,
  cellPx,
  popoverWidth,
  labelPx = MARKER_PAD_LABEL_PREFERRED_WIDTH_PX,
  highlight,
}: MarkerPadProps) {
  const [cell, setCell] = useState<Marker | null>(highlight === undefined ? value : highlight);
  // The strip's drag streams cells in through the `highlight` prop; adopt each
  // one. undefined = the pad owns its highlight (click/keyboard path).
  useEffect(() => {
    if (highlight !== undefined) setCell(highlight);
  }, [highlight]);

  const pick = (next: Marker | null) => {
    setCell(next);
    onPreview(next);
  };
  const commit = (next: Marker | null) => {
    pick(next);
    onCommit(next);
  };

  const cellRefs = useRef(new Map<string, HTMLElement>());

  // Keyboard model (the palette/click-menu path): a popover focuses the
  // current cell on mount. The inline card pad does not steal focus merely
  // because a hover card appeared; it becomes keyboard-active when a user
  // focuses one of its cells normally.
  const keyFor = (m: Marker | null): string => (m === null ? "clear" : `${m.mode}:${m.stage}`);
  useEffect(() => {
    if (mode === "popover") cellRefs.current.get(keyFor(value))?.focus();
    // Mount-only: focus the OPENING cell, not every highlight move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const moveCell = (next: Marker | null) => {
    pick(next);
    cellRefs.current.get(keyFor(next))?.focus();
  };
  const handleKeyDown = (e: React.KeyboardEvent) => {
    const modeIndex = cell ? MARKER_MODES.indexOf(cell.mode) : 0;
    const stage = cell ? cell.stage : 1;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      if (cell === null) moveCell({ mode: MARKER_MODES[modeIndex], stage: 1 });
      else if (stage < 3) moveCell(stepStage(cell, 1));
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      if (cell !== null) {
        if (stage <= 1) moveCell(null);
        else moveCell(stepStage(cell, -1));
      }
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const delta = e.key === "ArrowDown" ? 1 : -1;
      const next = Math.min(Math.max(modeIndex + delta, 0), MARKER_MODES.length - 1);
      if (next !== modeIndex) moveCell({ mode: MARKER_MODES[next], stage: cell ? stage : 1 });
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      onCommit(cell);
    } else if (e.key === "Escape") {
      e.preventDefault();
      // Revert the highlight to the committed marker in BOTH chromes — an
      // arrow walk previews cells, so Escape must undo the preview even when
      // nothing closes. The popover then owns the key (it closes itself); the
      // inline pad lets it bubble so the card's own dismissal still fires.
      pick(value);
      if (mode === "popover") e.stopPropagation();
      onCancel();
    }
  };

  return (
    <div
      role="listbox"
      aria-label="Marker pad"
      data-testid="marker-pad"
      onKeyDown={handleKeyDown}
      className={mode === "popover" ? "rk-popup-elev bg-bg-card border border-border z-50 p-1" : ""}
      style={mode === "popover" && popoverWidth !== undefined ? { width: popoverWidth } : undefined}
    >
      {/* Header — names the highlighted cell (`<mode> · <gloss>`, `∅` on clear). */}
      <div
        aria-hidden
        data-testid="marker-pad-header"
        className="text-[9px] tracking-[0.08em] text-text-secondary select-none pb-1"
      >
        {padHeader(cell)}
      </div>
      <div className="flex" style={{ gap: GAP_PX }}>
        <span
          aria-hidden
          className="min-w-0 overflow-hidden text-[9px] text-text-secondary select-none flex flex-col justify-around shrink-0"
          style={{ width: labelPx }}
        >
          {MARKER_MODES.map((m) => (
            <span
              key={m}
              className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap"
              style={{ height: cellPx, lineHeight: `${cellPx}px` }}
            >
              {m}
            </span>
          ))}
        </span>
        {/* ∅ — ONE cell spanning the three mode rows; clears both axes. */}
        <button
          ref={(el) => {
            if (el) cellRefs.current.set("clear", el);
          }}
          type="button"
          role="option"
          aria-selected={cell === null}
          aria-label="Marker clear"
          data-testid="marker-pad-cell-clear"
          onMouseEnter={() => pick(null)}
          onClick={(e) => {
            e.stopPropagation();
            commit(null);
          }}
          className={`relative shrink-0 cursor-pointer ${
            cell === null ? "ring-1 ring-text-primary" : ""
          }`}
          style={{
            width: cellPx,
            height: cellPx * MARKER_MODES.length + GAP_PX * (MARKER_MODES.length - 1),
            background: MARKER_WELL_BACKGROUND,
            borderRight: MARKER_WELL_EDGE,
          }}
        >
          <span aria-hidden className="absolute inset-0 flex items-center justify-center text-text-secondary">
            ∅
          </span>
        </button>
        <div className="flex shrink-0 flex-col" style={{ gap: GAP_PX }}>
          {MARKER_MODES.map((modeName) => (
            <div key={modeName} className="flex" style={{ gap: GAP_PX }}>
              {MARKER_STAGES.map((stage) => {
                const m = { mode: modeName, stage };
                return (
                  <PadCell
                    key={stage}
                    marker={m}
                    cellPx={cellPx}
                    highlighted={sameCell(cell, m)}
                    onHover={() => pick(m)}
                    onPick={() => commit(m)}
                    cellRef={(el) => {
                      if (el) cellRefs.current.set(keyFor(m), el);
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
