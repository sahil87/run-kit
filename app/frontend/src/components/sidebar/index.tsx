import { useState, useCallback, useRef, useEffect, useMemo, useReducer, memo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { killSession as killSessionApi, killWindow as killWindowApi, renameSession, moveWindow, moveWindowToSession, setSessionColor as setSessionColorApi, setWindowColor as setWindowColorApi, setWindowMarker as setWindowMarkerApi, getAllServerColors, setServerColor as setServerColorApi, setSessionOrder, type ServerInfo } from "@/api/client";
import { useSessionContext } from "@/contexts/session-context";
import { useOptimisticAction } from "@/hooks/use-optimistic-action";
import { useOptimisticContext } from "@/contexts/optimistic-context";
import { useToast } from "@/components/toast";
import { TypedLabel } from "@/components/typed-label";
import { useTheme } from "@/contexts/theme-context";
import { computeRowTints, computeRowBorders } from "@/themes";
import type { ProjectSession } from "@/types";
import { isGhostWindow } from "@/contexts/optimistic-context";
import type { MergedSession } from "@/contexts/optimistic-context";
import { useWindowStore } from "@/store/window-store";
import { useWindowRename } from "@/hooks/use-window-rename";
import { useWindowPins } from "@/hooks/use-window-pins";
import { useLocalStorageBoolean } from "@/hooks/use-local-storage-boolean";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { useChromeState } from "@/contexts/chrome-context";
import { useActiveBoardName } from "@/hooks/use-active-board";
import { useMergedSessions } from "@/contexts/optimistic-context";
import { countWaitingInSessions } from "@/lib/waiting";
import { BoardsSection } from "./boards-section";
import { HostPanel } from "./host-panel";
import { KillDialog } from "./kill-dialog";
import { ServerPanel } from "./server-panel";
import { SessionRow } from "./session-row";
import { WindowPanel } from "./status-panel";
import { WindowRow } from "./window-row";

/** Shallow element-wise compare of two flat string arrays (same length, same
 *  elements in order). Used to detect when an SSE-delivered session order has
 *  caught up to a transient drag override so the override can be dropped. */
function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Identity of a roving tree row, keyed by its row key (`data-window-id` for a
 *  window, `${server}:${name}` for a session). A discriminated union so Enter/
 *  Space activation derives the right handler + args with no type assertions. */
type RowIdentity =
  | { kind: "window"; server: string; session: string; windowId: string; ghost: boolean }
  | { kind: "session"; server: string; session: string; firstWindowId: string };

export type SidebarProps = {
  /** Identifies the "active" server for visual treatment + default expanded
   *  group. `null` on board route — no group is marked current and all
   *  groups follow persisted toggles (defaulting to collapsed). */
  currentServer: string | null;
  currentSession: string | null;
  currentWindowId: string | null;
  /** Session/window navigation. The `server` argument carries the source
   *  server so callers can route across servers. The window is addressed by
   *  its stable tmux window ID (@N). */
  onSelectWindow: (server: string, session: string, windowId: string) => void;
  /** Create a new window inside a session on a specific server. */
  onCreateWindow: (server: string, session: string) => void;
  /** Create a new session against a specific server (per-group "+" button). */
  onCreateSession: (server: string) => void;
  /** Open the spawn-agent dialog targeting a session-row's `{server, session}`.
   *  Optional (mirrors `SessionRow.onSpawnAgent`): when omitted (e.g. the
   *  board-route sidebar) the per-row bot button is hidden. */
  onSpawnAgent?: (server: string, session: string) => void;
  onCreateServer: () => void;
  onKillServer: (name: string) => void;
  /** Optional waiting-badge click (260714-r7rq): navigate to the next waiting
   *  window in a session (chat-aware — `?view=chat` when it has a chat). Passed
   *  to each `SessionRow`; absent ⇒ badges stay display-only. */
  onWaitingBadgeClick?: (server: string, session: string) => void;
  /** Forwarded to `ServerPanel` → `CollapsiblePanel` as the corner pointerdown
   *  callback. When supplied (desktop only), a corner affordance is rendered at
   *  the bottom-right of the server panel drag handle that also starts a
   *  sidebar-width drag. */
  onSidebarResizeStart?: (e: React.PointerEvent<HTMLDivElement>) => void;
};

export function Sidebar({
  currentServer,
  currentSession,
  currentWindowId,
  onSelectWindow,
  onCreateWindow,
  onCreateSession,
  onSpawnAgent,
  onCreateServer,
  onKillServer,
  onWaitingBadgeClick,
  onSidebarResizeStart,
}: SidebarProps) {
  const ctx = useSessionContext();
  const { servers, sessionsByServer, isConnectedByServer, refreshServers, attachServer } = ctx;
  // Pre-compute row tints + contrast-adjusted borders from the active theme.
  const { theme } = useTheme();
  const rowTints = useMemo(() => computeRowTints(theme.palette), [theme.palette]);
  const rowBorders = useMemo(
    () => computeRowBorders(theme.palette, theme.category),
    [theme.palette, theme.category],
  );
  // Per-server waiting rollup for the SERVER panel tiles (260708-4li7). Pure
  // derivation over the already-streamed session data — no new endpoint, no
  // polling (Constitution II). Attached-server-only by construction: only
  // servers with an open SSE stream have windows in `sessionsByServer`, so an
  // unattached server's count is 0 and its tile badge is simply absent.
  const waitingCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const [name, sessions] of sessionsByServer) {
      m.set(name, countWaitingInSessions(sessions));
    }
    return m;
  }, [sessionsByServer]);
  const navigate = useNavigate();
  const { addToast } = useToast();

  // Server Pane open state — read via the shared hook so the Sessions Pane
  // re-renders in the same tab when the user toggles the panel. Default
  // matches `ServerPanel`'s `defaultOpen={false}` (server-panel.tsx:107).
  // When open AND a current server is resolved, the Sessions Pane filters
  // to that server's group; when open AND `currentServer === null`, an
  // empty-state hint replaces the group list.
  const [serverPaneOpen] = useLocalStorageBoolean("runkit-panel-server", false);

  // Server colors from settings.yaml (all servers) — color value descriptors
  // ("4" / "1+3").
  const [serverColors, setServerColors] = useState<Record<string, string>>({});
  useEffect(() => {
    getAllServerColors().then(setServerColors).catch(() => {});
  }, []);

  // Server-switch handler — navigates and lets the route param drive
  // `currentServer` via the provider's `useMatches()` lookup.
  const handleSwitchServer = useCallback(
    (name: string) => {
      navigate({ to: "/$server", params: { server: name } });
    },
    [navigate],
  );

  // Sessions section collapse state — per-server, persisted in localStorage
  // under `runkit-panel-sessions-{server}`. Default-open for `currentServer`,
  // collapsed for everyone else. Includes a one-time migration of the legacy
  // `runkit-panel-sessions` key to the current server's namespaced key.
  const [serverSectionsOpen, setServerSectionsOpen] = useState<Record<string, boolean>>(() => {
    const seed: Record<string, boolean> = {};
    // Best-effort migration of the legacy key — only when currentServer is
    // set, so we know which namespaced key inherits the value. No error if
    // the key is missing.
    if (currentServer) {
      try {
        const legacy = localStorage.getItem("runkit-panel-sessions");
        if (legacy != null) {
          const k = `runkit-panel-sessions-${currentServer}`;
          if (localStorage.getItem(k) == null) {
            localStorage.setItem(k, legacy);
          }
          localStorage.removeItem("runkit-panel-sessions");
        }
      } catch {
        // localStorage unavailable
      }
    }
    return seed;
  });

  /** Read per-server collapse from localStorage (used inside the render loop
   *  for servers we haven't touched yet). Default: open for currentServer,
   *  collapsed otherwise. */
  const readServerOpen = useCallback(
    (server: string): boolean => {
      const cached = serverSectionsOpen[server];
      if (cached !== undefined) return cached;
      try {
        const v = localStorage.getItem(`runkit-panel-sessions-${server}`);
        if (v === "false") return false;
        if (v === "true") return true;
      } catch {
        // localStorage unavailable
      }
      return server === currentServer;
    },
    [serverSectionsOpen, currentServer],
  );

  // Lazy-attach: ask the provider to subscribe the state socket to any
  // server whose group is open. The current server is auto-attached by the
  // provider; this covers user-expanded non-current groups.
  useEffect(() => {
    for (const s of servers) {
      if (readServerOpen(s.name)) {
        attachServer(s.name);
      }
    }
  }, [servers, attachServer, readServerOpen]);

  const toggleServerSection = useCallback((server: string) => {
    // The state updater MUST be pure: under React 19 StrictMode (active via
    // main.tsx in dev/e2e) it is invoked twice. A side-effect inside it
    // (localStorage.setItem, attachServer) runs twice and — worse — the second
    // invocation would observe the first's localStorage write and invert the
    // computed next, making a single click a no-op (the group never opened).
    //
    // So: snapshot the current open-state via `readServerOpen` ONCE, BEFORE any
    // write, derive `next`, then run the side-effects once outside the updater.
    // `current` is captured before the localStorage.setItem below, so the value
    // is stable even though `readServerOpen` itself reads localStorage.
    const current = readServerOpen(server);
    const next = !current;
    try {
      localStorage.setItem(`runkit-panel-sessions-${server}`, String(next));
    } catch {
      // localStorage unavailable
    }
    // When opening a non-current server's group, ask the provider to
    // subscribe to it so the group's session list is populated.
    if (next && server !== currentServer) {
      attachServer(server);
    }
    // Commit from `prev` so back-to-back toggles batched into a single render
    // still alternate correctly (`prev` accumulates queued updates within a
    // batch). For an untouched group `prev[server]` is undefined; fall back to
    // the `current` snapshot taken above — NOT a fresh `readServerOpen`, which
    // would re-read the localStorage value just written and re-introduce the
    // StrictMode inversion on the first toggle.
    setServerSectionsOpen((prev) => ({
      ...prev,
      [server]: prev[server] === undefined ? next : !prev[server],
    }));
  }, [currentServer, attachServer, readServerOpen]);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [killTarget, setKillTarget] = useState<{
    type: "session" | "window";
    server: string;
    session: string;
    windowId?: string;
    windowCount: number;
  } | null>(null);

  const [editingWindow, setEditingWindow] = useState<{ server: string; session: string; windowId: string } | null>(null);
  const [editingName, setEditingName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelledRef = useRef(false);
  const originalNameRef = useRef("");

  const [editingSession, setEditingSession] = useState<{ server: string; name: string } | null>(null);
  const [editingSessionName, setEditingSessionName] = useState("");
  const sessionInputRef = useRef<HTMLInputElement>(null);
  const sessionCancelledRef = useRef(false);
  const sessionOriginalNameRef = useRef("");

  // Drag-and-drop state for window reordering. `dragSource.server` is the
  // source's server, used to reject cross-server drops with a toast.
  const [dragSource, setDragSource] = useState<{ server: string; session: string; index: number } | null>(null);
  const [dropTarget, setDropTarget] = useState<{ server: string; session: string; index: number } | null>(null);
  const [sessionDropTarget, setSessionDropTarget] = useState<{ server: string; session: string } | null>(null);

  // Session reorder per server. The persisted order arrives via SSE
  // (`sessionOrderByServer`). The displayed order is DERIVED at render time:
  // `override ?? sseOrder`. The transient drag override lives in a ref (not
  // state) keyed by server — it is consumed synchronously at render, so
  // writing it never needs to trigger a render on its own. We keep it out of
  // state to avoid a reconciling effect that re-runs on every SSE slice tick.
  const [sessionDragSource, setSessionDragSource] = useState<{ server: string; name: string } | null>(null);
  const orderOverrideRef = useRef<Record<string, string[]>>({});
  const orderPutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const SESSION_ORDER_DEBOUNCE_MS = 250;

  // Minimal render nudge. Refs do not trigger re-renders, so when we set or
  // clear `orderOverrideRef` we bump this counter to re-render reading the
  // updated override (or the now-authoritative SSE order after a clear). This
  // replaces the removed whole-Map watcher effect — the override lifecycle is
  // driven by drag events plus a per-server SSE-order equality check at render.
  const [, forceRender] = useReducer((x: number) => x + 1, 0);

  const sessionDragSourceRef = useRef<typeof sessionDragSource>(null);
  sessionDragSourceRef.current = sessionDragSource;

  useEffect(() => {
    return () => {
      if (orderPutTimerRef.current) clearTimeout(orderPutTimerRef.current);
    };
  }, []);

  const { markKilled, unmarkKilled, markRenamed, unmarkRenamed } = useOptimisticContext();

  // Boards integration: aggregate pin map across all servers + boards.
  const { boards: allBoards, pinnedSet, pinnedToBoard, boardForWindow, isLoading: boardsLoading } = useWindowPins();
  const activeBoardName = useActiveBoardName();
  const isPinnedToActiveBoardFor = useCallback(
    (winServer: string, windowId: string) => {
      if (!activeBoardName) return false;
      return pinnedToBoard(activeBoardName, winServer, windowId);
    },
    [activeBoardName, pinnedToBoard],
  );
  // Navigate to a board (co9z): the pinned-row indicator's navigation
  // affordance. Stable identity so it does not churn ServerGroup's React.memo.
  const onNavigateToBoard = useCallback(
    (board: string) => {
      navigate({ to: "/board/$name", params: { name: board } });
    },
    [navigate],
  );
  const killWindowStore = useWindowStore((state) => state.killWindow);
  const restoreWindow = useWindowStore((state) => state.restoreWindow);
  const clearSession = useWindowStore((state) => state.clearSession);
  const moveWindowOrder = useWindowStore((state) => state.moveWindowOrder);
  const addGhostWindow = useWindowStore((state) => state.addGhostWindow);
  const removeGhost = useWindowStore((state) => state.removeGhost);

  // Ctrl+click kill session (optimistic) — captures (server, session) per call.
  const lastKillSessionRef = useRef<{ server: string; name: string } | null>(null);
  const { execute: executeKillSession } = useOptimisticAction<[string, string]>({
    action: (srv, name) => killSessionApi(srv, name),
    onOptimistic: (srv, name) => {
      lastKillSessionRef.current = { server: srv, name };
      markKilled("session", srv, name);
    },
    onAlwaysRollback: () => {
      const last = lastKillSessionRef.current;
      if (last) unmarkKilled("session", last.server, last.name);
    },
    onAlwaysSettled: () => {
      const last = lastKillSessionRef.current;
      if (last) clearSession(last.server, last.name);
      lastKillSessionRef.current = null;
    },
    onError: (err) => {
      addToast(err.message || "Failed to kill session");
    },
  });

  // Ctrl+click kill window (optimistic) — captures (server, session, windowId).
  const lastKillWindowRef = useRef<{ server: string; session: string; windowId: string } | null>(null);
  const { execute: executeKillWindow } = useOptimisticAction<[string, string, string]>({
    action: (srv, _session, windowId) => killWindowApi(srv, windowId),
    onOptimistic: (srv, session, windowId) => {
      lastKillWindowRef.current = { server: srv, session, windowId };
      killWindowStore(srv, session, windowId);
    },
    onAlwaysRollback: () => {
      const last = lastKillWindowRef.current;
      if (last) restoreWindow(last.server, last.session, last.windowId);
    },
    onAlwaysSettled: () => {
      const last = lastKillWindowRef.current;
      if (last) restoreWindow(last.server, last.session, last.windowId);
      lastKillWindowRef.current = null;
    },
    onError: (err) => {
      addToast(err.message || "Failed to kill window");
    },
  });

  // Kill from confirmation dialog (optimistic)
  const killTargetRef = useRef(killTarget);
  killTargetRef.current = killTarget;
  const killDialogServerRef = useRef<string>("");

  const { execute: executeKillFromDialog } = useOptimisticAction<[string, { type: "session" | "window"; session: string; windowId?: string }]>({
    action: (srv, target) => {
      if (target.type === "window" && target.windowId) {
        return killWindowApi(srv, target.windowId);
      }
      return killSessionApi(srv, target.session);
    },
    onOptimistic: (srv, target) => {
      killDialogServerRef.current = srv;
      if (target.type === "window" && target.windowId) {
        killWindowStore(srv, target.session, target.windowId);
      } else {
        markKilled("session", srv, target.session);
      }
    },
    onAlwaysRollback: () => {
      const target = killTargetRef.current;
      if (!target) return;
      const srv = killDialogServerRef.current;
      if (target.type === "window" && target.windowId) {
        restoreWindow(srv, target.session, target.windowId);
      } else {
        unmarkKilled("session", srv, target.session);
      }
    },
    onAlwaysSettled: () => {
      const target = killTargetRef.current;
      if (!target) return;
      const srv = killDialogServerRef.current;
      if (target.type === "window" && target.windowId) {
        restoreWindow(srv, target.session, target.windowId);
      } else {
        clearSession(srv, target.session);
      }
    },
    onError: (err) => {
      addToast(err.message || "Failed to kill");
    },
  });

  // Inline rename session (optimistic). Captures (server, oldName, newName).
  const lastRenameSessionRef = useRef<{ server: string; oldName: string; newName: string } | null>(null);
  const { execute: executeRenameSession } = useOptimisticAction<[string, string, string]>({
    action: (srv, oldName, newName) => renameSession(srv, oldName, newName),
    onOptimistic: (srv, oldName, newName) => {
      lastRenameSessionRef.current = { server: srv, oldName, newName };
      markRenamed("session", srv, oldName, newName);
      // No navigation on rename: the route is /$server/$window (no session
      // segment), so the URL is unaffected by a session rename — the breadcrumb
      // re-derives the new session name from the next SSE snapshot.
    },
    onRollback: () => {
      const last = lastRenameSessionRef.current;
      if (last) {
        unmarkRenamed(last.server, last.oldName);
      }
    },
    onError: (err) => {
      addToast(err.message || "Failed to rename session");
    },
    onSettled: () => {
      lastRenameSessionRef.current = null;
    },
  });

  // Inline rename window (optimistic) — finds windowId via editingWindow state.
  // Shared with the top-bar WindowHeading via useWindowRename (change 5ilm).
  const { execute: executeRenameWindow } = useWindowRename();

  // Optimistic move for drag-drop window reorder (insert-before semantics).
  // Snapshot is keyed by the store's composite key (`${server}:${windowId}`)
  // so the rollback restores the right per-server entries.
  // Tuple: (server, session, srcWindowId, srcIndex, dstIndex). The move API
  // addresses the source by its stable windowId; the optimistic store reorder
  // is inherently positional so it still uses srcIndex/dstIndex.
  const preMoveEntriesRef = useRef<Map<string, { index: number }> | null>(null);
  const { execute: executeMoveWindow, isPending: isMovePending } = useOptimisticAction<[string, string, string, number, number]>({
    action: (srv, _session, srcWindowId, _srcIndex, dstIndex) => moveWindow(srv, srcWindowId, dstIndex),
    onOptimistic: (srv, session, _srcWindowId, srcIndex, dstIndex) => {
      const entries = useWindowStore.getState().entries;
      const snapshot = new Map<string, { index: number }>();
      for (const [key, e] of entries) {
        if (e.server === srv && e.session === session) snapshot.set(key, { index: e.index });
      }
      preMoveEntriesRef.current = snapshot;
      moveWindowOrder(srv, session, srcIndex, dstIndex);
    },
    onAlwaysRollback: () => {
      if (preMoveEntriesRef.current) {
        const snapshot = preMoveEntriesRef.current;
        useWindowStore.setState((state) => {
          const newEntries = new Map(state.entries);
          for (const [id, saved] of snapshot) {
            const existing = newEntries.get(id);
            if (existing) newEntries.set(id, { ...existing, index: saved.index });
          }
          return { entries: newEntries };
        });
        preMoveEntriesRef.current = null;
      }
    },
    onAlwaysSettled: () => {
      preMoveEntriesRef.current = null;
    },
    onError: (err) => {
      addToast(err.message || "Failed to move window");
    },
  });

  // Optimistic cross-session window move. Cross-server moves are rejected
  // upstream (DnD handler emits a toast) so srcServer == dstServer here.
  const lastMoveToSessionRef = useRef<{ server: string; srcSession: string; windowId: string; optimisticId: string } | null>(null);
  const { execute: executeMoveToSession, isPending: isCrossMovePending } = useOptimisticAction<[string, string, number, string, string, string]>({
    action: (srv, _srcSession, _srcIndex, windowId, _windowName, dstSession) =>
      moveWindowToSession(srv, windowId, dstSession),
    onOptimistic: (srv, srcSession, _srcIndex, windowId, windowName, dstSession) => {
      killWindowStore(srv, srcSession, windowId);
      const optimisticId = addGhostWindow(srv, dstSession, windowName);
      lastMoveToSessionRef.current = { server: srv, srcSession, windowId, optimisticId };
      navigate({ to: "/$server", params: { server: srv } });
    },
    onAlwaysRollback: () => {
      const last = lastMoveToSessionRef.current;
      if (last) {
        restoreWindow(last.server, last.srcSession, last.windowId);
        removeGhost(last.optimisticId);
      }
    },
    onAlwaysSettled: () => {
      lastMoveToSessionRef.current = null;
    },
    onError: (err) => {
      addToast(err.message || "Failed to move window to session");
    },
  });

  useEffect(() => {
    if (editingWindow && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingWindow]);

  useEffect(() => {
    if (editingSession && sessionInputRef.current) {
      sessionInputRef.current.focus();
      sessionInputRef.current.select();
    }
  }, [editingSession]);

  const handleStartSessionEditing = useCallback((server: string, sessionName: string) => {
    cancelledRef.current = true;
    setEditingWindow(null);
    sessionCancelledRef.current = true;
    setEditingSession({ server, name: sessionName });
    setEditingSessionName(sessionName);
    sessionOriginalNameRef.current = sessionName;
    sessionCancelledRef.current = false;
  }, []);

  const handleSessionRenameCommit = useCallback(() => {
    if (!editingSession) return;
    const trimmed = editingSessionName.trim();
    const originalName = sessionOriginalNameRef.current;
    const { server: srv, name: sessionName } = editingSession;
    setEditingSession(null);
    if (trimmed && trimmed !== originalName) {
      executeRenameSession(srv, sessionName, trimmed);
    }
  }, [editingSession, editingSessionName, executeRenameSession]);

  const handleSessionRenameCancel = useCallback(() => {
    sessionCancelledRef.current = true;
    setEditingSession(null);
  }, []);

  const handleSessionRenameKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSessionRenameCommit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleSessionRenameCancel();
    }
  }, [handleSessionRenameCommit, handleSessionRenameCancel]);

  const handleSessionRenameBlur = useCallback(() => {
    if (sessionCancelledRef.current) return;
    handleSessionRenameCommit();
  }, [handleSessionRenameCommit]);

  const handleStartEditing = useCallback((server: string, session: string, windowId: string, currentName: string) => {
    sessionCancelledRef.current = true;
    setEditingSession(null);
    cancelledRef.current = true;
    setEditingWindow({ server, session, windowId });
    setEditingName(currentName);
    originalNameRef.current = currentName;
    cancelledRef.current = false;
  }, []);

  const handleRenameCommit = useCallback(() => {
    if (!editingWindow) return;
    const trimmed = editingName.trim();
    const originalName = originalNameRef.current;
    const { server: srv, session, windowId } = editingWindow;
    setEditingWindow(null);
    if (trimmed && trimmed !== originalName) {
      executeRenameWindow(srv, session, windowId, trimmed);
    }
  }, [editingWindow, editingName, executeRenameWindow]);

  const handleRenameCancel = useCallback(() => {
    cancelledRef.current = true;
    setEditingWindow(null);
  }, []);

  // Window rename key/blur — stable wrappers passed straight to ServerGroup so
  // the per-row closures inside it don't have to be rebuilt every render.
  const handleWindowRenameKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleRenameCommit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleRenameCancel();
    }
  }, [handleRenameCommit, handleRenameCancel]);

  const handleWindowRenameBlur = useCallback(() => {
    if (cancelledRef.current) return;
    handleRenameCommit();
  }, [handleRenameCommit]);

  const handleDragStart = useCallback((e: React.DragEvent, server: string, sessionName: string, windowIndex: number, windowId: string, windowName: string) => {
    setDragSource({ server, session: sessionName, index: windowIndex });
    e.dataTransfer.setData(
      "application/json",
      JSON.stringify({ server, session: sessionName, index: windowIndex, windowId, name: windowName }),
    );
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, server: string, sessionName: string, windowIndex: number) => {
    if (!dragSource) return;
    // Allow dragover only within the same server + same session (existing
    // within-session reorder semantics). Cross-server is rejected at drop.
    if (dragSource.server !== server || dragSource.session !== sessionName) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTarget((prev) => {
      if (prev?.server === server && prev?.session === sessionName && prev?.index === windowIndex) return prev;
      return { server, session: sessionName, index: windowIndex };
    });
  }, [dragSource]);

  const handleDrop = useCallback((e: React.DragEvent, server: string, sessionName: string, windowIndex: number) => {
    e.preventDefault();
    setDropTarget(null);
    setDragSource(null);

    let data: { server?: string; session: string; index: number; windowId: string; name: string };
    try {
      data = JSON.parse(e.dataTransfer.getData("application/json"));
    } catch {
      return;
    }

    // Cross-server drop rejection.
    if (data.server && data.server !== server) {
      addToast("Moving windows across tmux servers isn't supported yet");
      return;
    }
    if (data.session !== sessionName || data.index === windowIndex) return;
    if (isMovePending) return;

    executeMoveWindow(server, data.session, data.windowId, data.index, windowIndex);
  }, [isMovePending, executeMoveWindow, addToast]);

  const handleDragEnd = useCallback(() => {
    setDragSource(null);
    setDropTarget(null);
    setSessionDropTarget(null);
  }, []);

  const handleSessionDragOver = useCallback((e: React.DragEvent, server: string, sessionName: string) => {
    if (!dragSource) return;
    // Allow within-server cross-session drag-over preview.
    if (dragSource.server !== server) return;
    if (dragSource.session === sessionName) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setSessionDropTarget({ server, session: sessionName });
  }, [dragSource]);

  const handleSessionDragLeave = useCallback((_e: React.DragEvent, server: string, sessionName: string) => {
    if (sessionDropTarget?.server === server && sessionDropTarget?.session === sessionName) {
      setSessionDropTarget(null);
    }
  }, [sessionDropTarget]);

  const handleSessionDrop = useCallback((e: React.DragEvent, server: string, sessionName: string) => {
    e.preventDefault();
    setSessionDropTarget(null);
    setDropTarget(null);
    setDragSource(null);

    let data: { server?: string; session: string; index: number; windowId: string; name: string };
    try {
      data = JSON.parse(e.dataTransfer.getData("application/json"));
    } catch {
      return;
    }

    // Cross-server drop rejection.
    if (data.server && data.server !== server) {
      addToast("Moving windows across tmux servers isn't supported yet");
      return;
    }
    if (data.session === sessionName) return;
    if (isCrossMovePending) return;

    executeMoveToSession(server, data.session, data.index, data.windowId, data.name, sessionName);
  }, [isCrossMovePending, executeMoveToSession, addToast]);

  // Per-server session drag-reorder. Source carries server so the drag is
  // confined to one server's group.
  const handleSessionReorderStart = useCallback((e: React.DragEvent, server: string, name: string, orderedNames: string[]) => {
    setSessionDragSource({ server, name });
    e.dataTransfer.setData("application/x-session-reorder", `${server}:${name}`);
    e.dataTransfer.effectAllowed = "move";
    orderOverrideRef.current[server] = orderedNames;
    forceRender();
  }, []);

  const handleSessionReorderOver = useCallback((e: React.DragEvent, server: string, targetName: string, naturalNames: string[]) => {
    if (!sessionDragSource || sessionDragSource.server !== server) return; // source guard: drag confined to one server's group
    if (!e.dataTransfer.types.includes("application/x-session-reorder")) return;
    // Accept the drop BEFORE the self-name check so HTML5 DnD registers the
    // release (no native cancelled-drag snap-back on the dragged row itself,
    // the common terminal hover state under insert-before splicing).
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (sessionDragSource.name === targetName) return; // …then bail: nothing to reorder

    const base = orderOverrideRef.current[server] ?? naturalNames;
    const dragName = sessionDragSource.name;
    const fromIdx = base.indexOf(dragName);
    const toIdx = base.indexOf(targetName);
    if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;
    const next = [...base];
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, dragName);

    if (orderPutTimerRef.current) clearTimeout(orderPutTimerRef.current);
    const orderToPut = next.slice();
    orderPutTimerRef.current = setTimeout(() => {
      orderPutTimerRef.current = null;
      setSessionOrder(server, orderToPut).catch((err) => {
        addToast(err.message || "Failed to save session order");
      });
    }, SESSION_ORDER_DEBOUNCE_MS);

    orderOverrideRef.current[server] = next;
    forceRender();
  }, [sessionDragSource, addToast]);

  const handleSessionReorderEnd = useCallback(() => {
    setSessionDragSource(null);
  }, []);

  const toggleSession = useCallback((server: string, name: string) => {
    setCollapsed((prev) => ({ ...prev, [`${server}:${name}`]: !prev[`${server}:${name}`] }));
  }, []);

  function handleKill() {
    if (!killTarget) return;
    executeKillFromDialog(killTarget.server, killTarget);
    setKillTarget(null);
  }

  // Bonus a11y: when the mobile drawer opens, land the keyboard user on their
  // current context. Reads `isMobile` + chrome `sidebarOpen` directly (no prop
  // threaded from Shell) and scrolls/focuses the selected window row.
  // Supersedes the focus trap's first-focusable focus when an
  // `[aria-current="page"]` row exists; when none does (board route, fresh
  // session), this is a no-op and the trap's first-focus stands. Mirrors the
  // ServerPanel mount-scroll pattern (server-panel.tsx:77-82). The focus is
  // deferred to the next frame so it runs AFTER the trap's mount-focus
  // (committed in Shell's effect) and wins the same-tick race.
  const isMobile = useIsMobile();
  const { sidebarOpen } = useChromeState();
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!isMobile || !sidebarOpen) return;
    // Scope to a WINDOW row: window rows live under a `[data-window-id]`
    // wrapper (window-row.tsx) and the selected row's button carries
    // `aria-current="page"`. The active BoardsSection row also carries
    // `aria-current="page"` and renders FIRST inside `<nav>`, but it has no
    // `[data-window-id]` ancestor, so it is excluded — on board routes (no
    // selected window) this no-ops and the trap's first-focus stands.
    const row = navRef.current?.querySelector<HTMLElement>('[data-window-id] [aria-current="page"]');
    if (!row) return; // fallback: trap's first-focusable focus stands
    // SF-4: sync the roving cursor to the row we focus so the `tabIndex=0`
    // tab-stop and the focused row do not desync (which would make the next
    // arrow press jump). The roving treeitem is the `[data-window-id]` wrapper;
    // its roving handle is the globally-unique `data-row-key` (`${server}:${windowId}`),
    // NOT the bare `data-window-id` (which collides across open server groups).
    const treeItem = row.closest<HTMLElement>("[data-window-id]");
    const key = treeItem?.getAttribute("data-row-key") ?? null;
    if (key != null) setRovingKey(key);
    const raf = requestAnimationFrame(() => {
      if (typeof row.scrollIntoView === "function") row.scrollIntoView({ block: "nearest" });
      row.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [isMobile, sidebarOpen]);

  // ── Roving-tabindex arrow navigation (W3C APG Tree pattern) ───────────────
  // The roving "cursor" is tracked as a stable ROW KEY (a window row's
  // `data-row-key` = `${server}:${windowId}`, or a session row's
  // `data-session-row` = `${server}:${name}` — both globally unique so the key
  // is unambiguous across multiple open server groups whose tmux ids (@N) repeat)
  // rather than a numeric index, so it survives the visible-rows list growing or
  // shrinking (expand/collapse, SSE adds/removes) without pointing at the wrong
  // row. Exactly one rendered treeitem gets `tabIndex={0}` (the roving row, or
  // the FIRST visible row as a fallback when `rovingKey` matches nothing); the
  // rest get `-1`. Threading only this single string into the memo'd groups
  // means an arrow press changes `tabIndex` on just the two affected rows.
  const treeRef = useRef<HTMLDivElement>(null);
  const [rovingKey, setRovingKey] = useState<string | null>(null);

  // Identity lookup for each roving row key. Built per-server inside each
  // ServerGroup (where the MERGED session/window data lives — raw sessionsByServer
  // lacks ghost/rename overlays, so a renamed session's `${server}:${newName}`
  // key would not match a raw-derived map). Each group registers its own slice;
  // the union is read at Enter/Space time to call onSelectWindow/onSelectFirstWindow
  // DIRECTLY with a typed identity — no brittle DOM `.click()` synthesis.
  const rowIdentityRef = useRef<Map<string, Map<string, RowIdentity>>>(new Map());
  // Bumped only when a group's visible-row SET signature changes (window
  // add/remove, collapse/expand, rename) — NOT on the several-per-second passive
  // SSE activity ticks. Gates the roving-key normalization effect so it
  // re-validates only when the set actually changes (Wave-2 #262 invariant: an
  // SSE tick must NOT change roving state).
  const [rowsVersion, bumpRowsVersion] = useReducer((x: number) => x + 1, 0);
  const groupSignatureRef = useRef<Map<string, string>>(new Map());
  const registerGroupRows = useCallback(
    (groupServer: string, signature: string, slice: Map<string, RowIdentity>) => {
      const prev = groupSignatureRef.current.get(groupServer);
      groupSignatureRef.current.set(groupServer, signature);
      rowIdentityRef.current.set(groupServer, slice);
      // Only nudge the normalize effect when this group's set signature changed.
      if (prev !== signature) bumpRowsVersion();
    },
    [],
  );

  const identityForKey = useCallback((key: string): RowIdentity | null => {
    for (const slice of rowIdentityRef.current.values()) {
      const id = slice.get(key);
      if (id) return id;
    }
    return null;
  }, []);

  // Read the currently-rendered visible tree rows straight from the DOM — they
  // are emitted in document order, already exclude collapsed sessions' windows
  // (those aren't rendered) and flow continuously across open server groups, so
  // the DOM is the authoritative flattened visible-rows list. Each row exposes
  // its identity via `data-window-id` (window) or `data-session-row` (session).
  const getVisibleRows = useCallback((): HTMLElement[] => {
    const root = treeRef.current;
    if (!root) return [];
    return Array.from(root.querySelectorAll<HTMLElement>('[role="treeitem"]'));
  }, []);

  const rowKeyOf = useCallback((el: HTMLElement): string | null => {
    // `data-row-key` is the GLOBALLY-unique roving handle (window rows carry
    // `${server}:${windowId}`; tmux ids like `@1` are only unique within one
    // server, so the bare `data-window-id` would collide across open groups).
    // Session rows already use the unique `data-session-row` (`${server}:${name}`).
    return el.getAttribute("data-row-key") ?? el.getAttribute("data-session-row");
  }, []);

  // After any render that changed the visible rows, move DOM focus + scroll to
  // the roving row — mirrors the CommandPalette/ThemeSelector
  // "Keyboard-Navigable List Scroll Pattern" (listRef + scrollIntoView nearest).
  // `focusMovedRef` gates the focus() call to user-driven key navigation only,
  // so a passive re-render (SSE tick) never steals focus into the sidebar.
  const focusMovedRef = useRef(false);
  useEffect(() => {
    if (rovingKey === null) return;
    if (!focusMovedRef.current) return;
    focusMovedRef.current = false;
    const root = treeRef.current;
    if (!root) return;
    const sel = `[data-row-key="${CSS.escape(rovingKey)}"], [data-session-row="${CSS.escape(rovingKey)}"]`;
    const row = root.querySelector<HTMLElement>(sel);
    if (!row) return;
    if (typeof row.scrollIntoView === "function") row.scrollIntoView({ block: "nearest" });
    row.focus();
  }, [rovingKey]);

  // Normalize the roving key: when the visible-row SET changes, if the current
  // `rovingKey` matches no rendered treeitem (initial mount, collapse removed it,
  // server switched, rename re-keyed it), reset it to the FIRST visible row so
  // the tree always has exactly one tab stop (`tabIndex={0}`). This is a pure
  // render-follow effect — it does NOT move DOM focus (focusMovedRef stays
  // false), so a passive SSE re-render never pulls focus into the sidebar.
  //
  // Gated on `[rovingKey, rowsVersion]` — `rowsVersion` is bumped ONLY when a
  // group's visible-set signature changes (registerGroupRows), so this does NOT
  // run on the several-per-second passive SSE activity ticks, which would
  // otherwise run a full-tree querySelectorAll and could flip roving state on
  // window churn (the Wave-2 #262 invariant: an SSE tick must NOT change roving
  // state).
  useEffect(() => {
    const rows = getVisibleRows();
    if (rows.length === 0) {
      if (rovingKey !== null) setRovingKey(null);
      return;
    }
    const matched = rovingKey != null && rows.some((r) => rowKeyOf(r) === rovingKey);
    if (!matched) {
      const firstKey = rowKeyOf(rows[0]);
      if (firstKey != null && firstKey !== rovingKey) setRovingKey(firstKey);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rovingKey, rowsVersion]);

  // Move the roving cursor to the row at `nextIndex` in the visible-rows list,
  // updating both the key (drives `tabIndex`) and DOM focus.
  const moveRovingTo = useCallback((rows: HTMLElement[], nextIndex: number) => {
    const clamped = Math.max(0, Math.min(nextIndex, rows.length - 1));
    const el = rows[clamped];
    if (!el) return;
    const key = rowKeyOf(el);
    if (key == null) return;
    focusMovedRef.current = true;
    if (key === rovingKey) {
      // Same key (e.g. stop-at-end) — the [rovingKey] effect won't re-fire, so
      // focus/scroll imperatively here to keep the row visible + focused.
      if (typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "nearest" });
      el.focus();
      focusMovedRef.current = false;
    } else {
      setRovingKey(key);
    }
  }, [rovingKey, rowKeyOf]);

  // Tree-container keydown. Scoped to the `role="tree"` element (never document,
  // never the terminal), so arrows act only when focus is inside the tree.
  const handleTreeKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    // Never hijack arrows/Enter while a rename input (or any editable) is the
    // target — its own onKeyDown commits/cancels and arrows move the caret.
    const target = e.target as HTMLElement;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target.isContentEditable
    ) {
      return;
    }

    const rows = getVisibleRows();
    if (rows.length === 0) return;
    // Anchor navigation on the row the user is ACTUALLY in: inner controls
    // (chevron/name/+) inside a treeitem stay Tab-focusable, so DOM focus can
    // sit in a different row than the one holding tabIndex=0. Prefer the event
    // target's nearest treeitem (matched by object identity, robust to
    // duplicate ids across servers) and fall back to `rovingKey`.
    const anchorRow = target.closest<HTMLElement>('[role="treeitem"]');
    let currentIndex = anchorRow ? rows.indexOf(anchorRow) : -1;
    if (currentIndex === -1) currentIndex = rows.findIndex((r) => rowKeyOf(r) === rovingKey);
    if (currentIndex === -1) currentIndex = 0; // no roving row yet → act from first
    const currentEl = rows[currentIndex];
    const isWindow = currentEl?.hasAttribute("data-window-id") ?? false;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        moveRovingTo(rows, currentIndex + 1); // stop at end (clamped in moveRovingTo)
        break;
      case "ArrowUp":
        e.preventDefault();
        moveRovingTo(rows, currentIndex - 1); // stop at start
        break;
      case "Home":
        e.preventDefault();
        moveRovingTo(rows, 0);
        break;
      case "End":
        e.preventDefault();
        moveRovingTo(rows, rows.length - 1);
        break;
      case "ArrowRight": {
        e.preventDefault();
        if (isWindow) break; // leaf — no-op
        const expanded = currentEl?.getAttribute("aria-expanded") === "true";
        if (!expanded) {
          // collapsed session → expand (focus stays on the session row)
          const key = currentEl ? rowKeyOf(currentEl) : null;
          const sep = key?.indexOf(":") ?? -1;
          if (key && sep > -1) toggleSession(key.slice(0, sep), key.slice(sep + 1));
        } else {
          // expanded session → move to first window child (next visible row,
          // which is this session's first window when expanded)
          moveRovingTo(rows, currentIndex + 1);
        }
        break;
      }
      case "ArrowLeft": {
        e.preventDefault();
        if (isWindow) {
          // window → move to parent session row (scan upward for the nearest
          // level-1 treeitem)
          for (let i = currentIndex - 1; i >= 0; i--) {
            if (rows[i].getAttribute("aria-level") === "1") {
              moveRovingTo(rows, i);
              break;
            }
          }
        } else {
          const expanded = currentEl?.getAttribute("aria-expanded") === "true";
          if (expanded) {
            // expanded session → collapse
            const key = currentEl ? rowKeyOf(currentEl) : null;
            const sep = key?.indexOf(":") ?? -1;
            if (key && sep > -1) toggleSession(key.slice(0, sep), key.slice(sep + 1));
          }
          // collapsed session → no-op (server header is a structural wrapper)
        }
        break;
      }
      case "Enter":
      case " ": { // Space
        e.preventDefault();
        if (!currentEl) break;
        const key = rowKeyOf(currentEl);
        if (key == null) break;
        const identity = identityForKey(key);
        if (!identity) break;
        if (identity.kind === "window") {
          // SF-3: ghost/optimistic rows have no real windowId — activation is a
          // no-op (mirrors the isGhostWindow/dragEnabled guard on the drag path).
          if (identity.ghost || identity.windowId === "") break;
          // SF-2: call the handler DIRECTLY with the typed identity — no brittle
          // DOM `.click()` synthesis or magic-string aria-label coupling.
          onSelectWindow(identity.server, identity.session, identity.windowId);
        } else {
          // Session row: select its first window (no-op if the session is empty,
          // i.e. no first window to activate).
          if (identity.firstWindowId === "") break;
          onSelectWindow(identity.server, identity.session, identity.firstWindowId);
        }
        break;
      }
      default:
        break;
    }
  }, [getVisibleRows, rowKeyOf, rovingKey, moveRovingTo, toggleSession, identityForKey, onSelectWindow]);

  // Stable per-action callbacks passed to every ServerGroup. Each takes the
  // server (and other identity) as a leading argument so a single reference
  // serves all groups — the group binds its own `server`/`session`/`windowId`
  // when it invokes them. This is what makes the React.memo on ServerGroup
  // effective: an SSE session tick changes the per-server data Maps but NOT
  // these handler identities, so unaffected groups skip re-render. (Drag/edit
  // state IS in some deps — that state is not touched by SSE ticks, so the
  // several-times-per-second churn never invalidates them; a real drag does,
  // which is correct and rare.) Follows the existing `toggleSession` pattern.
  const handleSessionRowKill = useCallback((server: string, name: string, count: number, ctrl: boolean) => {
    if (ctrl) {
      executeKillSession(server, name);
      return;
    }
    setKillTarget({ type: "session", server, session: name, windowCount: count });
  }, [executeKillSession]);

  const handleWindowRowKill = useCallback((server: string, session: string, windowId: string, ctrl: boolean) => {
    if (ctrl) {
      executeKillWindow(server, session, windowId);
      return;
    }
    setKillTarget({ type: "window", server, session, windowId, windowCount: 1 });
  }, [executeKillWindow]);

  const handleSessionColorChange = useCallback((server: string, name: string, c: string | null) => {
    setSessionColorApi(server, name, c).catch((err) =>
      addToast(err.message || "Failed to set session color"),
    );
  }, [addToast]);

  const handleWindowColorChange = useCallback((server: string, _session: string, windowId: string, c: string | null) => {
    setWindowColorApi(server, windowId, c).catch((err) =>
      addToast(err.message || "Failed to set window color"),
    );
  }, [addToast]);

  // Persist a window's marker state. The combined Label picker (opened from the
  // left-edge zone or the `Window: Label` palette action) passes the EXACT state
  // the user picked — this only writes it. Mirrors handleWindowColorChange.
  const handleWindowMarkerChange = useCallback((server: string, _session: string, windowId: string, marker: string | null) => {
    setWindowMarkerApi(server, windowId, marker).catch((err) =>
      addToast(err.message || "Failed to set window marker"),
    );
  }, [addToast]);

  return (
    <nav ref={navRef} aria-label="Sessions" className="flex flex-col h-full">
      {/* Boards — cross-server section, always visible at the top of the
          sidebar (renders an empty-state hint when no boards exist). Boards
          are curated workspaces; placing them above Servers reflects their
          higher-affinity destination role. */}
      <BoardsSection />

      {/* Server panel — collapsible. The set of servers is the same multi-server
          list, so this stays below Boards regardless of route. */}
      <ServerPanel
        server={currentServer ?? ""}
        servers={servers}
        serverColors={serverColors}
        waitingCounts={waitingCounts}
        rowTints={rowTints}
        rowBorders={rowBorders}
        onSwitchServer={handleSwitchServer}
        onCreateServer={onCreateServer}
        onKillServer={onKillServer}
        onRefreshServers={refreshServers}
        onSidebarResizeStart={onSidebarResizeStart}
        onServerColorChange={(targetServer, c) => {
          setServerColors((prev) => {
            const next = { ...prev };
            if (c == null) { delete next[targetServer]; } else { next[targetServer] = c; }
            return next;
          });
          setServerColorApi(targetServer, c).catch((err) =>
            addToast(err.message || "Failed to set server color"),
          );
        }}
      />

      {/* Sessions — flex-grows to fill remaining space; per-server groups inside */}
      <div className="border-t-[3px] border-border flex flex-col flex-1 min-h-0">
        <div className="flex items-center gap-1.5 w-full pl-1.5 pr-1.5 sm:pr-2 py-1 text-xs text-text-secondary shrink-0 border-b border-border">
          <TypedLabel text="Sessions" className="font-bold uppercase tracking-wide" />
          {currentServer && currentSession && (
            <span className="ml-auto flex items-center gap-1 min-w-0 truncate">
              <span className="truncate text-text-primary font-mono">{currentSession}</span>
            </span>
          )}
        </div>
        <div
          ref={treeRef}
          role="tree"
          aria-label="Session tree"
          onKeyDown={handleTreeKeyDown}
          className="flex-1 min-h-0 overflow-y-auto"
        >
          {(() => {
            if (servers.length === 0) {
              return <div className="text-text-secondary text-xs py-4 text-center">No servers</div>;
            }
            const visibleServers = serverPaneOpen
              ? servers.filter((s) => s.name === currentServer)
              : servers;
            // When the Server Pane is open, show the hint both when no server is
            // selected (board route) and when the selected server isn't present
            // in the list (stale/deleted route param). Otherwise the filtered
            // list would render an empty Sessions area with no explanation.
            if (serverPaneOpen && visibleServers.length === 0) {
              return <div className="text-text-secondary text-xs py-4 text-center">Select a server above to see its sessions.</div>;
            }
            return visibleServers.map((srvInfo) => {
              // Derive the displayed order per server: override ?? SSE order.
              // Per-server SSE-echo clear (no whole-Map effect): once the SSE
              // order for THIS server element-wise equals the stored override,
              // the round-trip has landed — drop the override so the row reads
              // the authoritative SSE order. Mutating the ref during render is
              // safe (it is not state); when equal we render `null` anyway, so
              // the displayed output is unchanged and no render nudge is needed.
              const sseOrder = ctx.sessionOrderByServer.get(srvInfo.name) ?? [];
              const override = orderOverrideRef.current[srvInfo.name];
              let localOrder: string[] | null = override ?? null;
              if (override && arraysEqual(override, sseOrder)) {
                delete orderOverrideRef.current[srvInfo.name];
                localOrder = null;
              }
              return (
              <ServerGroup
                key={srvInfo.name}
                server={srvInfo.name}
                isCurrent={srvInfo.name === currentServer}
                serverColor={serverColors[srvInfo.name]}
                rowTints={rowTints}
                rowBorders={rowBorders}
                isOpen={serverPaneOpen ? true : readServerOpen(srvInfo.name)}
                onToggleOpen={toggleServerSection}
                rawSessions={sessionsByServer.get(srvInfo.name) ?? []}
                sessionOrder={sseOrder}
                localOrder={localOrder}
                isConnected={isConnectedByServer.get(srvInfo.name) ?? false}
                currentSessionName={srvInfo.name === currentServer ? currentSession : null}
                currentWindowId={srvInfo.name === currentServer ? currentWindowId : null}
                rovingKey={rovingKey}
                registerGroupRows={registerGroupRows}
                editingWindow={editingWindow?.server === srvInfo.name ? editingWindow : null}
                editingName={editingName}
                inputRef={inputRef}
                editingSession={editingSession?.server === srvInfo.name ? editingSession.name : null}
                editingSessionName={editingSessionName}
                sessionInputRef={sessionInputRef}
                sessionDragSource={sessionDragSource?.server === srvInfo.name ? sessionDragSource.name : null}
                dragSource={dragSource?.server === srvInfo.name ? dragSource : null}
                dropTarget={dropTarget?.server === srvInfo.name ? dropTarget : null}
                sessionDropTarget={sessionDropTarget?.server === srvInfo.name ? sessionDropTarget.session : null}
                allBoards={allBoards}
                boardsLoading={boardsLoading}
                pinnedSet={pinnedSet}
                pinnedToBoard={pinnedToBoard}
                boardForWindow={boardForWindow}
                isPinnedToActiveBoardFor={isPinnedToActiveBoardFor}
                onNavigateToBoard={onNavigateToBoard}
                collapsed={collapsed}
                onToggleSession={toggleSession}
                onSelectWindow={onSelectWindow}
                onWaitingBadgeClick={onWaitingBadgeClick}
                onCreateWindow={onCreateWindow}
                onCreateSession={onCreateSession}
                onSpawnAgent={onSpawnAgent}
                onSessionRowKill={handleSessionRowKill}
                onWindowRowKill={handleWindowRowKill}
                onSessionStartEditing={handleStartSessionEditing}
                onSessionRenameKeyDown={handleSessionRenameKeyDown}
                onSessionRenameBlur={handleSessionRenameBlur}
                onSessionNameChange={setEditingSessionName}
                onWindowStartEditing={handleStartEditing}
                onWindowNameChange={setEditingName}
                onWindowRenameKeyDown={handleWindowRenameKeyDown}
                onWindowRenameBlur={handleWindowRenameBlur}
                onSessionColorChange={handleSessionColorChange}
                onWindowColorChange={handleWindowColorChange}
                onWindowMarkerChange={handleWindowMarkerChange}
                onWindowDragStart={handleDragStart}
                onWindowDragOver={handleDragOver}
                onWindowDrop={handleDrop}
                onWindowDragEnd={handleDragEnd}
                onSessionDragOver={handleSessionDragOver}
                onSessionDragLeave={handleSessionDragLeave}
                onSessionDrop={handleSessionDrop}
                onSessionReorderStart={handleSessionReorderStart}
                onSessionReorderOver={handleSessionReorderOver}
                onSessionReorderEnd={handleSessionReorderEnd}
              />
              );
            });
          })()}
        </div>
      </div>

      {/* Status panels — pinned at bottom. Show metrics + selected window
          status only when there's a current server. */}
      <BottomPanels currentServer={currentServer} currentSessionName={currentSession} currentWindowId={currentWindowId} />

      {/* Kill confirmation */}
      {killTarget && (
        <KillDialog
          killTarget={killTarget}
          onConfirm={handleKill}
          onCancel={() => setKillTarget(null)}
        />
      )}
    </nav>
  );
}

