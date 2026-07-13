import type { ProjectSession } from "@/types";

export type { ProjectSession };

/** Append ?server= to a URL (handles existing query params). */
function withServer(url: string, server: string): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}server=${encodeURIComponent(server)}`;
}

/** In-flight GET request deduplication map. */
const inFlight = new Map<string, Promise<Response>>();

/** Deduplicate concurrent GET requests to the same URL. Non-GET requests pass through. */
export async function deduplicatedFetch(url: string, init?: RequestInit): Promise<Response> {
  const method = init?.method?.toUpperCase() ?? "GET";
  if (method !== "GET") return fetch(url, init);

  const existing = inFlight.get(url);
  if (existing) return existing.then(r => r.clone());

  const promise = fetch(url, init).finally(() => inFlight.delete(url));
  inFlight.set(url, promise);
  return promise.then(r => r.clone());
}

/** Throw an error from a JSON error response, falling back to status text. */
export async function throwOnError(res: Response): Promise<never> {
  const data = await res.json().catch(() => ({}));
  throw new Error((data as { error?: string }).error ?? `Request failed: ${res.status}`);
}

export interface HealthResponse {
  status: string;
  hostname: string;
}

export async function getHealth(): Promise<HealthResponse> {
  const res = await deduplicatedFetch("/api/health");
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function getSessions(server: string): Promise<ProjectSession[]> {
  const res = await deduplicatedFetch(withServer("/api/sessions", server));
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function getSessionOrder(server: string): Promise<string[]> {
  const res = await deduplicatedFetch(withServer("/api/sessions/order", server));
  if (!res.ok) await throwOnError(res);
  const body = (await res.json()) as { order?: string[] };
  return body.order ?? [];
}

export async function setSessionOrder(server: string, order: string[]): Promise<void> {
  const res = await fetch(withServer("/api/sessions/order", server), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ order }),
  });
  if (!res.ok) await throwOnError(res);
}

/** Declare which sessions an SSE connection has expanded, so the backend
 *  captures pane-text previews only for those sessions' windows (the tile
 *  grid density view). `conn` addresses the specific SSE connection; an empty
 *  `expanded` array clears the scope (capture-nothing). */
export async function setPreviewScope(
  server: string,
  conn: string,
  expanded: string[],
): Promise<void> {
  const res = await fetch(withServer("/api/preview-scope", server), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conn, expanded }),
  });
  if (!res.ok) await throwOnError(res);
}

export async function createSession(
  server: string,
  name: string,
  cwd?: string,
): Promise<{ ok: boolean }> {
  const body: Record<string, string> = { name };
  if (cwd) body.cwd = cwd;
  const res = await fetch(withServer("/api/sessions", server), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function renameSession(
  server: string,
  session: string,
  name: string,
): Promise<{ ok: boolean }> {
  const res = await fetch(
    withServer(`/api/sessions/${encodeURIComponent(session)}/rename`, server),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    },
  );
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function killSession(server: string, session: string): Promise<{ ok: boolean }> {
  const res = await fetch(withServer(`/api/sessions/${encodeURIComponent(session)}/kill`, server), {
    method: "POST",
  });
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function createWindow(
  server: string,
  session: string,
  name?: string,
  cwd?: string,
  rkType?: string,
  rkUrl?: string,
): Promise<{ ok: boolean }> {
  // `name` is optional: omitting it (or passing an empty string) tells the
  // backend to let tmux auto-name the window to its folder basename via
  // automatic-rename-format. Explicit names (renames, iframe windows) are
  // still sent. Matches the existing omit-when-absent handling for cwd/rkType.
  const body: Record<string, string> = {};
  if (name) body.name = name;
  if (cwd) body.cwd = cwd;
  if (rkType) body.rkType = rkType;
  if (rkUrl) body.rkUrl = rkUrl;
  const res = await fetch(withServer(`/api/sessions/${encodeURIComponent(session)}/windows`, server), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function killWindow(
  server: string,
  windowId: string,
): Promise<{ ok: boolean }> {
  const res = await fetch(
    withServer(`/api/windows/${encodeURIComponent(windowId)}/kill`, server),
    { method: "POST" },
  );
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function moveWindow(
  server: string,
  windowId: string,
  targetIndex: number,
): Promise<{ ok: boolean }> {
  const res = await fetch(
    withServer(`/api/windows/${encodeURIComponent(windowId)}/move`, server),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetIndex }),
    },
  );
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function moveWindowToSession(
  server: string,
  windowId: string,
  targetSession: string,
): Promise<{ ok: boolean }> {
  const res = await fetch(
    withServer(`/api/windows/${encodeURIComponent(windowId)}/move-to-session`, server),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetSession }),
    },
  );
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function renameWindow(
  server: string,
  windowId: string,
  name: string,
): Promise<{ ok: boolean }> {
  const res = await fetch(
    withServer(`/api/windows/${encodeURIComponent(windowId)}/rename`, server),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    },
  );
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function sendKeys(
  server: string,
  windowId: string,
  keys: string,
): Promise<{ ok: boolean }> {
  const res = await fetch(
    withServer(`/api/windows/${encodeURIComponent(windowId)}/keys`, server),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys }),
    },
  );
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function splitWindow(
  server: string,
  windowId: string,
  horizontal: boolean,
  cwd?: string,
): Promise<{ ok: boolean; pane_id: string }> {
  const body: Record<string, unknown> = { horizontal };
  if (cwd) body.cwd = cwd;
  const res = await fetch(
    withServer(`/api/windows/${encodeURIComponent(windowId)}/split`, server),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function closePane(
  server: string,
  windowId: string,
): Promise<{ ok: boolean }> {
  const res = await fetch(
    withServer(`/api/windows/${encodeURIComponent(windowId)}/close-pane`, server),
    { method: "POST" },
  );
  if (!res.ok) await throwOnError(res);
  return res.json();
}

/**
 * Partial-merge window options via the unified POST /options endpoint. Each
 * value is a string (set) or null (unset); absent keys are left untouched. Only
 * the allowlisted keys `@color`/`@rk_url`/`@rk_type` are accepted server-side.
 * The whole merge is applied as one atomic chained tmux invocation.
 */
export async function setWindowOptions(
  server: string,
  windowId: string,
  options: Record<string, string | null>,
): Promise<{ ok: boolean }> {
  const res = await fetch(
    withServer(`/api/windows/${encodeURIComponent(windowId)}/options`, server),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ options }),
    },
  );
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function updateWindowUrl(
  server: string,
  windowId: string,
  url: string,
): Promise<{ ok: boolean }> {
  return setWindowOptions(server, windowId, { "@rk_url": url });
}

export async function updateWindowType(
  server: string,
  windowId: string,
  rkType: string,
): Promise<{ ok: boolean }> {
  // An empty string means "switch back to terminal" — the server unsets
  // @rk_type for "" or null. Pass the string through verbatim; "" maps to unset.
  return setWindowOptions(server, windowId, { "@rk_type": rkType === "" ? null : rkType });
}

export async function selectWindow(
  server: string,
  windowId: string,
): Promise<{ ok: boolean }> {
  const res = await fetch(
    withServer(`/api/windows/${encodeURIComponent(windowId)}/select`, server),
    { method: "POST" },
  );
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function getDirectories(prefix: string): Promise<string[]> {
  const res = await deduplicatedFetch(`/api/directories?prefix=${encodeURIComponent(prefix)}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.directories ?? [];
}

