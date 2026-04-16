import { useState, useRef, useMemo } from "react";
import { isGhostWindow } from "@/contexts/optimistic-context";
import { getWindowDuration } from "@/lib/format";
import type { ProjectSession } from "@/types";
import type { MergedSession } from "@/contexts/optimistic-context";
import type { RowTint } from "@/themes";
import { SwatchPopover } from "@/components/swatch-popover";

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
}: WindowRowProps) {
  const ghost = isGhostWindow(win);
  const duration = getWindowDuration(win, nowSeconds);
  const isEditing = editingWindow?.session === session && editingWindow.windowId === win.windowId;
  const [showColorPicker, setShowColorPicker] = useState(false);
  const colorBtnRef = useRef<HTMLButtonElement>(null);

  const tint = useMemo(() => {
    if (color == null || !rowTints) return null;
    return rowTints.get(color) ?? null;
  }, [color, rowTints]);

  // Full-saturation ANSI color for the left border on selected rows.
  // Colored rows use their ANSI color; uncolored rows use the theme accent.
  const borderColor = color != null && ansiPalette ? ansiPalette[color] : undefined;

  // Compute inline style for the button (background + left accent border)
  const buttonStyle = useMemo(() => {
    const style: React.CSSProperties = {};
    if (tint) {
      style.backgroundColor = isSelected ? tint.selected : tint.base;
    }
    // Always reserve left border space to prevent text shift between states
    style.borderLeft = isSelected
      ? `3px solid ${borderColor ?? "var(--color-accent)"}`
      : "3px solid transparent";
    return Object.keys(style).length > 0 ? style : undefined;
  }, [tint, isSelected, borderColor]);

  // Build className for the button
  const buttonClass = useMemo(() => {
    const base = "w-full text-left flex items-center justify-between gap-2 py-1 pl-2 pr-11 text-sm transition-colors min-h-[36px] rounded-l-lg rounded-r-none";
    if (isSelected) {
      // Colored selected: inline bg via buttonStyle. Uncolored selected: bg-accent/15.
      return `${base} ${tint ? "" : "bg-accent/15 "}text-text-primary font-medium`;
    }
    if (tint) {
      // Colored non-selected: inline bg via buttonStyle, hover via JS
      return `${base} text-text-secondary hover:text-text-primary`;
    }
    // Uncolored non-selected
    return `${base} text-text-secondary hover:text-text-primary hover:bg-bg-card/50`;
  }, [tint, isSelected]);

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
      {/* Hover-reveal buttons: color swatch + kill */}
      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 z-10">
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
