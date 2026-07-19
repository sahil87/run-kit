import { useEffect, useState, useRef, useMemo, memo } from "react";
import { isGhostWindow } from "@/contexts/optimistic-context";
import type { ProjectSession } from "@/types";
import type { MergedSession } from "@/contexts/optimistic-context";
import type { BoardSummary } from "@/api/boards";
import { UNCOLORED_SELECTED_KEY, nextMarkerState, type RowTint } from "@/themes";
import { SwatchPopover } from "@/components/swatch-popover";
import { StatusDot } from "@/components/status-dot";
import { PinPopover } from "./pin-popover";
import { PaletteIcon } from "./icons";
import { PinIcon } from "@/components/pin-icon";

type ProjectWindow = ProjectSession["windows"][number];
type GhostWindow = MergedSession["windows"][number];

type WindowRowProps = {
  win: ProjectWindow | GhostWindow;
  session: string;
  isSelected: boolean;
  isDragOver: boolean;
  /** Color value: an owned family name ("orange") or a legacy numeric/blend
   *  descriptor ("4" / "1+3") — the row's hue (label axis). */
  color?: string;
  /** Left-gutter marker state ("" | "dotted" | "solid" | "double") — an
   *  independent label axis from `color`. */
  marker?: string;
  rowTints?: Map<string, RowTint>;
  /** Contrast-adjusted full-saturation guarded color per color value. Used for
   *  SERVER tile edges and — here — the left-gutter marker's family color. */
  rowBorders?: Map<string, string>;
  editingWindow: { session: string; windowId: string } | null;
  // Note: callers may pass an object that also carries a `server` field — the
  // extra property is ignored (only session + windowId are read), and passing
  // the reference straight through keeps this prop stable across renders.
  editingName: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  /** Identity-arg handlers. The row binds its own (server, session, win)
   *  identity when invoking them, so a SINGLE stable reference can be shared by
   *  every row across the whole sidebar — which is what makes React.memo on
   *  WindowRow effective (the handler prop identity does not change per row or
   *  per SSE tick). The internal onClick wrappers the row builds are NOT part
   *  of the memo comparison, so rebuilding them per row-render is free. */
  onSelectWindow: (server: string, session: string, windowId: string) => void;
  onStartEditing: (server: string, session: string, windowId: string, currentName: string) => void;
  onWindowNameChange: (value: string) => void;
  onRenameKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onRenameBlur: () => void;
  onKillClick: (server: string, session: string, windowId: string, ctrl: boolean) => void;
  /** Whether this row is draggable (ghost rows are not). When false the drag
   *  handlers are not wired. */
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent, server: string, session: string, index: number, windowId: string, name: string) => void;
  onDragOver?: (e: React.DragEvent, server: string, session: string, index: number) => void;
  onDrop?: (e: React.DragEvent, server: string, session: string, index: number) => void;
  onDragEnd?: () => void;
  onColorChange?: (server: string, session: string, windowId: string, color: string | null) => void;
  /** Persist a new marker state for this window. The row computes the NEXT state
   *  (nextMarkerState) on a gutter click and passes it here. Omitted on ghost
   *  rows (the gutter is disabled). */
  onMarkerChange?: (server: string, session: string, windowId: string, marker: string | null) => void;
  /** Tmux server name for the pin popover (server-routing contract) AND the
   *  identity bound into the handlers above. When omitted the pin icon is
   *  hidden and handlers bind an empty server — used by tests that render
   *  WindowRow without the boards system wired up. */
  server?: string;
  /** Aggregate pin state — if this window is pinned to ANY board, the icon
   *  renders filled. */
  isPinnedToAny?: boolean;
  /** When true, the row is pinned to the *currently active board* (if any)
   *  and gets a subtle accent highlight in the Sessions tree. Independent of
   *  isPinnedToAny which controls the pin-icon fill. */
  isPinnedToActiveBoard?: boolean;
  /** All known boards (for the pin popover). */
  boards?: BoardSummary[];
  /** True while the board list is still loading — forwarded to the pin popover
   *  so its cold-start prefill isn't triggered by an empty mid-load list. */
  boardsLoading?: boolean;
  /** Predicate: is this window pinned to the given board? Identity-arg form
   *  (board, server, windowId) so a single stable reference (the context's
   *  `pinnedToBoard`) serves every row; the row binds its own (server,
   *  windowId). Used by the pin popover to render checkmarks. */
  isPinnedToBoard?: (board: string, server: string, windowId: string) => boolean;
  /** The single board this window is pinned to (co9z), or undefined if unpinned.
   *  When set, the pin popover offers a "Go to {board}" navigation row so the
   *  pinned-row indicator becomes a path to the owning board. */
  pinnedBoard?: string;
  /** Navigate to a board's route (`/board/{board}`). Stable identity-arg
   *  handler shared by every row (like the other identity-arg handlers). */
  onNavigateToBoard?: (board: string) => void;
  /** Roving-tabindex value: `0` for the single roving-focused tree row, `-1`
   *  for every other row (the roving model lives in `index.tsx`). Defaults to
   *  `-1` so a row rendered without the tree wiring is not a tab stop. Only the
   *  two affected rows change this per arrow keypress, preserving the memo tree. */
  tabIndex?: number;
  /** W3C-APG tree leaf metadata. Window rows are level-2 leaves. `ariaSetSize`
   *  is the count of sibling windows in the session; `ariaPosInSet` the row's
   *  1-based position among them. Omitted ⇒ not announced (e.g. in unit tests
   *  that render a bare row). */
  ariaLevel?: number;
  ariaSetSize?: number;
  ariaPosInSet?: number;
  /** Globally-unique roving-tabindex handle for the tree's keyboard model
   *  (`index.tsx`), exposed as `data-row-key`. Value is `${server}:${windowId}`
   *  (or `${server}:ghost-${optimisticId}`): bare tmux ids (@N) are only unique
   *  within one server and would collide across open server groups, so the
   *  roving cursor + Enter/Space activation key on this namespaced handle.
   *  `data-window-id` stays the bare id for tests/automation/pin lookups. */
  rowKey?: string;
};

