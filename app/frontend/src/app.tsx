import { lazy, Suspense, useEffect, useRef, useMemo, useState, useCallback } from "react";
import { useNavigate, useMatches, Outlet } from "@tanstack/react-router";
import { ChromeProvider, useChromeState, useChromeDispatch } from "@/contexts/chrome-context";
import { ThemeProvider, useTheme, useThemeActions } from "@/contexts/theme-context";
import { SessionProvider } from "@/contexts/session-context";
import { useVisualViewport } from "@/hooks/use-visual-viewport";
import { useDialogState } from "@/hooks/use-dialog-state";
import { TopBar } from "@/components/top-bar";
import { Sidebar } from "@/components/sidebar";
import { TerminalClient } from "@/components/terminal-client";
import { BottomBar } from "@/components/bottom-bar";
import type { PaletteAction } from "@/components/command-palette";
import { Dialog } from "@/components/dialog";
import { Dashboard } from "@/components/dashboard";
import { KeyboardShortcuts } from "@/components/keyboard-shortcuts";

import { selectWindow, createWindow, splitWindow, closePane, reloadTmuxConfig, initTmuxConf, getHealth, createServer, killServer as killServerApi } from "@/api/client";
import { useSessionContext } from "@/contexts/session-context";
import { useBrowserTitle } from "@/hooks/use-browser-title";

const CommandPalette = lazy(() => import("@/components/command-palette").then(m => ({ default: m.CommandPalette })));
const ThemeSelector = lazy(() => import("@/components/theme-selector").then(m => ({ default: m.ThemeSelector })));
const CreateSessionDialog = lazy(() => import("@/components/create-session-dialog").then(m => ({ default: m.CreateSessionDialog })));

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

/** Root wrapper — provides theme and chrome contexts, renders matched route via Outlet. */
export function RootWrapper() {
  return (
    <ThemeProvider>
      <ChromeProvider>
        <Outlet />
      </ChromeProvider>
    </ThemeProvider>
  );
}

/** Server layout — wraps SessionProvider + AppShell for /$server routes. */
export function ServerShell() {
  const matches = useMatches();
  const lastMatch = matches[matches.length - 1];
  const params = (lastMatch?.params ?? {}) as { server: string };
  const server = params.server;

  return (
    <SessionProvider server={server}>
      <AppShell />
    </SessionProvider>
  );
}

/** Server not found UI — shown when server param doesn't match any known server. */
function ServerNotFound({ serverName }: { serverName: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-screen gap-4 bg-bg-primary">
      <h1 className="text-xl text-text-primary">Server not found</h1>
      <p className="text-text-secondary">
        No tmux server named <strong>{serverName}</strong> was found.
      </p>
      <a
        href="/"
        className="px-4 py-2 bg-bg-card border border-border rounded hover:border-text-secondary transition-colors text-text-primary"
      >
        Go to server list
      </a>
    </div>
  );
}

