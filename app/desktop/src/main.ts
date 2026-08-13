/**
 * Main process — lifecycle, BrowserWindow, per-host WebContentsViews,
 * security wiring, IPC, the welcome ↔ host-view routing, and local-daemon
 * control. ("Host" = an rk instance; "server" is reserved for tmux servers.
 * The `servers:*` IPC channels and the bridge's `servers` group keep their
 * names — they are the web SPA's contract.)
 *
 * Host content renders in ONE PERSISTENT WebContentsView PER VISITED HOST
 * (created lazily, kept alive until the host is removed or the window is torn
 * down), so a host switch is an instant detach/attach flip that preserves
 * live renderer state — WS/SSE connections, xterm scrollback, scroll
 * position — never a reload. The window's own webContents serves only the
 * welcome page. Per-view decision logic + badge/theme caches: ./views
 * (electron-free, node:test covered).
 *
 * This shell is a VIEWER (Constitution VI): it loads an existing `rk serve`
 * URL and NEVER spawns or supervises the rk daemon on its own initiative.
 * child_process is used ONLY for explicit user-initiated actions — `rk daemon`
 * start/stop/restart via the welcome card or the Local Daemon menu, and
 * `rk desktop update` via the App menu's Restart-to-Update click — and
 * read-only detection (`rk url`, `rk --version`, `rk desktop status`). There
 * is no auto-start and no auto-update anywhere; the tmux/server layer stays
 * independent of this process, and the CLI (not the shell) is the updater.
 *
 * Dev override: `RK_DESKTOP_URL=http://localhost:3000 just dev-desktop`
 * loads that URL directly without persisting it to hosts.json.
 */
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  IpcMainInvokeEvent,
  Menu,
  nativeImage,
  net,
  session,
  shell,
  WebContents,
  WebContentsView,
} from "electron";
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  augmentPath,
  DaemonStatus,
  isDaemonAlreadyRunning,
  isExecTimeout,
  parseRkVersion,
  parseSessionCount,
  resolveRkBinary,
  rkCandidatePaths,
  rkTimeoutMessage,
} from "./local-daemon";
import { badgePng, overlayDescription } from "./badge";
import { buildMenu, DaemonMenuInfo, MenuCallbacks, UpdateMenuInfo } from "./menu";
import {
  BLANK_UNDERLAY_URL,
  DEFAULT_STRIP_COLOR,
  fallbackStripCss,
  shouldInjectFallbackStrip,
  STRIP_HEIGHT_PX,
  symbolColorFor,
} from "./strip";
import {
  createLineSplitter,
  parseConnectOrigin,
  parseRemoteAddOutput,
} from "./remote-host";
import { availableUpdateVersion, isUpdateCheckDue } from "./update-check";
import { isEditorDeeplink, isHttpUrl, windowOpenAction } from "./window-open";
import {
  addHost,
  findHostByOrigin,
  HostInfo,
  hostInfos,
  loadHosts,
  moveHost,
  normalizeOrigin,
  removeHost,
  resolveActiveHost,
  setActiveHost,
  setHostAccentColor,
  setHostLastPath,
} from "./hosts";
import {
  activateView,
  activeView,
  addView,
  deactivateViews,
  emptyViews,
  findViewByWebContentsId,
  getView,
  LoadFlagEvent,
  nextLoadFailed,
  removeView,
  setViewBadge,
  setViewThemeColor,
  switchPaint,
  ViewsState,
} from "./views";

const WELCOME_PATH = join(__dirname, "welcome", "welcome.html");
const WELCOME_URL = pathToFileURL(WELCOME_PATH).toString();
const HEALTH_TIMEOUT_MS = 5000;
/** Read-only rk queries (`rk url`, `rk --version`) — quick, config-derived. */
const RK_QUERY_TIMEOUT_MS = 5000;
/** `rk desktop status` — read-only, but round-trips the GitHub releases API. */
const RK_STATUS_TIMEOUT_MS = 10_000;
/** Daemon lifecycle commands (`rk daemon start/stop/restart`) — tmux work. */
const RK_DAEMON_TIMEOUT_MS = 30_000;
/** `rk remote add` — pure local registration, no ssh roundtrip. */
const RK_REMOTE_ADD_TIMEOUT_MS = 10_000;
/** `rk remote connect` — may bootstrap rk on the remote over ssh. */
const RK_REMOTE_CONNECT_TIMEOUT_MS = 300_000;
/** Suppression window for activation-time reconnects after a success. */
const REMOTE_RECONNECT_SUPPRESS_MS = 15_000;
/** Cadence + cap for the post-start "waiting for the port to answer" poll. */
const DAEMON_START_POLL_MS = 1000;
const DAEMON_START_WAIT_MS = 30_000;
const ALLOWED_PERMISSIONS = new Set([
  "clipboard-read",
  "clipboard-sanitized-write",
  "notifications",
]);

/** Dev-only direct URL (never persisted). Validated once: a value
 *  `normalizeOrigin` rejects (no scheme, non-http) is ignored — it could
 *  neither load nor pass the origin allowlist. The raw value (which may
 *  carry a path) is kept for loading; only its origin joins the allowlist. */
const rawDevUrl = process.env.RK_DESKTOP_URL;
const devUrl =
  rawDevUrl && normalizeOrigin(rawDevUrl).ok ? rawDevUrl : undefined;

let mainWindow: BrowserWindow | null = null;

/** Per-host view registry — pure logic in ./views, handles are WebContentsViews. */
let views: ViewsState<WebContentsView> = emptyViews();

/** Per-host "last main-frame load failed" flags (hostId-keyed, view-scoped):
 *  the remote-tunnel heal reloads ONLY a failed view — a warm view keeps its
 *  live renderer state. Entries die with their view. */
const viewLoadFailed = new Map<string, boolean>();

/** Sentinel registry id for the RK_DESKTOP_URL dev view — never a store
 *  entry, so nothing about it (activeId, lastPath) is ever persisted. */
const DEV_HOST_ID = "__dev__";

const userDataDir = (): string => app.getPath("userData");

type PingResult =
  | { ok: true; origin: string; hostname: string }
  | { ok: false; error: string };

type IpcResult = { ok: true } | { ok: false; error: string };

/** `servers:list` envelope — the channel name AND the `servers` key are the SPA contract. */
type ServersListResult =
  | { ok: true; servers: HostInfo[] }
  | { ok: false; error: string };

type DaemonStatusResult =
  | { ok: true; status: DaemonStatus }
  | { ok: false; error: string };

// ─── URL helpers ────────────────────────────────────────────────────────────

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Origins the window may show in-place: registered hosts + the dev override. */
function registeredOrigins(): Set<string> {
  const origins = new Set(loadHosts(userDataDir()).hosts.map((h) => h.url));
  if (devUrl) {
    const normalized = normalizeOrigin(devUrl);
    if (normalized.ok) origins.add(normalized.origin);
  }
  return origins;
}