function WindowRowInner({
  win,
  session,
  isSelected,
  isDragOver,
  color,
  marker,
  rowTints,
  rowBorders,
  editingWindow,
  editingName,
  inputRef,
  onSelectWindow,
  onStartEditing,
  onWindowNameChange,
  onRenameKeyDown,
  onRenameBlur,
  onKillClick,
  draggable = false,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onColorChange,
  onMarkerChange,
  server,
  isPinnedToAny = false,
  isPinnedToActiveBoard = false,
  boards = [],
  boardsLoading = false,
  isPinnedToBoard,
  pinnedBoard,
  onNavigateToBoard,
  tabIndex = -1,
  ariaLevel,
  ariaSetSize,
  ariaPosInSet,
  rowKey,
}: WindowRowProps) {
  const ghost = isGhostWindow(win);
  const srv = server ?? "";
  // Drag is wired only for non-ghost rows that opted in via `draggable`.
  const dragEnabled = draggable && !ghost;
  const isEditing = editingWindow?.session === session && editingWindow.windowId === win.windowId;
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showPinPopover, setShowPinPopover] = useState(false);
  const colorBtnRef = useRef<HTMLButtonElement>(null);
  const pinBtnRef = useRef<HTMLButtonElement>(null);

  // Listen for the imperative `pin-popover:open` event dispatched by the
  // command palette's "Board: Pin Current Window" action. Only the row whose
  // (server, windowId) matches the event detail opens its popover; other rows
  // ignore the event. Mirrors the `palette:open` document-event pattern used
  // elsewhere — see app.tsx command palette wiring.
  useEffect(() => {
    if (!server) return;
    function handler(e: Event) {
      const detail = (e as CustomEvent<{ server: string; windowId: string }>).detail;
      if (!detail) return;
      if (detail.server === server && detail.windowId === win.windowId) {
        setShowPinPopover(true);
      }
    }
    document.addEventListener("pin-popover:open", handler);
    return () => document.removeEventListener("pin-popover:open", handler);
  }, [server, win.windowId]);

  const tint = useMemo(() => {
    if (color == null || !rowTints) return null;
    return rowTints.get(color) ?? null;
  }, [color, rowTints]);

  // Uncolored rows borrow the gray tint only in the selected state.
  const uncoloredSelectedTint = useMemo(() => {
    if (color != null || !rowTints || !isSelected) return null;
    return rowTints.get(UNCOLORED_SELECTED_KEY) ?? null;
  }, [color, rowTints, isSelected]);

  // The row's guarded family color, used for the left-gutter MARKER (contrast-
  // adjusted full-saturation family hex, baked into rowBorders). Colored rows
  // use their family; uncolored rows use the gray sentinel. The 4px selection
  // border this once fed was removed in the axis split — selection is now tint
  // depth + typography alone (R6/R7).
  const markerColor = useMemo(() => {
    if (!rowBorders) return "var(--color-border)";
    if (color != null) return rowBorders.get(color) ?? "var(--color-border)";
    return rowBorders.get(UNCOLORED_SELECTED_KEY) ?? "var(--color-border)";
  }, [color, rowBorders]);

  // Compute inline style for the button (background tint only — no left border).
  const buttonStyle = useMemo(() => {
    const style: React.CSSProperties = {};
    if (tint) {
      style.backgroundColor = isSelected ? tint.selected : tint.base;
    } else if (uncoloredSelectedTint) {
      style.backgroundColor = uncoloredSelectedTint.selected;
    }
    return Object.keys(style).length > 0 ? style : undefined;
  }, [tint, uncoloredSelectedTint, isSelected]);

  // Build className for the button. The 14px marker gutter (GUTTER_WIDTH) is an
  // absolute z-20 sibling overlaying the left edge, so the button content must
  // start CLEAR of it — otherwise the interactive StatusDot sits under the
  // gutter and gutter hover/click steals the dot's hover-card + row select
  // (must-fix 3). `pl-[18px]` keeps the leading dot + text just past the gutter.
  // When the pin icon is wired up, reserve a few extra px on the right so labels
  // don't run under the icon group.
  const showPinIcon = !ghost && !!server;
  const buttonClass = useMemo(() => {
    const rightPad = showPinIcon ? "pr-[68px]" : "pr-11";
    // Dense rows on fine pointers (24px); touch keeps the 36px target via the
    // `coarse:` variant (context.md § Mobile Responsive Design).
    const base = `w-full text-left flex items-center justify-between gap-2 py-px pl-[18px] ${rightPad} text-xs transition-colors min-h-[24px] coarse:min-h-[36px]`;
    if (isSelected) {
      // Selection = deeper tint (tint.selected / gray sentinel via buttonStyle)
      // + bold + brightened text. No border (removed in the axis split).
      return `${base} text-text-primary font-medium`;
    }
    if (tint) {
      // Colored non-selected: inline bg via buttonStyle, hover via JS
      return `${base} text-text-secondary hover:text-text-primary`;
    }
    // Uncolored non-selected
    return `${base} text-text-secondary hover:text-text-primary hover:bg-bg-card/50`;
  }, [tint, isSelected, showPinIcon]);

  // ── Left-gutter marker ──────────────────────────────────────────────────
  // The marker gutter is an independent label axis. Available on ALL rows
  // (colored or not) that opted in via onMarkerChange and are non-ghost. Inert
  // on coarse pointers — the palette action is the touch path (R15).
  const markerEnabled = !ghost && !!onMarkerChange && !!server;
  const [gutterHover, setGutterHover] = useState(false);
  const cycleMarker = (e: React.MouseEvent) => {
    // Must not select the row and must coexist with drag-reorder.
    e.stopPropagation();
    if (!onMarkerChange) return;
    onMarkerChange(srv, session, win.windowId, nextMarkerState(marker));
  };
  const isDouble = marker === "double";
  const scanlineAnimated = isDouble && isSelected;

  return (
    <div
      key={ghost ? `ghost-${win.optimisticId}` : win.windowId}
      // Stable, unique handle for tests/automation. tmux window ids (@N) are
      // unique for a window's lifetime and survive rename/move/index reuse —
      // unlike the window name or session+index, which are ambiguous or
      // transient. Ghost rows expose their optimistic id until confirmed.
      data-window-id={ghost ? `ghost-${win.optimisticId}` : win.windowId}
      // Globally-unique roving handle (`${server}:${windowId}`) for the keyboard
      // model — bare @N collides across servers. Distinct from data-window-id,
      // which stays the bare id for tests/automation/pin lookups.
      data-row-key={rowKey}
      // W3C-APG tree leaf. The roving model in index.tsx threads `tabIndex`
      // (0 for the one roving row, -1 otherwise) + level/set/pos metadata.
      role="treeitem"
      aria-level={ariaLevel}
      aria-setsize={ariaSetSize}
      aria-posinset={ariaPosInSet}
      tabIndex={tabIndex}
      // `relative` anchors the absolute gutter + status dot + scanline overlay.
      // The scanline/CRT-band overlay is a dedicated inner element (below), NOT
      // classes on this root: the root must stay free to OVERFLOW so the row's
      // `top-full` pin/color popovers aren't clipped on a selected+double row
      // (must-fix 4). The `--rk-marker-color` custom property is set here (the
      // overlay's pseudos read it via inheritance). See globals.css § scanlines
      // and docs/specs/themes.md.
      className={`relative group${ghost ? " opacity-50 animate-pulse" : ""}`}
      draggable={dragEnabled}
      onDragStart={dragEnabled && onDragStart ? (e) => onDragStart(e, srv, session, win.index, win.windowId, win.name) : undefined}
      onDragOver={dragEnabled && onDragOver ? (e) => onDragOver(e, srv, session, win.index) : undefined}
      onDrop={dragEnabled && onDrop ? (e) => onDrop(e, srv, session, win.index) : undefined}
      onDragEnd={dragEnabled ? onDragEnd : undefined}
      style={{
        ...(isDouble ? ({ "--rk-marker-color": markerColor } as React.CSSProperties) : {}),
        ...(isDragOver ? { boxShadow: "0 -2px 0 0 var(--color-accent)" } : {}),
      }}
    >
      {/* Scanline / CRT-band overlay for double-marker rows. A dedicated inner
          element that OWNS the clip (`overflow-hidden`) so the rolling band's
          `::after` stays inside the row while the row ROOT remains free to
          overflow for the `top-full` popovers (must-fix 4). Non-interactive
          (`pointer-events-none`) and z-5 (above the button bg, below the z-10
          icon cluster / z-20 gutter). Selected+double adds the animated crawl. */}
      {isDouble && (
        <div
          aria-hidden="true"
          className={`absolute inset-0 z-[5] overflow-hidden pointer-events-none rk-scanlines${
            scanlineAnimated ? " rk-scanlines-crawl" : ""
          }`}
        />
      )}
      {markerEnabled && (
        <MarkerGutter
          marker={marker}
          markerColor={markerColor}
          hover={gutterHover}
          onEnter={() => setGutterHover(true)}
          onLeave={() => setGutterHover(false)}
          onClick={cycleMarker}
        />
      )}
      <button
        onClick={() => onSelectWindow(srv, session, win.windowId)}
        onDoubleClick={(e) => {
          e.stopPropagation();
          if (!ghost) onStartEditing(srv, session, win.windowId, win.name);
        }}
        className={buttonClass}
        style={buttonStyle}
        aria-current={isSelected ? "page" : undefined}
        onMouseEnter={tint && !isSelected ? (e) => { (e.currentTarget as HTMLElement).style.backgroundColor = tint.hover; } : undefined}
        onMouseLeave={tint && !isSelected ? (e) => { (e.currentTarget as HTMLElement).style.backgroundColor = tint.base; } : undefined}
      >
        {/* No `truncate` on this wrapper: the dot's waiting halo is a
            box-shadow that paints OUTSIDE the 7px dot, and `truncate`'s
            overflow-hidden clipped it into a half-moon at the span's left
            edge. The name span below carries its own `truncate`, so text
            ellipsis is unaffected; `min-w-0` stays so that inner truncation
            keeps working inside the flex row. */}
        <span className="flex items-center gap-1.5 min-w-0">
          {/* Unified status dot: PR status when the window is change-bound with
              a PR (purple/red/yellow/green/hollow per prDotState), else
              monochrome terminal activity (filled=active, hollow ring=idle). One
              dot in the leading position — the high-value PR signal now lands in
              the primary scan anchor. See StatusDot / statusDotState. */}
          <StatusDot win={win} />
          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              value={editingName}
              onChange={(e) => onWindowNameChange(e.target.value)}
              onKeyDown={onRenameKeyDown}
              onBlur={onRenameBlur}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              className="text-xs bg-transparent border border-accent rounded px-0.5 outline-none truncate w-full"
              aria-label="Rename window"
            />
          ) : (
            <span className="truncate">{win.name}</span>
          )}
        </span>
        {/* Row Minimalism (260706-y1ar; status-pyramid.md § Row Minimalism):
            the trailing status cluster — the stage word (red-when-failed) and
            the duration text — is REMOVED. The leading StatusDot above is the
            row's ONLY externally visible status signal (its hue = journey, shape
            = health, additive halo = waiting); the freed width goes to the
            window name. The exact stage word + durations survive in the
            StatusDotTip hover-card and the PANE panel's register view. Hover-
            reveal action icons (pin/color/kill) below are actions, not status,
            so they are untouched. */}
      </button>
      {/* Hover-reveal buttons: pin + color swatch + kill. Inert at rest on
          fine pointers (pointer-events-none) so stray clicks near the row's
          right edge fall through to the row-select button instead of hitting
          an invisible icon; interactivity is restored on hover, coarse
          pointers, and keyboard focus within (has-[:focus-visible]). */}
      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 z-10 pointer-events-none group-hover:pointer-events-auto coarse:pointer-events-auto has-[:focus-visible]:pointer-events-auto">
        {showPinIcon && (
          <button
            ref={pinBtnRef}
            type="button"
            aria-label={`Pin ${win.name} to a board`}
            aria-pressed={isPinnedToAny}
            // The active-board cue lives on THIS glyph now (the 4px left border
            // was removed in the axis split): a row pinned to the board you're
            // viewing gets an ACCENT-colored persistent glyph; a row pinned to
            // some other board is a monochrome persistent glyph; an unpinned row
            // shows the glyph only on hover/focus/coarse. isPinnedToActiveBoard
            // implies isPinnedToAny, so the accent branch is always persistent.
            onClick={(e) => {
              e.stopPropagation();
              setShowPinPopover((v) => !v);
            }}
            className={`transition-opacity cursor-pointer ${
              isPinnedToActiveBoard
                ? "opacity-100 text-accent hover:text-accent"
                : isPinnedToAny
                ? "opacity-100 text-text-secondary hover:text-text-primary"
                : "opacity-0 group-hover:opacity-100 coarse:opacity-100 focus-visible:opacity-100 text-text-secondary hover:text-text-primary"
            } px-0.5 min-h-[24px] coarse:min-h-[36px] flex items-center justify-center`}
          >
            <PinIcon filled={isPinnedToAny} />
          </button>
        )}
        {onColorChange && (
          <button
            ref={colorBtnRef}
            type="button"
            aria-label={`Set color for ${win.name}`}
            onClick={(e) => {
              e.stopPropagation();
              setShowColorPicker((v) => !v);
            }}
            className="text-text-secondary hover:text-text-primary transition-opacity cursor-pointer opacity-0 group-hover:opacity-100 coarse:opacity-100 focus-visible:opacity-100 px-0.5 min-h-[24px] coarse:min-h-[36px] flex items-center justify-center"
          >
            <PaletteIcon />
          </button>
        )}
        <button
          type="button"
          aria-label={`Kill window ${win.name}`}
          onClick={(e) => {
            e.stopPropagation();
            if (!ghost) onKillClick(srv, session, win.windowId, e.ctrlKey || e.metaKey);
          }}
          className="text-[14px] text-text-secondary hover:text-red-400 transition-opacity cursor-pointer opacity-0 group-hover:opacity-100 coarse:opacity-100 focus-visible:opacity-100 px-1 min-h-[24px] coarse:min-h-[36px] flex items-center justify-center"
        >
          {"\u2715"}
        </button>
      </div>
      {showPinPopover && server && (
        <PinPopover
          server={server}
          windowId={win.windowId}
          boards={boards}
          boardsLoading={boardsLoading}
          isPinnedTo={(b) => (isPinnedToBoard ? isPinnedToBoard(b, srv, win.windowId) : false)}
          pinnedBoard={pinnedBoard}
          onNavigateToBoard={onNavigateToBoard}
          onClose={() => setShowPinPopover(false)}
        />
      )}
      {showColorPicker && onColorChange && (
        <div className="absolute right-0 top-full z-50">
          <SwatchPopover
            selectedColor={color}
            onSelect={(c) => {
              onColorChange(srv, session, win.windowId, c);
              setShowColorPicker(false);
            }}
            onClose={() => setShowColorPicker(false)}
          />
        </div>
      )}
    </div>
  );
}

