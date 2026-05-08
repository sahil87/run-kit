import { useEffect, useState, useRef, useMemo } from "react";
import { isGhostWindow } from "@/contexts/optimistic-context";
import { getWindowDuration } from "@/lib/format";
import type { ProjectSession } from "@/types";
import type { MergedSession } from "@/contexts/optimistic-context";
import type { BoardSummary } from "@/api/boards";
import { UNCOLORED_SELECTED_ANSI, type RowTint } from "@/themes";
import { SwatchPopover } from "@/components/swatch-popover";
import { PinPopover } from "./pin-popover";

type ProjectWindow = ProjectSession["windows"][number];
type GhostWindow = MergedSession["windows"][number];

type WindowRowProps = {
  win: ProjectWindow | GhostWindow;
  session: string;
  isSelected: boolean;
  isDragOver: boolean;
  nowSeconds: number;
  color?: number;
  rowTints?: Map<number, RowTint>;
  ansiPalette?: readonly string[];
  editingWindow: { session: string; windowId: string } | null;
  editingName: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onSelectWindow: () => void;
  onDoubleClickName: () => void;
  onWindowNameChange: (value: string) => void;
  onRenameKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onRenameBlur: () => void;
  onKillClick: (e: React.MouseEvent) => void;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
  onColorChange?: (color: number | null) => void;
  /** Tmux server name for the pin popover (server-routing contract). When
   *  omitted the pin icon is hidden — used by tests that render WindowRow
   *  without the boards system wired up. */
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
  /** Predicate: is this window pinned to the given board? Used by the pin
   *  popover to render checkmarks. */
  isPinnedToBoard?: (board: string) => boolean;
};

export function WindowRow({
  win,
  session,
  isSelected,
  isDragOver,
  nowSeconds,
  color,
  rowTints,
  ansiPalette,
  editingWindow,
  editingName,
  inputRef,
  onSelectWindow,
  onDoubleClickName,
  onWindowNameChange,
  onRenameKeyDown,
  onRenameBlur,
  onKillClick,
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
}: WindowRowProps) {
  const ghost = isGhostWindow(win);
  const duration = getWindowDuration(win, nowSeconds);
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
      className={`relative group${ghost ? " opacity-50 animate-pulse" : ""}`}
      draggable={!ghost}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      style={isDragOver ? { boxShadow: "0 -2px 0 0 var(--color-accent)" } : undefined}
    >
      <button
        onClick={onSelectWindow}
        onDoubleClick={(e) => {
          e.stopPropagation();
          if (!ghost) onDoubleClickName();
        }}
        className={buttonClass}
        style={buttonStyle}
        aria-current={isSelected ? "page" : undefined}
        onMouseEnter={tint && !isSelected ? (e) => { (e.currentTarget as HTMLElement).style.backgroundColor = tint.hover; } : undefined}
        onMouseLeave={tint && !isSelected ? (e) => { (e.currentTarget as HTMLElement).style.backgroundColor = tint.base; } : undefined}
      >
        <span className="flex items-center gap-1.5 truncate min-w-0">
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0 text-text-secondary"
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
          {win.fabStage && (
            <span className="text-xs text-text-secondary">
              {win.fabStage}
            </span>
          )}
          {duration && (
            <span className="text-xs text-text-secondary">
              {duration}
            </span>
          )}
        </span>
      </button>
      {/* Hover-reveal buttons: pin + color swatch + kill */}
      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 z-10">
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
                ? "opacity-100 text-accent"
                : "opacity-0 group-hover:opacity-100 coarse:opacity-100 text-text-secondary hover:text-text-primary"
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
            className="text-[12px] text-text-secondary hover:text-text-primary transition-opacity cursor-pointer opacity-0 group-hover:opacity-100 coarse:opacity-100 px-0.5 min-h-[36px] flex items-center justify-center"
          >
            &#x25A0;
          </button>
        )}
        <button
          type="button"
          aria-label={`Kill window ${win.name}`}
          onClick={onKillClick}
          className="text-[14px] text-text-secondary hover:text-red-400 transition-opacity cursor-pointer opacity-0 group-hover:opacity-100 coarse:opacity-100 px-1 min-h-[36px] flex items-center justify-center"
        >
          {"\u2715"}
        </button>
      </div>
      {showPinPopover && server && (
        <PinPopover
          server={server}
          windowId={win.windowId}
          boards={boards}
          isPinnedTo={(b) => (isPinnedToBoard ? isPinnedToBoard(b) : false)}
          onClose={() => setShowPinPopover(false)}
        />
      )}
      {showColorPicker && onColorChange && (
        <div className="absolute right-0 top-full z-50">
          <SwatchPopover
            selectedColor={color}
            onSelect={(c) => {
              onColorChange(c);
              setShowColorPicker(false);
            }}
            onClose={() => setShowColorPicker(false)}
          />
        </div>
      )}
    </div>
  );
}

/** Small pin icon — outline (not pinned) vs filled (pinned to any board). */
function PinIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      {/* Stylized pin: head triangle + stem */}
      <path d="M8 1.5 L4.5 5 L4.5 8 L7 8 L7 14 L8 15.5 L9 14 L9 8 L11.5 8 L11.5 5 Z" />
    </svg>
  );
}