function isAllowedNavigation(url: string): boolean {
  if (url.startsWith(WELCOME_URL)) return true;
  const origin = originOf(url);
  return origin !== null && registeredOrigins().has(origin);
}

// ─── Dock/taskbar waiting badge ─────────────────────────────────────────────
//
// The SPA reports its waiting-agent count over `badge:set` (sender-gated like
// `servers:*`). macOS/Linux take `app.setBadgeCount` (0 clears); Windows has
// no dock badge, so the count renders as a taskbar overlay icon whose PNG
// bytes come from the electron-free ./badge module (node:test covered).
// Counts are cached PER VIEW (./views — keyed by webContents id, since a
// sender origin can be shared by several host entries): only the active
// view's reports paint, background views' reports update their cache
// silently, and a switch repaints the incoming view's cached count (0 when
// none). Welcome shows a cleared badge (caches kept); window close clears
// the OS surface.

function applyBadge(count: number): void {
  if (process.platform === "win32") {
    const win = mainWindow;
    if (!win || win.isDestroyed()) return; // clear-on-closed races destruction
    if (count > 0) {
      win.setOverlayIcon(nativeImage.createFromBuffer(badgePng(count)), overlayDescription(count));
    } else {
      win.setOverlayIcon(null, "");
    }
    return;
  }
  app.setBadgeCount(count);
}

function clearBadge(): void {
  applyBadge(0);
}

// ─── Routing ────────────────────────────────────────────────────────────────

function showWelcome(win: BrowserWindow, query?: Record<string, string>): void {
  const current = activeView(views);
  if (current) win.contentView.removeChildView(current.handle);
  views = deactivateViews(views);
  clearBadge(); // painted surface only — the per-view caches are kept
  applyOverlayColor(DEFAULT_STRIP_COLOR); // welcome's static strip color
  void win.loadFile(WELCOME_PATH, query ? { query } : undefined);
}

/**
 * Show the active host (dangling activeId → first host), else welcome.
 * A remembered `lastPath` is restored as-is (and only when the view is
 * created fresh) — staleness (removed window/board, dead host) is the SPA's
 * failure mode, never validated shell-side.
 */
function showActive(win: BrowserWindow): void {
  const active = resolveActiveHost(loadHosts(userDataDir()));
  if (active) {
    attachHostView(active);
  } else {
    showWelcome(win);
  }
}

/**
 * Persist a view's current SPA route (`pathname + search`) for ITS host
 * entry. Views preserve live state, so capture runs only at window close
 * (every live view) and at view destroy — never on switch; restore happens
 * only when a view is created fresh. Keyed directly by the view's host id
 * (a view belongs to exactly one entry — an origin lookup would misattribute
 * a shared-origin background view's route to the ACTIVE entry), guarded so a
 * URL whose origin does not match that entry's origin (mid-navigation,
 * foreign origin) persists nothing. The dev view's sentinel id matches no
 * entry and is never persisted.
 */
function captureLastPathForView(hostId: string, contents: WebContents): void {
  if (contents.isDestroyed()) return;
  const current = contents.getURL();
  if (!current) return;
  let url: URL;
  try {
    url = new URL(current);
  } catch {
    return;
  }
  const host = loadHosts(userDataDir()).hosts.find((h) => h.id === hostId);
  if (!host || host.url !== url.origin) return;
  setHostLastPath(userDataDir(), hostId, url.pathname + url.search);
}

function showStartPage(win: BrowserWindow): void {
  if (devUrl) {
    // Dev override: a single view under a sentinel id — the same per-view
    // wiring (security, theme, badge) as a registered host, nothing persisted.
    attachHostView({ id: DEV_HOST_ID, url: devUrl });
  } else {
    showActive(win);
  }
}

// ─── Host views (one persistent WebContentsView per visited host) ───────────
//
// The window's own webContents serves ONLY the welcome page (and the no-drag
// blank underlay while a view covers it — BLANK_UNDERLAY_URL, see
// blankWelcomeUnderlay); host content lives in per-host WebContentsViews
// attached over the FULL window content bounds — the SPA draws the 28px
// titlebar strip itself, so full-bounds views reproduce today's rendering
// exactly. Views are created lazily on first visit and stay alive until
// their host is removed or the window is torn down; a switch is a
// detach/attach flip, never a reload.

/** Shared hardened webPreferences — the window and every host view. */
function hostWebPreferences(): Electron.WebPreferences {
  return {
    preload: join(__dirname, "preload.js"),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    // Sandboxed preloads read process.argv — this carries app.getVersion().
    additionalArguments: [`--runkit-shell-version=${app.getVersion()}`],
  };
}

/** Apply a strip color to the win/linux window-controls overlay. darwin
 *  returns early (traffic lights are OS-drawn and take no color); a throwing
 *  call degrades silently (partial linux WCO support). */
function applyOverlayColor(color: string): void {
  if (process.platform === "darwin") return;
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;
  try {
    win.setTitleBarOverlay({
      color,
      symbolColor: symbolColorFor(color),
      height: STRIP_HEIGHT_PX,
    });
  } catch {
    // Partial window-controls-overlay support (linux) — degrade silently.
  }
}

/** Views cover the full window content area (the SPA draws its own strip). */
function syncViewBounds(win: BrowserWindow, view: WebContentsView): void {
  const [width, height] = win.getContentSize();
  view.setBounds({ x: 0, y: 0, width, height });
}

function syncActiveViewBounds(win: BrowserWindow): void {
  const entry = activeView(views);
  if (entry) syncViewBounds(win, entry.handle);
}

/**
 * Create + wire a host view. Security wiring beyond webPreferences needs no
 * per-view work: the app-level `web-contents-created` handler (window-open
 * policy + navigation guard) and the session-wide permission handler already
 * cover every webContents created, and IPC sender gating keys on sender-frame
 * origin. What IS per-view: the theme-color cache feeding the overlay, and
 * the version-skew fallback strip with its per-view inserted-CSS key.
 */