/** Width of the left-gutter marker (fine pointers), in px. */
const GUTTER_WIDTH = 14;

/** Inline style rendering a marker state as a left-edge border in the given
 *  color: dotted 3px, solid 3px, double 6px. Empty/ghost states render nothing
 *  (returns undefined). `ghost` renders the preview at low opacity. */
function markerBorderStyle(state: string, color: string): React.CSSProperties | undefined {
  switch (state) {
    case "dotted":
      return { borderLeft: `3px dotted ${color}` };
    case "solid":
      return { borderLeft: `3px solid ${color}` };
    case "double":
      return { borderLeft: `6px double ${color}` };
    default:
      return undefined;
  }
}

type MarkerGutterProps = {
  marker?: string;
  markerColor: string;
  hover: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onClick: (e: React.MouseEvent) => void;
};

/** The left-gutter marker — an independent 4-state label axis (empty→dotted→
 *  solid→double, click to cycle). Two-stage hover affordance: the parent row's
 *  `group-hover` fills the gutter ~20% family color; hovering the gutter itself
 *  steps to ~30% and ghosts a faint preview of the NEXT state. `cursor: cell`.
 *  The gutter is inert on coarse pointers (`coarse:pointer-events-none`) — the
 *  palette action is the touch path — but its marker STILL renders on touch so
 *  the state stays visible. Marker click stopPropagation lives in `onClick`. */
