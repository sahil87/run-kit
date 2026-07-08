import { useNavigate } from "@tanstack/react-router";
import { useBoards } from "@/hooks/use-boards";
import { useBoardListReorder } from "@/hooks/use-board-list-reorder";
import { useActiveBoardName } from "@/hooks/use-active-board";
import { useToast } from "@/components/toast";
import { CollapsiblePanel } from "./collapsible-panel";

/**
 * BoardsSection renders the cross-server boards list at the top of the
 * sidebar. Visibility:
 *   - Always visible (regardless of route or board count). When zero boards
 *     exist, the body shows a `Pin a window to start a board` hint instead
 *     of board rows.
 *
 * Click a row → navigate to /board/<name>.
 *
 * Self-contained via hooks — no props needed; safe to render inside
 * SessionProvider since useBoards() fetches /api/boards directly (cross-server,
 * not server-scoped).
 *
 * The previous "hide entirely when zero boards exist AND not on a board route"
 * rule from 4vuv §5 was replaced when the section moved to the top of the
 * sidebar (17m3) — hide-when-empty would shift Servers into and out of the
 * top slot whenever the first/last board materialised.
 */
export function BoardsSection() {
  const { boards } = useBoards();
  const { addToast } = useToast();
  const { orderedBoards, getTileProps, isDragging, draggingName } = useBoardListReorder(
    boards,
    addToast,
  );
  const navigate = useNavigate();
  const activeBoardName = useActiveBoardName();

  const isHintMode = boards.length === 0;

  return (
    <CollapsiblePanel
      title="Boards"
      storageKey="runkit-panel-boards"
      defaultOpen={false}
      contentClassName=""
      headerRight={
        boards.length > 0 ? (
          <span className="text-xs text-text-secondary">{boards.length}</span>
        ) : undefined
      }
    >
      {isHintMode ? (
        <div className="ml-3 px-2 py-2 text-xs text-text-secondary">
          Pin a window to start a board
        </div>
      ) : (
        <ul className="flex flex-col">
          {orderedBoards.map((b) => {
            const isActive = b.name === activeBoardName;
            const drag = getTileProps(b.name);
            const isDragSource = isDragging && draggingName === b.name;
            return (
              <li key={b.name} className="ml-3">
                <button
                  type="button"
                  draggable={drag.draggable}
                  onDragStart={drag.onDragStart}
                  onDragOver={drag.onDragOver}
                  onDragEnd={drag.onDragEnd}
                  onDrop={drag.onDrop}
                  onClick={() => navigate({ to: "/board/$name", params: { name: b.name } })}
                  aria-current={isActive ? "page" : undefined}
                  className={`w-full flex items-center justify-between gap-2 px-2 py-1 text-left transition-colors min-h-[36px] ${
                    isActive
                      ? "bg-bg-card text-text-primary font-medium"
                      : "text-text-secondary hover:text-text-primary hover:bg-bg-card/50"
                  }${isDragSource ? " opacity-50" : ""}`}
                >
                  <span className="truncate text-xs">{b.name}</span>
                  <span className="text-xs text-text-secondary shrink-0">{b.pinCount}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </CollapsiblePanel>
  );
}
