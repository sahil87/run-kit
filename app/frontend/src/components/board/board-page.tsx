import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useRouter } from "@tanstack/react-router";
import { useBoardEntries, useBoards } from "@/hooks/use-boards";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { usePaneWidths, BOARD_PANE_DEFAULT_WIDTH } from "@/hooks/use-pane-widths";
import { useBoardAutofit } from "@/hooks/use-board-autofit";
import { usePinActions } from "@/hooks/use-pin-actions";
import { useOptimisticAction } from "@/hooks/use-optimistic-action";
import { useOptimisticContext } from "@/contexts/optimistic-context";
import { useSessionContext, useUpdateNotification } from "@/contexts/session-context";
import { useChromeState, useChromeDispatch } from "@/contexts/chrome-context";
import { useToast } from "@/components/toast";
import { BottomBar } from "@/components/bottom-bar";
import { ComposeStrip } from "@/components/compose-strip";
import { Shell } from "@/components/shell/shell";
import { Sidebar } from "@/components/sidebar";
import { HELP_URL } from "@/components/top-bar";
import { useRegisterTopBarSlot } from "@/contexts/top-bar-slot-context";
import { createSession, createWindow as createWindowApi, killServer as killServerApi, createServer, splitWindow, killWindow } from "@/api/client";
import { setBoardOrder } from "@/api/boards";
import { computeMoveOrder } from "@/lib/palette-move";
import { buildNavActions } from "@/lib/palette-nav";
import { buildUpdateActions, buildMaintenanceActions } from "@/lib/palette-update";
import { buildVersionAction, displayVersion } from "@/lib/palette-version";
import { copyToClipboard } from "@/lib/clipboard";
import { Dialog } from "@/components/dialog";
import type { PaletteAction } from "@/components/command-palette";
import { ValidBoardName } from "./board-name";
import { BoardPane, type BoardPaneHandle } from "./board-pane";
import { selectLivePanes } from "./select-live-panes";
import { useBoardPaneReorder } from "@/hooks/use-board-pane-reorder";
import { computeMoveNeighbors, focusedIndexForKey, shouldFocusPane } from "@/lib/board-reorder";
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
  const router = useRouter();
  const { entries, isLoading, error, refetch } = useBoardEntries(name);
  const { boards } = useBoards();
  const { unpin, reorder } = usePinActions();
  const isMobile = useIsMobile();
  const { getWidth, setWidth } = usePaneWidths(name, PANE_WIDTH_SEED);
  // Per-board desktop autofit (738w). When on, DesktopRow lays panes out as
  // equal-share flex items filling the row; stored per-pane widths are left
  // untouched so toggling off restores the hand-tuned layout.
  const { autofit, toggleAutofit } = useBoardAutofit(name);

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
    action: (srv, sess) => createWindowApi(srv, sess),
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

  // Focused pane index for keyboard cycling. The index drives the focus RING
  // (`isFocused={authIdx === focusedIndex}`) and imperative xterm focus. But a
  // raw index is not stable across reorders: with `paneRefs` keyed to the
  // authoritative order, focusing `paneRefs.current[index]` after an order
  // change (own reorder echo, or a reorder from another client) routes DOM
  // focus into the DISPLACED NEIGHBOUR's terminal. So focus is tracked by the
  // focused pane's `server:windowId` KEY (`focusedKeyRef`); the index is
  // reconciled from the key whenever the order changes (rework must-fix #3).
  const [focusedIndex, setFocusedIndex] = useState(0);
  const focusedKeyRef = useRef<string | null>(null);
  // Signature of the previous authoritative order, to distinguish an
  // ORDER-changed render (index must follow key) from a user-intent index
  // change (key must follow index) within the single focus effect below.
  const prevOrderSigRef = useRef<string | null>(null);
  // Previously-focused index, to gate the imperative `.focus()` on the index
  // ACTUALLY CHANGING (user intent) vs. a passive SSE refetch that leaves the
  // focused pane put. Seeded to the initial `focusedIndex` (0) so the first
  // settled render on board load does NOT auto-focus pane 0's terminal. See
  // `shouldFocusPane` and the "SSE must not steal focus" invariant
  // (`docs/memory/run-kit/ui-patterns.md` § Keyboard Navigation).
  const prevFocusedIndexRef = useRef(0);

  // Single focus authority: keeps `focusedKeyRef` synced, reconciles the index
  // to the key when the order shifts, and imperatively focuses the terminal —
  // always by KEY so a keystroke lands in the intended pane both on the
  // optimistic move (order not yet echoed) and after the authoritative order
  // settles. Imperative focus fires ONLY on user intent (index change) — a
  // `board-changed` SSE refetch alone must not yank DOM focus into a terminal
  // (cycle-2 must-fix #1).
  useEffect(() => {
    const keys = entries.map((e) => `${e.server}:${e.windowId}`);
    const sig = keys.join("|");
    const orderChanged = prevOrderSigRef.current !== sig;
    prevOrderSigRef.current = sig;

    if (orderChanged && focusedKeyRef.current !== null) {
      // Order shifted underneath (SSE echo — own or cross-client). The index
      // follows the KEY so the same pane stays focused. Correct the index and
      // let the re-render re-enter this effect (with orderChanged=false) to
      // capture the key + focus — never focusing the transient wrong index.
      // `prevFocusedIndexRef` is deliberately left untouched here so the
      // re-entered settled pass sees the index change and (for an own move)
      // focuses the moved pane.
      const j = focusedIndexForKey(keys, focusedKeyRef.current, focusedIndex);
      if (j !== focusedIndex) {
        setFocusedIndex(j);
        return;
      }
    }

    // Index is authoritative for identity now: capture the focused key (always,
    // so the ref tracks the current pane across passive refetches) and focus
    // that pane's terminal ONLY when the index actually changed from the last
    // focused index. `paneRefs` is keyed to the authoritative order (see
    // DesktopRow), so `focusedIndex` addresses the right handle.
    focusedKeyRef.current = keys[focusedIndex] ?? null;
    if (shouldFocusPane(prevFocusedIndexRef.current, focusedIndex)) {
      paneRefs.current[focusedIndex]?.focus();
    }
    prevFocusedIndexRef.current = focusedIndex;
  }, [entries, focusedIndex]);

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
  const { sidebarOpen, composeStripEnabled } = useChromeState();
  const { setSidebarOpen, increaseTerminalFont, decreaseTerminalFont, resetTerminalFont, toggleComposeStrip } = useChromeDispatch();

  // Update notification (lifted above boardRouteActions so the qualify state +
  // triggers are in scope for the palette memo). Below `sm` the top-bar L3
  // cluster — including the UpdateChip — is hidden, so a phone user on
  // /board/$name has NO update surface unless the palette carries it. The board
  // mounts its own palette (DD-8, § Boards Command Palette), so the AppShell
  // `updateActions` (app.tsx) are unreachable here — these are duplicated in for
  // the same reason as the font trio / refresh / help entries below.
  const {
    qualifies: updateQualifies,
    tools: updateTools,
    updateNow,
    dismissUpdate,
    daemonVersion,
    brew,
    forceUpdateNow,
    restartNow,
  } = useUpdateNotification();

  // Palette-surface split/close executors (Constitution V; 260715-6jwn). Mirror
  // the terminal palette's wiring (app.tsx — useOptimisticAction-wrapped
  // splitWindow/closePane with error toasts). Declared ABOVE `boardRouteActions`
  // so the memo can list them in its dep array. The board palette mirrors the
  // terminal PALETTE's `horizontal` mapping (Vertical → horizontal: true), a
  // pre-existing top-bar-chip-vs-palette divergence left out of scope. Close
  // schedules a self-heal refetch (`onSettled`) like the top-bar ✕.
  const { execute: executeSplit } = useOptimisticAction<[string, string, boolean, string | undefined]>({
    action: (srv, windowId, horizontal, cwd) => splitWindow(srv, windowId, horizontal, cwd),
    onError: (err) => addToast(err.message || "Failed to split pane"),
  });

  // The focused tile's kill/split target — the SINGLE source of truth for the
  // focused window shared by the top-bar SplitButtons + ✕ slot AND the three
  // board split/close palette actions below (260715-6jwn). `cwd` comes from the
  // focused entry's ACTIVE pane (fallback: first pane; else undefined →
  // splitWindow omits it and tmux uses its default). Pinned windows live in
  // `_rk-pin-*` sessions filtered out of every session list (incl. the SSE
  // stream), so we can NOT look the window up in `ctx.sessionsByServer`;
  // `BoardEntry.panes` already carries per-pane cwd + isActive from the getBoard
  // join, matching terminal-mode's active-pane worktreePath semantics. Null when
  // the board is empty (no focused tile). Declared ABOVE `boardRouteActions` so
  // the palette handlers consume it directly instead of re-deriving the
  // active-pane cwd (parsimony — one derivation, one source of truth).
  const focusedPane = useMemo(() => {
    const e = entries[focusedIndex];
    if (!e) return null;
    const panes = e.panes ?? [];
    const active = panes.find((p) => p.isActive) ?? panes[0];
    return { server: e.server, windowId: e.windowId, cwd: active?.cwd };
  }, [entries, focusedIndex]);

  // Unpin the focused tile (non-destructive move-out). The board ✕ became a
  // REAL close-pane in 260715-6jwn (uniform with terminal mode — it kills the
  // focused tile's active pane, no confirm, focused-ring disambiguated), so the
  // ✕ no longer unpins. `unpinFocused` now survives ONLY as the `Board: Unpin
  // Focused Pane` palette-action handler (wired into `boardRouteActions` below)
  // — unpin also stays on the tile header. Declared ABOVE `boardRouteActions` so
  // the palette action consumes this shared handler rather than re-inlining
  // `unpin(...)` (parsimony — one unpin derivation, matching R6).
  const unpinFocused = useCallback(() => {
    const e = entries[focusedIndex];
    if (e) unpin(e.server, e.windowId, name);
  }, [entries, focusedIndex, unpin, name]);

  // Board kill is confirm-gated + consequence-legible (co9z). The board ✕ and
  // the palette kill entry both open this dialog instead of firing immediately,
  // because a board Kill destroys the window EVERYWHERE (home session included),
  // not just the board pane. `killTarget` is the focused window while the dialog
  // is open (null = closed). The confirmed Kill is a WINDOW-kill (killWindow —
  // "closes it everywhere"), distinct from the reversible tile-header Unpin. The
  // home session is resolved at open time from the SAME `homeSessionByKey` join
  // that feeds the pane-header crumb (single join implementation, R11) — read via
  // a ref (`homeSessionByKeyRef`, assigned just below the memo) so opening the
  // dialog does not couple this callback's identity to every SSE tick. Absent key
  // → window-only fallback copy (legacy pin / home died).
  const homeSessionByKeyRef = useRef<Map<string, string>>(new Map());
  const [killTarget, setKillTarget] = useState<{
    server: string;
    windowId: string;
    windowName: string;
    home?: string;
  } | null>(null);
  const requestKillFocused = useCallback(() => {
    const e = entries[focusedIndex];
    if (!e) return;
    setKillTarget({
      server: e.server,
      windowId: e.windowId,
      windowName: e.windowName || e.windowId,
      home: homeSessionByKeyRef.current.get(`${e.server}:${e.windowId}`),
    });
  }, [entries, focusedIndex]);
  const { execute: executeKillWindow } = useOptimisticAction<[string, string]>({
    action: (srv, windowId) => killWindow(srv, windowId),
    onSettled: () => refetch(),
    onError: (err) => addToast(err.message || "Failed to kill window"),
  });
  const confirmKill = useCallback(() => {
    if (killTarget) executeKillWindow(killTarget.server, killTarget.windowId);
    setKillTarget(null);
  }, [killTarget, executeKillWindow]);
  const killUnpinInstead = useCallback(() => {
    if (killTarget) unpin(killTarget.server, killTarget.windowId, name);
    setKillTarget(null);
  }, [killTarget, unpin, name]);

  // Board-route-scoped command palette actions. Constitution V (Keyboard-First)
  // requires every action be keyboard-reachable — AppShell's palette is not
  // mounted here (the board route does not render AppShell, see DD-8), so
  // BoardPage owns its own palette mount with the entries that are meaningful
  // on a board route: switch to other boards, leave the board view, cycle pane
  // focus, split/close the focused pane, the `Go: Back`/`Go: Forward`/`Go: Host`
  // nav entries (see navEntries below), the global terminal-font controls (the
  // board's panes are live terminals; the setting is global), and "View: Refresh
  // Page" (duplicated from AppShell's viewActions — see refreshEntry below).
  // Pin/Unpin Current Window are AppShell-only (no current window exists in
  // single-window sense on a board route).
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
      // Autofit toggle (738w) — palette parity for the top-bar button
      // (Constitution V). Flips the same per-board `autofit` state; a no-op on
      // mobile (carousel is one full-width pane).
      {
        id: "board-toggle-autofit",
        label: autofit ? "Board: Toggle Autofit (on)" : "Board: Toggle Autofit (off)",
        onSelect: toggleAutofit,
      },
    ];

    // Board: Move up/down — reorder the CURRENT board within the board list,
    // built on the same `computeMoveOrder` helper + boundary-hidden / no-wraparound
    // gating as Server: Move up/down (Constitution V; also the touch fallback
    // where HTML5 DnD does not fire). `boards` is the backend-sorted display
    // order; the write posts the full computed order.
    const boardOrderNames = boards.map((b) => b.name);
    const currentBoardIdx = boardOrderNames.indexOf(name);
    const moveBoard = (delta: -1 | 1) => {
      const next = computeMoveOrder(boardOrderNames, currentBoardIdx, delta);
      if (!next) return; // boundary / not found: no-op
      setBoardOrder(next).catch((err: Error) => addToast(err.message || "Failed to move board"));
    };
    if (currentBoardIdx > 0) {
      conditional.push({
        id: "board-move-up",
        label: "Board: Move up",
        onSelect: () => moveBoard(-1),
      });
    }
    if (currentBoardIdx >= 0 && currentBoardIdx < boardOrderNames.length - 1) {
      conditional.push({
        id: "board-move-down",
        label: "Board: Move down",
        onSelect: () => moveBoard(1),
      });
    }

    // Navigation entries (260714-uco1 builder) — palette parity (Constitution V)
    // for the top-bar history arrows + the board breadcrumb's Host ancestor.
    // AppShell's palette doesn't mount here (DD-8), so the board palette wires
    // its own `buildNavActions("board", ...)` call, handlers mirroring
    // AppShell's `navActions` (app.tsx). `server` is "" — board mode never
    // emits `Go: tmux Server` (its gate is `mode === "terminal" && server`),
    // so `onTmuxServer` is an unreachable no-op. Positioned after the
    // board-specific entries and before the font trio, mirroring AppShell's
    // group ordering (nav after the route groups, before terminalFontActions).
    const navEntries: PaletteAction[] = buildNavActions("board", "", {
      onBack: () => router.history.back(),
      onForward: () => router.history.forward(),
      onTmuxServer: () => {}, // unreachable in board mode (entry only emitted for terminal)
      onHost: () => navigate({ to: "/" }),
    });

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

    // Update actions — duplicated from AppShell's `updateActions` (app.tsx) for
    // the same reason as refreshEntry/helpEntry: the board route mounts its OWN
    // palette and does NOT render AppShell (DD-8). Critically, below `sm` the
    // top-bar UpdateChip is hidden, so on a phone /board/$name the palette is the
    // ONLY update surface. Gated on `qualifies` only — the palette deliberately
    // ignores chip dismissal (see lib/palette-update). The Update action wraps
    // updateNow with the same toast-on-failure handling AppShell uses.
    const updateEntries: PaletteAction[] = buildUpdateActions(
      updateQualifies,
      updateTools,
      () => {
        void updateNow().catch((err: unknown) =>
          addToast(err instanceof Error ? err.message : "Update failed"),
        );
      },
      dismissUpdate,
    );

    // Maintenance actions — palette-only force-update / restart, duplicated from
    // AppShell's `maintenanceActions` for the same reason as updateEntries: the
    // board route mounts its OWN palette and does NOT render AppShell (DD-8), and
    // below `sm` the top-bar cluster is hidden, so on a phone /board/$name the
    // palette is the ONLY maintenance surface. Dev-gated + (for force) brew-gated
    // inside buildMaintenanceActions; both fire immediately with toast-on-failure.
    const maintenanceEntries: PaletteAction[] = buildMaintenanceActions(
      brew,
      daemonVersion,
      () => {
        void forceUpdateNow().catch((err: unknown) =>
          addToast(err instanceof Error ? err.message : "Update failed"),
        );
      },
      () => {
        void restartNow().catch((err: unknown) =>
          addToast(err instanceof Error ? err.message : "Restart failed"),
        );
      },
    );

    // Version entry — duplicated from AppShell's `versionActions` (app.tsx) for
    // the same reason as updateEntries: the board route mounts its OWN palette
    // and does NOT render AppShell (DD-8), and below `sm` the top-bar cluster
    // (which has no version chip anyway) is hidden, so on a phone /board/$name
    // the palette is the ONLY version surface. Shown whenever daemonVersion is
    // known, including `dev` (pure display). Copies the displayed form; success
    // → info toast, failure defaults to the board's error toast.
    const versionEntries: PaletteAction[] = buildVersionAction(daemonVersion, () => {
      if (!daemonVersion) return;
      void copyToClipboard(displayVersion(daemonVersion)).then((ok) => {
        if (ok) addToast("Version copied", "info");
        else addToast("Copy failed");
      });
    });

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
      // Keyboard parity for the tile-header unpin (Constitution V; 260704-9o7k).
      // Unpins the focused pane (non-destructive) via the shared `unpinFocused`
      // handler — the single unpin derivation (R6). The top-bar ✕ became a kill
      // in 260715-6jwn, but unpin still lives here + on the tile header.
      conditional.push({
        id: "board-unpin-focused",
        label: "Board: Unpin Focused Pane",
        onSelect: unpinFocused,
      });

      // Keyboard parity for the top-bar board SplitButtons (Constitution V;
      // 260715-6jwn). Act on the focused tile's window via the shared
      // `focusedPane` memo — the SAME `{server, windowId, cwd}` the top-bar slot
      // consumes, so there is one derivation of the active-pane cwd, not a
      // duplicated per-handler lookup (parsimony). Split mirrors the terminal
      // PALETTE's `horizontal` mapping (Vertical → horizontal: true — the
      // documented cross-surface divergence with the top-bar chip labels, left
      // out of scope). The board Kill lives in `board-kill-focused` above (routes
      // through the confirm dialog), not here.
      conditional.push({
        id: "board-split-vertical",
        label: "Board: Split Focused Pane Vertical",
        onSelect: () => {
          if (focusedPane) executeSplit(focusedPane.server, focusedPane.windowId, true, focusedPane.cwd);
        },
      });
      conditional.push({
        id: "board-split-horizontal",
        label: "Board: Split Focused Pane Horizontal",
        onSelect: () => {
          if (focusedPane) executeSplit(focusedPane.server, focusedPane.windowId, false, focusedPane.cwd);
        },
      });
      // Board Kill (co9z) — routes through the confirm dialog (NOT an immediate
      // close-pane). The verb is "Kill" on board surfaces: a board Kill destroys
      // the window everywhere (home session included), so it is consequence-gated
      // with an `Unpin instead` escape. Retires the old `Board: Close Focused
      // Pane` entry.
      conditional.push({
        id: "board-kill-focused",
        label: "Board: Kill Focused Pane",
        onSelect: requestKillFocused,
      });

      // Keyboard parity for header drag-reorder (Constitution V). Boundary-gated
      // with NO wraparound — hidden (not disabled) at the edge, matching the
      // palette Move up/down convention (computeMoveOrder). Acts on the focused
      // pane: computes before/after via the shared neighbour helper, fires ONE
      // reorder POST (same single-call path as DnD; fractional indexing).
      //
      // Focus follows the moved pane by KEY, NOT by an optimistic index bump:
      // the palette move does NOT go through the DnD optimistic override, so the
      // display does not reorder until the board-changed SSE echo. Bumping
      // `focusedIndex` to `i±1` here would move the ring — and route imperative
      // xterm focus — into the DISPLACED NEIGHBOUR's terminal (paneRefs are
      // keyed to the authoritative order, still the OLD order pre-echo). Instead
      // we leave `focusedIndex` alone: the moved pane IS the focused pane and it
      // stays visually put until the echo, at which point the key-reconcile
      // effect repositions `focusedIndex` to the moved pane's new slot. Result:
      // keystrokes land in the moved pane both before and after the echo
      // (rework must-fix #3).
      const orderedIds = entries.map((e) => `${e.server}:${e.windowId}`);
      const moveFocusedPane = (delta: -1 | 1) => {
        const e = entries[focusedIndex];
        if (!e) return;
        const neighbors = computeMoveNeighbors(orderedIds, focusedIndex, delta);
        if (!neighbors) return; // boundary no-op (guarded by the gating below too)
        const stripServer = (k: string | null) =>
          k === null ? null : k.slice(k.indexOf(":") + 1);
        // `reorder` (usePinActions) shows a toast AND rethrows on failure; the
        // palette has no client-side optimistic order to roll back (unlike the
        // DnD override), so just swallow to avoid an unhandled rejection — the
        // toast already informed the user, and the absent SSE echo leaves the
        // order unchanged.
        reorder(
          e.server,
          e.windowId,
          name,
          stripServer(neighbors.before),
          stripServer(neighbors.after),
        ).catch(() => {});
      };
      if (focusedIndex > 0) {
        conditional.push({
          id: "board-move-pane-left",
          label: "Board: Move Focused Pane Left",
          onSelect: () => moveFocusedPane(-1),
        });
      }
      if (focusedIndex < entries.length - 1) {
        conditional.push({
          id: "board-move-pane-right",
          label: "Board: Move Focused Pane Right",
          onSelect: () => moveFocusedPane(1),
        });
      }
    }

    return [...switchEntries, ...conditional, ...navEntries, ...fontEntries, refreshEntry, helpEntry, ...updateEntries, ...maintenanceEntries, ...versionEntries];
  }, [boards, name, entries, focusedIndex, autofit, toggleAutofit, unpinFocused, requestKillFocused, focusedPane, reorder, executeSplit, navigate, router, addToast, increaseTerminalFont, decreaseTerminalFont, resetTerminalFont, updateQualifies, updateTools, updateNow, dismissUpdate, brew, daemonVersion, forceUpdateNow, restartNow]);

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

  // Home-session crumb map (co9z): `server:windowId` → the window's HOME session
  // name, derived from the live sessions snapshot. Possible now precisely because
  // a pinned window stays LINKED into its home session, so it appears under a
  // visible session. Built once per distinct board server (single scan), then
  // narrowed to the pinned entries — mirrors the waitingWindowIds shape to avoid
  // an O(entries × windows) re-scan on every SSE tick. A window not present in
  // the snapshot (legacy pin / home died) is simply absent from the map, and the
  // header/dialog fall back to window-only copy.
  const homeSessionByKey = useMemo(() => {
    const byWindow = new Map<string, string>();
    const seenServers = new Set<string>();
    for (const e of entries) {
      if (seenServers.has(e.server)) continue;
      seenServers.add(e.server);
      for (const s of ctx.sessionsByServer.get(e.server) ?? []) {
        for (const w of s.windows) {
          byWindow.set(`${e.server}:${w.windowId}`, s.name);
        }
      }
    }
    const out = new Map<string, string>();
    for (const e of entries) {
      const key = `${e.server}:${e.windowId}`;
      const home = byWindow.get(key);
      if (home !== undefined) out.set(key, home);
    }
    return out;
  }, [entries, ctx.sessionsByServer]);
  // Mirror the join into a ref so `requestKillFocused` (declared above, before
  // this memo) can read the current home map at click time without depending on
  // it — keeping that callback's identity stable across SSE ticks (parsimony:
  // one join, consumed by both the crumb and the kill dialog).
  homeSessionByKeyRef.current = homeSessionByKey;

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

  // Publish the board TopBar's page-owned props into the persistent root bar's
  // slot (260707-4vq2). `mode` (`board`) and `boardName` are derived at root
  // from the route; the board extras (counts, waiting badge, board switcher, the
  // focused-tile split/kill target) travel through the slot.
  // Session/window props stay tolerant-empty (board mode has no session context,
  // the terminal-only L1 chrome — ViewSwitcher/FixedWidthToggle — stays hidden
  // via `currentWindow: null`; the board SplitButtons key on `focusedPane`
  // instead). Memoized so the registration effect re-runs only when a board prop
  // changes.
  const boardTopBarBoards = useMemo(
    () => boards.map((b) => ({ name: b.name })),
    [boards],
  );
  const onToggleSidebar = useCallback(
    () => setSidebarOpen(!sidebarOpen),
    [setSidebarOpen, sidebarOpen],
  );
  useRegisterTopBarSlot(
    useMemo(
      () => ({
        sessions: [],
        currentSession: null,
        currentWindow: null,
        sessionName: "",
        windowName: "",
        isConnected: boardConnected,
        sidebarOpen,
        server: "",
        onNavigate: () => {},
        onToggleSidebar,
        onCreateSession: () => {},
        onCreateWindow: () => {},
        paneCount: entries.length,
        serverCount,
        waitingPaneCount,
        boards: boardTopBarBoards,
        // The top-bar ✕ + SplitButtons act on the focused tile's window
        // (`focusedPane`). co9z: the board ✕ is now a consequence-gated KILL —
        // `onRequestKill` opens the confirm dialog (with an `Unpin instead`
        // escape) instead of firing close-pane. The confirmed kill's self-heal
        // refetch is driven by `executeKillWindow`'s own `onSettled` (above), not
        // a top-bar callback. Unpin lives on the tile header + the palette action.
        focusedPane,
        onRequestKill: requestKillFocused,
        autofit,
        onToggleAutofit: toggleAutofit,
      }),
      [
        boardConnected,
        sidebarOpen,
        onToggleSidebar,
        entries.length,
        serverCount,
        waitingPaneCount,
        boardTopBarBoards,
        focusedPane,
        requestKillFocused,
        autofit,
        toggleAutofit,
      ],
    ),
  );

  // sidebarOpen drives the hamburger animation; setSidebarOpen handles the
  // toggle and mobile destination-tap auto-close. Both are destructured above
  // (alongside the terminal-font mutators) so AppShell and BoardPage share one
  // ChromeContext toggle target.

  // Focus / scroll-lock plumbing for the shell-level BottomBar. BottomBar is
  // byte-identical across routes per spec § Behavioral Correctness, so the board
  // route MUST pass the same callback set as AppShell — otherwise the `>_`
  // compose-toggle button is gated out (BottomBar renders it iff `onOpenCompose`
  // is truthy) and `ScrollLock` long-press never reaches a handler. The compose
  // strip is a single global surface enabled via the `composeStripEnabled`
  // chrome preference; the `>_` chip toggles it, and the strip reads the focused
  // BoardPane live from `FocusedTerminalContext` (260718-dhdj).
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

  // `h-full` is load-bearing: Shell sizes to `height: 100%` (260707-4vq2), so
  // this wrapper must span AppLayout's `flex-1` content region or the whole
  // board collapses to content height.
  return (
    <div className="h-full bg-bg-primary text-text-primary">
      <Shell sidebarChildren={sidebarElement}>
        {/* The desktop sidebar aside is now Shell-owned (260719-rwqf): BoardPage
            passes only `sidebarChildren` and Shell renders the
            `<aside gridArea:"sidebar" aria-label="Sidebar">` (gated
            `!isMobile && sidebarOpen`). No `sidebarResizeHandle` is passed —
            drag-resize is intentionally absent on the board route — so Shell's
            no-handle branch keeps the `border-r border-border` seam. The column
            width still comes from ChromeContext. */}

        {/* Top bar mount moved to the persistent root layout (260707-4vq2).
            Board mode + `boardName` are derived at root from the route; the
            board extras (pane/server counts, waiting badge, board switcher, and
            the focused-tile split/kill target `focusedPane` + the `onRequestKill`
            confirm-dialog opener — co9z: the board ✕ is a consequence-gated KILL,
            not close-pane) are published into the slot context via the
            `useRegisterTopBarSlot` effect above. The confirmed kill's self-heal
            refetch rides `executeKillWindow`'s own `onSettled`, not a top-bar
            callback. The terminal-only L1 chrome (ViewSwitcher /
            FixedWidthToggle) stays hidden via `currentWindow: null`. */}

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
              homeSessionByKey={homeSessionByKey}
            />
          ) : (
            <DesktopRow
              entries={entries}
              board={name}
              reorder={reorder}
              getWidth={(id) => (getWidth(id) || BOARD_PANE_DEFAULT_WIDTH)}
              autofit={autofit}
              onResizeStart={handleResizeStart}
              onUnpin={(e) => unpin(e.server, e.windowId, name)}
              paneRefs={paneRefs}
              focusedIndex={focusedIndex}
              onPaneClick={setFocusedIndex}
              scrollLocked={scrollLocked}
              waitingWindowIds={waitingWindowIds}
              homeSessionByKey={homeSessionByKey}
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
        <footer style={{ gridArea: "bottombar" }}>
          {composeStripEnabled && <ComposeStrip />}
          <div className="border-t-[3px] border-border px-1.5 h-[48px]">
            <BottomBar
              onOpenCompose={toggleComposeStrip}
              onFocusTerminal={() => focusFocusedPaneRef.current?.()}
              onScrollLockChange={setScrollLocked}
            />
          </div>
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

      {/* Board kill confirm (co9z). A board Kill destroys the window EVERYWHERE
          (its home session too), not just the board pane — so it is
          consequence-gated with a safe `Unpin instead` escape. `Unpin instead`
          is the FIRST focusable element so `Dialog` auto-focuses it (default
          focus on the safe action); the dialog is fully keyboard-operable
          (Escape/Tab/backdrop via `Dialog`). When the home session is not
          derivable (legacy pin / home died — window absent from the sessions
          snapshot), the copy falls back to window-only. */}
      {killTarget && (
        <Dialog title={`Kill ${killTarget.windowName}?`} onClose={() => setKillTarget(null)}>
          <p className="text-text-secondary mb-2.5">
            {killTarget.home ? (
              <>
                This closes it everywhere — including session <strong>{killTarget.home}</strong>.
              </>
            ) : (
              <>This closes the window everywhere.</>
            )}
          </p>
          <div className="flex gap-2">
            <button
              onClick={killUnpinInstead}
              className="flex-1 py-1.5 border border-border rounded hover:border-text-secondary"
            >
              Unpin instead
            </button>
            <button
              onClick={confirmKill}
              className="flex-1 py-1.5 bg-red-900/30 border border-red-900 rounded hover:bg-red-900/50"
            >
              Kill
            </button>
            <button
              onClick={() => setKillTarget(null)}
              className="flex-1 py-1.5 border border-border rounded hover:border-text-secondary"
            >
              Cancel
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function DesktopRow({
  entries,
  board,
  reorder,
  getWidth,
  autofit,
  onResizeStart,
  onUnpin,
  paneRefs,
  focusedIndex,
  onPaneClick,
  scrollLocked,
  waitingWindowIds,
  homeSessionByKey,
}: {
  entries: ReturnType<typeof useBoardEntries>["entries"];
  board: string;
  reorder: ReturnType<typeof usePinActions>["reorder"];
  getWidth: (windowId: string) => number;
  /** Autofit mode (738w): panes become equal-share flex items filling the row
   *  (≤4 panes) or floor at ~25% + scroll (>4). Resize handles are hidden and
   *  the pixel width is not passed while on; stored widths are left untouched. */
  autofit: boolean;
  onResizeStart: (windowId: string, clientX: number) => void;
  onUnpin: (entry: ReturnType<typeof useBoardEntries>["entries"][number]) => void;
  paneRefs: React.MutableRefObject<Array<BoardPaneHandle | null>>;
  focusedIndex: number;
  onPaneClick: (idx: number) => void;
  scrollLocked: boolean;
  /** (server:windowId) keys of panes whose joined window is `waiting`. */
  waitingWindowIds: Set<string>;
  /** (server:windowId) → HOME session name for the `{session} › {window}`
   *  crumb (co9z); absent key → header falls back to window-only. */
  homeSessionByKey: Map<string, string>;
}) {
  const rowRef = useRef<HTMLDivElement>(null);

  // Header-only drag-reorder. Renders `orderedEntries` (the optimistic override
  // during a drag, else the authoritative `entries`); focus/pane-ref/visibility
  // bookkeeping stays keyed to the AUTHORITATIVE index so a pane keeps its
  // identity (focus, live-relay slot) as its display position changes mid-drag.
  const { orderedEntries, getHandleProps, draggingKey } = useBoardPaneReorder(
    entries,
    board,
    reorder,
  );

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

  // Authoritative index by `server:windowId` key. Bookkeeping (paneRefs,
  // focus, visibility cap) keys on this so a pane keeps its identity while its
  // DISPLAY position shifts under the optimistic drag override.
  const authIdxByKey = new Map<string, number>(
    entries.map((e, i) => [`${e.server}:${e.windowId}`, i]),
  );

  return (
    <div ref={rowRef} className="h-full w-full overflow-x-auto flex gap-1 p-1">
      {orderedEntries.map((entry) => {
        const key = `${entry.server}:${entry.windowId}`;
        // Authoritative index (fallback to a display-stable value if a pane
        // appears only in the override, e.g. mid-drag pin — should not happen).
        const authIdx = authIdxByKey.get(key) ?? -1;
        const { handle, drop } = getHandleProps(entry.server, entry.windowId);
        return (
          <BoardPane
            key={key}
            ref={(el) => {
              if (authIdx >= 0) paneRefs.current[authIdx] = el;
            }}
            rootRef={(el) => {
              if (el) {
                el.dataset.paneIndex = String(authIdx);
                if (authIdx >= 0) paneElsRef.current.set(authIdx, el);
              } else if (authIdx >= 0) {
                paneElsRef.current.delete(authIdx);
              }
            }}
            entry={entry}
            // Autofit ignores the stored pixel width (equal-share flex item);
            // off passes the persisted per-pane width. Not reading `getWidth`
            // while on keeps the stored widths untouched (non-destructive).
            width={autofit ? undefined : getWidth(entry.windowId)}
            autofit={autofit}
            paused={livePanes === null ? false : !livePanes.has(authIdx)}
            isFocused={authIdx === focusedIndex}
            dimmed={draggingKey === key}
            waiting={waitingWindowIds.has(key)}
            homeSession={homeSessionByKey.get(key)}
            onClick={() => onPaneClick(authIdx)}
            onUnpin={() => onUnpin(entry)}
            showResizeHandle={!autofit}
            onResizeStart={(clientX) => onResizeStart(entry.windowId, clientX)}
            scrollLocked={scrollLocked}
            dragHandleProps={handle}
            dropTargetProps={drop}
          />
        );
      })}
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
  homeSessionByKey,
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
  /** (server:windowId) → HOME session name for the `{session} › {window}`
   *  crumb (co9z); absent key → header falls back to window-only. */
  homeSessionByKey: Map<string, string>;
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
              homeSession={homeSessionByKey.get(`${entry.server}:${entry.windowId}`)}
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
