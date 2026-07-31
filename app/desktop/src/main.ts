/**
 * Main process — lifecycle, BrowserWindow, security wiring, IPC, the
 * welcome.html ↔ active-host-URL routing, and local-daemon control.
 * ("Host" = an rk instance; "server" is reserved for tmux servers. The
 * `servers:*` IPC channels and the bridge's `servers` group keep their
 * names — they are the web SPA's contract.)
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
  net,
  session,
  shell,
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
  parseRkVersion,
  parseSessionCount,
  resolveRkBinary,
  rkCandidatePaths,
} from "./local-daemon";
import { buildMenu, DaemonMenuInfo, MenuCallbacks, UpdateMenuInfo } from "./menu";
import { availableUpdateVersion, isUpdateCheckDue } from "./update-check";
import { isHttpUrl, windowOpenAction } from "./window-open";
import {
  addHost,
  findHostByOrigin,
  HostInfo,
  hostInfos,
  loadHosts,
  normalizeOrigin,
  removeHost,
  resolveActiveHost,
  setActiveHost,
  setHostLastPath,
} from "./hosts";

const WELCOME_PATH = join(__dirname, "welcome", "welcome.html");
const WELCOME_URL = pathToFileURL(WELCOME_PATH).toString();
const HEALTH_TIMEOUT_MS = 5000;
/** Read-only rk queries (`rk url`, `rk --version`) — quick, config-derived. */
const RK_QUERY_TIMEOUT_MS = 5000;
/** `rk desktop status` — read-only, but round-trips the GitHub releases API. */
const RK_STATUS_TIMEOUT_MS = 10_000;
/** Daemon lifecycle commands (`rk daemon start/stop/restart`) — tmux work. */
const RK_DAEMON_TIMEOUT_MS = 30_000;
/** Cadence + cap for the post-start "waiting for the port to answer" poll. */
const DAEMON_START_POLL_MS = 1000;
const DAEMON_START_WAIT_MS = 30_000;
const ALLOWED_PERMISSIONS = new Set([
  "clipboard-read",
  "clipboard-sanitized-write",
  "notifications",
]);

/** Dev-only direct URL (never persisted). */
const devUrl = process.env.RK_DESKTOP_URL;

let mainWindow: BrowserWindow | null = null;

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

// ─── Routing ────────────────────────────────────────────────────────────────

function showWelcome(win: BrowserWindow, query?: Record<string, string>): void {
  void win.loadFile(WELCOME_PATH, query ? { query } : undefined);
}

/**
 * Load the active host (dangling activeId → first host), else welcome.
 * A remembered `lastPath` is restored as-is — staleness (removed window/board,
 * dead host) is the SPA's failure mode, never validated shell-side.
 */
function showActive(win: BrowserWindow): void {
  const active = resolveActiveHost(loadHosts(userDataDir()));
  if (active) {
    void win.loadURL(active.url + (active.lastPath ?? ""));
  } else {
    showWelcome(win);
  }
}

/**
 * Persist the current SPA route (`pathname + search`) for the registered
 * host whose origin the window is showing. Called at every shell-initiated
 * navigation away from a host (switch, add) and on window close.
 * Guards: the welcome file:// page is never captured, and a URL whose origin
 * matches no registered host (mid-navigation, foreign origin) is ignored —
 * so one host's route can never pollute another host's entry. When several
 * entries share the origin, the active entry wins (see `findHostByOrigin`).
 */
function captureLastPath(): void {
  const current = mainWindow?.webContents.getURL();
  if (!current || current.startsWith(WELCOME_URL)) return;
  let url: URL;
  try {
    url = new URL(current);
  } catch {
    return;
  }
  const entry = findHostByOrigin(loadHosts(userDataDir()), url.origin);
  if (!entry) return;
  setHostLastPath(userDataDir(), entry.id, url.pathname + url.search);
}

function showStartPage(win: BrowserWindow): void {
  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    showActive(win);
  }
}

// ─── Menu ───────────────────────────────────────────────────────────────────

/**
 * Set active + load its URL + rebuild the menu — the ONE switch path, shared
 * by the Hosts menu radio and the `servers:switch` IPC handler.
 */
function switchToHost(id: string): IpcResult {
  captureLastPath();
  const next = setActiveHost(userDataDir(), id);
  const entry = next.hosts.find((h) => h.id === id);
  if (!entry) return { ok: false, error: "Unknown host" };
  if (mainWindow) void mainWindow.loadURL(entry.url + (entry.lastPath ?? ""));
  rebuildMenu();
  return { ok: true };
}

function rebuildMenu(): void {
  const list = loadHosts(userDataDir());
  const callbacks: MenuCallbacks = {
    onSwitchHost: (id) => {
      switchToHost(id);
    },
    onAddHost: () => {
      if (!mainWindow) return;
      captureLastPath();
      showWelcome(mainWindow, { mode: "add" });
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
  captureLastPath();
  const added = addHost(userDataDir(), hostname, origin);
  if (!added.ok) return added;
  rebuildMenu();
  if (mainWindow) void mainWindow.loadURL(added.host.url);
  return { ok: true };
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
    rebuildMenu();
    if (mainWindow) void mainWindow.loadURL(result.host.url);
    return { ok: true };
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

  // servers:* — the web SPA's contract (app/frontend/src/lib/shell.ts): the
  // channel names AND the `servers` envelope key stay, even though the
  // entries are hosts shell-side.
  ipcMain.handle("servers:list", (event): ServersListResult => {
    if (!isHostsSender(event)) return { ok: false, error: "Not allowed" };
    return { ok: true, servers: hostInfos(loadHosts(userDataDir())) };
  });

  ipcMain.handle("servers:switch", (event, id: unknown): IpcResult => {
    if (!isHostsSender(event)) return { ok: false, error: "Not allowed" };
    if (typeof id !== "string") return { ok: false, error: "Invalid request" };
    return switchToHost(id);
  });
}

// ─── Window + security wiring ───────────────────────────────────────────────

function openMainWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: "#0f1117",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Sandboxed preloads read process.argv — this carries app.getVersion().
      additionalArguments: [`--runkit-shell-version=${app.getVersion()}`],
    },
  });
  // Capture-on-quit: cold-start restore reflects the route at close, not just
  // the last switch-away (webContents is still readable during 'close').
  win.on("close", () => {
    captureLastPath();
  });
  win.on("closed", () => {
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
  const guardNavigation = (
    event: { preventDefault: () => void },
    url: string,
  ): void => {
    if (isAllowedNavigation(url)) return;
    event.preventDefault();
    if (isHttpUrl(url)) void shell.openExternal(url);
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