/** Bottom of sidebar: WindowPanel (selected window status) + HostPanel (metrics).
 *  Pulls from context so the data follows `currentServer`. */
function BottomPanels({
  currentServer,
  currentSessionName,
  currentWindowId,
}: {
  currentServer: string | null;
  currentSessionName: string | null;
  currentWindowId: string | null;
}) {
  const ctx = useSessionContext();
  const sessions = currentServer ? ctx.sessionsByServer.get(currentServer) ?? [] : [];
  const isConnected = currentServer ? ctx.isConnectedByServer.get(currentServer) ?? false : false;
  const selectedWindow = currentSessionName && currentWindowId != null
    ? sessions.find((s) => s.name === currentSessionName)
        ?.windows.find((w) => w.windowId === currentWindowId) ?? null
    : null;
  return (
    <>
      <WindowPanel window={selectedWindow} />
      <HostPanel isConnected={isConnected} />
    </>
  );
}

/** Per-server group — renders the group header + the sessions tree. The
 *  rendering logic mirrors the legacy single-server sidebar; per-server props
 *  are threaded through from the parent. */
type ServerGroupProps = {
  server: string;
  isCurrent: boolean;
  serverColor: string | undefined;
  rowTints: Map<string, import("@/themes").RowTint>;
  rowBorders: Map<string, string>;
  isOpen: boolean;
  onToggleOpen: (server: string) => void;
  rawSessions: ProjectSession[];
  sessionOrder: string[];
  localOrder: string[] | null;
  isConnected: boolean;
  currentSessionName: string | null;
  currentWindowId: string | null;
  /** Roving-tabindex cursor key (a window row's `data-row-key` =
   *  `${server}:${windowId}`, or a session row's `${server}:${name}`). The
   *  single row whose key matches gets `tabIndex={0}`; all others `-1`. A single
   *  string prop keeps the memo tree intact — an arrow press flips `tabIndex`
   *  on only the two affected rows. */
  rovingKey: string | null;
  /** Register this group's visible-row identity slice + a set-signature with the
   *  parent. Called from an effect after each render so the parent's
   *  union lookup (Enter/Space activation) and the roving-key normalization
   *  effect stay in sync with the MERGED rows actually painted. */
  registerGroupRows: (server: string, signature: string, slice: Map<string, RowIdentity>) => void;

  editingWindow: { server: string; session: string; windowId: string } | null;
  editingName: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  editingSession: string | null;
  editingSessionName: string;
  sessionInputRef: React.RefObject<HTMLInputElement | null>;
  sessionDragSource: string | null;
  dragSource: { server: string; session: string; index: number } | null;
  dropTarget: { server: string; session: string; index: number } | null;
  sessionDropTarget: string | null;

  allBoards: ReturnType<typeof useWindowPins>["boards"];
  boardsLoading: boolean;
  pinnedSet: Set<string>;
  pinnedToBoard: (board: string, server: string, windowId: string) => boolean;
  /** Reverse lookup: the single board a window is pinned to (co9z), or undefined
   *  if unpinned. Powers the pinned-row → board navigation affordance. Stable. */
  boardForWindow: (server: string, windowId: string) => string | undefined;
  isPinnedToActiveBoardFor: (winServer: string, windowId: string) => boolean;
  /** Navigate to a board's route (`/board/{board}`). Stable identity. */
  onNavigateToBoard: (board: string) => void;
  collapsed: Record<string, boolean>;

  onToggleSession: (server: string, name: string) => void;
  onSelectWindow: (server: string, session: string, windowId: string) => void;
  onWaitingBadgeClick?: (server: string, session: string) => void;
  onCreateWindow: (server: string, session: string) => void;
  onCreateSession: (server: string) => void;
  onSpawnAgent?: (server: string, session: string) => void;
  onSessionRowKill: (server: string, name: string, windowCount: number, ctrl: boolean) => void;
  onWindowRowKill: (server: string, session: string, windowId: string, ctrl: boolean) => void;
  onSessionStartEditing: (server: string, name: string) => void;
  onSessionRenameKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onSessionRenameBlur: () => void;
  onSessionNameChange: (value: string) => void;
  onWindowStartEditing: (server: string, session: string, windowId: string, currentName: string) => void;
  onWindowNameChange: (value: string) => void;
  onWindowRenameKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onWindowRenameBlur: () => void;
  onSessionColorChange: (server: string, name: string, color: string | null) => void;
  onWindowColorChange: (server: string, session: string, windowId: string, color: string | null) => void;
  onWindowMarkerChange: (server: string, session: string, windowId: string, marker: string | null) => void;
  onWindowDragStart: (e: React.DragEvent, server: string, session: string, index: number, windowId: string, name: string) => void;
  onWindowDragOver: (e: React.DragEvent, server: string, session: string, index: number) => void;
  onWindowDrop: (e: React.DragEvent, server: string, session: string, index: number) => void;
  onWindowDragEnd: () => void;
  onSessionDragOver: (e: React.DragEvent, server: string, session: string) => void;
  onSessionDragLeave: (e: React.DragEvent, server: string, session: string) => void;
  onSessionDrop: (e: React.DragEvent, server: string, session: string) => void;
  onSessionReorderStart: (e: React.DragEvent, server: string, name: string, orderedNames: string[]) => void;
  onSessionReorderOver: (e: React.DragEvent, server: string, targetName: string, naturalNames: string[]) => void;
  onSessionReorderEnd: () => void;
};