function createHostView(hostId: string): WebContentsView {
  const view = new WebContentsView({ webPreferences: hostWebPreferences() });
  view.setBackgroundColor("#0f1117"); // no white flash while the SPA boots
  const contents = view.webContents;

  // Track main-frame load failures per host so the remote-tunnel heal knows
  // whether a reload is needed (a warm view with live state is never
  // reloaded). Transitions are pure (./views nextLoadFailed): a real
  // main-frame failure sets the flag, and ONLY a did-navigate commit clears
  // it — did-finish-load also fires for Chromium's own error page right
  // after did-fail-load, so it must never clear (a dead-tunnel view would
  // otherwise read as healthy and the heal's reload gate would never fire).
  const applyLoadFlag = (event: LoadFlagEvent): void => {
    viewLoadFailed.set(hostId, nextLoadFailed(viewLoadFailed.get(hostId) === true, event));
  };
  contents.on("did-fail-load", (_event, errorCode, _desc, _url, isMainFrame) => {
    applyLoadFlag({ kind: "did-fail-load", isMainFrame, errorCode });
  });

  // Key of the fallback strip CSS injected into this view's CURRENT page load
  // (null when none). Tracked so a theme-color report landing AFTER the
  // injection can recolor the band — `did-finish-load` may run before the
  // page's theme color is observed.
  let fallbackCssKey: string | null = null;
  const refreshFallbackStrip = async (): Promise<void> => {
    if (contents.isDestroyed()) return;
    const url = contents.getURL();
    if (!shouldInjectFallbackStrip(url, registeredOrigins())) return;
    const color = getView(views, hostId)?.themeColor ?? DEFAULT_STRIP_COLOR;
    const stale = fallbackCssKey;
    fallbackCssKey = null;
    try {
      if (stale != null) await contents.removeInsertedCSS(stale);
      fallbackCssKey = await contents.insertCSS(fallbackStripCss(color));
    } catch {
      // A navigation raced the injection — the next did-finish-load re-runs.
    }
  };
  // Inserted CSS does not survive a main-frame navigation; drop the dead key.
  // A did-navigate commit is also the ONE success signal that clears the
  // load-failure flag (it never fires for Chromium's error page).
  contents.on("did-navigate", () => {
    fallbackCssKey = null;
    applyLoadFlag({ kind: "did-navigate" });
  });
  // Cache the page's theme-color per view; repaint the overlay only when this
  // view is the attached one (a background report must not tint the window —
  // the switch seam re-applies the incoming view's cached color instead).
  contents.on("did-change-theme-color", (_event, color) => {
    views = setViewThemeColor(views, hostId, color);
    // Persist the accent per host entry so the host-switcher's edge bar
    // survives cold start. A null report never clears the stored value; the
    // dev sentinel view (__dev__) matches no entry — the membership guard
    // silently covers it. Unchanged values short-circuit (no write).
    if (color !== null) setHostAccentColor(userDataDir(), hostId, color);
    if (views.activeHostId === hostId) {
      applyOverlayColor(color ?? DEFAULT_STRIP_COLOR);
    }
    if (fallbackCssKey != null) void refreshFallbackStrip();
  });
  // Version-skew fallback: an older SPA (no strip) under this hidden-titlebar
  // shell would have no drag surface. Registered-host pages get a minimal
  // draggable band whose CSS no-ops when the SPA-drawn strip marks
  // `html.rk-shell-strip` (CSS is live, so injecting unconditionally is safe).
  contents.on("did-finish-load", () => {
    applyLoadFlag({ kind: "did-finish-load" }); // deliberate no-op transition
    void refreshFallbackStrip();
  });
  return view;
}

/**
 * Blank the welcome page under an attached view: the welcome script polls
 * `daemon:status` (spawning rk subprocesses) on a 3s interval that only dies
 * with its page, and a covered page never learns it is covered. The blank
 * document is BLANK_UNDERLAY_URL — a no-drag `data:` page, NOT about:blank —
 * because about:blank emits no draggable-regions update, leaving the welcome
 * page's full-width drag band cached on this webContents where it would
 * swallow every click on the SPA strip's host-switcher (Electron merges drag
 * regions across webContents without occlusion). A main-initiated load
 * bypasses the will-navigate guard, so the data: URL needs no allowlisting;
 * `showWelcome` reloads the page fresh on demand (re-declaring its own band).
 */
function blankWelcomeUnderlay(win: BrowserWindow): void {
  if (win.webContents.getURL().startsWith(WELCOME_URL)) {
    void win.webContents.loadURL(BLANK_UNDERLAY_URL);
  }
}

/**
 * The attach seam: detach the current view, create the target's view on
 * first visit (loading `url + lastPath` — the ONLY time a view navigates),
 * attach over full bounds, and repaint the OS surfaces (badge, overlay) from
 * the INCOMING view's caches.
 */
function attachHostView(host: {
  id: string;
  url: string;
  lastPath?: string;
  remote?: string;
}): void {
  const win = mainWindow;
  if (!win) return;
  // SSH-only hosts heal their tunnel on activation (never blocking the
  // attach — a warm flip stays instant; a dead view reloads once healed).
  ensureRemoteConnected(host);
  const current = activeView(views);
  let entry = getView(views, host.id);
  let created = false;
  if (!entry) {
    const view = createHostView(host.id);
    views = addView(views, host.id, view, view.webContents.id);
    entry = getView(views, host.id);
    created = true;
  }
  if (!entry) return; // unreachable — addView just registered it
  if (current && current.hostId !== host.id) {
    win.contentView.removeChildView(current.handle);
  }
  win.contentView.addChildView(entry.handle);
  syncViewBounds(win, entry.handle);
  views = activateView(views, host.id);
  const paint = switchPaint(views, host.id);
  applyOverlayColor(paint.themeColor ?? DEFAULT_STRIP_COLOR);
  applyBadge(paint.badgeCount);
  if (created) {
    // Restore is creation-time only: warm switches keep the live route.
    void entry.handle.webContents.loadURL(host.url + (host.lastPath ?? ""));
  }
  entry.handle.webContents.focus();
  blankWelcomeUnderlay(win);
}

/**
 * Destroy a host's view (host removed via Hosts → Remove). Captures lastPath
 * first (a no-op once the store entry is gone — the guard in
 * captureLastPathForView keeps this correct for any future eviction-style
 * caller), detaches when attached, drops the registry entry (badge/theme
 * caches included), and closes the webContents.
 */
function destroyHostView(hostId: string): void {
  const entry = getView(views, hostId);
  if (!entry) return;
  captureLastPathForView(hostId, entry.handle.webContents);
  if (views.activeHostId === hostId && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.contentView.removeChildView(entry.handle);
  }
  views = removeView(views, hostId).state;
  viewLoadFailed.delete(hostId);
  if (!entry.handle.webContents.isDestroyed()) entry.handle.webContents.close();
}

/** Window teardown: drop every view (lastPath was captured on 'close').
 *  Views are window-scoped — a macOS dock-reopen recreates them lazily. */
function destroyAllViews(): void {
  for (const entry of views.entries) {
    if (!entry.handle.webContents.isDestroyed()) entry.handle.webContents.close();
  }
  views = emptyViews();
  viewLoadFailed.clear();
}

// ─── Menu ───────────────────────────────────────────────────────────────────