export async function reloadTmuxConfig(server: string): Promise<{ ok: boolean }> {
  const res = await fetch(withServer("/api/tmux/reload-config", server), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!res.ok) await throwOnError(res);
  return { ok: true };
}

export async function initTmuxConf(): Promise<{ ok: boolean }> {
  const res = await fetch("/api/tmux/init-conf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!res.ok) await throwOnError(res);
  return { ok: true };
}

/** Trigger an on-demand refresh of the server-side PR-status collector. The
 *  refreshed statuses arrive via the normal SSE sessions stream — this just
 *  kicks the (otherwise 90s-cadence) batched `gh` fetch. Best-effort: callers
 *  ignore the result. Server-independent (the collector is global). */
export async function refreshPrStatus(): Promise<{ ok: boolean }> {
  const res = await fetch("/api/pr-status/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!res.ok) await throwOnError(res);
  return { ok: true };
}

/** Trigger a one-click self-upgrade of the daemon: POST /api/update. The server
 *  responds 202 and spawns a detached `rk update` (which restarts the daemon).
 *  Best-effort from the caller's view — the ensuing daemon restart drops the SSE
 *  connection, and the reconnect's differing `version` event drives the tab
 *  reload. Rejects on a non-2xx (e.g. 409 not-brew / no-update) so the chip can
 *  surface the failure. Server-independent (the daemon is one process). */
export async function triggerUpdate(): Promise<void> {
  const res = await fetch("/api/update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!res.ok) await throwOnError(res);
}

/** Force a self-upgrade regardless of the update checker's qualifying snapshot:
 *  POST /api/update with `{"force":true}`. The server skips the qualify check
 *  (but still requires a brew install) and spawns a detached `rk update`, so a
 *  patch release — unreachable via the qualifying-gated `triggerUpdate()` — is
 *  installable from the web. Best-effort from the caller's view (the ensuing
 *  daemon restart drops SSE; the reconnect's differing version/boot drives the
 *  reload). Rejects on a non-2xx (e.g. 409 not-brew). */
export async function triggerForceUpdate(): Promise<void> {
  const res = await fetch("/api/update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ force: true }),
  });
  if (!res.ok) await throwOnError(res);
}

/** Restart the daemon: POST /api/restart. The server responds 202 and spawns a
 *  detached `rk daemon restart` (no brew requirement). Best-effort — the restart
 *  drops the SSE connection, and the reconnect's differing `boot` id drives the
 *  reload guard even when the version is unchanged. Rejects on a non-2xx (e.g.
 *  409 on a dev build). Server-independent (the daemon is one process). */
export async function triggerRestart(): Promise<void> {
  const res = await fetch("/api/restart", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!res.ok) await throwOnError(res);
}

export async function uploadFile(
  server: string,
  session: string,
  file: File,
  window?: string,
): Promise<{ ok: boolean; path: string }> {
  const formData = new FormData();
  formData.append("file", file);
  if (window) formData.append("window", window);

  const res = await fetch(withServer(`/api/sessions/${encodeURIComponent(session)}/upload`, server), {
    method: "POST",
    body: formData,
  });
  if (!res.ok) await throwOnError(res);
  return res.json();
}

// --- Color management ---

export async function setWindowColor(
  server: string,
  windowId: string,
  color: string | null,
): Promise<{ ok: boolean }> {
  // @color is a color-value descriptor string ("4" / "1+3") on the unified
  // /options contract; null clears it.
  return setWindowOptions(server, windowId, {
    "@color": color,
  });
}

export async function setSessionColor(
  server: string,
  session: string,
  color: string | null,
): Promise<{ ok: boolean }> {
  const res = await fetch(
    withServer(`/api/sessions/${encodeURIComponent(session)}/color`, server),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ color }),
    },
  );
  if (!res.ok) await throwOnError(res);
  return res.json();
}

