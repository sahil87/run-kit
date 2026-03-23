import type { ProjectSession } from "@/types";

export type { ProjectSession };

// Module-level server getter — set by SessionProvider
let _getServer: () => string = () => "runkit";

export function setServerGetter(fn: () => string) {
  _getServer = fn;
}

/** Append ?server= to a URL (handles existing query params). */
function withServer(url: string): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}server=${encodeURIComponent(_getServer())}`;
}

/** In-flight GET request deduplication map. */
const inFlight = new Map<string, Promise<Response>>();

/** Deduplicate concurrent GET requests to the same URL. Non-GET requests pass through. */
async function deduplicatedFetch(url: string, init?: RequestInit): Promise<Response> {
  const method = init?.method?.toUpperCase() ?? "GET";
  if (method !== "GET") return fetch(url, init);

  const existing = inFlight.get(url);
  if (existing) return existing.then(r => r.clone());

  const promise = fetch(url, init).finally(() => inFlight.delete(url));
  inFlight.set(url, promise);
  return promise.then(r => r.clone());
}

/** Throw an error from a JSON error response, falling back to status text. */
async function throwOnError(res: Response): Promise<never> {
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

export async function getSessions(): Promise<ProjectSession[]> {
  const res = await deduplicatedFetch(withServer("/api/sessions"));
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function createSession(
  name: string,
  cwd?: string,
): Promise<{ ok: boolean }> {
  const body: Record<string, string> = { name };
  if (cwd) body.cwd = cwd;
  const res = await fetch(withServer("/api/sessions"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function renameSession(
  session: string,
  name: string,
): Promise<{ ok: boolean }> {
  const res = await fetch(
    withServer(`/api/sessions/${encodeURIComponent(session)}/rename`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    },
  );
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function killSession(session: string): Promise<{ ok: boolean }> {
  const res = await fetch(withServer(`/api/sessions/${encodeURIComponent(session)}/kill`), {
    method: "POST",
  });
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function createWindow(
  session: string,
  name: string,
  cwd?: string,
): Promise<{ ok: boolean }> {
  const body: Record<string, string> = { name };
  if (cwd) body.cwd = cwd;
  const res = await fetch(withServer(`/api/sessions/${encodeURIComponent(session)}/windows`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function createDesktopWindow(
  session: string,
  name?: string,
  resolution?: string,
): Promise<{ ok: boolean }> {
  const body: Record<string, string> = {
    name: name ?? "desktop",
    type: "desktop",
  };
  if (resolution) body.resolution = resolution;
  const res = await fetch(withServer(`/api/sessions/${encodeURIComponent(session)}/windows`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function changeDesktopResolution(
  session: string,
  windowIndex: number,
  resolution: string,
): Promise<{ ok: boolean }> {
  const res = await fetch(
    withServer(`/api/sessions/${encodeURIComponent(session)}/windows/${windowIndex}/resolution`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolution }),
    },
  );
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function killWindow(
  session: string,
  index: number,
): Promise<{ ok: boolean }> {
  const res = await fetch(
    withServer(`/api/sessions/${encodeURIComponent(session)}/windows/${index}/kill`),
    { method: "POST" },
  );
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function renameWindow(
  session: string,
  index: number,
  name: string,
): Promise<{ ok: boolean }> {
  const res = await fetch(
    withServer(`/api/sessions/${encodeURIComponent(session)}/windows/${index}/rename`),
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
  session: string,
  index: number,
  keys: string,
): Promise<{ ok: boolean }> {
  const res = await fetch(
    withServer(`/api/sessions/${encodeURIComponent(session)}/windows/${index}/keys`),
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
  session: string,
  index: number,
  horizontal: boolean,
): Promise<{ ok: boolean; pane_id: string }> {
  const res = await fetch(
    withServer(`/api/sessions/${encodeURIComponent(session)}/windows/${index}/split`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ horizontal }),
    },
  );
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function closePane(
  session: string,
  index: number,
): Promise<{ ok: boolean }> {
  const res = await fetch(
    withServer(`/api/sessions/${encodeURIComponent(session)}/windows/${index}/close-pane`),
    { method: "POST" },
  );
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function selectWindow(
  session: string,
  index: number,
): Promise<{ ok: boolean }> {
  const res = await fetch(
    withServer(`/api/sessions/${encodeURIComponent(session)}/windows/${index}/select`),
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

export async function reloadTmuxConfig(): Promise<{ ok: boolean }> {
  const res = await fetch(withServer("/api/tmux/reload-config"), {
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
  session: string,
  file: File,
  window?: string,
): Promise<{ ok: boolean; path: string }> {
  const formData = new FormData();
  formData.append("file", file);
  if (window) formData.append("window", window);

  const res = await fetch(withServer(`/api/sessions/${encodeURIComponent(session)}/upload`), {
    method: "POST",
    body: formData,
  });
  if (!res.ok) await throwOnError(res);
  return res.json();
}

// --- Server management ---

export async function listServers(): Promise<string[]> {
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

export async function getKeybindings(): Promise<Keybinding[]> {
  const res = await deduplicatedFetch(withServer("/api/keybindings"));
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
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) await throwOnError(res);
}