/**
 * Persist the active id + attach the host's view + rebuild the menu — the
 * ONE switch path, shared by the Hosts menu radio, the `servers:switch` IPC
 * handler, and the local-connect tail. Never a loadURL on an existing view:
 * a warm switch is an instant detach/attach flip that keeps live renderer
 * state (WS/SSE connections, xterm scrollback, scroll position).
 */
function switchToHost(id: string): IpcResult {
  const next = setActiveHost(userDataDir(), id);
  const entry = next.hosts.find((h) => h.id === id);
  if (!entry) return { ok: false, error: "Unknown host" };
  attachHostView(entry);
  rebuildMenu();
  return { ok: true };
}

/**
 * Navigate to the welcome page in add mode — the ONE add-host entry path,
 * shared by the Hosts menu's `Add Host…` item and the `servers:add` IPC
 * handler (the SPA dropdown's `+ Add Host…` footer). The outgoing view stays
 * alive (welcome only detaches it) — lastPath capture happens at window
 * close / view destroy, not here.
 */
function openAddHost(): IpcResult {
  if (!mainWindow) return { ok: false, error: "No window" };
  showWelcome(mainWindow, { mode: "add" });
  return { ok: true };
}

function rebuildMenu(): void {
  const list = loadHosts(userDataDir());
  const callbacks: MenuCallbacks = {
    onSwitchHost: (id) => {
      switchToHost(id);
    },
    onAddHost: () => {
      openAddHost();
    },
    onRemoveHost: (id) => {
      void confirmAndRemoveHost(id);
    },
    onDaemonConnect: () => {
      void (async () => {
        const result = await startAndConnectLocal();
        if (!result.ok) dialog.showErrorBox("Local Daemon", result.error);
      })();
    },
    onDaemonRestart: () => {
      void restartLocalDaemon();
    },
    onDaemonStop: () => {
      void confirmAndStopDaemon();
    },
    onRestartToUpdate: () => {
      restartToUpdate();
    },
  };
  Menu.setApplicationMenu(
    buildMenu(list.hosts, list.activeId, callbacks, daemonMenuInfo, updateMenuInfo),
  );
}

async function confirmAndRemoveHost(id: string): Promise<void> {
  const win = mainWindow;
  if (!win) return;
  const list = loadHosts(userDataDir());
  const entry = list.hosts.find((h) => h.id === id);
  if (!entry) return;
  const wasActive = resolveActiveHost(list)?.id === id;

  const { response } = await dialog.showMessageBox(win, {
    type: "warning",
    buttons: ["Remove", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    message: `Remove "${entry.name}"?`,
    detail: entry.url,
  });
  if (response !== 0) return;

  removeHost(userDataDir(), id);
  destroyHostView(id); // the view dies with its host entry
  rebuildMenu();
  if (wasActive) showActive(win); // first remaining host, or welcome
}

// ─── Health ping (main process — renderer stays sandboxed) ────────────────

function parseHealthBody(body: unknown): { hostname: string } | null {
  if (typeof body !== "object" || body === null) return null;
  if (!("status" in body) || body.status !== "ok") return null;
  const hostname =
    "hostname" in body && typeof body.hostname === "string" ? body.hostname : "";
  return { hostname };
}

async function pingServer(origin: string): Promise<PingResult> {
  let res: Response;
  try {
    res = await net.fetch(`${origin}/api/health`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, error: `No response from ${origin} within 5s` };
  }
  if (!res.ok) {
    return { ok: false, error: `HTTP ${res.status} from ${origin}/api/health` };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, error: "Health response was not JSON — is this an rk server?" };
  }
  const health = parseHealthBody(body);
  if (!health) {
    return { ok: false, error: 'Health response missing status "ok" — is this an rk server?' };
  }
  return { ok: true, origin, hostname: health.hostname };
}

// ─── Local daemon control (explicit user-initiated actions only) ───────────
//
// Detection derives, never assumes: the local origin comes from `rk url`
// (config-derived), health is checked with the SAME `pingServer` probe the
// remote form uses, and a missing binary (ENOENT) is the not-installed state.
// Every subprocess call is execFile with an argument slice and a timeout —
// never a shell string (Constitution I applies to the Node side too).

const execFileAsync = promisify(execFile);

type RkRunResult =
  | { ok: true; stdout: string }
  | { ok: false; error: string; notInstalled: boolean };

/** Resolve the rk binary: fixed candidates first (GUI PATH trap), then PATH. */
function rkBinary(): string {
  return resolveRkBinary(rkCandidatePaths(process.platform), existsSync);
}

/** Extract a useful message from an execFile rejection (stderr wins). */
function execErrorMessage(err: unknown): string {
  if (typeof err === "object" && err !== null) {
    if ("stderr" in err && typeof err.stderr === "string" && err.stderr.trim() !== "") {
      return err.stderr.trim();
    }
    if ("message" in err && typeof err.message === "string") return err.message;
  }
  return "rk invocation failed";
}

function isEnoent(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT";
}

async function runRk(args: string[], timeout: number): Promise<RkRunResult> {
  try {
    // The other half of the GUI PATH trap: resolving the rk BINARY via fixed
    // candidates is not enough — the spawned rk (and the tmux server tree
    // `rk daemon start` creates, which inherits this env wholesale) must also
    // find `tmux` on PATH, so the brew bin dirs are appended when missing.
    const { stdout } = await execFileAsync(rkBinary(), args, {
      timeout,
      env: { ...process.env, PATH: augmentPath(process.platform, process.env.PATH) },
    });
    return { ok: true, stdout };
  } catch (err) {
    return { ok: false, error: execErrorMessage(err), notInstalled: isEnoent(err) };
  }
}

