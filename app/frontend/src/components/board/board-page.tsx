import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ToastProvider } from "@/components/toast";
import { useBoardEntries, useBoards } from "@/hooks/use-boards";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { usePaneWidths, BOARD_PANE_DEFAULT_WIDTH } from "@/hooks/use-pane-widths";
import { usePinActions } from "@/hooks/use-pin-actions";
import { ValidBoardName } from "./board-name";
import { BoardPane, type BoardPaneHandle } from "./board-pane";
import { NotFoundPage } from "@/router";

interface BoardPageRouteProps {
  // tanstack-router passes route params via useParams, but for type-safety
  // we read via the route's `useParams` hook below.
}

const SIDEBAR_WIDTH = 240;
const SWIPE_THRESHOLD_PX = 40;

export function BoardPage(_props: BoardPageRouteProps) {
  return (
    <ToastProvider>
      <BoardPageInner />
    </ToastProvider>
  );
}

function BoardPageInner() {
  // Read the board name from the URL path. We use window.location to avoid a
  // tight tanstack-router dependency in the test surface.
  const name = useBoardName();
  if (name === null || !ValidBoardName(name)) {
    return <NotFoundPage />;
  }
  return <BoardPageContent name={name} />;
}

function useBoardName(): string | null {
  // Tanstack router: read from the path /board/<name>
  const [name, setName] = useState<string | null>(() => parseBoardName(window.location.pathname));
  useEffect(() => {
    const onPop = () => setName(parseBoardName(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return name;
}

function parseBoardName(pathname: string): string | null {
  const m = pathname.match(/^\/board\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function BoardPageContent({ name }: { name: string }) {
  const navigate = useNavigate();
  const { entries, isLoading, error } = useBoardEntries(name);
  const { boards } = useBoards();
  const { unpin } = usePinActions();
  const isMobile = useIsMobile();
  const { getWidth, setWidth } = usePaneWidths(name, SIDEBAR_WIDTH);

  const paneRefs = useRef<Array<BoardPaneHandle | null>>([]);
  paneRefs.current = entries.map((_, i) => paneRefs.current[i] ?? null);

  // Focused pane index for keyboard cycling.
  const [focusedIndex, setFocusedIndex] = useState(0);
  useEffect(() => {
    if (focusedIndex >= entries.length && entries.length > 0) setFocusedIndex(0);
  }, [entries.length, focusedIndex]);

  // Carousel index for mobile.
  const [carouselIndex, setCarouselIndex] = useState(0);
  useEffect(() => {
    if (carouselIndex >= entries.length && entries.length > 0) setCarouselIndex(0);
  }, [entries.length, carouselIndex]);

  // Keyboard cycle: Cmd/Ctrl + ] / [
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (entries.length === 0) return;
      if (e.key === "]") {
        e.preventDefault();
        setFocusedIndex((prev) => (prev + 1) % entries.length);
      } else if (e.key === "[") {
        e.preventDefault();
        setFocusedIndex((prev) => (prev - 1 + entries.length) % entries.length);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [entries.length]);

  // Imperative focus when focusedIndex changes.
  useEffect(() => {
    paneRefs.current[focusedIndex]?.focus();
  }, [focusedIndex]);

  // Drag-resize state — separate from the persisted widths; live during drag.
  const dragRef = useRef<{ windowId: string; startX: number; startWidth: number } | null>(null);
  const handleResizeStart = useCallback(
    (windowId: string, clientX: number) => {
      dragRef.current = { windowId, startX: clientX, startWidth: getWidth(windowId) };
      const onMove = (ev: PointerEvent) => {
        if (!dragRef.current) return;
        const delta = ev.clientX - dragRef.current.startX;
        setWidth(dragRef.current.windowId, dragRef.current.startWidth + delta);
      };
      const onUp = () => {
        dragRef.current = null;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [getWidth, setWidth],
  );

  // Mobile swipe handling.
  const swipeStartX = useRef<number | null>(null);
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) swipeStartX.current = e.touches[0].clientX;
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (swipeStartX.current === null) return;
    const endX = e.changedTouches[0]?.clientX ?? swipeStartX.current;
    const delta = endX - swipeStartX.current;
    swipeStartX.current = null;
    if (Math.abs(delta) < SWIPE_THRESHOLD_PX) return;
    if (delta < 0) {
      setCarouselIndex((i) => Math.min(i + 1, entries.length - 1));
    } else {
      setCarouselIndex((i) => Math.max(i - 1, 0));
    }
  };

  const showEmptyState = !isLoading && entries.length === 0;
  const otherBoards = useMemo(() => boards.filter((b) => b.name !== name), [boards, name]);

  return (
    <div className="h-screen w-screen flex bg-bg-primary text-text-primary">
      {/* Minimal sidebar — boards list + back link */}
      <aside
        className="hidden md:flex flex-col shrink-0 border-r border-border w-[240px] p-2 gap-2 overflow-y-auto"
        aria-label="board sidebar"
      >
        <Link
          to="/"
          className="text-sm text-text-secondary hover:text-text-primary px-2 py-1"
        >
          ← Sessions
        </Link>
        <h2 className="text-xs uppercase tracking-wide text-text-secondary px-2 mt-2">Boards</h2>
        {boards.length === 0 ? (
          <p className="text-xs text-text-secondary px-2">Pin a window to start a board</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {boards.map((b) => (
              <li key={b.name}>
                <Link
                  to="/board/$name"
                  params={{ name: b.name }}
                  className={`flex items-center justify-between px-2 py-1 rounded text-sm hover:bg-bg-secondary ${
                    b.name === name ? "bg-bg-secondary text-accent" : "text-text-primary"
                  }`}
                >
                  <span className="truncate">{b.name}</span>
                  <span className="text-text-secondary text-xs">{b.pinCount}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <main className="flex-1 min-w-0 flex flex-col">
        {/* Top bar */}
        <header className="shrink-0 border-b border-border px-3 h-[40px] flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate({ to: "/" })}
            className="text-sm text-text-secondary hover:text-text-primary"
          >
            Board ▸
          </button>
          <span className="text-sm text-text-primary font-medium">{name}</span>
          <BoardSwitcherDropdown
            boards={otherBoards.map((b) => b.name)}
            onSwitchToBoard={(target) => navigate({ to: "/board/$name", params: { name: target } })}
            onSwitchToSessions={() => navigate({ to: "/" })}
          />
          <span className="text-xs text-text-secondary ml-2">(current)</span>
        </header>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-hidden" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
          {error && entries.length === 0 ? (
            <div className="p-4 text-sm text-red-500">Error loading board: {error.message}</div>
          ) : showEmptyState ? (
            <div className="p-4 flex flex-col items-start gap-2">
              <p className="text-sm text-text-secondary">
                No panes pinned to this board yet. Pin a window from the sidebar.
              </p>
              <Link to="/" className="text-sm text-accent hover:underline">
                ← Back to sessions
              </Link>
            </div>
          ) : isMobile ? (
            <MobileCarousel
              entries={entries}
              carouselIndex={carouselIndex}
              onUnpin={(e) => unpin(e.server, e.windowId, name)}
              paneRefs={paneRefs}
              focusedIndex={focusedIndex}
              onPaneClick={setFocusedIndex}
            />
          ) : (
            <DesktopRow
              entries={entries}
              getWidth={(id) => (getWidth(id) || BOARD_PANE_DEFAULT_WIDTH)}
              onResizeStart={handleResizeStart}
              onUnpin={(e) => unpin(e.server, e.windowId, name)}
              paneRefs={paneRefs}
              focusedIndex={focusedIndex}
              onPaneClick={setFocusedIndex}
            />
          )}
        </div>
      </main>
    </div>
  );
}

function BoardSwitcherDropdown({
  boards,
  onSwitchToBoard,
  onSwitchToSessions,
}: {
  boards: string[];
  onSwitchToBoard: (name: string) => void;
  onSwitchToSessions: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-sm text-text-secondary hover:text-text-primary px-1"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        ▾
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-10 bg-bg-secondary border border-border rounded shadow-md py-1 min-w-[160px]">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onSwitchToSessions();
            }}
            className="w-full text-left px-3 py-1 text-sm hover:bg-bg-card"
          >
            ← Sessions
          </button>
          {boards.map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => {
                setOpen(false);
                onSwitchToBoard(b);
              }}
              className="w-full text-left px-3 py-1 text-sm hover:bg-bg-card"
            >
              {b}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function DesktopRow({
  entries,
  getWidth,
  onResizeStart,
  onUnpin,
  paneRefs,
  focusedIndex,
  onPaneClick,
}: {
  entries: ReturnType<typeof useBoardEntries>["entries"];
  getWidth: (windowId: string) => number;
  onResizeStart: (windowId: string, clientX: number) => void;
  onUnpin: (entry: ReturnType<typeof useBoardEntries>["entries"][number]) => void;
  paneRefs: React.MutableRefObject<Array<BoardPaneHandle | null>>;
  focusedIndex: number;
  onPaneClick: (idx: number) => void;
}) {
  return (
    <div className="h-full overflow-x-auto flex gap-1 p-1">
      {entries.map((entry, idx) => (
        <BoardPane
          key={`${entry.server}:${entry.windowId}`}
          ref={(el) => {
            paneRefs.current[idx] = el;
          }}
          entry={entry}
          width={getWidth(entry.windowId)}
          paused={false}
          isFocused={idx === focusedIndex}
          onClick={() => onPaneClick(idx)}
          onUnpin={() => onUnpin(entry)}
          showResizeHandle={true}
          onResizeStart={(clientX) => onResizeStart(entry.windowId, clientX)}
        />
      ))}
    </div>
  );
}

function MobileCarousel({
  entries,
  carouselIndex,
  onUnpin,
  paneRefs,
  focusedIndex,
  onPaneClick,
}: {
  entries: ReturnType<typeof useBoardEntries>["entries"];
  carouselIndex: number;
  onUnpin: (entry: ReturnType<typeof useBoardEntries>["entries"][number]) => void;
  paneRefs: React.MutableRefObject<Array<BoardPaneHandle | null>>;
  focusedIndex: number;
  onPaneClick: (idx: number) => void;
}) {
  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 min-h-0 flex">
        {entries.map((entry, idx) => (
          <div
            key={`${entry.server}:${entry.windowId}`}
            className={`shrink-0 w-full ${idx === carouselIndex ? "block" : "hidden"}`}
          >
            <BoardPane
              ref={(el) => {
                paneRefs.current[idx] = el;
              }}
              entry={entry}
                  width={window.innerWidth}
              paused={idx !== carouselIndex}
              isFocused={idx === focusedIndex}
              onClick={() => onPaneClick(idx)}
              onUnpin={() => onUnpin(entry)}
              showResizeHandle={false}
            />
          </div>
        ))}
      </div>
      {/* Pagination dots */}
      <div className="shrink-0 flex justify-center gap-1.5 py-2">
        {entries.map((_, idx) => (
          <span
            key={idx}
            aria-label={`pane ${idx + 1}${idx === carouselIndex ? " (current)" : ""}`}
            className={`w-2 h-2 rounded-full ${idx === carouselIndex ? "bg-accent" : "bg-text-secondary/30"}`}
          />
        ))}
      </div>
    </div>
  );
}