function ServerGroupInner(props: ServerGroupProps) {
  const {
    server,
    isCurrent,
    serverColor,
    rowTints,
    rowBorders,
    isOpen,
    onToggleOpen,
    rawSessions,
    sessionOrder,
    localOrder,
    currentSessionName,
    currentWindowId,
    rovingKey,
    registerGroupRows,
    editingWindow,
    editingName,
    inputRef,
    editingSession,
    editingSessionName,
    sessionInputRef,
    sessionDragSource,
    dragSource,
    dropTarget,
    sessionDropTarget,
    allBoards,
    boardsLoading,
    pinnedSet,
    pinnedToBoard,
    boardForWindow,
    isPinnedToActiveBoardFor,
    onNavigateToBoard,
    collapsed,
    onToggleSession,
    onSelectWindow,
    onWaitingBadgeClick,
    onCreateWindow,
    onCreateSession,
    onSpawnAgent,
    onSessionRowKill,
    onWindowRowKill,
    onSessionStartEditing,
    onSessionRenameKeyDown,
    onSessionRenameBlur,
    onSessionNameChange,
    onWindowStartEditing,
    onWindowNameChange,
    onWindowRenameKeyDown,
    onWindowRenameBlur,
    onSessionColorChange,
    onWindowColorChange,
    onWindowMarkerChange,
    onWindowDragStart,
    onWindowDragOver,
    onWindowDrop,
    onWindowDragEnd,
    onSessionDragOver,
    onSessionDragLeave,
    onSessionDrop,
    onSessionReorderStart,
    onSessionReorderOver,
    onSessionReorderEnd,
  } = props;

  // Sync this server's session windows into the global window store. The
  // window store is what `useMergedSessions` reads to compose `MergedSession`
  // entries with ghost/rename overlays. Without this sync per-server,
  // non-current servers would render empty session rows. AppShell also
  // syncs the current server's sessions; the duplicate write is idempotent.
  // Pass `server` so per-server entries are scoped correctly — windowIds
  // from different servers must not collide in the global store.
  const setWindowsForSession = useWindowStore((s) => s.setWindowsForSession);
  useEffect(() => {
    for (const s of rawSessions) {
      setWindowsForSession(server, s.name, s.windows);
    }
  }, [server, rawSessions, setWindowsForSession]);

  // Apply optimistic merging (ghosts/rename/kill markers) per server.
  const sessions = useMergedSessions(rawSessions, server);

  const orderedSessions = useMemo(() => {
    const effectiveOrder = localOrder ?? sessionOrder;
    if (effectiveOrder.length === 0) return sessions;
    const orderMap = new Map(effectiveOrder.map((name, i) => [name, i]));
    const ranked = (s: { name: string }) => orderMap.get(s.name) ?? Number.POSITIVE_INFINITY;
    return [...sessions].sort((a, b) => {
      const ai = ranked(a);
      const bi = ranked(b);
      if (ai === bi) return 0;
      return ai - bi;
    });
  }, [sessions, sessionOrder, localOrder]);

  const naturalNames = useMemo(() => orderedSessions.map((s) => s.name), [orderedSessions]);

  // Build this group's roving-row identity slice + a cheap visible-set
  // signature. The slice maps each row key → typed identity for direct
  // Enter/Space activation in the parent (no DOM `.click()` synthesis). The
  // signature is a string of the visible-row keys IN ORDER — it changes only
  // when the visible-row SET changes (window add/remove, collapse/expand,
  // rename), NOT on a passive activity-only SSE tick, so the parent's
  // normalization effect is not woken on every tick. Derived from the SAME
  // merged `orderedSessions` that render the rows, so renamed-session keys
  // (`${server}:${newName}`) match the painted DOM.
  const { rowSlice, rowSignature } = useMemo(() => {
    const slice = new Map<string, RowIdentity>();
    const sigParts: string[] = [];
    if (isOpen) {
      for (const session of orderedSessions) {
        const sessionRowKey = `${server}:${session.name}`;
        const firstWindowId = session.windows[0]?.windowId ?? "";
        slice.set(sessionRowKey, { kind: "session", server, session: session.name, firstWindowId });
        sigParts.push(sessionRowKey);
        const isCollapsed = collapsed[sessionRowKey] ?? false;
        if (!isCollapsed) {
          for (const win of session.windows) {
            const ghost = isGhostWindow(win);
            // Globally-unique roving key: tmux ids (@N) collide across servers,
            // so namespace by server. Mirrors the WindowRow `data-row-key`.
            const winRowKey = `${server}:${ghost ? `ghost-${win.optimisticId}` : win.windowId}`;
            slice.set(winRowKey, {
              kind: "window",
              server,
              session: session.name,
              windowId: win.windowId,
              ghost,
            });
            sigParts.push(winRowKey);
          }
        }
      }
    }
    return { rowSlice: slice, rowSignature: sigParts.join("|") };
  }, [isOpen, orderedSessions, collapsed, server]);

  useEffect(() => {
    registerGroupRows(server, rowSignature, rowSlice);
  }, [registerGroupRows, server, rowSignature, rowSlice]);

  return (
    <section
      className="border-b border-border last:border-b-0"
      aria-labelledby={`server-header-${server}`}
    >
      {/* Server header — thin section break with a chevron disclosure marker
          to match the rest of the sidebar's collapse/expand convention.
          Active server gets brighter + medium-weight text; inactive stays
          dim. */}
      <div
        className="flex items-stretch w-full"
        aria-current={isCurrent ? "true" : undefined}
        data-current-server={isCurrent ? "true" : undefined}
        data-server={server}
      >
        <button
          id={`server-header-${server}`}
          type="button"
          onClick={() => onToggleOpen(server)}
          aria-expanded={isOpen}
          aria-label={isOpen ? `Collapse ${server} sessions` : `Expand ${server} sessions`}
          className={`flex-1 min-w-0 flex items-center gap-1.5 pl-2 pr-1.5 text-left text-[10px] uppercase tracking-wider min-h-[20px] coarse:min-h-[28px] transition-colors hover:bg-bg-card/30 ${
            isCurrent
              ? "text-text-primary font-medium"
              : "text-text-secondary hover:text-text-primary"
          }`}
        >
          <span
            className="inline-block transition-transform duration-150 shrink-0"
            style={{ transform: isOpen ? "rotate(0deg)" : "rotate(-90deg)" }}
            aria-hidden="true"
          >
            &#x25BC;
          </span>
          <span className="truncate">{server}</span>
        </button>
        <button
          onClick={() => onCreateSession(server)}
          aria-label={`New session on ${server}`}
          className="text-text-secondary hover:text-text-primary transition-colors text-[13px] px-1.5 sm:pr-2 flex items-center justify-center"
        >
          +
        </button>
      </div>

      {isOpen && (
        <div className="pt-1 pb-1">
          {sessions.length === 0 ? (
            <button
              onClick={() => onCreateSession(server)}
              className="block w-full pl-2 pr-2 py-1 text-left text-xs text-text-secondary hover:text-text-primary hover:bg-bg-card/30 transition-colors"
            >
              (no sessions — + new)
            </button>
          ) : (
            orderedSessions.map((session, sessionIdx) => {
              const isCollapsed = collapsed[`${server}:${session.name}`] ?? false;
              const isGhostSession = "optimistic" in session && session.optimistic;
              // Stable per-row tree handles + position metadata (W3C APG).
              const sessionRowKey = `${server}:${session.name}`;
              const windowGroupId = `windows-${server}-${session.name}`;
              return (
                <div
                  key={session.name}
                  // Stable per-session wrapper handle for tests (e.g.
                  // sync-latency scopes window-row counts to one session) —
                  // don't couple selectors to the spacing utility classes.
                  data-session-group={session.name}
                  className={`mb-1${isGhostSession ? " opacity-50 animate-pulse" : ""}`}
                >
                  <SessionRow
                    server={server}
                    session={session}
                    sessionColor={session.sessionColor}
                    rowTints={rowTints}
                    isCollapsed={isCollapsed}
                    isSessionDropTarget={sessionDropTarget === session.name}
                    editingSession={editingSession}
                    editingSessionName={editingSessionName}
                    sessionInputRef={sessionInputRef}
                    draggable={!isGhostSession}
                    isDragSource={sessionDragSource === session.name}
                    orderedNames={naturalNames}
                    tabIndex={rovingKey === sessionRowKey ? 0 : -1}
                    ariaSetSize={orderedSessions.length}
                    ariaPosInSet={sessionIdx + 1}
                    windowGroupId={windowGroupId}
                    sessionRowKey={sessionRowKey}
                    onDragStart={isGhostSession ? undefined : onSessionReorderStart}
                    onDragEnd={isGhostSession ? undefined : onSessionReorderEnd}
                    onToggleCollapse={onToggleSession}
                    onSelectFirstWindow={onSelectWindow}
                    onWaitingBadgeClick={onWaitingBadgeClick}
                    onCreateWindow={onCreateWindow}
                    onKillClick={onSessionRowKill}
                    onDoubleClickName={onSessionStartEditing}
                    onSessionNameChange={onSessionNameChange}
                    onSessionRenameKeyDown={onSessionRenameKeyDown}
                    onSessionRenameBlur={onSessionRenameBlur}
                    onDragOver={onSessionDragOver}
                    onReorderOver={onSessionReorderOver}
                    onDragLeave={onSessionDragLeave}
                    onDrop={onSessionDrop}
                    onColorChange={onSessionColorChange}
                    onSpawnAgent={onSpawnAgent}
                  />

                  {!isCollapsed && (
                    <div role="group" id={windowGroupId}>
                      {session.windows.map((win, winIdx) => {
                        const ghost = isGhostWindow(win);
                        // Globally-unique roving key — matches the row's
                        // `data-row-key` handle (namespaced by server because
                        // tmux ids @N collide across open server groups).
                        const winRowKey = `${server}:${ghost ? `ghost-${win.optimisticId}` : win.windowId}`;
                        // Exactly ONE row per session may look selected, so
                        // selection keys on a SINGLE source of truth — never
                        // an OR of two, which lights up two rows whenever the
                        // sources momentarily disagree.
                        //
                        // The URL is that source: a click navigates the URL
                        // optimistically (user intent leads), and an external
                        // `tmux select-window` / `rk riff` flips
                        // `isActiveWindow`, which the app's writeback effect
                        // then mirrors into the URL. So the URL converges to
                        // tmux truth within a render either way, and keying on
                        // it gives a single, unambiguous selection.
                        //
                        // `isActiveWindow` is the fallback ONLY before the URL
                        // has a window segment (just landed on the session,
                        // pre-writeback) — and even then only for the one
                        // tmux-active row. Ghost rows (mid-creation, not yet
                        // in the URL or snapshot) fall back to active match.
                        // The URL fallback compares the stable window ID (@N),
                        // not the mutable index.
                        const hasUrlWindow = currentWindowId != null;
                        const isSelected =
                          currentSessionName === session.name &&
                          (hasUrlWindow
                            ? currentWindowId === win.windowId
                            : (!ghost && win.isActiveWindow));
                        const isDragOver =
                          dropTarget?.server === server &&
                          dropTarget?.session === session.name &&
                          dropTarget?.index === win.index &&
                          dragSource?.index !== win.index;

                        return (
                          <WindowRow
                            key={ghost ? `ghost-${win.optimisticId}` : win.windowId}
                            win={win}
                            session={session.name}
                            isSelected={isSelected}
                            isDragOver={isDragOver}
                            color={win.color}
                            marker={win.marker}
                            rowTints={rowTints}
                            rowBorders={rowBorders}
                            editingWindow={editingWindow}
                            editingName={editingName}
                            inputRef={inputRef}
                            server={server}
                            boards={allBoards}
                            boardsLoading={boardsLoading}
                            isPinnedToAny={!ghost && pinnedSet.has(`${server}:${win.windowId}`)}
                            isPinnedToActiveBoard={!ghost && isPinnedToActiveBoardFor(server, win.windowId)}
                            isPinnedToBoard={pinnedToBoard}
                            pinnedBoard={ghost ? undefined : boardForWindow(server, win.windowId)}
                            onNavigateToBoard={onNavigateToBoard}
                            tabIndex={rovingKey === winRowKey ? 0 : -1}
                            rowKey={winRowKey}
                            ariaLevel={2}
                            ariaSetSize={session.windows.length}
                            ariaPosInSet={winIdx + 1}
                            onSelectWindow={onSelectWindow}
                            onStartEditing={onWindowStartEditing}
                            onWindowNameChange={onWindowNameChange}
                            onRenameKeyDown={onWindowRenameKeyDown}
                            onRenameBlur={onWindowRenameBlur}
                            onKillClick={onWindowRowKill}
                            draggable={!ghost}
                            onDragStart={ghost ? undefined : onWindowDragStart}
                            onDragOver={ghost ? undefined : onWindowDragOver}
                            onDrop={ghost ? undefined : onWindowDrop}
                            onDragEnd={ghost ? undefined : onWindowDragEnd}
                            onColorChange={ghost ? undefined : onWindowColorChange}
                            onMarkerChange={ghost ? undefined : onWindowMarkerChange}
                          />
                        );
                      })}
                      {dragSource?.session === session.name && (
                        <div className="relative">
                          <div
                            className="absolute inset-x-0 top-0 h-4 -mt-1"
                            style={
                              dropTarget?.server === server && dropTarget?.session === session.name && dropTarget?.index === -1
                                ? { boxShadow: "0 -2px 0 0 var(--color-accent)" }
                                : undefined
                            }
                            onDragOver={(e) => onWindowDragOver(e, server, session.name, -1)}
                            onDrop={(e) => {
                              let lastReal: (typeof session.windows)[number] | undefined;
                              for (let i = session.windows.length - 1; i >= 0; i--) {
                                if (!isGhostWindow(session.windows[i])) { lastReal = session.windows[i]; break; }
                              }
                              if (lastReal) onWindowDrop(e, server, session.name, lastReal.index + 1);
                            }}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </section>
  );
}

/** Memoized per-server group. An SSE session tick rebuilds the per-server data
 *  Maps in SessionContext, but `Sidebar` now passes every handler as a stable
 *  identity-arg `useCallback` and the context Map/array props (`rowTints`,
 *  `rowBorders`, `allBoards`, `pinnedSet`, `pinnedToBoard`,
 *  `isPinnedToActiveBoardFor`) are stable refs — so a tick on server B does not
 *  re-render server A's group at all. The group whose `rawSessions`/order/
 *  connection actually changed still re-renders (correct). (`boardsLoading` is a
 *  primitive that flips true→false once when the board list finishes loading —
 *  a legitimate one-time re-render of every group, not per-tick churn.) */
const ServerGroup = memo(ServerGroupInner);

