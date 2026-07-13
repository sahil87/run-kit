import { lazy, Suspense, useEffect, useRef, useMemo, useState, useCallback } from "react";
import { useNavigate, useMatches, Outlet } from "@tanstack/react-router";
import { ChromeProvider, useChromeState, useChromeDispatch, SIDEBAR_WIDTH_BOUNDS } from "@/contexts/chrome-context";
import { FocusedTerminalProvider, useFocusedTerminal } from "@/contexts/focused-terminal-context";
import { TopBarSlotProvider, useTopBarSlot, useTopBarNotFound, useRegisterTopBarSlot } from "@/contexts/top-bar-slot-context";
import { computeKillRedirect } from "@/lib/navigation";
import { deriveEffectiveSessionOrder, computeMoveOrder, computeWindowMoveTarget } from "@/lib/palette-move";
import { buildUpdateActions } from "@/lib/palette-update";
import { nextWaitingTarget, type WaitingTarget } from "@/lib/palette-agent-nav";
import { isWaiting } from "@/lib/waiting";
import {
  windowSwitchDirection,
  viewTransitionSupported,
  shouldAnimateWindowSwitch,
  beginWindowSwitchGate,
  nextDirectionToken,
  isLatestDirectionToken,
} from "@/lib/window-transition";
import { ThemeProvider, useTheme, useThemeActions } from "@/contexts/theme-context";
import { SessionProvider } from "@/contexts/session-context";
import { ToastProvider } from "@/components/toast";
import { OptimisticProvider } from "@/contexts/optimistic-context";
import { useDialogState } from "@/hooks/use-dialog-state";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { TopBar, HELP_URL, type TopBarMode } from "@/components/top-bar";
import { useVisualViewport } from "@/hooks/use-visual-viewport";
import { Shell } from "@/components/shell/shell";
import { Sidebar } from "@/components/sidebar";
import { TerminalClient } from "@/components/terminal-client";
import { IframeWindow } from "@/components/iframe-window";
import { BottomBar } from "@/components/bottom-bar";
import type { PaletteAction } from "@/components/command-palette";
import { Dialog } from "@/components/dialog";
import { SessionTiles } from "@/components/session-tiles/session-tiles";
import { KeyboardShortcuts } from "@/components/keyboard-shortcuts";
import { TmuxCommandsDialog } from "@/components/tmux-commands-dialog";
import { LogoSpinner } from "@/components/logo-spinner";
import type { ServerInfo } from "@/api/client";

import { selectWindow, createSession, createWindow, splitWindow, closePane, moveWindow, moveWindowToSession, reloadTmuxConfig, initTmuxConf, getHealth, createServer, killServer as killServerApi, setWindowColor as setWindowColorApi, setSessionColor as setSessionColorApi, setSessionOrder, setServerOrder, updateWindowType, isInfraServer, DAEMON_SERVER } from "@/api/client";
import { useBoards } from "@/hooks/use-boards";
import { useWindowPins } from "@/hooks/use-window-pins";
import { usePinActions } from "@/hooks/use-pin-actions";
import { deriveNameFromPath } from "@/components/create-session-dialog";
import { useSessionContext, useUpdateNotification } from "@/contexts/session-context";
import { useOptimisticContext, useMergedSessions } from "@/contexts/optimistic-context";
import { useOptimisticAction } from "@/hooks/use-optimistic-action";
import { useToast } from "@/components/toast";
import { useBrowserTitle } from "@/hooks/use-browser-title";
import { usePushSubscription } from "@/hooks/use-push-subscription";
import { useWindowStore } from "@/store/window-store";

const CommandPalette = lazy(() => import("@/components/command-palette").then(m => ({ default: m.CommandPalette })));
const ThemeSelector = lazy(() => import("@/components/theme-selector").then(m => ({ default: m.ThemeSelector })));
const CreateSessionDialog = lazy(() => import("@/components/create-session-dialog").then(m => ({ default: m.CreateSessionDialog })));
const SpawnAgentDialog = lazy(() => import("@/components/spawn-agent-dialog").then(m => ({ default: m.SpawnAgentDialog })));
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

/**
 * Raw (unsanitized) basename of a filesystem path — the last non-empty path
 * segment. Used as the optimistic ghost-window label so it matches what tmux
 * will name an unnamed window (tmux's `#{b:pane_current_path}` uses the raw
 * basename, NOT the tmux-safe sanitization `deriveNameFromPath` applies).
 * Falls back to "window" when no basename is derivable.
 */
