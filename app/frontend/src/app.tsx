import { useEffect, useRef, useMemo, useState, useCallback } from "react";
import { useNavigate, useMatches } from "@tanstack/react-router";
import { ChromeProvider, useChrome, useChromeDispatch } from "@/contexts/chrome-context";
import { SessionProvider } from "@/contexts/session-context";
import { useSessions } from "@/hooks/use-sessions";
import { useVisualViewport } from "@/hooks/use-visual-viewport";
import { useKeyboardNav } from "@/hooks/use-keyboard-nav";
import { useAppShortcuts } from "@/hooks/use-app-shortcuts";
import { useDialogState } from "@/hooks/use-dialog-state";
import { TopBar } from "@/components/top-bar";
import { Sidebar } from "@/components/sidebar";
import { TerminalClient } from "@/components/terminal-client";
import { BottomBar } from "@/components/bottom-bar";
import { CommandPalette, type PaletteAction } from "@/components/command-palette";
import { Dialog } from "@/components/dialog";
import { CreateSessionDialog } from "@/components/create-session-dialog";

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
  const { sidebarOpen, drawerOpen } = useChrome();
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

  // Redirect root to first session's first window when data arrives
  const hasRedirected = useRef(false);
  useEffect(() => {
    if (sessionName) {
      hasRedirected.current = true;
      return;
    }
    if (sessions.length > 0 && !hasRedirected.current) {
      hasRedirected.current = true;
      const first = sessions[0];
      const firstWin = first.windows[0];
      if (firstWin) {
        navigate({
          to: "/$session/$window",
          params: { session: first.name, window: String(firstWin.index) },
          replace: true,
        });
      }
    }
  }, [sessions, sessionName, navigate]);

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
    if (!activeWindow || !sessionName) return;
    if (String(activeWindow.index) !== windowIndex) {
      navigate({
        to: "/$session/$window",
        params: { session: sessionName, window: String(activeWindow.index) },
        replace: true,
      });
    }
  }, [activeWindow, sessionName, windowIndex, navigate]);

  // Navigation callback for sidebar/breadcrumbs
  const navigateToWindow = useCallback(
    (session: string, windowIdx: number) => {
      navigate({
        to: "/$session/$window",
        params: { session, window: String(windowIdx) },
      });
      setDrawerOpen(false);
    },
    [navigate, setDrawerOpen],
  );

  // Dialog state management
  const dialogs = useDialogState({
    sessionName,
    windowIndex: currentWindow?.index,
  });

  // Keyboard shortcuts (c, r, Esc)
  useAppShortcuts({
    currentWindow,
    onCreateSession: dialogs.openCreateDialog,
    onRenameWindow: dialogs.openRenameDialog,
  });

  // Flat window list for j/k navigation and palette actions
  const flatWindows = useMemo(() => {
    return sessions.flatMap((s) =>
      s.windows.map((w) => ({ session: s.name, window: w })),
    );
  }, [sessions]);

  // j/k keyboard navigation for sidebar windows
  const navigateByIndex = useCallback(
    (index: number) => {
      const item = flatWindows[index];
      if (item) {
        navigateToWindow(item.session, item.window.index);
      }
    },
    [flatWindows, navigateToWindow],
  );

  const { focusedIndex } = useKeyboardNav({
    itemCount: flatWindows.length,
    onSelect: navigateByIndex,
  });

  // File upload ref for palette
  const fileInputRef = useRef<HTMLInputElement>(null);

  const paletteActions: PaletteAction[] = useMemo(
    () => [
      {
        id: "create-session",
        label: "Create new session",
        shortcut: "c",
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
              shortcut: "r",
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
          onNavigate={navigateToWindow}
          onRename={() => {
            if (currentWindow) {
              dialogs.openRenameDialog(currentWindow.name);
            }
          }}
          onKill={dialogs.openKillConfirm}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          onToggleDrawer={() => setDrawerOpen(!drawerOpen)}
        />
      </div>

      {/* Main Area */}
      <div className="flex-1 flex flex-row min-h-0">
        {/* Desktop sidebar */}
        {sidebarOpen && (
          <div className="w-[220px] shrink-0 overflow-y-auto border-r border-border hidden md:block">
            <Sidebar
              sessions={sessions}
              currentSession={sessionName ?? null}
              currentWindowIndex={windowIndex ?? null}
              focusedIndex={focusedIndex}
              onSelectWindow={navigateToWindow}
              onCreateSession={dialogs.openCreateDialog}
            />
          </div>
        )}

        {/* Terminal */}
        <div className="flex-1 min-w-0 flex flex-col">
          {sessionName && windowIndex ? (
            <TerminalClient
              key={`${sessionName}/${windowIndex}`}
              sessionName={sessionName}
              windowIndex={windowIndex}
              wsRef={wsRef}
              composeOpen={composeOpen}
              setComposeOpen={setComposeOpen}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-text-secondary text-sm">
              {sessions.length === 0
                ? "No sessions. Press c to create one."
                : "Select a window from the sidebar."}
            </div>
          )}
        </div>
      </div>

      {/* Bottom Bar */}
      <div className="shrink-0 px-3 sm:px-6 pb-1">
        <BottomBar wsRef={wsRef} onOpenCompose={() => setComposeOpen((v) => !v)} />
      </div>

      {/* Mobile Drawer Overlay */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden" onClick={() => setDrawerOpen(false)}>
          <div className="fixed inset-0 bg-black/50" aria-hidden="true" />
          <div
            className="fixed inset-y-0 left-0 w-[75vw] max-w-[300px] bg-bg-primary border-r border-border overflow-y-auto z-50"
            onClick={(e) => e.stopPropagation()}
          >
            <Sidebar
              sessions={sessions}
              currentSession={sessionName ?? null}
              currentWindowIndex={windowIndex ?? null}
              focusedIndex={focusedIndex}
              onSelectWindow={(s, w) => {
                navigateToWindow(s, w);
              }}
              onCreateSession={() => {
                setDrawerOpen(false);
                dialogs.openCreateDialog();
              }}
            />
          </div>
        </div>
      )}

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