// --- Server management ---

export type ServerInfo = {
  name: string;
  sessionCount: number;
  /** User-defined display rank (@rk_server_rank). null/undefined when unset —
   *  unranked servers sort after ranked ones within the regular class. */
  rank?: number | null;
};

/** The tmux server socket hosting the run-kit daemon itself (infrastructure,
 *  not a workspace). Mirrors the backend `ServerSocket` constant
 *  (app/backend/internal/daemon/daemon.go). */
export const DAEMON_SERVER = "rk-daemon";
// Mirrors backend IsTestServerName (app/backend/internal/tmux/tmux.go:1342) —
// the one frontend home of the "rk-test-" literal.
const TEST_SERVER_PREFIX = "rk-test-";

/** True for infrastructure servers (the daemon socket and any test socket),
 *  which are de-emphasized and sorted last in every server list. */
export function isInfraServer(name: string): boolean {
  return name === DAEMON_SERVER || name.startsWith(TEST_SERVER_PREFIX);
}

/** Sort comparator: regular servers first (alphabetical), then infrastructure
 *  servers (alphabetical within their class). Plain lexicographic (not
 *  localeCompare) to mirror the backend's `sort.Strings` byte order within each
 *  class, keeping the regular-server segment byte-identical to today. */
export function compareServers(a: ServerInfo, b: ServerInfo): number {
  const ai = isInfraServer(a.name);
  const bi = isInfraServer(b.name);
  if (ai !== bi) return ai ? 1 : -1;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/** Rank-aware sort comparator. Effective key: (infra-class, rank, name).
 *
 *  Infra servers (`isInfraServer`) stay pinned last as a class and IGNORE rank
 *  entirely (their intra-class order is byte-alphabetical, unchanged). Within
 *  the regular class: ranked servers sort by rank ascending; a ranked server
 *  sorts before any unranked one; two unranked servers fall back to byte-order
 *  name. This wraps `compareServers` so the infra-last + byte-order semantics
 *  (and their tests) are preserved verbatim — rank is a secondary key inserted
 *  only inside the regular class. An all-regular-unranked list is byte-
 *  alphabetical, identical to `compareServers`. */
export function compareServersRanked(a: ServerInfo, b: ServerInfo): number {
  const ai = isInfraServer(a.name);
  const bi = isInfraServer(b.name);
  // Cross-class or both-infra: defer entirely to compareServers (infra ignore
  // rank; the class pin and byte-order intra-infra ordering are unchanged).
  if (ai !== bi || (ai && bi)) return compareServers(a, b);
  // Both regular: rank is the primary key.
  const ar = a.rank ?? null;
  const br = b.rank ?? null;
  if (ar !== br) {
    if (ar === null) return 1; // unranked sorts after ranked
    if (br === null) return -1;
    return ar - br;
  }
  // Same rank (both null, or an unlikely duplicate rank): byte-order name.
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

export async function listServers(): Promise<ServerInfo[]> {
  const res = await deduplicatedFetch("/api/servers");
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function createServer(name: string): Promise<{ ok: boolean }> {
  const res = await fetch("/api/servers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function killServer(name: string): Promise<{ ok: boolean }> {
  const res = await fetch("/api/servers/kill", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) await throwOnError(res);
  return res.json();
}

/** Persist the user-defined server display order. The backend writes rank i to
 *  the i-th listed server and broadcasts a server-global `event: server-order`.
 *  Server-independent (like listServers/createServer/killServer) — the order
 *  spans the whole /api/servers list, not one server. */
export async function setServerOrder(order: string[]): Promise<void> {
  const res = await fetch("/api/servers/order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ order }),
  });
  if (!res.ok) await throwOnError(res);
}

export interface Keybinding {
  key: string;
  table: string;
  command: string;
  label: string;
}

export async function getKeybindings(server: string): Promise<Keybinding[]> {
  const res = await deduplicatedFetch(withServer("/api/keybindings", server));
  if (!res.ok) await throwOnError(res);
  return res.json();
}

// --- Theme settings (global, not per-server) ---

export async function getThemePreference(): Promise<{
  theme: string;
  themeDark: string;
  themeLight: string;
}> {
  const res = await deduplicatedFetch("/api/settings/theme");
  if (!res.ok) await throwOnError(res);
  const data: { theme: string; theme_dark: string; theme_light: string } = await res.json();
  return {
    theme: data.theme,
    themeDark: data.theme_dark,
    themeLight: data.theme_light,
  };
}

export async function setThemePreference(prefs: {
  theme?: string;
  themeDark?: string;
  themeLight?: string;
}): Promise<void> {
  const body: Record<string, string> = {};
  if (prefs.theme !== undefined) body.theme = prefs.theme;
  if (prefs.themeDark !== undefined) body.theme_dark = prefs.themeDark;
  if (prefs.themeLight !== undefined) body.theme_light = prefs.themeLight;
  if (Object.keys(body).length === 0) return;
  const res = await fetch("/api/settings/theme", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) await throwOnError(res);
}

// --- Server color settings (global, not per-server) ---

export async function getServerColor(server: string): Promise<string | null> {
  const res = await deduplicatedFetch(`/api/settings/server-color?server=${encodeURIComponent(server)}`);
  if (!res.ok) await throwOnError(res);
  const data: { color: string | null } = await res.json();
  return data.color;
}

export async function getAllServerColors(): Promise<Record<string, string>> {
  const res = await deduplicatedFetch("/api/settings/server-color");
  if (!res.ok) await throwOnError(res);
  const data: { colors: Record<string, string> } = await res.json();
  return data.colors;
}

export async function setServerColor(server: string, color: string | null): Promise<void> {
  const res = await fetch("/api/settings/server-color", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ server, color }),
  });
  if (!res.ok) await throwOnError(res);
}

