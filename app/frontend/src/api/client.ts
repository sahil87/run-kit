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
  name: string,
  cwd?: string,
  rkType?: string,
  rkUrl?: string,
): Promise<{ ok: boolean }> {
  const body: Record<string, string> = { name };
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
  color: number | null,
): Promise<{ ok: boolean }> {
  // @color is carried as a string on the unified /options contract (one map
  // can't mix native int + string values); null clears it.
  return setWindowOptions(server, windowId, {
    "@color": color === null ? null : String(color),
  });
}

export async function setSessionColor(
  server: string,
  session: string,
  color: number | null,
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
};

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

export async function getServerColor(server: string): Promise<number | null> {
  const res = await deduplicatedFetch(`/api/settings/server-color?server=${encodeURIComponent(server)}`);
  if (!res.ok) await throwOnError(res);
  const data: { color: number | null } = await res.json();
  return data.color;
}

export async function getAllServerColors(): Promise<Record<string, number>> {
  const res = await deduplicatedFetch("/api/settings/server-color");
  if (!res.ok) await throwOnError(res);
  const data: { colors: Record<string, number> } = await res.json();
  return data.colors;
}

export async function setServerColor(server: string, color: number | null): Promise<void> {
  const res = await fetch("/api/settings/server-color", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ server, color }),
  });
  if (!res.ok) await throwOnError(res);
}
