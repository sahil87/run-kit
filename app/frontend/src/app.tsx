import { useEffect, useRef, useMemo, useState, useCallback } from "react";
import { useNavigate, useMatches } from "@tanstack/react-router";
import { ChromeProvider, useChrome, useChromeDispatch } from "@/contexts/chrome-context";
import { SessionProvider } from "@/contexts/session-context";
import { useSessions } from "@/hooks/use-sessions";
import { useVisualViewport } from "@/hooks/use-visual-viewport";
import { useDialogState } from "@/hooks/use-dialog-state";
import { TopBar } from "@/components/top-bar";
import { Sidebar } from "@/components/sidebar";
import { Dashboard } from "@/components/dashboard";
import { ProjectPage } from "@/components/project-page";
import { TerminalClient } from "@/components/terminal-client";
import { BottomBar } from "@/components/bottom-bar";
import { CommandPalette, type PaletteAction } from "@/components/command-palette";
import { Dialog } from "@/components/dialog";
import { CreateSessionDialog } from "@/components/create-session-dialog";
import { selectWindow, createWindow } from "@/api/client";

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
    <ChromeProvider>
      <SessionProvider>
        <AppShell />
      </SessionProvider>
    </ChromeProvider>
  );
}

function AppShell() {
  useVisualViewport();

  const { sessions, isConnected } = useSessions();
  const { sidebarOpen, drawerOpen, fixedWidth } = useChrome();
  const { setCurrentSession, setCurrentWindow, setDrawerOpen, setSidebarOpen } = useChromeDispatch();
  const navigate = useNavigate();
  const matches = useMatches();
  const wsRef = useRef<WebSocket | null>(null);

  // Extract params -- the route may be / (no params), /$session, or /$session/$window
  const lastMatch = matches[matches.length - 1];
  const params = (lastMatch?.params ?? {}) as { session?: string; window?: string };
  const sessionName = params.session;
  const windowIndex = params.window;

  // Derive current view from route params
  const view: "dashboard" | "project" | "terminal" =
    sessionName && windowIndex ? "terminal" : sessionName ? "project" : "dashboard";

  const [composeOpen, setComposeOpen] = useState(false);

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

  // Active window sync: when SSE says isActiveWindow changed, update URL
  const activeWindow = useMemo(() => {
    if (!currentSession) return null;
    return currentSession.windows.find((w) => w.isActiveWindow) ?? null;
  }, [currentSession]);

  useEffect(() => {
    if (!activeWindow || !sessionName || !windowIndex) return;
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

  // Navigation helpers for session/dashboard views
  const navigateToSession = useCallback(
    (session: string) => {
      userNavTimestampRef.current = Date.now();
      navigate({ to: "/$session", params: { session } });
      setDrawerOpen(false);
    },
    [navigate, setDrawerOpen],
  );

  const navigateToDashboard = useCallback(() => {
    userNavTimestampRef.current = Date.now();
    navigate({ to: "/" });
    setDrawerOpen(false);
  }, [navigate, setDrawerOpen]);

  // Kill redirect helpers — use replace to prevent back-navigation to stale URLs
  const redirectToSession = useCallback(
    (session: string) => {
      userNavTimestampRef.current = Date.now();
      navigate({ to: "/$session", params: { session }, replace: true });
      setDrawerOpen(false);
    },
    [navigate, setDrawerOpen],
  );

  const redirectToDashboard = useCallback(() => {
    userNavTimestampRef.current = Date.now();
    navigate({ to: "/", replace: true });
    setDrawerOpen(false);
  }, [navigate, setDrawerOpen]);

  // Dialog state management
  const dialogs = useDialogState({
    sessionName,
    windowIndex: currentWindow?.index,
    onKillWindow: redirectToSession,
  });

  // Keep dialogOpenRef in sync so the activeWindow effect can check it without deps
  dialogOpenRef.current =
    dialogs.showCreateDialog || dialogs.showRenameDialog || dialogs.showKillConfirm;

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

  // File upload ref for palette
  const fileInputRef = useRef<HTMLInputElement>(null);

  const paletteActions: PaletteAction[] = useMemo(
    () => [
      {
        id: "create-session",
        label: "Create new session",
        onSelect: dialogs.openCreateDialog,
      },
      ...(currentWindow
        ? [
            {
              id: "kill-window",
              label: "Kill current window",
              onSelect: dialogs.openKillConfirm,
            },
            {
              id: "rename-window",
              label: "Rename current window",
              onSelect: () => {
                if (currentWindow) {
                  dialogs.openRenameDialog(currentWindow.name);
                }
              },
            },
          ]
        : []),
      {
        id: "upload-file",
        label: "Upload file",
        onSelect: () => fileInputRef.current?.click(),
      },
      ...flatWindows.map((fw) => ({
        id: `terminal-${fw.session}-${fw.window.index}`,
        label: `Terminal: ${fw.session}/${fw.window.name}`,
        onSelect: () => navigateToWindow(fw.session, fw.window.index),
      })),
    ],
    [currentWindow, flatWindows, navigateToWindow, dialogs],
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
          view={view}
          onNavigate={navigateToWindow}
          onRename={() => {
            if (currentWindow) {
              dialogs.openRenameDialog(currentWindow.name);
            }
          }}
          onKill={dialogs.openKillConfirm}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          onToggleDrawer={() => setDrawerOpen(!drawerOpen)}
          onCreateSession={dialogs.openCreateDialog}
          onCreateWindow={() => sessionName && handleCreateWindow(sessionName)}
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
                onSelectSession={navigateToSession}
                onKillSession={redirectToDashboard}
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
        <div className={`flex-1 min-w-0 flex flex-col overflow-hidden ${fixedWidth && view === "terminal" ? "bg-[#0a0c12]" : ""}`}>
          <div
            className={`flex-1 min-h-0 flex flex-col ${fixedWidth && view === "terminal" ? "bg-bg-primary" : ""}`}
            style={fixedWidth && view === "terminal" ? { maxWidth: 965, width: "100%", marginInline: "auto" } : undefined}
          >
            {view === "terminal" && sessionName && windowIndex ? (
              <div className="flex-1 min-h-0 py-0.5 px-1 flex flex-col">
                <TerminalClient
                  sessionName={sessionName}
                  windowIndex={windowIndex}
                  wsRef={wsRef}
                  composeOpen={composeOpen}
                  setComposeOpen={setComposeOpen}
                />
              </div>
            ) : view === "project" && sessionName ? (
              <ProjectPage sessionName={sessionName} sessions={sessions} />
            ) : (
              <Dashboard sessions={sessions} onCreateSession={dialogs.openCreateDialog} />
            )}

            {/* Bottom Bar — only render on terminal view */}
            {view === "terminal" && (
              <div className="shrink-0 border-t border-border px-1.5">
                <BottomBar wsRef={wsRef} onOpenCompose={() => setComposeOpen((v) => !v)} />
              </div>
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
                onSelectSession={navigateToSession}
                onKillSession={redirectToDashboard}
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
