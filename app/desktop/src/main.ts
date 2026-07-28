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
import {
  addServer,
  loadServers,
  normalizeOrigin,
  removeServer,
  resolveActiveServer,
  setActiveServer,
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

// ─── URL helpers ────────────────────────────────────────────────────────────

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function isHttpUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
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

function showWelcome(win: BrowserWindow, mode?: "add"): void {
  void win.loadFile(WELCOME_PATH, mode ? { query: { mode } } : undefined);
}

/** Load the active server (dangling activeId → first server), else welcome. */
function showActive(win: BrowserWindow): void {
  const active = resolveActiveServer(loadServers(userDataDir()));
  if (active) {
    void win.loadURL(active.url);
  } else {
    showWelcome(win);
  }
}

function showStartPage(win: BrowserWindow): void {
  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    showActive(win);
  }
}

// ─── Menu ───────────────────────────────────────────────────────────────────

function rebuildMenu(): void {
  const list = loadServers(userDataDir());
  Menu.setApplicationMenu(
    buildMenu(list.servers, list.activeId, {
      onSwitchServer: (id) => {
        const next = setActiveServer(userDataDir(), id);
        const entry = next.servers.find((s) => s.id === id);
        if (entry && mainWindow) void mainWindow.loadURL(entry.url);
        rebuildMenu();
      },
      onAddServer: () => {
        if (mainWindow) showWelcome(mainWindow, "add");
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

// ─── IPC (welcome page only — sender-frame gated) ──────────────────────────

/**
 * Privilege gate: `welcome:*` calls are honored only from the welcome
 * file:// page. Pages loaded from registered servers can read
 * `runkitShell.version`/`platform` but never invoke privileged calls.
 */
function isWelcomeSender(event: IpcMainInvokeEvent): boolean {
  return event.senderFrame?.url.startsWith(WELCOME_URL) ?? false;
}

function parseAddPayload(value: unknown): { name: string; url: string } | null {
  if (typeof value !== "object" || value === null) return null;
  if (!("url" in value) || typeof value.url !== "string") return null;
  const name = "name" in value && typeof value.name === "string" ? value.name : "";
  return { name, url: value.url };
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

  ipcMain.handle("welcome:cancel", (event): IpcResult => {
    if (!isWelcomeSender(event)) return { ok: false, error: "Not allowed" };
    if (mainWindow) showActive(mainWindow);
    return { ok: true };
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
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });
  mainWindow = win;
  showStartPage(win);
}

app.on("web-contents-created", (_event, contents) => {
  // New windows are always denied; registered origins load in-window,
  // any other http(s) target goes to the system browser.
  contents.setWindowOpenHandler(({ url }) => {
    const origin = originOf(url);
    if (origin !== null && registeredOrigins().has(origin)) {
      void contents.loadURL(url);
    } else if (isHttpUrl(url)) {
      void shell.openExternal(url);
    }
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