function AppShell() {
  useVisualViewport();

  const { sessions, isConnected, server, servers, refreshServers } = useSessionContext();
  const { sidebarOpen, drawerOpen, fixedWidth } = useChromeState();
  const { setCurrentSession, setCurrentWindow, setDrawerOpen, setSidebarOpen, toggleFixedWidth } = useChromeDispatch();
  const navigate = useNavigate();
  const matches = useMatches();
  const wsRef = useRef<WebSocket | null>(null);
  const focusTerminalRef = useRef<(() => void) | null>(null);

  // Extract params -- the route may be /$server (no session/window) or /$server/$session/$window
  const lastMatch = matches[matches.length - 1];
  const params = (lastMatch?.params ?? {}) as { server?: string; session?: string; window?: string };
  const sessionName = params.session;
  const windowIndex = params.window;

  const [composeOpen, setComposeOpen] = useState(false);
  const [scrollLocked, setScrollLocked] = useState(false);
  const [hostname, setHostname] = useState("");
  const [showCreateServerDialog, setShowCreateServerDialog] = useState(false);
  const [createServerName, setCreateServerName] = useState("");
  const [showKillServerConfirm, setShowKillServerConfirm] = useState(false);
  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false);

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
      navigate({ to: "/$server", params: { server }, replace: true });
    }
  }, [sessionName, windowIndex, sessions, currentSession, currentWindow, isConnected, navigate, server]);

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
        to: "/$server/$session/$window",
        params: { server, session: sessionName, window: String(activeWindow.index) },
        replace: true,
      });
    }
  }, [activeWindow, sessionName, windowIndex, navigate, server]);

  // Navigation callback for sidebar/breadcrumbs — syncs both UI route and tmux active window
  const navigateToWindow = useCallback(
    (session: string, windowIdx: number) => {
      userNavTimestampRef.current = Date.now();
      navigate({
        to: "/$server/$session/$window",
        params: { server, session, window: String(windowIdx) },
      });
      setDrawerOpen(false);
      // Fire-and-forget: tell tmux to select this window too
      selectWindow(session, windowIdx).catch(() => {});
    },
    [navigate, setDrawerOpen, server],
  );

  // Dialog state management
  const dialogs = useDialogState({
    sessionName,
    windowIndex: currentWindow?.index,
    onKillComplete: () => navigate({ to: "/$server", params: { server }, replace: true }),
    onSessionRenamed: (newName) => {
      if (windowIndex) {
        navigate({
          to: "/$server/$session/$window",
          params: { server, session: newName, window: windowIndex },
          replace: true,
        });
      } else {
        navigate({ to: "/$server", params: { server }, replace: true });
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
  const { preference: themePreference, resolved: themeResolved, themeDark, themeLight } = useTheme();
  const { setTheme } = useThemeActions();

  const themeMode = themePreference === "system" ? "system" : themeResolved;

  const themeActions: PaletteAction[] = useMemo(() => {
    const options = [
      { mode: "system", label: "System", action: "system" },
      { mode: "light", label: "Light", action: themeLight },
      { mode: "dark", label: "Dark", action: themeDark },
    ];
    return [
      {
        id: "theme-select",
        label: "Theme: Select Theme",
        onSelect: () => document.dispatchEvent(new CustomEvent("theme-selector:open")),
      },
      ...options.map((opt) => ({
        id: `theme-${opt.mode}`,
        label: `Theme: ${opt.label}${themeMode === opt.mode ? " (current)" : ""}`,
        onSelect: () => setTheme(opt.action),
      })),
    ] satisfies PaletteAction[];
  }, [themeMode, themeDark, themeLight, setTheme]);

  // Server management
  const handleSwitchServer = useCallback(
    (name: string) => {
      if (name !== server) {
        navigate({ to: "/$server", params: { server: name } });
      }
    },
    [server, navigate],
  );

  const handleCreateServer = useCallback(async () => {
    const trimmed = createServerName.trim();
    if (!trimmed || !/^[a-zA-Z0-9_-]+$/.test(trimmed)) return;
    try {
      await createServer(trimmed);
      navigate({ to: "/$server", params: { server: trimmed } });
    } catch {
      // error
    }
    setShowCreateServerDialog(false);
    setCreateServerName("");
  }, [createServerName, navigate]);

  const handleKillServer = useCallback(async () => {
    try {
      await killServerApi(server);
      navigate({ to: "/" });
    } catch {
      // error
    }
    setShowKillServerConfirm(false);
  }, [server, navigate]);

  // File upload ref for palette
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sessionActions: PaletteAction[] = useMemo(
    () => [
      {
        id: "create-session",
        label: "Session: Create",
        onSelect: dialogs.openCreateDialog,
      },
      ...(sessionName
        ? [
            {
              id: "rename-session",
              label: "Session: Rename",
              onSelect: () => {
                if (sessionName) {
                  dialogs.openRenameSessionDialog(sessionName);
                }
              },
            },
            {
              id: "kill-session",
              label: "Session: Kill",
              onSelect: dialogs.openKillSessionConfirm,
            },
          ]
        : []),
    ],
    [sessionName, dialogs],
  );

  const windowActions: PaletteAction[] = useMemo(
    () => [
      ...(sessionName
        ? [
            {
              id: "create-window",
              label: "Window: Create",
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
              label: "Window: Rename",
              onSelect: () => {
                if (currentWindow) {
                  dialogs.openRenameDialog(currentWindow.name);
                }
              },
            },
            {
              id: "kill-window",
              label: "Window: Kill",
              onSelect: dialogs.openKillConfirm,
            },
            {
              id: "split-vertical",
              label: "Window: Split Vertical",
              onSelect: () => {
                if (sessionName) splitWindow(sessionName, currentWindow.index, true).catch(() => {});
              },
            },
            {
              id: "split-horizontal",
              label: "Window: Split Horizontal",
              onSelect: () => {
                if (sessionName) splitWindow(sessionName, currentWindow.index, false).catch(() => {});
              },
            },
            {
              id: "close-pane",
              label: "Pane: Close",
              onSelect: () => {
                if (sessionName) closePane(sessionName, currentWindow.index).catch(() => {});
              },
            },
            {
              id: "copy-tmux-attach",
              label: "Copy: tmux Attach Command",
              onSelect: () => {
                if (sessionName && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
                  navigator.clipboard.writeText(`tmux attach-session -t ${sessionName}:${currentWindow.name}`).catch(() => {});
                }
              },
            },
          ]
        : []),
    ],
    [sessionName, currentWindow, handleCreateWindow, dialogs],
  );

  const viewActions: PaletteAction[] = useMemo(
    () => [
      ...(sessionName
        ? [
            {
              id: "text-input",
              label: "View: Text Input",
              onSelect: () => setComposeOpen(true),
            },
          ]
        : []),
      {
        id: "toggle-fixed-width",
        label: fixedWidth ? "View: Full Width" : "View: Fixed Width (900px)",
        onSelect: toggleFixedWidth,
      },
    ],
    [sessionName, fixedWidth, toggleFixedWidth],
  );

  const configActions: PaletteAction[] = useMemo(
    () => [
      {
        id: "reload-tmux-config",
        label: "Config: Reload tmux",
        onSelect: () => { reloadTmuxConfig().catch(() => {}); },
      },
      {
        id: "init-tmux-conf",
        label: "Config: Reset tmux to default",
        onSelect: () => { initTmuxConf().then(() => reloadTmuxConfig()).catch(() => {}); },
      },
      {
        id: "keyboard-shortcuts",
        label: "Help: Keyboard Shortcuts",
        onSelect: () => setShowKeyboardShortcuts(true),
      },
    ],
    [],
  );

  const serverActions: PaletteAction[] = useMemo(
    () => [
      {
        id: "create-server",
        label: "Server: Create",
        onSelect: () => setShowCreateServerDialog(true),
      },
      {
        id: "kill-server",
        label: "Server: Kill",
        onSelect: () => setShowKillServerConfirm(true),
      },
      ...servers.map((s) => ({
        id: `switch-server-${s}`,
        label: `Server: Switch to ${s}${s === server ? " (current)" : ""}`,
        onSelect: () => handleSwitchServer(s),
      })),
    ],
    [servers, server, handleSwitchServer],
  );

  const terminalActions: PaletteAction[] = useMemo(
    () => flatWindows.map((fw) => ({
      id: `terminal-${fw.session}-${fw.window.index}`,
      label: `Terminal: ${fw.session}/${fw.window.name}`,
      onSelect: () => navigateToWindow(fw.session, fw.window.index),
    })),
    [flatWindows, navigateToWindow],
  );

  const paletteActions: PaletteAction[] = useMemo(
    () => [...sessionActions, ...windowActions, ...viewActions, ...themeActions, ...configActions, ...serverActions, ...terminalActions],
    [sessionActions, windowActions, viewActions, themeActions, configActions, serverActions, terminalActions],
  );

  const displayName = currentWindow?.name ?? windowIndex ?? "";
  const displaySession = sessionName ?? "";

  // Server not found check — once server list loads, verify server exists
  if (servers.length > 0 && !servers.includes(server)) {
    return <ServerNotFound serverName={server} />;
  }

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
          server={server}
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
                    onSessionNotFound={() => navigate({ to: "/$server", params: { server }, replace: true })}
                    focusRef={focusTerminalRef}
                    scrollLocked={scrollLocked}
                  />
                </div>
                {/* Bottom Bar — only on terminal pages */}
                <div className="shrink-0 border-t border-border px-1.5 h-[48px]">
                  <BottomBar wsRef={wsRef} hostname={hostname} onOpenCompose={() => setComposeOpen((v) => !v)} onFocusTerminal={() => focusTerminalRef.current?.()} onScrollLockChange={setScrollLocked} />
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
        <Suspense fallback={null}>
          <CreateSessionDialog
            sessions={sessions}
            onClose={dialogs.closeCreateDialog}
          />
        </Suspense>
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
            className="w-full bg-transparent text-text-primary p-2 border border-border rounded outline-none placeholder:text-text-secondary"
          />
          <button
            onClick={dialogs.handleRename}
            className="mt-2.5 w-full py-1.5 bg-bg-card border border-border rounded hover:border-text-secondary"
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
            className="w-full bg-transparent text-text-primary p-2 border border-border rounded outline-none placeholder:text-text-secondary"
          />
          <button
            onClick={dialogs.handleRenameSession}
            className="mt-2.5 w-full py-1.5 bg-bg-card border border-border rounded hover:border-text-secondary"
          >
            Rename
          </button>
        </Dialog>
      )}

      {dialogs.showKillConfirm && (
        <Dialog title="Kill window?" onClose={dialogs.closeKillConfirm}>
          <p className="text-text-secondary mb-2.5">
            Kill window <strong>{displayName}</strong>? This cannot be undone.
          </p>
          <div className="flex gap-2">
            <button
              onClick={dialogs.closeKillConfirm}
              className="flex-1 py-1.5 border border-border rounded hover:border-text-secondary"
            >
              Cancel
            </button>
            <button
              onClick={dialogs.handleKillWindow}
              className="flex-1 py-1.5 bg-red-900/30 border border-red-900 rounded hover:bg-red-900/50"
            >
              Kill
            </button>
          </div>
        </Dialog>
      )}

      {dialogs.showKillSessionConfirm && (
        <Dialog title="Kill session?" onClose={dialogs.closeKillSessionConfirm}>
          <p className="text-text-secondary mb-2.5">
            Kill session <strong>{displaySession}</strong> and all its windows? This cannot be undone.
          </p>
          <div className="flex gap-2">
            <button
              onClick={dialogs.closeKillSessionConfirm}
              className="flex-1 py-1.5 border border-border rounded hover:border-text-secondary"
            >
              Cancel
            </button>
            <button
              onClick={dialogs.handleKillSession}
              className="flex-1 py-1.5 bg-red-900/30 border border-red-900 rounded hover:bg-red-900/50"
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
            className="w-full bg-transparent text-text-primary p-2 border border-border rounded outline-none placeholder:text-text-secondary"
          />
          <p className="text-xs text-text-secondary mt-1.5">
            Alphanumeric, hyphens, and underscores only.
          </p>
          <button
            onClick={handleCreateServer}
            disabled={!createServerName.trim() || !/^[a-zA-Z0-9_-]+$/.test(createServerName.trim())}
            className="mt-2.5 w-full py-1.5 bg-bg-card border border-border rounded hover:border-text-secondary disabled:opacity-50"
          >
            Create
          </button>
        </Dialog>
      )}

      {showKillServerConfirm && (
        <Dialog title="Kill tmux server?" onClose={() => setShowKillServerConfirm(false)}>
          <p className="text-text-secondary mb-2.5">
            Kill server <strong>{server}</strong> and all its sessions? This cannot be undone.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setShowKillServerConfirm(false)}
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

      <Suspense fallback={null}>
        <CommandPalette actions={paletteActions} />
      </Suspense>
      <Suspense fallback={null}>
        <ThemeSelector />
      </Suspense>

      {showKeyboardShortcuts && (
        <KeyboardShortcuts onClose={() => setShowKeyboardShortcuts(false)} />
      )}
    </div>
  );
}