function MarkerGutter({ marker, markerColor, hover, onEnter, onLeave, onClick }: MarkerGutterProps) {
  const current = marker ?? "";
  const currentStyle = markerBorderStyle(current, markerColor);
  const next = nextMarkerState(current);
  const ghostStyle = markerBorderStyle(next, markerColor);
  return (
    <div
      // A POINTER-ONLY affordance, not a keyboard button: intake #12 makes the
      // command palette (`Window: Cycle Marker`) the sole keyboard/touch path,
      // so the gutter carries no `role="button"`, `tabIndex`, or key handler
      // (an ARIA button would promise a keyboard contract this element does not
      // honor — must-fix 3 nice-to-have). `aria-label` names it for pointer AT
      // users and test selection (getByLabelText / getByLabel).
      aria-label="Cycle window marker"
      onClick={onClick}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      // z-20 sits above the row-select button (z-10 icon cluster) at the left
      // edge. Interactive on fine pointers only; inert on coarse.
      className="absolute left-0 top-0 bottom-0 z-20 cursor-[cell] coarse:pointer-events-none"
      style={{ width: GUTTER_WIDTH }}
    >
      {/* Fill layer: transparent at rest; ~20% on row hover (group-hover, driven
          by the parent row's `group`); ~30% when the gutter itself is hovered. */}
      <div
        className="absolute inset-0 transition-colors opacity-0 group-hover:opacity-100"
        style={{
          backgroundColor: `color-mix(in srgb, ${markerColor} ${hover ? 30 : 20}%, transparent)`,
        }}
      />
      {/* Current marker (border on the left edge). Sits above the fill. */}
      {currentStyle && <div className="absolute inset-0" style={currentStyle} />}
      {/* Next-state ghost preview — only while the gutter itself is hovered, and
          only when the next state actually draws something (not the empty step). */}
      {hover && ghostStyle && (
        <div className="absolute inset-0 opacity-40" style={ghostStyle} />
      )}
    </div>
  );
}

/** Memoized window row. Re-renders only when its own props change identity —
 *  an SSE tick on an unrelated server, or the per-second clock tick (now scoped
 *  to the `WindowDuration` leaf below), no longer re-renders the whole row.
 *  Prop stability is the parent's responsibility: `index.tsx` passes
 *  identity-arg `useCallback`s + stable context refs. */
export const WindowRow = memo(WindowRowInner);

/* Row Minimalism (260706-y1ar): the `WindowDuration`/`TickingDuration` leaves
   (and their per-second `useNow()` tick) were removed with the trailing status
   cluster — the row renders no duration. Idle/elapsed durations now live only in
   the StatusDotTip and the PANE panel's register view. This also drops the last
   `getWindowDuration` caller (removed from lib/format.ts). */
