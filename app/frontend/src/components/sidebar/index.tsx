import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { killSession as killSessionApi, killWindow as killWindowApi, renameWindow, renameSession, moveWindow, moveWindowToSession, setSessionColor as setSessionColorApi, setWindowColor as setWindowColorApi, getAllServerColors, setServerColor as setServerColorApi, setSessionOrder, type ServerInfo } from "@/api/client";
import { useSessionContext } from "@/contexts/session-context";
import { useOptimisticAction } from "@/hooks/use-optimistic-action";
import { useOptimisticContext } from "@/contexts/optimistic-context";
import { useToast } from "@/components/toast";
import { useTheme } from "@/contexts/theme-context";
import { computeRowTints } from "@/themes";
import type { ProjectSession } from "@/types";
import { isGhostWindow } from "@/contexts/optimistic-context";
import type { MergedSession } from "@/contexts/optimistic-context";
import { useWindowStore } from "@/store/window-store";
import { useWindowPins } from "@/hooks/use-window-pins";
import { useActiveBoardName } from "@/hooks/use-active-board";
import { useMergedSessions } from "@/contexts/optimistic-context";
import { BoardsSection } from "./boards-section";
import { HostPanel } from "./host-panel";
import { KillDialog } from "./kill-dialog";
import { ServerPanel } from "./server-panel";
import { SessionRow } from "./session-row";
import { WindowPanel } from "./status-panel";
import { WindowRow } from "./window-row";

export type SidebarProps = {
  /** Identifies the "active" server for visual treatment + default expanded
   *  group. `null` on board route — no group is marked current and all
   *  groups follow persisted toggles (defaulting to collapsed). */
  currentServer: string | null;
  currentSession: string | null;
  currentWindowIndex: string | null;
  /** Session/window navigation. The `server` argument carries the source
   *  server so callers can route across servers. */
  onSelectWindow: (server: string, session: string, windowIndex: number) => void;
  /** Create a new window inside a session on a specific server. */
  onCreateWindow: (server: string, session: string) => void;
  /** Create a new session against a specific server (per-group "+" button). */
  onCreateSession: (server: string) => void;
  onCreateServer: () => void;
  onKillServer: (name: string) => void;
  /** Forwarded to `ServerPanel` → `CollapsiblePanel` as the corner pointerdown
   *  callback. When supplied (desktop only), a corner affordance is rendered at
   *  the bottom-right of the server panel drag handle that also starts a
   *  sidebar-width drag. */
  onSidebarResizeStart?: (e: React.PointerEvent<HTMLDivElement>) => void;
};

