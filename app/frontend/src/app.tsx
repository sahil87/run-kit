import { lazy, Suspense, useEffect, useRef, useMemo, useState, useCallback } from "react";
import { useNavigate, useMatches, Outlet } from "@tanstack/react-router";
import { ChromeProvider, useChromeState, useChromeDispatch, SIDEBAR_WIDTH_BOUNDS } from "@/contexts/chrome-context";
import { FocusedTerminalProvider, useFocusedTerminal } from "@/contexts/focused-terminal-context";
import { computeKillRedirect } from "@/lib/navigation";
import { ThemeProvider, useTheme, useThemeActions } from "@/contexts/theme-context";
import { SessionProvider } from "@/contexts/session-context";
import { ToastProvider } from "@/components/toast";
import { OptimisticProvider } from "@/contexts/optimistic-context";
import { useDialogState } from "@/hooks/use-dialog-state";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { TopBar } from "@/components/top-bar";
import { Shell } from "@/components/shell/shell";
import { Sidebar } from "@/components/sidebar";
import { TerminalClient } from "@/components/terminal-client";
import { IframeWindow } from "@/components/iframe-window";
import { BottomBar } from "@/components/bottom-bar";
import type { PaletteAction } from "@/components/command-palette";
import { Dialog } from "@/components/dialog";
import { Dashboard } from "@/components/dashboard";
import { KeyboardShortcuts } from "@/components/keyboard-shortcuts";
import { TmuxCommandsDialog } from "@/components/tmux-commands-dialog";
import { LogoSpinner } from "@/components/logo-spinner";

import { selectWindow, createSession, createWindow, splitWindow, closePane, moveWindow, moveWindowToSession, reloadTmuxConfig, initTmuxConf, getHealth, createServer, killServer as killServerApi, setWindowColor as setWindowColorApi, setSessionColor as setSessionColorApi, updateWindowType, type ServerInfo } from "@/api/client";
import { useBoards } from "@/hooks/use-boards";
import { useWindowPins } from "@/hooks/use-window-pins";
import { usePinActions } from "@/hooks/use-pin-actions";
import { deriveNameFromPath } from "@/components/create-session-dialog";
import { useSessionContext } from "@/contexts/session-context";
import { useOptimisticContext, useMergedSessions } from "@/contexts/optimistic-context";
import { useOptimisticAction } from "@/hooks/use-optimistic-action";
import { useToast } from "@/components/toast";
import { useBrowserTitle } from "@/hooks/use-browser-title";
import { useWindowStore } from "@/store/window-store";

const CommandPalette = lazy(() => import("@/components/command-palette").then(m => ({ default: m.CommandPalette })));
const ThemeSelector = lazy(() => import("@/components/theme-selector").then(m => ({ default: m.ThemeSelector })));
const CreateSessionDialog = lazy(() => import("@/components/create-session-dialog").then(m => ({ default: m.CreateSessionDialog })));
const SwatchPopover = lazy(() => import("@/components/swatch-popover").then(m => ({ default: m.SwatchPopover })));

const { min: SIDEBAR_MIN_WIDTH, max: SIDEBAR_MAX_WIDTH } = SIDEBAR_WIDTH_BOUNDS;

/**
 * Derive a session name from an optional working directory path, falling back
 * to "session", and deduplicate against existing session names by appending
 * -2 through -10; beyond that appends -11 (best-effort).
 */
function deriveInstantSessionName(cwd: string | undefined, existingNames: string[]): string {
  const base = (cwd ? deriveNameFromPath(cwd) : "") || "session";
  const nameSet = new Set(existingNames);
  if (!nameSet.has(base)) return base;
  for (let i = 2; i <= 10; i++) {
    const candidate = `${base}-${i}`;
    if (!nameSet.has(candidate)) return candidate;
  }
  return `${base}-11`;
}

/** Root wrapper — provides theme, chrome, session, focused-terminal, and
 *  optimistic contexts above ALL routes. Mounting `SessionProvider` here
 *  means the multi-server EventSource pool is shared across `/$server/...`,
 *  `/board/$name`, and `/`; navigating between routes only flips
 *  `currentServer`, never tearing down the provider.
 *
 *  `FocusedTerminalProvider` lives at the same level so the BottomBar
 *  (rendered once per shell) can read the focused terminal regardless of
 *  which route is active. AppShell's TerminalClient and BoardPage's
 *  BoardPanes both register into this single provider instance. */
export function RootWrapper() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <ChromeProvider>
          <SessionProvider>
            <FocusedTerminalProvider>
              <OptimisticProvider>
                <Suspense fallback={null}>
                  <Outlet />
                </Suspense>
              </OptimisticProvider>
            </FocusedTerminalProvider>
          </SessionProvider>
        </ChromeProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}

/** Server layout — renders `<AppShell>` for `/$server/...`. The provider stack
 *  lives in `RootWrapper` (above ALL routes); `ServerShell` is now a thin
 *  pass-through that exists for tanstack-router's component slot. */
export function ServerShell() {
  return <AppShell />;
}

/** Outcome of the three-way server route guard.
 *  - `"render"`   → server is present (or list not yet settled): fall through
 *                   to the normal render path; do NOT short-circuit.
 *  - `"waiting"`  → the server the user just created is still provisioning.
 *  - `"notfound"` → the server is genuinely absent (typo'd or deleted URL). */
export type ServerGuardOutcome = "render" | "waiting" | "notfound";

/** Pure three-way route-guard decision, extracted so it can be unit-tested as
 *  the single source of truth. Gated on `serversLoaded` (NOT `servers.length > 0`,
 *  which conflated "loaded" with "non-empty" and misfired for a just-created
 *  server when others already existed). */
export function resolveServerGuard(args: {
  server: string;
  servers: ServerInfo[];
  serversLoaded: boolean;
  pendingServer: string | null;
}): ServerGuardOutcome {
  const { server, servers, serversLoaded, pendingServer } = args;
  if (servers.some((s) => s.name === server)) return "render";
  // Server not in the list:
  if (!serversLoaded) return "render"; // list not settled — never condemn yet
  if (server === pendingServer) return "waiting"; // the one we just created
  return "notfound"; // genuinely absent
}

/** Server provisioning UI — shown briefly after the user creates a server and
 *  navigates to it, while it has not yet appeared in the refreshed server list.
 *  Swaps to the normal server view automatically once the list includes it
 *  (the pending marker is cleared on appearance — see the clear-on-appearance
 *  effect). No timer/polling: the waiting state persists until the refresh lands. */