/** Session count for the running detail line — decoration, so any failure is null. */
async function fetchSessionCount(origin: string): Promise<number | null> {
  try {
    const res = await net.fetch(`${origin}/api/sessions`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return parseSessionCount(await res.json());
  } catch {
    return null;
  }
}

/**
 * Derive the local daemon state: `rk --version` (existence + version) →
 * `rk url` (config-derived origin) → health ping (running?) → session count.
 * Also feeds the menu's cached status (rebuilt only on change).
 */
async function probeDaemonStatus(): Promise<DaemonStatusResult> {
  const result = await probeDaemonStatusUncached();
  if (result.ok) updateDaemonMenu(result.status);
  return result;
}

async function probeDaemonStatusUncached(): Promise<DaemonStatusResult> {
  if (process.platform === "win32") return { ok: true, status: { installed: false } };
  const versionRun = await runRk(["--version"], RK_QUERY_TIMEOUT_MS);
  if (!versionRun.ok) {
    if (versionRun.notInstalled) return { ok: true, status: { installed: false } };
    return { ok: false, error: versionRun.error };
  }
  const version = parseRkVersion(versionRun.stdout);
  const urlRun = await runRk(["url"], RK_QUERY_TIMEOUT_MS);
  if (!urlRun.ok) return { ok: false, error: urlRun.error };
  const normalized = normalizeOrigin(urlRun.stdout.trim());
  if (!normalized.ok) {
    return { ok: false, error: `rk url printed "${urlRun.stdout.trim()}" — not a valid URL` };
  }
  const origin = normalized.origin;
  const ping = await pingServer(origin);
  if (!ping.ok) {
    return { ok: true, status: { installed: true, running: false, version, origin } };
  }
  const sessions = await fetchSessionCount(origin);
  return {
    ok: true,
    status: { installed: true, running: true, version, origin, hostname: ping.hostname, sessions },
  };
}

/** Poll `/api/health` until it answers or the start-wait cap elapses. */
async function waitForHealth(origin: string): Promise<PingResult> {
  const deadline = Date.now() + DAEMON_START_WAIT_MS;
  for (;;) {
    const ping = await pingServer(origin);
    if (ping.ok) return ping;
    if (Date.now() >= deadline) {
      return {
        ok: false,
        error: `Daemon started but ${origin} did not answer within ${DAEMON_START_WAIT_MS / 1000}s`,
      };
    }
    await delay(DAEMON_START_POLL_MS);
  }
}

/**
 * Activate-or-add the local host — the connect tail shared by the card and
 * the menu. An existing entry for the origin is activated (never duplicated,
 * `addHost` does not dedupe); otherwise the existing add-host path runs
 * with the name auto-derived from the ping hostname (origin fallback in the
 * store).
 */
function connectLocalHost(origin: string, hostname: string): IpcResult {
  const existing = findHostByOrigin(loadHosts(userDataDir()), origin);
  if (existing) return switchToHost(existing.id);
  const added = addHost(userDataDir(), hostname, origin);
  if (!added.ok) return added;
  return switchToHost(added.host.id); // attaches the fresh view + rebuilds the menu
}

/**
 * The ONE get-in flow (`daemon:start` + the menu's Connect): start the daemon
 * when stopped (a `daemon already running` error is already-started success),
 * wait for health, then connect. Never runs without an explicit user action.
 */
async function startAndConnectLocal(): Promise<IpcResult> {
  const probe = await probeDaemonStatus();
  if (!probe.ok) return probe;
  const status = probe.status;
  if (!status.installed) return { ok: false, error: "run-kit is not installed" };
  let hostname: string;
  if (status.running) {
    hostname = status.hostname;
  } else {
    const started = await runRk(["daemon", "start"], RK_DAEMON_TIMEOUT_MS);
    if (!started.ok && !isDaemonAlreadyRunning(started.error)) {
      return { ok: false, error: started.error };
    }
    const ping = await waitForHealth(status.origin);
    if (!ping.ok) {
      void refreshDaemonMenu();
      return ping;
    }
    hostname = ping.hostname;
  }
  const connected = connectLocalHost(status.origin, hostname);
  void refreshDaemonMenu();
  return connected;
}

/**
 * Confirm-then-stop — ONE path shared by the welcome card's Stop button and
 * the Local Daemon menu item. Cancel is the default (the Remove-host
 * precedent); the copy states that tmux sessions survive (Constitution VI —
 * the tmux layer is independent of the server, so stop is low-stakes).
 */
async function confirmAndStopDaemon(): Promise<IpcResult> {
  const win = mainWindow;
  if (!win) return { ok: false, error: "No window" };
  const { response } = await dialog.showMessageBox(win, {
    type: "question",
    buttons: ["Stop Daemon", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    message: "Stop the local run-kit daemon?",
    detail:
      "Only the web server stops — tmux sessions and running agents survive and reattach when the daemon starts again.",
  });
  if (response !== 0) return { ok: true };
  const stopped = await runRk(["daemon", "stop"], RK_DAEMON_TIMEOUT_MS);
  await refreshDaemonMenu();
  if (!stopped.ok) return { ok: false, error: stopped.error };
  return { ok: true };
}

/** Menu Restart → `rk daemon restart` (the existing command; no stop+start composition). */
async function restartLocalDaemon(): Promise<void> {
  const restarted = await runRk(["daemon", "restart"], RK_DAEMON_TIMEOUT_MS);
  await refreshDaemonMenu();
  if (!restarted.ok) dialog.showErrorBox("Local Daemon", restarted.error);
}

// ─── SSH remote hosts (rk remote — explicit user-initiated actions only) ────
//
// The CLI owns bootstrap and tunnel lifecycle; the shell only runs
// user-initiated `rk remote add` / `rk remote connect` via execFile (argument
// slices + timeouts — Constitution I applies to the Node side too) and
// parses the CLI's stable stdout contracts (./remote-host, node:test
// covered). Progress rides connect's stderr chatter, streamed line-by-line
// to the welcome page.

/**
 * Streamed variant of runRk for `rk remote connect`: stderr chatter lines
 * are relayed to onLine as they arrive (the welcome progress feed) while
 * stdout is buffered for the origin data line.
 */
function runRkStreaming(
  args: string[],
  timeout: number,
  onLine: (line: string) => void,
): Promise<RkRunResult> {
  return new Promise((resolve) => {
    const splitter = createLineSplitter();
    const child = execFile(
      rkBinary(),
      args,
      {
        timeout,
        env: { ...process.env, PATH: augmentPath(process.platform, process.env.PATH) },
      },
      (err, stdout, stderr) => {
        for (const line of splitter.flush()) onLine(line);
        if (err) {
          // Raw-callback execFile attaches no `stderr` to its error (unlike
          // the promisified runRk), so both branches below avoid node's
          // "Command failed: /abs/path/rk …" fallback, which leaks the
          // binary path: a timeout is named explicitly, and any other
          // failure prefers the callback's own stderr (where cobra's final
          // "Error:" block lives).
          const failure = stderr.trim();
          const error = isExecTimeout(err)
            ? rkTimeoutMessage(args, timeout)
            : failure || execErrorMessage(err);
          resolve({ ok: false, error, notInstalled: isEnoent(err) });
          return;
        }
        resolve({ ok: true, stdout });
      },
    );
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      for (const line of splitter.push(chunk)) onLine(line);
    });
  });
}

/**
 * Reduce a failed connect's stderr (progress chatter + cobra's final
 * "Error: …" block) to the error block alone — the progress lines were
 * already streamed to the renderer.
 */
function remoteErrorMessage(full: string): string {
  const idx = full.lastIndexOf("Error:");
  return idx >= 0 ? full.slice(idx).trim() : full;
}

/**
 * The welcome "or over SSH" flow: register (idempotent `rk remote add`,
 * labeled-line output) → connect (streamed progress) → health-ping the
 * local origin (the same `pingServer` gate the URL rung uses — a tunnel
 * that accepts TCP but does not answer /api/health persists nothing) →
 * activate-or-add the host entry carrying the `remote` name → switchToHost.
 * Never runs without an explicit user action.
 */
