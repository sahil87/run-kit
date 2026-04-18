import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { killSession as killSessionApi, killWindow as killWindowApi, renameWindow, renameSession, moveWindow, moveWindowToSession, setSessionColor as setSessionColorApi, setWindowColor as setWindowColorApi, getAllServerColors, setServerColor as setServerColorApi, type ServerInfo } from "@/api/client";
import { useOptimisticAction } from "@/hooks/use-optimistic-action";
import { useOptimisticContext } from "@/contexts/optimistic-context";
import { useToast } from "@/components/toast";
import { useTheme } from "@/contexts/theme-context";
import { computeRowTints } from "@/themes";
import type { ProjectSession } from "@/types";
import { isGhostWindow } from "@/contexts/optimistic-context";
import type { MergedSession } from "@/contexts/optimistic-context";
import { useWindowStore } from "@/store/window-store";
import { HostPanel } from "./host-panel";
import { KillDialog } from "./kill-dialog";
import { ServerPanel } from "./server-panel";
import { SessionRow } from "./session-row";
import { WindowPanel } from "./status-panel";
import { WindowRow } from "./window-row";

export type SidebarProps = {
  sessions: (ProjectSession | MergedSession)[];
  currentSession: string | null;
  currentWindowIndex: string | null;
  onSelectWindow: (session: string, windowIndex: number) => void;
  onCreateWindow: (session: string) => void;
  onCreateSession: () => void;
  server: string;
  servers: ServerInfo[];
  onSwitchServer: (name: string) => void;
  onCreateServer: () => void;
  onKillServer: (name: string) => void;
  onRefreshServers: () => void;
  isConnected?: boolean;
};