export function ServerWaiting({ serverName }: { serverName: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-screen gap-4 bg-bg-primary">
      <LogoSpinner size={32} />
      <h1 className="text-xl text-text-primary">Creating…</h1>
      <p className="text-text-secondary">
        waiting for <strong>{serverName}</strong>
      </p>
    </div>
  );
}

/** Server not found UI — shown when server param doesn't match any known server. */
export function ServerNotFound({ serverName }: { serverName: string }) {
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
  const ctx = useSessionContext();
  const matches = useMatches();
  const lastMatch = matches[matches.length - 1];
  const params = (lastMatch?.params ?? {}) as { server?: string; window?: string };
  // AppShell only mounts under `/$server/...`, so `currentServer` is non-null
  // here in practice. Fall back to URL params during the brief window between
  // navigation and the provider's next render with `currentServer` set.
  const server = ctx.currentServer ?? params.server ?? "";
  const rawSessions = ctx.sessionsByServer.get(server) ?? [];
  const isConnected = ctx.isConnectedByServer.get(server) ?? false;
  const servers = ctx.servers;
  const refreshServers = ctx.refreshServers;
  const serversLoaded = ctx.serversLoaded;
  const pendingServer = ctx.pendingServer;
  const markServerPending = ctx.markServerPending;
  const sessions = useMergedSessions(rawSessions, server);
  const { sidebarOpen, sidebarWidth, fixedWidth } = useChromeState();
  const { setCurrentSession, setCurrentWindow, setSidebarOpen, setSidebarWidth, persistSidebarWidth, toggleFixedWidth } = useChromeDispatch();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const wsRef = useRef<WebSocket | null>(null);
  const focusTerminalRef = useRef<(() => void) | null>(null);

  // The URL's second segment is the tmux window ID (@N), a stable identifier.
  // The route no longer carries a session segment — the owning session is
  // derived from the SSE snapshot below (see `currentSession`).
  const windowParam = params.window;

  // Derive the owning session + window from the SSE snapshot by locating the
  // URL's window id (@N) within `sessions[].windows[]`. The snapshot carries
  // session names per window, so we no longer need a `$session` URL segment.
  // `@N` is globally unique on a server, so the first match is authoritative.
  const currentSession = useMemo(() => {
    if (!windowParam) return null;
    return sessions.find((s) => s.windows.some((w) => w.windowId === windowParam)) ?? null;
  }, [sessions, windowParam]);
  const currentWindow = useMemo(() => {
    if (!currentSession || !windowParam) return null;
    return currentSession.windows.find((w) => w.windowId === windowParam) ?? null;
  }, [currentSession, windowParam]);
  // The session name shown in breadcrumbs/title/dropdowns, derived from the
  // snapshot (not the URL). Undefined until the snapshot resolves the window.
  const sessionName = currentSession?.name;

  // Compose buffer open state lives in `FocusedTerminalContext` so the
  // shell-level `<BottomBar>` can open compose for the focused terminal
  // without owning the state. The focused `TerminalClient` (or focused
  // `BoardPane` on the board route) reads `composeOpen` and renders the
  // `ComposeBuffer` itself — anchoring compose to a specific
  // `TerminalClient` instance satisfies the spec's "compose target frozen
  // at open time" scenario.
  const { composeOpen, setComposeOpen } = useFocusedTerminal();
  const [scrollLocked, setScrollLocked] = useState(false);
  const [hostname, setHostname] = useState("");
  const [showCreateServerDialog, setShowCreateServerDialog] = useState(false);
  const [createServerName, setCreateServerName] = useState("");
  const [killServerTarget, setKillServerTarget] = useState<string | null>(null);
  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false);
  const [showTmuxCommands, setShowTmuxCommands] = useState(false);
  const [showCreateSessionAtFolderDialog, setShowCreateSessionAtFolderDialog] = useState(false);
  const [showCreateWindowAtFolderDialog, setShowCreateWindowAtFolderDialog] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState<"session" | "window" | null>(null);
  const [showCreateIframeDialog, setShowCreateIframeDialog] = useState(false);
  const [iframeWindowName, setIframeWindowName] = useState("");
  const [iframeWindowUrl, setIframeWindowUrl] = useState("");

  const { removeGhost, addGhostSession, addGhostServer, markKilled, unmarkKilled } = useOptimisticContext();
  const { addToast } = useToast();
  const addGhostWindowStore = useWindowStore((s) => s.addGhostWindow);
  const removeWindowGhost = useWindowStore((s) => s.removeGhost);
  const setWindowsForSession = useWindowStore((s) => s.setWindowsForSession);
  const clearSession = useWindowStore((s) => s.clearSession);
  const ghostWindowIdRef = useRef<string | null>(null);
  const ghostSessionIdRef = useRef<string | null>(null);
  const ghostServerIdRef = useRef<string | null>(null);
  const killedServerNameRef = useRef<string | null>(null);

  // SSE sync: keep window store in sync with real session data for the
  // current server. windowIds are unique per server only — pass `server`
  // through so cross-server entries don't clobber each other.
  useEffect(() => {
    for (const s of rawSessions) {
      setWindowsForSession(server, s.name, s.windows);
    }
  }, [server, rawSessions, setWindowsForSession]);

  // Clear the pending marker once the just-created server appears in the
  // refreshed list — this swaps ServerWaiting → the live view automatically.
  // Idempotent and timer-free; clearing on appearance (not a timeout) also
  // ensures a *later* deletion of that same server correctly shows
  // ServerNotFound rather than spinning on a stale pending marker.
  useEffect(() => {
    if (pendingServer && servers.some((s) => s.name === pendingServer)) {
      markServerPending(null);
    }
  }, [servers, pendingServer, markServerPending]);

  // Palette split/close actions (button loading not visible since palette closes, but we need error toasts)
  const { execute: executeSplit } = useOptimisticAction<[string, string, boolean, string | undefined]>({
    action: (srv, windowId, horizontal, cwd) => splitWindow(srv, windowId, horizontal, cwd),
    onError: (err) => addToast(err.message || "Failed to split pane"),
  });
  const { execute: executeClosePane } = useOptimisticAction<[string, string]>({
    action: (srv, windowId) => closePane(srv, windowId),
    onError: (err) => addToast(err.message || "Failed to close pane"),
  });

  // Fetch hostname once on mount (guarded for StrictMode double-invoke)
  const didFetchHostnameRef = useRef(false);
  useEffect(() => {
    if (didFetchHostnameRef.current) return;
    didFetchHostnameRef.current = true;
    getHealth()
      .then((data) => setHostname(data.hostname ?? ""))
      .catch(() => {});
  }, []);

  useBrowserTitle(sessionName, windowParam, hostname);

  // Sidebar drag-resize handler (desktop only). Width state lives in
  // `ChromeContext` (lifted from per-route local state) so AppShell and
  // BoardPage observe the same width. During drag we call `setSidebarWidth`
  // (in-memory only, ~60-100x/s on pointermove) and commit the final value
  // to localStorage exactly once via `persistSidebarWidth` in the drag-end
  // handler — preserving the pre-change behavior of one write per gesture.
  const isDraggingRef = useRef(false);
  const dragLastWidthRef = useRef<number>(sidebarWidth);

  const handleDragStart = useCallback((startX: number) => {
    isDraggingRef.current = true;
    // Force the drag cursor at the document level so it persists when the pointer
    // leaves the 5px handle mid-drag (implicit pointer-capture workaround). Cleared
    // in handleEnd below. The corner affordance in CollapsiblePanel may overwrite
    // this to `nwse-resize` after this write — that's intended (last write wins).
    document.body.style.cursor = "col-resize";
    const startWidth = sidebarWidth;
    dragLastWidthRef.current = startWidth;

    // Pointer events (not mouse/touch): when the corner affordance initiates both
    // drags, CollapsiblePanel's horizontal handler calls preventDefault() on the
    // pointerdown, which per the Pointer Events spec suppresses the follow-up mouse
    // compatibility events (mousemove/mouseup). Listening for pointermove/pointerup
    // avoids that trap and keeps the same-pointer interaction working end-to-end.
    const handlePointerMove = (e: PointerEvent) => {
      const next = startWidth + (e.clientX - startX);
      dragLastWidthRef.current = next;
      setSidebarWidth(next);
    };

    const handleEnd = () => {
      isDraggingRef.current = false;
      document.body.style.cursor = "";
      // Persist the final width once per drag gesture. The in-memory state is
      // already at this value via the last `setSidebarWidth` call, but
      // `persistSidebarWidth` writes through to localStorage (clamped).
      persistSidebarWidth(dragLastWidthRef.current);
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handleEnd);
      document.removeEventListener("pointercancel", handleEnd);
    };

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handleEnd);
    document.addEventListener("pointercancel", handleEnd);
  }, [sidebarWidth, setSidebarWidth, persistSidebarWidth]);

  const handleDragHandlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      handleDragStart(e.clientX);
    },
    [handleDragStart],
  );

  // tmux is the source of truth for "current window". The URL is a
  // resumable bookmark used only on initial mount to align tmux with a
  // deep-linked window; after that the URL is treated as derived state and
  // re-written whenever the SSE-driven `isActiveWindow` changes. The 3s
  // `userNavTimestampRef` debounce was removed in this change — there is
  // no client-side window state worth protecting from server overrides.
  //
  // We retain `dialogOpenRef` so that the URL-write effect can skip
  // navigation while a dialog is open (preventing focus-stealing re-renders
  // mid-dialog). The dialog-open suppression applies to the URL writeback
  // only, not to the underlying SSE-derived selection state.
  const dialogOpenRef = useRef(false);
  // hasAlignedToUrlRef gates mount-time alignment of tmux to the URL. On
  // the first `currentSession` value received after the route mounts, if
  // the URL's `$window` differs from tmux's current `isActiveWindow`, fire
  // exactly one `selectWindow` to align tmux to the URL. Subsequent
  // route changes within the same mount do NOT re-fire alignment — the
  // sidebar-click path (a pure mutation) is the only post-mount writer.
  const hasAlignedToUrlRef = useRef(false);
  // Reset alignment guard whenever the route's session changes (this is
  // effectively a fresh "mount" for the alignment contract).
  const lastAlignedSessionRef = useRef<string | null>(null);
  // Pending click intent. A sidebar/palette click optimistically navigates
  // the URL to the clicked window id (@N) AND fires `selectWindow`. Until
  // the SSE snapshot confirms tmux switched (the clicked window reports
  // `isActiveWindow`), the writeback below would see the still-stale
  // `activeWindow` and bounce the URL back to the previously-active window.
  // We record the intent here (keyed on the window id ALONE — never the
  // session name, so a rename/cross-session move with `@N` preserved keeps the
  // intent alive) and suppress the writeback while the URL still matches it;
  // the intent clears the instant SSE confirms it (event-driven, not a timer —
  // this is NOT the removed 3s wall-clock debounce).
  const pendingClickRef = useRef<{ windowId: string } | null>(null);

  useEffect(() => {
    setCurrentSession(currentSession);
    setCurrentWindow(currentWindow);
  }, [currentSession, currentWindow, setCurrentSession, setCurrentWindow]);

  // Track whether the URL's (session, window) pair has been observed as valid
  // in SSE data since the last server/session/window URL change. Gates the
  // "gone" redirect so a stale-cached or partially-populated first SSE payload
  // (missing the freshly-navigated session, or reporting it with an empty
  // windows list) can't bounce the user to the dashboard before the real data
  // arrives.
  const currentWindowEverSeenRef = useRef(false);
  const lastObservedUrlKeyRef = useRef<string>("");
  useEffect(() => {
    const key = `${server}|${sessionName ?? ""}|${windowParam ?? ""}`;
    if (lastObservedUrlKeyRef.current !== key) {
      lastObservedUrlKeyRef.current = key;
      currentWindowEverSeenRef.current = false;
    }
    if (currentWindow) currentWindowEverSeenRef.current = true;
  }, [server, sessionName, windowParam, currentWindow]);

  // Redirect when the current session/window no longer exists (e.g. window/session killed)
  useEffect(() => {
    const target = computeKillRedirect({
      sessionName,
      windowId: windowParam,
      currentSessionWindows: currentSession?.windows ?? null,
      currentWindowExists: !!currentWindow,
      isConnected,
      currentWindowEverSeen: currentWindowEverSeenRef.current,
    });
    if (!target) return;
    if (target.to === "window") {
      navigate({
        to: "/$server/$window",
        params: { server, window: target.windowId },
        replace: true,
      });
    } else {
      navigate({ to: "/$server", params: { server }, replace: true });
    }
  }, [sessionName, windowParam, sessions, currentSession, currentWindow, isConnected, navigate, server]);

  // Active window sync (truth = tmux). The SSE-derived `activeWindow`
  // drives the sidebar selection (see `WindowRow.isSelected`) and the URL
  // writeback below. There is no client-side window selection state.
  const activeWindow = useMemo(() => {
    if (!currentSession) return null;
    return currentSession.windows.find((w) => w.isActiveWindow) ?? null;
  }, [currentSession]);

  // Mount-time alignment: if a deep-linked URL points at a window that is
  // not the current tmux-active window for its (derived) session, fire exactly
  // one `selectWindow` to align tmux to the URL. The comparison is window-id
  // only, so a deep link to `/$server/@N` aligns to `@N` regardless of which
  // session the snapshot reports it under. Guarded by `hasAlignedToUrlRef`,
  // re-armed per window-route so subsequent navigations within the same window
  // don't replay the alignment (which would clobber user clicks).
  useEffect(() => {
    if (!windowParam || !currentSession) return;
    const windowKey = `${server}|${windowParam}`;
    if (lastAlignedSessionRef.current !== windowKey) {
      // Fresh window route — re-arm the guard.
      hasAlignedToUrlRef.current = false;
      lastAlignedSessionRef.current = windowKey;
    }
    if (hasAlignedToUrlRef.current) return;
    // Wait for the first SSE-populated session payload (with a real
    // active window) before deciding whether to align.
    const activeId = activeWindow ? activeWindow.windowId : null;
    if (activeId === null) return;
    hasAlignedToUrlRef.current = true;
    if (activeId !== windowParam) {
      // Deep-link to a window that is NOT tmux's current active window: record
      // a pending intent on `@N` (same mechanism as a sidebar click) so the URL
      // writeback below does NOT bounce us back to the currently-active window
      // before tmux confirms the alignment. Without this, a cold deep-link to
      // `/$server/@N` would flicker to the active window and unmount the
      // terminal. The intent clears the instant SSE reports `@N` active.
      pendingClickRef.current = { windowId: windowParam };
      selectWindow(server, windowParam).catch(() => {});
    }
  }, [server, windowParam, currentSession, activeWindow]);

  // URL writeback: whenever the SSE snapshot says a different window is
  // active than what the URL reflects, write the URL via `replace`. No
  // debounce — tmux truth wins always. Dialogs suppress the writeback to
  // keep focus-stealing re-renders from interrupting user input.
  useEffect(() => {
    if (!activeWindow || !sessionName) return;
    if (dialogOpenRef.current) return;
    // Honor a pending click: while the URL still points at the optimistically
    // navigated window the user just clicked, suppress the writeback so a
    // stale snapshot can't bounce us back to the previously-active window.
    // Clear the intent the moment SSE confirms it (active matches the click)
    // or the URL has moved on (a newer navigation superseded it).
    const pending = pendingClickRef.current;
    if (pending) {
      // Match on the window id ALONE. A session rename or cross-session move
      // that preserves `@N` must NOT release the suppression early (the bug
      // this change fixes) — the session name is no longer part of identity.
      const urlMatchesPending = pending.windowId === windowParam;
      const sseConfirmed = activeWindow.windowId === pending.windowId;
      if (sseConfirmed || !urlMatchesPending) {
        pendingClickRef.current = null;
      } else {
        return; // intent outstanding — let the URL stand
      }
    }
    if (activeWindow.windowId === windowParam) return;
    navigate({
      to: "/$server/$window",
      params: { server, window: activeWindow.windowId },
      replace: true,
    });
  }, [activeWindow, sessionName, windowParam, navigate, server]);

  // Navigation callback for sidebar/breadcrumbs. tmux is the source of truth,
  // but a click is explicit user intent: we navigate the URL optimistically
  // (so the terminal renders immediately, including the first click from the
  // Dashboard and cross-session clicks the SSE writeback alone can't express)
  // AND fire `selectWindow` to bring tmux into agreement. `pendingClickRef`
  // suppresses the writeback's bounce-back until SSE confirms the switch.
  //
  // On mobile, close the overlay sidebar after a destination tap.
  const navigateToWindow = useCallback(
    (windowId: string) => {
      pendingClickRef.current = { windowId };
      navigate({
        to: "/$server/$window",
        params: { server, window: windowId },
        replace: true,
      });
      selectWindow(server, windowId).catch(() => {});
      if (isMobile) setSidebarOpen(false);
    },
    [server, navigate, isMobile, setSidebarOpen],
  );

  // Dialog state management
  const dialogs = useDialogState({
    sessionName,
    windowId: currentWindow?.windowId,
    onKillComplete: () => navigate({ to: "/$server", params: { server }, replace: true }),
    onSessionRenamed: () => {
      // The route no longer carries a session segment, so a rename needs no
      // navigation when a window is in view — the breadcrumb re-derives the new
      // session name from the next SSE snapshot. Only redirect to the dashboard
      // when no window is selected (nothing to keep us anchored).
      if (!windowParam) {
        navigate({ to: "/$server", params: { server }, replace: true });
      }
    },
  });

  // Keep dialogOpenRef in sync so the activeWindow effect can check it without deps
  dialogOpenRef.current =
    dialogs.showRenameDialog || dialogs.showRenameSessionDialog || dialogs.showKillConfirm || dialogs.showKillSessionConfirm || showCreateServerDialog || killServerTarget != null || showTmuxCommands || showCreateSessionAtFolderDialog || showCreateWindowAtFolderDialog || showCreateIframeDialog;

  // Flat window list for palette actions
  const flatWindows = useMemo(() => {
    return sessions.flatMap((s) =>
      s.windows.map((w) => ({ session: s.name, window: w })),
    );
  }, [sessions]);

  // Create a new window in a session (from sidebar "+" button)
  const { execute: executeCreateWindow } = useOptimisticAction<[string, string]>({
    action: (srv, session) => {
      const targetSession = sessions.find((s) => s.name === session);
      const activeWin = targetSession?.windows.find((w) => w.isActiveWindow);
      return createWindow(srv, session, "zsh", activeWin?.worktreePath);
    },
    onOptimistic: (srv, session) => {
      ghostWindowIdRef.current = addGhostWindowStore(srv, session, "zsh");
    },
    onRollback: () => {
      if (ghostWindowIdRef.current) {
        removeWindowGhost(ghostWindowIdRef.current);
        ghostWindowIdRef.current = null;
      }
    },
    onError: (err) => {
      addToast(err.message || "Failed to create window");
    },
    onSettled: () => {
      ghostWindowIdRef.current = null;
    },
  });

  // Instant session creation — derives name from active window's CWD, deduplicates, no dialog
  const { execute: executeCreateSessionInstant, isPending: isSessionCreatePending } = useOptimisticAction<[string, string, string | undefined]>({
    action: (srv, name, cwd) => createSession(srv, name, cwd),
    onOptimistic: (srv, name) => {
      ghostSessionIdRef.current = addGhostSession(srv, name);
    },
    onRollback: () => {
      if (ghostSessionIdRef.current) {
        removeGhost(ghostSessionIdRef.current);
        ghostSessionIdRef.current = null;
      }
    },
    onError: (err) => {
      addToast(err.message || "Failed to create session");
    },
    onSettled: () => {
      ghostSessionIdRef.current = null;
    },
  });

  const handleCreateSessionInstant = useCallback(() => {
    // Guard against concurrent creates: a second click before the first request
    // settles would overwrite ghostSessionIdRef, causing ghost tracking to break.
    if (isSessionCreatePending) return;
    const cwd = currentWindow?.worktreePath;
    const existingNames = sessions.map((s) => s.name);
    const name = deriveInstantSessionName(cwd, existingNames);
    executeCreateSessionInstant(server, name, cwd || undefined);
  }, [isSessionCreatePending, currentWindow, sessions, server, executeCreateSessionInstant]);

  const handleCreateWindow = useCallback(
    (session: string) => {
      executeCreateWindow(server, session);
    },
    [server, executeCreateWindow],
  );


  const handleCreateIframeWindow = useCallback(() => {
    const name = iframeWindowName.trim();
    const url = iframeWindowUrl.trim();
    if (!name || !url || !sessionName) return;
    createWindow(server, sessionName, name, undefined, "iframe", url)
      .catch((err) => addToast(err.message || "Failed to create iframe window"))
      .finally(() => {
        setShowCreateIframeDialog(false);
        setIframeWindowName("");
        setIframeWindowUrl("");
      });
  }, [iframeWindowName, iframeWindowUrl, sessionName, server, addToast]);

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

  const { execute: executeCreateServer } = useOptimisticAction<[string]>({
    action: (name) => createServer(name),
    onOptimistic: (name) => {
      ghostServerIdRef.current = addGhostServer(name);
    },
    onRollback: () => {
      if (ghostServerIdRef.current) {
        removeGhost(ghostServerIdRef.current);
        ghostServerIdRef.current = null;
      }
    },
    onError: (err) => {
      addToast(err.message || "Failed to create server");
    },
    onSettled: () => {
      ghostServerIdRef.current = null;
    },
    // Authoritative post-success refresh. Runs even after AppShell unmounts on
    // navigate (mount-guarded onSettled would not fire), so the server list
    // reflects the just-created server once tmux finishes.
    onAlwaysSettled: () => refreshServers(),
    // Clear the dangling pending marker on failure, also unmount-safe — without
    // this a failed create would leave ServerWaiting spinning forever.
    onAlwaysRollback: () => markServerPending(null),
  });

  const handleCreateServer = useCallback(() => {
    const trimmed = createServerName.trim();
    if (!trimmed || !/^[a-zA-Z0-9_-]+$/.test(trimmed)) return;
    executeCreateServer(trimmed);
    // Mark the server provisioning and kick off an immediate refresh so the
    // three-way guard shows ServerWaiting (not ServerNotFound) the instant we
    // navigate. The authoritative refresh on create success rides on
    // onAlwaysSettled (AppShell unmounts on navigate).
    markServerPending(trimmed);
    refreshServers();
    navigate({ to: "/$server", params: { server: trimmed } });
    setShowCreateServerDialog(false);
    setCreateServerName("");
  }, [createServerName, navigate, executeCreateServer, markServerPending, refreshServers]);

  const { execute: executeKillServer } = useOptimisticAction<[string]>({
    action: (name) => killServerApi(name),
    onOptimistic: (name) => {
      killedServerNameRef.current = name;
      markKilled("server", name);
    },
    onRollback: () => {
      if (killedServerNameRef.current) {
        unmarkKilled("server", killedServerNameRef.current);
        killedServerNameRef.current = null;
      }
    },
    onError: (err) => {
      addToast(err.message || "Failed to kill server");
    },
    onSettled: () => {
      killedServerNameRef.current = null;
    },
  });

  const handleKillServer = useCallback(() => {
    if (!killServerTarget) return;
    const target = killServerTarget;
    executeKillServer(target);
    // Route away only when killing the currently-active server; killing another
    // server in the panel should leave the user where they are.
    if (target === server) navigate({ to: "/" });
    setKillServerTarget(null);
  }, [killServerTarget, server, navigate, executeKillServer]);

  // File upload ref for palette
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sessionActions: PaletteAction[] = useMemo(
    () => [
      {
        id: "create-session",
        label: "Session: Create",
        onSelect: handleCreateSessionInstant,
      },
      {
        id: "create-session-at-folder",
        label: "Session: Create at Folder",
        onSelect: () => setShowCreateSessionAtFolderDialog(true),
      },
      ...(sessionName
        ? [
            {
              id: "session-set-color",
              label: "Session: Set Color",
              onSelect: () => setShowColorPicker("session"),
            },
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
    [sessionName, dialogs, handleCreateSessionInstant, setShowCreateSessionAtFolderDialog],
  );

  // Compute min/max window indices for current session (for move boundary checks)
  const { minWindowIndex, maxWindowIndex } = useMemo(() => {
    if (!currentSession || currentSession.windows.length === 0) {
      return { minWindowIndex: 0, maxWindowIndex: 0 };
    }
    const indices = currentSession.windows.map((w) => w.index);
    return { minWindowIndex: Math.min(...indices), maxWindowIndex: Math.max(...indices) };
  }, [currentSession]);

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
            {
              id: "create-window-at-folder",
              label: "Window: Create at Folder",
              onSelect: () => setShowCreateWindowAtFolderDialog(true),
            },
            {
              id: "create-iframe-window",
              label: "Window: New Iframe Window",
              onSelect: () => {
                setIframeWindowName("");
                setIframeWindowUrl("");
                setShowCreateIframeDialog(true);
              },
            },
          ]
        : []),
      ...(currentWindow
        ? [
            {
              id: "window-set-color",
              label: "Window: Set Color",
              onSelect: () => setShowColorPicker("window"),
            },
            ...(currentWindow.rkType === "iframe" || currentWindow.rkUrl
              ? [
                  {
                    id: "toggle-iframe-terminal",
                    label: currentWindow.rkType === "iframe" ? "Window: Switch to Terminal" : "Window: Switch to Iframe",
                    onSelect: () => {
                      if (sessionName) {
                        const newType = currentWindow.rkType === "iframe" ? "" : "iframe";
                        updateWindowType(server, currentWindow.windowId, newType).catch((err) =>
                          addToast(err.message || "Failed to toggle window type"),
                        );
                      }
                    },
                  },
                ]
              : []),
            ...(currentWindow.index > minWindowIndex
              ? [
                  {
                    id: "move-window-left",
                    label: "Window: Move Left",
                    onSelect: () => {
                      if (sessionName) {
                        const targetIndex = currentWindow.index - 1;
                        // The move preserves the window's stable ID — only its
                        // index changes — so navigate to the same windowId.
                        moveWindow(server, currentWindow.windowId, targetIndex)
                          .then(() => {
                            navigate({
                              to: "/$server/$window",
                              params: { server, window: currentWindow.windowId },
                            });
                          })
                          .catch((err) => {
                            addToast(err.message || "Failed to move window");
                          });
                      }
                    },
                  },
                ]
              : []),
            ...(currentWindow.index < maxWindowIndex
              ? [
                  {
                    id: "move-window-right",
                    label: "Window: Move Right",
                    onSelect: () => {
                      if (sessionName) {
                        const targetIndex = currentWindow.index + 1;
                        // The move preserves the window's stable ID — only its
                        // index changes — so navigate to the same windowId.
                        moveWindow(server, currentWindow.windowId, targetIndex)
                          .then(() => {
                            navigate({
                              to: "/$server/$window",
                              params: { server, window: currentWindow.windowId },
                            });
                          })
                          .catch((err) => {
                            addToast(err.message || "Failed to move window");
                          });
                      }
                    },
                  },
                ]
              : []),
            ...(sessions.length >= 2
              ? sessions
                  .filter((s) => s.name !== sessionName)
                  .map((s) => ({
                    id: `move-window-to-session-${s.name}`,
                    label: `Window: Move to ${s.name}`,
                    onSelect: () => {
                      if (sessionName) {
                        moveWindowToSession(server, currentWindow.windowId, s.name)
                          .then(() => {
                            navigate({ to: "/$server", params: { server } });
                          })
                          .catch((err) => {
                            addToast(err.message || "Failed to move window to session");
                          });
                      }
                    },
                  }))
              : []),
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
                if (sessionName) executeSplit(server, currentWindow.windowId, true, currentWindow.worktreePath);
              },
            },
            {
              id: "split-horizontal",
              label: "Window: Split Horizontal",
              onSelect: () => {
                if (sessionName) executeSplit(server, currentWindow.windowId, false, currentWindow.worktreePath);
              },
            },
            {
              id: "close-pane",
              label: "Pane: Close",
              onSelect: () => {
                if (sessionName) executeClosePane(server, currentWindow.windowId);
              },
            },
            {
              id: "copy-tmux-attach",
              label: "Copy: tmux Commands",
              onSelect: () => setShowTmuxCommands(true),
            },
          ]
        : []),
    ],
    [sessionName, currentWindow, sessions, handleCreateWindow, dialogs, executeSplit, executeClosePane, minWindowIndex, maxWindowIndex, navigate, server, addToast, setShowCreateWindowAtFolderDialog],
  );

  // Boards palette block (server-route variant). AppShell only mounts under
  // `/$server/...`, so the board-route-only entries (Leave Board View, Cycle
  // Pane Focus) live in BoardPage's own palette mount. Here we provide the
  // entries that make sense from a server route: Switch to <board>, Pin Current
  // Window, and Unpin Current Window when the current window is pinned.
  const { boards: boardSummaries } = useBoards();
  const { pinnedToBoard } = useWindowPins();
  const { unpin: unpinPinAction } = usePinActions();

  // Boards the current window is currently pinned to (for Unpin Current Window
  // visibility + bulk-unpin behavior). Recomputed when the cross-board pin map
  // updates via SSE.
  const currentWindowPinnedBoards = useMemo(() => {
    if (!currentWindow || !server) return [] as string[];
    return boardSummaries
      .map((b) => b.name)
      .filter((b) => pinnedToBoard(b, server, currentWindow.windowId));
  }, [boardSummaries, pinnedToBoard, currentWindow, server]);

  const boardActions: PaletteAction[] = useMemo(() => {
    // No `currentBoardName` here — AppShell isn't on a board route, so no
    // entry is ever annotated `(current)` from this palette mount.
    const switchEntries = boardSummaries.map((b) => ({
      id: `board-switch-${b.name}`,
      label: `Board: Switch to ${b.name}`,
      onSelect: () => navigate({ to: "/board/$name", params: { name: b.name } }),
    }));

    const conditional: PaletteAction[] = [];

    if (sessionName && currentWindow && server) {
      conditional.push({
        id: "board-pin-current",
        label: "Board: Pin Current Window",
        onSelect: () => {
          // Imperatively open the existing sidebar pin popover for the current
          // window. The matching WindowRow listens for this event and only the
          // row whose (server, windowId) matches handles it.
          document.dispatchEvent(
            new CustomEvent("pin-popover:open", {
              detail: { server, windowId: currentWindow.windowId },
            }),
          );
        },
      });

      // Unpin Current Window — visible only when the current window is pinned
      // to ≥1 board. v1 semantics: unpin from ALL boards in parallel (simpler
      // than a multi-board picker; users can re-pin via the popover if needed).
      if (currentWindowPinnedBoards.length > 0) {
        conditional.push({
          id: "board-unpin-current",
          label: "Board: Unpin Current Window",
          onSelect: () => {
            const win = currentWindow;
            const srv = server;
            for (const board of currentWindowPinnedBoards) {
              unpinPinAction(srv, win.windowId, board);
            }
          },
        });
      }
    }
    return [...switchEntries, ...conditional];
  }, [boardSummaries, sessionName, currentWindow, server, navigate, currentWindowPinnedBoards, unpinPinAction]);

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

  const { execute: executeReloadConfig } = useOptimisticAction<[string]>({
    action: (srv) => reloadTmuxConfig(srv),
    onSettled: () => addToast("Tmux config reloaded", "info"),
    onError: () => addToast("Failed to reload tmux config", "error"),
  });

  const { execute: executeResetConfig } = useOptimisticAction<[string]>({
    action: (srv) => initTmuxConf().then(() => reloadTmuxConfig(srv)),
    onSettled: () => addToast("Tmux config reset to default", "info"),
    onError: () => addToast("Failed to reset tmux config", "error"),
  });

  const configActions: PaletteAction[] = useMemo(
    () => [
      {
        id: "reload-tmux-config",
        label: "Config: Reload tmux",
        onSelect: () => executeReloadConfig(server),
      },
      {
        id: "init-tmux-conf",
        label: "Config: Reset tmux to default",
        onSelect: () => executeResetConfig(server),
      },
      {
        id: "keyboard-shortcuts",
        label: "Help: Keyboard Shortcuts",
        onSelect: () => setShowKeyboardShortcuts(true),
      },
    ],
    [server, executeReloadConfig, executeResetConfig],
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
        onSelect: () => setKillServerTarget(server),
      },
      ...servers.map(({ name }) => ({
        id: `switch-server-${name}`,
        label: `Server: Switch to ${name}${name === server ? " (current)" : ""}`,
        onSelect: () => handleSwitchServer(name),
      })),
    ],
    [servers, server, handleSwitchServer],
  );

  const terminalActions: PaletteAction[] = useMemo(
    () => flatWindows.map((fw) => ({
      id: `terminal-${fw.session}-${fw.window.windowId}`,
      label: `Terminal: ${fw.session}/${fw.window.name}`,
      onSelect: () => navigateToWindow(fw.window.windowId),
    })),
    [flatWindows, navigateToWindow],
  );

  const paletteActions: PaletteAction[] = useMemo(
    () => [...sessionActions, ...windowActions, ...boardActions, ...viewActions, ...themeActions, ...configActions, ...serverActions, ...terminalActions],
    [sessionActions, windowActions, boardActions, viewActions, themeActions, configActions, serverActions, terminalActions],
  );

  const displayName = currentWindow?.name ?? windowParam ?? "";
  const displaySession = sessionName ?? "";

  // Three-way guard (see `resolveServerGuard`): "render" falls through to the
  // normal path (server present, OR list not yet settled — never condemn early);
  // "waiting" shows ServerWaiting for the server we just created; "notfound"
  // shows ServerNotFound immediately for a typo'd/deleted URL.
  const serverGuard = resolveServerGuard({ server, servers, serversLoaded, pendingServer });
  if (serverGuard === "waiting") return <ServerWaiting serverName={server} />;
  if (serverGuard === "notfound") return <ServerNotFound serverName={server} />;

  // Sidebar element — shared between the desktop grid placement and the
  // mobile overlay (the Shell component renders one or the other).
  const sidebarElement = (
    <Sidebar
      currentServer={server || null}
      currentSession={sessionName ?? null}
      currentWindowId={windowParam ?? null}
      onSelectWindow={(srv, _sess, windowId) => {
        if (srv === server) {
          navigateToWindow(windowId);
        } else {
          // Cross-server: identity is window-id only on the 2-segment route.
          navigate({
            to: "/$server/$window",
            params: { server: srv, window: windowId },
          });
          if (isMobile) setSidebarOpen(false);
        }
      }}
      onCreateWindow={(srv, sess) => {
        if (srv === server) {
          handleCreateWindow(sess);
        } else {
          executeCreateWindow(srv, sess);
        }
      }}
      onCreateSession={(srv) => {
        if (srv === server) {
          handleCreateSessionInstant();
        } else {
          // For non-current servers, create with a default name
          // (no cwd source available).
          const existingNames = (ctx.sessionsByServer.get(srv) ?? []).map((s) => s.name);
          const name = deriveInstantSessionName(undefined, existingNames);
          executeCreateSessionInstant(srv, name, undefined);
        }
      }}
      onCreateServer={() => setShowCreateServerDialog(true)}
      onKillServer={(name) => setKillServerTarget(name)}
      onSidebarResizeStart={isMobile ? undefined : (e) => handleDragStart(e.clientX)}
    />
  );

  // Mode for TopBar — `terminal` when a session is active, `root` otherwise.
  // Terminal mode whenever a window is in the URL — keyed on `windowParam` (not
  // the SSE-derived session) so the cold-deep-link top bar doesn't flash "root".
  const topBarMode = windowParam ? "terminal" : "root";

  return (
    <Shell sidebarChildren={sidebarElement}>
      {/* Sidebar grid area (desktop only — Shell removes it on mobile). The
          drag handle sits at the right edge so dragging it widens the
          sidebar column. Hidden when collapsed (sidebarOpen === false). */}
      {!isMobile && sidebarOpen && (
        <aside
          style={{ gridArea: "sidebar" }}
          className="relative flex flex-row overflow-hidden"
        >
          <div className="flex-1 min-w-0 overflow-hidden">{sidebarElement}</div>
          {/* Drag handle — hidden when collapsed (column is 0-width anyway). */}
          <div
            className="w-[5px] shrink-0 cursor-col-resize bg-border hover:bg-text-secondary transition-colors"
            onPointerDown={handleDragHandlePointerDown}
            style={{ touchAction: "none" }}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            aria-valuenow={sidebarWidth}
            aria-valuemin={SIDEBAR_MIN_WIDTH}
            aria-valuemax={SIDEBAR_MAX_WIDTH}
          />
        </aside>
      )}

      {/* Top bar grid area */}
      <header style={{ gridArea: "topbar" }}>
        <TopBar
          mode={topBarMode}
          sessions={sessions}
          currentSession={currentSession}
          currentWindow={currentWindow}
          sessionName={displaySession}
          windowName={displayName}
          isConnected={isConnected}
          sidebarOpen={sidebarOpen}
          server={server}
          onNavigate={navigateToWindow}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          onCreateSession={handleCreateSessionInstant}
          onCreateWindow={handleCreateWindow}
        />
      </header>

      {/* Content grid area */}
      <main
        style={{ gridArea: "content" }}
        className={`min-w-0 flex flex-col overflow-hidden ${fixedWidth ? "bg-bg-inset" : ""}`}
      >
        <div
          className={`flex-1 min-h-0 flex flex-col ${fixedWidth ? "bg-bg-primary" : ""}`}
          style={fixedWidth ? { maxWidth: 900, width: "100%", marginInline: "auto" } : undefined}
        >
          {/* Render gate keys on `windowParam` (the URL's @N) ALONE, not the
              SSE-derived `sessionName`. The session name is only needed for the
              breadcrumb/title and resolves a beat after the first snapshot; the
              terminal itself connects by window id, so gating on the derived
              session would needlessly delay the mount on a cold deep-link (and
              briefly flash the Dashboard). */}
          {windowParam ? (
            currentWindow?.rkType === "iframe" && currentWindow?.rkUrl ? (
              <div className="flex-1 min-h-0 flex flex-col">
                <IframeWindow
                  windowId={currentWindow.windowId}
                  rkUrl={currentWindow.rkUrl}
                />
              </div>
            ) : (
              <>
                {currentWindow?.rkUrl && (
                  <div className="shrink-0 flex items-center gap-2 px-2 py-1 border-b border-border bg-bg-primary">
                    <button
                      onClick={() => sessionName && currentWindow && updateWindowType(server, currentWindow.windowId, "iframe")}
                      className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary"
                      title="Switch to iframe view"
                    >
                      <span className="font-mono">&lt;/&gt;</span>
                      <span className="truncate max-w-[300px]">{currentWindow.rkUrl}</span>
                    </button>
                  </div>
                )}
                <div className="flex-1 min-h-0 py-0.5 px-1 flex flex-col">
                  <TerminalClient
                    sessionName={sessionName ?? ""}
                    windowId={windowParam}
                    server={server}
                    wsRef={wsRef}
                    composeOpen={composeOpen}
                    setComposeOpen={setComposeOpen}
                    onSessionNotFound={() => navigate({ to: "/$server", params: { server }, replace: true })}
                    focusRef={focusTerminalRef}
                    scrollLocked={scrollLocked}
                  />
                </div>
              </>
            )
          ) : (
            <Dashboard
              sessions={sessions}
              onNavigate={navigateToWindow}
              onCreateSession={handleCreateSessionInstant}
              onCreateWindow={handleCreateWindow}
            />
          )}
        </div>
      </main>

      {/* Bottom bar grid area — shell-level. Reads focused terminal from
          FocusedTerminalContext (TerminalClient registered itself on mount). */}
      <footer
        style={{ gridArea: "bottombar" }}
        className="border-t border-border px-1.5 h-[48px]"
      >
        <BottomBar
          onOpenCompose={() => setComposeOpen(!composeOpen)}
          onFocusTerminal={() => focusTerminalRef.current?.()}
          onScrollLockChange={setScrollLocked}
        />
      </footer>

      {/* Dialogs */}
      {showCreateSessionAtFolderDialog && (
        <Suspense fallback={null}>
          <CreateSessionDialog
            sessions={sessions}
            defaultPath={currentWindow?.worktreePath}
            onClose={() => setShowCreateSessionAtFolderDialog(false)}
          />
        </Suspense>
      )}

      {showCreateWindowAtFolderDialog && sessionName && (
        <Suspense fallback={null}>
          <CreateSessionDialog
            sessions={sessions}
            mode="window"
            session={sessionName}
            defaultPath={currentWindow?.worktreePath}
            onClose={() => setShowCreateWindowAtFolderDialog(false)}
          />
        </Suspense>
      )}

      {showCreateIframeDialog && sessionName && (
        <Dialog title="New iframe window" onClose={() => { setShowCreateIframeDialog(false); setIframeWindowName(""); setIframeWindowUrl(""); }}>
          <input
            autoFocus
            type="text"
            value={iframeWindowName}
            onChange={(e) => setIframeWindowName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                // Focus URL input on Enter from name
                const next = (e.target as HTMLElement).parentElement?.querySelector<HTMLInputElement>('input[aria-label="URL"]');
                next?.focus();
              }
            }}
            aria-label="Window name"
            placeholder="Window name..."
            className="w-full bg-transparent text-text-primary p-2 border border-border rounded outline-none placeholder:text-text-secondary"
          />
          <input
            type="text"
            value={iframeWindowUrl}
            onChange={(e) => setIframeWindowUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreateIframeWindow()}
            aria-label="URL"
            placeholder="http://localhost:8080"
            className="w-full bg-transparent text-text-primary p-2 mt-2 border border-border rounded outline-none placeholder:text-text-secondary"
          />
          <button
            onClick={handleCreateIframeWindow}
            disabled={!iframeWindowName.trim() || !iframeWindowUrl.trim()}
            className="mt-2.5 w-full py-1.5 bg-bg-card border border-border rounded hover:border-text-secondary disabled:opacity-50"
          >
            Create
          </button>
        </Dialog>
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

      {showTmuxCommands && sessionName && currentWindow && (
        <TmuxCommandsDialog
          server={server}
          session={sessionName}
          windowId={currentWindow.windowId}
          onClose={() => setShowTmuxCommands(false)}
        />
      )}

      {showColorPicker && (
        <Suspense fallback={null}>
          <div
            className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
            onClick={() => setShowColorPicker(null)}
          >
            <div className="fixed inset-0 bg-black/50" aria-hidden="true" />
            <div onClick={(e) => e.stopPropagation()}>
              <SwatchPopover
                selectedColor={
                  showColorPicker === "session"
                    ? currentSession?.sessionColor
                    : currentWindow?.color
                }
                onSelect={(c) => {
                  if (showColorPicker === "session" && sessionName) {
                    setSessionColorApi(server, sessionName, c).catch((err) =>
                      addToast(err.message || "Failed to set session color"),
                    );
                  } else if (showColorPicker === "window" && sessionName && currentWindow) {
                    setWindowColorApi(server, currentWindow.windowId, c).catch((err) =>
                      addToast(err.message || "Failed to set window color"),
                    );
                  }
                  setShowColorPicker(null);
                }}
                onClose={() => setShowColorPicker(null)}
              />
            </div>
          </div>
        </Suspense>
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
    </Shell>
  );
}