async function connectRemoteHost(
  target: string,
  onProgress: (line: string) => void,
): Promise<IpcResult> {
  const added = await runRk(["remote", "add", target], RK_REMOTE_ADD_TIMEOUT_MS);
  if (!added.ok) {
    if (added.notInstalled) {
      return { ok: false, error: "run-kit is not installed on this machine" };
    }
    return { ok: false, error: remoteErrorMessage(added.error) };
  }
  const info = parseRemoteAddOutput(added.stdout);
  if (!info) {
    return { ok: false, error: "Unexpected `rk remote add` output — update run-kit and retry" };
  }

  const connected = await runRkStreaming(
    ["remote", "connect", info.name],
    RK_REMOTE_CONNECT_TIMEOUT_MS,
    onProgress,
  );
  if (!connected.ok) return { ok: false, error: remoteErrorMessage(connected.error) };
  const origin = parseConnectOrigin(connected.stdout) ?? info.origin;

  // Health-gate before persisting: the tunnel is up, but only an rk server
  // answering /api/health earns a host entry (the URL rung's contract). A
  // failed ping surfaces inline and leaves hosts.json — and the reconnect
  // suppression window — untouched.
  const ping = await pingServer(origin);
  if (!ping.ok) return { ok: false, error: ping.error };
  markRemoteConnected(info.name);

  // Dedupe on the remote name — the stable identity for SSH hosts (several
  // entries can share an origin, but one remote is one host).
  const existing = loadHosts(userDataDir()).hosts.find((h) => h.remote === info.name);
  if (existing) return switchToHost(existing.id);
  const addedHost = addHost(userDataDir(), info.name, origin, info.name);
  if (!addedHost.ok) return addedHost;
  return switchToHost(addedHost.host.id); // attaches the fresh view + rebuilds the menu
}

// Activation-time heal guards: one connect in flight per remote, and a short
// suppression window after a success so the welcome flow's switchToHost does
// not immediately re-run the connect it just finished.
const remoteConnectsInFlight = new Set<string>();
const remoteConnectedAt = new Map<string, number>();

function markRemoteConnected(name: string): void {
  remoteConnectedAt.set(name, Date.now());
}

/**
 * Re-run `rk remote connect` when a remote-carrying host is activated —
 * non-blocking (the attach seam stays an instant flip): the idempotent
 * connect heals a dead tunnel in the background, and only a view whose last
 * main-frame load FAILED is reloaded afterwards (a live view keeps its
 * state; its sockets reconnect on their own once the tunnel is back).
 */
function ensureRemoteConnected(host: {
  id: string;
  url: string;
  lastPath?: string;
  remote?: string;
}): void {
  const name = host.remote;
  if (name === undefined || name === "") return;
  if (remoteConnectsInFlight.has(name)) return;
  const lastOk = remoteConnectedAt.get(name);
  if (lastOk !== undefined && Date.now() - lastOk < REMOTE_RECONNECT_SUPPRESS_MS) return;

  remoteConnectsInFlight.add(name);
  void (async () => {
    try {
      const run = await runRkStreaming(
        ["remote", "connect", name],
        RK_REMOTE_CONNECT_TIMEOUT_MS,
        () => {},
      );
      if (!run.ok) {
        dialog.showErrorBox(`Remote Host: ${name}`, remoteErrorMessage(run.error));
        return;
      }
      markRemoteConnected(name);
      if (viewLoadFailed.get(host.id) === true) {
        const entry = getView(views, host.id);
        if (entry && !entry.handle.webContents.isDestroyed()) {
          viewLoadFailed.set(host.id, false);
          void entry.handle.webContents.loadURL(host.url + (host.lastPath ?? ""));
        }
      }
    } finally {
      remoteConnectsInFlight.delete(name);
    }
  })();
}

// Cached menu-relevant daemon info. Application menus have no reliable
// about-to-open event, so the cache refreshes on startup, window focus,
// after daemon actions, and via the welcome page's status polls — and the
// menu is rebuilt only when the relevant info actually changes.
let daemonMenuInfo: DaemonMenuInfo | null = null;

function toDaemonMenuInfo(status: DaemonStatus): DaemonMenuInfo | null {
  if (!status.installed) return null;
  return { running: status.running, version: status.version };
}

function sameDaemonMenuInfo(a: DaemonMenuInfo | null, b: DaemonMenuInfo | null): boolean {
  if (a === null || b === null) return a === b;
  return a.running === b.running && a.version === b.version;
}

function updateDaemonMenu(status: DaemonStatus): void {
  const next = toDaemonMenuInfo(status);
  if (sameDaemonMenuInfo(next, daemonMenuInfo)) return;
  daemonMenuInfo = next;
  rebuildMenu();
}

/** Re-probe and rebuild the menu when the daemon state changed. */
async function refreshDaemonMenu(): Promise<void> {
  await probeDaemonStatus(); // updateDaemonMenu runs inside on success
}

// ─── Desktop-app update check ("Restart to Update") ─────────────────────────
//
// Read-only detection: `rk desktop status` (stdout is stable data lines —
// parsed in ./update-check, node:test covered) tells us whether a newer
// desktop release exists. darwin-only (`rk desktop` is macOS-only), checked
// at natural events (startup, window focus) through a 1h throttle — the
// status call round-trips the GitHub releases API, so no perpetual timer
// (the daemonMenuInfo cache pattern). Every absence state — non-darwin, rk
// missing, status failure, app not installed, up to date — is SILENT: null
// cache, no menu item, no error surface.

let updateMenuInfo: UpdateMenuInfo | null = null;
/** Epoch ms of the last check ATTEMPT (failures consume the window too). */
let lastUpdateCheckAt: number | null = null;

function sameUpdateMenuInfo(a: UpdateMenuInfo | null, b: UpdateMenuInfo | null): boolean {
  if (a === null || b === null) return a === b;
  return a.latestVersion === b.latestVersion && a.updating === b.updating;
}

function setUpdateMenuInfo(next: UpdateMenuInfo | null): void {
  if (sameUpdateMenuInfo(next, updateMenuInfo)) return;
  updateMenuInfo = next;
  rebuildMenu();
}

/** Throttled `rk desktop status` check → change-gated menu rebuild. */
async function refreshUpdateMenu(): Promise<void> {
  if (process.platform !== "darwin") return;
  // Never rewrite the cache mid-update: after a successful spawn the CLI owns
  // the outcome, and a focus-triggered check must not re-enable the item.
  if (updateMenuInfo?.updating) return;
  if (!isUpdateCheckDue(lastUpdateCheckAt, Date.now())) return;
  lastUpdateCheckAt = Date.now();
  const run = await runRk(["desktop", "status"], RK_STATUS_TIMEOUT_MS);
  // Re-check after the await: "Restart to Update" may have been clicked while
  // the status probe was in flight — writing here would clobber the updating
  // state and re-enable the item mid-update (same invariant as the pre-await
  // guard above).
  if (updateMenuInfo?.updating) return;
  const latest = run.ok ? availableUpdateVersion(run.stdout) : null;
  setUpdateMenuInfo(latest === null ? null : { latestVersion: latest, updating: false });
}