function rawBasename(cwd: string | undefined): string {
  if (!cwd) return "window";
  const trimmed = cwd.replace(/\/+$/, "");
  if (trimmed === "") return "window";
  const segment = trimmed.split("/").pop() ?? "";
  return segment || "window";
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
  // `useVisualViewport` maintains the `--app-height` / `--app-offset-top` CSS
  // vars (iOS keyboard handling) on `document.documentElement`. It moved here
  // from `Shell` (260707-4vq2): the persistent root layout div (in `AppLayout`)
  // is now the `--app-height` consumer, and the var must exist on EVERY route —
  // including the cockpit and edge pages that mount no `Shell`. The hook is a
  // single idempotent effect; owning it once at the root avoids the double-mount
  // cleanup race a second call in `Shell` would create (Shell now sizes to
  // `height: 100%` and no longer consumes the var directly).
  useVisualViewport();
  return (
    <ThemeProvider>
      <ToastProvider>
        <ChromeProvider>
          <SessionProvider>
            <FocusedTerminalProvider>
              <OptimisticProvider>
                <TopBarSlotProvider>
                  <Outlet />
                </TopBarSlotProvider>
              </OptimisticProvider>
            </FocusedTerminalProvider>
          </SessionProvider>
        </ChromeProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}

/**
 * `AppLayout` — the persistent-chrome layout (260707-4vq2). It is the component
 * of a **pathless layout route** that uniformly parents EVERY page route
 * (index, server, terminal, board). Because every navigation keeps the match
 * chain `[root, app-layout, <leaf>]`, this layout match sits at a stable depth
 * with a stable route id and is NEVER remounted across navigation — so the
 * `TopBar` mounted here (once, above the `<Outlet>`) keeps a stable React/DOM
 * identity and re-renders in place instead of unmounting/remounting a per-page
 * copy (the flicker fix).
 *
 * (Hosting the bar directly in `RootWrapper` — the root route's component — did
 * NOT work: the index route `/` is a direct child of the root at the same
 * pathname, so the root→index match chain is structurally shorter than
 * root→serverLayout→…, and React remounted the root subtree when navigating to
 * `/`. A pathless layout route normalizes the tree depth and removes that
 * asymmetry.)
 *
 * The `<Suspense fallback={null}>` boundary wraps only the content region, so a
 * lazy-chunk load (e.g. the board) blanks the body while the bar stays painted.
 */
export function AppLayout() {
  return (
    <div
      className="app-root flex flex-col"
      style={{ height: "var(--app-height, 100vh)" }}
    >
      {/* Plain `div`, not `header`: `TopBar` already renders its own `<header>`
          (the banner landmark), so wrapping it in a second `<header>` would
          nest two `role="banner"` landmarks. This wrapper only owns the
          `shrink-0` sizing that keeps the bar at its natural height above the
          `flex-1` content region. */}
      <div className="shrink-0">
        <RootTopBar />
      </div>
      <div className="flex-1 min-h-0">
        <Suspense fallback={null}>
          <Outlet />
        </Suspense>
      </div>
    </div>
  );
}

/**
 * `RootTopBar` — the single persistent `TopBar` mount (260707-4vq2). Delivers
 * the bar's inputs through two channels (see `top-bar-slot-context.tsx`):
 *   - Route-derived (here, synchronously from `useMatches()`): `mode` +
 *     `boardName`. This flips the instant the URL changes, so the heading
 *     never waits on the incoming page's mount — critical for the lazily
 *     loaded board (`Board: <name>` renders from the URL param while the
 *     chunk is still loading).
 *   - Page-registered (`useTopBarSlot()`): the data/handler props a page owns.
 *     When no page has registered yet (first frame after navigation, or a lazy
 *     chunk still loading), we render the tolerant-empty prop shape every mode
 *     already supports.
 */
function RootTopBar() {
  const matches = useMatches();
  // The not-found page signals its render via context (`useSignalTopBarNotFound`
  // in `NotFoundPage`). This MUST win over the route-param walk below: TanStack
  // Router's fuzzy not-found handling RETAINS the partially-matched params in
  // `useMatches()` — e.g. `/board/x/y` keeps `name=x`, so the param walk alone
  // would derive `board` mode ("Board: x") over the not-found body. When the
  // not-found page is what actually renders, force the minimal `cockpit`
  // fallback (R3/R10). (The `/$server/$window`+extra shape — `/a/b/c` — is a
  // different arm: it renders AppShell's `ServerNotFound`, not `NotFoundPage`,
  // so `notFound` is false there and the `root`/`terminal` mode below is kept.)
  const notFound = useTopBarNotFound();

  // Walk matches deepest-first for route params. Param NAMES are unique across
  // the route tree (`window` only on the terminal route, `server` on the server
  // layout, `name` on the board route), so their presence fully determines the
  // mode — the same deepest-first param walk `SessionContext` uses for
  // `currentServer`. The cockpit (`/`) carries no params and resolves to the
  // minimal `cockpit` mode.
  let serverParam: string | undefined;
  let windowParam: string | undefined;
  let boardParam: string | undefined;
  for (let i = matches.length - 1; i >= 0; i--) {
    const p = (matches[i]?.params ?? {}) as {
      server?: string;
      window?: string;
      name?: string;
    };
    if (serverParam === undefined && typeof p.server === "string") serverParam = p.server;
    if (windowParam === undefined && typeof p.window === "string") windowParam = p.window;
    if (boardParam === undefined && typeof p.name === "string") boardParam = p.name;
  }

  let mode: TopBarMode;
  if (notFound) mode = "cockpit";
  else if (boardParam !== undefined) mode = "board";
  else if (windowParam !== undefined) mode = "terminal";
  else if (serverParam !== undefined) mode = "root";
  else mode = "cockpit";

  const slot = useTopBarSlot();

  return (
    <TopBar
      mode={mode}
      boardName={notFound ? undefined : boardParam}
      sessions={slot?.sessions ?? []}
      currentSession={slot?.currentSession ?? null}
      currentWindow={slot?.currentWindow ?? null}
      sessionName={slot?.sessionName ?? ""}
      windowName={slot?.windowName ?? ""}
      isConnected={slot?.isConnected ?? false}
      sidebarOpen={slot?.sidebarOpen ?? false}
      // Prefer the page-registered server (the confirmed value), but fall back
      // to the route-derived `serverParam` so the `Server Cabin: <server>`
      // heading (root mode) and the terminal-mode server crumb render
      // synchronously from the URL — before AppShell's registering effect runs
      // on a cold deep link / first frame after navigation, `slot` is null and
      // `slot?.server` would be `""`, which those truthy-gated renders omit.
      // Mirrors how `boardName` already renders from `boardParam` above.
      server={slot?.server ?? serverParam ?? ""}
      onNavigate={slot?.onNavigate ?? (() => {})}
      onToggleSidebar={slot?.onToggleSidebar ?? (() => {})}
      onCreateSession={slot?.onCreateSession ?? (() => {})}
      onCreateWindow={slot?.onCreateWindow ?? (() => {})}
      onSpawnAgent={slot?.onSpawnAgent}
      paneCount={slot?.paneCount}
      serverCount={slot?.serverCount}
      waitingPaneCount={slot?.waitingPaneCount}
      boards={slot?.boards}
      onCloseFocused={slot?.onCloseFocused}
      closeDisabled={slot?.closeDisabled}
      autofit={slot?.autofit}
      onToggleAutofit={slot?.onToggleAutofit}
    />
  );
}

/** Server layout — renders `<AppShell>` for `/$server/...`. The provider stack
 *  lives in `RootWrapper` (above ALL routes); `ServerShell` is now a thin
 *  pass-through that exists for tanstack-router's component slot. */
export function ServerShell() {
  return <AppShell />;
}

/** Server not found UI — shown when server param doesn't match any known server. */
function ServerNotFound({ serverName }: { serverName: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 bg-bg-primary">
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

/** Brief waiting state shown right after creating a server, while the refreshed
 *  server list is in flight. Reuses ServerNotFound's centered full-screen
 *  layout idiom and the shared LogoSpinner. Swaps to the server view
 *  automatically once the server appears in the refreshed list (see the
 *  three-way guard and the pending-clear effect in SessionContext). */
function ServerWaiting({ serverName }: { serverName: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 bg-bg-primary">
      <LogoSpinner size={48} />
      <h1 className="text-xl text-text-primary">Creating server…</h1>
      <p className="text-text-secondary">
        Waiting for <strong>{serverName}</strong>.
      </p>
    </div>
  );
}

/** Pure three-way route-guard decision. Distinguishes:
 *   - "view": the server exists in the list — render the server view;
 *   - "waiting": the server is absent but is the one the user just created
 *     (=== pendingServer) — render ServerWaiting;
 *   - "not-found": the server is absent, is NOT the pending one, AND the list
 *     has loaded — render ServerNotFound immediately;
 *   - "view": otherwise (e.g. before the first fetch resolves) fall through to
 *     the server view / loading rather than flashing not-found.
 *  Gated on `serversLoaded`, NOT `servers.length > 0` (the latter was the bug:
 *  with pre-existing servers it fired not-found before the refresh landed). */
export function resolveServerView(
  server: string,
  servers: ServerInfo[],
  pendingServer: string | null,
  serversLoaded: boolean,
): "view" | "waiting" | "not-found" {
  if (servers.some((s) => s.name === server)) return "view";
  if (server === pendingServer) return "waiting";
  if (serversLoaded) return "not-found";
  return "view";
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
  const { setCurrentSession, setCurrentWindow, setSidebarOpen, setSidebarWidth, persistSidebarWidth, toggleFixedWidth, increaseTerminalFont, decreaseTerminalFont, resetTerminalFont } = useChromeDispatch();
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
  const [showSpawnAgentDialog, setShowSpawnAgentDialog] = useState(false);
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
    // leaves the 3px handle mid-drag (implicit pointer-capture workaround). Cleared
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

  // Latest flattened window order + current window id, for the window-switch
  // slide transition (260703-l4nf). Held in a ref (synced at render time,
  // below) so `navigateToWindow` can read the current order WITHOUT taking
  // `flatWindows`/`windowParam` as deps — those churn every SSE tick and would
  // recreate the callback (and defeat the sidebar-handler memoization) each
  // tick. `order` is the flattened window-id list (sidebar order); `iframeIds`
  // marks which targets are iframe windows (the first-paint gate is
  // terminal-only). Read only on a click, after render, so no TDZ concern.
  const switchTransitionRef = useRef<{
    order: string[];
    iframeIds: Set<string>;
    currentWindowId: string;
  }>({ order: [], iframeIds: new Set(), currentWindowId: "" });

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
      // Today's instant switch — the byte-identical body wrapped (or not)
      // below. Returns the `selectWindow` POST so the gated path can wait for
      // tmux to be told to switch before it starts counting incoming writes.
      // The returned promise PRESERVES the POST's rejection so a chained
      // `openForNotify` only fires on success (the gate must not open — and so
      // let a stale outgoing byte release it — when tmux was never told to
      // switch). Errors are still ignored: a separate `.catch(() => {})` marks
      // the promise handled (no unhandled-rejection warning) for the fire-and-
      // forget side effect, and every downstream consumer of the returned
      // promise attaches its own rejection handler.
      const runSwitch = (): Promise<unknown> => {
        pendingClickRef.current = { windowId };
        navigate({
          to: "/$server/$window",
          params: { server, window: windowId },
          replace: true,
        });
        const posted = selectWindow(server, windowId);
        posted.catch(() => {}); // ignore errors (fire-and-forget)
        if (isMobile) setSidebarOpen(false);
        return posted;
      };

      // Window-switch slide transition (260703-l4nf). Gate on: View Transitions
      // support, motion not reduced, an outgoing window in view, and a slide
      // direction resolvable from the flattened sidebar order. Any failure →
      // the instant switch above (progressive enhancement).
      const { order, iframeIds, currentWindowId } = switchTransitionRef.current;
      const direction = windowSwitchDirection(order, currentWindowId, windowId);
      // Guard `matchMedia` for non-browser/test envs (jsdom variants, older
      // WebViews) where it may be missing — same pattern as `use-is-mobile.ts`
      // and `chrome-context.tsx`'s `isMobileViewport`.
      const reducedMotion =
        typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const animate = shouldAnimateWindowSwitch({
        hasVTSupport: viewTransitionSupported(),
        reducedMotion,
        hasOutgoingWindow: !!currentWindowId,
        direction,
      });

      // Single narrowed guard: `shouldAnimateWindowSwitch` already returns false
      // when `direction === null`, so `!animate` alone covers the fallback; the
      // `!direction` half is the TypeScript narrowing that lets the assignment
      // below treat `direction` as non-null.
      if (!animate || !direction) {
        runSwitch();
        return;
      }

      // The new-state capture is gated on the incoming window's first inbound
      // bytes, with a timeout (the polished variant). Terminal targets open the
      // gate AFTER the selectWindow POST resolves — so a busy outgoing window's
      // still-streaming bytes (a same-session switch rides the existing socket)
      // can't release the gate before tmux has run select-window — then await
      // the first-write signal, which `TerminalClient` fires at message-receipt
      // time inside `ws.onmessage` (via `notifyFirstWrite`), not at terminal
      // write time (rAF-scheduled writes don't fire during VT suppression).
      // iframe targets have no such receipt seam, so they use the ungated
      // capture.
      //
      // Trade-off (accepted): during the ~180ms slide the View Transitions API
      // paints a snapshot pseudo-element that hit-tests to <html>, so a click
      // that lands on the terminal region mid-transition is lost (the app has a
      // brief pointer-input dead window). Keyboard input is unaffected — it
      // targets the focused element, not a hit-tested point — so the
      // keyboard-first flows (constitution V) never lose input.
      //
      // Fire-and-forget: `beginWindowSwitchGate` fires any prior in-flight gate
      // so a rapid second switch doesn't stall behind the first's timeout (the
      // VT spec queues the second callback behind the first's returned promise).
      // NOTE: this call is load-bearing on BOTH paths, including the iframe path
      // below — it fires a prior PENDING terminal gate (a terminal→iframe switch
      // supersedes an in-flight terminal gate), so it must run before we branch
      // on `targetIsIframe`.
      const targetIsIframe = iframeIds.has(windowId);
      const gate = beginWindowSwitchGate();
      // Capture a monotonic token so only the LATEST switch's cleanup may clear
      // the direction attribute (a superseded transition's `finished` still
      // fulfills — see below).
      const directionToken = nextDirectionToken();
      document.documentElement.dataset.windowSwitchDirection = direction;
      const transition = document.startViewTransition(async () => {
        const posted = runSwitch();
        if (!targetIsIframe) {
          // Race-at-entry: arm the ~300ms budget at callback ENTRY. Do NOT await
          // the POST — CHAIN `openForNotify` off it (fire-and-forget) and await
          // only the gate wait, whose timeout clock starts here. This hard-caps
          // the callback (and thus the document-wide render suppression) at the
          // timeout regardless of the POST's fate: `selectWindow` has no client
          // fetch timeout, so awaiting it directly could freeze the document up
          // to Chromium's ~4s VT deadline and serialize a rapid second switch
          // behind the stall. Chaining still filters outgoing writes — only
          // writes after the POST resolves SUCCESSFULLY count (openForNotify
          // runs post-POST, and `runSwitch`'s promise rejects on POST failure so
          // the `.then` is skipped and the gate stays closed → it times out
          // ungated rather than releasing on a stale outgoing byte).
          void posted.then(() => gate.openForNotify()).catch(() => {});
          await gate.waitForFirstWrite();
        }
      });
      // Clear the direction attribute once the transition settles. `finished`
      // FULFILLS both on completion AND when the transition is SKIPPED (a rapid
      // second switch supersedes this one — the path we now enable); it does not
      // reject on skip. So without a guard a superseded transition's cleanup
      // would delete the attribute its SUCCESSOR already set, dropping the
      // successor slide's direction CSS. Latest-wins guard: clear only when this
      // switch is still the latest to have set the attribute — mirroring the
      // gate's still-points-at-itself pattern. The trailing `.catch` swallows
      // any rejection (defensive) to avoid an unhandled-rejection warning.
      transition.finished
        .finally(() => {
          if (isLatestDirectionToken(directionToken)) {
            delete document.documentElement.dataset.windowSwitchDirection;
          }
        })
        .catch(() => {});
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
    dialogs.showRenameSessionDialog || dialogs.showKillConfirm || dialogs.showKillSessionConfirm || showCreateServerDialog || killServerTarget != null || showTmuxCommands || showCreateSessionAtFolderDialog || showCreateWindowAtFolderDialog || showCreateIframeDialog || showSpawnAgentDialog;

  // Flat window list for palette actions
  const flatWindows = useMemo(() => {
    return sessions.flatMap((s) =>
      s.windows.map((w) => ({ session: s.name, window: w })),
    );
  }, [sessions]);

  // Sync the window-switch transition ref (read on click by `navigateToWindow`)
  // with the latest flattened order + current window. Render-time assignment is
  // cheap and keeps the callback deps stable — see `switchTransitionRef` above.
  switchTransitionRef.current = {
    order: flatWindows.map((fw) => fw.window.windowId),
    // A target counts as "iframe" (ungated capture, no first-write seam) only
    // when it actually renders the IframeWindow branch — which requires BOTH
    // `rkType === "iframe"` AND `rkUrl` (app.tsx render gate). An iframe-typed
    // window with no `rkUrl` renders a TerminalClient, so it must stay on the
    // gated (first-write) path; keeping the predicate aligned prevents that
    // window from silently skipping the gate.
    iframeIds: new Set(
      flatWindows
        .filter((fw) => fw.window.rkType === "iframe" && fw.window.rkUrl)
        .map((fw) => fw.window.windowId),
    ),
    currentWindowId: windowParam ?? "",
  };

  // Create a new window in a session (from sidebar "+" button)
  const { execute: executeCreateWindow } = useOptimisticAction<[string, string]>({
    action: (srv, session) => {
      const targetSession = sessions.find((s) => s.name === session);
      const activeWin = targetSession?.windows.find((w) => w.isActiveWindow);
      // No name — tmux auto-names the window to its folder basename via
      // automatic-rename-format (the -c cwd on create makes this immediate).
      return createWindow(srv, session, undefined, activeWin?.worktreePath);
    },
    onOptimistic: (srv, session) => {
      // Label the optimistic ghost with the raw basename of the creation cwd so
      // it matches what tmux will name the window (was hardcoded "zsh").
      const targetSession = sessions.find((s) => s.name === session);
      const activeWin = targetSession?.windows.find((w) => w.isActiveWindow);
      ghostWindowIdRef.current = addGhostWindowStore(srv, session, rawBasename(activeWin?.worktreePath));
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

  // Freshest-value refs for the instant-create path. `sessions`/`currentWindow`/
  // `isSessionCreatePending` all churn on every SSE tick; reading them via
  // render-time-mutated refs (the same pattern as `dialogOpenRef` above) keeps
  // `handleCreateSessionInstant` referentially stable across ticks, so it (and
  // the Sidebar/TopBar/palette consumers that receive it) don't defeat the
  // memoization downstream. The values read are always the latest committed
  // render's, which is exactly what a click handler wants.
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const currentWindowRef = useRef(currentWindow);
  currentWindowRef.current = currentWindow;
  const isSessionCreatePendingRef = useRef(isSessionCreatePending);
  isSessionCreatePendingRef.current = isSessionCreatePending;
  // `ctx.sessionsByServer` is a fresh Map every SSE tick; the cross-server
  // create branch reads it at click time via this ref so the stable
  // `onCreateSession` callback below doesn't have to depend on it.
  const sessionsByServerRef = useRef(ctx.sessionsByServer);
  sessionsByServerRef.current = ctx.sessionsByServer;

  const handleCreateSessionInstant = useCallback(() => {
    // Guard against concurrent creates: a second click before the first request
    // settles would overwrite ghostSessionIdRef, causing ghost tracking to break.
    if (isSessionCreatePendingRef.current) return;
    const cwd = currentWindowRef.current?.worktreePath;
    const existingNames = sessionsRef.current.map((s) => s.name);
    const name = deriveInstantSessionName(cwd, existingNames);
    executeCreateSessionInstant(server, name, cwd || undefined);
  }, [server, executeCreateSessionInstant]);

  const handleCreateWindow = useCallback(
    (session: string) => {
      executeCreateWindow(server, session);
    },
    [server, executeCreateWindow],
  );

  // Open the spawn-agent dialog for the current window's session (260713-sbk1).
  // Both entry points (Cmd+K `Agent: Spawn`, window-switcher `+ New Agent`)
  // route here; the dialog reads the target session from state. Gated on a
  // resolvable session at the call sites (palette action / dropdown), so the
  // opener itself just flips the dialog on.
  const handleOpenSpawnAgent = useCallback(() => {
    setShowSpawnAgentDialog(true);
  }, []);


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
    // Refresh the (otherwise one-time-fetched) server list once the create
    // resolves so the new server appears and the waiting state swaps to the
    // view. `onAlwaysSettled` runs even though the create dialog has already
    // unmounted on navigation — AppShell (which owns this hook) stays mounted,
    // and `refreshServers` only touches root-level SessionContext.
    onAlwaysSettled: () => {
      refreshServers();
    },
    // A failed create must not strand the UI on the waiting state — clear the
    // pending marker (empty string clears to null) on the rollback path (also
    // unmount-safe, root-context only).
    onAlwaysRollback: () => {
      markServerPending("");
    },
  });

  const handleCreateServer = useCallback(() => {
    const trimmed = createServerName.trim();
    if (!trimmed || !/^[a-zA-Z0-9_-]+$/.test(trimmed)) return;
    executeCreateServer(trimmed);
    // Mark the just-created server pending so the route guard shows the brief
    // waiting state (not "Server not found") until the refreshed list includes
    // it. Cleared automatically by SessionContext once it appears.
    markServerPending(trimmed);
    navigate({ to: "/$server", params: { server: trimmed } });
    setShowCreateServerDialog(false);
    setCreateServerName("");
  }, [createServerName, navigate, executeCreateServer, markServerPending]);

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

  // Effective session order for the current server: SSE order (@rk_session_order)
  // filtered to live session names, with any un-ordered live sessions appended
  // in natural order — the "SSE order ?? natural" derivation (the sidebar's
  // transient drag override is component-local and not visible here). Drives the
  // Session: Move up/down gating (boundary = hidden, no wraparound).
  const effectiveSessionOrder = useMemo(
    () =>
      deriveEffectiveSessionOrder(
        sessions.map((s) => s.name),
        ctx.sessionOrderByServer.get(server) ?? [],
      ),
    [sessions, ctx.sessionOrderByServer, server],
  );

  const currentSessionOrderIdx = sessionName
    ? effectiveSessionOrder.indexOf(sessionName)
    : -1;

  const moveCurrentSession = useCallback(
    (delta: -1 | 1) => {
      if (!sessionName) return;
      const next = computeMoveOrder(effectiveSessionOrder, currentSessionOrderIdx, delta);
      if (!next) return; // boundary / invalid index: no-op
      setSessionOrder(server, next).catch((err) =>
        addToast(err.message || "Failed to move session"),
      );
    },
    [sessionName, currentSessionOrderIdx, effectiveSessionOrder, server, addToast],
  );

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
            // Move up/down within the effective session order (boundary =
            // hidden, no wraparound). Persisted via the existing setSessionOrder
            // (@rk_session_order), the same primitive the sidebar drag uses.
            ...(currentSessionOrderIdx > 0
              ? [
                  {
                    id: "session-move-up",
                    label: "Session: Move up",
                    onSelect: () => moveCurrentSession(-1),
                  },
                ]
              : []),
            ...(currentSessionOrderIdx >= 0 &&
            currentSessionOrderIdx < effectiveSessionOrder.length - 1
              ? [
                  {
                    id: "session-move-down",
                    label: "Session: Move down",
                    onSelect: () => moveCurrentSession(1),
                  },
                ]
              : []),
            {
              id: "kill-session",
              label: "Session: Kill",
              onSelect: dialogs.openKillSessionConfirm,
            },
          ]
        : []),
    ],
    [sessionName, dialogs, handleCreateSessionInstant, setShowCreateSessionAtFolderDialog, currentSessionOrderIdx, effectiveSessionOrder, moveCurrentSession],
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
                      const targetIndex = computeWindowMoveTarget(currentWindow.index, -1, minWindowIndex, maxWindowIndex);
                      if (sessionName && targetIndex !== null) {
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
                      const targetIndex = computeWindowMoveTarget(currentWindow.index, 1, minWindowIndex, maxWindowIndex);
                      if (sessionName && targetIndex !== null) {
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
            // Move up/down — the up/down vocabulary parity for windows (same
            // moveWindow ±1 primitive as Move Left/Right above; kept alongside
            // them so the existing left/right entries are not regressed).
            // Boundary = hidden, no wraparound.
            ...(currentWindow.index > minWindowIndex
              ? [
                  {
                    id: "window-move-up",
                    label: "Window: Move up",
                    onSelect: () => {
                      const targetIndex = computeWindowMoveTarget(currentWindow.index, -1, minWindowIndex, maxWindowIndex);
                      if (sessionName && targetIndex !== null) {
                        moveWindow(server, currentWindow.windowId, targetIndex)
                          .then(() => {
                            navigate({
                              to: "/$server/$window",
                              params: { server, window: currentWindow.windowId },
                            });
                          })
                          .catch((err) => addToast(err.message || "Failed to move window"));
                      }
                    },
                  },
                ]
              : []),
            ...(currentWindow.index < maxWindowIndex
              ? [
                  {
                    id: "window-move-down",
                    label: "Window: Move down",
                    onSelect: () => {
                      const targetIndex = computeWindowMoveTarget(currentWindow.index, 1, minWindowIndex, maxWindowIndex);
                      if (sessionName && targetIndex !== null) {
                        moveWindow(server, currentWindow.windowId, targetIndex)
                          .then(() => {
                            navigate({
                              to: "/$server/$window",
                              params: { server, window: currentWindow.windowId },
                            });
                          })
                          .catch((err) => addToast(err.message || "Failed to move window"));
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
                // Rewired (260703-5ilm) to trigger the centered heading's inline
                // edit via a CustomEvent (mirrors `theme-selector:open`), rather
                // than opening the old modal rename dialog. The heading owns the
                // rename surface now — one place, direct manipulation.
                if (currentWindow) {
                  document.dispatchEvent(new CustomEvent("window-heading:rename"));
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
      // Ungated within viewActions — a full-page reload is meaningful on every
      // AppShell route (Server Cabin `/$server`, Terminal `/$server/$window`),
      // unlike the top-bar RefreshButton which lives in the terminal-only
      // cluster. Reachable via THIS palette (AppShell's); the board route mounts
      // its own palette and carries a duplicate entry (board-page.tsx
      // `refreshEntry`), while the Cockpit `/` mounts no palette at all. A
      // keyboard-reachable recovery affordance (constitution V).
      {
        id: "refresh-page",
        label: "View: Refresh Page",
        onSelect: () => window.location.reload(),
      },
    ],
    [sessionName, fixedWidth, toggleFixedWidth],
  );

  // Terminal font-size actions. No `shortcut` — Cmd +/- is deliberately not
  // intercepted (native browser zoom stays available); the palette + the
  // top-bar combo are the only font levers. Global setting → applies to every
  // live terminal.
  const terminalFontActions: PaletteAction[] = useMemo(
    () => [
      { id: "terminal-font-increase", label: "Increase terminal font", onSelect: increaseTerminalFont },
      { id: "terminal-font-decrease", label: "Decrease terminal font", onSelect: decreaseTerminalFont },
      { id: "terminal-font-reset", label: "Reset terminal font", onSelect: resetTerminalFont },
    ],
    [increaseTerminalFont, decreaseTerminalFont, resetTerminalFont],
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
      {
        id: "help-documentation",
        label: "Help: Documentation",
        onSelect: () => window.open(HELP_URL, "_blank", "noopener,noreferrer"),
      },
    ],
    [server, executeReloadConfig, executeResetConfig],
  );

  // Update actions — keyboard-first parity (Constitution V) for the top-bar
  // update chip. Gated on a qualifying pending update (dev version suppressed).
  // The Update action deliberately IGNORES chip dismissal — dismissal silences
  // the ambient chip, but the palette is deliberate discovery — while a
  // companion Dismiss action mirrors the chip's `✕` for keyboard users.
  const { qualifies: updateQualifies, latest: updateLatest, updateNow, dismissUpdate } =
    useUpdateNotification();
  const updateActions: PaletteAction[] = useMemo(
    () =>
      buildUpdateActions(
        updateQualifies,
        updateLatest,
        () => {
          void updateNow().catch((err: unknown) =>
            addToast(err instanceof Error ? err.message : "Update failed", "error"),
          );
        },
        dismissUpdate,
      ),
    [updateQualifies, updateLatest, updateNow, dismissUpdate, addToast],
  );

  // Regular-class effective order (infra servers ignore rank and are not
  // reorderable). `servers` is already effective-sorted by the context, so this
  // is the visible order. The current server's position within it gates the
  // Move up/down actions (boundary = hidden, no wraparound); infra servers get
  // no Move action at all.
  const { regularOrder, currentRegularIdx } = useMemo(() => {
    const order = servers.filter((s) => !isInfraServer(s.name)).map((s) => s.name);
    return { regularOrder: order, currentRegularIdx: order.indexOf(server) };
  }, [servers, server]);

  const moveCurrentServer = useCallback(
    (delta: -1 | 1) => {
      const next = computeMoveOrder(regularOrder, currentRegularIdx, delta);
      if (!next) return; // boundary / infra (idx -1): no-op
      setServerOrder(next).catch((err) => addToast(err.message || "Failed to move server"));
    },
    [currentRegularIdx, regularOrder, server, addToast],
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
      // Move up/down act on the CURRENT server within the regular class. Hidden
      // when the current server is infra (not reorderable) or at the boundary
      // (no wraparound).
      ...(currentRegularIdx > 0
        ? [
            {
              id: "server-move-up",
              label: "Server: Move up",
              onSelect: () => moveCurrentServer(-1),
            },
          ]
        : []),
      ...(currentRegularIdx >= 0 && currentRegularIdx < regularOrder.length - 1
        ? [
            {
              id: "server-move-down",
              label: "Server: Move down",
              onSelect: () => moveCurrentServer(1),
            },
          ]
        : []),
      ...servers.map(({ name }) => ({
        id: `switch-server-${name}`,
        label: `Server: Switch to ${name}${name === server ? " (current)" : ""}`,
        onSelect: () => handleSwitchServer(name),
      })),
    ],
    [servers, server, handleSwitchServer, currentRegularIdx, regularOrder, moveCurrentServer],
  );

  // Per-window switch entries — one per window across every session. Grouped
  // under the "Window:" family (renamed from the old "Terminal:" prefix) to
  // surface the keyboard switch path (constitution V). Reuses navigateToWindow
  // (URL nav + selectWindow + mobile-close + pendingClickRef writeback
  // suppression); the `(current)` suffix marks the URL-active window, mirroring
  // `Server: Switch to <name> (current)`.
  const windowSwitchActions: PaletteAction[] = useMemo(
    () => flatWindows.map((fw) => ({
      id: `window-switch-${fw.session}-${fw.window.windowId}`,
      label: `Window: Switch to ${fw.session} › ${fw.window.name}${
        fw.window.windowId === windowParam ? " (current)" : ""
      }`,
      onSelect: () => navigateToWindow(fw.window.windowId),
    })),
    [flatWindows, navigateToWindow, windowParam],
  );

  // Agent: Next waiting (260706-y1ar; status-pyramid.md § Attention Propagation).
  // The keyboard-first attention nav (Constitution V): cycles focus through
  // windows whose rolled-up agentState is `waiting`, CURRENT SERVER FIRST then
  // other ATTACHED servers (unattached servers' window data isn't streamed, so
  // they can't be enumerated client-side — a known constraint). No-op with a
  // "no agents waiting" toast when none. Single action; the cycle arithmetic is
  // the pure `nextWaitingTarget` helper (unit-tested). Built off `flatWindows`
  // (current server, already sidebar-ordered) + a live read of the streamed
  // `sessionsByServerRef` for other servers (avoids churning this memo's deps
  // every SSE tick — mirrors handleSidebarSelectWindow's ref read).
  const agentActions: PaletteAction[] = useMemo(() => {
    const onSelect = () => {
      const ordered: WaitingTarget[] = [];
      // Current server first, in sidebar order.
      for (const fw of flatWindows) {
        if (isWaiting(fw.window)) {
          ordered.push({ server, windowId: fw.window.windowId });
        }
      }
      // Then other attached servers (skip the current one — already added).
      for (const s of servers) {
        if (s.name === server) continue;
        for (const sess of sessionsByServerRef.current.get(s.name) ?? []) {
          for (const w of sess.windows) {
            if (isWaiting(w)) ordered.push({ server: s.name, windowId: w.windowId });
          }
        }
      }
      const target = nextWaitingTarget(ordered, server, windowParam);
      if (!target) {
        addToast("No agents waiting", "info");
        return;
      }
      if (target.server === server) {
        navigateToWindow(target.windowId);
      } else {
        navigate({ to: "/$server/$window", params: { server: target.server, window: target.windowId } });
        if (isMobile) setSidebarOpen(false);
      }
    };
    return [{ id: "agent-next-waiting", label: "Agent: Next waiting", onSelect }];
  }, [flatWindows, servers, server, windowParam, navigateToWindow, navigate, isMobile, setSidebarOpen, addToast]);

  // Agent: Spawn — Cmd+K parity for the web-UI spawn flow (260713-sbk1;
  // Constitution V palette parity — the shortcut/registration is documented
  // here per code-review.md "New keyboard shortcuts must be documented in the
  // command palette registration"). Gated on a resolvable session (mirrors
  // Window: Create), since the spawn target IS the current window's session.
  const agentSpawnActions: PaletteAction[] = useMemo(
    () =>
      sessionName
        ? [{ id: "agent-spawn", label: "Agent: Spawn", onSelect: handleOpenSpawnAgent }]
        : [],
    [sessionName, handleOpenSpawnAgent],
  );

  const { actions: pushActions } = usePushSubscription();

  const paletteActions: PaletteAction[] = useMemo(
    () => [...sessionActions, ...windowActions, ...boardActions, ...viewActions, ...terminalFontActions, ...themeActions, ...configActions, ...updateActions, ...serverActions, ...pushActions, ...windowSwitchActions, ...agentActions, ...agentSpawnActions],
    [sessionActions, windowActions, boardActions, viewActions, terminalFontActions, themeActions, configActions, updateActions, serverActions, pushActions, windowSwitchActions, agentActions, agentSpawnActions],
  );

  const displayName = currentWindow?.name ?? windowParam ?? "";
  const displaySession = sessionName ?? "";

  // Stable Sidebar handlers (R6a). `AppShell` consumes `useSessionContext()` and
  // therefore re-renders on every SSE tick; inline arrows here would recreate
  // these references each tick and defeat `ServerGroup`'s `React.memo` for every
  // group, including the currently-viewed one. The branching behavior
  // (current-server vs cross-server) is identical to the prior inline arrows.
  //
  // These MUST be declared before the three-way route-guard early returns below
  // — they are hooks, so a conditional/early-returned call site would violate the
  // Rules of Hooks (the not-found/waiting branches return before reaching them,
  // changing the hook count between renders).
  const handleSidebarSelectWindow = useCallback(
    (srv: string, _sess: string, windowId: string) => {
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
    },
    [server, navigateToWindow, navigate, isMobile, setSidebarOpen],
  );
  const handleSidebarCreateWindow = useCallback(
    (srv: string, sess: string) => {
      if (srv === server) {
        handleCreateWindow(sess);
      } else {
        executeCreateWindow(srv, sess);
      }
    },
    [server, handleCreateWindow, executeCreateWindow],
  );
  const handleSidebarCreateSession = useCallback(
    (srv: string) => {
      if (srv === server) {
        handleCreateSessionInstant();
      } else {
        // For non-current servers, create with a default name
        // (no cwd source available). Read the freshest sessions map at click
        // time so this callback stays stable across SSE ticks.
        const existingNames = (sessionsByServerRef.current.get(srv) ?? []).map((s) => s.name);
        const name = deriveInstantSessionName(undefined, existingNames);
        executeCreateSessionInstant(srv, name, undefined);
      }
    },
    [server, handleCreateSessionInstant, executeCreateSessionInstant],
  );

  // Register AppShell's TopBar props into the persistent root bar's slot
  // (260707-4vq2). The heavy handlers (`navigateToWindow` with its
  // View-Transitions gate, `handleCreateSessionInstant` with optimistic
  // ghosts) stay defined here and are published by reference — no logic
  // migrates to root. `mode` (terminal vs root) is derived at root from the
  // route, so it is NOT part of the slot. Memoized so the registration effect
  // re-publishes only when a prop actually changes. Declared here (a hook)
  // BEFORE the three-way route-guard early returns to keep the hook order
  // stable across the waiting/not-found branches.
  const onToggleSidebar = useCallback(
    () => setSidebarOpen(!sidebarOpen),
    [setSidebarOpen, sidebarOpen],
  );
  const topBarSlot = useMemo(
    () => ({
      sessions,
      currentSession,
      currentWindow,
      sessionName: displaySession,
      windowName: displayName,
      isConnected,
      sidebarOpen,
      server,
      onNavigate: navigateToWindow,
      onToggleSidebar,
      onCreateSession: handleCreateSessionInstant,
      onCreateWindow: handleCreateWindow,
      onSpawnAgent: handleOpenSpawnAgent,
    }),
    [
      sessions,
      currentSession,
      currentWindow,
      displaySession,
      displayName,
      isConnected,
      sidebarOpen,
      server,
      navigateToWindow,
      onToggleSidebar,
      handleCreateSessionInstant,
      handleCreateWindow,
      handleOpenSpawnAgent,
    ],
  );
  useRegisterTopBarSlot(topBarSlot);

  // Three-way route guard. Distinguishes a just-created server (brief waiting
  // state) from a genuinely-unknown one (not found), keyed on `serversLoaded`
  // (NOT `servers.length > 0`, which fired not-found prematurely when the user
  // already had servers and the post-create refresh hadn't landed yet).
  const serverView = resolveServerView(server, servers, pendingServer, serversLoaded);
  if (serverView === "waiting") {
    return <ServerWaiting serverName={server} />;
  }
  if (serverView === "not-found") {
    return <ServerNotFound serverName={server} />;
  }

  // Sidebar element — shared between the desktop grid placement and the
  // mobile overlay (the Shell component renders one or the other).
  const sidebarElement = (
    <Sidebar
      currentServer={server || null}
      currentSession={sessionName ?? null}
      currentWindowId={windowParam ?? null}
      onSelectWindow={handleSidebarSelectWindow}
      onCreateWindow={handleSidebarCreateWindow}
      onCreateSession={handleSidebarCreateSession}
      onCreateServer={() => setShowCreateServerDialog(true)}
      onKillServer={(name) => setKillServerTarget(name)}
      onSidebarResizeStart={isMobile ? undefined : (e) => handleDragStart(e.clientX)}
    />
  );

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
          {/* Drag handle — hidden when collapsed (column is 0-width anyway).
              Visual bar is 3px (the seam width), but the grabbable area is
              extended ~8px into the sidebar via the invisible `before:`
              pseudo-element (pointer events on a pseudo hit its element, so
              the drag/hover handlers fire unchanged). It cannot extend RIGHT
              over the terminal: the aside's `overflow-hidden` clips anything
              past its edge. */}
          <div
            className="relative w-[3px] shrink-0 cursor-col-resize bg-border hover:bg-text-secondary transition-colors before:content-[''] before:absolute before:inset-y-0 before:-left-2 before:right-0"
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

      {/* Top bar mount moved to the persistent root layout (260707-4vq2) —
          AppShell publishes its TopBar props into the slot context instead
          (see the `useRegisterTopBarSlot` effect above). The `terminal` vs
          `root` mode distinction is derived at root from the route params. */}

      {/* Content grid area */}
      <main
        style={{ gridArea: "content" }}
        className={`min-w-0 flex flex-col overflow-hidden ${fixedWidth ? "bg-bg-inset" : ""}`}
      >
        {/* The terminal content surface. `viewTransitionName` scopes the
            window-switch slide (260703-l4nf) to this region only — sidebar,
            top bar, and bottom bar (outside <main>) stay static. Pure
            transforms on the ::view-transition pseudo-elements (globals.css)
            mean no layout change, so the terminal's ResizeObserver/fitAndSync
            never fires and tmux sees no resize churn. */}
        <div
          className={`flex-1 min-h-0 flex flex-col ${fixedWidth ? "bg-bg-primary" : ""}`}
          style={{
            viewTransitionName: "terminal-surface",
            ...(fixedWidth ? { maxWidth: 900, width: "100%", marginInline: "auto" } : {}),
          }}
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
            <SessionTiles
              server={server}
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
        className="border-t-[3px] border-border px-1.5 h-[48px]"
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

      {showSpawnAgentDialog && sessionName && (
        <Suspense fallback={null}>
          <SpawnAgentDialog
            session={sessionName}
            onSpawned={navigateToWindow}
            onClose={() => setShowSpawnAgentDialog(false)}
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
          {killServerTarget === DAEMON_SERVER && (
            <p className="text-red-400 mb-2.5">
              <strong>{DAEMON_SERVER}</strong> hosts the run-kit daemon serving this dashboard — killing it takes the dashboard down.
            </p>
          )}
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
