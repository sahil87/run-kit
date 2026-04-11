import type { ProjectSession } from "@/types";
import type { MergedSession } from "@/contexts/optimistic-context";

type SessionRowProps = {
  session: ProjectSession | MergedSession;
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
};

export function SessionRow({
  session,
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
}: SessionRowProps) {
  return (
    <div
      className="flex items-center justify-between group pl-1.5 sm:pl-2"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={isSessionDropTarget ? { boxShadow: "inset 0 0 0 2px var(--color-accent)", borderRadius: "4px" } : undefined}
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
    </div>
  );
}
