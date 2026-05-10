import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useBoardEntries, useBoards } from "@/hooks/use-boards";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { usePaneWidths, BOARD_PANE_DEFAULT_WIDTH } from "@/hooks/use-pane-widths";
import { usePinActions } from "@/hooks/use-pin-actions";
import { useOptimisticAction } from "@/hooks/use-optimistic-action";
import { useOptimisticContext } from "@/contexts/optimistic-context";
import { useSessionContext } from "@/contexts/session-context";
import { useChromeState, useChromeDispatch } from "@/contexts/chrome-context";
import { useFocusedTerminal } from "@/contexts/focused-terminal-context";
import { useToast } from "@/components/toast";
import { BottomBar } from "@/components/bottom-bar";
import { Shell } from "@/components/shell/shell";
import { Sidebar } from "@/components/sidebar";
import { TopBar } from "@/components/top-bar";
import { createSession, createWindow as createWindowApi, killServer as killServerApi, createServer } from "@/api/client";
import { Dialog } from "@/components/dialog";
import type { PaletteAction } from "@/components/command-palette";
import { ValidBoardName } from "./board-name";
import { BoardPane, type BoardPaneHandle } from "./board-pane";
import { NotFoundPage } from "@/router";

const CommandPalette = lazy(() =>
  import("@/components/command-palette").then((m) => ({ default: m.CommandPalette })),
);

interface BoardPageRouteProps {
  // tanstack-router passes route params via useParams, but for type-safety
  // we read via the route's `useParams` hook below.
}

/**
 * Default per-pane width seed used by the local pane-widths hook when a
 * board has no persisted per-pane widths yet. Decoupled from the sidebar
 * width (now lifted to ChromeContext); BoardPage no longer drives the
 * sidebar's own column width.
 */
const PANE_WIDTH_SEED = 240;
const SWIPE_THRESHOLD_PX = 40;

export function BoardPage(_props: BoardPageRouteProps) {
  // ToastProvider, SessionProvider, and OptimisticProvider are mounted by
  // RootWrapper above all routes — no per-route wrapping needed here.
  return <BoardPageInner />;
}

function BoardPageInner() {
  // Read the board name from the route params via TanStack Router. boardRoute
  // isn't exported from router.tsx (avoiding a circular import via app.tsx →
  // router.tsx), so use `strict: false` and narrow the type ourselves.
  const params = useParams({ strict: false }) as { name?: string };
  const name = typeof params.name === "string" ? params.name : null;
  if (name === null || !ValidBoardName(name)) {
    return <NotFoundPage />;
  }
  return <BoardPageContent name={name} />;
}

