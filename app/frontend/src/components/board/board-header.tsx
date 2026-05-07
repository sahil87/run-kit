import type { BoardEntry } from "@/api/boards";

interface BoardHeaderProps {
  entry: BoardEntry;
  onUnpin: () => void;
}

/**
 * Pane header within a board card. Shows the window name (truncated), a
 * server tag (boards span servers, so disambiguation is necessary), and an
 * unpin button. No confirmation dialog — pin is cheap to restore.
 */
export function BoardHeader({ entry, onUnpin }: BoardHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-2 px-2 py-1 border-b border-border bg-bg-secondary text-xs">
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="truncate text-text-primary">{entry.windowName || `@${entry.windowIndex}`}</span>
        <span className="text-text-secondary">·</span>
        <span className="text-text-secondary truncate">{entry.server}</span>
      </div>
      <button
        type="button"
        onClick={onUnpin}
        className="text-text-secondary hover:text-text-primary px-1"
        title="Unpin from board"
      >
        ×
      </button>
    </div>
  );
}
