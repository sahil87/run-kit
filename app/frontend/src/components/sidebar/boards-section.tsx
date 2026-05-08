import { useNavigate } from "@tanstack/react-router";
import { useBoards } from "@/hooks/use-boards";
import { useActiveBoardName } from "@/hooks/use-active-board";
import { CollapsiblePanel } from "./collapsible-panel";

/**
 * BoardsSection renders the cross-server boards list above the Sessions
 * tree. Visibility:
 *   - hidden when zero boards exist AND the user is not on a /board/<name> route
 *   - shown with the "Pin a window to start a board" hint when zero boards
 *     exist AND the user is on a /board/<name> route (the board they were
 *     viewing was just emptied)
 *   - otherwise: shown with one row per board
 *
 * Click a row → navigate to /board/<name>.
 *
 * Self-contained via hooks — no props needed; safe to render inside
 * SessionProvider since useBoards() fetches /api/boards directly (cross-server,
 * not server-scoped).
 */
export function BoardsSection() {
  const { boards } = useBoards();
  const navigate = useNavigate();
  const activeBoardName = useActiveBoardName();

  // Visibility rule: hide entirely when zero boards AND not on a board route.
  if (boards.length === 0 && !activeBoardName) {
    return null;
  }

  // Empty + on-board-route → show the hint instead of rows
  const isHintMode = boards.length === 0 && !!activeBoardName;

  return (
    <CollapsiblePanel
      title="Boards"
      storageKey="runkit-panel-boards"
      defaultOpen={false}
      contentClassName="py-1"
      headerRight={
        boards.length > 0 ? (
          <span className="text-xs text-text-secondary">{boards.length}</span>
        ) : undefined
      }
    >
      {isHintMode ? (
        <div className="px-3 py-2 text-xs text-text-secondary">
          Pin a window to start a board
        </div>
      ) : (
        <ul className="flex flex-col">
          {boards.map((b) => {
            const isActive = b.name === activeBoardName;
            return (
              <li key={b.name}>
                <button
                  type="button"
                  onClick={() => navigate({ to: "/board/$name", params: { name: b.name } })}
                  aria-current={isActive ? "page" : undefined}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-1 text-sm text-left transition-colors min-h-[36px] ${
                    isActive
                      ? "bg-bg-card text-text-primary font-medium"
                      : "text-text-secondary hover:text-text-primary hover:bg-bg-card/50"
                  }`}
                >
                  <span className="truncate">{b.name}</span>
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

