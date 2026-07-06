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
import { TopBar, HELP_URL } from "@/components/top-bar";
import { createSession, createWindow as createWindowApi, killServer as killServerApi, createServer } from "@/api/client";
import { Dialog } from "@/components/dialog";
import type { PaletteAction } from "@/components/command-palette";
import { ValidBoardName } from "./board-name";
import { BoardPane, type BoardPaneHandle } from "./board-pane";
import { selectLivePanes } from "./select-live-panes";
import { isWaiting } from "@/lib/waiting";
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

/**
 * Maximum number of desktop board panes that may hold a live relay WebSocket
 * simultaneously, on plaintext (HTTP/1.1) origins. Backstops the
 * IntersectionObserver for the wide-monitor case where more panes are visible
 * at once than the ~6-connection-per-origin ceiling can afford
 * (`1 SSE + 4 relay + headroom`). The focused pane is exempt from this cap.
 */
const MAX_LIVE_RELAY_PANES = 4;

/**
 * Horizontal pre-warm margin for the desktop visibility IntersectionObserver,
 * expressed as an `IntersectionObserver` `rootMargin`. One pane-width on each
 * side keeps a pane live slightly before it enters and slightly after it
 * leaves the strict viewport, so a quick scroll-past does not thrash
 * connect/disconnect (and the `[reconnecting...]` flicker). No debounce — add
 * one only if thrash is observed during Playwright tuning. Vertical margins are
 * 0 because the row is a single horizontal strip.
 */
