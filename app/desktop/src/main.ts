/**
 * Main process — lifecycle, BrowserWindow, security wiring, IPC, and the
 * welcome.html ↔ active-server-URL routing.
 *
 * This shell is a VIEWER ONLY (Constitution VI): it loads an existing
 * `rk serve` URL and NEVER spawns or supervises the rk daemon — no
 * child_process anywhere in this package.
 *
 * Dev override: `RK_DESKTOP_URL=http://localhost:3000 just dev-desktop`
 * loads that URL directly without persisting it to servers.json.
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
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildMenu } from "./menu";
import { isHttpUrl, windowOpenAction } from "./window-open";
import {
  addServer,
  findServerByOrigin,
  loadServers,
  normalizeOrigin,
  removeServer,
  renameServer,
  resolveActiveServer,
  ServerInfo,
  serverInfos,
  setActiveServer,
  setServerLastPath,
} from "./servers";

const WELCOME_PATH = join(__dirname, "welcome", "welcome.html");
const WELCOME_URL = pathToFileURL(WELCOME_PATH).toString();
const HEALTH_TIMEOUT_MS = 5000;
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

type ServersListResult =
  | { ok: true; servers: ServerInfo[] }
  | { ok: false; error: string };

// ─── URL helpers ────────────────────────────────────────────────────────────

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Origins the window may show in-place: registered servers + the dev override. */
function registeredOrigins(): Set<string> {
  const origins = new Set(loadServers(userDataDir()).servers.map((s) => s.url));
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
 * Load the active server (dangling activeId → first server), else welcome.
 * A remembered `lastPath` is restored as-is — staleness (removed window/board,
 * dead server) is the SPA's failure mode, never validated shell-side.
 */
function showActive(win: BrowserWindow): void {
  const active = resolveActiveServer(loadServers(userDataDir()));
  if (active) {
    void win.loadURL(active.url + (active.lastPath ?? ""));
  } else {
    showWelcome(win);
  }
}

/**
 * Persist the current SPA route (`pathname + search`) for the registered
 * server whose origin the window is showing. Called at every shell-initiated
 * navigation away from a server (switch, add, rename) and on window close.
 * Guards: the welcome file:// page is never captured, and a URL whose origin
 * matches no registered server (mid-navigation, foreign origin) is ignored —
 * so one server's route can never pollute another server's entry. When several
 * entries share the origin, the active entry wins (see `findServerByOrigin`).
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
  const entry = findServerByOrigin(loadServers(userDataDir()), url.origin);
  if (!entry) return;
  setServerLastPath(userDataDir(), entry.id, url.pathname + url.search);
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
 * by the Servers menu radio and the `servers:switch` IPC handler.
 */
function switchToServer(id: string): IpcResult {
  captureLastPath();
  const next = setActiveServer(userDataDir(), id);
  const entry = next.servers.find((s) => s.id === id);
  if (!entry) return { ok: false, error: "Unknown server" };
  if (mainWindow) void mainWindow.loadURL(entry.url + (entry.lastPath ?? ""));
  rebuildMenu();
  return { ok: true };
}

function rebuildMenu(): void {
  const list = loadServers(userDataDir());
  Menu.setApplicationMenu(
    buildMenu(list.servers, list.activeId, {
      onSwitchServer: (id) => {
        switchToServer(id);
      },
      onAddServer: () => {
        if (!mainWindow) return;
        captureLastPath();
        showWelcome(mainWindow, { mode: "add" });
      },
      onRenameServer: (id) => {
        if (!mainWindow) return;
        const entry = loadServers(userDataDir()).servers.find((s) => s.id === id);
        if (!entry) return;
        captureLastPath();
        // Prefill context rides the query string — main-supplied, store-derived.
        showWelcome(mainWindow, {
          mode: "rename",
          id: entry.id,
          name: entry.name,
          url: entry.url,
        });
      },
      onRemoveServer: (id) => {
        void confirmAndRemoveServer(id);
      },
    }),
  );
}

async function confirmAndRemoveServer(id: string): Promise<void> {
  const win = mainWindow;
  if (!win) return;
  const list = loadServers(userDataDir());
  const entry = list.servers.find((s) => s.id === id);
  if (!entry) return;
  const wasActive = resolveActiveServer(list)?.id === id;

  const { response } = await dialog.showMessageBox(win, {
    type: "warning",
    buttons: ["Remove", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    message: `Remove "${entry.name}"?`,
    detail: entry.url,
  });
  if (response !== 0) return;

  removeServer(userDataDir(), id);
  rebuildMenu();
  if (wasActive) showActive(win); // first remaining server, or welcome
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

// ─── IPC (sender-frame gated) ───────────────────────────────────────────────

/**
 * Privilege gate: `welcome:*` calls are honored only from the welcome
 * file:// page. Pages loaded from registered servers can read
 * `runkitShell.version`/`platform` but never invoke privileged calls.
 */
function isWelcomeSender(event: IpcMainInvokeEvent): boolean {
  return event.senderFrame?.url.startsWith(WELCOME_URL) ?? false;
}

/**
 * Privilege gate for `servers:*` — a wider allowlist than `welcome:*`:
 * registered server origins (the pages that host the SPA palette) plus the
 * welcome page. Same set as the navigation guard; any other sender gets a
 * rejection, never a privileged action.
 */
function isServersSender(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url;
  return url !== undefined && isAllowedNavigation(url);
}

function parseAddPayload(value: unknown): { name: string; url: string } | null {
  if (typeof value !== "object" || value === null) return null;
  if (!("url" in value) || typeof value.url !== "string") return null;
  const name = "name" in value && typeof value.name === "string" ? value.name : "";
  return { name, url: value.url };
}

function parseRenamePayload(value: unknown): { id: string; name: string } | null {
  if (typeof value !== "object" || value === null) return null;
  // A blank id would silently no-op in the store while answering ok — reject it.
  if (!("id" in value) || typeof value.id !== "string" || value.id.trim() === "") return null;
  const name = "name" in value && typeof value.name === "string" ? value.name : "";
  return { id: value.id, name };
}

function registerIpcHandlers(): void {
  ipcMain.handle(
    "welcome:test-server",
    async (event, rawUrl: unknown): Promise<PingResult> => {
      if (!isWelcomeSender(event)) return { ok: false, error: "Not allowed" };
      if (typeof rawUrl !== "string") return { ok: false, error: "Invalid request" };
      const normalized = normalizeOrigin(rawUrl);
      if (!normalized.ok) return normalized;
      return pingServer(normalized.origin);
    },
  );

  ipcMain.handle("welcome:add-server", (event, payload: unknown): IpcResult => {
    if (!isWelcomeSender(event)) return { ok: false, error: "Not allowed" };
    const parsed = parseAddPayload(payload);
    if (!parsed) return { ok: false, error: "Invalid request" };
    const result = addServer(userDataDir(), parsed.name, parsed.url);
    if (!result.ok) return result;
    rebuildMenu();
    if (mainWindow) void mainWindow.loadURL(result.server.url);
    return { ok: true };
  });

  ipcMain.handle("welcome:rename-server", (event, payload: unknown): IpcResult => {
    if (!isWelcomeSender(event)) return { ok: false, error: "Not allowed" };
    const parsed = parseRenamePayload(payload);
    if (!parsed) return { ok: false, error: "Invalid request" };
    // Only `name` changes — `id` (and therefore `lastPath`/`activeId` linkage)
    // is untouched; an unknown id is a store-level no-op.
    renameServer(userDataDir(), parsed.id, parsed.name);
    rebuildMenu();
    if (mainWindow) showActive(mainWindow);
    return { ok: true };
  });

  ipcMain.handle("welcome:cancel", (event): IpcResult => {
    if (!isWelcomeSender(event)) return { ok: false, error: "Not allowed" };
    if (mainWindow) showActive(mainWindow);
    return { ok: true };
  });

  ipcMain.handle("servers:list", (event): ServersListResult => {
    if (!isServersSender(event)) return { ok: false, error: "Not allowed" };
    return { ok: true, servers: serverInfos(loadServers(userDataDir())) };
  });

  ipcMain.handle("servers:switch", (event, id: unknown): IpcResult => {
    if (!isServersSender(event)) return { ok: false, error: "Not allowed" };
    if (typeof id !== "string") return { ok: false, error: "Invalid request" };
    return switchToServer(id);
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

  // One guard for both user navigation and server-issued redirects — a
  // registered server must not be able to escape in-window via a redirect.
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

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) openMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
