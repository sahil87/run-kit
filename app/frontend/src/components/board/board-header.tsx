import type { BoardEntry } from "@/api/boards";
import type { BoardPaneDragProps } from "@/hooks/use-board-pane-reorder";
import { PinIcon } from "@/components/pin-icon";

interface BoardHeaderProps {
  entry: BoardEntry;
  onUnpin: () => void;
  /**
   * The window's HOME session name, resolved by the parent from the live
   * sessions snapshot (co9z). Possible now precisely because a pinned window
   * stays LINKED into its home session, so it appears in a visible session.
   * When present, the header shows the `{session} › {window}` crumb (top-bar
   * crumb vocabulary). Undefined → the window is not derivable from a visible
   * session (legacy move-based pin / home died): fall back to `{window} ·
   * {server}`.
   */
  homeSession?: string;
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
 * The unpin button renders a pin/unpin GLYPH (the shared thumbtack `PinIcon`
 * with its `slashed` unpin variant), not a text `×` — the old ✕ read as a
 * destructive close/kill, misleading now that the top-bar ✕ IS a real
 * close-pane. Same glyph family as the sidebar window-row pin button, so
 * pin (sidebar) and unpin (here) read as two states of one affordance.
 *
 * The header is the drag handle for board pane reorder (`dragHandleProps`): the
 * whole header is draggable so there is a generous grab target, while the unpin
 * button is explicitly non-draggable so a click there unpins rather than
 * starting a drag.
 */
export function BoardHeader({ entry, onUnpin, homeSession, dragHandleProps }: BoardHeaderProps) {
  const windowLabel = entry.windowName || `@${entry.windowIndex}`;
  return (
    <div
      {...dragHandleProps}
      className={`flex items-center justify-between gap-2 px-2 py-1 border-b border-border bg-bg-secondary text-xs ${
        dragHandleProps?.draggable ? "cursor-grab active:cursor-grabbing" : ""
      }`}
    >
      {homeSession ? (
        // Dual-residence crumb (co9z): `{session} › {window}`, using the top-bar
        // crumb vocabulary (the `›` separator). The home session is the honest,
        // tmux-derived owner of the linked window.
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-text-secondary truncate">{homeSession}</span>
          <span className="text-text-secondary">›</span>
          <span className="truncate text-text-primary">{windowLabel}</span>
        </div>
      ) : (
        // Fallback when the home session is not derivable (legacy move-based pin
        // or the home session died): window name + server tag.
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="truncate text-text-primary">{windowLabel}</span>
          <span className="text-text-secondary">·</span>
          <span className="text-text-secondary truncate">{entry.server}</span>
        </div>
      )}
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
        {/* Slashed thumbtack = "remove the pin" — the shared PinIcon in its
            unpin variant, matching the sidebar's pin glyph. */}
        <PinIcon slashed />
      </button>
    </div>
  );
}