const RELAY_PREWARM_ROOT_MARGIN = `0px ${BOARD_PANE_DEFAULT_WIDTH}px`;

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

  // `ctx.sessionsByServer` is a fresh Map every SSE tick; read it at click time
  // via a ref so `handleCreateSession` stays referentially stable across ticks.
  // On the board route `currentServer === null`, so this handler is threaded
  // straight into every `ServerGroup` as `onCreateSession` — churning it would
  // defeat `ServerGroup`'s `React.memo` on the whole board sidebar.
  const sessionsByServerRef = useRef(ctx.sessionsByServer);
  sessionsByServerRef.current = ctx.sessionsByServer;
  const handleCreateSession = useCallback(
    (srv: string) => {
      const existingNames = (sessionsByServerRef.current.get(srv) ?? []).map((s) => s.name);
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
    [executeCreateSession],
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

  // Chrome dispatch for the sidebar toggle (below) and the terminal-font palette
  // actions. Lifted here (above boardRouteActions) so the font mutators are in
  // scope for the palette memo.
  const { sidebarOpen } = useChromeState();
  const { setSidebarOpen, increaseTerminalFont, decreaseTerminalFont, resetTerminalFont } = useChromeDispatch();

  // Board-route-scoped command palette actions. Constitution V (Keyboard-First)
  // requires every action be keyboard-reachable — AppShell's palette is not
  // mounted here (the board route does not render AppShell, see DD-8), so
  // BoardPage owns its own palette mount with the entries that are meaningful
  // on a board route: switch to other boards, leave the board view, cycle pane
  // focus, the global terminal-font controls (the board's panes are live
  // terminals; the setting is global), and "View: Refresh Page" (duplicated
  // from AppShell's viewActions — see refreshEntry below). Pin/Unpin Current
  // Window are AppShell-only (no current window exists in single-window sense
  // on a board route).
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

    const fontEntries: PaletteAction[] = [
      // No `shortcut` — Cmd +/- is deliberately not intercepted.
      { id: "terminal-font-increase", label: "Increase terminal font", onSelect: increaseTerminalFont },
      { id: "terminal-font-decrease", label: "Decrease terminal font", onSelect: decreaseTerminalFont },
      { id: "terminal-font-reset", label: "Reset terminal font", onSelect: resetTerminalFont },
    ];

    // Full-page reload — duplicated from AppShell's `viewActions` because the
    // board route mounts its OWN palette (this one) and does NOT render AppShell
    // (DD-8), so AppShell's "View: Refresh Page" is unreachable here. The board
    // is the intake's core degraded-relay recovery scenario (N live relay
    // WebSockets, no top-bar RefreshButton since `currentWindow` is null on a
    // board route), so keyboard-reachable reload matters most here (DD-4).
    const refreshEntry: PaletteAction = {
      id: "refresh-page",
      label: "View: Refresh Page",
      onSelect: () => window.location.reload(),
    };

    // Help docs — duplicated from AppShell's `configActions` for the same
    // reason as refreshEntry: the board route mounts its OWN palette and does
    // NOT render AppShell (DD-8), so AppShell's "Help: Documentation" is
    // unreachable here. The help affordance is route-agnostic (the top-bar
    // HelpLink chip renders on every route), so keeping it keyboard-reachable
    // on `/board/*` too honors constitution V. Shares the exported HELP_URL so
    // the URL can never drift from the chip / AppShell action.
    const helpEntry: PaletteAction = {
      id: "help-documentation",
      label: "Help: Documentation",
      onSelect: () => window.open(HELP_URL, "_blank", "noopener,noreferrer"),
    };

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
      // Keyboard parity for the top-bar board ✕ (Constitution V; 260704-9o7k).
      // Unpins the focused pane (non-destructive) — mirrors `unpinFocused`.
      conditional.push({
        id: "board-unpin-focused",
        label: "Board: Unpin Focused Pane",
        onSelect: () => {
          const e = entries[focusedIndex];
          if (e) unpin(e.server, e.windowId, name);
        },
      });
    }

    return [...switchEntries, ...conditional, ...fontEntries, refreshEntry, helpEntry];
  }, [boards, name, entries, focusedIndex, unpin, navigate, increaseTerminalFont, decreaseTerminalFont, resetTerminalFont]);

  // Pane-server count (distinct servers) used by TopBar board-mode info.
  const serverCount = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) set.add(e.server);
    return set.size;
  }, [entries]);

  // Attention rollup (260706-y1ar; status-pyramid.md § Attention Propagation).
  // A `BoardEntry` is a thin shape with no `agentState`, so join each pinned
  // pane back to its live `WindowInfo` via (server, windowId) against the
  // streamed `sessionsByServer`. use-boards attaches every board server, so this
  // window data (incl. `agentState`) is flowing for board panes. The set drives
  // both the per-pane pulsing seam and the header waiting count. A pane whose
  // window is not yet in the snapshot is simply not waiting (no wrong signal).
  const waitingWindowIds = useMemo(() => {
    // Build the set of waiting window keys once per distinct board server
    // (scan each server's windows a single time, not per-entry), then keep
    // only the keys that a board entry pins. Avoids the O(entries × windows)
    // flatMap-then-find that re-scanned + re-allocated per entry on every SSE
    // tick.
    const waitingKeys = new Set<string>();
    const seenServers = new Set<string>();
    for (const e of entries) {
      if (seenServers.has(e.server)) continue;
      seenServers.add(e.server);
      for (const s of ctx.sessionsByServer.get(e.server) ?? []) {
        for (const w of s.windows) {
          if (isWaiting(w)) waitingKeys.add(`${e.server}:${w.windowId}`);
        }
      }
    }
    const set = new Set<string>();
    for (const e of entries) {
      const key = `${e.server}:${e.windowId}`;
      if (waitingKeys.has(key)) set.add(key);
    }
    return set;
  }, [entries, ctx.sessionsByServer]);
  const waitingPaneCount = waitingWindowIds.size;

  // Connection dot (260704-9o7k): "this board's live data is flowing". Green
  // only when the board has entries AND every distinct attached server's SSE
  // slice is connected (binary AND — a single disconnected server flips it
  // gray; a zero-entry board is gray, nothing is flowing).
  const boardConnected = useMemo(() => {
    const servers = new Set<string>();
    for (const e of entries) servers.add(e.server);
    if (servers.size === 0) return false;
    for (const s of servers) {
      if (!ctx.isConnectedByServer.get(s)) return false;
    }
    return true;
  }, [entries, ctx.isConnectedByServer]);

  // Board ✕ = unpin the focused pane (non-destructive). Distinct from the tmux
  // pane-kill the terminal ✕ does — a top-bar button that killed whatever agent
  // happens to be focused would be an expensive misclick; kill stays in the
  // pane's own UI. Shared by the top-bar ✕ and the palette action below.
  const unpinFocused = useCallback(() => {
    const e = entries[focusedIndex];
    if (e) unpin(e.server, e.windowId, name);
  }, [entries, focusedIndex, unpin, name]);

  // sidebarOpen drives the hamburger animation; setSidebarOpen handles the
  // toggle and mobile destination-tap auto-close. Both are destructured above
  // (alongside the terminal-font mutators) so AppShell and BoardPage share one
  // ChromeContext toggle target.

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

  // Stable select-window handler (R6a). BoardPage consumes `useSessionContext()`
  // and re-renders on every SSE tick; an inline arrow here would defeat
  // `ServerGroup`'s `React.memo`. `navigate`/`isMobile`/`setSidebarOpen` are all
  // stable across SSE ticks.
  const handleSelectWindow = useCallback(
    (srv: string, _sess: string, windowId: string) => {
      // Identity is window-id only on the 2-segment route.
      navigate({
        to: "/$server/$window",
        params: { server: srv, window: windowId },
      });
      if (isMobile) setSidebarOpen(false);
    },
    [navigate, isMobile, setSidebarOpen],
  );

  // Sidebar element shared between desktop grid placement and mobile overlay.
  // `currentServer = null` because the board route has no `$server` param —
  // no group is marked current and all server groups follow persisted toggles.
  const sidebarElement = (
    <Sidebar
      currentServer={null}
      currentSession={null}
      currentWindowId={null}
      onSelectWindow={handleSelectWindow}
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
            this single TopBar invocation. L1 terminal-only chrome (split,
            fixed-width) is hidden by passing `currentWindow={null}`. The board
            keeps the L2 pair: the terminal-font Aa (board panes are terminals)
            and the ✕ — repurposed to UNPIN THE FOCUSED PANE (`onCloseFocused`,
            260704-9o7k), a non-destructive move-out, NOT a tmux kill; per-pane
            kill/unpin still live on each `BoardPane`. */}
        <header style={{ gridArea: "topbar" }}>
          <TopBar
            mode="board"
            sessions={[]}
            currentSession={null}
            currentWindow={null}
            sessionName=""
            windowName=""
            isConnected={boardConnected}
            sidebarOpen={sidebarOpen}
            server=""
            onNavigate={() => {}}
            onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
            onCreateSession={() => {}}
            onCreateWindow={() => {}}
            boardName={name}
            paneCount={entries.length}
            serverCount={serverCount}
            waitingPaneCount={waitingPaneCount}
            boards={boards.map((b) => ({ name: b.name }))}
            onCloseFocused={unpinFocused}
            closeDisabled={entries.length === 0}
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
              waitingWindowIds={waitingWindowIds}
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
              waitingWindowIds={waitingWindowIds}
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
          className="border-t-[3px] border-border px-1.5 h-[48px]"
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
  waitingWindowIds,
}: {
  entries: ReturnType<typeof useBoardEntries>["entries"];
  getWidth: (windowId: string) => number;
  onResizeStart: (windowId: string, clientX: number) => void;
  onUnpin: (entry: ReturnType<typeof useBoardEntries>["entries"][number]) => void;
  paneRefs: React.MutableRefObject<Array<BoardPaneHandle | null>>;
  focusedIndex: number;
  onPaneClick: (idx: number) => void;
  scrollLocked: boolean;
  /** (server:windowId) keys of panes whose joined window is `waiting`. */
  waitingWindowIds: Set<string>;
}) {
  const rowRef = useRef<HTMLDivElement>(null);

  // Relay-suspension feature is plaintext-only: the ~6-connection-per-origin
  // ceiling is an HTTP/1.1 artifact. Over HTTPS/h2 (production via Tailscale)
  // it does not exist, so behavior there is exactly today's (`paused={false}`,
  // no observer, no cap). `window.location.protocol === "http:"` classifies the
  // E2E/dev path (`http://localhost:3020`) and raw-port access as plaintext.
  const plaintext = typeof window !== "undefined" && window.location.protocol === "http:";

  // Per-pane root DOM elements, keyed by pane index, for the IntersectionObserver
  // to observe. Distinct from `paneRefs` (which holds the imperative
  // `BoardPaneHandle` for `focus()`); BoardPane exposes its root element via the
  // separate `rootRef` callback prop so neither contract leaks into the other.
  const paneElsRef = useRef<Map<number, HTMLDivElement>>(new Map());

  // Indices currently within the viewport (incl. pre-warm margin). Only tracked
  // on plaintext origins; on secure origins it stays empty and is unused.
  const [visibleIndices, setVisibleIndices] = useState<Set<number>>(new Set());

  // Most-recently-focused pane order (most-recent first), used to break ties
  // when more panes are visible than the live-pane cap allows. The ref is the
  // persistent backing store; we fold the current `focusedIndex` to the front
  // during render (via useMemo keyed on focusedIndex) rather than in a post-commit
  // effect, so the order consumed by `selectLivePanes` below is never one render
  // stale — cap eviction always sees the focused pane as most-recent immediately.
  const mruRef = useRef<number[]>([]);
  const mruOrder = useMemo(() => {
    const next = [focusedIndex, ...mruRef.current.filter((i) => i !== focusedIndex)];
    mruRef.current = next;
    return next;
  }, [focusedIndex]);

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

  // Visibility tracking via IntersectionObserver, rooted on the horizontal-scroll
  // container (plaintext origins only). Mirrors the wheel effect's setup/cleanup
  // discipline. Re-runs when the pane count changes so newly-added panes are
  // observed and removed panes drop out of the visible set. On secure origins
  // the observer is never created — every pane stays live (today's behavior).
  useEffect(() => {
    if (!plaintext) return;
    const root = rowRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (records) => {
        setVisibleIndices((prev) => {
          const next = new Set(prev);
          for (const record of records) {
            const target = record.target;
            if (!(target instanceof HTMLElement)) continue;
            const attr = target.dataset.paneIndex;
            if (attr === undefined) continue;
            const idx = Number(attr);
            if (record.isIntersecting) next.add(idx);
            else next.delete(idx);
          }
          return next;
        });
      },
      { root, rootMargin: RELAY_PREWARM_ROOT_MARGIN, threshold: 0 },
    );
    for (const el of paneElsRef.current.values()) observer.observe(el);
    return () => observer.disconnect();
  }, [plaintext, entries.length]);

  // Compute the live-pane set. On secure origins, every pane is live (feature
  // off). On plaintext origins, the focused pane plus the most-recently-focused
  // visible panes are live, capped at MAX_LIVE_RELAY_PANES.
  const livePanes = plaintext
    ? selectLivePanes({
        visible: visibleIndices,
        focusedIndex,
        mruOrder,
        cap: MAX_LIVE_RELAY_PANES,
      })
    : null;

  return (
    <div ref={rowRef} className="h-full w-full overflow-x-auto flex gap-1 p-1">
      {entries.map((entry, idx) => (
        <BoardPane
          key={`${entry.server}:${entry.windowId}`}
          ref={(el) => {
            paneRefs.current[idx] = el;
          }}
          rootRef={(el) => {
            if (el) {
              el.dataset.paneIndex = String(idx);
              paneElsRef.current.set(idx, el);
            } else {
              paneElsRef.current.delete(idx);
            }
          }}
          entry={entry}
          width={getWidth(entry.windowId)}
          paused={livePanes === null ? false : !livePanes.has(idx)}
          isFocused={idx === focusedIndex}
          waiting={waitingWindowIds.has(`${entry.server}:${entry.windowId}`)}
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
  waitingWindowIds,
}: {
  entries: ReturnType<typeof useBoardEntries>["entries"];
  carouselIndex: number;
  onUnpin: (entry: ReturnType<typeof useBoardEntries>["entries"][number]) => void;
  paneRefs: React.MutableRefObject<Array<BoardPaneHandle | null>>;
  focusedIndex: number;
  onPaneClick: (idx: number) => void;
  scrollLocked: boolean;
  /** (server:windowId) keys of panes whose joined window is `waiting`. */
  waitingWindowIds: Set<string>;
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
              waiting={waitingWindowIds.has(`${entry.server}:${entry.windowId}`)}
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
