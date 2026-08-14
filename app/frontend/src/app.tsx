import { lazy, Suspense, useEffect, useRef, useMemo, useState, useCallback, useSyncExternalStore } from "react";
import { useNavigate, useMatches, useSearch, Outlet } from "@tanstack/react-router";
import {
  availableViews,
  nextView,
  readStoredView,
  type ViewName,
} from "@/lib/window-view";
import {
  availableSurfaces,
  readStoredPanel,
  type SurfaceName,
} from "@/lib/right-panel";
import {
  readLatchedCodeFolder,
  writeLatchedCodeFolder,
} from "@/lib/code-folder-latch";
import {
  addSurface,
  closeSurface,
  hintLayout,
  promote,
  readStoredLayout,
  resolveLayout,
  seedLayoutFromLegacy,
  serializeLayout,
  swapWithNext,
  translateLegacyParams,
  writeStoredLayout,
  type Layout,
  type SurfaceKind,
} from "@/lib/surface-layout";
import { matchesCombo, hasReclaimableMatch, shouldSuppressChord, withShortcutHints, formatCombo } from "@/lib/keybindings";
import { isMacroActionId, type MacroAction } from "@/lib/macros";
import { useKeybindings } from "@/hooks/use-keybindings";
import { useKeybindingDispatch } from "@/hooks/use-keybinding-dispatch";
import { useMacros } from "@/hooks/use-macros";
import { ShortcutsOverlay } from "@/components/shortcuts-overlay";
import { ChromeProvider, useChromeState, useChromeDispatch, SIDEBAR_WIDTH_BOUNDS } from "@/contexts/chrome-context";
import { FocusedTerminalProvider } from "@/contexts/focused-terminal-context";
import { TopBarSlotProvider, useTopBarSlot, useTopBarNotFound, useRegisterTopBarSlot } from "@/contexts/top-bar-slot-context";
import { FocusedPaneProvider } from "@/contexts/focused-pane-context";
import { computeKillRedirect } from "@/lib/navigation";
import { deriveEffectiveSessionOrder, computeMoveOrder, computeWindowMoveTarget } from "@/lib/palette-move";
import { buildViewActions } from "@/lib/palette-view";
import { buildLayoutActions } from "@/lib/palette-layout";
import { buildStatusRefreshAction } from "@/lib/palette-status-refresh";
import { buildPinActions } from "@/lib/palette-pin";
import {
  buildSelectAllMergedAction,
  buildSelectionCloseAction,
  buildSelectionMoveActions,
  buildSelectionSendPromptAction,
  batchToast,
  executeSelectionBatch,
} from "@/lib/palette-selection";
import { singleSelectedServer } from "@/lib/selection";
import { useSelectionStore } from "@/store/selection-store";
import { buildServerKillActions } from "@/lib/palette-server-kill";
import { buildShellServerActions } from "@/lib/palette-shell";
import { isShell, switchShellServer } from "@/lib/shell";
import { ShellTitlebarStrip } from "@/components/shell-titlebar-strip";
import { ShellAccentReporter } from "@/components/shell-accent-reporter";
import { ShellBadgeReporter } from "@/components/shell-badge-reporter";
import { useShellServers } from "@/hooks/use-shell-servers";
import { readLastPinnedBoard } from "@/lib/last-pinned-board";
import { buildOpenActions, buildOpenLastUsedAction, buildOpenPrAction } from "@/lib/palette-open";
import { activePaneCwd, buildOpenTargets, readLastUsedOpenTarget, resolveLastUsedTarget } from "@/lib/open-in-app";
import { useOpenTargets } from "@/hooks/use-open-targets";
import { useRunOpenTarget } from "@/components/open-button";
import { nextWaitingTarget, chatSearchForTarget, type WaitingTarget } from "@/lib/palette-agent-nav";
import { isWaiting } from "@/lib/waiting";
import { useChatSubscription } from "@/hooks/use-chat-subscription";
import {
  windowSwitchDirection,
  viewTransitionSupported,
  shouldAnimateWindowSwitch,
  beginWindowSwitchGate,
  nextDirectionToken,
  isLatestDirectionToken,
  armGraceMask,
  tearDownMask,
  confirmSwitchArrived,
  abandonSwitchFeedback,
  subscribeMaskState,
  getMaskState,
  isMaskExemptKey,
  isRedundantSwitch,
  isSamePendingTarget,
  type PendingSwitchTarget,
} from "@/lib/window-transition";
import { ThemeProvider, useTheme, useThemeActions } from "@/contexts/theme-context";
import { InstanceAccentProvider, useInstanceAccent } from "@/contexts/instance-accent-context";
import { InstanceNameProvider, useInstanceName } from "@/contexts/instance-name-context";
import { SettingsDialogProvider } from "@/contexts/settings-dialog-context";
import { ServerDialogsProvider, useServerDialogs } from "@/contexts/server-dialogs-context";
import { PaletteActionsProvider, usePaletteActions, usePaletteActionsApi, usePaletteGlobals, useRegisterPaletteActions } from "@/contexts/palette-actions-context";
import { ServerDialogs } from "@/components/server-dialogs";
import { useGlobalPaletteActions } from "@/hooks/use-global-palette-actions";
import { SessionProvider } from "@/contexts/session-context";
import { ToastProvider } from "@/components/toast";
import { OptimisticProvider } from "@/contexts/optimistic-context";
import { useDialogState } from "@/hooks/use-dialog-state";
import { useSessionsScope } from "@/hooks/use-sessions-scope";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { TopBar, type TopBarMode } from "@/components/top-bar";
import { useVisualViewport } from "@/hooks/use-visual-viewport";
import { Shell } from "@/components/shell/shell";
import { Sidebar } from "@/components/sidebar";
import { RightPanel } from "@/components/right-panel";
import { SurfaceLayout } from "@/components/surface-layout";
import { BottomBar } from "@/components/bottom-bar";
import { ComposeStrip } from "@/components/compose-strip";
import { focusComposeStrip } from "@/lib/compose-strip-events";
import type { PaletteAction } from "@/components/command-palette";
import { Dialog } from "@/components/dialog";
import { SessionTiles } from "@/components/session-tiles/session-tiles";
import { TmuxCommandsDialog } from "@/components/tmux-commands-dialog";
import { LogoSpinner } from "@/components/logo-spinner";
import type { ServerInfo } from "@/api/client";

import { selectWindow, createSession, createWindow, splitWindow, closePane, killWindow, moveWindow, moveWindowToSession, reloadTmuxConfig, initTmuxConf, setWindowColor as setWindowColorApi, setWindowRole, setSessionColor as setSessionColorApi, setSessionOrder, setServerOrder, sendChatMessage, refreshStatus, isInfraServer, spawnRiff, getRiffPresets, forkWindow } from "@/api/client";
import { useBoards } from "@/hooks/use-boards";
import { useWindowPins } from "@/hooks/use-window-pins";
import { usePinActions } from "@/hooks/use-pin-actions";
import {
  deriveNameFromPath,
  finalizeSafeName,
  toSafeSessionName,
  toSafeWindowName,
} from "@/lib/names";
import { useSessionContext, useCodeServer } from "@/contexts/session-context";
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
const SettingsDialog = lazy(() => import("@/components/settings-dialog").then(m => ({ default: m.SettingsDialog })));

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
 *  means the multi-server state socket is shared across `/$server/...`,
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
  // including the host and edge pages that mount no `Shell`. The hook is a
  // single idempotent effect; owning it once at the root avoids the double-mount
  // cleanup race a second call in `Shell` would create (Shell now sizes to
  // `height: 100%` and no longer consumes the var directly).
  useVisualViewport();
  return (
    <ThemeProvider>
      <ToastProvider>
        <InstanceAccentProvider>
          <InstanceNameProvider>
          <ChromeProvider>
            <SessionProvider>
              <FocusedTerminalProvider>
                <OptimisticProvider>
                  <TopBarSlotProvider>
                    <FocusedPaneProvider>
                      <Outlet />
                    </FocusedPaneProvider>
                  </TopBarSlotProvider>
                </OptimisticProvider>
              </FocusedTerminalProvider>
            </SessionProvider>
          </ChromeProvider>
          </InstanceNameProvider>
        </InstanceAccentProvider>
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
    // Settings dialog (o7q8): provided HERE — the true every-page layer — so
    // any descendant (AppShell palette, board palette, sidebar gear) can call
    // `openSettings()` while the dialog renders exactly once below. AppShell
    // is server-scoped and `/board/$name` doesn't render it, so a lower mount
    // would either miss boards or duplicate the dialog.
    //
    // Server dialogs + the palette-actions slot (260811-239r) join it at the
    // same layer: the create/kill server dialogs, the single CommandPalette,
    // and the ShortcutsOverlay each mount exactly once below, and any route
    // (boards included) triggers them through `server-dialogs-context` /
    // registers route-scoped palette actions into `palette-actions-context`.
    // Order matters: the palette slot's global actions are built INSIDE
    // `SettingsDialogProvider` (`Settings: Open` consumes it), and
    // `ServerDialogs` reads `SessionContext` (RootWrapper, above all of this).
    <SettingsDialogProvider>
      <ServerDialogsProvider>
        <AppLayoutContent />
      </ServerDialogsProvider>
    </SettingsDialogProvider>
  );
}

/** AppLayout's body — split out so the layout-level global palette actions
 *  (which consume the settings-dialog context) can be built above the
 *  `PaletteActionsProvider` they feed. */
function AppLayoutContent() {
  // Instance accent (1etw): a 2px stripe across the top of the persistent top
  // bar plus a subtle wash behind it — the "which run-kit instance is this"
  // color channel (server colors own the sidebar). Both hexes are theme-derived
  // (contrast-guarded stripe, ~6.5% background blend wash); nothing renders
  // until an accent is resolved.
  const { stripeHex, washHex } = useInstanceAccent();

  // The registry cheatsheet overlay state (260730-g40a), lifted from the
  // AppShell/BoardPage twins to the layout (260811-239r, R12) — the
  // `Help: Keyboard Shortcuts` global palette entry cannot toggle route-local
  // state. Toggled by the per-platform shortcuts chord (which resolves this
  // entry's `onSelect` through the merged palette list), the palette entry
  // itself, and the top-bar overflow menu's Keyboard shortcuts row (the
  // listener below; the row relocated from the sidebar footer in 260812-d1at). THE
  // single shortcuts surface — its TMUX section absorbed the retired tmux
  // keybindings modal (260801-sm6g).
  const [showShortcutsOverlay, setShowShortcutsOverlay] = useState(false);
  const toggleShortcutsOverlay = useCallback(() => setShowShortcutsOverlay((prev) => !prev), []);
  const globalActions = useGlobalPaletteActions({ onToggleShortcutsOverlay: toggleShortcutsOverlay });

  // Sidebar-footer Keyboard icon → overlay toggle (260801-sm6g). The sidebar
  // mounts from BOTH route shells (AppShell; the board route in
  // board-page.tsx), so the affordance signals via a document CustomEvent —
  // the `palette:open` precedent. The listener lived in each route shell while
  // the overlay was twinned; the single layout-lifted overlay owns it now.
  useEffect(() => {
    const onOverlayOpen = () => setShowShortcutsOverlay((prev) => !prev);
    document.addEventListener("shortcuts-overlay:open", onOverlayOpen);
    return () => document.removeEventListener("shortcuts-overlay:open", onOverlayOpen);
  }, []);

  return (
    <PaletteActionsProvider globalActions={globalActions}>
    <div
      className="app-root flex flex-col"
      style={{ height: "var(--app-height, 100vh)" }}
    >
      {/* Desktop-shell chrome (260731-ofws), shell-only by `isShell()` gating
          (false in every browser and in Playwright): the titlebar strip is the
          window's drag surface under the shell's hidden native titlebar, and
          the badge reporter mirrors the waiting-agent count to the OS dock/
          taskbar badge. The top bar below is untouched — the strip is a new
          sibling ABOVE it, not a merge. */}
      {isShell() && <ShellTitlebarStrip />}
      {isShell() && <ShellBadgeReporter />}
      {isShell() && <ShellAccentReporter />}
      {/* Plain `div`, not `header`: `TopBar` already renders its own `<header>`
          (the banner landmark), so wrapping it in a second `<header>` would
          nest two `role="banner"` landmarks. This wrapper only owns the
          `shrink-0` sizing that keeps the bar at its natural height above the
          `flex-1` content region (plus the instance-accent stripe/wash — the
          TopBar header has no background of its own, so the wash on this
          wrapper shows through). */}
      <div className="shrink-0" style={washHex ? { backgroundColor: washHex } : undefined}>
        {stripeHex && (
          <div aria-hidden="true" style={{ height: "2px", backgroundColor: stripeHex }} />
        )}
        <RootTopBar />
      </div>
      <div className="flex-1 min-h-0">
        <Suspense fallback={null}>
          <Outlet />
        </Suspense>
      </div>
      {/* The ONE settings-dialog mount (o7q8) — never duplicated per page. */}
      <Suspense fallback={null}>
        <SettingsDialog />
      </Suspense>
    </div>
    {/* The ONE server create/kill dialog mount (260811-239r) — every route's
        sidebar/palette triggers funnel through `server-dialogs-context`. */}
    <ServerDialogs />
    {/* The ONE (lazy) command-palette mount (260811-239r) — renders the merged
        list: the active route's registered actions first, then the global
        groups built above. The per-route palette mounts are gone. */}
    <LayoutCommandPalette />
    {/* The ONE shortcuts-overlay mount (260811-239r, R12) — lifted from the
        AppShell/BoardPage twins alongside its state. */}
    <LayoutShortcutsOverlay
      open={showShortcutsOverlay}
      onClose={() => setShowShortcutsOverlay(false)}
    />
    </PaletteActionsProvider>
  );
}

/** The layout palette mount — an inner component because the merged
 *  `allActions` list (`[...routeActions, ...globalActions]`) is computed by
 *  `PaletteActionsProvider` and read back via `usePaletteActions()`. */
function LayoutCommandPalette() {
  const allActions = usePaletteActions();
  return (
    <Suspense fallback={null}>
      <CommandPalette actions={allActions} />
    </Suspense>
  );
}

/** The layout shortcuts-overlay mount (260811-239r). Carries the session-
 *  scoped add-flow inputs AppShell used to feed its own mount: the macro
 *  add-flow's palette-target candidates (every merged palette action except
 *  the macro entries themselves — no macro→macro chains) and the best-effort
 *  riff-preset fetch. Both stay gated on a route with a server + session
 *  (derived from the same deepest-first route-param walk + SSE snapshot
 *  AppShell used), so a board-route overlay behaves exactly as before (no add
 *  flow, no badges). */
function LayoutShortcutsOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ctx = useSessionContext();
  const matches = useMatches();
  const allActions = usePaletteActions();

  let serverParam: string | undefined;
  let windowParam: string | undefined;
  for (let i = matches.length - 1; i >= 0; i--) {
    const p = (matches[i]?.params ?? {}) as { server?: string; window?: string };
    if (serverParam === undefined && typeof p.server === "string") serverParam = p.server;
    if (windowParam === undefined && typeof p.window === "string") windowParam = p.window;
  }
  const server = ctx.currentServer ?? serverParam ?? "";
  // The session of the URL's window, derived from the streamed sessions — the
  // same derivation AppShell used to scope the riff-preset fetch.
  const sessionName = useMemo(() => {
    if (!windowParam || !server) return undefined;
    return (ctx.sessionsByServer.get(server) ?? []).find((s) =>
      s.windows.some((w) => w.windowId === windowParam),
    )?.name;
  }, [ctx.sessionsByServer, server, windowParam]);

  const macroPaletteTargets = useMemo(
    () =>
      server
        ? allActions
            .filter((a) => !isMacroActionId(a.id))
            .map((a) => ({ id: a.id, label: a.label }))
        : undefined,
    [server, allActions],
  );

  // Best-effort riff-preset names for the overlay's CUSTOM section (add-flow
  // targets + missing-preset badges), fetched while the overlay is open on a
  // route with a session (GET /api/riff/presets derives the repo from the
  // session's active pane — the same preflight seam the spawn dialog uses).
  // null = unknown: the overlay shows no badges and offers palette targets
  // only.
  const [riffPresetNames, setRiffPresetNames] = useState<string[] | null>(null);
  useEffect(() => {
    if (!open || !sessionName) {
      // Reset on close / sessionless routes — this mount persists across
      // routes (unlike the per-route twins it replaced), so a previously
      // fetched list would otherwise leak into later opens elsewhere.
      setRiffPresetNames(null);
      return;
    }
    let cancelled = false;
    getRiffPresets(server, sessionName)
      .then((data) => {
        if (!cancelled) setRiffPresetNames(data.presets.map((p) => p.name));
      })
      .catch(() => {
        if (!cancelled) setRiffPresetNames(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, server, sessionName]);

  return (
    <ShortcutsOverlay
      open={open}
      onClose={onClose}
      paletteTargets={macroPaletteTargets}
      riffPresetNames={riffPresetNames}
    />
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
  // not-found page is what actually renders, force the minimal `host`
  // fallback (R3/R10). (The `/$server/$window`+extra shape — `/a/b/c` — is a
  // different arm: it renders AppShell's `ServerNotFound`, not `NotFoundPage`,
  // so `notFound` is false there and the `server`/`terminal` mode below is kept.)
  const notFound = useTopBarNotFound();

  // Walk matches deepest-first for route params. Param NAMES are unique across
  // the route tree (`window` only on the terminal route, `server` on the server
  // layout, `name` on the board route), so their presence fully determines the
  // mode — the same deepest-first param walk `SessionContext` uses for
  // `currentServer`. The host (`/`) carries no params and resolves to the
  // minimal `host` mode.
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
  if (notFound) mode = "host";
  else if (boardParam !== undefined) mode = "board";
  else if (windowParam !== undefined) mode = "terminal";
  else if (serverParam !== undefined) mode = "server";
  else mode = "host";

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
      sidebarOpen={slot?.sidebarOpen ?? false}
      // Prefer the page-registered server (the confirmed value), but fall back
      // to the route-derived `serverParam` so the `tmux Server: <server>`
      // heading (server mode) and the terminal-mode server crumb render
      // synchronously from the URL — before AppShell's registering effect runs
      // on a cold deep link / first frame after navigation, `slot` is null and
      // `slot?.server` would be `""`, which those truthy-gated renders omit.
      // Mirrors how `boardName` already renders from `boardParam` above.
      server={slot?.server ?? serverParam ?? ""}
      onNavigate={slot?.onNavigate ?? (() => {})}
      onToggleSidebar={slot?.onToggleSidebar ?? (() => {})}
      onCreateWindow={slot?.onCreateWindow ?? (() => {})}
      onSpawnAgent={slot?.onSpawnAgent}
      paneCount={slot?.paneCount}
      serverCount={slot?.serverCount}
      waitingPaneCount={slot?.waitingPaneCount}
      boards={slot?.boards}
      focusedPane={slot?.focusedPane}
      onRequestKill={slot?.onRequestKill}
      autofit={slot?.autofit}
      onToggleAutofit={slot?.onToggleAutofit}
      railOpen={slot?.railOpen}
      onToggleRail={slot?.onToggleRail}
      layout={slot?.layout}
      onApplyLayout={slot?.onApplyLayout}
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

/**
 * The window as the CODE surface sees it (260813-if5d): its `gitRoot` replaced
 * by the window's latched code folder when one exists, the live derivation
 * otherwise. One substitution point is what makes `hasCode`, `availableTiles`,
 * `degradeLayout`, the tile render guard, `tileMeta`, and `codeServerSrc` all
 * follow the latch while the pure lib modules stay DOM-free and unchanged: the
 * latch is read where the storage identity (server, window id) lives and fed in
 * as an ordinary window record. Unlatched windows pass through by identity, so
 * the substitution adds no render churn before the first code open.
 */
export function withLatchedCodeFolder<T extends { gitRoot?: string }>(
  win: T | null,
  latch: string | undefined,
): T | null {
  return win && latch ? { ...win, gitRoot: latch } : win;
}

/**
 * How long a pending window switch may stay unconfirmed before the failure
 * bounce-back fires (260715-38kg). If neither an explicit `selectWindow` POST
 * rejection nor an SSE confirmation arrives within this window, the pending
 * intent is cleared so the URL/heading bounce back to tmux's actual active
 * window (un-sticking the silent-failure limbo). A named tunable — a "few
 * seconds" per the design; trivially adjusted. This is a SINGLE per-switch
 * timer, not a polling loop (SSE remains the confirmation source).
 */
const CONFIRMATION_WINDOW_MS = 5000;

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
  const serversLoaded = ctx.serversLoaded;
  const pendingServer = ctx.pendingServer;
  const sessions = useMergedSessions(rawSessions, server);
  const { sidebarOpen, sidebarWidth, railOpen, fixedWidth, composeStripEnabled } = useChromeState();
  const { setCurrentSession, setCurrentWindow, setSidebarOpen, setSidebarWidth, setRailOpen, persistSidebarWidth, toggleFixedWidth, toggleComposeStrip } = useChromeDispatch();
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

  // Code-folder latch (260813-if5d; spec right-panel.md § The code lens): the
  // code surface's folder is per-window LATCHED state, not the live SSE
  // derivation — `gitRoot` follows the active pane's cwd, so a pane switch or a
  // `cd` would otherwise retarget (or unmount) the embedded editor and lose its
  // in-flight state. localStorage stays the source of truth and is read AT
  // RENDER, keyed per (server, window id) — the `storedLayout` read below does
  // the same. Deliberately not mirrored into state via an effect: an effect
  // lands a frame late, so a window switch would render the PREVIOUS window's
  // latch once, and the code iframe that mounts in that frame fixes its `src`
  // for its whole mount generation — the stale folder would stick. The epoch
  // bump is what re-reads after a write; `latchCodeFolder` is the only writer
  // (the seed effect below at first open, then the editor's own navigation).
  const [latchEpoch, setLatchEpoch] = useState(0);
  const latchedCodeFolder = useMemo(
    () => (windowParam ? readLatchedCodeFolder(server, windowParam) : undefined),
    [server, windowParam, latchEpoch],
  );
  const latchCodeFolder = useCallback((folder: string) => {
    if (!windowParam || folder.length === 0) return;
    writeLatchedCodeFolder(server, windowParam, folder);
    setLatchEpoch((n) => n + 1);
  }, [server, windowParam]);
  // The live backend derivation (active pane's cwd walked to its repo root). Its
  // ONLY remaining job is seeding the latch — nothing renders from it.
  const derivedGitRoot = currentWindow?.gitRoot ?? "";
  // The window every code-availability/render consumer below sees (§
  // withLatchedCodeFolder): latched folder when latched, live derivation as the
  // seed otherwise.
  const effectiveWindow = useMemo(
    () => withLatchedCodeFolder(currentWindow, latchedCodeFolder),
    [currentWindow, latchedCodeFolder],
  );

  // Surface-layout state (260812-ab5v-surface-layout-core; spec
  // surface-layout.md L1–L3). The terminal route's center is a LAYOUT of 1–3
  // surface tiles; the retired `?view=`/`?panel=` params feed a permanent
  // translation shim (`?view=X` → `single:X`, `?view=X&panel=Y` →
  // `split-h:X,Y`) so old deep links never break. Resolution (URL > per-window
  // localStorage > default-view hint > `single:tty`, with tile-by-tile
  // availability degradation) lives in the pure `resolveLayout`. The search
  // params are read with `strict:false` because AppShell also mounts on
  // `/$server` (no window) — a non-strict read returns `undefined` there
  // rather than throwing. The router module registration
  // (`validateTerminalSearch` in lib/router-url.ts) types `.view`/`.panel`/
  // `.layout`, so no casts are needed.
  const search = useSearch({ strict: false });
  const searchView = search.view;
  const searchPanel = search.panel;
  // The host-level code-server signal (260811-k3vp; portless since
  // 260811-a2bo) — `reachable` gates only the surface CONTENT (passed to
  // CodeSurface below); availability is gitRoot-derived (hasCode). `null` = no
  // signal yet (treated as not-running until the first event lands).
  const codeServer = useCodeServer();
  const currentViews = useMemo(
    () => availableViews(effectiveWindow),
    [effectiveWindow],
  );

  // The URL's EFFECTIVE layout candidate: a carried `?layout=` wins; absent
  // that, the legacy params translate through the shim. Compared against the
  // serialized resolved layout for the replaceState mirror below.
  const searchLayout = search.layout ?? translateLegacyParams(searchView, searchPanel);
  const storedLayout = windowParam ? readStoredLayout(server, windowParam) : undefined;
  const layout = useMemo(
    () => resolveLayout(searchLayout, storedLayout, effectiveWindow),
    [searchLayout, storedLayout, effectiveWindow],
  );
  const serializedLayout = serializeLayout(layout);
  // The lens model's consumers (view-cycle chord, palette `View:` actions)
  // key off slot A — R12's shim: a
  // multi-tile layout reflects slot A's surface; selecting a view collapses
  // to `single:<view>` (see `switchView`).
  const resolvedView: ViewName = layout.order[0];

  // One-time migration seeding (R2): when no `rk-layout:` key exists for the
  // window, translate the legacy `runkit-window-view`/`runkit-window-panel`
  // keys into the equivalent layout value. Declared BEFORE the mirror effect
  // so seeding lands first within a commit (effects run in order).
  useEffect(() => {
    if (windowParam) seedLayoutFromLegacy(server, windowParam);
  }, [server, windowParam]);

  // Seed rule (if5d R2): the first time the code surface actually renders for a
  // window, the LIVE derivation latches — and derivation never moves the editor
  // again (not on a pane switch, not on tile close/reopen, not on reload). Keyed
  // on the resolved layout's order, the choke point every entry path (view
  // switcher, rail toggle, `?view=code`/`?layout=` deep link, mobile sheet)
  // resolves through — never on availability alone: a code lens that is merely
  // OFFERED seeds nothing. An empty derivation seeds nothing either, so a window
  // that was never inside a repo behaves exactly as it did before the latch.
  const codeTileOpen = layout.order.includes("code");
  useEffect(() => {
    if (latchedCodeFolder || !codeTileOpen) return;
    latchCodeFolder(derivedGitRoot);
  }, [latchedCodeFolder, codeTileOpen, derivedGitRoot, latchCodeFolder]);

  // Mirror the APPLIED layout into the URL via replaceState (L2 — never
  // pushState for layout changes), so the address bar is at all times a valid
  // deep link to what is on screen. The window's DEFAULT layout (`hintLayout`
  // — `single:tty`, or `single:web` for a legacy iframe window) mirrors as a
  // CLEAN URL with the param dropped: the retired `?view=` convention ("tty
  // DROPS the param") carried forward, so bare internal-nav URLs stay bare
  // and history/bookmark noise stays zero for the overwhelmingly common
  // default case (a bare URL IS the deep link to the default). Only when the
  // URL's RAW `layout` param differs from the desired one (a carried legacy
  // `view`/`panel` shim input must ALSO be rewritten — R2's "the URL is
  // rewritten via replaceState" — which is why the comparison keys off
  // `search.layout`, not the translated `searchLayout`) — otherwise this
  // effect would navigate every render. Gated on `currentWindow` so a cold
  // deep link is NOT clobbered by the pre-snapshot frame (capabilities
  // unknown → everything degrades to tty). The stored value is re-read
  // post-seed so a just-migrated legacy window mirrors its SEEDED layout, not
  // the pre-seed fallback. localStorage is deliberately NOT written here —
  // arrival via a carried `?layout=` is not a user mutation (L3).
  // Resolves against the LATCHED window (if5d) for the same reason the render
  // does: keying the mirror off the live derivation would degrade a latched code
  // tile away and rewrite the URL the moment the active pane left the repo.
  useEffect(() => {
    if (!windowParam || !effectiveWindow) return;
    const target = serializeLayout(
      resolveLayout(searchLayout, readStoredLayout(server, windowParam), effectiveWindow),
    );
    const desired =
      target === serializeLayout(hintLayout(effectiveWindow)) ? undefined : target;
    if (search.layout === desired) return;
    navigate({
      to: "/$server/$window",
      params: { server, window: windowParam },
      search: desired ? { layout: desired } : {},
      replace: true,
    });
  }, [server, windowParam, effectiveWindow, search.layout, searchLayout, navigate]);

  // The ONE mutation path (R3 write discipline — user-initiated mutations
  // only): persist per-window in localStorage AND mirror the URL via
  // replaceState (the mirror's default-drops-param rule applies here too — a
  // mutation BACK to the window's default, e.g. closing the last non-tty
  // tile, leaves a clean URL; localStorage still records the choice). Tile
  // verbs, rail toggles, the view-cycle chord, and the palette `View:` actions
  // all funnel through this. Stable across SSE ticks.
  const applyLayout = useCallback(
    (next: Layout) => {
      if (!windowParam) return;
      writeStoredLayout(server, windowParam, next);
      const serialized = serializeLayout(next);
      const isDefault = serialized === serializeLayout(hintLayout(currentWindow));
      navigate({
        to: "/$server/$window",
        params: { server, window: windowParam },
        search: isDefault ? {} : { layout: serialized },
        replace: true,
      });
    },
    [server, windowParam, currentWindow, navigate],
  );

  // Rail visibility (260812-nm4p, reinterpreted under 260812-ab5v): the
  // top-bar rail toggle — the sidebar toggle's far-right mirror — collapses
  // the RAIL COLUMN ONLY. Layout tiles live in the content column and are
  // deliberately unaffected: each tile carries its own ✕ verb, and the
  // palette/chords stay live while the rail is hidden, so nothing is ever
  // dead. The pre-layout "collapse closes the open panel" rule is retired
  // with the panel slot itself; visibility is the raw persisted preference.
  const rightAreaVisible = railOpen;
  const onToggleRail = useCallback(() => {
    setRailOpen(!railOpen);
  }, [railOpen, setRailOpen]);

  // Switch the current window's lens (window-view spec R2/R7) — R12's shim:
  // selecting a view sets the layout to `single:<view>` through the shared
  // mutation path (a user mutation — persisted + mirrored). Never mutates
  // `@rk_type` (that is substrate state, not view state).
  const switchView = useCallback(
    (view: ViewName) => applyLayout({ shape: "single", order: [view] }),
    [applyLayout],
  );

  // Rail/palette surface toggle (right-panel P1/P6, retargeted to tiles in
  // 260812-ab5v): an OPEN surface closes its tile (closeSurface — arity
  // collapses), a closed one appends a tile (addSurface — 1→2 `split-h`,
  // 2→3 `main-left`). A disallowed mutation (closing the last tile, adding a
  // fourth) is a null no-op. Stable across SSE ticks.
  const togglePanel = useCallback(
    (surface: SurfaceName) => {
      const next = layout.order.includes(surface)
        ? closeSurface(layout, surface)
        : addSurface(layout, surface);
      if (next) applyLayout(next);
    },
    [layout, applyLayout],
  );

  // The surfaces the current window can tile (`tty` first — R8's shared
  // registry), consumed by the rail and the palette gating.
  const panelSurfaces = useMemo(
    () => availableSurfaces(effectiveWindow),
    [effectiveWindow],
  );

  // ⏶ Zoom palette seam (T012/R11): the zoom itself is SurfaceLayout-internal
  // transient state (R6 — no URL/localStorage); the palette's `Layout: Zoom`/
  // `Layout: Unzoom` entries need to OBSERVE it (label gating) and TRIGGER it
  // (the slot-A toggle). The component registers its toggle into this ref and
  // reports flips through `onZoomChange`, so the palette list rebuilds on every
  // zoom change. Not lifted: keying SurfaceLayout per window keeps the reset
  // semantics where the state lives.
  const layoutZoomToggleRef = useRef<(() => void) | null>(null);
  const [layoutZoomed, setLayoutZoomed] = useState(false);

  // Mobile slot-A tab state (T014/R13): below `isMobileViewport()` the center
  // renders ONE tile; the bottom-bar ▦ chip's sheet tabs swap WHICH surface
  // that is. This is TRANSIENT local state — the shared layout is never
  // mutated (it stays desktop's arrangement; no URL/localStorage write, the
  // same discipline as zoom). Resets on a window switch; a surface that left
  // the layout falls back to slot A.
  const [mobileSlotA, setMobileSlotA] = useState<SurfaceName | null>(null);
  useEffect(() => setMobileSlotA(null), [server, windowParam]);
  const mobileActiveTile: SurfaceName =
    mobileSlotA && layout.order.includes(mobileSlotA)
      ? mobileSlotA
      : layout.order[0];

  // Focused tile (260812-wfic R2/R8): SurfaceLayout owns the focused SLOT as
  // transient state (the zoom precedent — the per-window reset comes free
  // from its `${server}:${windowId}` key) and reports the focused KIND up via
  // `onFocusedKindChange`; the shell mirrors only the kind — it's all the
  // `ttyOnly` dispatcher gate and the `Layout: Focus <Surface>` palette
  // entries need. On mobile the single VISIBLE slot counts as focused (the
  // sheet-tab selection), so the split chords fire only when the shown tile
  // is tty. `focusTileRef` is the palette's focus-by-kind seam (the
  // `zoomToggleRef` pattern). Until the component reports (first render,
  // window switch), slot A is the fallback — never a hardcoded tty guess, so
  // a persisted layout with a non-tty slot A can't briefly enable the split
  // chords. The reset effect mirrors `mobileSlotA` above.
  const [reportedFocusedKind, setReportedFocusedKind] = useState<SurfaceKind | null>(null);
  useEffect(() => setReportedFocusedKind(null), [server, windowParam]);
  const focusedTileKind: SurfaceKind = isMobile
    ? mobileActiveTile
    : (reportedFocusedKind ?? layout.order[0]);
  const layoutFocusTileRef = useRef<((kind: SurfaceKind) => void) | null>(null);

  // The effective keybinding map (260730-g40a): drives the migrated `⌘.` lens
  // cycle below, the shifted-tier dispatch mount (see the `useKeybindingDispatch`
  // call further down, after the palette actions it reuses), the shortcuts
  // overlay, and the palette `shortcut` hints.
  const keybindings = useKeybindings();
  const { byAction: bindingByAction, host: bindingHost } = keybindings;

  // Chord-reclaim predicate for the code surface's iframe (keyboard-capture
  // spike, intake k3vp §5; tty-scoped carve-out 260812-wfic R9): a keydown
  // inside the same-origin code-server iframe is reclaimed exactly when it
  // matches an ENABLED NON-`ttyOnly` registry binding — so run-kit's chords
  // (palette, view-cycle, panel-toggle, …) survive iframe focus while both
  // the embedded app's OWN Ctrl/⌘ chords AND the tmux-pane split pair (a
  // keydown inside the iframe means the code tile owns focus) pass through
  // to code-server's keybinding service.
  const reclaimChord = useCallback(
    (e: KeyboardEvent) => hasReclaimableMatch(e, keybindings.bindings),
    [keybindings.bindings],
  );

  // `Cmd/Ctrl+.` cycles the current window's lenses (Constitution V — every view
  // action is keyboard-reachable; palette parity is the `View:` actions above).
  // The chord comes from the registry (`view-cycle`, default ⌘. — a free binding
  // in the `⌘<punctuation>` family; `Ctrl+.` is inert in readline, unlike
  // `Ctrl+/`→undo or `Ctrl+<letter>` control chars) and is per-device
  // rebindable. Kept at its own listener (not the shifted-tier dispatcher):
  // its enablement is lens-local state. Window-level with `preventDefault()` so
  // xterm doesn't also receive it; input gating is the shared
  // `shouldSuppressChord` predicate. The live view/window values and binding are
  // read via refs so the listener is stable across SSE ticks.
  const viewCycleRef = useRef<{ views: ViewName[]; active: ViewName }>({
    views: currentViews,
    active: resolvedView,
  });
  viewCycleRef.current = { views: currentViews, active: resolvedView };
  const viewCycleBindingRef = useRef(bindingByAction.get("view-cycle"));
  viewCycleBindingRef.current = bindingByAction.get("view-cycle");
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const binding = viewCycleBindingRef.current;
      if (!binding?.enabled || !matchesCombo(e, binding)) return;
      if (shouldSuppressChord(e.target)) return;
      const { views, active } = viewCycleRef.current;
      const next = nextView(views, active); // null when nothing to cycle
      if (!next) return;
      e.preventDefault();
      switchView(next);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [switchView]);

  // The docked compose strip is a single global surface (260718-dhdj) rendered
  // at one of two docks (260813-j3jb — inside the first tty tile on the desktop
  // terminal route, else the shell footer above `<BottomBar>`; the dock
  // predicate lives beside the mount sites below); its enablement is the
  // persisted `composeStripEnabled` chrome preference, toggled by the `>_` chip
  // and the `View: Text Input` palette action. No per-terminal compose-open
  // state.
  const [scrollLocked, setScrollLocked] = useState(false);
  // Server create/kill dialogs + the merged palette list (260811-239r): both
  // dialogs mount ONCE in AppLayout (`ServerDialogs`); this route shell only
  // consumes the triggers (sidebar/palette call sites) and the open-state (the
  // dialogOpenRef gating predicate below). For id-resolution seams the route
  // subscribes to the GLOBALS-ONLY channel (`usePaletteGlobals`) and resolves
  // against `[...paletteActions, ...paletteGlobals]` — both sides fresh THIS
  // render, no slot lag — while macro invocation uses the imperative
  // `getAllActions` at call time. Routes never subscribe to the merged route
  // state they publish into (render-loop guard; see palette-actions-context).
  const {
    openCreateServer,
    requestKillServer,
    createServerOpen,
    killServerTarget,
  } = useServerDialogs();
  const { getAllActions } = usePaletteActionsApi();
  const paletteGlobals = usePaletteGlobals();
  const [showTmuxCommands, setShowTmuxCommands] = useState(false);
  const [showCreateSessionAtFolderDialog, setShowCreateSessionAtFolderDialog] = useState(false);
  const [showCreateWindowAtFolderDialog, setShowCreateWindowAtFolderDialog] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState<"session" | "window" | null>(null);
  const [showCreateIframeDialog, setShowCreateIframeDialog] = useState(false);
  // The spawn-agent dialog's target is explicit `{server, session}` state (not a
  // boolean): the sidebar bot button can target ANY listed session on ANY server
  // (cross-server spawn), while the palette/window-switcher pass the CURRENT
  // `{server, sessionName}`. `null` = closed.
  const [spawnAgentTarget, setSpawnAgentTarget] = useState<{ server: string; session: string } | null>(null);
  const [iframeWindowName, setIframeWindowName] = useState("");
  const [iframeWindowUrl, setIframeWindowUrl] = useState("");

  const { removeGhost, addGhostSession } = useOptimisticContext();
  const { addToast } = useToast();
  const addGhostWindowStore = useWindowStore((s) => s.addGhostWindow);
  const removeWindowGhost = useWindowStore((s) => s.removeGhost);
  const setWindowsForSession = useWindowStore((s) => s.setWindowsForSession);
  const clearSession = useWindowStore((s) => s.clearSession);
  const ghostWindowIdRef = useRef<string | null>(null);
  const ghostSessionIdRef = useRef<string | null>(null);

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

  // Browser-title host label: the instance display name (settings override
  // when set, else the health hostname) from the root InstanceNameProvider —
  // the provider owns the one-shot health fetch, and a settings-dialog rename
  // retitles the tab live (o7q8).
  const { displayName: instanceDisplayName } = useInstanceName();
  useBrowserTitle(sessionName, windowParam, instanceDisplayName);

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
  // We record the intent here keyed on `{server, windowId}` (rework H1: `@N`
  // ids are only unique PER SERVER and AppShell persists across `$server`
  // changes, so the server is part of identity — but never the session name:
  // a rename/cross-session move with `@N` preserved keeps the intent alive)
  // and suppress the writeback while the URL still matches BOTH fields.
  // CONFIRMATION is event-driven: the intent clears the instant SSE confirms
  // it (this is NOT the removed 3s wall-clock debounce). FAILURE detection is
  // the one timer in the design (260715-38kg): each pending switch also arms a
  // single CONFIRMATION_WINDOW_MS bounce timer (`beginPendingSwitch`) so a
  // silent selectWindow failure can't park the intent in limbo forever.
  const pendingClickRef = useRef<PendingSwitchTarget | null>(null);

  // Latest flattened window order + current window id, for the window-switch
  // slide transition (260703-l4nf). Held in a ref (synced at render time,
  // below) so `navigateToWindow` can read the current order WITHOUT taking
  // `flatWindows`/`windowParam` as deps — those churn every SSE tick and would
  // recreate the callback (and defeat the sidebar-handler memoization) each
  // tick. `order` is the flattened window-id list (sidebar order); `ungatedIds`
  // marks targets that will render a NON-tty lens (web iframe or chat) — those
  // have no xterm first-write receipt seam, so they use the ungated capture (the
  // first-paint gate is terminal-only). Read only on a click, after render, so
  // no TDZ concern.
  const switchTransitionRef = useRef<{
    order: string[];
    ungatedIds: Set<string>;
    currentWindowId: string;
  }>({ order: [], ungatedIds: new Set(), currentWindowId: "" });

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
        // Cross-window redirect (the current window died): clear `?view=chat`
        // so the fallback window resolves its OWN view pref (260714-r7rq) rather
        // than inheriting the dead window's chat state.
        search: {},
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

  // Live refs to tmux's actual active window, the URL's window param, and the
  // route's server, read by the failure bounce-back (260715-38kg) inside the
  // confirmation-timer callback without stale closures. The server ref is part
  // of the H1 cross-server identity guard: a timer armed on serverA must
  // recognize that the route has moved to serverB even when the window-id
  // STRING coincides (`@N` is only unique per server).
  const activeWindowRef = useRef(activeWindow);
  activeWindowRef.current = activeWindow;
  const windowParamRef = useRef(windowParam);
  windowParamRef.current = windowParam;
  const serverRef = useRef(server);
  serverRef.current = server;

  // Pending-switch tracking (260715-38kg): the confirmation timer + the grace
  // mask's cancel fn, so both tear down together when the switch confirms,
  // supersedes, or fails. A single `setTimeout` per pending switch (NOT a poll).
  const pendingSwitchRef = useRef<{
    timer: ReturnType<typeof setTimeout>;
    cancelMask: (() => void) | null;
  } | null>(null);

  // Clear the confirmation timer + grace-mask cancel for the current pending
  // switch (called on SSE-confirm, supersession, or bounce). Does NOT itself
  // clear `pendingClickRef` — the writeback owns that on confirm; the bounce
  // clears it explicitly.
  const clearPendingSwitchTracking = useCallback(() => {
    const tracked = pendingSwitchRef.current;
    if (!tracked) return;
    clearTimeout(tracked.timer);
    tracked.cancelMask?.();
    pendingSwitchRef.current = null;
  }, []);

  // Failure bounce-back (260715-38kg): the switch never confirmed (explicit POST
  // rejection or the confirmation-window timeout). Un-stick the limbo — clear
  // the pending intent so the URL/heading follow tmux truth, tear down any mask,
  // surface a lightweight toast, and (since a stale `activeWindow` won't retrigger
  // the writeback effect) navigate explicitly to tmux's actual active window.
  // Guarded on the intent STILL targeting `windowId`: a newer navigation that
  // already superseded this switch must not be bounced.
  const bouncePendingSwitch = useCallback(
    (target: PendingSwitchTarget) => {
      // Identity is `{server, windowId}` (rework H1): the intent must still
      // record exactly this switch — a windowId-only match false-positives on
      // cross-server `@N` collisions.
      if (!isSamePendingTarget(pendingClickRef.current, target.server, target.windowId))
        return;
      // Recorded-server mismatch (rework H1): the route has moved to a DIFFERENT
      // server since this switch was armed (AppShell does not remount across
      // `$server` changes, so a stale timer can survive in principle). The
      // server-change teardown effect normally clears this first — defense-in-
      // depth: drop the stale intent and its feedback silently. NEVER toast or
      // navigate for a switch on a server the user has left.
      if (serverRef.current !== target.server) {
        pendingClickRef.current = null;
        clearPendingSwitchTracking();
        abandonSwitchFeedback();
        return;
      }
      // The bounce only applies while the URL still shows the failed target
      // (rework F1). If the user has left the terminal route (Cockpit/board/
      // windowless /$server) or moved to another window, the teardown effects
      // below clear this timer — this guard is defense-in-depth so a straggler
      // callback can never navigate the user back off their chosen route or
      // toast about a switch they abandoned.
      if (windowParamRef.current !== target.windowId) return;
      const active = activeWindowRef.current;
      // SSE already reports the target ACTIVE — the switch DID confirm, but the
      // writeback (the normal event-driven clearer) can be suppressed for the
      // whole confirmation window (`dialogOpenRef` — e.g. a dialog held open
      // >5s over a confirmed switch; rework SF7). Not a failure: clear the
      // intent silently — no toast, no navigation under the dialog.
      if (active?.windowId === target.windowId) {
        pendingClickRef.current = null;
        clearPendingSwitchTracking();
        confirmSwitchArrived();
        return;
      }
      clearPendingSwitchTracking();
      pendingClickRef.current = null;
      // Abandon, don't just unmask (rework G2): a fast POST rejection can land
      // INSIDE the 300ms budget with the gate still pending — a bare
      // tearDownMask would let that gate's timer fire moments later and re-arm
      // the mask over the bounced-back window with no lift path (the POST
      // rejected, so liftAccepting never opens). Settling the gate too makes
      // the bounce final.
      abandonSwitchFeedback();
      if (active) {
        // `target.server` — verified equal to the CURRENT route server above,
        // so the callback needs no `server` closure dep (H1: no stale-server
        // navigation is expressible from here).
        navigate({
          to: "/$server/$window",
          params: { server: target.server, window: active.windowId },
          search: {},
          replace: true,
        });
      }
      addToast("Window switch didn't confirm — back to the active window", "error");
    },
    [navigate, addToast, clearPendingSwitchTracking],
  );

  // Begin tracking a pending switch: record the `{server, windowId}` intent
  // (rework H1 — window ids are only unique per server), arm the confirmation
  // timer, and (for a gated tty target on the instant-switch path) arm the grace
  // mask. Bounces on explicit POST rejection OR the confirmation-window timeout —
  // NEVER merely because SSE still reports the old window (normal mid-switch).
  const beginPendingSwitch = useCallback(
    (
      target: PendingSwitchTarget,
      opts: { posted?: Promise<unknown>; graceMask?: boolean } = {},
    ) => {
      pendingClickRef.current = { server: target.server, windowId: target.windowId };
      // Supersede any prior pending switch's tracking (its timer/mask).
      clearPendingSwitchTracking();
      // A fresh switch owns ALL feedback: proactively clear a mask/grace timer a
      // prior TIMED-OUT switch left showing (module state — the
      // clearPendingSwitchTracking above only cancels the tracked entry's own
      // timer/handle, never the module mask). The gated paths get this via armGraceMask/
      // beginWindowSwitchGate; the two gateless paths (mount-time cold deep-link
      // alignment, waiting-target navigation) otherwise leave the stale mask up
      // until SSE confirmation. Deliberately the BARE teardown, NOT
      // abandonSwitchFeedback: on the animated path this runs (via
      // beginWindowSwitchGate → startViewTransition → runSwitch) while the
      // switch's OWN just-opened gate is current, and settling it would skip the
      // earned slide (260715-38kg R8). Idempotent no-op when nothing is showing.
      tearDownMask();
      const grace = opts.graceMask ? armGraceMask() : null;
      if (grace) {
        // Post-POST lift filter (rework F3): only once the switch's selectWindow
        // POST resolves may incoming bytes cancel the grace timer / lift the
        // mask — a busy OUTGOING window's bytes ride the same socket and must
        // not un-mask stale content. Mirrors the gate's chained openForNotify.
        void opts.posted?.then(() => grace.openForLift()).catch(() => {});
      }
      // The timer closure carries the full `{server, windowId}` identity so the
      // bounce can verify BOTH fields against the live route (H1).
      const timer = setTimeout(() => bouncePendingSwitch(target), CONFIRMATION_WINDOW_MS);
      const tracked = { timer, cancelMask: grace ? grace.cancel : null };
      pendingSwitchRef.current = tracked;
      // Explicit rejection bounces immediately (don't wait out the window) —
      // but ONLY while THIS tracking entry is still current (rework SF8): a
      // re-click of the same row supersedes this entry, and the superseded
      // POST's late rejection must not bounce the healthy successor switch.
      // Identity is the tracked object itself (the gate's still-points-at-
      // itself pattern) — a windowId key alone cannot tell the two apart.
      opts.posted?.catch(() => {
        if (pendingSwitchRef.current === tracked) bouncePendingSwitch(target);
      });
    },
    [clearPendingSwitchTracking, bouncePendingSwitch],
  );

  // Route-leave teardown (rework F1, must-fix): leaving the terminal leaf while
  // a switch is pending must abandon the switch, not park a live 5s bounce. On
  // the windowless `/$server` (SessionTiles) the writeback effect can early-
  // return (`!activeWindow || !sessionName`), so without this the timer would
  // fire with frozen refs and navigate the user BACK to a stale terminal route
  // with a spurious failure toast — even when the switch actually succeeded.
  // `abandonSwitchFeedback` (not a bare tearDownMask — rework G2) also settles
  // a still-pending gate, whose timer could otherwise re-mask up to 300ms
  // after the leave.
  useEffect(() => {
    if (windowParam) return;
    pendingClickRef.current = null;
    clearPendingSwitchTracking();
    abandonSwitchFeedback();
  }, [windowParam, clearPendingSwitchTracking]);

  // Unmount teardown (rework F1): navigating to the Cockpit `/` or a board
  // route unmounts AppShell, but the confirmation timer (a setTimeout closure)
  // and the module-level mask state + pending gate outlive the component
  // instance. Abandon both (rework G2: a bare tearDownMask would leak a
  // re-masking gate timer into the next mount) so no straggler bounce or
  // leftover mask greets it. `clearPendingSwitchTracking` is a stable
  // useCallback, so this cleanup runs only at actual unmount.
  useEffect(
    () => () => {
      clearPendingSwitchTracking();
      abandonSwitchFeedback();
    },
    [clearPendingSwitchTracking],
  );

  // Server-change teardown (rework H1, must-fix): window ids (`@N`) are only
  // unique PER SERVER, and AppShell persists across `$server` route changes
  // WITHOUT remounting — a cross-server navigation to a colliding id (serverA
  // pending @5 → serverB's @5) keeps `windowParam` the same string, so neither
  // the route-leave nor the unmount teardown fires. Abandon the previous
  // server's pending switch here: its timer closure, gate, and mask all
  // describe a window that no longer means the same thing. DECLARED BEFORE the
  // alignment effect (effects run in declaration order within a commit) so the
  // alignment skip sees a cleared intent and serverB's tmux alignment fires.
  // A prev-ref makes this a no-op on mount and fires it only on actual change.
  const prevServerRef = useRef(server);
  useEffect(() => {
    if (prevServerRef.current === server) return;
    prevServerRef.current = server;
    pendingClickRef.current = null;
    clearPendingSwitchTracking();
    abandonSwitchFeedback();
  }, [server, clearPendingSwitchTracking]);

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
      // A click-driven switch already recorded THIS exact intent (rework G1,
      // must-fix): every optimistic click navigation re-fires this effect with
      // SSE still stale (`activeId !== windowParam` one commit after a click),
      // and re-tracking here would fire a DUPLICATE selectWindow POST and —
      // worse — `beginPendingSwitch`'s supersession would cancel the click's
      // just-armed grace mask, making the instant-path mask dead in the live
      // app. This effect's tracking is for the COLD deep-link only, where no
      // click recorded an intent. The match is server-scoped (rework H1): a
      // stale intent from ANOTHER server with a colliding `@N` must not
      // suppress THIS server's alignment (the server-change teardown above
      // normally clears it first; this comparison is the correctness seam).
      if (isSamePendingTarget(pendingClickRef.current, server, windowParam)) return;
      // Deep-link to a window that is NOT tmux's current active window: record
      // a pending intent on `@N` (same mechanism as a sidebar click) so the URL
      // writeback below does NOT bounce us back to the currently-active window
      // before tmux confirms the alignment. Without this, a cold deep-link to
      // `/$server/@N` would flicker to the active window and unmount the
      // terminal. The intent clears the instant SSE reports `@N` active.
      // The confirmation timer + rejection bounce (260715-38kg) un-stick a
      // silent-failure limbo where the alignment POST fails or never confirms;
      // no grace mask here — a cold deep-link mounts a fresh terminal (a
      // connecting pane, not stale bytes).
      const posted = selectWindow(server, windowParam);
      posted.catch(() => {});
      beginPendingSwitch({ server, windowId: windowParam }, { posted });
    }
  }, [server, windowParam, currentSession, activeWindow, beginPendingSwitch]);

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
      // Match on `{server, windowId}` — never the session name (a rename or
      // cross-session move that preserves `@N` must NOT release the suppression
      // early), and never the window id alone (rework H1: `@N` is only unique
      // per server, so a stale intent from another server with a colliding id
      // must neither suppress the writeback nor read as confirmed — it falls
      // into the `!urlMatchesPending` clear-and-abandon branch below).
      const urlMatchesPending = isSamePendingTarget(pending, server, windowParam);
      const sseConfirmed = isSamePendingTarget(pending, server, activeWindow.windowId);
      if (sseConfirmed || !urlMatchesPending) {
        pendingClickRef.current = null;
        // The switch resolved (confirmed, or superseded by a newer nav): stop
        // tracking so the confirmation timer never fires a spurious late bounce
        // and any grace mask's cancel is released (260715-38kg).
        clearPendingSwitchTracking();
        // SSE confirmation is the AUTHORITATIVE "arrived" signal — settle any
        // still-pending gate as first-write and lift any mask (260715-38kg). The
        // receipt-time `notifyFirstWrite` lift covers the common case, but on a
        // same-session switch tmux's redraw can complete BEFORE the gate's
        // `openForNotify` (so those bytes were filtered out as outgoing), leaving
        // no later write to fire the lift; the gate would then time out and arm
        // the mask even though the switch DID land. `confirmSwitchArrived` cancels
        // that pending timeout AND clears any mask already showing.
        //
        // UNCONFIRMED clear (`!urlMatchesPending` — browser Back/Forward away
        // from a pending target; rework SF5): abandon the switch's feedback —
        // if its POST failed, an armed mask has no other lift path, and a
        // still-pending gate must not re-mask the destination.
        if (sseConfirmed) confirmSwitchArrived();
        else abandonSwitchFeedback();
      } else {
        return; // intent outstanding — let the URL stand
      }
    }
    if (activeWindow.windowId === windowParam) return;
    navigate({
      to: "/$server/$window",
      params: { server, window: activeWindow.windowId },
      // Window switch driven by tmux (SSE writeback): clear `?view=chat` so the
      // newly-active window resolves its own view pref (260714-r7rq).
      search: {},
      replace: true,
    });
  }, [activeWindow, sessionName, windowParam, navigate, server, clearPendingSwitchTracking]);

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
      // Same-window no-op click (rework G3, must-fix): the target is BOTH the
      // URL window AND tmux's active window (a mobile drawer dismissal tap, the
      // palette's "(current)" entry). Nothing will change — tmux emits no bytes
      // and the event-driven SSE snapshot never re-confirms — so arming the
      // pending-switch machinery would guarantee a spurious spinner mask at
      // 300ms over the very terminal the user is on, plus a false failure
      // toast at the confirmation window. Keep the ergonomic drawer close;
      // arm nothing (pre-change behavior: inert).
      if (
        isRedundantSwitch(windowId, windowParamRef.current, activeWindowRef.current?.windowId)
      ) {
        if (isMobile) setSidebarOpen(false);
        return;
      }

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
      // `graceMask` arms the ~300ms grace mask (260715-38kg) — only on the
      // INSTANT-switch fallback (no VT render-freeze phase, so no gate to time
      // out). The animated path leaves it false: the gate's `"timeout"` settle
      // arms the mask there instead (via `settleGate`).
      const runSwitch = (graceMask: boolean): Promise<unknown> => {
        navigate({
          to: "/$server/$window",
          params: { server, window: windowId },
          // Window switch (sidebar/palette click): clear the `?view=` param so
          // the target window resolves its OWN view (localStorage + default
          // hint), not the outgoing window's. Same-window lens switches go
          // through `switchView`, which sets the param explicitly.
          search: {},
          // PUSH (no `replace`): a user-initiated window switch IS a
          // navigation, so it creates a history entry the top-bar ◀ ▶ arrows
          // can retrace (260715-m4xy). No dedup — w1→w5→w1 pushes three
          // entries and Back retraces every hop. The two tmux/preference-driven
          // navigates that MUST stay `replace` are the SSE URL-writeback effect
          // (tmux corrections aren't user intent) and `switchView` (per-viewer
          // lens toggles) — do not add `replace` back here.
        });
        const posted = selectWindow(server, windowId);
        posted.catch(() => {}); // ignore errors (fire-and-forget)
        // Record the pending intent + arm the confirmation timer (and, on the
        // instant path, the grace mask). Bounces on explicit POST rejection or
        // the confirmation-window timeout — un-sticking the silent-failure limbo.
        beginPendingSwitch({ server, windowId }, { posted, graceMask });
        if (isMobile) setSidebarOpen(false);
        return posted;
      };

      // Window-switch slide transition (260703-l4nf). Gate on: View Transitions
      // support, motion not reduced, an outgoing window in view, and a slide
      // direction resolvable from the flattened sidebar order. Any failure →
      // the instant switch above (progressive enhancement).
      const { order, ungatedIds, currentWindowId } = switchTransitionRef.current;
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
        // Instant-switch fallback (no VT support, reduced motion, no outgoing
        // window, or no direction). Arm the grace mask for a gated (tty) target
        // — non-tty (web/chat) targets stay mask-less, matching the gated path.
        const { ungatedIds } = switchTransitionRef.current;
        const targetUngated = ungatedIds.has(windowId);
        // A fresh switch owns ALL feedback. A leftover ARMED mask is now
        // cleared by `beginPendingSwitch`'s fresh-switch teardown (via
        // `runSwitch` below — 260719-h0x4); this call's remaining unique value
        // is settling a still-PENDING prior gate as "superseded" so its later
        // timeout cannot re-mask the new non-tty view (the bare teardown
        // deliberately never touches the gate — the animated path reaches it
        // with its OWN gate current). Without this, an animated switch
        // superseded within its 300ms budget by this ungated instant path
        // would re-mask a view whose semantics are "non-tty targets stay
        // mask-less".
        if (targetUngated) abandonSwitchFeedback();
        runSwitch(!targetUngated);
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
      // Non-tty targets (web iframe, chat) have no such receipt seam, so they
      // use the ungated capture.
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
      // NOTE: this call is load-bearing on BOTH paths, including the ungated path
      // below — it fires a prior PENDING terminal gate (a terminal→non-tty switch
      // supersedes an in-flight terminal gate), so it must run before we branch
      // on `targetUngated`.
      //
      // A target is ungated (web iframe or chat) exactly when its EFFECTIVE
      // resolved view is not `tty` — precomputed into `ungatedIds` at render time
      // (below) from each window's stored view + default hint.
      const targetUngated = ungatedIds.has(windowId);
      // `gated` (tty target) drives the pending mask: only a gated switch's
      // `"timeout"` settle arms the LogoSpinner mask (260715-38kg). A web/chat
      // target is ungated and never masks.
      const gate = beginWindowSwitchGate({ gated: !targetUngated });
      // Capture a monotonic token so only the LATEST switch's cleanup may clear
      // the direction attribute (a superseded transition's `finished` still
      // fulfills — see below).
      const directionToken = nextDirectionToken();
      document.documentElement.dataset.windowSwitchDirection = direction;
      const transition = document.startViewTransition(async () => {
        // Animated path: grace mask stays off — the gate's timeout arms the mask.
        const posted = runSwitch(false);
        if (!targetUngated) {
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
          // The slide is now an EARNED signal (260715-38kg): it plays ONLY when
          // the gate settles `"first-write"` (bytes confirmed within 300ms) —
          // every other settle SKIPS the transition (rework H2/T012). On
          // `"timeout"` that cuts to the (masked, via settleGate) new state so
          // the slide never animates into unconfirmed content. `"superseded"`
          // covers TWO cases: a rapid second switch (the VT spec already skips
          // this transition — the explicit call is a harmless no-op on an
          // already-skipped transition) AND an abandoned/bounced switch
          // (`abandonSwitchFeedback` settles the gate with no successor VT, so
          // WITHOUT the explicit skip the failed switch would animate alongside
          // its failure feedback — slide = confirmed arrival, R8).
          const reason = await gate.waitForFirstWrite();
          if (reason !== "first-write") {
            transition.skipTransition();
          }
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
    [server, navigate, isMobile, setSidebarOpen, beginPendingSwitch],
  );

  // Chat subscription (260717-vhvz — succeeds the dedicated per-view chat SSE) —
  // a single `kind:"chat"` subscription on the shared state socket, owned here so
  // it feeds BOTH the `ChatView` renderer (below) and the connection dot's
  // health (R13).
  // Opened when a chat tile is visible in ANY slot (260812-ab5v — a chat tile
  // outside slot A still needs its stream); a chat-less window never resolves
  // one (the ladder's degradation bakes in the `chatProvider` availability
  // gate), so a terminal-only window never streams.
  const chatViewActive = layout.order.includes("chat");
  const chatStream = useChatSubscription(
    chatViewActive ? server : "",
    chatViewActive ? windowParam ?? "" : "",
  );

  // Dialog state management. The two option callbacks are useCallback-stable:
  // inline arrows would churn the `dialogs` object every render, which cascades
  // through the palette action memos into a per-render slot re-registration
  // (260811-239r — observed as a "Maximum update depth exceeded" storm).
  const handleDialogKillComplete = useCallback(
    () => navigate({ to: "/$server", params: { server }, replace: true }),
    [navigate, server],
  );
  const handleDialogSessionRenamed = useCallback(() => {
    // The route no longer carries a session segment, so a rename needs no
    // navigation when a window is in view — the breadcrumb re-derives the new
    // session name from the next SSE snapshot. Only redirect to the dashboard
    // when no window is selected (nothing to keep us anchored).
    if (!windowParam) {
      navigate({ to: "/$server", params: { server }, replace: true });
    }
  }, [navigate, server, windowParam]);
  const dialogs = useDialogState({
    sessionName,
    windowId: currentWindow?.windowId,
    onKillComplete: handleDialogKillComplete,
    onSessionRenamed: handleDialogSessionRenamed,
  });

  // Keep dialogOpenRef in sync so the activeWindow effect can check it without deps.
  // The server create/kill open-state comes from the layout-owned
  // `server-dialogs-context` (260811-239r) — the dialogs mount in AppLayout now,
  // but gating this route's URL writeback while one is up is unchanged.
  dialogOpenRef.current =
    dialogs.showRenameSessionDialog || dialogs.showKillConfirm || dialogs.showKillSessionConfirm || createServerOpen || killServerTarget != null || showTmuxCommands || showCreateSessionAtFolderDialog || showCreateWindowAtFolderDialog || showCreateIframeDialog || spawnAgentTarget != null;

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
    // A target is UNGATED (ungated capture, no xterm first-write receipt seam)
    // exactly when its effective MAIN SLOT (slot A of the resolved layout,
    // 260812-ab5v) is NOT `tty` — i.e. it renders the IframeWindow (web),
    // ChatView (chat), or CodeSurface (code) surface in its main slot, none of
    // which has the terminal's first-write seam (260714-t97o-web-view-lens R12;
    // chat folded in from 260714-r7rq). The URL `?layout=` param is NOT known
    // for a not-yet-navigated target, so we resolve from localStorage + the
    // window's default hint only (URL passed `undefined`) — honoring BOTH the
    // new `rk-layout:` key and its legacy `runkit-window-view`/`-panel`
    // predecessors via the translation shim (the per-window seeding only runs
    // for the CURRENT window at route entry). `resolveLayout` bakes in
    // availability degradation, so an iframe-typed window with no `rkUrl`, a
    // chat-capable window whose last layout is `single:tty`, or any window
    // whose last layout is tty-led resolves tty-led and STAYS on the gated
    // terminal path — getting this wrong reintroduces the
    // blank-pane/stuck-transition class of bugs (ui-patterns.md §
    // Window-Switch Slide Transition).
    ungatedIds: new Set(
      flatWindows
        .filter(
          (fw) =>
            resolveLayout(
              readStoredLayout(server, fw.window.windowId) ??
                translateLegacyParams(
                  readStoredView(server, fw.window.windowId),
                  readStoredPanel(server, fw.window.windowId),
                ),
              undefined,
              // Latched (if5d) like the current window's own resolution: a
              // window whose code folder is latched still resolves code-led
              // after its active pane leaves the repo, so the classification
              // matches what the target will actually render.
              withLatchedCodeFolder(
                fw.window,
                readLatchedCodeFolder(server, fw.window.windowId),
              ),
            ).order[0] !== "tty",
        )
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
  // the Sidebar/palette consumers that receive it) don't defeat the
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

  // Open the spawn-agent dialog for an explicit `{server, session}` target
  // (260713-sbk1; explicit target since gsmu). The palette `Agent: Spawn` action
  // and the window-switcher `+ New Agent` pass the CURRENT `{server, sessionName}`;
  // the sidebar bot button passes the ROW's `{server, session}` (any server →
  // cross-server spawn). Gated on a resolvable session at the call sites.
  const handleOpenSpawnAgent = useCallback((srv: string, sess: string) => {
    setSpawnAgentTarget({ server: srv, session: sess });
  }, []);

  // Navigate to a freshly-created agent window on `srv`. When `srv` IS the
  // current server, reuse navigateToWindow (its window-switch transition);
  // otherwise route cross-server via the 2-segment /$server/$window URL. Mirrors
  // handleSidebarSelectWindow. Shared by the spawn dialog and the row-flyout fork
  // (260806-s4av) so the two cannot drift.
  const navigateToSpawnedWindow = useCallback(
    (srv: string, windowId: string) => {
      if (srv === server) {
        navigateToWindow(windowId);
        return;
      }
      navigate({ to: "/$server/$window", params: { server: srv, window: windowId } });
      if (isMobile) setSidebarOpen(false);
    },
    [server, navigateToWindow, navigate, isMobile, setSidebarOpen],
  );

  // Fork a window's agent conversation (260806-s4av): a NEW window in the SAME
  // session and directory, resuming that agent's session with --fork-session. The
  // backend derives everything from the windowId, so the client sends nothing but
  // the identity. On success navigate to the fork; a best-effort empty windowId
  // (the backend's display-message resolve failed) skips navigation and lets SSE
  // surface the row, matching the spawn dialog's rule.
  //
  // RETURNS the settle promise (already error-handled here, so it never rejects):
  // the flyout's fork button awaits it to hold its in-flight disabled state, so
  // repeated clicks cannot fire multiple mutating POSTs and create N forks.
  const handleForkWindow = useCallback(
    (srv: string, windowId: string): Promise<void> =>
      forkWindow(srv, windowId)
        .then((res) => {
          if (res.windowId) navigateToSpawnedWindow(srv, res.windowId);
        })
        .catch((err: Error) => addToast(err.message || "Failed to fork conversation", "error")),
    [navigateToSpawnedWindow, addToast],
  );

  const handleCreateIframeWindow = useCallback(() => {
    const name = finalizeSafeName(iframeWindowName.trim());
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

  // The create/kill server flows (useOptimisticAction wrappers, pending/killed
  // markers, post-create/kill navigation) live in the layout-mounted
  // `ServerDialogs` component now (260811-239r) — this shell only triggers
  // them via `openCreateServer`/`requestKillServer` from the context above.

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
            {
              // Keyboard/touch parity for the left-edge label zone (Constitution
              // V): open the combined Label picker (colors + marker) for the
              // current window's sidebar row via the imperative
              // `label-popover:open` event — mirroring the `pin-popover:open`
              // pattern the "Board: Pin Current Window" action uses. One
              // interaction model everywhere (hwtr, replacing "Window: Cycle
              // Marker"); the picker's keyboard nav makes this a complete
              // keyboard path.
              id: "window-label",
              label: "Window: Label",
              onSelect: () => {
                if (!currentWindow) return;
                document.dispatchEvent(
                  new CustomEvent("label-popover:open", {
                    detail: { server, windowId: currentWindow.windowId },
                  }),
                );
              },
            },
            // Operator mark/unmark pair (260813-ifya) — the manual fallback for
            // the `@rk_role=operator` window option: Mark is listed when the
            // current window is NOT the operator, Unmark when it IS. Both POST
            // through the unified /options contract (`setWindowRole`); the
            // write wakes the SSE hub, so the sidebar's pinned row moves on
            // the next snapshot (no client refresh/poll needed).
            ...(currentWindow.role === "operator"
              ? [
                  {
                    id: "window-unmark-operator",
                    label: "Window: Unmark Operator",
                    onSelect: () => {
                      setWindowRole(server, currentWindow.windowId, null).catch((err) =>
                        addToast(err.message || "Failed to unmark operator"),
                      );
                    },
                  },
                ]
              : [
                  {
                    id: "window-mark-operator",
                    label: "Window: Mark as Operator",
                    onSelect: () => {
                      setWindowRole(server, currentWindow.windowId, "operator").catch((err) =>
                        addToast(err.message || "Failed to mark window as operator"),
                      );
                    },
                  },
                ]),
            // NOTE: the old `toggle-iframe-terminal` action (which mutated
            // `@rk_type`) was REPLACED by the `View: Terminal` / `View: Web`
            // actions in `viewActions` (260714-t97o-web-view-lens) — switching a
            // lens is per-viewer view state, never a `@rk_type` mutation.
            // Move up/down — the sole window-move pair (up/down vocabulary
            // parity with the Session/Server/Board Move entries; windows render
            // as vertical sidebar rows). Boundary = hidden, no wraparound.
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
                              // Same-window move (index only): preserve the
                              // current view (260714-r7rq).
                              search: (prev) => prev,
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
                              // Same-window move (index only): preserve the
                              // current view (260714-r7rq).
                              search: (prev) => prev,
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
            // Split direction booleans match the top-bar chip's semantics
            // (260806-2x2h): Horizontal → `horizontal: true` (tmux `-h`,
            // side-by-side), Vertical → `false` (stacked). Horizontal listed
            // first (default-first, mirroring the SplitControl menus).
            {
              id: "split-horizontal",
              label: "Window: Split Horizontal",
              onSelect: () => {
                if (sessionName) executeSplit(server, currentWindow.windowId, true, currentWindow.worktreePath);
              },
            },
            {
              id: "split-vertical",
              label: "Window: Split Vertical",
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
  // Pane Focus) live in BoardPage's own registered route list. Here we provide
  // the entries that make sense from a server route: Switch to <board>, Pin
  // Current Window, and Unpin Current Window when the current window is
  // pinned.
  const { boards: boardSummaries } = useBoards();
  const { pinnedToBoard } = useWindowPins();
  const { pin: pinPinAction, unpin: unpinPinAction } = usePinActions();

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
    // entry is ever annotated `(current)` from this route's list.
    const switchEntries = boardSummaries.map((b) => ({
      id: `board-switch-${b.name}`,
      label: `Board: Switch to ${b.name}`,
      onSelect: () => navigate({ to: "/board/$name", params: { name: b.name } }),
    }));

    const conditional: PaletteAction[] = [];

    if (sessionName && currentWindow && server) {
      const win = currentWindow;
      const srv = server;
      // Direct-pin palette actions (`Pin: Current Window to <board>`) + the
      // `Pin: Current Window to new board…` variant, from the pure
      // buildPinActions builder (lib/palette-pin.ts). These close the
      // Constitution V keyboard-first gap: a direct pin is Cmd+K → type →
      // Enter, with the §2c success toast as feedback. They SUPERSEDE the old
      // inline `board-pin-current` opener — its popover-opening role is now the
      // new-board variant. The new-board variant reuses the existing
      // `pin-popover:open` CustomEvent (only the WindowRow whose
      // (server, windowId) matches handles it) since free-text entry needs the
      // popover (the palette has no value input).
      conditional.push(
        ...buildPinActions(
          boardSummaries,
          currentWindowPinnedBoards,
          readLastPinnedBoard(),
          (board) => pinPinAction(srv, win.windowId, board),
          () =>
            document.dispatchEvent(
              new CustomEvent("pin-popover:open", {
                detail: { server: srv, windowId: win.windowId },
              }),
            ),
        ),
      );

      // Unpin Current Window — visible only when the current window is pinned
      // to ≥1 board. v1 semantics: unpin from ALL boards in parallel (simpler
      // than a multi-board picker; users can re-pin via the popover if needed).
      if (currentWindowPinnedBoards.length > 0) {
        conditional.push({
          id: "board-unpin-current",
          label: "Board: Unpin Current Window",
          onSelect: () => {
            for (const board of currentWindowPinnedBoards) {
              unpinPinAction(srv, win.windowId, board);
            }
          },
        });
      }
    }
    return [...switchEntries, ...conditional];
  }, [boardSummaries, sessionName, currentWindow, server, navigate, currentWindowPinnedBoards, pinPinAction, unpinPinAction]);

  // ── Sidebar window-row multi-select (260807-nf9f) ─────────────────────────
  // The palette is the SOLE action surface for the selection (Constitution IV
  // minimal surface + V ⌘K-primary), so both the merged sweep and the bulk move
  // live here. The sidebar owns the selection GESTURES (cmd/ctrl-click toggle,
  // shift-click range, `x` toggle on the focused row, Escape to clear) and
  // shares the state through `store/selection-store.ts`.
  //
  // Per the project review rule, the new `x` shortcut is DOCUMENTED at this
  // registration seam — not merely in this comment: `SELECTION_GESTURE_HINT`
  // rides the select-all entry's `shortcut` field, which the palette renders as
  // a `<kbd>` badge (see lib/palette-selection.ts). It is deliberately absent
  // from `DEFAULT_BINDINGS`, which is a modifier-chord registry driving a
  // window-level dispatcher — a bare `x` there would hijack the key app-wide
  // rather than inside the focused tree.
  const selectedWindows = useSelectionStore((s) => s.selected);
  const selectOnlySelection = useSelectionStore((s) => s.selectOnly);
  const settleBatchSelection = useSelectionStore((s) => s.settleBatch);
  // A prompt target is a FROZEN snapshot captured when its palette action is
  // selected. It remains aligned with the visible `N selected` label and the
  // eventual settleBatch keys even if the live selection changes while typing.
  const [selectionBroadcastKeys, setSelectionBroadcastKeys] = useState<
    string[] | null
  >(null);

  // Toggling the global strip off cancels selection-target mode. Per-window
  // drafts remain in their module store; only this transient recipient snapshot
  // is cleared.
  useEffect(() => {
    if (!composeStripEnabled && selectionBroadcastKeys !== null) {
      setSelectionBroadcastKeys(null);
    }
  }, [composeStripEnabled, selectionBroadcastKeys]);

  /**
   * Bulk move: N SEQUENTIAL `move-to-session` POSTs against the existing
   * endpoint (no new backend surface, no bulk optimistic machinery — rows
   * repaint from SSE). Continue-on-error: an independent per-window failure
   * must not strand the rest of the batch. On full success the batch's windows
   * are dropped from the selection; on partial (or total) failure exactly its
   * failed windows stay selected as the retry affordance, and one aggregate
   * toast reports the counts plus the first error message.
   *
   * The palette closes before this runs and the batch is fire-and-forget, so a
   * long batch races the user: they can start a WHOLE NEW selection while it is
   * still POSTing. The terminal update therefore RECONCILES against the keys
   * this batch actually owned (`settleBatch`) rather than clobbering the store
   * with `clear()` / `selectOnly(failedKeys)` — those act on whatever the store
   * holds at settle time and would silently destroy the user's new selection.
   * Reconciling (rather than an in-flight lock refusing the second batch) is
   * also the friendlier semantics: two batches over disjoint windows both settle
   * correctly, each touching only its own keys.
   */
  const executeBulkMove = useCallback(
    async (srv: string, keys: string[], targetSession: string) => {
      // Move stays SINGLE-SERVER gated (`singleSelectedServer` omits the
      // entries otherwise), so it deliberately ignores the per-key server and
      // moves every window on `srv` — only the control flow is shared.
      const result = await executeSelectionBatch(keys, ({ windowId }) =>
        moveWindowToSession(srv, windowId, targetSession),
      );
      const { message, failed } = batchToast(
        {
          success: "Moved",
          failure: "Moved",
          noun: "window",
          qualifier: ` to ${targetSession}`,
        },
        keys.length,
        result,
      );
      addToast(message, failed ? "error" : undefined);
      settleBatchSelection(keys, result.failedKeys);
    },
    [addToast, settleBatchSelection],
  );

  /** Close each selected window on its own server, sequentially. */
  const executeBulkClose = useCallback(
    async (keys: string[]) => {
      const result = await executeSelectionBatch(
        keys,
        ({ server: targetServer, windowId }) =>
          killWindow(targetServer, windowId),
      );
      const { message, failed } = batchToast(
        { success: "Closed", failure: "Closed", noun: "window" },
        keys.length,
        result,
      );
      addToast(message, failed ? "error" : undefined);
      settleBatchSelection(keys, result.failedKeys);
    },
    [addToast, settleBatchSelection],
  );

  /**
   * Submit one prompt through the existing chat-send endpoint per recipient.
   * Resolves with the DELIVERED count so the compose strip can retain a prompt
   * that reached nobody (0 of N) instead of clearing text no agent ever saw.
   */
  const executeBulkSend = useCallback(
    async (keys: string[], text: string): Promise<number> => {
      const result = await executeSelectionBatch(
        keys,
        ({ server: targetServer, windowId }) =>
          sendChatMessage(targetServer, windowId, text),
      );
      const { message, failed } = batchToast(
        { success: "Sent prompt to", failure: "Sent to", noun: "agent" },
        keys.length,
        result,
      );
      addToast(message, failed ? "error" : undefined);
      settleBatchSelection(keys, result.failedKeys);
      return keys.length - result.failedKeys.length;
    },
    [addToast, settleBatchSelection],
  );

  const selectionActions: PaletteAction[] = useMemo(() => {
    const actions: PaletteAction[] = [];
    // `Selection: Select all merged (N)` — current-server-scoped (a cross-server
    // selection would dead-end the single-server bulk move below). Omitted, not
    // disabled, when there is no server context or nothing merged.
    const selectAllMerged = buildSelectAllMergedAction(
      server || null,
      sessions,
      selectOnlySelection,
    );
    if (selectAllMerged) actions.push(selectAllMerged);

    // Close/send carry their own server on every selected key, so unlike move
    // they remain eligible for a cross-server selection.
    const closeSelection = buildSelectionCloseAction(
      selectedWindows,
      (keys) => {
        void executeBulkClose(keys);
      },
    );
    if (closeSelection) actions.push(closeSelection);

    const sendPrompt = buildSelectionSendPromptAction(
      selectedWindows,
      (keys) => {
        setSelectionBroadcastKeys(keys);
        if (composeStripEnabled) {
          // The strip is already mounted; focus after React swaps its disabled
          // focused-terminal target for the selection target.
          queueMicrotask(() => focusComposeStrip());
        } else {
          // The normal off→on path marks focus-on-open for the mounting strip.
          toggleComposeStrip();
        }
      },
    );
    if (sendPrompt) actions.push(sendPrompt);

    // `Selection: Move N window(s) to <session>` — one entry per eligible
    // session on the SELECTION's server, which is NOT necessarily the route
    // server: with sessions scope "all" the sidebar paints every server's
    // groups, so a user can select rows on server A while routed to server B.
    // tmux window ids (`@N`) are unique per server only, so feeding the route
    // server's sessions here would list the wrong targets AND move the wrong
    // windows. `singleSelectedServer` is the single source of the server for
    // both the target list and the POSTs below; it returns `null` for an empty
    // or cross-server selection, which omits the entries entirely (tmux cannot
    // move a window across tmux servers).
    const selectionServer = singleSelectedServer(selectedWindows);
    if (selectionServer !== null) {
      // Prefer the merged list when the selection is on the route server (it
      // carries the ghost/rename overlays the sidebar paints); otherwise read
      // that server's raw SSE sessions. `undefined` means the server's sessions
      // have not loaded — offer no targets rather than guessing an empty list,
      // which would render every session as "eligible" against no data.
      const selectionSessions =
        selectionServer === server ? sessions : ctx.sessionsByServer.get(selectionServer);
      if (selectionSessions !== undefined) {
        actions.push(
          ...buildSelectionMoveActions(
            selectionServer,
            selectionSessions,
            selectedWindows,
            (targetSession) => {
              void executeBulkMove(selectionServer, [...selectedWindows], targetSession);
            },
          ),
        );
      }
    }
    return actions;
  }, [
    server,
    sessions,
    ctx.sessionsByServer,
    selectedWindows,
    selectOnlySelection,
    executeBulkMove,
    executeBulkClose,
    composeStripEnabled,
    toggleComposeStrip,
  ]);

  // Compose-strip dock selection (260813-j3jb): exactly ONE dock renders the
  // strip. The IN-TILE dock (the first tty tile's flex column, via
  // SurfaceLayout's `ttyDockContent` slot) hosts the desktop terminal route's
  // single-send mode — the tile frame makes the target self-evident. The
  // FOOTER dock keeps everything a tile cannot host: selection broadcast (a
  // shell-level, cross-window concern — the dock split IS the mode signal),
  // mobile (no tile chrome), the server route, and no-tty layouts (e.g.
  // single:code). One shared element serves both docks: one component, one
  // module draft store, so a dock flip (broadcast on/off, layout gaining or
  // losing its tty tile) loses no draft.
  const inTileDock =
    composeStripEnabled &&
    !isMobile &&
    !!windowParam &&
    !selectionBroadcastKeys &&
    layout.order.includes("tty");
  const composeStripElement = (
    <ComposeStrip
      selectionTarget={
        selectionBroadcastKeys
          ? {
              keys: selectionBroadcastKeys,
              onSend: async (text) => {
                const delivered = await executeBulkSend(
                  selectionBroadcastKeys,
                  text,
                );
                // A total failure keeps the frozen target so the retained
                // draft stays visible (it is keyed to this recipient set)
                // and the retry needs neither retyping nor reselecting.
                if (delivered > 0) setSelectionBroadcastKeys(null);
                return delivered;
              },
            }
          : null
      }
    />
  );

  const viewActions: PaletteAction[] = useMemo(
    () => [
      ...(sessionName
        ? [
            {
              id: "text-input",
              label: "View: Text Input",
              onSelect: toggleComposeStrip,
            },
          ]
        : []),
      // Window-view lens actions (spec R4, Constitution V palette parity — the
      // palette is the ONLY lens-switch surface since the ViewSwitcher's
      // retirement, 260812-0c6o). Each lens is offered
      // only when it is AVAILABLE for the current window AND is not the current
      // view — so the palette shows the destination, never the current lens. The
      // per-entry shortcut hint tracks the binding that reaches it — the
      // EFFECTIVE `view-cycle` combo from the keybinding
      // registry (260730-g40a), so overrides are reflected; a disabled binding
      // contributes an empty hint (rendered as none). `View: Chat` carries no
      // hint — the `chat-toggle` chord is retired (260812-0c6o). These REPLACE
      // the retired
      // `toggle-iframe-terminal` action, which mutated `@rk_type`; switching a
      // lens now never touches the window's identity. The gating (available AND
      // not-current) + hint composition live in the pure `buildViewActions`
      // (lib/palette-view.ts) so they are unit-testable without mounting the
      // shell.
      ...buildViewActions(currentViews, resolvedView, switchView, {
        cycle: (() => {
          const b = bindingByAction.get("view-cycle");
          return b?.enabled ? formatCombo(b, bindingHost.platform) : "";
        })(),
      }),
      // Layout entries (260812-ab5v R11, T012) — Constitution V palette parity
      // for the rail toggles, tile verbs, and ▦ chip: `Layout: Add/Close
      // <Surface>` (the rail's toggles), `Layout: Zoom`/`Unzoom` (the
      // transient slot-A zoom), `Layout: Promote/Swap <Surface>` (the tile
      // verbs), per-shape jumps for the current arity, and `Layout: Cycle
      // Shape` (the `layout-cycle` chord's body — its id IS the registry
      // actionId, so `withShortcutHints` decorates it with the effective ⌘;
      // combo). These REPLACE the retired `Panel: Web`/`Panel: Code` entries —
      // the layout model subsumes the panel; the ⇧⌘. `panel-toggle` chord
      // (first non-tty tile) is documented via the target surface's Add/Close
      // entry hint. The gating + labels live in the pure `buildLayoutActions`
      // (lib/palette-layout.ts), the `buildViewActions` precedent.
      ...(windowParam
        ? buildLayoutActions(layout, panelSurfaces, {
            zoomed: layoutZoomed,
            zoomEnabled: !isMobile && layout.order.length > 1,
            onApply: applyLayout,
            onZoomToggle: () => layoutZoomToggleRef.current?.(),
            // `Layout: Focus <Surface>` (260812-wfic R10) — keyboard parity
            // for click-to-focus; desktop only (mobile's switcher is the
            // sheet tabs), routed through SurfaceLayout's focus seam.
            focusedKind: focusedTileKind,
            onFocus: !isMobile
              ? (kind: SurfaceKind) => layoutFocusTileRef.current?.(kind)
              : undefined,
            toggleTarget: panelSurfaces.find((s) => s !== "tty") ?? null,
            toggleShortcut: (() => {
              const b = bindingByAction.get("panel-toggle");
              return b?.enabled ? formatCombo(b, bindingHost.platform) : "";
            })(),
          })
        : []),
      // Rail toggle (260812-nm4p) — Constitution V keyboard path for the
      // top-bar's far-right rail chip: collapses/restores the whole right
      // column (rail AND any open panel), never a panel surface. Offered on
      // EVERY desktop terminal route (even with zero available surfaces — the
      // rail renders regardless), mirroring the button's own gate. No
      // registry binding, so no shortcut hint.
      ...(windowParam && !isMobile
        ? [{ id: "panel-rail-toggle", label: "Panel: Toggle rail", onSelect: onToggleRail }]
        : []),
      {
        id: "toggle-fixed-width",
        label: fixedWidth ? "View: Full Width" : "View: Fixed Width (900px)",
        onSelect: toggleFixedWidth,
      },
    ],
    [sessionName, fixedWidth, toggleFixedWidth, toggleComposeStrip, currentViews, resolvedView, switchView, bindingByAction, bindingHost, windowParam, isMobile, layout, panelSurfaces, applyLayout, layoutZoomed, focusedTileKind, onToggleRail],
  );

  // Navigation actions (`Go: Back` / `Go: Forward` / ancestor entries,
  // 260714-uco1) moved to the layout-level global palette groups
  // (260811-239r, `use-global-palette-actions.ts`) — their mode now comes from
  // the same deepest-first route-param walk `RootTopBar` uses.

  // Open-in-App actions (260722-6d0f) — Constitution V palette parity for the
  // top-bar Open split-button: one `Open: <label>` entry per available target
  // (deeplinks when remote + sshHost set; host apps when the wt registry is
  // non-empty). Terminal route only (the folder is the current window's
  // active-pane cwd); an empty target set contributes no entries, mirroring
  // the hidden button. No keyboard chord is registered — the target set is
  // data-driven per deployment, so the palette entries themselves are the
  // keyboard path (documented per the code-review shortcut rule; see
  // lib/palette-open.ts). Data comes from the same module-cached
  // useOpenTargets fetch the TopBar entry uses (one fetch per page load).
  const openCtx = useOpenTargets(!!windowParam);
  const openPath = windowParam ? activePaneCwd(currentWindow) : "";
  const { runTarget: runOpenTarget } = useRunOpenTarget(server, openPath);
  const openTargets = useMemo(
    () =>
      windowParam
        ? buildOpenTargets({
            hostname: window.location.hostname,
            sshHost: openCtx.sshHost,
            sshUser: openCtx.sshUser,
            hostApps: openCtx.hostApps,
            path: openPath,
          })
        : [],
    [windowParam, openCtx, openPath],
  );
  // Resolved last-used target (localStorage read, validated against the live
  // set — stale ids resolve null). Feeds both the dynamic `Open: Last used
  // (<label>)` palette entry and the ⇧⌘O chord handler (260801-sm6g).
  const lastUsedOpenTarget = resolveLastUsedTarget(openTargets, readLastUsedOpenTarget());
  const openActions: PaletteAction[] = useMemo(
    () => [
      ...buildOpenActions(openTargets, runOpenTarget),
      // `Open: Last used (<label>)` (260801-sm6g) — palette twin of the ⇧⌘O
      // `open-last-used` chord and the split-button's primary segment. Hidden
      // when no last-used target resolves (the chord's toast covers that).
      ...buildOpenLastUsedAction(lastUsedOpenTarget, runOpenTarget),
      // `Open: PR #{n}` (260727-w2d8) — the keyboard path to the current
      // window's PR (Constitution V; the sidebar PrLinkRow anchor is
      // mouse-only). Client-side only: window.open in THIS viewer's browser
      // (the Help: Documentation pattern) — no host spoke, no OpenTarget
      // entry (the top-bar Open menu mirrors targets only, untouched). Off
      // the terminal route currentWindow is null, and no PR → no entry. No
      // keyboard chord — this palette entry is the keyboard path.
      ...buildOpenPrAction(currentWindow?.prUrl, currentWindow?.prNumber, (url) =>
        window.open(url, "_blank", "noopener,noreferrer"),
      ),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [openTargets, lastUsedOpenTarget?.id, server, openPath, currentWindow?.prUrl, currentWindow?.prNumber],
  );

  // Terminal font-size actions moved to the layout-level global palette groups
  // (260811-239r, `use-global-palette-actions.ts`) — the setting is global and
  // the board route needs the same entries without duplicating them (DD-8).

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

  // `Settings: Open`, `Help: Keyboard Shortcuts`, and `Help: Documentation`
  // moved to the layout-level global palette groups (260811-239r) — the board
  // route carried DD-8 duplicates of each. What remains here is server-scoped
  // (they POST against `server`).
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
    ],
    [server, executeReloadConfig, executeResetConfig],
  );

  // Manual PR/status refresh (260715-jykd) — Constitution V palette parity for
  // the PANE-header refresh button. Kicks both PR pollers server-side (POST
  // /api/status/refresh); fresh state lands via SSE. Best-effort/fire-and-forget:
  // the server coalesces + throttles, so errors are swallowed. Server-global —
  // available on every AppShell route (the pure builder holds the label/id).
  const statusRefreshActions: PaletteAction[] = useMemo(
    () => buildStatusRefreshAction(() => void refreshStatus().catch(() => {})),
    [],
  );

  // Update/check/maintenance/version actions moved to the layout-level global
  // palette groups (260811-239r, `use-global-palette-actions.ts`) — the board
  // route carried DD-8 duplicates of all four (it is a phone user's ONLY
  // update surface below `sm`, where the top-bar cluster is hidden).

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

  // Sessions-pane scope toggle — palette parity for the sidebar's SESSIONS
  // header chip (Constitution V). A single toggle entry labeled by its TARGET
  // state; the sidebar re-renders reactively via the shared hook's pub/sub.
  const [sessionsScope, setSessionsScope] = useSessionsScope();
  const sessionsScopeActions: PaletteAction[] = useMemo(
    () => [
      {
        id: "sessions-scope-toggle",
        label:
          sessionsScope === "all"
            ? "Sessions: Show current server only"
            : "Sessions: Show all servers",
        onSelect: () => setSessionsScope(sessionsScope === "all" ? "current" : "all"),
      },
    ],
    [sessionsScope, setSessionsScope],
  );

  const serverActions: PaletteAction[] = useMemo(
    () => [
      {
        id: "create-server",
        label: "Server: Create",
        onSelect: openCreateServer,
      },
      // Per-server kill entries (bylc): with the hover ✕ removed from the
      // SERVER-panel tiles, this listing is the keyboard escape hatch that
      // keeps every server killable — including non-current servers, which
      // have no SESSIONS-pane group header under the `current` scope mode.
      // Each entry funnels through the layout-mounted kill-server confirm
      // Dialog (incl. its DAEMON_SERVER warning) via the context trigger
      // (260811-239r) → ServerDialogs' executeKillServer.
      ...buildServerKillActions(
        servers.map(({ name }) => name),
        server,
        requestKillServer,
      ),
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
    [servers, server, handleSwitchServer, currentRegularIdx, regularOrder, moveCurrentServer, openCreateServer, requestKillServer],
  );

  // Desktop-shell server switching (Constitution V): `Server: Switch to
  // "<name>"` — one entry per SHELL-registered rk server (quoted name; whole
  // rk instances by URL, distinct from the tmux entries above), active one
  // marked (current). Present ONLY inside the desktop shell — useShellServers
  // resolves [] in a plain browser, the first real isShell()-gated palette
  // consumer. The shell-side paths are the ⌥⌘1–9 (mac) / ⇧Ctrl+1–9
  // (win/linux) accelerators + Servers menu
  // radios; selecting an entry hands off to the shell, which loads the target
  // server's URL (a full page swap), so no SPA-side navigation follows. A
  // denied/failed bridge call surfaces as an error toast.
  const shellServers = useShellServers();
  const shellServerActions: PaletteAction[] = useMemo(
    () =>
      buildShellServerActions(shellServers, (id) => {
        void switchShellServer(id).then((ok) => {
          if (!ok) addToast("Shell server switch failed", "error");
        });
      }),
    [shellServers, addToast],
  );

  // Navigate to a waiting target while PRESERVING `?view=chat` (260714-r7rq).
  // A chat-capable target can't reuse `navigateToWindow` (that path hardcodes
  // `search: {}`, stripping the deep-link), so it navigates directly — but a
  // SAME-SERVER target still needs the tmux alignment the sidebar/palette path
  // provides: set `pendingClickRef` + fire `selectWindow` so the URL writeback
  // (app.tsx:663) doesn't bounce back to the previously-active window (which
  // would ALSO strip `?view=chat`, since that writeback clears search) before
  // SSE confirms the switch. Cross-server targets navigate plainly — identity
  // is window-id-only on the 2-segment route and the destination's mount-time
  // alignment (app.tsx:633) handles tmux there.
  const navigateToWaitingTarget = useCallback(
    (targetServer: string, targetWindowId: string, hasChat: boolean) => {
      if (targetServer === server) {
        // Same-server: tmux-align + track the pending switch so the failure
        // bounce-back (260715-38kg) un-sticks a limbo if the POST fails or never
        // confirms. No grace mask — a chat/deep-link target is often non-tty or
        // remounts. Cross-server navigates plainly (destination handles its own
        // mount-time alignment + tracking).
        const posted = selectWindow(server, targetWindowId);
        posted.catch(() => {});
        beginPendingSwitch({ server, windowId: targetWindowId }, { posted });
      }
      navigate({
        to: "/$server/$window",
        params: { server: targetServer, window: targetWindowId },
        search: chatSearchForTarget(hasChat),
      });
      if (isMobile) setSidebarOpen(false);
    },
    [server, navigate, isMobile, setSidebarOpen, beginPendingSwitch],
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
      // `{server}|{windowId}` → whether that target has a chat, so the deep link
      // appends `?view=chat` for chat-capable windows (260714-r7rq).
      const chatByKey = new Map<string, boolean>();
      const key = (srv: string, wid: string) => `${srv}|${wid}`;
      // Current server first, in sidebar order.
      for (const fw of flatWindows) {
        if (isWaiting(fw.window)) {
          ordered.push({ server, windowId: fw.window.windowId });
          chatByKey.set(key(server, fw.window.windowId), !!fw.window.chatProvider);
        }
      }
      // Then other attached servers (skip the current one — already added).
      for (const s of servers) {
        if (s.name === server) continue;
        for (const sess of sessionsByServerRef.current.get(s.name) ?? []) {
          for (const w of sess.windows) {
            if (isWaiting(w)) {
              ordered.push({ server: s.name, windowId: w.windowId });
              chatByKey.set(key(s.name, w.windowId), !!w.chatProvider);
            }
          }
        }
      }
      const target = nextWaitingTarget(ordered, server, windowParam);
      if (!target) {
        addToast("No agents waiting", "info");
        return;
      }
      const hasChat = chatByKey.get(key(target.server, target.windowId)) ?? false;
      if (target.server === server && !hasChat) {
        // Same-server, non-chat: keep the rich window-switch path (selectWindow
        // tmux-align + slide transition + mobile-close). It clears search, which
        // is correct — the target resolves its own terminal view.
        navigateToWindow(target.windowId);
        return;
      }
      // A chat-capable target deep-links into `?view=chat` (a same-server chat
      // target still tmux-aligns via `navigateToWaitingTarget`); a cross-server
      // target navigates plainly (its pref/URL resolves on render).
      navigateToWaitingTarget(target.server, target.windowId, hasChat);
    };
    return [{ id: "agent-next-waiting", label: "Agent: Next waiting", onSelect }];
  }, [flatWindows, servers, server, windowParam, navigateToWindow, navigateToWaitingTarget, addToast]);

  // ── macros over riff presets / palette actions (260730-hbyh) ─────────────
  const { macros } = useMacros();

  // Macro execution. Palette targets dispatch the existing palette action
  // body in-place (id lookup — the `fromPalette` convention; `macro:` ids are
  // never resolved as targets, so no macro→macro recursion). Riff targets
  // POST the existing validated spawn seam with the PRESET NAME only (no
  // shell text, no new exec surface — Constitution I): success toasts and
  // navigates to the spawned window (the spawn dialog's falsy-windowId guard
  // preserved); failure — incl. a 400 for a preset gone from fabconfig —
  // surfaces as an error toast. No fire-and-forget. The imperative
  // `getAllActions` resolves targets against the MERGED list (route actions +
  // the layout-level globals, 260811-239r) at call time, breaking the
  // palette↔macro cycle: macro palette entries fold into the registered route
  // list, while execution may target any palette entry, global ones included.
  const executeMacro = useCallback(
    (macro: MacroAction) => {
      if (macro.target.type === "palette") {
        const targetId = macro.target.paletteActionId;
        if (isMacroActionId(targetId)) return;
        getAllActions().find((a) => a.id === targetId)?.onSelect();
        return;
      }
      if (!sessionName) return;
      spawnRiff(server, sessionName, { preset: macro.target.preset })
        .then((res) => {
          addToast(`Spawned ${res.window}`, "info");
          if (res.windowId) navigateToWindow(res.windowId);
        })
        .catch((err) =>
          addToast(err instanceof Error ? err.message : "Macro spawn failed", "error"),
        );
    },
    [server, sessionName, addToast, navigateToWindow, getAllActions],
  );

  // Macros are palette-reachable without their key (kind-tagged `Macro:`
  // entries; actionId doubles as the palette id, so `withShortcutHints`
  // decorates them with their effective combos automatically). Riff macros
  // are session-gated, mirroring `Agent: Spawn`.
  const macroPaletteActions: PaletteAction[] = useMemo(
    () =>
      macros
        .filter((m) => m.target.type === "palette" || sessionName != null)
        .map((m) => ({
          id: m.actionId,
          label: `Macro: ${m.label}`,
          onSelect: () => executeMacro(m),
        })),
    [macros, sessionName, executeMacro],
  );

  // Agent: Spawn — Cmd+K parity for the web-UI spawn flow (260713-sbk1;
  // Constitution V palette parity — the shortcut/registration is documented
  // here per code-review.md "New keyboard shortcuts must be documented in the
  // command palette registration"). Gated on a resolvable session (mirrors
  // Window: Create), since the spawn target IS the current window's session.
  const agentSpawnActions: PaletteAction[] = useMemo(
    () =>
      sessionName
        ? [{ id: "agent-spawn", label: "Agent: Spawn", onSelect: () => handleOpenSpawnAgent(server, sessionName) }]
        : [],
    [server, sessionName, handleOpenSpawnAgent],
  );

  const { actions: pushActions } = usePushSubscription();

  // AppShell's ROUTE-SCOPED palette list (260811-239r): the global groups
  // (nav, terminal-font, refresh/help/shortcuts/settings, update/check/
  // maintenance/version) live at the layout level now
  // (`use-global-palette-actions.ts`) and arrive merged AFTER these via the
  // palette-actions slot — ordering stays route groups first, then the global
  // groups in their prior relative order (R11).
  const paletteActions: PaletteAction[] = useMemo(
    () =>
      // Every registered action with a palette entry renders its EFFECTIVE
      // combo as the `shortcut` hint (actionId doubles as the palette id),
      // formatted per platform and reflecting overrides; disabled bindings
      // (user-disabled or browser-reserved) render no hint (260730-g40a).
      withShortcutHints(
        [...sessionActions, ...sessionsScopeActions, ...windowActions, ...boardActions, ...selectionActions, ...viewActions, ...openActions, ...themeActions, ...configActions, ...statusRefreshActions, ...serverActions, ...shellServerActions, ...pushActions, ...windowSwitchActions, ...agentActions, ...agentSpawnActions, ...macroPaletteActions],
        bindingByAction,
        bindingHost.platform,
      ),
    [sessionActions, sessionsScopeActions, windowActions, boardActions, selectionActions, viewActions, openActions, themeActions, configActions, statusRefreshActions, serverActions, shellServerActions, pushActions, windowSwitchActions, agentActions, agentSpawnActions, macroPaletteActions, bindingByAction, bindingHost],
  );
  // Publish this route's (already shortcut-decorated) list into the
  // palette-actions slot — the single layout-mounted CommandPalette renders
  // `[...routeActions, ...globalActions]`; cleared on unmount so the next
  // route never sees stale entries (260811-239r).
  useRegisterPaletteActions(paletteActions);

  // ── keybinding dispatch (260730-g40a) ────────────────────────────────────
  // The shifted-tier chords reuse the PALETTE ACTION BODIES (actionId doubles
  // as the palette id), so chord and palette behavior can never drift — and
  // palette gating (e.g. `kill-window` exists only when a session is active)
  // gates the chord for free: a missing handler falls through untouched.
  // `window-prev`/`window-next` have no palette entries; they cycle the
  // CURRENT session's windows in sidebar order with wraparound, via the rich
  // `navigateToWindow` path (tmux align + transition + writeback suppression).
  const keybindingHandlers = useMemo(() => {
    // Resolve over the MERGED list (260811-239r): chords such as `go-back`,
    // `settings-open`, and `shortcuts-overlay` name ids that live in the
    // layout-level global groups now — resolving against the route list alone
    // would silently drop those handlers (R10). The merge is local
    // (`paletteActions` from THIS render + the globals-only channel), so the
    // handlers below never lag the registration slot by a commit.
    const merged = [...paletteActions, ...paletteGlobals];
    const fromPalette = (id: string) => merged.find((a) => a.id === id)?.onSelect;
    // ttyOnly gate (260812-wfic R8): a binding flagged `ttyOnly` in the
    // registry yields NO handler unless the tty tile owns focus — handler
    // presence is the dispatcher contract, so the chord then falls through
    // untouched (rule 3, no preventDefault).
    const ttyGated = (id: string) =>
      bindingByAction.get(id)?.ttyOnly && focusedTileKind !== "tty"
        ? undefined
        : fromPalette(id);
    const windows = currentSession?.windows ?? [];
    const cycleWindow = (delta: -1 | 1) => {
      const idx = windows.findIndex((w) => w.windowId === windowParam);
      if (idx < 0) return;
      const target = windows[(idx + delta + windows.length) % windows.length];
      navigateToWindow(target.windowId);
    };
    const canCycle = windowParam != null && windows.length > 0;
    // Macro chords (260730-hbyh): palette targets reuse the palette body via
    // the same `fromPalette` lookup (an absent action → no handler → the
    // chord falls through untouched); riff targets are session-gated and run
    // `executeMacro`. Builtin keys are spread last, so a (theoretical) id
    // collision resolves builtin-first.
    const macroHandlers: Record<string, (() => void) | undefined> = {};
    for (const m of macros) {
      if (m.target.type === "palette") {
        macroHandlers[m.actionId] = isMacroActionId(m.target.paletteActionId)
          ? undefined
          : fromPalette(m.target.paletteActionId);
      } else {
        macroHandlers[m.actionId] = sessionName ? () => executeMacro(m) : undefined;
      }
    }
    return {
      ...macroHandlers,
      "create-session": fromPalette("create-session"),
      "create-window": fromPalette("create-window"),
      "kill-window": fromPalette("kill-window"),
      "agent-next-waiting": fromPalette("agent-next-waiting"),
      "go-back": fromPalette("go-back"),
      "go-forward": fromPalette("go-forward"),
      "window-prev": canCycle ? () => cycleWindow(-1) : undefined,
      "window-next": canCycle ? () => cycleWindow(1) : undefined,
      "shortcuts-overlay": fromPalette("shortcuts-overlay"),
      // ⇧⌘E compose toggle (260801-sm6g) — same body as the `>_` chip and the
      // `View: Text Input` palette entry; ignoreInputs on the binding lets the
      // chord close the strip from inside its own textarea.
      "compose-toggle": toggleComposeStrip,
      // ⇧⌘O open-last-used (260801-sm6g) — terminal route only (scope is
      // descriptive; handler presence gates). Reuses the palette body when the
      // dynamic `Open: Last used (<label>)` entry exists (a last-used target
      // resolved); otherwise the chord surfaces the empty-state toast — a
      // chord cannot reasonably pop the split-button's mouse menu.
      "open-last-used": windowParam
        ? (fromPalette("open-last-used") ??
          (() => addToast("No last-used app yet — pick one from Open ▾ or the palette", "info")))
        : undefined,
      // ⇧⌘,/⌘, settings (260801-mqim) — the palette body (`Settings: Open` →
      // `openSettings`); a re-fire while the dialog is open is a no-op.
      "settings-open": fromPalette("settings-open"),
      // Split pane (260807-rbx5): ⌘D/⇧⌘D on mac, ⇧Ctrl+\/⇧Ctrl+- on
      // Win/Linux — the `Window: Split Horizontal` / `Window: Split Vertical`
      // palette bodies. The palette block is gated on a current session +
      // window, so on non-window routes `fromPalette` yields undefined and
      // the chord falls through untouched (BoardPage mounts neither — splits
      // are terminal-route actions, like `open-last-used`).
      //
      // tty-scoped gate (260812-wfic R8): the pair carries the registry's
      // `ttyOnly` data flag — its handler is treated as ABSENT unless the
      // focused tile is the tty tile (single:tty and mobile's visible tty
      // count), so the chord falls through per dispatcher rule 3 (no
      // preventDefault) when e.g. the code tile owns focus. The gate consults
      // the flag, never a hardcoded actionId list; PALETTE invocation is
      // unaffected (the gate applies to chords, not the `Window: Split …`
      // rows). The tty-side path is untouched — `shouldRefuseTerminalChord`
      // still bounces the chord out of the xterm pane to this dispatcher.
      "split-horizontal": ttyGated("split-horizontal"),
      "split-vertical": ttyGated("split-vertical"),
      // ⇧⌘. panel toggle (260811-2r1w, generalized in 260811-k3vp) — retargeted
      // to the layout model in 260812-ab5v: toggles the first NON-TTY available
      // surface's TILE via addSurface/closeSurface (through `togglePanel`).
      // Its gating (desktop window route + ≥1 available non-tty surface) gates
      // the chord for free.
      "panel-toggle":
        windowParam && !isMobile && panelSurfaces.some((s) => s !== "tty")
          ? () => {
              const first = panelSurfaces.find((s) => s !== "tty");
              if (first) togglePanel(first);
            }
          : undefined,
      // ⌘; layout-shape cycle (260812-ab5v R9) — the ▦ chip's chord: the next
      // same-arity preset, order kept. Reuses the `Layout: Cycle Shape`
      // palette body, whose gating (window route + a non-degenerate arity
      // ring) gates the chord for free.
      "layout-cycle": fromPalette("layout-cycle"),
    };
  }, [paletteActions, paletteGlobals, currentSession, windowParam, navigateToWindow, macros, sessionName, executeMacro, toggleComposeStrip, addToast, isMobile, panelSurfaces, togglePanel, bindingByAction, focusedTileKind, layout]);
  useKeybindingDispatch(keybindingHandlers);

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
        // Clear `?view=chat` so the target window resolves its own view pref
        // (260714-r7rq); a cross-server switch never carries the source's chat
        // state.
        navigate({
          to: "/$server/$window",
          params: { server: srv, window: windowId },
          search: {},
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
  // Stable kill-server handler (260721-x4sf): `onKillServer` threads into the
  // memoized `ServerGroup` header cluster, so an inline arrow here would hand
  // every group a fresh identity per SSE tick and defeat the memo skip. The
  // context trigger (`requestKillServer`, 260811-239r) is referentially stable
  // by construction — it passes straight through at the Sidebar call site.

  // Waiting-badge click (260714-r7rq): navigate to the NEXT waiting window
  // within the clicked session's scope, reusing the `nextWaitingTarget` cycle
  // semantics (R12) — so clicking the badge while already ON one of that
  // session's waiting windows advances to the next (with wraparound) instead of
  // no-opping on the first. `?view=chat` is appended when the target window has
  // a chat (chatSearchForTarget). Reads the freshest sessions map by ref so the
  // callback stays stable across SSE ticks (mirrors the other sidebar
  // handlers). No-op if the session has no waiting window (the badge only
  // renders when count > 0, so this is a defensive guard against a stale
  // snapshot).
  const handleWaitingBadgeClick = useCallback(
    (srv: string, sess: string) => {
      // Read the freshest sessions map by ref (keyed by server) so the callback
      // stays stable across SSE ticks — `sessionsByServerRef.current.get(server)`
      // IS `rawSessions` (same source/key), so there is no current-server special
      // case to keep. Dropping the `rawSessions` dep is what keeps this callback
      // reference stable, preserving `ServerGroup`'s `React.memo`.
      const sessionsForSrv = sessionsByServerRef.current.get(srv) ?? [];
      const sessionEntry = sessionsForSrv.find((s) => s.name === sess);
      if (!sessionEntry) return;
      const waitingWindows = sessionEntry.windows.filter((w) => isWaiting(w));
      const ordered: WaitingTarget[] = waitingWindows.map((w) => ({
        server: srv,
        windowId: w.windowId,
      }));
      // Current position is keyed on the REAL current (server, window) pair —
      // nextWaitingTarget keys on both, so a same-numbered window on another
      // server never spuriously matches; a cross-server badge click always
      // lands on the session's first waiting window.
      const target = nextWaitingTarget(ordered, server, windowParam);
      if (!target) return;
      const win = waitingWindows.find((w) => w.windowId === target.windowId);
      // Same-server targets tmux-align (selectWindow + pendingClickRef) so the
      // URL writeback can't bounce back and strip `?view=chat`; cross-server
      // navigates plainly. See `navigateToWaitingTarget`.
      navigateToWaitingTarget(target.server, target.windowId, !!win?.chatProvider);
    },
    [server, windowParam, navigateToWaitingTarget],
  );

  // Register AppShell's TopBar props into the persistent root bar's slot
  // (260707-4vq2). The heavy handlers (`navigateToWindow` with its
  // View-Transitions gate, `handleCreateWindow` with optimistic
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
  // Connection dot semantics (R9): in chat view the dot reports the chat
  // stream's health; in terminal/root view it keeps the per-server sessions-SSE
  // slice ("per-page live-data health"). The dot renders in the SIDEBAR FOOTER
  // (260724-6j1v — it left the top bar), so this feeds the Sidebar prop below.
  const dotConnected = chatViewActive ? chatStream.connected : isConnected;
  // The window-switcher `+ New Agent` (TopBar `onSpawnAgent(session)`) targets
  // the CURRENT server; bind `server` here so the slot handler keeps the
  // one-arg TopBar signature while feeding the explicit `{server, session}`
  // target. Cross-server spawn comes from the sidebar, not this entry point.
  const handleSlotSpawnAgent = useCallback(
    (sess: string) => handleOpenSpawnAgent(server, sess),
    [server, handleOpenSpawnAgent],
  );
  const topBarSlot = useMemo(
    () => ({
      sessions,
      currentSession,
      currentWindow,
      sessionName: displaySession,
      windowName: displayName,
      sidebarOpen,
      server,
      onNavigate: navigateToWindow,
      onToggleSidebar,
      onCreateWindow: handleCreateWindow,
      onSpawnAgent: handleSlotSpawnAgent,
      // Rail toggle (260812-nm4p, reinterpreted under 260812-ab5v): `railOpen`
      // carries the raw persisted preference (tiles are content-column state
      // and never force the rail visible). The handler registers on EVERY
      // desktop terminal route — even with zero available surfaces, the rail
      // still renders (landing-pad behavior). Absent on board/host/mobile →
      // no toggle.
      railOpen: rightAreaVisible,
      onToggleRail: windowParam && !isMobile ? onToggleRail : undefined,
      // ▦ Layout chip machinery (260812-ab5v R9): the resolved layout + the
      // single mutation path. The top bar's chip/rows jump presets through
      // `applyLayout` like every other mutation.
      layout,
      onApplyLayout: applyLayout,
    }),
    [
      sessions,
      currentSession,
      currentWindow,
      displaySession,
      displayName,
      sidebarOpen,
      server,
      navigateToWindow,
      onToggleSidebar,
      handleCreateWindow,
      handleSlotSpawnAgent,
      rightAreaVisible,
      windowParam,
      isMobile,
      onToggleRail,
      layout,
      applyLayout,
    ],
  );
  useRegisterTopBarSlot(topBarSlot);

  // Pending-switch mask (260715-38kg): subscribe to the pure mask-signal state
  // machine in `window-transition.ts`. `"masked"` renders a full LogoSpinner
  // waiting mask over the terminal surface (armed at gate timeout / grace-timer
  // threshold, lifted on the incoming window's late first write). The module
  // owns arm/lift/teardown — this component only renders the current state.
  // Called BEFORE the early-return guards below to keep hook order stable.
  const showSwitchMask = useSyncExternalStore(subscribeMaskState, getMaskState) === "masked";

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
      isConnected={dotConnected}
      onSelectWindow={handleSidebarSelectWindow}
      onWaitingBadgeClick={handleWaitingBadgeClick}
      onCreateWindow={handleSidebarCreateWindow}
      onCreateSession={handleSidebarCreateSession}
      onSpawnAgent={handleOpenSpawnAgent}
      onForkWindow={handleForkWindow}
      onCreateServer={openCreateServer}
      onKillServer={requestKillServer}
      onSidebarResizeStart={isMobile ? undefined : (e) => handleDragStart(e.clientX)}
    />
  );

  return (
    <Shell
      sidebarChildren={sidebarElement}
      rightPanelVisible={rightAreaVisible}
      rightPanelChildren={
        windowParam && !isMobile ? (
          // Rail (260811-2r1w; rail-only since 260812-ab5v T011 — layout
          // tiles subsume the panel slot, so the Shell's third column
          // (260812-nm4p) now holds JUST the rail; surface content lives in
          // the content column's tile grid). Buttons are open-tile TOGGLES
          // (R10): lit per open tile (`layout.order`), click adds/closes via
          // `togglePanel` → applyLayout; disabled+tooltip at 3 tiles. Keyed
          // by server:window like the panel was. Collapse via
          // `rightAreaVisible` is display-level (Shell's hidden aside) and
          // never touches the tiles.
          <RightPanel
            key={`${server}:${windowParam}`}
            available={panelSurfaces}
            open={layout.order}
            onToggle={togglePanel}
          />
        ) : undefined
      }
      sidebarResizeHandle={
        // Drag handle — Shell places it at the sidebar aside's right edge and
        // renders it only when the desktop aside is up (never on the mobile
        // overlay). All drag state/handlers stay here in AppShell.
        // Visual bar is 3px (the seam width), but the grabbable area is
        // extended ~8px into the sidebar via the invisible `before:`
        // pseudo-element (pointer events on a pseudo hit its element, so the
        // drag/hover handlers fire unchanged). It cannot extend RIGHT over the
        // terminal: the aside's `overflow-hidden` clips anything past its edge.
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
      }
    >
      {/* The desktop sidebar aside is now Shell-owned (260719-rwqf): AppShell
          passes `sidebarChildren` + `sidebarResizeHandle` and Shell renders the
          `<aside gridArea:"sidebar">` (gated `!isMobile && sidebarOpen`). */}

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
          className={`relative flex-1 min-h-0 flex flex-col ${fixedWidth ? "bg-bg-primary" : ""}`}
          style={{
            viewTransitionName: "terminal-surface",
            ...(fixedWidth ? { maxWidth: 900, width: "100%", marginInline: "auto" } : {}),
          }}
          // Block keyboard input to the OLD window while the pending-switch mask
          // is up (260715-38kg): the hazard being fixed is typing into the window
          // you THINK you left. Capture-phase intercept runs before xterm's
          // hidden-textarea handler; keystrokes are DROPPED, not buffered/replayed
          // (assumption 10). Pointer input is blocked by the overlay's own
          // `pointer-events` below. Global chords survive the swallow (rework F2
          // — constitution V: Cmd+K is the primary discovery mechanism): Escape,
          // meta chords, and the Ctrl-bound global chords pass through per
          // `isMaskExemptKey`; terminal-bound input (plain typing, Ctrl+C) stays
          // dropped.
          onKeyDownCapture={
            showSwitchMask
              ? (e) => {
                  if (isMaskExemptKey(e)) return;
                  e.preventDefault();
                  e.stopPropagation();
                }
              : undefined
          }
        >
          {/* Pending-switch spinner mask (260715-38kg). A FULL waiting mask over
              the terminal surface — never a dimmed overlay — fully hiding the
              stale bytes while a switch is in transit ("don't type"). Armed at
              the 300ms gate-timeout / grace-timer threshold (NEVER at click
              time), lifted as a cut/fast-fade on the incoming window's late
              first write. `pointer-events: auto` (via the class) swallows clicks
              on the old window. */}
          {showSwitchMask && (
            <div
              className="rk-window-switch-mask"
              role="status"
              aria-live="polite"
              aria-label="Switching window"
            >
              <LogoSpinner size={48} />
            </div>
          )}
          {/* Surface-layout column (260812-ab5v-surface-layout-core, spec
              surface-layout.md): the tile grid (SurfaceLayout) renders the
              RESOLVED layout as 1–3 tiles mounting the existing renderers
              unchanged — it SUBSUMES both the legacy exclusive-lens branch
              (the palette `View:` actions drive `single:<view>` through
              applyLayout — R12) and the right-panel surface mount (the panel
              slot is a
              tile now — R6). The rail left this row in 260812-nm4p — it is
              the Shell grid's full-height third column, passed via
              `rightPanelChildren` — and renders open-tile toggles (R10). */}
          <div className="flex-1 min-w-0 min-h-0 flex flex-col">
          {/* Render gate keys on `windowParam` (the URL's @N) ALONE, not the
              SSE-derived `sessionName`. The session name is only needed for the
              breadcrumb/title and resolves a beat after the first snapshot; the
              terminal itself connects by window id, so gating on the derived
              session would needlessly delay the mount on a cold deep-link (and
              briefly flash the Dashboard). */}
          {windowParam ? (
            <SurfaceLayout
              // Keyed by server:window so a window switch REMOUNTS the grid —
              // its hide-never-unmount set, zoom, and ratio-drag state are
              // per-window (the RightPanel keying precedent).
              key={`${server}:${windowParam}`}
              layout={layout}
              server={server}
              windowId={windowParam}
              sessionName={sessionName ?? ""}
              // The LATCHED window (if5d): the code tile's render guard, its
              // header basename, and CodeSurface's `src` all read `gitRoot` from
              // here, so none of them can follow the terminal.
              window={effectiveWindow}
              isMobile={isMobile}
              // T014: on mobile the sheet tabs pick which slot renders
              // (transient — the layout itself is untouched).
              mobileActiveSlot={layout.order.indexOf(mobileActiveTile)}
              wsRef={wsRef}
              focusRef={focusTerminalRef}
              scrollLocked={scrollLocked}
              onSessionNotFound={() => navigate({ to: "/$server", params: { server }, replace: true })}
              chat={{
                events: chatStream.events,
                pending: chatStream.pending,
                connected: chatStream.connected,
                error: chatStream.error,
                // AppShell wires the send callback (chat-send POST) + the busy
                // signal (agentState === "active"); ChatView stays pure. The
                // chat tile only resolves on a chat-capable window, so `@N`
                // is a non-empty string here.
                onSend: async (text, submit) => {
                  await sendChatMessage(server, windowParam, text, submit);
                },
                busy: currentWindow?.agentState === "active",
              }}
              codeReachable={codeServer?.reachable ?? false}
              // Follow rule (if5d R3): after the seed, the editor's own
              // navigation is the ONLY writer of the latch.
              onCodeFolderNavigated={latchCodeFolder}
              shouldReclaimChord={reclaimChord}
              // The web tile's `>_` affordance keeps the legacy "switch to
              // terminal" behavior: collapse to `single:tty`.
              onSwitchToTty={() => applyLayout({ shape: "single", order: ["tty"] })}
              onPromote={(surface) => applyLayout(promote(layout, surface))}
              onSwap={(surface) => applyLayout(swapWithNext(layout, surface))}
              onClose={(surface) => {
                const next = closeSurface(layout, surface);
                if (next) applyLayout(next);
              }}
              // tty pane-segment verbs (260813-w1lf): the tile header's
              // Split H / Split V / Close Pane buttons ride the same
              // optimistic actions the palette split/close entries use.
              onSplitPane={(horizontal) =>
                executeSplit(server, windowParam, horizontal, currentWindow?.worktreePath)
              }
              onClosePane={() => executeClosePane(server, windowParam)}
              // ⏶ Zoom palette seam (T012/R11): the component owns the
              // transient zoom state and registers its slot-A toggle here;
              // flips report back so the `Layout: Zoom`/`Unzoom` palette
              // entries stay fresh.
              zoomToggleRef={layoutZoomToggleRef}
              onZoomChange={setLayoutZoomed}
              // Focused tile (260812-wfic R2/R10): the component owns the
              // focused SLOT and reports the focused KIND for the ttyOnly
              // chord gate; the palette's `Layout: Focus <Surface>` entries
              // drive focus through the ref seam.
              onFocusedKindChange={setReportedFocusedKind}
              focusTileRef={layoutFocusTileRef}
              // tty header status dot (R6): the SSE window record — consumed
              // by tty tile headers only (no dot when null/non-tty).
              statusWindow={currentWindow ?? null}
              // In-tile compose-strip dock (260813-j3jb): the shared strip
              // element mounts inside the FIRST tty tile when the in-tile
              // predicate holds; otherwise the shell footer below renders it.
              ttyDockContent={inTileDock ? composeStripElement : undefined}
            />
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
        </div>
      </main>

      {/* Bottom bar grid area — shell-level. Reads focused terminal from
          FocusedTerminalContext (TerminalClient registered itself on mount).
          When the compose-strip preference is on, the docked strip renders
          ABOVE the bottom bar inside this grid area UNLESS the in-tile dock
          hosts it (260813-j3jb — desktop terminal route, tty tile present, no
          selection broadcast); its presence grows the `auto` footer row and
          shrinks the `1fr` content row, so the terminal's ResizeObserver
          refits automatically (260718-dhdj). */}
      <footer style={{ gridArea: "bottombar" }}>
        {composeStripEnabled && !inTileDock && composeStripElement}
        <div className="border-t-[3px] border-border px-1.5 h-[48px]">
          <BottomBar
            onOpenCompose={toggleComposeStrip}
            onFocusTerminal={() => focusTerminalRef.current?.()}
            onScrollLockChange={setScrollLocked}
            // Mobile surface tabs (T014/R13): only on the mobile terminal
            // route with a multi-tile layout — the ▦ chip's sheet swaps the
            // mobile slot-A surface via transient state (never a layout
            // mutation). Tabs are deduped (a duplicate-tty layout gets one
            // Terminal tab).
            surfaceSheet={
              isMobile && windowParam && layout.order.length > 1
                ? {
                    surfaces: [...new Set(layout.order)],
                    active: mobileActiveTile,
                    onSelect: (surface) => setMobileSlotA(surface),
                  }
                : undefined
            }
          />
        </div>
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

      {spawnAgentTarget && (
        <Suspense fallback={null}>
          <SpawnAgentDialog
            server={spawnAgentTarget.server}
            session={spawnAgentTarget.session}
            onSpawned={(windowId) => navigateToSpawnedWindow(spawnAgentTarget.server, windowId)}
            onClose={() => setSpawnAgentTarget(null)}
          />
        </Suspense>
      )}

      {showCreateIframeDialog && sessionName && (
        <Dialog title="New iframe window" onClose={() => { setShowCreateIframeDialog(false); setIframeWindowName(""); setIframeWindowUrl(""); }}>
          <input
            autoFocus
            type="text"
            value={iframeWindowName}
            onChange={(e) => setIframeWindowName(toSafeWindowName(e.target.value))}
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
            onChange={(e) => dialogs.setRenameSessionName(toSafeSessionName(e.target.value))}
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

      {/* Server create/kill dialogs moved to the single layout-level mount
          (`components/server-dialogs.tsx`, 260811-239r) — this shell triggers
          them via `server-dialogs-context`. */}

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
                // Selection does NOT close (the picker's dismissal contract) —
                // dismissal is the ✕ cell, the backdrop click, or Escape.
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

      {/* The command palette + shortcuts overlay mount ONCE in AppLayout now
          (260811-239r): the palette renders this route's registered actions
          ahead of the layout-level globals; the overlay's state is
          layout-owned. */}

      <Suspense fallback={null}>
        <ThemeSelector />
      </Suspense>
    </Shell>
  );
}
