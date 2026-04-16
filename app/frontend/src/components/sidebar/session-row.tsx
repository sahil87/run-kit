import { useState, useRef, useMemo } from "react";
import type { ProjectSession } from "@/types";
import type { MergedSession } from "@/contexts/optimistic-context";
import type { RowTint } from "@/themes";
import { SwatchPopover } from "@/components/swatch-popover";

type SessionRowProps = {
  session: ProjectSession | MergedSession;
  sessionColor?: number;
  rowTints?: Map<number, RowTint>;
  isCollapsed: boolean;
  isSessionDropTarget: boolean;
  editingSession: string | null;
  editingSessionName: string;
  sessionInputRef: React.RefObject<HTMLInputElement | null>;
  onToggleCollapse: () => void;
  onSelectFirstWindow: () => void;
  onCreateWindow: () => void;
  onKillClick: (e: React.MouseEvent) => void;
  onDoubleClickName: () => void;
  onSessionNameChange: (value: string) => void;
  onSessionRenameKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onSessionRenameBlur: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onColorChange?: (color: number | null) => void;
};

export function SessionRow({
  session,
  sessionColor,
  rowTints,
  isCollapsed,
  isSessionDropTarget,
  editingSession,
  editingSessionName,
  sessionInputRef,
  onToggleCollapse,
  onSelectFirstWindow,
  onCreateWindow,
  onKillClick,
  onDoubleClickName,
  onSessionNameChange,
  onSessionRenameKeyDown,
  onSessionRenameBlur,
  onDragOver,
  onDragLeave,
  onDrop,
  onColorChange,
}: SessionRowProps) {
  const [showColorPicker, setShowColorPicker] = useState(false);
  const colorBtnRef = useRef<HTMLButtonElement>(null);

  const tint = useMemo(() => {
    if (sessionColor == null || !rowTints) return null;
    return rowTints.get(sessionColor) ?? null;
  }, [sessionColor, rowTints]);

  const rowStyle = useMemo(() => {
    if (isSessionDropTarget) {
      return { boxShadow: "inset 0 0 0 2px var(--color-accent)", borderRadius: "4px" };
    }
    if (tint) {
      return { backgroundColor: tint.base };
    }
    return undefined;
  }, [isSessionDropTarget, tint]);

  return (
    <div
      className={`flex items-center justify-between group pl-1.5 sm:pl-2 relative${tint ? "" : " hover:bg-bg-card/50"} transition-colors`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={rowStyle}
      onMouseEnter={tint ? (e) => { (e.currentTarget as HTMLElement).style.backgroundColor = tint.hover; } : undefined}
      onMouseLeave={tint ? (e) => { (e.currentTarget as HTMLElement).style.backgroundColor = tint.base; } : undefined}
    >
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        <button
          onClick={onToggleCollapse}
          className="text-xs text-text-secondary hover:text-text-primary transition-colors shrink-0 min-h-[36px] flex items-center justify-center"
          aria-expanded={!isCollapsed}
          aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${session.name}`}
        >
          <span
            className="inline-block transition-transform duration-150"
            style={{ transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)" }}
            aria-hidden="true"
          >
            &#x25BC;
          </span>
        </button>
        <button
          onClick={onSelectFirstWindow}
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (editingSession !== session.name) onDoubleClickName();
          }}
          className="flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary transition-colors py-1 min-h-[36px] min-w-0 flex-1"
          aria-label={`Navigate to ${session.name}`}
        >
          {editingSession === session.name ? (
            <input
              ref={sessionInputRef}
              type="text"
              value={editingSessionName}
              onChange={(e) => onSessionNameChange(e.target.value)}
              onKeyDown={onSessionRenameKeyDown}
              onBlur={onSessionRenameBlur}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              className="text-xs font-medium bg-transparent border border-accent rounded px-0.5 outline-none truncate w-full"
              aria-label="Rename session"
            />
          ) : (
            <span className="font-medium truncate">
              {session.name}
            </span>
          )}
        </button>
      </div>
      <div className="flex items-center pr-2">
        {onColorChange && (
          <button
            ref={colorBtnRef}
            onClick={(e) => {
              e.stopPropagation();
              setShowColorPicker((v) => !v);
            }}
            aria-label={`Set color for ${session.name}`}
            className="text-text-secondary hover:text-text-primary transition-opacity opacity-0 group-hover:opacity-100 coarse:opacity-100 text-[12px] px-0.5 min-h-[36px] flex items-center justify-center"
          >
            &#x25A0;
          </button>
        )}
        <button
          onClick={onCreateWindow}
          aria-label={`New window in ${session.name}`}
          className="text-text-secondary hover:text-text-primary transition-colors text-[16px] px-1 min-h-[36px] flex items-center justify-center"
        >
          +
        </button>
        <button
          onClick={onKillClick}
          aria-label={`Kill session ${session.name}`}
          className="text-text-secondary hover:text-red-400 transition-colors text-[16px] px-1 min-h-[36px] flex items-center justify-center"
        >
          {"\u2715"}
        </button>
      </div>
      {showColorPicker && onColorChange && (
        <div className="absolute right-0 top-full z-50">
          <SwatchPopover
            selectedColor={sessionColor}
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
