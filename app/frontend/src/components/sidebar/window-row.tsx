import { isGhostWindow } from "@/contexts/optimistic-context";
import { getWindowDuration } from "@/lib/format";
import type { ProjectSession } from "@/types";
import type { MergedSession } from "@/contexts/optimistic-context";

type ProjectWindow = ProjectSession["windows"][number];
type GhostWindow = MergedSession["windows"][number];

type WindowRowProps = {
  win: ProjectWindow | GhostWindow;
  session: string;
  isSelected: boolean;
  isDragOver: boolean;
  nowSeconds: number;
  editingWindow: { session: string; windowId: string } | null;
  editingName: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onSelectWindow: () => void;
  onDoubleClickName: () => void;
  onWindowNameChange: (value: string) => void;
  onRenameKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onRenameBlur: () => void;
  onKillClick: (e: React.MouseEvent) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragEnd: () => void;
};

export function WindowRow({
  win,
  session,
  isSelected,
  isDragOver,
  nowSeconds,
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
}: WindowRowProps) {
  const ghost = isGhostWindow(win);
  const duration = getWindowDuration(win, nowSeconds);
  const isEditing = editingWindow?.session === session && editingWindow.windowId === win.windowId;

  return (
    <div
      key={ghost ? `ghost-${win.optimisticId}` : win.windowId}
      className={`relative group${ghost ? " opacity-50 animate-pulse" : ""}`}
      draggable={!ghost}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      style={isDragOver ? { borderTop: "2px solid var(--color-accent)" } : undefined}
    >
      <button
        onClick={onSelectWindow}
        onDoubleClick={(e) => {
          e.stopPropagation();
          if (!ghost) onDoubleClickName();
        }}
        className={`w-full text-left flex items-center justify-between gap-2 py-1 pl-2 pr-8 text-sm transition-colors min-h-[36px] ${
          isSelected
            ? "bg-accent/15 text-text-primary font-medium rounded-l-lg rounded-r-none"
            : "text-text-secondary hover:text-text-primary hover:bg-bg-card/50 rounded-l-lg rounded-r-none"
        }`}
        aria-current={isSelected ? "page" : undefined}
      >
        <span className="flex items-center gap-1.5 truncate min-w-0">
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
              win.activity === "active"
                ? "bg-accent-green"
                : "bg-text-secondary/40"
            }`}
            aria-label={win.activity}
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
      {/* Kill window button: hover-reveal on desktop, always visible on mobile */}
      <button
        type="button"
        aria-label={`Kill window ${win.name}`}
        onClick={onKillClick}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-[14px] text-text-secondary hover:text-red-400 transition-opacity cursor-pointer opacity-0 group-hover:opacity-100 coarse:opacity-100 px-1 min-h-[36px] flex items-center justify-center z-10"
      >
        {"\u2715"}
      </button>
    </div>
  );
}