function BoardPageContent({ name }: { name: string }) {
  const navigate = useNavigate();
  const { entries, isLoading, error } = useBoardEntries(name);
  const { boards } = useBoards();
  const { unpin } = usePinActions();
  const isMobile = useIsMobile();
  const { getWidth, setWidth } = usePaneWidths(name, PANE_WIDTH_SEED);

  // Session/window/server creation handlers — match AppShell's wiring so the
  // unified Sidebar can fire the same optimistic flows on the board route.
  const ctx = useSessionContext();
  const { addToast } = useToast();
  const { addGhostSession, addGhostServer, removeGhost } = useOptimisticContext();
  const ghostSessionIdRef = useRef<string | null>(null);
  const ghostServerIdRef = useRef<string | null>(null);
  const [showCreateServerDialog, setShowCreateServerDialog] = useState(false);
  const [createServerName, setCreateServerName] = useState("");
  const [killServerTarget, setKillServerTarget] = useState<string | null>(null);

  const { execute: executeCreateSession } = useOptimisticAction<[string, string, string | undefined]>({
    action: (srv, sessName, cwd) => createSession(srv, sessName, cwd),
    onOptimistic: (srv, sessName) => {
      ghostSessionIdRef.current = addGhostSession(srv, sessName);
    },
    onRollback: () => {
      if (ghostSessionIdRef.current) {
        removeGhost(ghostSessionIdRef.current);
        ghostSessionIdRef.current = null;
      }
    },
    onError: (err) => addToast(err.message || "Failed to create session"),
    onSettled: () => { ghostSessionIdRef.current = null; },
  });

  const { execute: executeCreateWindow } = useOptimisticAction<[string, string]>({
    action: (srv, sess) => createWindowApi(srv, sess, "zsh"),
    onError: (err) => addToast(err.message || "Failed to create window"),
  });

  const { execute: executeCreateServer } = useOptimisticAction<[string]>({
    action: (n) => createServer(n),
    onOptimistic: (n) => { ghostServerIdRef.current = addGhostServer(n); },
    onRollback: () => {
      if (ghostServerIdRef.current) {
        removeGhost(ghostServerIdRef.current);
        ghostServerIdRef.current = null;
      }
    },
    onError: (err) => addToast(err.message || "Failed to create server"),
    onSettled: () => { ghostServerIdRef.current = null; },
  });

  const { execute: executeKillServer } = useOptimisticAction<[string]>({
    action: (n) => killServerApi(n),
    onError: (err) => addToast(err.message || "Failed to kill server"),
  });

  const handleCreateSession = useCallback(
    (srv: string) => {
      const existingNames = (ctx.sessionsByServer.get(srv) ?? []).map((s) => s.name);
      const base = "session";
      let candidate = base;
      const set = new Set(existingNames);
      let i = 2;
      while (set.has(candidate)) {
        candidate = `${base}-${i++}`;
        if (i > 99) break;
      }
      executeCreateSession(srv, candidate, undefined);
    },
    [ctx.sessionsByServer, executeCreateSession],
  );

  const handleCreateWindow = useCallback(
    (srv: string, session: string) => executeCreateWindow(srv, session),
    [executeCreateWindow],
  );

  const handleCreateServerSubmit = useCallback(() => {
    const trimmed = createServerName.trim();
    if (!trimmed || !/^[a-zA-Z0-9_-]+$/.test(trimmed)) return;
    executeCreateServer(trimmed);
    setShowCreateServerDialog(false);
    setCreateServerName("");
  }, [createServerName, executeCreateServer]);

  const handleKillServer = useCallback(() => {
    if (!killServerTarget) return;
    executeKillServer(killServerTarget);
    setKillServerTarget(null);
  }, [killServerTarget, executeKillServer]);

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
  // Handlers live in refs so an unmount cleanup or a `pointercancel` (e.g.
  // OS gesture interrupt, route change mid-drag) can remove them — without
  // this, the listeners stayed attached on `window` and kept calling
  // `setWidth` on a stale closure.
  const dragRef = useRef<{ windowId: string; startX: number; startWidth: number } | null>(null);
  const dragMoveRef = useRef<((ev: PointerEvent) => void) | null>(null);
  const dragEndRef = useRef<(() => void) | null>(null);

  const cleanupDragListeners = useCallback(() => {
    if (dragMoveRef.current) {
      window.removeEventListener("pointermove", dragMoveRef.current);
      dragMoveRef.current = null;
    }
    if (dragEndRef.current) {
      window.removeEventListener("pointerup", dragEndRef.current);
      window.removeEventListener("pointercancel", dragEndRef.current);
      dragEndRef.current = null;
    }
    dragRef.current = null;
  }, []);

  const handleResizeStart = useCallback(
    (windowId: string, clientX: number) => {
      // Defensive: clear any prior drag's listeners before starting a new one.
      cleanupDragListeners();
      dragRef.current = { windowId, startX: clientX, startWidth: getWidth(windowId) };
      const onMove = (ev: PointerEvent) => {
        if (!dragRef.current) return;
        const delta = ev.clientX - dragRef.current.startX;
        setWidth(dragRef.current.windowId, dragRef.current.startWidth + delta);
      };
      const onEnd = () => {
        cleanupDragListeners();
      };
      dragMoveRef.current = onMove;
      dragEndRef.current = onEnd;
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onEnd);
      window.addEventListener("pointercancel", onEnd);
    },
    [getWidth, setWidth, cleanupDragListeners],
  );

  // Unmount cleanup — if the user navigates away mid-drag, remove the global
  // listeners so they don't leak past component lifetime.
  useEffect(() => cleanupDragListeners, [cleanupDragListeners]);

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

  // Board-route-scoped command palette actions. Constitution V (Keyboard-First)
  // requires the palette be reachable on every route — AppShell's palette is
  // not mounted here (the board route does not render AppShell, see DD-8), so
  // BoardPage owns its own palette mount with the entries that are meaningful
  // on a board route: switch to other boards, leave the board view, and cycle
  // pane focus. Pin/Unpin Current Window are AppShell-only (no current window
  // exists in single-window sense on a board route).
  const boardRouteActions: PaletteAction[] = useMemo(() => {
    const switchEntries: PaletteAction[] = boards.map((b) => ({
      id: `board-switch-${b.name}`,
      label: `Board: Switch to ${b.name}${b.name === name ? " (current)" : ""}`,
      onSelect: () => navigate({ to: "/board/$name", params: { name: b.name } }),
    }));

    const conditional: PaletteAction[] = [
      {
        id: "board-leave",
        label: "Board: Leave Board View",
        onSelect: () => navigate({ to: "/" }),
      },
    ];

    if (entries.length > 0) {
      conditional.push({
        id: "board-cycle-next",
        label: "Board: Cycle Pane Focus →",
        onSelect: () => {
          setFocusedIndex((prev) => (prev + 1) % entries.length);
        },
      });
      conditional.push({
        id: "board-cycle-prev",
        label: "Board: Cycle Pane Focus ←",
        onSelect: () => {
          setFocusedIndex((prev) => (prev - 1 + entries.length) % entries.length);
        },
      });
    }

    return [...switchEntries, ...conditional];
  }, [boards, name, entries.length, navigate]);

  // Pane-server count (distinct servers) used by TopBar board-mode info.
  const serverCount = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) set.add(e.server);
    return set.size;
  }, [entries]);

  // Derive sidebarOpen for the hamburger animation; setSidebarOpen for toggle
  // and mobile destination-tap auto-close. Lifted to ChromeContext so AppShell
  // and BoardPage share one toggle target.
  const { sidebarOpen } = useChromeState();
  const { setSidebarOpen } = useChromeDispatch();

  // Compose / focus / scroll-lock plumbing for the shell-level BottomBar.
  // BottomBar is byte-identical across routes per spec § Behavioral
  // Correctness, so the board route MUST pass the same callback set as
  // AppShell — otherwise the `>_` compose button is gated out (BottomBar
  // renders compose iff `onOpenCompose` is truthy) and `ScrollLock` long-press
  // never reaches a handler. Compose state is owned by `FocusedTerminalContext`
  // so opening the buffer here surfaces it inside the focused `BoardPane`'s
  // `TerminalClient` (the only one rendering ComposeBuffer when its
  // `isFocused && composeOpen` gate matches).
  const { setComposeOpen } = useFocusedTerminal();
  const [scrollLocked, setScrollLocked] = useState(false);
  const focusFocusedPaneRef = useRef<(() => void) | null>(null);
  // Track the currently-focused pane's imperative focus method so BottomBar's
  // "Show keyboard" handler can re-focus the right xterm. The focused pane
  // updates this on each focusedIndex change.
  useEffect(() => {
    focusFocusedPaneRef.current = () => paneRefs.current[focusedIndex]?.focus();
  }, [focusedIndex]);

  // Sidebar element shared between desktop grid placement and mobile overlay.
  // `currentServer = null` because the board route has no `$server` param —
  // no group is marked current and all server groups follow persisted toggles.
  const sidebarElement = (
    <Sidebar
      currentServer={null}
      currentSession={null}
      currentWindowIndex={null}
      onSelectWindow={(srv, sess, idx) => {
        navigate({
          to: "/$server/$session/$window",
          params: { server: srv, session: sess, window: String(idx) },
        });
        if (isMobile) setSidebarOpen(false);
      }}
      onCreateWindow={handleCreateWindow}
      onCreateSession={handleCreateSession}
      onCreateServer={() => setShowCreateServerDialog(true)}
      onKillServer={(n) => setKillServerTarget(n)}
    />
  );

  return (
    <div className="bg-bg-primary text-text-primary">
      <Shell sidebarChildren={sidebarElement}>
        {/* Sidebar grid area (desktop only — Shell removes it on mobile). The
            board route shares the unified Sidebar with AppShell; drag-resize
            is intentionally omitted here for now (the column width still
            comes from ChromeContext). */}
        {!isMobile && sidebarOpen && (
          <aside
            style={{ gridArea: "sidebar" }}
            className="overflow-hidden border-r border-border"
            aria-label="board sidebar"
          >
            {sidebarElement}
          </aside>
        )}

        {/* Top bar grid area — board mode renders the breadcrumb dropdown +
            inline pane/server count + cycle hint inside `<TopBar>`. The
            previous bespoke `<header>` (Board ▸ {name} ▾) is replaced by
            this single TopBar invocation. Right-section chrome (split,
            close-pane, fixed-width, theme toggle, ⌘K, compose) is hidden
            implicitly by passing `currentWindow={null}` so SplitButton /
            ClosePaneButton do not render — board panes carry their own
            unpin/close affordances. */}
        <header style={{ gridArea: "topbar" }}>
          <TopBar
            mode="board"
            sessions={[]}
            currentSession={null}
            currentWindow={null}
            sessionName=""
            windowName=""
            isConnected={false}
            sidebarOpen={sidebarOpen}
            server=""
            onNavigate={() => {}}
            onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
            onCreateSession={() => {}}
            onCreateWindow={() => {}}
            boardName={name}
            paneCount={entries.length}
            serverCount={serverCount}
            boards={boards.map((b) => ({ name: b.name }))}
          />
        </header>

        {/* Content grid area — horizontal-scroll body. Viewport begins
            flush with sidebar.right (no left gutter). */}
        <main
          style={{ gridArea: "content" }}
          className="min-w-0 overflow-hidden"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
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
              scrollLocked={scrollLocked}
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
              scrollLocked={scrollLocked}
            />
          )}
        </main>

        {/* Bottom bar grid area — shell-level. Reads focused terminal from
            FocusedTerminalContext (BoardPane registers when its `isFocused`
            prop becomes true). New on the board route in 17m3 — pre-change
            board route had no BottomBar.
            Callbacks mirror AppShell so the bar is byte-identical across
            routes (spec § Behavioral Correctness, A-022) — without these
            the `>_` compose button is gated out and the long-press
            scroll-lock affordance is inert. */}
        <footer
          style={{ gridArea: "bottombar" }}
          className="border-t border-border px-1.5 h-[48px]"
        >
          <BottomBar
            onOpenCompose={() => setComposeOpen(true)}
            onFocusTerminal={() => focusFocusedPaneRef.current?.()}
            onScrollLockChange={setScrollLocked}
          />
        </footer>
      </Shell>

      {/* Command palette — board-route mount. The board route does NOT render
          AppShell (DD-8), so AppShell's palette is unreachable here. Mounting
          a second instance with board-scoped actions satisfies Constitution V
          (Keyboard-First) by keeping every board-route action reachable via
          Cmd+K. */}
      <Suspense fallback={null}>
        <CommandPalette actions={boardRouteActions} />
      </Suspense>

      {/* Server create/kill dialogs — wired so the unified Sidebar's "+ tmux
          server" and "kill server" affordances work on the board route too. */}
      {showCreateServerDialog && (
        <Dialog title="Create tmux server" onClose={() => { setShowCreateServerDialog(false); setCreateServerName(""); }}>
          <input
            autoFocus
            type="text"
            value={createServerName}
            onChange={(e) => setCreateServerName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreateServerSubmit()}
            onFocus={(e) => e.target.select()}
            aria-label="Server name"
            placeholder="Server name..."
            className="w-full bg-transparent text-text-primary p-2 border border-border rounded outline-none placeholder:text-text-secondary"
          />
          <p className="text-xs text-text-secondary mt-1.5">
            Alphanumeric, hyphens, and underscores only.
          </p>
          <button
            onClick={handleCreateServerSubmit}
            disabled={!createServerName.trim() || !/^[a-zA-Z0-9_-]+$/.test(createServerName.trim())}
            className="mt-2.5 w-full py-1.5 bg-bg-card border border-border rounded hover:border-text-secondary disabled:opacity-50"
          >
            Create
          </button>
        </Dialog>
      )}

      {killServerTarget && (
        <Dialog title="Kill tmux server?" onClose={() => setKillServerTarget(null)}>
          <p className="text-text-secondary mb-2.5">
            Kill server <strong>{killServerTarget}</strong> and all its sessions? This cannot be undone.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setKillServerTarget(null)}
              className="flex-1 py-1.5 border border-border rounded hover:border-text-secondary"
            >
              Cancel
            </button>
            <button
              onClick={handleKillServer}
              className="flex-1 py-1.5 bg-red-900/30 border border-red-900 rounded hover:bg-red-900/50"
            >
              Kill
            </button>
          </div>
        </Dialog>
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
  scrollLocked,
}: {
  entries: ReturnType<typeof useBoardEntries>["entries"];
  getWidth: (windowId: string) => number;
  onResizeStart: (windowId: string, clientX: number) => void;
  onUnpin: (entry: ReturnType<typeof useBoardEntries>["entries"][number]) => void;
  paneRefs: React.MutableRefObject<Array<BoardPaneHandle | null>>;
  focusedIndex: number;
  onPaneClick: (idx: number) => void;
  scrollLocked: boolean;
}) {
  const rowRef = useRef<HTMLDivElement>(null);

  // Translate horizontal wheel intent (trackpad two-finger pan, or shift+wheel
  // which browsers deliver as deltaX) into row scroll. Vertical wheels bubble
  // through to xterm so per-pane scrollback still works.
  //
  // Capture phase: xterm.js attaches a bubble-phase wheel listener on its
  // viewport that scrolls scrollback and stops further handling, so a focused
  // terminal swallows the event before it reaches the row in the bubble path.
  // Capture runs ancestor-first, so we see the event before xterm and can
  // preventDefault() on horizontal intent.
  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
        el.scrollLeft += e.deltaX;
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => el.removeEventListener("wheel", onWheel, { capture: true });
  }, []);

  return (
    <div ref={rowRef} className="h-full w-full overflow-x-auto flex gap-1 p-1">
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
          scrollLocked={scrollLocked}
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
  scrollLocked,
}: {
  entries: ReturnType<typeof useBoardEntries>["entries"];
  carouselIndex: number;
  onUnpin: (entry: ReturnType<typeof useBoardEntries>["entries"][number]) => void;
  paneRefs: React.MutableRefObject<Array<BoardPaneHandle | null>>;
  focusedIndex: number;
  onPaneClick: (idx: number) => void;
  scrollLocked: boolean;
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
              // No `width` prop — mobile carousel uses CSS (`w-full`) so the
              // pane stays reactive to viewport changes (orientation/resize)
              // and works in non-browser environments (SSR/tests). Reading
              // `window.innerWidth` at render time would lock the value at
              // first render and break on rotation.
              paused={idx !== carouselIndex}
              isFocused={idx === focusedIndex}
              onClick={() => onPaneClick(idx)}
              onUnpin={() => onUnpin(entry)}
              showResizeHandle={false}
              scrollLocked={scrollLocked}
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