export function Sidebar({
  sessions,
  currentSession,
  currentWindowIndex,
  onSelectWindow,
  onCreateWindow,
  onCreateSession,
  server,
  servers,
  onSwitchServer,
  onCreateServer,
  onKillServer,
  onRefreshServers,
  isConnected = false,
}: SidebarProps) {
  // Pre-compute row tints from the active theme palette.
  const { theme } = useTheme();
  const rowTints = useMemo(() => computeRowTints(theme.palette), [theme.palette]);
  const ansiPalette = theme.palette.ansi;

  // Server colors from settings.yaml (all servers)
  const [serverColors, setServerColors] = useState<Record<string, number>>({});
  useEffect(() => {
    getAllServerColors().then(setServerColors).catch(() => {});
  }, []);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [killTarget, setKillTarget] = useState<{
    type: "session" | "window";
    session: string;
    windowId?: string;
    windowIndex?: number;
    windowCount: number;
  } | null>(null);

  const [editingWindow, setEditingWindow] = useState<{ session: string; windowId: string } | null>(null);
  const [editingName, setEditingName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelledRef = useRef(false);
  const originalNameRef = useRef("");

  const [editingSession, setEditingSession] = useState<string | null>(null);
  const [editingSessionName, setEditingSessionName] = useState("");
  const sessionInputRef = useRef<HTMLInputElement>(null);
  const sessionCancelledRef = useRef(false);
  const sessionOriginalNameRef = useRef("");

  // Drag-and-drop state for window reordering
  const [dragSource, setDragSource] = useState<{ session: string; index: number } | null>(null);
  const [dropTarget, setDropTarget] = useState<{ session: string; index: number } | null>(null);
  const [sessionDropTarget, setSessionDropTarget] = useState<string | null>(null);

  const { markKilled, unmarkKilled, markRenamed, unmarkRenamed } = useOptimisticContext();
  const { addToast } = useToast();
  const navigate = useNavigate();
  const killWindowStore = useWindowStore((state) => state.killWindow);
  const restoreWindow = useWindowStore((state) => state.restoreWindow);
  const clearSession = useWindowStore((state) => state.clearSession);
  const moveWindowOrder = useWindowStore((state) => state.moveWindowOrder);
  const addGhostWindow = useWindowStore((state) => state.addGhostWindow);
  const removeGhost = useWindowStore((state) => state.removeGhost);

  // Ctrl+click kill session (optimistic)
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

  // Ctrl+click kill window (optimistic)
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
  // Snapshot the server at dialog-confirm time so rollback/settle target the right server.
  const killDialogServerRef = useRef<string>(server);

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
        // Keep the killed overlay in place on success — SSE reconciliation
        // removes the session from the underlying list. Unmarking here would
        // briefly re-show it. Rollback path (onAlwaysRollback) handles the
        // failure case by clearing the optimistic mark.
        clearSession(target.session);
      }
    },
    onError: (err) => {
      addToast(err.message || "Failed to kill");
    },
  });

  // Inline rename session (optimistic)
  const lastRenameSessionRef = useRef<{ server: string; name: string } | null>(null);
  const { execute: executeRenameSession } = useOptimisticAction<[string, string, string]>({
    action: (srv, oldName, newName) => renameSession(srv, oldName, newName),
    onOptimistic: (srv, oldName, newName) => {
      lastRenameSessionRef.current = { server: srv, name: oldName };
      markRenamed("session", srv, oldName, newName);
    },
    onRollback: () => {
      const last = lastRenameSessionRef.current;
      if (last) unmarkRenamed(last.server, last.name);
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
      // Snapshot entries for rollback (move isn't self-inverse like swap)
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
    onOptimistic: (_srv, srcSession, _srcIndex, windowId, windowName, dstSession) => {
      killWindowStore(srcSession, windowId);
      const optimisticId = addGhostWindow(dstSession, windowName);
      lastMoveToSessionRef.current = { srcSession, windowId, optimisticId };
      navigate({ to: "/$server", params: { server } });
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

  function handleStartSessionEditing(sessionName: string) {
    cancelledRef.current = true;    // cancel any in-progress window edit
    setEditingWindow(null);
    sessionCancelledRef.current = true;
    setEditingSession(sessionName);
    setEditingSessionName(sessionName);
    sessionOriginalNameRef.current = sessionName;
    sessionCancelledRef.current = false;
  }

  function handleSessionRenameCommit() {
    if (!editingSession) return;
    const trimmed = editingSessionName.trim();
    const originalName = sessionOriginalNameRef.current;
    const sessionName = editingSession;
    setEditingSession(null);
    if (trimmed && trimmed !== originalName) {
      executeRenameSession(server, sessionName, trimmed);
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

  function handleStartEditing(session: string, windowId: string, currentName: string) {
    sessionCancelledRef.current = true;  // cancel any in-progress session edit
    setEditingSession(null);
    cancelledRef.current = true;          // cancel any in-progress window edit before switching
    setEditingWindow({ session, windowId });
    setEditingName(currentName);
    originalNameRef.current = currentName;
    cancelledRef.current = false;
  }

  function handleRenameCommit() {
    if (!editingWindow) return;
    const trimmed = editingName.trim();
    const originalName = originalNameRef.current;
    const { session, windowId } = editingWindow;
    setEditingWindow(null);
    if (trimmed && trimmed !== originalName) {
      // Find the window index for the API call
      const winIndex = sessions
        .find((s) => s.name === session)
        ?.windows.find((w) => !isGhostWindow(w) && w.windowId === windowId)?.index;
      if (winIndex != null) {
        executeRenameWindow(server, session, winIndex, trimmed, windowId);
      }
    }
  }

  function handleRenameCancel() {
    cancelledRef.current = true;
    setEditingWindow(null);
  }

  function handleRenameKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleRenameCommit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleRenameCancel();
    }
  }

  function handleRenameBlur() {
    if (cancelledRef.current) return;
    handleRenameCommit();
  }

  function handleDragStart(e: React.DragEvent, sessionName: string, windowIndex: number, windowId: string, windowName: string) {
    setDragSource({ session: sessionName, index: windowIndex });
    e.dataTransfer.setData("application/json", JSON.stringify({ session: sessionName, index: windowIndex, windowId, name: windowName }));
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDragOver(e: React.DragEvent, sessionName: string, windowIndex: number) {
    if (!dragSource || dragSource.session !== sessionName) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTarget((prev) => {
      if (prev?.session === sessionName && prev?.index === windowIndex) return prev;
      return { session: sessionName, index: windowIndex };
    });
  }

  function handleDrop(e: React.DragEvent, sessionName: string, windowIndex: number) {
    e.preventDefault();
    setDropTarget(null);
    setDragSource(null);

    let data: { session: string; index: number; windowId: string; name: string };
    try {
      data = JSON.parse(e.dataTransfer.getData("application/json"));
    } catch {
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

  function handleSessionDragOver(e: React.DragEvent, sessionName: string) {
    if (!dragSource || dragSource.session === sessionName) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setSessionDropTarget(sessionName);
  }

  function handleSessionDragLeave(e: React.DragEvent, sessionName: string) {
    if (sessionDropTarget === sessionName) {
      setSessionDropTarget(null);
    }
  }

  function handleSessionDrop(e: React.DragEvent, sessionName: string) {
    e.preventDefault();
    setSessionDropTarget(null);
    setDropTarget(null);
    setDragSource(null);

    let data: { session: string; index: number; windowId: string; name: string };
    try {
      data = JSON.parse(e.dataTransfer.getData("application/json"));
    } catch {
      return;
    }

    if (data.session === sessionName) return;
    if (isCrossMovePending) return;

    executeMoveToSession(server, data.session, data.index, data.windowId, data.name, sessionName);
  }

  const toggleSession = useCallback((name: string) => {
    setCollapsed((prev) => ({ ...prev, [name]: !prev[name] }));
  }, []);

  function handleKill() {
    if (!killTarget) return;
    executeKillFromDialog(server, killTarget);
    setKillTarget(null);
  }

  const nowSeconds = Math.floor(Date.now() / 1000);

  // Resolve selected window for status panel
  const selectedWindow = currentSession && currentWindowIndex != null
    ? sessions.find((s) => s.name === currentSession)
        ?.windows.find((w) => String(w.index) === currentWindowIndex) ?? null
    : null;

  return (
    <nav aria-label="Sessions" className="flex flex-col h-full">
      {/* Server panel — collapsible */}
      <ServerPanel
        server={server}
        servers={servers}
        serverColors={serverColors}
        rowTints={rowTints}
        ansiPalette={ansiPalette}
        onSwitchServer={onSwitchServer}
        onCreateServer={onCreateServer}
        onKillServer={onKillServer}
        onRefreshServers={onRefreshServers}
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

      {/* Sessions — always open, flex-grow to fill space */}
      <div className="border-t border-border flex-1 min-h-0 flex flex-col">
        <div className="flex items-center gap-1.5 w-full pl-5 pr-1.5 sm:pr-2 py-1 text-xs text-text-secondary shrink-0 border-b border-border">
          <span className="font-medium">Sessions</span>
          {currentSession && (
            <span className="ml-auto flex items-center gap-1 min-w-0 truncate">
              <span className="truncate text-text-primary font-mono">{currentSession}</span>
            </span>
          )}
          <span className={currentSession ? "" : "ml-auto"}>
            <button
              onClick={onCreateSession}
              aria-label="New session"
              className="text-text-secondary hover:text-text-primary transition-colors text-[13px] px-1 flex items-center justify-center"
            >
              +
            </button>
          </span>
        </div>
        <div className="pt-1 flex-1 min-h-0 overflow-y-auto">
        {sessions.length === 0 ? (
          <div className="text-text-secondary text-xs py-4 text-center flex flex-col items-center gap-2">
            <span>No sessions</span>
            <button
              onClick={onCreateSession}
              className="text-sm px-3 py-1.5 border border-border rounded hover:border-text-secondary text-text-primary"
            >
              + New Session
            </button>
          </div>
        ) : (
          sessions.map((session) => {
            const isCollapsed = collapsed[session.name] ?? false;
            const isGhostSession = "optimistic" in session && session.optimistic;
            return (
              <div key={session.name} className={`mb-2${isGhostSession ? " opacity-50 animate-pulse" : ""}`}>
                {/* Session row */}
                <SessionRow
                  session={session}
                  sessionColor={session.sessionColor}
                  rowTints={rowTints}
                  isCollapsed={isCollapsed}
                  isSessionDropTarget={sessionDropTarget === session.name}
                  editingSession={editingSession}
                  editingSessionName={editingSessionName}
                  sessionInputRef={sessionInputRef}
                  onToggleCollapse={() => toggleSession(session.name)}
                  onSelectFirstWindow={() => onSelectWindow(session.name, session.windows[0]?.index ?? 0)}
                  onCreateWindow={() => onCreateWindow(session.name)}
                  onKillClick={(e) => {
                    if (e.ctrlKey || e.metaKey) {
                      executeKillSession(server, session.name);
                      return;
                    }
                    setKillTarget({
                      type: "session",
                      session: session.name,
                      windowCount: session.windows.length,
                    });
                  }}
                  onDoubleClickName={() => handleStartSessionEditing(session.name)}
                  onSessionNameChange={setEditingSessionName}
                  onSessionRenameKeyDown={handleSessionRenameKeyDown}
                  onSessionRenameBlur={handleSessionRenameBlur}
                  onDragOver={(e) => handleSessionDragOver(e, session.name)}
                  onDragLeave={(e) => handleSessionDragLeave(e, session.name)}
                  onDrop={(e) => handleSessionDrop(e, session.name)}
                  onColorChange={(c) => {
                    setSessionColorApi(server, session.name, c).catch((err) =>
                      addToast(err.message || "Failed to set session color"),
                    );
                  }}
                />

                {/* Window rows */}
                {!isCollapsed && (
                  <div className="ml-3">
                    {session.windows.map((win) => {
                      const isSelected =
                        currentSession === session.name &&
                        currentWindowIndex === String(win.index);
                      const ghost = isGhostWindow(win);
                      const isDragOver = dropTarget?.session === session.name && dropTarget?.index === win.index && dragSource?.index !== win.index;

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
                          editingWindow={editingWindow}
                          editingName={editingName}
                          inputRef={inputRef}
                          onSelectWindow={() => onSelectWindow(session.name, win.index)}
                          onDoubleClickName={() => handleStartEditing(session.name, win.windowId, win.name)}
                          onWindowNameChange={setEditingName}
                          onRenameKeyDown={handleRenameKeyDown}
                          onRenameBlur={handleRenameBlur}
                          onKillClick={(e) => {
                            e.stopPropagation();
                            if (e.ctrlKey || e.metaKey) {
                              if (!ghost) executeKillWindow(server, session.name, win.windowId, win.index);
                              return;
                            }
                            if (!ghost) {
                              setKillTarget({
                                type: "window",
                                session: session.name,
                                windowId: win.windowId,
                                windowIndex: win.index,
                                windowCount: 1,
                              });
                            }
                          }}
                          onDragStart={ghost ? undefined : (e) => handleDragStart(e, session.name, win.index, win.windowId, win.name)}
                          onDragOver={ghost ? undefined : (e) => handleDragOver(e, session.name, win.index)}
                          onDrop={ghost ? undefined : (e) => handleDrop(e, session.name, win.index)}
                          onDragEnd={ghost ? undefined : handleDragEnd}
                          onColorChange={ghost ? undefined : (c) => {
                            setWindowColorApi(server, session.name, win.index, c).catch((err) =>
                              addToast(err.message || "Failed to set window color"),
                            );
                          }}
                        />
                      );
                    })}
                    {/* Drop zone after last window — enables moving items to the end.
                        Relative wrapper keeps the absolute zone in flow position without adding height. */}
                    {dragSource?.session === session.name && (
                      <div className="relative">
                        <div
                          className="absolute inset-x-0 top-0 h-4 -mt-1"
                          style={
                            dropTarget?.session === session.name && dropTarget?.index === -1
                              ? { boxShadow: "0 -2px 0 0 var(--color-accent)" }
                              : undefined
                          }
                          onDragOver={(e) => handleDragOver(e, session.name, -1)}
                          onDrop={(e) => {
                            let lastReal: (typeof session.windows)[number] | undefined;
                            for (let i = session.windows.length - 1; i >= 0; i--) {
                              if (!isGhostWindow(session.windows[i])) { lastReal = session.windows[i]; break; }
                            }
                            if (lastReal) handleDrop(e, session.name, lastReal.index + 1);
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
      </div>

      {/* Collapsible panels — pinned at bottom */}
      <WindowPanel window={selectedWindow} nowSeconds={nowSeconds} />
      <HostPanel isConnected={isConnected} />

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
