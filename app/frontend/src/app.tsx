import { useEffect, useRef, useMemo, useState, useCallback } from "react";
import { useNavigate, useMatches } from "@tanstack/react-router";
import { ChromeProvider, useChrome, useChromeDispatch } from "@/contexts/chrome-context";
import { ThemeProvider, useTheme, useThemeActions } from "@/contexts/theme-context";
import type { ThemePreference } from "@/contexts/theme-context";
import { SessionProvider } from "@/contexts/session-context";
import { useSessions } from "@/hooks/use-sessions";
import { useVisualViewport } from "@/hooks/use-visual-viewport";
import { useDialogState } from "@/hooks/use-dialog-state";
import { TopBar } from "@/components/top-bar";
import { Sidebar } from "@/components/sidebar";
import { TerminalClient } from "@/components/terminal-client";
import { BottomBar } from "@/components/bottom-bar";
import { CommandPalette, type PaletteAction } from "@/components/command-palette";
import { Dialog } from "@/components/dialog";
import { CreateSessionDialog } from "@/components/create-session-dialog";
import { Dashboard } from "@/components/dashboard";
import { selectWindow, createWindow, reloadTmuxConfig, getHealth, createServer, killServer as killServerApi } from "@/api/client";
import { useSessionContext } from "@/contexts/session-context";
import { useBrowserTitle } from "@/hooks/use-browser-title";

const SIDEBAR_STORAGE_KEY = "runkit-sidebar-width";
const SIDEBAR_DEFAULT_WIDTH = 220;
const SIDEBAR_MIN_WIDTH = 160;
const SIDEBAR_MAX_WIDTH = 400;

function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
}

function readSidebarWidth(): number {
  try {
    const stored = localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (stored) {
      const parsed = Number(stored);
      if (!isNaN(parsed)) return clampSidebarWidth(parsed);
    }
  } catch {
    // localStorage unavailable
  }
  return SIDEBAR_DEFAULT_WIDTH;
}

export function App() {
  return (
    <ThemeProvider>
      <ChromeProvider>
        <SessionProvider>
          <AppShell />
        </SessionProvider>
      </ChromeProvider>
    </ThemeProvider>
  );
}

