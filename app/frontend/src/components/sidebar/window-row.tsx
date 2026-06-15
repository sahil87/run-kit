import { useEffect, useState, useRef, useMemo, memo } from "react";
import { isGhostWindow } from "@/contexts/optimistic-context";
import { getWindowDuration } from "@/lib/format";
import { useNow } from "@/hooks/use-now";
import type { ProjectSession } from "@/types";
import type { MergedSession } from "@/contexts/optimistic-context";
import type { BoardSummary } from "@/api/boards";
import { UNCOLORED_SELECTED_ANSI, type RowTint } from "@/themes";
import { SwatchPopover } from "@/components/swatch-popover";
import { prDotState, PR_DOT_COLOR, PR_DOT_LABEL } from "@/components/pr-status-line";
import { PinPopover } from "./pin-popover";

type ProjectWindow = ProjectSession["windows"][number];
type GhostWindow = MergedSession["windows"][number];

type WindowRowProps = {
  win: ProjectWindow | GhostWindow;
  session: string;
  isSelected: boolean;
  isDragOver: boolean;
  color?: number;
  rowTints?: Map<number, RowTint>;
  ansiPalette?: readonly string[];
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
  onColorChange?: (server: string, session: string, windowId: string, color: number | null) => void;
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
  /** Predicate: is this window pinned to the given board? Identity-arg form
   *  (board, server, windowId) so a single stable reference (the context's
   *  `pinnedToBoard`) serves every row; the row binds its own (server,
   *  windowId). Used by the pin popover to render checkmarks. */
  isPinnedToBoard?: (board: string, server: string, windowId: string) => boolean;
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
  rowTints,
  ansiPalette,
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
  server,
  isPinnedToAny = false,
  isPinnedToActiveBoard = false,
  boards = [],
  isPinnedToBoard,
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
    return rowTints.get(UNCOLORED_SELECTED_ANSI) ?? null;
  }, [color, rowTints, isSelected]);

  // Full-saturation ANSI color for the left border on selected rows.
  const borderColor = useMemo(() => {
    if (!ansiPalette) return undefined;
    if (color != null) return ansiPalette[color];
    if (isSelected) return ansiPalette[UNCOLORED_SELECTED_ANSI];
    return undefined;
  }, [color, ansiPalette, isSelected]);

  // Compute inline style for the button (background + left accent border)
  const buttonStyle = useMemo(() => {
    const style: React.CSSProperties = {};
    if (tint) {
      style.backgroundColor = isSelected ? tint.selected : tint.base;
    } else if (uncoloredSelectedTint) {
      style.backgroundColor = uncoloredSelectedTint.selected;
    }
    // Active-board highlight: when not selected (selection takes priority for
    // border), tint the left border in accent color so the user sees which
    // windows belong to the board they're viewing.
    if (isSelected) {
      style.borderLeft = `8px solid ${borderColor ?? "var(--color-accent)"}`;
    } else if (isPinnedToActiveBoard) {
      style.borderLeft = "8px solid var(--color-accent)";
    } else {
      // Always reserve left border space to prevent text shift between states.
      style.borderLeft = "8px solid transparent";
    }
    return Object.keys(style).length > 0 ? style : undefined;
  }, [tint, uncoloredSelectedTint, isSelected, borderColor, isPinnedToActiveBoard]);

  // Build className for the button — when the pin icon is wired up, reserve
  // a few extra px on the right so labels don't run under the icon group.
  const showPinIcon = !ghost && !!server;
  const buttonClass = useMemo(() => {
    const rightPad = showPinIcon ? "pr-[68px]" : "pr-11";
    const base = `w-full text-left flex items-center justify-between gap-2 py-1 pl-2 ${rightPad} text-sm transition-colors min-h-[36px]`;
    if (isSelected) {
      // Colored selected uses tint.selected; uncolored selected borrows gray tint — both via buttonStyle.
      return `${base} text-text-primary font-medium`;
    }
    if (tint) {
      // Colored non-selected: inline bg via buttonStyle, hover via JS
      return `${base} text-text-secondary hover:text-text-primary`;
    }
    // Uncolored non-selected
    return `${base} text-text-secondary hover:text-text-primary hover:bg-bg-card/50`;
  }, [tint, isSelected, showPinIcon]);

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
      className={`relative group${ghost ? " opacity-50 animate-pulse" : ""}`}
      draggable={dragEnabled}
      onDragStart={dragEnabled && onDragStart ? (e) => onDragStart(e, srv, session, win.index, win.windowId, win.name) : undefined}
      onDragOver={dragEnabled && onDragOver ? (e) => onDragOver(e, srv, session, win.index) : undefined}
      onDrop={dragEnabled && onDrop ? (e) => onDrop(e, srv, session, win.index) : undefined}
      onDragEnd={dragEnabled ? onDragEnd : undefined}
      style={isDragOver ? { boxShadow: "0 -2px 0 0 var(--color-accent)" } : undefined}
    >
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
        <span className="flex items-center gap-1.5 truncate min-w-0">
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${win.fabDisplayState === "failed" ? "text-red-400" : "text-text-secondary"}`}
            aria-label={win.activity}
            style={{
              border: win.activity === "active" ? "none" : "1.5px solid currentColor",
              backgroundColor: win.activity === "active" ? "currentColor" : "transparent",
            }}
          />
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
              className="text-sm bg-transparent border border-accent rounded px-0.5 outline-none truncate w-full"
              aria-label="Rename window"
            />
          ) : (
            <span className="truncate">{win.name}</span>
          )}
        </span>
        <span className="flex items-center gap-1.5 shrink-0">
          {/* PR traffic-light dot: a 5-state colored signal for change-bound
              windows with a PR. Gated on fabChange && prNumber (mirrors
              PrStatusLine's own `if (!win.fabChange || !win.prNumber) return
              null` gate) so a non-change-bound window never shows a stray dot —
              but unlike the old fail-only dot, EVERY change-bound PR window now
              shows a dot. The state, color token, and accessible name all come
              from prDotState / PR_DOT_COLOR / PR_DOT_LABEL (single source of
              truth shared with PrStatusLine via isFailish). The four "live"
              states (merged/fail/pending/healthy) render the solid ● glyph in
              their token; `neutral` renders as a dim hollow ring (the same
              border + transparent-fill technique as the activity dot above) so
              "has a PR, no news" is distinguishable from "no PR" (no dot). A
              bare dot needs an accessible name, hence aria-label + title. */}
          {win.fabChange && win.prNumber && (() => {
            const dot = prDotState(win);
            const color = PR_DOT_COLOR[dot];
            const label = PR_DOT_LABEL[dot];
            return dot === "neutral" ? (
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${color}`}
                aria-label={label}
                title={label}
                style={{ border: "1.5px solid currentColor", backgroundColor: "transparent" }}
              />
            ) : (
              <span className={`text-xs shrink-0 ${color}`} aria-label={label} title={label}>
                &#x25CF;
              </span>
            );
          })()}
          {/* Quiet parked rows: a change whose displayed stage is fully done
              (fab pane map display_state === "done") is parked, not active —
              suppress the stale stage text and let the duration stand alone.
              Any other value, unknown future values, or an absent field (older
              fab binaries omit display_state) keeps today's behavior. A failed
              stage renders in the red token instead of secondary; the gate
              itself is unchanged. */}
          {win.fabStage && win.fabDisplayState !== "done" && (
            <span className={`text-xs ${win.fabDisplayState === "failed" ? "text-red-400" : "text-text-secondary"}`}>
              {win.fabStage}
            </span>
          )}
          <WindowDuration win={win} />
        </span>
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
            onClick={(e) => {
              e.stopPropagation();
              setShowPinPopover((v) => !v);
            }}
            className={`transition-opacity cursor-pointer ${
              isPinnedToAny
                ? "opacity-100 text-text-secondary hover:text-text-primary"
                : "opacity-0 group-hover:opacity-100 coarse:opacity-100 focus-visible:opacity-100 text-text-secondary hover:text-text-primary"
            } px-0.5 min-h-[36px] flex items-center justify-center`}
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
            className="text-[12px] text-text-secondary hover:text-text-primary transition-opacity cursor-pointer opacity-0 group-hover:opacity-100 coarse:opacity-100 focus-visible:opacity-100 px-0.5 min-h-[36px] flex items-center justify-center"
          >
            &#x25A0;
          </button>
        )}
        <button
          type="button"
          aria-label={`Kill window ${win.name}`}
          onClick={(e) => {
            e.stopPropagation();
            if (!ghost) onKillClick(srv, session, win.windowId, e.ctrlKey || e.metaKey);
          }}
          className="text-[14px] text-text-secondary hover:text-red-400 transition-opacity cursor-pointer opacity-0 group-hover:opacity-100 coarse:opacity-100 focus-visible:opacity-100 px-1 min-h-[36px] flex items-center justify-center"
        >
          {"\u2715"}
        </button>
      </div>
      {showPinPopover && server && (
        <PinPopover
          server={server}
          windowId={win.windowId}
          boards={boards}
          isPinnedTo={(b) => (isPinnedToBoard ? isPinnedToBoard(b, srv, win.windowId) : false)}
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

/** Memoized window row. Re-renders only when its own props change identity —
 *  an SSE tick on an unrelated server, or the per-second clock tick (now scoped
 *  to the `WindowDuration` leaf below), no longer re-renders the whole row.
 *  Prop stability is the parent's responsibility: `index.tsx` passes
 *  identity-arg `useCallback`s + stable context refs. */
export const WindowRow = memo(WindowRowInner);

/** Non-ticking wrapper that decides whether a LIVE clock is needed before any
 *  `useNow()` interval is spun up. Only the `activityTimestamp` fallback branch
 *  of `getWindowDuration` depends on `now`; active windows render nothing and
 *  agent-provided `agentIdleDuration` is a static string. For those two cases we
 *  render directly (no interval, no per-second re-render). Only the live case
 *  mounts the ticking leaf below — so a sidebar full of active / agent-idle rows
 *  spins up zero per-second timers. */
function WindowDuration({ win }: { win: ProjectWindow | GhostWindow }) {
  // Active windows never show a duration.
  if (win.activity === "active") return null;
  // Agent-provided idle duration is a fixed string — no live clock needed.
  if (win.agentState === "idle" && win.agentIdleDuration) {
    return <span className="text-xs text-text-secondary">{win.agentIdleDuration}</span>;
  }
  // Remaining case (activityTimestamp fallback) is the only one that ticks.
  if (win.agentState !== "active" && win.activityTimestamp) {
    return <TickingDuration win={win} />;
  }
  return null;
}

/** Ticking leaf that owns the per-second `now` tick via `useNow()`. Mounted only
 *  for windows whose displayed duration is derived from `activityTimestamp` (the
 *  one branch that changes each second). Isolating the tick here keeps both
 *  `WindowRow` (static under `React.memo`) and non-ticking duration rows free of
 *  the interval — only this text node re-renders each second. */
function TickingDuration({ win }: { win: ProjectWindow | GhostWindow }) {
  const now = useNow();
  const duration = getWindowDuration(win, now);
  if (!duration) return null;
  return <span className="text-xs text-text-secondary">{duration}</span>;
}

/** Small pin icon — outline (not pinned) vs filled (pinned to any board).
 *  Lucide-style thumbtack viewed face-on: round-cornered cap, narrow neck
 *  flaring into wide shoulders, centered needle. Native 16×16 viewBox so
 *  strokes pixel-align symmetrically when rendered at 12px. */
function PinIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Bell silhouette: cap → neck → flared shoulders */}
      <path
        d="M6 2.5
           Q6 2 6.5 2
           H9.5
           Q10 2 10 2.5
           V5
           L13 9
           Q13 9.5 12.5 9.5
           H3.5
           Q3 9.5 3 9
           L6 5
           Z"
        fill={filled ? "currentColor" : "none"}
      />
      {/* Needle — centered vertical from flange to tip */}
      <path d="M8 9.5 V14" />
    </svg>
  );
}