export function Sidebar({
  currentServer,
  currentSession,
  currentWindowIndex,
  onSelectWindow,
  onCreateWindow,
  onCreateSession,
  onCreateServer,
  onKillServer,
  onSidebarResizeStart,
}: SidebarProps) {
  const ctx = useSessionContext();
  const { servers, sessionsByServer, isConnectedByServer, refreshServers, attachServer } = ctx;
  // Pre-compute row tints from the active theme palette.
  const { theme } = useTheme();
  const rowTints = useMemo(() => computeRowTints(theme.palette), [theme.palette]);
  const ansiPalette = theme.palette.ansi;
  const navigate = useNavigate();
  const { addToast } = useToast();

  // Server colors from settings.yaml (all servers)
  const [serverColors, setServerColors] = useState<Record<string, number>>({});
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

  // Lazy-attach: ask the provider to open an EventSource for any server
  // whose group is open. The current server is auto-attached by the provider;
  // this covers user-expanded non-current groups.
  useEffect(() => {
    for (const s of servers) {
      if (readServerOpen(s.name)) {
        attachServer(s.name);
      }
    }
  }, [servers, attachServer, readServerOpen]);

  const toggleServerSection = useCallback((server: string) => {
    setServerSectionsOpen((prev) => {
      let current = prev[server];
      if (current === undefined) {
        try {
          const v = localStorage.getItem(`runkit-panel-sessions-${server}`);
          current = v === "false" ? false : v === "true" ? true : server === currentServer;
        } catch {
          current = server === currentServer;
        }
      }
      const next = !current;
      try {
        localStorage.setItem(`runkit-panel-sessions-${server}`, String(next));
      } catch {
        // localStorage unavailable
      }
      // When opening a non-current server's group, ask the provider to open
      // its EventSource so the group's session list is populated.
      if (next && server !== currentServer) {
        attachServer(server);
      }
      return { ...prev, [server]: next };
    });
  }, [currentServer, attachServer]);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [killTarget, setKillTarget] = useState<{
    type: "session" | "window";
    server: string;
    session: string;
    windowId?: string;
    windowIndex?: number;
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
  // (`sessionOrderByServer`). During an active drag we render `localOrder`
  // for snappy visual feedback and ignore incoming SSE events for that
  // server until dragend.
  const [sessionDragSource, setSessionDragSource] = useState<{ server: string; name: string } | null>(null);
  const [localOrderByServer, setLocalOrderByServer] = useState<Record<string, string[] | null>>({});
  const orderPutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const SESSION_ORDER_DEBOUNCE_MS = 250;

  const sessionDragSourceRef = useRef<typeof sessionDragSource>(null);
  sessionDragSourceRef.current = sessionDragSource;

  // Drop the local override for any server NOT mid-drag whenever SSE-delivered
  // order changes. Keep localOrder in place for the active drag's server.
  useEffect(() => {
    setLocalOrderByServer((prev) => {
      if (sessionDragSourceRef.current === null) {
        // No active drag — flush all overrides.
        if (Object.keys(prev).length === 0) return prev;
        return {};
      }
      const activeServer = sessionDragSourceRef.current.server;
      const next: Record<string, string[] | null> = {};
      for (const [s, v] of Object.entries(prev)) {
        if (s === activeServer) next[s] = v;
      }
      return next;
    });
  }, [ctx.sessionOrderByServer]);

  useEffect(() => {
    return () => {
      if (orderPutTimerRef.current) clearTimeout(orderPutTimerRef.current);
    };
  }, []);

  const { markKilled, unmarkKilled, markRenamed, unmarkRenamed } = useOptimisticContext();

  // Boards integration: aggregate pin map across all servers + boards.
  const { boards: allBoards, pinnedSet, pinnedToBoard } = useWindowPins();
  const activeBoardName = useActiveBoardName();
  const isPinnedToActiveBoardFor = useCallback(
    (winServer: string, windowId: string) => {
      if (!activeBoardName) return false;
      return pinnedToBoard(activeBoardName, winServer, windowId);
    },
    [activeBoardName, pinnedToBoard],
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
      if (last) clearSession(last.name);
      lastKillSessionRef.current = null;
    },
    onError: (err) => {
      addToast(err.message || "Failed to kill session");
    },
  });

  // Ctrl+click kill window (optimistic) — captures (session, windowId) per call.
  const lastKillWindowRef = useRef<{ session: string; windowId: string } | null>(null);
  const { execute: executeKillWindow } = useOptimisticAction<[string, string, string, number]>({
    action: (srv, session, _windowId, index) => killWindowApi(srv, session, index),
    onOptimistic: (_srv, session, windowId) => {
      lastKillWindowRef.current = { session, windowId };
      killWindowStore(session, windowId);
    },
    onAlwaysRollback: () => {
      if (lastKillWindowRef.current) {
        restoreWindow(lastKillWindowRef.current.session, lastKillWindowRef.current.windowId);
      }
    },
    onAlwaysSettled: () => {
      if (lastKillWindowRef.current) {
        restoreWindow(lastKillWindowRef.current.session, lastKillWindowRef.current.windowId);
      }
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

  const { execute: executeKillFromDialog } = useOptimisticAction<[string, { type: "session" | "window"; session: string; windowId?: string; windowIndex?: number }]>({
    action: (srv, target) => {
      if (target.type === "window" && target.windowIndex != null) {
        return killWindowApi(srv, target.session, target.windowIndex);
      }
      return killSessionApi(srv, target.session);
    },
    onOptimistic: (srv, target) => {
      killDialogServerRef.current = srv;
      if (target.type === "window" && target.windowId) {
        killWindowStore(target.session, target.windowId);
      } else {
        markKilled("session", srv, target.session);
      }
    },
    onAlwaysRollback: () => {
      const target = killTargetRef.current;
      if (!target) return;
      if (target.type === "window" && target.windowId) {
        restoreWindow(target.session, target.windowId);
      } else {
        unmarkKilled("session", killDialogServerRef.current, target.session);
      }
    },
    onAlwaysSettled: () => {
      const target = killTargetRef.current;
      if (!target) return;
      if (target.type === "window" && target.windowId) {
        restoreWindow(target.session, target.windowId);
      } else {
        clearSession(target.session);
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
      // Navigate immediately if the renamed session is the user's current one.
      if (
        currentServer === srv &&
        currentSession === oldName &&
        currentWindowIndex
      ) {
        navigate({
          to: "/$server/$session/$window",
          params: { server: srv, session: newName, window: currentWindowIndex },
          replace: true,
        });
      }
    },
    onRollback: () => {
      const last = lastRenameSessionRef.current;
      if (last) {
        unmarkRenamed(last.server, last.oldName);
        if (
          currentServer === last.server &&
          currentSession === last.newName &&
          currentWindowIndex
        ) {
          navigate({
            to: "/$server/$session/$window",
            params: { server: last.server, session: last.oldName, window: currentWindowIndex },
            replace: true,
          });
        }
      }
    },
    onError: (err) => {
      addToast(err.message || "Failed to rename session");
    },
    onSettled: () => {
      lastRenameSessionRef.current = null;
    },
  });

  // Inline rename window (optimistic) — finds windowId via editingWindow state
  const lastRenameWindowRef = useRef<{ session: string; windowId: string } | null>(null);
  const renameWindowStore = useWindowStore((state) => state.renameWindow);
  const clearRename = useWindowStore((state) => state.clearRename);
  const { execute: executeRenameWindow } = useOptimisticAction<[string, string, number, string, string]>({
    action: (srv, session, index, newName, _windowId) => renameWindow(srv, session, index, newName),
    onOptimistic: (_srv, session, _index, newName, windowId) => {
      lastRenameWindowRef.current = { session, windowId };
      renameWindowStore(session, windowId, newName);
    },
    onRollback: () => {
      if (lastRenameWindowRef.current) {
        clearRename(lastRenameWindowRef.current.session, lastRenameWindowRef.current.windowId);
      }
    },
    onError: (err) => {
      addToast(err.message || "Failed to rename window");
    },
    onSettled: () => {
      if (lastRenameWindowRef.current) {
        clearRename(lastRenameWindowRef.current.session, lastRenameWindowRef.current.windowId);
      }
      lastRenameWindowRef.current = null;
    },
  });

  // Optimistic move for drag-drop window reorder (insert-before semantics)
  const preMoveEntriesRef = useRef<Map<string, { session: string; index: number }> | null>(null);
  const { execute: executeMoveWindow, isPending: isMovePending } = useOptimisticAction<[string, string, number, number]>({
    action: (srv, session, srcIndex, dstIndex) => moveWindow(srv, session, srcIndex, dstIndex),
    onOptimistic: (_srv, session, srcIndex, dstIndex) => {
      const entries = useWindowStore.getState().entries;
      const snapshot = new Map<string, { session: string; index: number }>();
      for (const [id, e] of entries) {
        if (e.session === session) snapshot.set(id, { session: e.session, index: e.index });
      }
      preMoveEntriesRef.current = snapshot;
      moveWindowOrder(session, srcIndex, dstIndex);
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

  // Optimistic cross-session window move
  const lastMoveToSessionRef = useRef<{ srcSession: string; windowId: string; optimisticId: string } | null>(null);
  const { execute: executeMoveToSession, isPending: isCrossMovePending } = useOptimisticAction<[string, string, number, string, string, string]>({
    action: (srv, srcSession, srcIndex, _windowId, _windowName, dstSession) =>
      moveWindowToSession(srv, srcSession, srcIndex, dstSession),
    onOptimistic: (srv, srcSession, _srcIndex, windowId, windowName, dstSession) => {
      killWindowStore(srcSession, windowId);
      const optimisticId = addGhostWindow(dstSession, windowName);
      lastMoveToSessionRef.current = { srcSession, windowId, optimisticId };
      navigate({ to: "/$server", params: { server: srv } });
    },
    onAlwaysRollback: () => {
      if (lastMoveToSessionRef.current) {
        restoreWindow(lastMoveToSessionRef.current.srcSession, lastMoveToSessionRef.current.windowId);
        removeGhost(lastMoveToSessionRef.current.optimisticId);
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

  function handleStartSessionEditing(server: string, sessionName: string) {
    cancelledRef.current = true;
    setEditingWindow(null);
    sessionCancelledRef.current = true;
    setEditingSession({ server, name: sessionName });
    setEditingSessionName(sessionName);
    sessionOriginalNameRef.current = sessionName;
    sessionCancelledRef.current = false;
  }

  function handleSessionRenameCommit() {
    if (!editingSession) return;
    const trimmed = editingSessionName.trim();
    const originalName = sessionOriginalNameRef.current;
    const { server: srv, name: sessionName } = editingSession;
    setEditingSession(null);
    if (trimmed && trimmed !== originalName) {
      executeRenameSession(srv, sessionName, trimmed);
    }
  }

  function handleSessionRenameCancel() {
    sessionCancelledRef.current = true;
    setEditingSession(null);
  }

  function handleSessionRenameKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSessionRenameCommit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleSessionRenameCancel();
    }
  }

  function handleSessionRenameBlur() {
    if (sessionCancelledRef.current) return;
    handleSessionRenameCommit();
  }

  function handleStartEditing(server: string, session: string, windowId: string, currentName: string) {
    sessionCancelledRef.current = true;
    setEditingSession(null);
    cancelledRef.current = true;
    setEditingWindow({ server, session, windowId });
    setEditingName(currentName);
    originalNameRef.current = currentName;
    cancelledRef.current = false;
  }

  function handleRenameCommit(serverSessionsMap: Map<string, ProjectSession[]>) {
    if (!editingWindow) return;
    const trimmed = editingName.trim();
    const originalName = originalNameRef.current;
    const { server: srv, session, windowId } = editingWindow;
    setEditingWindow(null);
    if (trimmed && trimmed !== originalName) {
      const winIndex = (serverSessionsMap.get(srv) ?? [])
        .find((s) => s.name === session)
        ?.windows.find((w) => w.windowId === windowId)?.index;
      if (winIndex != null) {
        executeRenameWindow(srv, session, winIndex, trimmed, windowId);
      }
    }
  }

  function handleRenameCancel() {
    cancelledRef.current = true;
    setEditingWindow(null);
  }

  function handleDragStart(e: React.DragEvent, server: string, sessionName: string, windowIndex: number, windowId: string, windowName: string) {
    setDragSource({ server, session: sessionName, index: windowIndex });
    e.dataTransfer.setData(
      "application/json",
      JSON.stringify({ server, session: sessionName, index: windowIndex, windowId, name: windowName }),
    );
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDragOver(e: React.DragEvent, server: string, sessionName: string, windowIndex: number) {
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
  }

  function handleDrop(e: React.DragEvent, server: string, sessionName: string, windowIndex: number) {
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

    executeMoveWindow(server, data.session, data.index, windowIndex);
  }

  function handleDragEnd() {
    setDragSource(null);
    setDropTarget(null);
    setSessionDropTarget(null);
  }

  function handleSessionDragOver(e: React.DragEvent, server: string, sessionName: string) {
    if (!dragSource) return;
    // Allow within-server cross-session drag-over preview.
    if (dragSource.server !== server) return;
    if (dragSource.session === sessionName) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setSessionDropTarget({ server, session: sessionName });
  }

  function handleSessionDragLeave(_e: React.DragEvent, server: string, sessionName: string) {
    if (sessionDropTarget?.server === server && sessionDropTarget?.session === sessionName) {
      setSessionDropTarget(null);
    }
  }

  function handleSessionDrop(e: React.DragEvent, server: string, sessionName: string) {
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
  }

  // Per-server session drag-reorder. Source carries server so the drag is
  // confined to one server's group.
  function handleSessionReorderStart(e: React.DragEvent, server: string, name: string, orderedNames: string[]) {
    setSessionDragSource({ server, name });
    e.dataTransfer.setData("application/x-session-reorder", `${server}:${name}`);
    e.dataTransfer.effectAllowed = "move";
    setLocalOrderByServer((prev) => ({ ...prev, [server]: orderedNames }));
  }

  function handleSessionReorderOver(e: React.DragEvent, server: string, targetName: string, naturalNames: string[]) {
    if (!sessionDragSource || sessionDragSource.server !== server || sessionDragSource.name === targetName) return;
    if (!e.dataTransfer.types.includes("application/x-session-reorder")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";

    setLocalOrderByServer((prev) => {
      const base = prev[server] ?? naturalNames;
      const dragName = sessionDragSource.name;
      const fromIdx = base.indexOf(dragName);
      const toIdx = base.indexOf(targetName);
      if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return prev;
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

      return { ...prev, [server]: next };
    });
  }

  function handleSessionReorderEnd() {
    setSessionDragSource(null);
  }

  const toggleSession = useCallback((server: string, name: string) => {
    setCollapsed((prev) => ({ ...prev, [`${server}:${name}`]: !prev[`${server}:${name}`] }));
  }, []);

  function handleKill() {
    if (!killTarget) return;
    executeKillFromDialog(killTarget.server, killTarget);
    setKillTarget(null);
  }

  const nowSeconds = Math.floor(Date.now() / 1000);

  return (
    <nav aria-label="Sessions" className="flex flex-col h-full">
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
        rowTints={rowTints}
        ansiPalette={ansiPalette}
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
        <div className="flex items-center gap-1.5 w-full pl-1.5 pr-1.5 sm:pr-2 py-1 text-xs text-text-secondary shrink-0">
          <span className="font-bold uppercase tracking-wide">Sessions</span>
          {currentServer && currentSession && (
            <span className="ml-auto flex items-center gap-1 min-w-0 truncate">
              <span className="truncate text-text-primary font-mono">{currentSession}</span>
            </span>
          )}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          {servers.length === 0 ? (
            <div className="text-text-secondary text-xs py-4 text-center">No servers</div>
          ) : (
            servers.map((srvInfo) => (
              <ServerGroup
                key={srvInfo.name}
                server={srvInfo.name}
                isCurrent={srvInfo.name === currentServer}
                serverColor={serverColors[srvInfo.name]}
                rowTints={rowTints}
                ansiPalette={ansiPalette}
                isOpen={readServerOpen(srvInfo.name)}
                onToggleOpen={() => toggleServerSection(srvInfo.name)}
                rawSessions={sessionsByServer.get(srvInfo.name) ?? []}
                sessionOrder={ctx.sessionOrderByServer.get(srvInfo.name) ?? []}
                localOrder={localOrderByServer[srvInfo.name] ?? null}
                isConnected={isConnectedByServer.get(srvInfo.name) ?? false}
                currentSessionName={srvInfo.name === currentServer ? currentSession : null}
                currentWindowIndex={srvInfo.name === currentServer ? currentWindowIndex : null}
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
                pinnedSet={pinnedSet}
                pinnedToBoard={pinnedToBoard}
                isPinnedToActiveBoardFor={isPinnedToActiveBoardFor}
                collapsed={collapsed}
                nowSeconds={nowSeconds}
                onToggleSession={(name) => toggleSession(srvInfo.name, name)}
                onSelectWindow={onSelectWindow}
                onCreateWindow={onCreateWindow}
                onCreateSession={onCreateSession}
                onSessionRowKill={(name, count, ctrl) => {
                  if (ctrl) {
                    executeKillSession(srvInfo.name, name);
                    return;
                  }
                  setKillTarget({
                    type: "session",
                    server: srvInfo.name,
                    session: name,
                    windowCount: count,
                  });
                }}
                onWindowRowKill={(session, windowId, index, ctrl) => {
                  if (ctrl) {
                    executeKillWindow(srvInfo.name, session, windowId, index);
                    return;
                  }
                  setKillTarget({
                    type: "window",
                    server: srvInfo.name,
                    session,
                    windowId,
                    windowIndex: index,
                    windowCount: 1,
                  });
                }}
                onSessionStartEditing={(name) => handleStartSessionEditing(srvInfo.name, name)}
                onSessionRenameKeyDown={handleSessionRenameKeyDown}
                onSessionRenameBlur={handleSessionRenameBlur}
                onSessionNameChange={setEditingSessionName}
                onWindowStartEditing={(session, windowId, name) => handleStartEditing(srvInfo.name, session, windowId, name)}
                onWindowNameChange={setEditingName}
                onWindowRenameKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleRenameCommit(sessionsByServer);
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    handleRenameCancel();
                  }
                }}
                onWindowRenameBlur={() => {
                  if (cancelledRef.current) return;
                  handleRenameCommit(sessionsByServer);
                }}
                onSessionColorChange={(name, c) => {
                  setSessionColorApi(srvInfo.name, name, c).catch((err) =>
                    addToast(err.message || "Failed to set session color"),
                  );
                }}
                onWindowColorChange={(session, index, c) => {
                  setWindowColorApi(srvInfo.name, session, index, c).catch((err) =>
                    addToast(err.message || "Failed to set window color"),
                  );
                }}
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
            ))
          )}
        </div>
      </div>

      {/* Status panels — pinned at bottom. Show metrics + selected window
          status only when there's a current server. */}
      <BottomPanels currentServer={currentServer} currentSessionName={currentSession} currentWindowIndex={currentWindowIndex} />

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
  currentWindowIndex,
}: {
  currentServer: string | null;
  currentSessionName: string | null;
  currentWindowIndex: string | null;
}) {
  const ctx = useSessionContext();
  const nowSeconds = Math.floor(Date.now() / 1000);
  const sessions = currentServer ? ctx.sessionsByServer.get(currentServer) ?? [] : [];
  const isConnected = currentServer ? ctx.isConnectedByServer.get(currentServer) ?? false : false;
  const selectedWindow = currentSessionName && currentWindowIndex != null
    ? sessions.find((s) => s.name === currentSessionName)
        ?.windows.find((w) => String(w.index) === currentWindowIndex) ?? null
    : null;
  return (
    <>
      <WindowPanel window={selectedWindow} nowSeconds={nowSeconds} />
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
  serverColor: number | undefined;
  rowTints: Map<number, import("@/themes").RowTint>;
  ansiPalette: readonly string[];
  isOpen: boolean;
  onToggleOpen: () => void;
  rawSessions: ProjectSession[];
  sessionOrder: string[];
  localOrder: string[] | null;
  isConnected: boolean;
  currentSessionName: string | null;
  currentWindowIndex: string | null;

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
  pinnedSet: Set<string>;
  pinnedToBoard: (board: string, server: string, windowId: string) => boolean;
  isPinnedToActiveBoardFor: (winServer: string, windowId: string) => boolean;
  collapsed: Record<string, boolean>;
  nowSeconds: number;

  onToggleSession: (name: string) => void;
  onSelectWindow: (server: string, session: string, windowIndex: number) => void;
  onCreateWindow: (server: string, session: string) => void;
  onCreateSession: (server: string) => void;
  onSessionRowKill: (name: string, windowCount: number, ctrl: boolean) => void;
  onWindowRowKill: (session: string, windowId: string, index: number, ctrl: boolean) => void;
  onSessionStartEditing: (name: string) => void;
  onSessionRenameKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onSessionRenameBlur: () => void;
  onSessionNameChange: (value: string) => void;
  onWindowStartEditing: (session: string, windowId: string, currentName: string) => void;
  onWindowNameChange: (value: string) => void;
  onWindowRenameKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onWindowRenameBlur: () => void;
  onSessionColorChange: (name: string, color: number | null) => void;
  onWindowColorChange: (session: string, index: number, color: number | null) => void;
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

function ServerGroup(props: ServerGroupProps) {
  const {
    server,
    isCurrent,
    serverColor,
    rowTints,
    ansiPalette,
    isOpen,
    onToggleOpen,
    rawSessions,
    sessionOrder,
    localOrder,
    currentSessionName,
    currentWindowIndex,
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
    pinnedSet,
    pinnedToBoard,
    isPinnedToActiveBoardFor,
    collapsed,
    nowSeconds,
    onToggleSession,
    onSelectWindow,
    onCreateWindow,
    onCreateSession,
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
  const setWindowsForSession = useWindowStore((s) => s.setWindowsForSession);
  useEffect(() => {
    for (const s of rawSessions) {
      setWindowsForSession(s.name, s.windows);
    }
  }, [rawSessions, setWindowsForSession]);

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

  const naturalNames = orderedSessions.map((s) => s.name);

  return (
    <div className="border-b border-border last:border-b-0">
      {/* Group header — server name only; active-server affordance is handled
          elsewhere (no row tint here, so the Sessions panel's top divider
          reads at a clean 3px without a bleed-through tint underneath). */}
      <div
        className={`flex items-center gap-1.5 w-full pl-1.5 pr-1.5 sm:pr-2 py-1 text-xs text-text-secondary ${
          isCurrent ? "" : "hover:bg-bg-card/30"
        }`}
        aria-current={isCurrent ? "true" : undefined}
        data-current-server={isCurrent ? "true" : undefined}
        data-server={server}
      >
        <button
          type="button"
          onClick={onToggleOpen}
          aria-expanded={isOpen}
          aria-label={isOpen ? `Collapse ${server} sessions` : `Expand ${server} sessions`}
          className="flex items-center gap-1.5 flex-1 min-w-0 hover:text-text-primary transition-colors min-h-[28px]"
        >
          <span
            className="inline-block transition-transform duration-150"
            style={{ transform: isOpen ? "rotate(0deg)" : "rotate(-90deg)" }}
            aria-hidden="true"
          >
            &#x25BC;
          </span>
          <span className={`truncate font-mono ${isCurrent ? "text-text-primary font-medium" : ""}`}>
            {server}
          </span>
        </button>
        <button
          onClick={() => onCreateSession(server)}
          aria-label={`New session on ${server}`}
          className="text-text-secondary hover:text-text-primary transition-colors text-[13px] px-1 flex items-center justify-center"
        >
          +
        </button>
      </div>

      {isOpen && (
        <div className="pt-1 pb-1">
          {sessions.length === 0 ? (
            <div className="text-text-secondary text-xs py-2 text-center flex flex-col items-center gap-2">
              <span>No sessions</span>
              <button
                onClick={() => onCreateSession(server)}
                className="text-sm px-3 py-1.5 border border-border rounded hover:border-text-secondary text-text-primary"
              >
                + New Session
              </button>
            </div>
          ) : (
            orderedSessions.map((session) => {
              const isCollapsed = collapsed[`${server}:${session.name}`] ?? false;
              const isGhostSession = "optimistic" in session && session.optimistic;
              return (
                <div key={session.name} className={`mb-2${isGhostSession ? " opacity-50 animate-pulse" : ""}`}>
                  <SessionRow
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
                    onDragStart={isGhostSession ? undefined : (e) => onSessionReorderStart(e, server, session.name, naturalNames)}
                    onDragEnd={isGhostSession ? undefined : onSessionReorderEnd}
                    onToggleCollapse={() => onToggleSession(session.name)}
                    onSelectFirstWindow={() => onSelectWindow(server, session.name, session.windows[0]?.index ?? 0)}
                    onCreateWindow={() => onCreateWindow(server, session.name)}
                    onKillClick={(e) => {
                      onSessionRowKill(session.name, session.windows.length, e.ctrlKey || e.metaKey);
                    }}
                    onDoubleClickName={() => onSessionStartEditing(session.name)}
                    onSessionNameChange={onSessionNameChange}
                    onSessionRenameKeyDown={onSessionRenameKeyDown}
                    onSessionRenameBlur={onSessionRenameBlur}
                    onDragOver={(e) => {
                      onSessionDragOver(e, server, session.name);
                      onSessionReorderOver(e, server, session.name, naturalNames);
                    }}
                    onDragLeave={(e) => onSessionDragLeave(e, server, session.name)}
                    onDrop={(e) => onSessionDrop(e, server, session.name)}
                    onColorChange={(c) => onSessionColorChange(session.name, c)}
                  />

                  {!isCollapsed && (
                    <div className="ml-3">
                      {session.windows.map((win) => {
                        const isSelected =
                          currentSessionName === session.name &&
                          currentWindowIndex === String(win.index);
                        const ghost = isGhostWindow(win);
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
                            nowSeconds={nowSeconds}
                            color={win.color}
                            rowTints={rowTints}
                            ansiPalette={ansiPalette}
                            editingWindow={editingWindow ? { session: editingWindow.session, windowId: editingWindow.windowId } : null}
                            editingName={editingName}
                            inputRef={inputRef}
                            server={server}
                            boards={allBoards}
                            isPinnedToAny={!ghost && pinnedSet.has(`${server}:${win.windowId}`)}
                            isPinnedToActiveBoard={!ghost && isPinnedToActiveBoardFor(server, win.windowId)}
                            isPinnedToBoard={(b) => pinnedToBoard(b, server, win.windowId)}
                            onSelectWindow={() => onSelectWindow(server, session.name, win.index)}
                            onDoubleClickName={() => onWindowStartEditing(session.name, win.windowId, win.name)}
                            onWindowNameChange={onWindowNameChange}
                            onRenameKeyDown={onWindowRenameKeyDown}
                            onRenameBlur={onWindowRenameBlur}
                            onKillClick={(e) => {
                              e.stopPropagation();
                              if (!ghost) onWindowRowKill(session.name, win.windowId, win.index, e.ctrlKey || e.metaKey);
                            }}
                            onDragStart={ghost ? undefined : (e) => onWindowDragStart(e, server, session.name, win.index, win.windowId, win.name)}
                            onDragOver={ghost ? undefined : (e) => onWindowDragOver(e, server, session.name, win.index)}
                            onDrop={ghost ? undefined : (e) => onWindowDrop(e, server, session.name, win.index)}
                            onDragEnd={ghost ? undefined : onWindowDragEnd}
                            onColorChange={ghost ? undefined : (c) => onWindowColorChange(session.name, win.index, c)}
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
    </div>
  );
}