/**
 * The menu item's click: spawn `rk desktop update` fully DETACHED — the CLI
 * stages the download, quits this app gracefully (the window `close` handler
 * captures lastPath for the relaunch restore), swaps the bundle atomically,
 * and relaunches it; detachment (+ unref, stdio ignored) is what lets the
 * child survive its parent being quit. The shell adds no updater logic and
 * never touches its own bundle. After a successful spawn the item just reads
 * "Updating…" (disabled) until the quit arrives — post-spawn outcomes are the
 * CLI's responsibility. Only a failure of the spawn itself (binary vanished)
 * surfaces, via the existing native-dialog error pattern.
 */
function restartToUpdate(): void {
  const current = updateMenuInfo;
  if (current === null || current.updating) return;
  const child = spawn(rkBinary(), ["desktop", "update"], {
    detached: true,
    stdio: "ignore",
    // Same GUI-PATH posture as runRk: a Finder-launched app's PATH misses the
    // brew dirs the spawned rk may need.
    env: { ...process.env, PATH: augmentPath(process.platform, process.env.PATH) },
  });
  child.on("error", (err) => {
    // Spawn failure (ENOENT and friends) — re-enable the item for a retry.
    setUpdateMenuInfo({ latestVersion: current.latestVersion, updating: false });
    dialog.showErrorBox("Restart to Update", err.message);
  });
  child.unref();
  setUpdateMenuInfo({ latestVersion: current.latestVersion, updating: true });
}

// ─── IPC (sender-frame gated) ───────────────────────────────────────────────

/**
 * Privilege gate: `welcome:*` calls are honored only from the welcome
 * file:// page. Pages loaded from registered hosts can read
 * `runkitShell.version`/`platform` but never invoke privileged calls.
 */
function isWelcomeSender(event: IpcMainInvokeEvent): boolean {
  return event.senderFrame?.url.startsWith(WELCOME_URL) ?? false;
}

/**
 * Privilege gate for `servers:*` (the SPA-facing channel family, named for
 * that contract) — a wider allowlist than `welcome:*`: registered host
 * origins (the pages that host the SPA palette) plus the welcome page. Same
 * set as the navigation guard; any other sender gets a rejection, never a
 * privileged action.
 */
function isHostsSender(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url;
  return url !== undefined && isAllowedNavigation(url);
}

function parseAddPayload(value: unknown): { name: string; url: string } | null {
  if (typeof value !== "object" || value === null) return null;
  if (!("url" in value) || typeof value.url !== "string") return null;
  const name = "name" in value && typeof value.name === "string" ? value.name : "";
  return { name, url: value.url };
}

function parseReorderPayload(value: unknown): { id: string; toIndex: number } | null {
  if (typeof value !== "object" || value === null) return null;
  if (!("id" in value) || typeof value.id !== "string") return null;
  if (!("toIndex" in value) || typeof value.toIndex !== "number") return null;
  if (!Number.isInteger(value.toIndex) || value.toIndex < 0) return null;
  return { id: value.id, toIndex: value.toIndex };
}

function registerIpcHandlers(): void {
  ipcMain.handle(
    "welcome:test-host",
    async (event, rawUrl: unknown): Promise<PingResult> => {
      if (!isWelcomeSender(event)) return { ok: false, error: "Not allowed" };
      if (typeof rawUrl !== "string") return { ok: false, error: "Invalid request" };
      const normalized = normalizeOrigin(rawUrl);
      if (!normalized.ok) return normalized;
      return pingServer(normalized.origin);
    },
  );

  ipcMain.handle("welcome:add-host", (event, payload: unknown): IpcResult => {
    if (!isWelcomeSender(event)) return { ok: false, error: "Not allowed" };
    const parsed = parseAddPayload(payload);
    if (!parsed) return { ok: false, error: "Invalid request" };
    const result = addHost(userDataDir(), parsed.name, parsed.url);
    if (!result.ok) return result;
    return switchToHost(result.host.id); // attaches the fresh view + rebuilds the menu
  });

  ipcMain.handle("welcome:cancel", (event): IpcResult => {
    if (!isWelcomeSender(event)) return { ok: false, error: "Not allowed" };
    if (mainWindow) showActive(mainWindow);
    return { ok: true };
  });

  // daemon:* — welcome-page-only surface (the menu calls the same functions
  // main-side). Every action is user-initiated; there is no auto-start.
  ipcMain.handle("daemon:status", async (event): Promise<DaemonStatusResult> => {
    if (!isWelcomeSender(event)) return { ok: false, error: "Not allowed" };
    return probeDaemonStatus();
  });

  ipcMain.handle("daemon:start", async (event): Promise<IpcResult> => {
    if (!isWelcomeSender(event)) return { ok: false, error: "Not allowed" };
    return startAndConnectLocal();
  });

  ipcMain.handle("daemon:stop", async (event): Promise<IpcResult> => {
    if (!isWelcomeSender(event)) return { ok: false, error: "Not allowed" };
    return confirmAndStopDaemon();
  });

  // remote:* — welcome-page-only surface (the SSH rung). Main runs the CLI
  // and streams connect's chatter back over `remote:progress` sends.
  ipcMain.handle("remote:connect", async (event, rawTarget: unknown): Promise<IpcResult> => {
    if (!isWelcomeSender(event)) return { ok: false, error: "Not allowed" };
    if (typeof rawTarget !== "string" || rawTarget.trim() === "") {
      return { ok: false, error: "Enter an SSH target — user@host or a ~/.ssh/config alias" };
    }
    const sender = event.sender;
    return connectRemoteHost(rawTarget.trim(), (line) => {
      if (!sender.isDestroyed()) sender.send("remote:progress", line);
    });
  });

  // servers:* — the web SPA's contract (app/frontend/src/lib/shell.ts): the
  // channel names AND the `servers` envelope key stay, even though the
  // entries are hosts shell-side.
  ipcMain.handle("servers:list", (event): ServersListResult => {
    if (!isHostsSender(event)) return { ok: false, error: "Not allowed" };
    // Join the store projection with the view registry's cached badge counts:
    // a host with a live view whose last `badge:set` report was > 0 carries
    // `waiting` (the switcher menu's amber ● N); never-visited hosts (no
    // view) and zero counts omit the field. The menu refetches on every
    // open, so this open-time snapshot needs no subscription.
    const servers = hostInfos(loadHosts(userDataDir())).map((info) => {
      const view = getView(views, info.id);
      return view !== null && view.badgeCount > 0
        ? { ...info, waiting: view.badgeCount }
        : info;
    });
    return { ok: true, servers };
  });

  ipcMain.handle("servers:switch", (event, id: unknown): IpcResult => {
    if (!isHostsSender(event)) return { ok: false, error: "Not allowed" };
    if (typeof id !== "string") return { ok: false, error: "Invalid request" };
    return switchToHost(id);
  });

  // servers:add — the SPA dropdown's `+ Add Host…` footer. Navigation-only
  // (no payload, no store write): it opens the welcome page in add mode via
  // the same openAddHost path the Hosts menu item takes; the actual
  // registration still happens through the welcome page's own gated
  // `welcome:add-host` flow.
  ipcMain.handle("servers:add", (event): IpcResult => {
    if (!isHostsSender(event)) return { ok: false, error: "Not allowed" };
    return openAddHost();
  });

  // servers:reorder — move-by-id ({id, toIndex}); a full-array payload would
  // trust renderer-supplied order, so only the immutable id + target index
  // cross the bridge. List order IS the native menu's accelerator map, so a
  // committed move rebuilds the menu to re-derive the ⌥⌘1–9/⇧Ctrl+1–9
  // bindings. An unknown id is the store's no-op convention (still ok — the
  // rebuild is harmless), not an error.
  ipcMain.handle("servers:reorder", (event, payload: unknown): IpcResult => {
    if (!isHostsSender(event)) return { ok: false, error: "Not allowed" };
    const parsed = parseReorderPayload(payload);
    if (!parsed) return { ok: false, error: "Invalid request" };
    moveHost(userDataDir(), parsed.id, parsed.toIndex);
    rebuildMenu();
    return { ok: true };
  });

  // badge:* — the SPA's waiting-agent count report, gated exactly like
  // `servers:*` (registered host origins + welcome). Structurally validated:
  // only a non-negative integer reaches the OS badge surface. Counts are
  // cached PER VIEW (resolved from the sender's webContents id — origins can
  // be shared by several entries): only the active view's report paints;
  // background reports update their cache silently, and the switch seam
  // repaints from the incoming view's cache.
  ipcMain.handle("badge:set", (event, count: unknown): IpcResult => {
    if (!isHostsSender(event)) return { ok: false, error: "Not allowed" };
    if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
      return { ok: false, error: "Invalid request" };
    }
    const entry = findViewByWebContentsId(views, event.sender.id);
    if (entry) {
      views = setViewBadge(views, entry.hostId, count);
      if (views.activeHostId === entry.hostId) applyBadge(count);
      return { ok: true };
    }
    // The welcome page (the window's own webContents) keeps direct paint; any
    // other allowed-but-unknown sender (a just-destroyed view's late report)
    // must not paint a surface it no longer backs.
    if (mainWindow && event.sender.id === mainWindow.webContents.id) {
      applyBadge(count);
    }
    return { ok: true };
  });
}

