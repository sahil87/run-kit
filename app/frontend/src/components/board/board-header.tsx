import type { BoardEntry } from "@/api/boards";
import type { BoardPaneDragProps } from "@/hooks/use-board-pane-reorder";

interface BoardHeaderProps {
  entry: BoardEntry;
  onUnpin: () => void;
  /**
   * HTML5 drag-SOURCE props applied to the header itself — the header is the
   * board pane's drag HANDLE (`draggable` + onDragStart/onDragEnd only; the
   * drop TARGET's onDragOver/onDrop live on the pane root, not here — see
   * BoardPane). Never the whole pane as the source: a live xterm must not
   * hijack the drag or become the drag image. Optional so the mobile carousel
   * (no reorder) renders a non-draggable header.
   */
  dragHandleProps?: BoardPaneDragProps;
}

/**
 * Pane header within a board card. Shows the window name (truncated), a
 * server tag (boards span servers, so disambiguation is necessary), and an
 * unpin button. No confirmation dialog — pin is cheap to restore.
 *
 * The unpin button renders a pin/unpin GLYPH (a "pin with slash" inline SVG,
 * 260715-6jwn), not a text `×` — the old ✕ read as a destructive close/kill,
 * misleading now that the top-bar ✕ IS a real close-pane. Hand-rolled inline SVG
 * per the project's no-icon-library pattern (see top-bar SplitButton/HelpLink).
 *
 * The header is the drag handle for board pane reorder (`dragHandleProps`): the
 * whole header is draggable so there is a generous grab target, while the unpin
 * button is explicitly non-draggable so a click there unpins rather than
 * starting a drag.
 */
export function BoardHeader({ entry, onUnpin, dragHandleProps }: BoardHeaderProps) {
  return (
    <div
      {...dragHandleProps}
      className={`flex items-center justify-between gap-2 px-2 py-1 border-b border-border bg-bg-secondary text-xs ${
        dragHandleProps?.draggable ? "cursor-grab active:cursor-grabbing" : ""
      }`}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="truncate text-text-primary">{entry.windowName || `@${entry.windowIndex}`}</span>
        <span className="text-text-secondary">·</span>
        <span className="text-text-secondary truncate">{entry.server}</span>
      </div>
      <button
        type="button"
        draggable={false}
        onClick={(e) => {
          // Stop the click from bubbling to the pane (which would refocus) and
          // unpin. The button is non-draggable so a grab here never starts a
          // header drag.
          e.stopPropagation();
          onUnpin();
        }}
        aria-label={`Unpin ${entry.windowName || entry.windowId} from board`}
        className="text-text-secondary hover:text-text-primary px-1 flex items-center justify-center"
        title="Unpin from board"
      >
        {/* Pin-with-slash unpin glyph (260715-6jwn): a map-pin outline crossed
            by a diagonal slash = "remove the pin". Replaces the misleading text
            ✕. Hand-rolled inline SVG (no icon library), sized to the header's
            small type. */}
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {/* map-pin outline: teardrop body + inner circle */}
          <path d="M20 10c0 4.4-8 12-8 12s-8-7.6-8-12a8 8 0 0 1 16 0Z" />
          <circle cx="12" cy="10" r="3" />
          {/* diagonal slash = unpin */}
          <line x1="3" y1="3" x2="21" y2="21" />
        </svg>
      </button>
    </div>
  );
}
