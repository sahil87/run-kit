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
  const res = await fetch("/api/health");
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function getSessions(): Promise<ProjectSession[]> {
  const res = await fetch(withServer("/api/sessions"));
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
  const res = await fetch(`/api/directories?prefix=${encodeURIComponent(prefix)}`);
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
  const res = await fetch("/api/servers");
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