// ─── Window + security wiring ───────────────────────────────────────────────

function openMainWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: "#0f1117",
    // Hidden native titlebar: the page's top edge is the visible "titlebar"
    // (the SPA draws a 28px accent strip; ./strip's fallback CSS covers older
    // SPAs). macOS composites the traffic lights over the strip; win/linux
    // draw native window controls over its right end via the overlay. The
    // overlay always renders ABOVE attached views.
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    ...(process.platform !== "darwin"
      ? {
          titleBarOverlay: {
            color: DEFAULT_STRIP_COLOR,
            symbolColor: symbolColorFor(DEFAULT_STRIP_COLOR),
            height: STRIP_HEIGHT_PX,
          },
        }
      : {}),
    webPreferences: hostWebPreferences(),
  });
  // The window's own webContents only ever shows the welcome page (its
  // theme/strip needs are static) — the per-view wiring lives in
  // createHostView. Views do not auto-resize with the window, so every size
  // transition re-syncs the attached view's bounds.
  win.on("resize", () => syncActiveViewBounds(win));
  win.on("enter-full-screen", () => syncActiveViewBounds(win));
  win.on("leave-full-screen", () => syncActiveViewBounds(win));
  // Capture-on-quit for EVERY live view: cold-start restore reflects each
  // host's route at close, not just the active one's (webContents are still
  // readable during 'close').
  win.on("close", () => {
    for (const entry of views.entries) {
      captureLastPathForView(entry.hostId, entry.handle.webContents);
    }
  });
  win.on("closed", () => {
    // A lingering dock badge would report a count no window backs (macOS
    // keeps the app alive after window-all-closed). Views are window-scoped —
    // a macOS dock-reopen recreates them lazily from the captured routes.
    clearBadge();
    destroyAllViews();
    if (mainWindow === win) mainWindow = null;
  });
  mainWindow = win;
  showStartPage(win);
}

app.on("web-contents-created", (_event, contents) => {
  // New windows are always denied; every http(s) target — registered origins
  // included — goes to the system browser (policy in ./window-open, covered by
  // node:test). There is no in-window branch: a new-window intent never
  // navigates the shell window.
  contents.setWindowOpenHandler(({ url }) => {
    if (windowOpenAction(url) === "open-external") void shell.openExternal(url);
    return { action: "deny" };
  });

  // One guard for both user navigation and host-issued redirects — a
  // registered host must not be able to escape in-window via a redirect.
  // Blocked targets forward to the system: http(s) to the browser, and
  // allowlisted editor deeplinks (`vscode:`/`cursor:`/`windsurf:` — the SPA's
  // "Open in app" targets assign them to window.location.href) to the editor
  // (260801-sm6g; previously silently dropped). The allowlist lives in
  // ./window-open beside its node:test coverage.
  const guardNavigation = (
    event: { preventDefault: () => void },
    url: string,
  ): void => {
    if (isAllowedNavigation(url)) return;
    event.preventDefault();
    if (isHttpUrl(url) || isEditorDeeplink(url)) void shell.openExternal(url);
  };
  contents.on("will-navigate", guardNavigation);
  contents.on("will-redirect", guardNavigation);
});

// No 'certificate-error' handler: TLS errors fail closed (no bypass).

void app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission));
  });

  registerIpcHandlers();
  rebuildMenu();
  openMainWindow();

  // Seed the Local Daemon menu state (read-only detection — never a start),
  // and keep it fresh on focus; the welcome page's polls also feed the cache.
  // The desktop-update check rides the same natural events, behind its own
  // 1h throttle (refreshUpdateMenu gates internally).
  void refreshDaemonMenu();
  void refreshUpdateMenu();
  app.on("browser-window-focus", () => {
    void refreshDaemonMenu();
    void refreshUpdateMenu();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) openMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