function AppShell() {
  useVisualViewport();

  const { sessions, isConnected } = useSessions();
  const { server, setServer, servers, refreshServers } = useSessionContext();
  const { sidebarOpen, drawerOpen, fixedWidth } = useChrome();
  const { setCurrentSession, setCurrentWindow, setDrawerOpen, setSidebarOpen } = useChromeDispatch();
  const navigate = useNavigate();
  const matches = useMatches();
  const wsRef = useRef<WebSocket | null>(null);

  // Extract params -- the route may be / (no params) or /:session/:window
  const lastMatch = matches[matches.length - 1];
  const params = (lastMatch?.params ?? {}) as { session?: string; window?: string };
  const sessionName = params.session;
  const windowIndex = params.window;

  const [composeOpen, setComposeOpen] = useState(false);
  const [hostname, setHostname] = useState("");
  const [showCreateServerDialog, setShowCreateServerDialog] = useState(false);
  const [createServerName, setCreateServerName] = useState("");
  const [showKillServerConfirm, setShowKillServerConfirm] = useState(false);

  // Fetch hostname once on mount (guarded for StrictMode double-invoke)
  const didFetchHostnameRef = useRef(false);
  useEffect(() => {
    if (didFetchHostnameRef.current) return;
    didFetchHostnameRef.current = true;
    getHealth()
      .then((data) => setHostname(data.hostname ?? ""))
      .catch(() => {});
  }, []);

  useBrowserTitle(sessionName, windowIndex, hostname);

  // Sidebar drag-resize state (desktop only)
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth);
  const isDraggingRef = useRef(false);

  const handleDragStart = useCallback((startX: number) => {
    isDraggingRef.current = true;
    const startWidth = sidebarWidth;

    const handleMove = (clientX: number) => {
      const newWidth = clampSidebarWidth(startWidth + (clientX - startX));
      setSidebarWidth(newWidth);
    };

    const handleMouseMove = (e: MouseEvent) => handleMove(e.clientX);
    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches[0]) handleMove(e.touches[0].clientX);
    };

    const handleEnd = () => {
      isDraggingRef.current = false;
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleEnd);
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("touchend", handleEnd);
      // Persist final width
      setSidebarWidth((w) => {
        try { localStorage.setItem(SIDEBAR_STORAGE_KEY, String(w)); } catch { /* noop */ }
        return w;
      });
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleEnd);
    document.addEventListener("touchmove", handleTouchMove);
    document.addEventListener("touchend", handleEnd);
  }, [sidebarWidth]);

  const handleDragHandleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      handleDragStart(e.clientX);
    },
    [handleDragStart],
  );

  const handleDragHandleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches[0]) handleDragStart(e.touches[0].clientX);
    },
    [handleDragStart],
  );

  // Track user-initiated navigation to suppress activeWindow sync temporarily.
  // Also suppress while any dialog is open to prevent focus-stealing re-renders.
  const userNavTimestampRef = useRef(0);
  const dialogOpenRef = useRef(false);

  // Sync currentSession/currentWindow from route params + SSE data
  const currentSession = useMemo(
    () => sessions.find((s) => s.name === sessionName) ?? null,
    [sessions, sessionName],
  );
  const currentWindow = useMemo(() => {
    if (!currentSession || !windowIndex) return null;
    return currentSession.windows.find((w) => String(w.index) === windowIndex) ?? null;
  }, [currentSession, windowIndex]);

  useEffect(() => {
    setCurrentSession(currentSession);
    setCurrentWindow(currentWindow);
  }, [currentSession, currentWindow, setCurrentSession, setCurrentWindow]);

  // Redirect when the current session/window no longer exists (e.g. window/session killed)
  useEffect(() => {
    if (!sessionName || !isConnected) return;
    if (!currentSession || (currentSession && windowIndex && !currentWindow)) {
      navigate({ to: "/", replace: true });
    }
  }, [sessionName, windowIndex, sessions, currentSession, currentWindow, isConnected, navigate]);

  // Active window sync: when SSE says isActiveWindow changed, update URL
  const activeWindow = useMemo(() => {
    if (!currentSession) return null;
    return currentSession.windows.find((w) => w.isActiveWindow) ?? null;
  }, [currentSession]);

  useEffect(() => {
    if (!activeWindow || !sessionName) return;
    if (String(activeWindow.index) !== windowIndex) {
      // Skip if user recently navigated (e.g. clicked sidebar) or a dialog is open
      if (dialogOpenRef.current) return;
      const elapsed = Date.now() - userNavTimestampRef.current;
      if (elapsed < 3000) return;
      navigate({
        to: "/$session/$window",
        params: { session: sessionName, window: String(activeWindow.index) },
        replace: true,
      });
    }
  }, [activeWindow, sessionName, windowIndex, navigate]);

  // Navigation callback for sidebar/breadcrumbs — syncs both UI route and tmux active window
  const navigateToWindow = useCallback(
    (session: string, windowIdx: number) => {
      userNavTimestampRef.current = Date.now();
      navigate({
        to: "/$session/$window",
        params: { session, window: String(windowIdx) },
      });
      setDrawerOpen(false);
      // Fire-and-forget: tell tmux to select this window too
      selectWindow(session, windowIdx).catch(() => {});
    },
    [navigate, setDrawerOpen],
  );

  // Dialog state management
  const dialogs = useDialogState({
    sessionName,
    windowIndex: currentWindow?.index,
    onKillComplete: () => navigate({ to: "/", replace: true }),
    onSessionRenamed: (newName) => {
      if (windowIndex) {
        navigate({
          to: "/$session/$window",
          params: { session: newName, window: windowIndex },
          replace: true,
        });
      } else {
        navigate({ to: "/", replace: true });
      }
    },
  });

  // Keep dialogOpenRef in sync so the activeWindow effect can check it without deps
  dialogOpenRef.current =
    dialogs.showCreateDialog || dialogs.showRenameDialog || dialogs.showRenameSessionDialog || dialogs.showKillConfirm || dialogs.showKillSessionConfirm || showCreateServerDialog || showKillServerConfirm;

  // Flat window list for palette actions
  const flatWindows = useMemo(() => {
    return sessions.flatMap((s) =>
      s.windows.map((w) => ({ session: s.name, window: w })),
    );
  }, [sessions]);

  // Create a new window in a session (from sidebar "+" button)
  const handleCreateWindow = useCallback(
    async (session: string) => {
      try {
        await createWindow(session, "zsh");
      } catch {
        // SSE will reflect
      }
    },
    [],
  );

  // Theme
  const { preference: themePreference } = useTheme();
  const { setTheme } = useThemeActions();

  const themeActions: PaletteAction[] = useMemo(() => {
    const options: ThemePreference[] = ["system", "light", "dark"];
    return options.map((opt) => ({
      id: `theme-${opt}`,
      label: `Theme: ${opt.charAt(0).toUpperCase() + opt.slice(1)}${themePreference === opt ? " (current)" : ""}`,
      onSelect: () => setTheme(opt),
    }));
  }, [themePreference, setTheme]);

  // Server management
  const handleSwitchServer = useCallback(
    (name: string) => {
      if (name !== server) {
        setServer(name);
        navigate({ to: "/", replace: true });
      }
    },
    [server, setServer, navigate],
  );

  const handleCreateServer = useCallback(async () => {
    const trimmed = createServerName.trim();
    if (!trimmed || !/^[a-zA-Z0-9_-]+$/.test(trimmed)) return;
    try {
      await createServer(trimmed);
      await refreshServers();
      handleSwitchServer(trimmed);
    } catch {
      // error
    }
    setShowCreateServerDialog(false);
    setCreateServerName("");
  }, [createServerName, refreshServers, handleSwitchServer]);

  const handleKillServer = useCallback(async () => {
    try {
      await killServerApi(server);
      const res = await fetch("/api/servers");
      if (res.ok) {
        const remaining: string[] = await res.json();
        refreshServers();
        if (remaining.length > 0) {
          handleSwitchServer(remaining[0]);
        } else {
          setServer("");
        }
      }
    } catch {
      // error
    }
    setShowKillServerConfirm(false);
  }, [server, refreshServers, handleSwitchServer, setServer]);

  // File upload ref for palette
  const fileInputRef = useRef<HTMLInputElement>(null);

  const paletteActions: PaletteAction[] = useMemo(
    () => [
      {
        id: "create-session",
        label: "Create new session",
        onSelect: dialogs.openCreateDialog,
      },
      ...(sessionName
        ? [
            {
              id: "rename-session",
              label: "Rename current session",
              onSelect: () => {
                if (sessionName) {
                  dialogs.openRenameSessionDialog(sessionName);
                }
              },
            },
            {
              id: "kill-session",
              label: "Kill current session",
              onSelect: dialogs.openKillSessionConfirm,
            },
          ]
        : []),
      ...(sessionName
        ? [
            {
              id: "create-window",
              label: "Create new window",
              onSelect: () => {
                if (sessionName) handleCreateWindow(sessionName);
              },
            },
          ]
        : []),
      ...(currentWindow
        ? [
            {
              id: "rename-window",
              label: "Rename current window",
              onSelect: () => {
                if (currentWindow) {
                  dialogs.openRenameDialog(currentWindow.name);
                }
              },
            },
            {
              id: "kill-window",
              label: "Kill current window",
              onSelect: dialogs.openKillConfirm,
            },
          ]
        : []),
      ...themeActions,
      {
        id: "reload-tmux-config",
        label: "Reload tmux config",
        onSelect: () => { reloadTmuxConfig().catch(() => {}); },
      },
      {
        id: "create-server",
        label: "Create tmux server",
        onSelect: () => setShowCreateServerDialog(true),
      },
      {
        id: "kill-server",
        label: "Kill tmux server",
        onSelect: () => setShowKillServerConfirm(true),
      },
      ...servers.map((s) => ({
        id: `switch-server-${s}`,
        label: `Switch tmux server: ${s}${s === server ? " (current)" : ""}`,
        onSelect: () => handleSwitchServer(s),
      })),
      ...flatWindows.map((fw) => ({
        id: `terminal-${fw.session}-${fw.window.index}`,
        label: `Terminal: ${fw.session}/${fw.window.name}`,
        onSelect: () => navigateToWindow(fw.session, fw.window.index),
      })),
    ],
    [sessionName, currentWindow, flatWindows, navigateToWindow, handleCreateWindow, dialogs, themeActions, servers, server, handleSwitchServer],
  );

  const displayName = currentWindow?.name ?? windowIndex ?? "";
  const displaySession = sessionName ?? "";

  return (
    <div className="app-shell flex flex-col" style={{ height: "var(--app-height, 100vh)" }}>
      {/* Top Chrome */}
      <div className="shrink-0">
        <TopBar
          sessions={sessions}
          currentSession={currentSession}
          currentWindow={currentWindow}
          sessionName={displaySession}
          windowName={displayName}
          isConnected={isConnected}
          sidebarOpen={sidebarOpen}
          drawerOpen={drawerOpen}
          onNavigate={navigateToWindow}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          onToggleDrawer={() => setDrawerOpen(!drawerOpen)}
          onCreateSession={dialogs.openCreateDialog}
          onCreateWindow={handleCreateWindow}
          onOpenCompose={() => setComposeOpen((v) => !v)}
        />
      </div>

      {/* Main Area */}
      <div className="flex-1 flex flex-row min-h-0 relative">
        {/* Desktop sidebar */}
        {sidebarOpen && (
          <div
            className="shrink-0 hidden md:flex flex-row"
            style={{ width: sidebarWidth }}
          >
            <div className="flex-1 min-w-0 overflow-hidden">
              <Sidebar
                sessions={sessions}
                currentSession={sessionName ?? null}
                currentWindowIndex={windowIndex ?? null}
                onSelectWindow={navigateToWindow}
                onCreateWindow={handleCreateWindow}
                onCreateSession={dialogs.openCreateDialog}
                server={server}
                servers={servers}
                onSwitchServer={handleSwitchServer}
                onCreateServer={() => setShowCreateServerDialog(true)}
                onRefreshServers={refreshServers}
              />
            </div>
            {/* Drag handle */}
            <div
              className="w-[5px] shrink-0 cursor-col-resize bg-border hover:bg-text-secondary/40 transition-colors"
              onMouseDown={handleDragHandleMouseDown}
              onTouchStart={handleDragHandleTouchStart}
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize sidebar"
              aria-valuenow={sidebarWidth}
              aria-valuemin={SIDEBAR_MIN_WIDTH}
              aria-valuemax={SIDEBAR_MAX_WIDTH}
            />
          </div>
        )}

        {/* Terminal Column */}
        <div className={`flex-1 min-w-0 flex flex-col overflow-hidden ${fixedWidth ? "bg-bg-inset" : ""}`}>
          <div
            className={`flex-1 min-h-0 flex flex-col ${fixedWidth ? "bg-bg-primary" : ""}`}
            style={fixedWidth ? { maxWidth: 900, width: "100%", marginInline: "auto" } : undefined}
          >
            {sessionName && windowIndex ? (
              <>
                <div className="flex-1 min-h-0 py-0.5 px-1 flex flex-col">
                  <TerminalClient
                    sessionName={sessionName}
                    windowIndex={windowIndex}
                    server={server}
                    wsRef={wsRef}
                    composeOpen={composeOpen}
                    setComposeOpen={setComposeOpen}
                    onSessionNotFound={() => navigate({ to: "/", replace: true })}
                  />
                </div>
                {/* Bottom Bar — only on terminal pages */}
                <div className="shrink-0 border-t border-border px-1.5 h-[48px]">
                  <BottomBar wsRef={wsRef} hostname={hostname} />
                </div>
              </>
            ) : (
              <Dashboard
                sessions={sessions}
                onNavigate={navigateToWindow}
                onCreateSession={dialogs.openCreateDialog}
                onCreateWindow={handleCreateWindow}
              />
            )}
          </div>
        </div>

        {/* Mobile Drawer Overlay — inside main area so it sits below the top bar */}
        {drawerOpen && (
          <div className="absolute inset-0 z-40 md:hidden" onClick={() => setDrawerOpen(false)}>
            <div className="absolute inset-0 bg-black/50" aria-hidden="true" />
            <div
              className="absolute inset-y-0 left-0 w-[75vw] max-w-[300px] bg-bg-primary border-r border-border overflow-y-auto z-50"
              onClick={(e) => e.stopPropagation()}
            >
              <Sidebar
                sessions={sessions}
                currentSession={sessionName ?? null}
                currentWindowIndex={windowIndex ?? null}
                onSelectWindow={(s, w) => {
                  navigateToWindow(s, w);
                }}
                onCreateWindow={handleCreateWindow}
                onCreateSession={dialogs.openCreateDialog}
                server={server}
                servers={servers}
                onSwitchServer={handleSwitchServer}
                onCreateServer={() => setShowCreateServerDialog(true)}
                onRefreshServers={refreshServers}
              />
            </div>
          </div>
        )}
      </div>

      {/* Dialogs */}
      {dialogs.showCreateDialog && (
        <CreateSessionDialog
          sessions={sessions}
          onClose={dialogs.closeCreateDialog}
        />
      )}

      {dialogs.showRenameDialog && (
        <Dialog title="Rename window" onClose={dialogs.closeRenameDialog}>
          <input
            autoFocus
            type="text"
            value={dialogs.renameName}
            onChange={(e) => dialogs.setRenameName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && dialogs.handleRename()}
            onFocus={(e) => e.target.select()}
            aria-label="Window name"
            placeholder="Window name..."
            className="w-full bg-transparent text-text-primary text-sm p-2 border border-border rounded outline-none placeholder:text-text-secondary"
          />
          <button
            onClick={dialogs.handleRename}
            className="mt-3 w-full text-sm py-1.5 bg-bg-card border border-border rounded hover:border-text-secondary"
          >
            Rename
          </button>
        </Dialog>
      )}

      {dialogs.showRenameSessionDialog && (
        <Dialog title="Rename session" onClose={dialogs.closeRenameSessionDialog}>
          <input
            autoFocus
            type="text"
            value={dialogs.renameSessionName}
            onChange={(e) => dialogs.setRenameSessionName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && dialogs.handleRenameSession()}
            onFocus={(e) => e.target.select()}
            aria-label="Session name"
            placeholder="Session name..."
            className="w-full bg-transparent text-text-primary text-sm p-2 border border-border rounded outline-none placeholder:text-text-secondary"
          />
          <button
            onClick={dialogs.handleRenameSession}
            className="mt-3 w-full text-sm py-1.5 bg-bg-card border border-border rounded hover:border-text-secondary"
          >
            Rename
          </button>
        </Dialog>
      )}

      {dialogs.showKillConfirm && (
        <Dialog title="Kill window?" onClose={dialogs.closeKillConfirm}>
          <p className="text-sm text-text-secondary mb-3">
            Kill window <strong>{displayName}</strong>? This cannot be undone.
          </p>
          <div className="flex gap-2">
            <button
              onClick={dialogs.closeKillConfirm}
              className="flex-1 text-sm py-1.5 border border-border rounded hover:border-text-secondary"
            >
              Cancel
            </button>
            <button
              onClick={dialogs.handleKillWindow}
              className="flex-1 text-sm py-1.5 bg-red-900/30 border border-red-900 rounded hover:bg-red-900/50"
            >
              Kill
            </button>
          </div>
        </Dialog>
      )}

      {dialogs.showKillSessionConfirm && (
        <Dialog title="Kill session?" onClose={dialogs.closeKillSessionConfirm}>
          <p className="text-sm text-text-secondary mb-3">
            Kill session <strong>{displaySession}</strong> and all its windows? This cannot be undone.
          </p>
          <div className="flex gap-2">
            <button
              onClick={dialogs.closeKillSessionConfirm}
              className="flex-1 text-sm py-1.5 border border-border rounded hover:border-text-secondary"
            >
              Cancel
            </button>
            <button
              onClick={dialogs.handleKillSession}
              className="flex-1 text-sm py-1.5 bg-red-900/30 border border-red-900 rounded hover:bg-red-900/50"
            >
              Kill
            </button>
          </div>
        </Dialog>
      )}

      {showCreateServerDialog && (
        <Dialog title="Create tmux server" onClose={() => { setShowCreateServerDialog(false); setCreateServerName(""); }}>
          <input
            autoFocus
            type="text"
            value={createServerName}
            onChange={(e) => setCreateServerName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreateServer()}
            onFocus={(e) => e.target.select()}
            aria-label="Server name"
            placeholder="Server name..."
            className="w-full bg-transparent text-text-primary text-sm p-2 border border-border rounded outline-none placeholder:text-text-secondary"
          />
          <p className="text-xs text-text-secondary mt-1.5">
            Alphanumeric, hyphens, and underscores only.
          </p>
          <button
            onClick={handleCreateServer}
            disabled={!createServerName.trim() || !/^[a-zA-Z0-9_-]+$/.test(createServerName.trim())}
            className="mt-3 w-full text-sm py-1.5 bg-bg-card border border-border rounded hover:border-text-secondary disabled:opacity-50"
          >
            Create
          </button>
        </Dialog>
      )}

      {showKillServerConfirm && (
        <Dialog title="Kill tmux server?" onClose={() => setShowKillServerConfirm(false)}>
          <p className="text-sm text-text-secondary mb-3">
            Kill server <strong>{server}</strong> and all its sessions? This cannot be undone.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setShowKillServerConfirm(false)}
              className="flex-1 text-sm py-1.5 border border-border rounded hover:border-text-secondary"
            >
              Cancel
            </button>
            <button
              onClick={handleKillServer}
              className="flex-1 text-sm py-1.5 bg-red-900/30 border border-red-900 rounded hover:bg-red-900/50"
            >
              Kill
            </button>
          </div>
        </Dialog>
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={async (e) => {
          const { files } = e.target;
          if (!files || files.length === 0) {
            return;
          }

          const formData = new FormData();
          Array.from(files).forEach((file) => {
            formData.append("files", file);
          });

          try {
            await fetch("/api/upload", {
              method: "POST",
              body: formData,
            });
          } finally {
            // Reset the input so the same file can be selected again later.
            e.target.value = "";
          }
        }}
      />

      <CommandPalette actions={paletteActions} />
    </div>
  );
}