// --- Web Push ---

/** Fetch the server's VAPID public key (base64url) for pushManager.subscribe. */
export async function getVapidPublicKey(): Promise<string> {
  const res = await deduplicatedFetch("/api/push/vapid-public-key");
  if (!res.ok) await throwOnError(res);
  const data: { key: string } = await res.json();
  return data.key;
}

/** POST a browser PushSubscription (its JSON form) to the server's store. */
export async function subscribePush(subscription: PushSubscriptionJSON): Promise<void> {
  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscription),
  });
  if (!res.ok) await throwOnError(res);
}

// --- Riff (web-UI agent spawn) — 260713-sbk1 ---

/** A riff preset summary for the spawn dialog's dropdown, mirroring the backend
 *  `GET /api/riff/presets` shape. `layout` is the empty string when unset. */
export type RiffPreset = {
  name: string;
  layout: string;
  paneCount: number;
};

/** The response of a successful spawn — enough to navigate to the new window. */
export type RiffSpawnResult = {
  server: string;
  session: string;
  window: string;
  windowId: string;
};

/** Spawn a riff agent window in `session`'s repo. `task` (optional) becomes the
 *  agent's boot task (auto-submits); an empty task spawns a blank agent session.
 *  `preset` (optional) selects a riff preset from the session's repo config. On
 *  success the caller navigates to `/$server/$windowId`. Throws on a non-ok
 *  response (a 400 carries a human-readable message, e.g. non-repo cwd). */
export async function spawnRiff(
  server: string,
  session: string,
  task?: string,
  preset?: string,
): Promise<RiffSpawnResult> {
  const body: Record<string, string> = { session };
  if (task) body.task = task;
  if (preset) body.preset = preset;
  const res = await fetch(withServer("/api/riff", server), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) await throwOnError(res);
  return res.json();
}

/** List the riff presets defined in `session`'s repo (YAML source order; []
 *  when none). Throws on a non-ok response (e.g. 400 for a non-repo cwd);
 *  the dialog treats a failure as "no presets" and still allows a task-only
 *  spawn. */
export async function getRiffPresets(
  server: string,
  session: string,
): Promise<RiffPreset[]> {
  const res = await deduplicatedFetch(
    withServer(`/api/riff/presets?session=${encodeURIComponent(session)}`, server),
  );
  if (!res.ok) await throwOnError(res);
  const data: { presets?: RiffPreset[] } = await res.json();
  return data.presets ?? [];
}
